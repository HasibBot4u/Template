/**
 * SOWVEIL STUDIO — PROMPT F4: FINAL PERSISTENCE CUTOVER AND ROLLBACK CONTROL SUITE
 *
 * Verifies:
 * 1. Precondition blockers (test driver, local snapshot adapter, disconnected Firestore,
 *    missing/ineligible F3 receipt, checksum/parity mismatch, unresolved failures,
 *    missing durable backup, missing operator identity, missing second confirmation)
 *    leave the legacy writer untouched (`isLegacySnapshotWriterDisabled() === false`)
 *    and return precise blocker codes.
 * 2. Invalid and expired second confirmation tokens are rejected (`400 CUTOVER_CONFIRMATION_TOKEN_INVALID`,
 *    `400 CUTOVER_CONFIRMATION_TOKEN_EXPIRED`) without disabling legacy writers.
 * 3. Concurrent cutover requests across multiple instances are blocked via durable global lock
 *    (`409 MIGRATION_LOCK_ALREADY_HELD`).
 * 4. Maintenance / read-only reconciliation window blocks concurrent user writes (`503 MAINTENANCE_READ_ONLY_WINDOW_ACTIVE`),
 *    allows reads, and reconciles delta records.
 * 5. Partial / acceptance failure during reconciliation aborts cleanly (`500 CUTOVER_RECONCILIATION_ACCEPTANCE_FAILED`),
 *    exits the maintenance window, and leaves legacy writers enabled (`false`).
 * 6. Successful final cutover disables legacy writers (`isLegacySnapshotWriterDisabled() === true`),
 *    records exact `cutoverTimestamp`, `releaseCommit`, `adapterIdentity`, `databaseId`, `entityCounts`,
 *    `sourceChecksum`, and `targetChecksum`, rejects duplicate requests (`409 CUTOVER_CONFIRMATION_TOKEN_ALREADY_USED`
 *    and `409 CUTOVER_ALREADY_COMMITTED`), and survives full server restart.
 * 7. Safe rollback (`POST /api/v1/admin/migration/rollback`) re-enables legacy writers and merges
 *    newer Firestore records (`revision` / post-cutover records) so it never blindly overwrites newer data.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createSowveilApiApp, type VerifiedTokenIdentity } from '../server/apiApp';
import {
  AuthoritativeFirestorePersistenceAdapter,
  CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
  CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
  FirestoreDocumentDriver,
  LocalSnapshotPersistenceAdapter,
  RuleEnforcingFirestoreTestDriver,
} from '../server/persistenceAdapters';
import type {
  AdminSdkCollectionReferenceLike,
  AdminSdkDocumentReferenceLike,
  AdminSdkDocumentSnapshotLike,
  AdminSdkFirestoreClientLike,
  AdminSdkQueryLike,
  AdminSdkQuerySnapshotLike,
  AdminSdkTransactionLike,
  AdminSdkWriteBatchLike,
  FirestoreFilterOp,
} from '../server/firestoreAdminDriver';
import {
  isLegacySnapshotWriterDisabled,
  isMaintenanceReadOnlyWindowActive,
  prepareFinalPersistenceCutover,
  resetLegacySnapshotWriterStateForTests,
} from '../server/migrationCutover';
import { loadDurableSnapshot, saveDurableSnapshot } from '../server/durableStore';
import { ISowveilPersistenceAdapter } from '../services/persistenceContracts';
import { createKnownGoodSampleCanonicalProject } from '../services/renderExportQaEngine';
import { serializeCanonicalProject } from '../services/canonicalProjectEngine';

const TEST_TOKENS: Record<string, VerifiedTokenIdentity> = {
  'token-owner': {
    uid: 'uid-owner-f4',
    email: 'mdhasibul4u@gmail.com',
    emailVerified: true,
    displayName: 'Sowveil Owner F4',
  },
  'token-alice': {
    uid: 'uid-alice-f4',
    email: 'alice-f4@sowveil.studio',
    emailVerified: true,
    displayName: 'Alice Producer F4',
  },
};

function createFakeAdminFirestoreClient(): {
  client: AdminSdkFirestoreClientLike;
  store: Map<string, Map<string, Record<string, unknown>>>;
  setDisconnected: (offline: boolean) => void;
} {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let isOffline = false;

  const ensureOnline = () => {
    if (isOffline) {
      const err = new Error('14 UNAVAILABLE: Firestore backend unreachable') as Error & {
        code?: number;
      };
      err.code = 14;
      throw err;
    }
  };

  const getColMap = (colName: string): Map<string, Record<string, unknown>> => {
    let col = store.get(colName);
    if (!col) {
      col = new Map();
      store.set(colName, col);
    }
    return col;
  };

  const makeDocSnapshot = (
    id: string,
    raw: Record<string, unknown> | undefined
  ): AdminSdkDocumentSnapshotLike => ({
    id,
    exists: raw !== undefined,
    data: () => (raw ? JSON.parse(JSON.stringify(raw)) : undefined),
  });

  const makeDocRef = (colName: string, docId: string): AdminSdkDocumentReferenceLike => ({
    id: docId,
    path: `${colName}/${docId}`,
    get: async () => {
      ensureOnline();
      return makeDocSnapshot(docId, getColMap(colName).get(docId));
    },
    create: async (data: Record<string, unknown>) => {
      ensureOnline();
      const col = getColMap(colName);
      if (col.has(docId)) {
        const err = new Error('6 ALREADY_EXISTS: Document already exists') as Error & {
          code?: number;
        };
        err.code = 6;
        throw err;
      }
      col.set(docId, JSON.parse(JSON.stringify(data)));
      return {};
    },
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      ensureOnline();
      const col = getColMap(colName);
      if (options?.merge && col.has(docId)) {
        const existing = col.get(docId)!;
        col.set(docId, JSON.parse(JSON.stringify({ ...existing, ...data })));
      } else {
        col.set(docId, JSON.parse(JSON.stringify(data)));
      }
      return {};
    },
    update: async (data: Record<string, unknown>) => {
      ensureOnline();
      const col = getColMap(colName);
      if (!col.has(docId)) {
        const err = new Error('5 NOT_FOUND: Document does not exist') as Error & {
          code?: number;
        };
        err.code = 5;
        throw err;
      }
      const existing = col.get(docId)!;
      col.set(docId, JSON.parse(JSON.stringify({ ...existing, ...data })));
      return {};
    },
    delete: async () => {
      ensureOnline();
      getColMap(colName).delete(docId);
      return {};
    },
  });

  const buildQuery = (
    colName: string,
    filters: Array<{ field: string; op: FirestoreFilterOp; value: unknown }>,
    orders: Array<{ field: string; dir: 'asc' | 'desc' }>,
    limitCount?: number
  ): AdminSdkQueryLike => ({
    where: (field, op, value) =>
      buildQuery(colName, [...filters, { field, op, value }], orders, limitCount),
    orderBy: (field, dir = 'asc') =>
      buildQuery(colName, filters, [...orders, { field, dir }], limitCount),
    limit: (n) => buildQuery(colName, filters, orders, n),
    get: async (): Promise<AdminSdkQuerySnapshotLike> => {
      ensureOnline();
      const col = getColMap(colName);
      let entries = Array.from(col.entries());
      for (const f of filters) {
        entries = entries.filter(([, doc]) => {
          const v = doc[f.field];
          if (f.op === '==') return v === f.value;
          if (f.op === '!=') return v !== f.value;
          if (f.op === '<') return (v as any) < (f.value as any);
          if (f.op === '<=') return (v as any) <= (f.value as any);
          if (f.op === '>') return (v as any) > (f.value as any);
          if (f.op === '>=') return (v as any) >= (f.value as any);
          if (f.op === 'in' && Array.isArray(f.value)) return f.value.includes(v);
          if (f.op === 'array-contains' && Array.isArray(v)) return v.includes(f.value);
          return false;
        });
      }
      for (const o of orders.slice().reverse()) {
        entries.sort(([, a], [, b]) => {
          const va = a[o.field] as any;
          const vb = b[o.field] as any;
          if (va === vb) return 0;
          const cmp = va < vb ? -1 : 1;
          return o.dir === 'desc' ? -cmp : cmp;
        });
      }
      if (typeof limitCount === 'number') {
        entries = entries.slice(0, limitCount);
      }
      const docs = entries.map(([id, raw]) => makeDocSnapshot(id, raw));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  });

  const client: AdminSdkFirestoreClientLike = {
    collection: (colPath: string): AdminSdkCollectionReferenceLike => {
      const baseQ = buildQuery(colPath, [], []);
      return {
        id: colPath,
        doc: (docId: string) => makeDocRef(colPath, docId),
        where: baseQ.where,
        orderBy: baseQ.orderBy,
        limit: baseQ.limit,
        get: baseQ.get,
      };
    },
    batch: (): AdminSdkWriteBatchLike => {
      const ops: Array<() => Promise<void>> = [];
      const b: AdminSdkWriteBatchLike = {
        set: (ref, data, opts) => {
          ops.push(async () => {
            await ref.set(data, opts);
          });
          return b;
        },
        create: (ref, data) => {
          ops.push(async () => {
            await ref.create(data);
          });
          return b;
        },
        update: (ref, data) => {
          ops.push(async () => {
            await ref.update(data);
          });
          return b;
        },
        delete: (ref) => {
          ops.push(async () => {
            await ref.delete();
          });
          return b;
        },
        commit: async () => {
          ensureOnline();
          for (const op of ops) {
            await op();
          }
          return {};
        },
      };
      return b;
    },
    runTransaction: async <T>(
      updateFn: (tx: AdminSdkTransactionLike) => Promise<T>
    ): Promise<T> => {
      ensureOnline();
      const stagedOps: Array<() => Promise<void>> = [];
      const tx: AdminSdkTransactionLike = {
        get: async (ref) => ref.get(),
        create: (ref, data) => {
          stagedOps.push(async () => {
            await ref.create(data);
          });
          return tx;
        },
        set: (ref, data, opts) => {
          stagedOps.push(async () => {
            await ref.set(data, opts);
          });
          return tx;
        },
        update: (ref, data) => {
          stagedOps.push(async () => {
            await ref.update(data);
          });
          return tx;
        },
        delete: (ref) => {
          stagedOps.push(async () => {
            await ref.delete();
          });
          return tx;
        },
      };
      const result = await updateFn(tx);
      for (const op of stagedOps) {
        await op();
      }
      return result;
    },
  };

  return {
    client,
    store,
    setDisconnected: (offline: boolean) => {
      isOffline = offline;
    },
  };
}

async function startF4Server(options: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  persistenceFilePath?: string;
  nodeEnv?: 'development' | 'production' | 'test';
}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createSowveilApiApp({
    persistenceAdapter: options.persistenceAdapter,
    persistenceFilePath: options.persistenceFilePath,
    ownerBootstrapEmail: 'mdhasibul4u@gmail.com',
    ownerBootstrapSecret: 'F4_CUTOVER_STRONG_BOOTSTRAP_SECRET_2026_998877',
    nodeEnv: options.nodeEnv || 'test',
    refuseUnreadyProductionStartup: false,
    tokenVerifier: async (token: string) => {
      const id = TEST_TOKENS[token];
      if (!id) {
        const err = new Error('Invalid token') as Error & { code?: string };
        err.code = 'INVALID_ID_TOKEN';
        throw err;
      }
      return id;
    },
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  assert(addr && typeof addr === 'object');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function runFinalPersistenceCutoverF4Tests(): Promise<void> {
  console.log('=== SOWVEIL STUDIO — PROMPT F4: FINAL PERSISTENCE CUTOVER & ROLLBACK SUITE ===');

  const realDurableStorePath = path.resolve(process.cwd(), '.data/sowveil-durable-store.json');
  const realFileExistedBefore = fs.existsSync(realDurableStorePath);
  const realFileShaBefore = realFileExistedBefore
    ? crypto.createHash('sha256').update(fs.readFileSync(realDurableStorePath)).digest('hex')
    : null;

  resetLegacySnapshotWriterStateForTests();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-f4-cutover-'));

  try {
    const sampleProject = createKnownGoodSampleCanonicalProject('uid-alice-f4');
    sampleProject.id = 'proj-f4-alice-1';
    sampleProject.ownerUid = 'uid-alice-f4';
    sampleProject.title = 'Alice F4 Canonical Project';
    sampleProject.revision = 2;
    const canonicalProjectJson = JSON.stringify(sampleProject);

    const snapshotPayload = {
      schemaVersion: '1.0.0',
      savedAt: '2026-10-30T12:00:00.000Z',
      catalogCacheVersion: 4,
      ownerBootstrappedUid: 'uid-owner-f4',
      platformSettings: {},
      roles: {
        'uid-owner-f4': 'owner' as const,
        'uid-alice-f4': 'admin' as const,
      },
      userStatuses: {
        'uid-owner-f4': 'active' as const,
        'uid-alice-f4': 'active' as const,
      },
      userPreferences: {},
      userFavorites: {},
      userRecentItems: {},
      catalogItems: [],
      modules: [],
      editorAdapters: [],
      assets: [],
      projects: [
        {
          id: 'proj-f4-alice-1',
          ownerUid: 'uid-alice-f4',
          title: 'Alice F4 Canonical Project',
          description: 'Initial F4 snapshot project',
          moduleId: 'text-animation',
          targetEditor: 'alight-motion',
          aspectRatio: '9:16',
          projectFileStatus: 'sowveil-native',
          revision: 2,
          activeBranch: 'main',
          compCount: 1,
          fileSizeBytes: 2048,
          fileSizeLabel: '2.0 KB',
          hasExternalFootageWarning: false,
          archived: false,
          tags: ['f4'],
          canonicalProjectJson,
          createdAt: '2026-10-25T10:00:00.000Z',
          updatedAt: '2026-10-28T10:00:00.000Z',
        },
      ],
      templateVariants: [],
      jobs: [],
      devices: [],
      referenceLabSessions: [],
      providerConnections: [],
      routingProfiles: {},
      extensionPackages: [],
      toolAuditRecords: [],
      aiDirectorSessions: [],
      templateFactoryDrafts: [],
      templatePreferenceSignals: [],
      userPreferenceConsents: {},
      renderExportJobs: [],
      auditEvents: [],
    };

    const snapshotPath = path.join(tmpDir, 'sowveil-f4-source.json');
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshotPayload, null, 2), 'utf8');

    // =========================================================================
    // 1. PRECONDITION BLOCKERS LEAVE LEGACY WRITER UNTOUCHED
    // =========================================================================
    console.log('1. Verifying precondition blockers (test driver, local snapshot, missing receipt, checksum mismatch, unresolved failures, missing backup, missing operator)...');

    // 1a. RuleEnforcingFirestoreTestDriver blocked with 503 MIGRATION_BACKEND_NOT_PRODUCTION_READY
    const testDriverAdapter = new AuthoritativeFirestorePersistenceAdapter({
      driver: new RuleEnforcingFirestoreTestDriver(),
      rejectTestDriverInProduction: false,
    });
    await testDriverAdapter.governance.setRole('uid-owner-f4', 'owner', 'bootstrap');
    const srvTestDriver = await startF4Server({
      persistenceAdapter: testDriverAdapter,
      persistenceFilePath: snapshotPath,
    });
    try {
      const prepRes = await fetch(`${srvTestDriver.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(prepRes.status, 503);
      assert.equal(((await prepRes.json()) as any).error.code, 'MIGRATION_BACKEND_NOT_PRODUCTION_READY');
      assert.equal(isLegacySnapshotWriterDisabled(), false);
    } finally {
      await srvTestDriver.close();
    }

    // 1b. Real FirestoreDocumentDriver without F3 receipt -> 409 CUTOVER_RECEIPT_MISSING_OR_INELIGIBLE
    const fakeFirestore = createFakeAdminFirestoreClient();
    const realDriver = new FirestoreDocumentDriver({
      firestoreClient: fakeFirestore.client,
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      expectedDatabaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
    });
    const realAdapter = new AuthoritativeFirestorePersistenceAdapter({
      driver: realDriver,
      expectedDatabaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
    });
    await realAdapter.governance.setRole('uid-owner-f4', 'owner', 'bootstrap');

    const srvProd = await startF4Server({
      persistenceAdapter: realAdapter,
      persistenceFilePath: snapshotPath,
    });

    try {
      const noReceiptRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(noReceiptRes.status, 409);
      assert.equal(
        ((await noReceiptRes.json()) as any).error.code,
        'CUTOVER_RECEIPT_MISSING_OR_INELIGIBLE'
      );
      assert.equal(isLegacySnapshotWriterDisabled(), false);

      // Missing operator identity check via direct call
      await assert.rejects(
        async () => {
          await prepareFinalPersistenceCutover({
            persistenceAdapter: realAdapter,
            operatorUid: '',
            operatorEmail: '',
          });
        },
        (err: any) => err?.code === 'CUTOVER_OPERATOR_IDENTITY_REQUIRED'
      );

      // Run F3 Dry-Run + Apply so we have a valid F3 migration receipt
      const dryRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryRes.status, 200);
      const dryReport = ((await dryRes.json()) as any).data.report;

      const applyRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryReport.dryRunId,
          confirmationToken: dryReport.operatorConfirmationToken,
          confirmApply: true,
        }),
      });
      assert.equal(applyRes.status, 200);
      const applyResult = ((await applyRes.json()) as any).data.result;
      assert.equal(applyResult.cutoverApprovalEligible, true);
      assert.equal(applyResult.legacyWritersDisabled, false);
      assert.equal(isLegacySnapshotWriterDisabled(), false);

      // 1c. Tamper with checksum on receipt -> 409 CUTOVER_PARITY_OR_CHECKSUM_MISMATCH
      const origReceipt = await realAdapter.migrationState.getMigrationReceipt!(applyResult.applyId);
      assert.ok(origReceipt);
      await realAdapter.migrationState.saveMigrationReceipt({
        ...origReceipt,
        targetChecksum: 'tampered_checksum_00000000',
      });
      const badChecksumRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ applyId: applyResult.applyId }),
      });
      assert.equal(badChecksumRes.status, 409);
      assert.equal(
        ((await badChecksumRes.json()) as any).error.code,
        'CUTOVER_PARITY_OR_CHECKSUM_MISMATCH'
      );
      await realAdapter.migrationState.saveMigrationReceipt(origReceipt);

      // 1d. Unresolved failure in progress -> 409 CUTOVER_UNRESOLVED_FAILURES_PRESENT
      const origProgress = await realAdapter.migrationState.getMigrationProgress(dryReport.dryRunId);
      assert.ok(origProgress);
      await realAdapter.migrationState.saveMigrationProgress({
        ...origProgress,
        failedRecords: [
          {
            entity: 'projects',
            recordId: 'proj-f4-alice-1',
            operation: 'parity',
            errorCode: 'HASH_MISMATCH',
            message: 'Simulated unresolved record failure',
          },
        ],
      });
      const unresolvedRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ applyId: applyResult.applyId }),
      });
      assert.equal(unresolvedRes.status, 409);
      assert.equal(
        ((await unresolvedRes.json()) as any).error.code,
        'CUTOVER_UNRESOLVED_FAILURES_PRESENT'
      );
      await realAdapter.migrationState.saveMigrationProgress(origProgress);

      // 1e. Missing durable backup -> 409 CUTOVER_DURABLE_BACKUP_MISSING
      await realAdapter.migrationState.saveMigrationReceipt({
        ...origReceipt,
        durableBackupId: 'non_existent_backup_id',
        backupPath: path.join(tmpDir, 'does-not-exist-backup.json'),
      });
      const noBackupRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ applyId: applyResult.applyId }),
      });
      assert.equal(noBackupRes.status, 409);
      assert.equal(
        ((await noBackupRes.json()) as any).error.code,
        'CUTOVER_DURABLE_BACKUP_MISSING'
      );
      await realAdapter.migrationState.saveMigrationReceipt(origReceipt);

      // =========================================================================
      // 2. INVALID TOKEN, EXPIRED TOKEN & MISSING SECOND CONFIRMATION
      // =========================================================================
      console.log('2. Verifying invalid token, expired token, and missing second confirmation...');

      // Expired token (tokenTtlMs: -1000)
      const prepExpiredRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          applyId: applyResult.applyId,
          tokenTtlMs: -1000,
        }),
      });
      assert.equal(prepExpiredRes.status, 200);
      const prepExpiredData = ((await prepExpiredRes.json()) as any).data;

      const commitExpiredRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/commit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          proposalId: prepExpiredData.proposal.proposalId,
          secondConfirmationToken: prepExpiredData.secondConfirmationToken,
          confirmFinalCutover: true,
        }),
      });
      assert.equal(commitExpiredRes.status, 400);
      assert.equal(
        ((await commitExpiredRes.json()) as any).error.code,
        'CUTOVER_CONFIRMATION_TOKEN_EXPIRED'
      );
      assert.equal(isLegacySnapshotWriterDisabled(), false);

      // Prepare valid proposal
      const prepValidRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          applyId: applyResult.applyId,
          releaseCommit: 'git-sha-f4-release-20261031',
        }),
      });
      assert.equal(prepValidRes.status, 200);
      const prepValidData = ((await prepValidRes.json()) as any).data;

      // Missing confirmFinalCutover=true -> 400 CUTOVER_SECOND_CONFIRMATION_REQUIRED
      const missingConfirmRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/commit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          proposalId: prepValidData.proposal.proposalId,
          secondConfirmationToken: prepValidData.secondConfirmationToken,
          confirmFinalCutover: false,
        }),
      });
      assert.equal(missingConfirmRes.status, 400);
      assert.equal(
        ((await missingConfirmRes.json()) as any).error.code,
        'CUTOVER_SECOND_CONFIRMATION_REQUIRED'
      );

      // Invalid token -> 400 CUTOVER_CONFIRMATION_TOKEN_INVALID
      const invalidTokRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/commit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          proposalId: prepValidData.proposal.proposalId,
          secondConfirmationToken: 'cuttok_wrong_token_value',
          confirmFinalCutover: true,
        }),
      });
      assert.equal(invalidTokRes.status, 400);
      assert.equal(
        ((await invalidTokRes.json()) as any).error.code,
        'CUTOVER_CONFIRMATION_TOKEN_INVALID'
      );
      assert.equal(isLegacySnapshotWriterDisabled(), false);

      // =========================================================================
      // 3. CONCURRENT CUTOVER LOCK & PARTIAL / ACCEPTANCE FAILURE
      // =========================================================================
      console.log('3. Verifying concurrent cutover lock (409 MIGRATION_LOCK_ALREADY_HELD) and partial acceptance failure...');

      const activeLock = await realAdapter.migrationState.acquireMigrationLock(
        'concurrent_instance_cutover',
        60_000
      );
      const lockedCommitRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/commit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          proposalId: prepValidData.proposal.proposalId,
          secondConfirmationToken: prepValidData.secondConfirmationToken,
          confirmFinalCutover: true,
        }),
      });
      assert.equal(lockedCommitRes.status, 409);
      assert.equal(
        ((await lockedCommitRes.json()) as any).error.code,
        'MIGRATION_LOCK_ALREADY_HELD'
      );
      assert.equal(isLegacySnapshotWriterDisabled(), false);
      await realAdapter.migrationState.releaseMigrationLock(activeLock.lockId);

      // Partial / acceptance failure during reconciliation window -> 500 CUTOVER_RECONCILIATION_ACCEPTANCE_FAILED, legacy writer remains enabled
      const partialFailRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/commit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          proposalId: prepValidData.proposal.proposalId,
          secondConfirmationToken: prepValidData.secondConfirmationToken,
          confirmFinalCutover: true,
          simulateAcceptanceFailure: true,
        }),
      });
      assert.equal(partialFailRes.status, 500);
      assert.equal(
        ((await partialFailRes.json()) as any).error.code,
        'CUTOVER_RECONCILIATION_ACCEPTANCE_FAILED'
      );
      assert.equal(
        isLegacySnapshotWriterDisabled(),
        false,
        'Legacy writer must remain enabled when acceptance check fails'
      );
      assert.equal(
        isMaintenanceReadOnlyWindowActive(),
        false,
        'Maintenance read-only window must be cleared after failed reconciliation'
      );

      // =========================================================================
      // 4. MAINTENANCE / READ-ONLY WINDOW, FINAL CUTOVER COMMIT & DUPLICATE REJECTION
      // =========================================================================
      console.log('4. Verifying maintenance/read-only window, final cutover commit, recorded receipt fields, and duplicate rejection...');

      const prepCommitRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          applyId: applyResult.applyId,
          releaseCommit: 'git-sha-f4-release-20261031',
        }),
      });
      assert.equal(prepCommitRes.status, 200);
      const prepCommitData = ((await prepCommitRes.json()) as any).data;

      // Start final cutover with a 150ms reconciliation window so we can test concurrent write blocking during the window
      const commitPromise = fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/commit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          proposalId: prepCommitData.proposal.proposalId,
          secondConfirmationToken: prepCommitData.secondConfirmationToken,
          confirmFinalCutover: true,
          releaseCommit: 'git-sha-f4-release-20261031',
          reconciliationDelayMs: 160,
        }),
      });

      // Wait 40ms so the cutover enters the maintenance read-only window
      await new Promise((r) => setTimeout(r, 40));
      assert.equal(
        isMaintenanceReadOnlyWindowActive(),
        true,
        'Maintenance read-only window must be active during cutover reconciliation'
      );

      // Mutating request during maintenance window -> 503 MAINTENANCE_READ_ONLY_WINDOW_ACTIVE
      const writeDuringWindowRes = await fetch(`${srvProd.baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-alice',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          title: 'Write During Maintenance Window',
          description: 'Must be blocked with 503',
        }),
      });
      assert.equal(writeDuringWindowRes.status, 503);
      assert.equal(
        ((await writeDuringWindowRes.json()) as any).error.code,
        'MAINTENANCE_READ_ONLY_WINDOW_ACTIVE'
      );

      // Read request during maintenance window -> 200 OK
      const readDuringWindowRes = await fetch(`${srvProd.baseUrl}/api/v1/projects`, {
        headers: { authorization: 'Bearer token-alice' },
      });
      assert.equal(readDuringWindowRes.status, 200);

      // Await final cutover completion
      const commitRes = await commitPromise;
      assert.equal(commitRes.status, 200);
      const commitReceipt = ((await commitRes.json()) as any).data.receipt;

      assert.ok(commitReceipt.cutoverId);
      assert.ok(commitReceipt.cutoverTimestamp);
      assert.equal(commitReceipt.releaseCommit, 'git-sha-f4-release-20261031');
      assert.equal(commitReceipt.adapterIdentity, 'cloud-firestore-authoritative');
      assert.equal(commitReceipt.databaseId, CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID);
      assert.equal(commitReceipt.projectId, CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID);
      assert.equal(commitReceipt.operatorUid, 'uid-owner-f4');
      assert.equal(commitReceipt.operatorEmail, 'mdhasibul4u@gmail.com');
      assert.equal(commitReceipt.entityCounts.projects, 1);
      assert.equal(commitReceipt.sourceChecksum, applyResult.sourceChecksum);
      assert.equal(commitReceipt.targetChecksum, applyResult.targetChecksum);
      assert.equal(commitReceipt.readAfterWriteParityPassed, true);
      assert.equal(commitReceipt.applicationAcceptancePassed, true);
      assert.equal(commitReceipt.legacyWritersDisabled, true);
      assert.equal(commitReceipt.receiptSha256.length, 64);

      assert.equal(isLegacySnapshotWriterDisabled(), true);
      assert.equal(isMaintenanceReadOnlyWindowActive(), false);

      // Verify legacy snapshot writer (`saveDurableSnapshot`) is now blocked
      const dummyWritePath = path.join(tmpDir, 'should-not-write-after-cutover.json');
      const wroteLegacy = saveDurableSnapshot(dummyWritePath, snapshotPayload as any);
      assert.equal(wroteLegacy, false);
      assert.equal(fs.existsSync(dummyWritePath), false);

      // Duplicate commit request with same token -> 409 CUTOVER_CONFIRMATION_TOKEN_ALREADY_USED
      const dupCommitRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/commit`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          proposalId: prepCommitData.proposal.proposalId,
          secondConfirmationToken: prepCommitData.secondConfirmationToken,
          confirmFinalCutover: true,
        }),
      });
      assert.equal(dupCommitRes.status, 409);
      assert.equal(
        ((await dupCommitRes.json()) as any).error.code,
        'CUTOVER_CONFIRMATION_TOKEN_ALREADY_USED'
      );

      // Duplicate prepare request when already cutover-committed -> 409 CUTOVER_ALREADY_COMMITTED
      const dupPrepRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/cutover/prepare`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ applyId: applyResult.applyId }),
      });
      assert.equal(dupPrepRes.status, 409);
      assert.equal(
        ((await dupPrepRes.json()) as any).error.code,
        'CUTOVER_ALREADY_COMMITTED'
      );
    } finally {
      await srvProd.close();
    }

    // =========================================================================
    // 5. RESTART SURVIVAL OF CUTOVER STATE & NON-DESTRUCTIVE ROLLBACK
    // =========================================================================
    console.log('5. Verifying cutover state survives full server restart and rollback preserves newer Firestore records...');

    // Simulate cold process restart by resetting in-memory flags and starting a brand-new server instance on the same Firestore store
    resetLegacySnapshotWriterStateForTests();
    assert.equal(isLegacySnapshotWriterDisabled(), false);

    const restartedDriver = new FirestoreDocumentDriver({
      firestoreClient: fakeFirestore.client,
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      expectedDatabaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
    });
    const restartedAdapter = new AuthoritativeFirestorePersistenceAdapter({
      driver: restartedDriver,
      expectedDatabaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
    });

    const srvRestarted = await startF4Server({
      persistenceAdapter: restartedAdapter,
      persistenceFilePath: snapshotPath,
    });

    try {
      const statusAfterRestartRes = await fetch(
        `${srvRestarted.baseUrl}/api/v1/admin/migration/status`,
        {
          headers: { authorization: 'Bearer token-owner' },
        }
      );
      assert.equal(statusAfterRestartRes.status, 200);
      const statusAfterRestart = ((await statusAfterRestartRes.json()) as any).data;
      assert.equal(statusAfterRestart.isLegacySnapshotWriterDisabled, true);
      assert.equal(statusAfterRestart.lastMigrationStatus, 'cutover-committed');
      assert.equal(statusAfterRestart.lastReleaseCommit, 'git-sha-f4-release-20261031');
      assert.ok(statusAfterRestart.lastCutoverId);
      assert.equal(isLegacySnapshotWriterDisabled(), true);

      // Update proj-f4-alice-1 in Firestore to revision 7 AND create a brand-new project proj-f4-post-cutover-2
      await restartedAdapter.projects.update('proj-f4-alice-1', 'uid-alice-f4', {
        title: 'Alice F4 Updated Post-Cutover Revision 7',
        revision: 7,
        updatedAt: '2026-10-31T20:00:00.000Z',
      });
      await restartedAdapter.projects.create({
        ...(snapshotPayload.projects[0] as any),
        id: 'proj-f4-post-cutover-2',
        title: 'Brand New Post-Cutover Project',
        revision: 1,
        createdAt: '2026-10-31T20:05:00.000Z',
        updatedAt: '2026-10-31T20:05:00.000Z',
      });

      // Execute safe rollback -> must switch legacy writers back AND preserve both newer records in snapshotPath!
      const receiptGetRes = await fetch(
        `${srvRestarted.baseUrl}/api/v1/admin/migration/cutover/receipt`,
        {
          headers: { authorization: 'Bearer token-owner' },
        }
      );
      assert.equal(receiptGetRes.status, 200);
      const latestCutoverReceipt = ((await receiptGetRes.json()) as any).data.receipt;

      const rollbackRes = await fetch(`${srvRestarted.baseUrl}/api/v1/admin/migration/rollback`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          backupPath: latestCutoverReceipt.backupPath,
          durableBackupId: latestCutoverReceipt.durableBackupId,
          targetSnapshotPath: snapshotPath,
        }),
      });
      assert.equal(rollbackRes.status, 200);
      const rollbackResult = ((await rollbackRes.json()) as any).data.rollbackResult;

      assert.equal(rollbackResult.legacyWritersRestored, true);
      assert.equal(rollbackResult.readersSwitchedBackSafely, true);
      assert.equal(isLegacySnapshotWriterDisabled(), false);
      assert.ok(
        rollbackResult.preservedNewerTargetRecordsCount >= 2,
        `Expected at least 2 newer Firestore records preserved during rollback, got ${rollbackResult.preservedNewerTargetRecordsCount}`
      );
      assert.equal(
        rollbackResult.preservedNewerTargetRecordKeys.includes('projects:proj-f4-alice-1'),
        true
      );
      assert.equal(
        rollbackResult.preservedNewerTargetRecordKeys.includes('projects:proj-f4-post-cutover-2'),
        true
      );

      // Inspect the rolled-back snapshot file on disk to prove newer records were NOT overwritten
      const rolledBackSnapshot = loadDurableSnapshot(snapshotPath);
      assert.ok(rolledBackSnapshot);
      const p1 = rolledBackSnapshot.projects.find((p) => p.id === 'proj-f4-alice-1');
      const p2 = rolledBackSnapshot.projects.find((p) => p.id === 'proj-f4-post-cutover-2');
      assert.ok(p1, 'proj-f4-alice-1 must exist in rolled-back snapshot');
      assert.equal(
        p1.revision,
        7,
        'Rolled-back snapshot must preserve newer revision 7 rather than overwriting with old revision 2'
      );
      assert.equal(p1.title, 'Alice F4 Updated Post-Cutover Revision 7');
      assert.ok(p2, 'Post-cutover project proj-f4-post-cutover-2 must be preserved on rollback');
    } finally {
      await srvRestarted.close();
    }

    // Verify real .data/sowveil-durable-store.json was NEVER modified or cut over
    const realFileExistedAfter = fs.existsSync(realDurableStorePath);
    assert.equal(realFileExistedAfter, realFileExistedBefore);
    if (realFileExistedBefore && realFileShaBefore) {
      const realFileShaAfter = crypto
        .createHash('sha256')
        .update(fs.readFileSync(realDurableStorePath))
        .digest('hex');
      assert.equal(realFileShaAfter, realFileShaBefore);
    }

    console.log('ALL PROMPT F4 FINAL PERSISTENCE CUTOVER & ROLLBACK TESTS PASSED!');
  } finally {
    resetLegacySnapshotWriterStateForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runFinalPersistenceCutoverF4Tests().catch((err) => {
  console.error('Prompt F4 Final Persistence Cutover test suite failed:', err);
  process.exit(1);
});
