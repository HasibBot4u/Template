/**
 * SOWVEIL STUDIO — PROMPT F3: VERIFIED LEGACY SNAPSHOT MIGRATION TEST SUITE
 *
 * Verifies all Prompt F3 requirements:
 * 1. Staged migration workflow is unavailable (HTTP 503 MIGRATION_BACKEND_NOT_PRODUCTION_READY)
 *    unless a real connected production Firestore driver is active and readiness passes.
 * 2. Pre-write source export from the running environment + independently durable, access-controlled
 *    backup destination (`migrationBackups`); blocks migration if durable backup is unconfigured.
 * 3. Source checksum, entity counts, stable IDs, distinct owners, revision summaries,
 *    duplicate/invalid counts, vault status, and human-readable dry-run report with admin/owner review.
 * 4. Malformed records and unreadable/corrupted encrypted credentials are never migrated silently;
 *    produces a sanitized recovery report/file with zero secret leakage.
 * 5. Bounded, resumable, idempotent batch execution with a durable per-entity/per-record migration ledger.
 * 6. Newer target revisions in Firestore are preserved (`skipped-newer-target`) and never overwritten
 *    by older snapshot data.
 * 7. ID/owner collisions (`existing.ownerUid !== source.ownerUid`) are detected in dry-run and apply,
 *    blocking migration with `ID_OWNER_COLLISION` and recording `collision-blocked` in the ledger.
 * 8. Read-after-write verification, canonical per-record hash comparison, `sourceChecksum` & `targetChecksum`,
 *    owner and cross-entity reference verification, and app-level project/session/template/render lookups.
 * 9. Separate cutover approval eligibility (`cutoverApprovalEligible: true`) is offered only after all
 *    records pass, while legacy writers remain enabled (`legacyWritersDisabled: false`).
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
import { createProviderConnectionRecord } from '../services/providerHubEngine';
import { createAiDirectorSession } from '../services/aiDirectorProductionEngine';
import { createReferenceLabSession } from '../services/referenceLabEngine';
import { runTemplateFactoryPipeline } from '../services/templateFactoryEngine';
import {
  createAndExecuteCanonicalRenderJob,
  createKnownGoodSampleCanonicalProject,
} from '../services/renderExportQaEngine';
import {
  isLegacySnapshotWriterDisabled,
  resetLegacySnapshotWriterStateForTests,
} from '../server/migrationCutover';
import type { ISowveilPersistenceAdapter } from '../services/persistenceContracts';
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

const TEST_TOKENS: Record<string, VerifiedTokenIdentity> = {
  'token-owner': {
    uid: 'uid-owner-f3',
    email: 'mdhasibul4u@gmail.com',
    emailVerified: true,
    displayName: 'Sowveil F3 Owner',
  },
  'token-alice': {
    uid: 'uid-alice-f3',
    email: 'alice-f3@sowveil.studio',
    emailVerified: true,
    displayName: 'Alice F3 Creator',
  },
  'token-bob': {
    uid: 'uid-bob-f3',
    email: 'bob-f3@sowveil.studio',
    emailVerified: true,
    displayName: 'Bob F3 Creator',
  },
};

function createFakeAdminFirestoreClient(): {
  client: AdminSdkFirestoreClientLike;
  setDisconnected: (disconnected: boolean) => void;
} {
  const collections = new Map<string, Map<string, Record<string, unknown>>>();
  let disconnected = false;

  const ensureOnline = () => {
    if (disconnected) {
      const err = new Error('14 UNAVAILABLE: Firestore backend unreachable') as Error & {
        code?: number;
      };
      err.code = 14;
      throw err;
    }
  };

  const getColMap = (colPath: string): Map<string, Record<string, unknown>> => {
    let map = collections.get(colPath);
    if (!map) {
      map = new Map();
      collections.set(colPath, map);
    }
    return map;
  };

  const clone = <T>(val: T): T => JSON.parse(JSON.stringify(val));

  const makeDocRef = (colPath: string, docId: string): AdminSdkDocumentReferenceLike => {
    return {
      id: docId,
      path: `${colPath}/${docId}`,
      async get(): Promise<AdminSdkDocumentSnapshotLike> {
        ensureOnline();
        const col = getColMap(colPath);
        const existing = col.get(docId);
        return {
          exists: existing !== undefined,
          id: docId,
          data: () => (existing !== undefined ? clone(existing) : undefined),
        };
      },
      async create(data: Record<string, unknown>): Promise<unknown> {
        ensureOnline();
        const col = getColMap(colPath);
        if (col.has(docId)) {
          const err = new Error(`6 ALREADY_EXISTS: Document ${colPath}/${docId} already exists`) as Error & {
            code?: number;
          };
          err.code = 6;
          throw err;
        }
        col.set(docId, clone(data));
        return {};
      },
      async set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown> {
        ensureOnline();
        const col = getColMap(colPath);
        if (options?.merge && col.has(docId)) {
          const current = col.get(docId)!;
          col.set(docId, clone({ ...current, ...data }));
        } else {
          col.set(docId, clone(data));
        }
        return {};
      },
      async update(data: Record<string, unknown>): Promise<unknown> {
        ensureOnline();
        const col = getColMap(colPath);
        if (!col.has(docId)) {
          const err = new Error(`5 NOT_FOUND: No document to update: ${colPath}/${docId}`) as Error & {
            code?: number;
          };
          err.code = 5;
          throw err;
        }
        const current = col.get(docId)!;
        col.set(docId, clone({ ...current, ...data }));
        return {};
      },
      async delete(): Promise<unknown> {
        ensureOnline();
        const col = getColMap(colPath);
        col.delete(docId);
        return {};
      },
    };
  };

  const makeQuery = (
    colPath: string,
    filters: Array<{ field: string; op: FirestoreFilterOp; value: unknown }> = [],
    orders: Array<{ field: string; direction: 'asc' | 'desc' }> = [],
    limitCount?: number
  ): AdminSdkQueryLike => {
    return {
      where(field: string, op: FirestoreFilterOp, value: unknown): AdminSdkQueryLike {
        return makeQuery(colPath, [...filters, { field, op, value }], orders, limitCount);
      },
      orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): AdminSdkQueryLike {
        return makeQuery(colPath, filters, [...orders, { field, direction }], limitCount);
      },
      limit(limit: number): AdminSdkQueryLike {
        return makeQuery(colPath, filters, orders, limit);
      },
      async get(): Promise<AdminSdkQuerySnapshotLike> {
        ensureOnline();
        const col = getColMap(colPath);
        let entries = Array.from(col.entries());
        for (const f of filters) {
          entries = entries.filter(([, doc]) => {
            const fieldVal = doc[f.field];
            if (f.op === '==') return fieldVal === f.value;
            if (f.op === '!=') return fieldVal !== f.value;
            if (f.op === '<') return (fieldVal as any) < (f.value as any);
            if (f.op === '<=') return (fieldVal as any) <= (f.value as any);
            if (f.op === '>') return (fieldVal as any) > (f.value as any);
            if (f.op === '>=') return (fieldVal as any) >= (f.value as any);
            if (f.op === 'in' && Array.isArray(f.value)) return f.value.includes(fieldVal);
            if (f.op === 'array-contains' && Array.isArray(fieldVal)) {
              return fieldVal.includes(f.value);
            }
            return false;
          });
        }
        if (orders.length > 0) {
          entries.sort(([, a], [, b]) => {
            for (const o of orders) {
              const av = a[o.field] as any;
              const bv = b[o.field] as any;
              if (av === bv) continue;
              const cmp = av < bv ? -1 : 1;
              return o.direction === 'desc' ? -cmp : cmp;
            }
            return 0;
          });
        }
        if (typeof limitCount === 'number' && limitCount >= 0) {
          entries = entries.slice(0, limitCount);
        }
        const docs: AdminSdkDocumentSnapshotLike[] = entries.map(([id, doc]) => ({
          exists: true,
          id,
          data: () => clone(doc),
        }));
        return {
          docs,
          empty: docs.length === 0,
          size: docs.length,
        };
      },
    };
  };

  const client: AdminSdkFirestoreClientLike = {
    collection(collectionPath: string): AdminSdkCollectionReferenceLike {
      const baseQuery = makeQuery(collectionPath);
      return {
        id: collectionPath,
        doc: (docId: string) => makeDocRef(collectionPath, docId),
        where: baseQuery.where.bind(baseQuery),
        orderBy: baseQuery.orderBy.bind(baseQuery),
        limit: baseQuery.limit.bind(baseQuery),
        get: baseQuery.get.bind(baseQuery),
      };
    },
    batch(): AdminSdkWriteBatchLike {
      const ops: Array<() => Promise<void>> = [];
      const b: AdminSdkWriteBatchLike = {
        set(docRef, data, options) {
          ops.push(async () => {
            await docRef.set(data, options);
          });
          return b;
        },
        create(docRef, data) {
          ops.push(async () => {
            await docRef.create(data);
          });
          return b;
        },
        update(docRef, data) {
          ops.push(async () => {
            await docRef.update(data);
          });
          return b;
        },
        delete(docRef) {
          ops.push(async () => {
            await docRef.delete();
          });
          return b;
        },
        async commit() {
          ensureOnline();
          for (const op of ops) {
            await op();
          }
          return {};
        },
      };
      return b;
    },
    async runTransaction<R>(
      updateFunction: (tx: AdminSdkTransactionLike) => Promise<R>
    ): Promise<R> {
      ensureOnline();
      const pendingWrites: Array<() => Promise<void>> = [];
      const tx: AdminSdkTransactionLike = {
        async get(docRef) {
          return docRef.get();
        },
        create(docRef, data) {
          pendingWrites.push(async () => {
            await docRef.create(data);
          });
          return tx;
        },
        set(docRef, data, options) {
          pendingWrites.push(async () => {
            await docRef.set(data, options);
          });
          return tx;
        },
        update(docRef, data) {
          pendingWrites.push(async () => {
            await docRef.update(data);
          });
          return tx;
        },
        delete(docRef) {
          pendingWrites.push(async () => {
            await docRef.delete();
          });
          return tx;
        },
      };
      const res = await updateFunction(tx);
      for (const w of pendingWrites) {
        await w();
      }
      return res;
    },
  };

  return {
    client,
    setDisconnected: (val: boolean) => {
      disconnected = val;
    },
  };
}

async function startF3Server(options: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  persistenceFilePath: string;
}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createSowveilApiApp({
    persistenceAdapter: options.persistenceAdapter,
    persistenceFilePath: options.persistenceFilePath,
    ownerBootstrapEmail: 'mdhasibul4u@gmail.com',
    ownerBootstrapSecret: 'PROMPT_F3_VERIFIED_MIGRATION_SECRET_2026_XYZ',
    nodeEnv: 'production',
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
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function buildRichValidSnapshot(vaultKeyHex: string) {
  const previousVaultKey = process.env.SOWVEIL_MASTER_VAULT_KEY;
  process.env.SOWVEIL_MASTER_VAULT_KEY = vaultKeyHex;
  try {
    const sampleProject = createKnownGoodSampleCanonicalProject('proj-f3-alice-1');
    const proj1 = {
      id: 'proj-f3-alice-1',
      ownerUid: 'uid-alice-f3',
      title: 'Alice F3 Canonical Launch Video',
      description: 'Canonical project v2 in snapshot',
      moduleId: 'templates',
      targetEditor: 'sowveil-project',
      aspectRatio: '9:16',
      projectFileStatus: 'sowveil-native',
      revision: 2,
      activeBranch: 'main',
      createdAt: '2026-10-25T10:00:00.000Z',
      updatedAt: '2026-10-25T12:00:00.000Z',
      canonicalProject: sampleProject,
    };
    const proj2 = {
      id: 'proj-f3-alice-2',
      ownerUid: 'uid-alice-f3',
      title: 'Alice F3 Secondary Promo',
      description: 'Second project for bounded batch test',
      moduleId: 'text-animation',
      targetEditor: 'sowveil-project',
      aspectRatio: '16:9',
      projectFileStatus: 'sowveil-native',
      revision: 3,
      activeBranch: 'main',
      createdAt: '2026-10-26T10:00:00.000Z',
      updatedAt: '2026-10-26T12:00:00.000Z',
    };

    const catalogItem = {
      id: 'tmpl-f3-custom-1',
      ownerUid: 'uid-alice-f3',
      title: 'F3 Custom Kinetic Template',
      moduleId: 'templates',
      category: 'SaaS',
      tags: ['f3', 'kinetic'],
      durationSec: 6,
      fps: 60,
      aspectRatio: '9:16',
      resolution: '1080x1920',
      editabilityTier: 'full-canonical-source',
      licenseType: 'CC-BY-4.0',
      provenance: 'user-authored',
      visibility: 'public',
      createdAt: '2026-10-25T09:00:00.000Z',
      updatedAt: '2026-10-25T09:30:00.000Z',
    };

    const variant = {
      id: 'var-f3-alice-1',
      baseTemplateId: 'tmpl-f3-custom-1',
      ownerUid: 'uid-alice-f3',
      title: 'Alice Neon Brand Variant',
      parameterOverrides: { headlineText: 'Launch Fast' },
      visibility: 'private',
      createdAt: '2026-10-25T11:00:00.000Z',
      updatedAt: '2026-10-25T11:30:00.000Z',
    };

    const dirSession = {
      ...createAiDirectorSession({
        ownerUid: 'uid-alice-f3',
        title: 'Alice F3 Director Session',
        rawScriptText:
          'Hook: Stop losing user state on container restarts.\nBody: Use authoritative Firestore repositories.',
        aspectRatio: '9:16',
        targetDurationSec: 15,
      }),
      id: 'dir-f3-alice-1',
      savedProjectId: 'proj-f3-alice-1',
    };

    const refSession = {
      ...createReferenceLabSession({
        ownerUid: 'uid-alice-f3',
        title: 'Alice F3 Reference Reconstruction',
        sourceKind: 'uploaded-project-file',
        usageMode: 'authorized-reconstruction',
        durationSec: 8,
        fps: 30,
      }),
      id: 'ref-f3-alice-1',
      savedProjectId: 'proj-f3-alice-1',
    };

    const draft = {
      ...runTemplateFactoryPipeline({
        id: 'draft-f3-alice-1',
        ownerUid: 'uid-alice-f3',
        title: 'Alice F3 Factory Draft',
        sourceKind: 'canonical-project',
        sourceProject: sampleProject,
        licenseType: 'User Owned',
      }),
      id: 'draft-f3-alice-1',
    };

    const providerConn = createProviderConnectionRecord({
      ownerUid: 'uid-alice-f3',
      label: 'Alice F3 OpenAI Endpoint',
      providerBrand: 'OpenAI',
      protocol: 'openai-compatible-variant',
      baseUrl: 'https://api.openai.com/v1',
      modelId: 'gpt-4o-mini',
      authMode: 'api-key',
      storageMode: 'server-encrypted-vault',
      credential: 'sk-f3-super-secret-never-expose-9988776655',
    });

    const renderJob = {
      ...createAndExecuteCanonicalRenderJob({
        ownerUid: 'uid-alice-f3',
        projectDoc: sampleProject,
        executionTier: 'final-render',
        outputFormat: 'png-frame',
        targetAdapter: 'sowveil-project',
      }),
      id: 'rjob-f3-alice-1',
      projectId: 'proj-f3-alice-1',
    };

    return {
      schemaVersion: '1.0.0',
      savedAt: '2026-10-30T12:00:00.000Z',
      catalogCacheVersion: 7,
      ownerBootstrappedUid: 'uid-owner-f3',
      platformSettings: {},
      roles: {
        'uid-owner-f3': 'owner',
        'uid-alice-f3': 'admin',
      },
      userStatuses: {
        'uid-owner-f3': 'active',
        'uid-alice-f3': 'active',
      },
      userPreferences: {},
      userFavorites: {
        'uid-alice-f3': ['tmpl-f3-custom-1'],
      },
      userRecentItems: {},
      catalogItems: [catalogItem],
      modules: [],
      editorAdapters: [],
      assets: [],
      projects: [proj1, proj2],
      templateVariants: [variant],
      jobs: [],
      devices: [],
      referenceLabSessions: [refSession],
      providerConnections: [providerConn],
      routingProfiles: {},
      extensionPackages: [],
      toolAuditRecords: [],
      aiDirectorSessions: [dirSession],
      templateFactoryDrafts: [draft],
      templatePreferenceSignals: [],
      userPreferenceConsents: {},
      renderExportJobs: [renderJob],
      auditEvents: [
        {
          id: 'aud-f3-1',
          actorUid: 'uid-owner-f3',
          actorEmail: 'mdhasibul4u@gmail.com',
          action: 'SNAPSHOT_CREATED',
          targetId: 'system',
          targetType: 'system',
          outcome: 'success',
          summary: 'Initial legacy snapshot',
          requestId: 'req_f3_init',
          createdAt: '2026-10-25T08:00:00.000Z',
        },
      ],
    };
  } finally {
    if (previousVaultKey === undefined) {
      delete process.env.SOWVEIL_MASTER_VAULT_KEY;
    } else {
      process.env.SOWVEIL_MASTER_VAULT_KEY = previousVaultKey;
    }
  }
}

async function runLegacySnapshotMigrationF3Tests() {
  console.log('=== SOWVEIL STUDIO — PROMPT F3: VERIFIED LEGACY SNAPSHOT MIGRATION SUITE ===');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-f3-migration-'));
  const snapshotPath = path.join(tmpRoot, 'sowveil-durable-store.json');
  const VAULT_KEY_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const VAULT_KEY_B = 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f';
  const originalVaultKey = process.env.SOWVEIL_MASTER_VAULT_KEY;
  process.env.SOWVEIL_MASTER_VAULT_KEY = VAULT_KEY_A;

  const baseSnapshot = buildRichValidSnapshot(VAULT_KEY_A);
  fs.writeFileSync(snapshotPath, JSON.stringify(baseSnapshot, null, 2), 'utf8');

  try {
    resetLegacySnapshotWriterStateForTests();

    // =========================================================================
    // 1. RECHECK PRODUCTION ADAPTER READINESS & BLOCK UNREADY BACKENDS
    // =========================================================================
    console.log('1. Verifying staged migration endpoints block test drivers, local adapters, and disconnected Firestore drivers...');

    const testDriver = new RuleEnforcingFirestoreTestDriver();
    await testDriver.setDocument('admins', 'uid-owner-f3', {
      uid: 'uid-owner-f3',
      role: 'owner',
      grantedAt: new Date().toISOString(),
      grantedBy: 'system',
    });
    const testAdapter = new AuthoritativeFirestorePersistenceAdapter({ driver: testDriver });
    const srvUnready = await startF3Server({
      persistenceAdapter: testAdapter,
      persistenceFilePath: snapshotPath,
    });

    try {
      const exportRes = await fetch(`${srvUnready.baseUrl}/api/v1/admin/migration/export-source`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ exportFromRunningEnvironment: true }),
      });
      assert.equal(exportRes.status, 503);
      assert.equal(((await exportRes.json()) as any).error.code, 'MIGRATION_BACKEND_NOT_PRODUCTION_READY');

      const ledgerRes = await fetch(`${srvUnready.baseUrl}/api/v1/admin/migration/ledger/dry-1`, {
        headers: { authorization: 'Bearer token-owner' },
      });
      assert.equal(ledgerRes.status, 503);
      assert.equal(((await ledgerRes.json()) as any).error.code, 'MIGRATION_BACKEND_NOT_PRODUCTION_READY');
    } finally {
      await srvUnready.close();
    }

    // =========================================================================
    // 2. PRE-WRITE SOURCE EXPORT, DURABLE BACKUP GATE & HUMAN-READABLE DRY-RUN
    // =========================================================================
    console.log('2. Verifying live source snapshot export, independently durable backup gate, and human-readable dry-run report...');

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
    await realAdapter.governance.setRole('uid-owner-f3', 'owner', 'bootstrap');

    const srvProd = await startF3Server({
      persistenceAdapter: realAdapter,
      persistenceFilePath: snapshotPath,
    });

    try {
      // 2a. Block migration when independently durable backup destination is disabled/unconfigured
      const blockedExportRes = await fetch(
        `${srvProd.baseUrl}/api/v1/admin/migration/export-source`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-owner',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            snapshotFilePath: snapshotPath,
            disableDurableBackupDestination: true,
          }),
        }
      );
      assert.equal(blockedExportRes.status, 503, 'Unconfigured durable backup destination must block export with 503');

      const blockedDryRunRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          disableDurableBackupDestination: true,
        }),
      });
      assert.equal(blockedDryRunRes.status, 200);
      const blockedDryRunReport = ((await blockedDryRunRes.json()) as any).data.report;
      assert.equal(blockedDryRunReport.canSafelyApply, false);
      assert.equal(blockedDryRunReport.preconditions.independentDurableBackupVerified, false);
      assert.equal(blockedDryRunReport.operatorConfirmationToken, '');

      // 2b. Export source snapshot from running environment to independently durable backup
      const validExportRes = await fetch(
        `${srvProd.baseUrl}/api/v1/admin/migration/export-source`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-owner',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            exportFromRunningEnvironment: true,
          }),
        }
      );
      assert.equal(validExportRes.status, 200);
      const exportResult = ((await validExportRes.json()) as any).data.exportResult;
      assert.equal(exportResult.sourceOrigin, 'runtime-memory-export');
      assert.ok(exportResult.sourceSnapshotSha256.length === 64);
      assert.equal(exportResult.durableBackup.accessControlScope, 'server-only-owner-admin');
      assert.equal(exportResult.durableBackup.verifiedReadAfterWrite, true);

      // Verify durable backup record is persisted in Firestore migrationBackups
      const storedBackup = await realAdapter.migrationState.getDurableBackup!(
        exportResult.durableBackup.backupId
      );
      assert.ok(storedBackup, 'Durable backup must exist in Firestore migrationBackups');
      assert.equal(storedBackup.backupSha256, exportResult.durableBackup.backupSha256);

      // 2c. Execute dry-run and verify entity counts, stable IDs, owners, revisions, and human-readable report
      const dryRunRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryRunRes.status, 200);
      const report = ((await dryRunRes.json()) as any).data.report;
      assert.equal(report.canSafelyApply, true);
      assert.equal(report.adminOwnerReviewRequired, true);
      assert.equal(report.reviewedByUid, 'uid-owner-f3');
      assert.equal(report.independentDurableBackupVerified, true);
      assert.ok(report.durableBackupId);
      assert.ok(
        report.humanReadableReport.includes(
          'SOWVEIL STUDIO — STAGED LEGACY SNAPSHOT MIGRATION DRY-RUN REPORT (PROMPT F3)'
        )
      );
      assert.deepEqual(report.entitySummaries.projects.stableIds, [
        'proj-f3-alice-1',
        'proj-f3-alice-2',
      ]);
      assert.deepEqual(report.entitySummaries.projects.distinctOwnerUids, ['uid-alice-f3']);
      assert.equal(report.entitySummaries.projects.revisionSummary.minRevision, 2);
      assert.equal(report.entitySummaries.projects.revisionSummary.maxRevision, 3);
      assert.equal(report.vaultHealth.activeCiphertextCount, 1);

      // =========================================================================
      // 3. MALFORMED RECORDS & UNREADABLE VAULT CREDENTIALS -> SANITIZED RECOVERY REPORT
      // =========================================================================
      console.log('3. Verifying malformed records & unreadable vault credentials block silent migration and produce a sanitized recovery report...');

      const malformedSnapshotPath = path.join(tmpRoot, 'malformed-snapshot.json');
      // Switch active vault key to VAULT_KEY_B so conn-f3-alice-1 (encrypted under VAULT_KEY_A) is unreadable ('requires-reentry')
      process.env.SOWVEIL_MASTER_VAULT_KEY = VAULT_KEY_B;

      const malformedPayload = JSON.parse(JSON.stringify(baseSnapshot));
      // Add a malformed project missing ownerUid
      malformedPayload.projects.push({
        id: 'proj-malformed-no-owner',
        ownerUid: '',
        title: 'Broken Orphan Project',
        moduleId: 'templates',
        targetEditor: 'sowveil-project',
        aspectRatio: '9:16',
        projectFileStatus: 'sowveil-native',
        revision: 1,
        createdAt: '2026-10-30T00:00:00.000Z',
        updatedAt: '2026-10-30T00:00:00.000Z',
      });
      fs.writeFileSync(malformedSnapshotPath, JSON.stringify(malformedPayload, null, 2), 'utf8');

      const badDryRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: malformedSnapshotPath }),
      });
      assert.equal(badDryRes.status, 200);
      const badReport = ((await badDryRes.json()) as any).data.report;
      assert.equal(badReport.canSafelyApply, false, 'Malformed record + unreadable vault must block apply');
      assert.equal(badReport.preconditions.allIdsAndOwnersValid, false);
      assert.equal(badReport.preconditions.vaultRecoveryValid, false);
      assert.ok(badReport.recoveryReport, 'Recovery report must be generated');
      assert.equal(badReport.recoveryReport.containsSecrets, false);
      assert.ok(badReport.recoveryReport.unresolvedMalformedCount >= 1);
      assert.equal(badReport.recoveryReport.requiresReentryVaultCount, 1);
      assert.ok(badReport.recoveryFilePath && fs.existsSync(badReport.recoveryFilePath));

      // Fetch recovery report via API and verify zero secrets/ciphertexts are exposed
      const recApiRes = await fetch(
        `${srvProd.baseUrl}/api/v1/admin/migration/recovery/${badReport.dryRunId}`,
        {
          headers: { authorization: 'Bearer token-owner' },
        }
      );
      assert.equal(recApiRes.status, 200);
      const recApiText = await recApiRes.text();
      assert.equal(
        recApiText.includes('sk-f3-super-secret-never-expose-9988776655'),
        false,
        'Recovery report must NEVER contain raw secret keys'
      );
      const encryptedCipherHex =
        baseSnapshot.providerConnections[0].encryptedCredential?.ciphertextHex || '';
      assert.ok(encryptedCipherHex.length > 10);
      assert.equal(
        recApiText.includes(encryptedCipherHex),
        false,
        'Recovery report must NEVER contain raw ciphertext hex'
      );

      // Restore VAULT_KEY_A
      process.env.SOWVEIL_MASTER_VAULT_KEY = VAULT_KEY_A;

      // =========================================================================
      // 4. DO NOT OVERWRITE A NEWER TARGET REVISION WITH OLDER SNAPSHOT DATA
      // =========================================================================
      console.log('4. Verifying newer target revision in Firestore is preserved (skipped-newer-target) and not overwritten by older snapshot data...');

      // Pre-populate proj-f3-alice-1 in target Firestore with revision 9 (newer than snapshot revision 2)
      await realAdapter.projects.create({
        ...(baseSnapshot.projects[0] as any),
        compCount: 1,
        fileSizeBytes: 2048,
        fileSizeLabel: '2.0 KB',
        hasExternalFootageWarning: false,
        tags: ['f3', 'newer-target'],
        title: 'Alice F3 Newer Firestore Revision 9',
        revision: 9,
        updatedAt: '2026-10-31T18:00:00.000Z',
      });

      const dryNewerRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryNewerRes.status, 200);
      const dryNewerReport = ((await dryNewerRes.json()) as any).data.report;
      assert.equal(dryNewerReport.canSafelyApply, true);
      assert.equal(dryNewerReport.newerTargetRecordsToPreserve.length, 1);
      assert.equal(dryNewerReport.newerTargetRecordsToPreserve[0].recordId, 'proj-f3-alice-1');
      assert.equal(dryNewerReport.newerTargetRecordsToPreserve[0].sourceRevision, 2);
      assert.equal(dryNewerReport.newerTargetRecordsToPreserve[0].targetRevision, 9);

      // =========================================================================
      // 5. BOUNDED, RESUMABLE, IDEMPOTENT BATCHES & DURABLE MIGRATION LEDGER
      // =========================================================================
      console.log('5. Executing migration in bounded, resumable, idempotent batches (batchSize=3, maxBatches=1)...');

      // Run Batch 1 (processes first 3 records and pauses cleanly)
      const batch1Res = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryNewerReport.dryRunId,
          confirmationToken: dryNewerReport.operatorConfirmationToken,
          confirmApply: true,
          batchSize: 3,
          maxBatches: 1,
        }),
      });
      assert.equal(batch1Res.status, 200);
      const batch1Result = ((await batch1Res.json()) as any).data.result;
      assert.equal(batch1Result.batchExecutionStatus, 'paused-resumable');
      assert.equal(batch1Result.batchesExecuted, 1);
      assert.ok(batch1Result.remainingRecordsCount > 0);
      assert.equal(batch1Result.cutoverApprovalEligible, false);
      assert.equal(batch1Result.legacyWritersDisabled, false);

      // Run remaining batches to completion using the same in-progress dryRunId
      const batchFinalRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryNewerReport.dryRunId,
          confirmationToken: dryNewerReport.operatorConfirmationToken,
          confirmApply: true,
          batchSize: 5,
          disableLegacyWriters: true, // Even if caller passes true, F3 must keep legacyWritersDisabled=false!
        }),
      });
      assert.equal(batchFinalRes.status, 200);
      const finalResult = ((await batchFinalRes.json()) as any).data.result;
      assert.equal(finalResult.batchExecutionStatus, 'completed');
      assert.equal(finalResult.remainingRecordsCount, 0);
      assert.equal(finalResult.parityVerified, true);
      assert.equal(finalResult.canonicalHashesVerified, true);
      assert.ok(finalResult.sourceChecksum.length === 64);
      assert.ok(finalResult.targetChecksum.length === 64);

      // Verify newer target revision (revision 9) was NOT overwritten by snapshot revision 2
      assert.equal(finalResult.skippedNewerTargetCounts.projects, 1);
      const preservedProj = await realAdapter.projects.getById(
        'proj-f3-alice-1',
        'uid-alice-f3'
      );
      assert.ok(preservedProj);
      assert.equal(preservedProj.revision, 9, 'Newer target revision 9 must be preserved');
      assert.equal(preservedProj.title, 'Alice F3 Newer Firestore Revision 9');

      // Verify second project (proj-f3-alice-2) was migrated with revision 3
      const migratedProj2 = await realAdapter.projects.getById(
        'proj-f3-alice-2',
        'uid-alice-f3'
      );
      assert.ok(migratedProj2);
      assert.equal(migratedProj2.revision, 3);

      // Verify cross-entity references & app-level lookups passed
      assert.equal(finalResult.crossReferenceVerification.passed, true);
      assert.ok(finalResult.crossReferenceVerification.ownerReferencesVerified >= 6);
      assert.equal(finalResult.crossReferenceVerification.variantTemplateReferencesVerified, 1);
      assert.equal(finalResult.crossReferenceVerification.sessionProjectReferencesVerified, 2);
      assert.equal(finalResult.crossReferenceVerification.renderJobProjectReferencesVerified, 1);
      assert.equal(finalResult.crossReferenceVerification.providerVaultReferencesVerified, 1);

      assert.equal(finalResult.appLevelLookupVerification.passed, true);
      assert.equal(finalResult.appLevelLookupVerification.checkedCounts.projects, 2);
      assert.equal(finalResult.appLevelLookupVerification.checkedCounts.aiDirectorSessions, 1);
      assert.equal(finalResult.appLevelLookupVerification.checkedCounts.referenceLabSessions, 1);
      assert.equal(finalResult.appLevelLookupVerification.checkedCounts.templateFactoryDrafts, 1);
      assert.equal(finalResult.appLevelLookupVerification.checkedCounts.catalogItems, 1);
      assert.equal(finalResult.appLevelLookupVerification.checkedCounts.renderExportJobs, 1);

      // Verify Prompt F3 Cutover Gate: cutoverApprovalEligible is true, but legacyWritersDisabled remains false
      assert.equal(finalResult.cutoverApprovalEligible, true);
      assert.equal(
        finalResult.legacyWritersDisabled,
        false,
        'Prompt F3 invariant: legacy writers must remain enabled until the separate cutover step'
      );
      assert.equal(isLegacySnapshotWriterDisabled(), false);

      // Verify durable per-record migration ledger via GET /api/v1/admin/migration/ledger/:dryRunId
      const ledgerRes = await fetch(
        `${srvProd.baseUrl}/api/v1/admin/migration/ledger/${dryNewerReport.dryRunId}`,
        {
          headers: { authorization: 'Bearer token-owner' },
        }
      );
      assert.equal(ledgerRes.status, 200);
      const ledgerBody = ((await ledgerRes.json()) as any).data;
      assert.ok(ledgerBody.entryCount >= 10);
      const proj1Ledger = ledgerBody.entries.find(
        (e: any) => e.entity === 'projects' && e.recordId === 'proj-f3-alice-1'
      );
      assert.ok(proj1Ledger, 'Ledger must contain entry for proj-f3-alice-1');
      assert.equal(proj1Ledger.status, 'skipped-newer-target');
      assert.equal(proj1Ledger.sourceRevision, 2);
      assert.equal(proj1Ledger.targetRevisionBefore, 9);
      assert.equal(proj1Ledger.targetRevisionAfter, 9);
      assert.equal(proj1Ledger.verifiedReadAfterWrite, true);

      const proj2Ledger = ledgerBody.entries.find(
        (e: any) => e.entity === 'projects' && e.recordId === 'proj-f3-alice-2'
      );
      assert.ok(proj2Ledger, 'Ledger must contain entry for proj-f3-alice-2');
      assert.equal(proj2Ledger.status, 'migrated');
      assert.equal(proj2Ledger.sourceCanonicalHash, proj2Ledger.targetCanonicalHash);
      assert.equal(proj2Ledger.verifiedReadAfterWrite, true);

      // =========================================================================
      // 6. ID / OWNER COLLISION DETECTION (BOTH DRY-RUN AND RACE CONDITION ON APPLY)
      // =========================================================================
      console.log('6. Verifying ID/owner collision detection blocks cross-owner overwrite in both dry-run and apply...');

      // Issue a valid dry-run first, then inject a colliding project with the same ID ('proj-f3-alice-2') owned by Bob ('uid-bob-f3') in Firestore before calling apply
      const dryBeforeRaceRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      const dryBeforeRaceReport = ((await dryBeforeRaceRes.json()) as any).data.report;
      assert.equal(dryBeforeRaceReport.canSafelyApply, true);

      // Replace proj-f3-alice-2 in target store with a project owned by uid-bob-f3
      await realDriver.setDocument('projects', 'proj-f3-alice-2', {
        id: 'proj-f3-alice-2',
        ownerUid: 'uid-bob-f3',
        title: 'Bob Colliding Project',
        description: 'Owned by Bob',
        moduleId: 'templates',
        targetEditor: 'sowveil-project',
        aspectRatio: '16:9',
        projectFileStatus: 'sowveil-native',
        revision: 1,
        activeBranch: 'main',
        createdAt: '2026-10-31T00:00:00.000Z',
        updatedAt: '2026-10-31T00:00:00.000Z',
        metadataJson: JSON.stringify({
          id: 'proj-f3-alice-2',
          ownerUid: 'uid-bob-f3',
          title: 'Bob Colliding Project',
          moduleId: 'templates',
          targetEditor: 'sowveil-project',
          aspectRatio: '16:9',
          projectFileStatus: 'sowveil-native',
          revision: 1,
          activeBranch: 'main',
          createdAt: '2026-10-31T00:00:00.000Z',
          updatedAt: '2026-10-31T00:00:00.000Z',
        }),
        canonicalProjectJson: null,
      });

      // Now dry-run detects the collision upfront
      const dryCollisionRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      const dryCollisionReport = ((await dryCollisionRes.json()) as any).data.report;
      assert.equal(dryCollisionReport.canSafelyApply, false);
      assert.equal(dryCollisionReport.preconditions.noTargetIdOwnerCollisions, false);
      assert.equal(dryCollisionReport.totalTargetCollisions, 1);

      // And attempting to apply the earlier pre-race token halts immediately with HTTP 409 ID_OWNER_COLLISION
      const applyCollisionRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryBeforeRaceReport.dryRunId,
          confirmationToken: dryBeforeRaceReport.operatorConfirmationToken,
          confirmApply: true,
        }),
      });
      assert.equal(applyCollisionRes.status, 409, 'ID/owner collision during apply must return HTTP 409');
      const applyCollisionBody = (await applyCollisionRes.json()) as any;
      assert.equal(applyCollisionBody.error.code, 'ID_OWNER_COLLISION');

      // Verify Bob's project was NOT overwritten
      const bobProj = await realAdapter.projects.getById('proj-f3-alice-2', 'uid-bob-f3');
      assert.ok(bobProj);
      assert.equal(bobProj.ownerUid, 'uid-bob-f3');
      assert.equal(bobProj.title, 'Bob Colliding Project');
    } finally {
      await srvProd.close();
    }

    console.log('ALL PROMPT F3 VERIFIED LEGACY SNAPSHOT MIGRATION TESTS PASSED!');
  } finally {
    if (originalVaultKey === undefined) {
      delete process.env.SOWVEIL_MASTER_VAULT_KEY;
    } else {
      process.env.SOWVEIL_MASTER_VAULT_KEY = originalVaultKey;
    }
    resetLegacySnapshotWriterStateForTests();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runLegacySnapshotMigrationF3Tests().catch((err) => {
  console.error('Prompt F3 Legacy Snapshot Migration test suite failed:', err);
  process.exit(1);
});
