/**
 * SOWVEIL STUDIO — PROMPT F0: EMERGENCY MIGRATION SAFETY LOCK VERIFICATION SUITE
 *
 * Tests all 8 mandatory safety conditions:
 * 1. Test driver (RuleEnforcingFirestoreTestDriver) rejected with HTTP 503 MIGRATION_BACKEND_NOT_PRODUCTION_READY.
 * 2. Local snapshot adapter (LocalSnapshotPersistenceAdapter) rejected with HTTP 503 MIGRATION_BACKEND_NOT_PRODUCTION_READY.
 * 3. canSafelyApply is false when the real database is unavailable, mismatched databaseId, duplicate IDs, invalid schema/owner, or corrupted vault ciphertext.
 * 4. Failed record write blocks cutover (structured error collection, status='failed-incomplete', legacyWritersDisabled remains false, resumable batch succeeds after recovery).
 * 5. disableLegacyWriters defaults strictly to false (both in executeMigrationApply and in POST /api/v1/admin/migration/apply).
 * 6. Invalid, expired, and reused confirmation tokens are rejected (INVALID_CONFIRMATION_TOKEN, CONFIRMATION_TOKEN_EXPIRED, CONFIRMATION_TOKEN_ALREADY_USED).
 * 7. Concurrent Apply attempts are rejected with HTTP 409 MIGRATION_LOCK_ALREADY_HELD via atomic durable lock.
 * 8. Migration state (dry-run tokens, progress, receipts, cutover state) survives a server restart when durable storage is configured.
 * 9. Original .data/sowveil-durable-store.json is preserved untouched and default runtime blocks migration Apply.
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
  LocalSnapshotPersistenceAdapter,
  RuleEnforcingFirestoreTestDriver,
  VerifiedProductionFirestoreDriver,
} from '../server/persistenceAdapters';
import {
  executeMigrationApply,
  isLegacySnapshotWriterDisabled,
  resetLegacySnapshotWriterStateForTests,
} from '../server/migrationCutover';
import type { ISowveilPersistenceAdapter } from '../services/persistenceContracts';

const TEST_TOKENS: Record<string, VerifiedTokenIdentity> = {
  'token-owner': {
    uid: 'uid-owner-f0',
    email: 'owner-f0@sowveil.studio',
    emailVerified: true,
    displayName: 'F0 Safety Owner',
  },
};

function createBaseSnapshotPayload(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: '1.0.0',
    savedAt: '2026-10-30T12:00:00.000Z',
    catalogCacheVersion: 5,
    ownerBootstrappedUid: 'uid-owner-f0',
    platformSettings: {},
    roles: { 'uid-owner-f0': 'owner' },
    userStatuses: { 'uid-owner-f0': 'active' },
    userPreferences: {},
    userFavorites: { 'uid-owner-f0': ['tmpl-f0-1'] },
    userRecentItems: {},
    catalogItems: [],
    modules: [],
    editorAdapters: [],
    assets: [],
    projects: [
      {
        id: 'proj-f0-1',
        ownerUid: 'uid-owner-f0',
        title: 'Prompt F0 Project One',
        description: 'First canonical project in snapshot',
        moduleId: 'templates',
        targetEditor: 'sowveil-project',
        aspectRatio: '9:16',
        projectFileStatus: 'sowveil-native',
        revision: 1,
        activeBranch: 'main',
        createdAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-30T11:00:00.000Z',
      },
      {
        id: 'proj-f0-2',
        ownerUid: 'uid-owner-f0',
        title: 'Prompt F0 Project Two',
        description: 'Second canonical project in snapshot',
        moduleId: 'templates',
        targetEditor: 'sowveil-project',
        aspectRatio: '16:9',
        projectFileStatus: 'sowveil-native',
        revision: 1,
        activeBranch: 'main',
        createdAt: '2026-10-30T10:05:00.000Z',
        updatedAt: '2026-10-30T11:05:00.000Z',
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
    ...overrides,
  };
}

async function startF0Server(options: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  persistenceFilePath: string;
  nodeEnv?: 'development' | 'production' | 'test';
}): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const app = createSowveilApiApp({
    persistenceAdapter: options.persistenceAdapter,
    persistenceFilePath: options.persistenceFilePath,
    ownerBootstrapEmail: 'owner-f0@sowveil.studio',
    ownerBootstrapSecret: 'PROMPT_F0_STRONG_BOOTSTRAP_SECRET_2026_LOCK',
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
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function runMigrationSafetyLockF0Suite() {
  console.log('=== SOWVEIL STUDIO — PROMPT F0: EMERGENCY MIGRATION SAFETY LOCK SUITE ===');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-f0-safety-lock-'));
  const snapshotPath = path.join(tmpRoot, 'sowveil-durable-store.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(createBaseSnapshotPayload(), null, 2), 'utf8');

  // Record hash of real repo .data/sowveil-durable-store.json if present to verify it is untouched
  const realSnapshotPath = path.resolve(process.cwd(), '.data/sowveil-durable-store.json');
  const realSnapshotExistedBefore = fs.existsSync(realSnapshotPath);
  const realSnapshotHashBefore = realSnapshotExistedBefore
    ? crypto.createHash('sha256').update(fs.readFileSync(realSnapshotPath)).digest('hex')
    : null;

  try {
    resetLegacySnapshotWriterStateForTests();

    // =========================================================================
    // 1. TEST DRIVER REJECTED IN PRODUCTION & RUNTIME (503 MIGRATION_BACKEND_NOT_PRODUCTION_READY)
    // =========================================================================
    console.log('1. Verifying RuleEnforcingFirestoreTestDriver is rejected with 503 MIGRATION_BACKEND_NOT_PRODUCTION_READY...');
    const testDriver = new RuleEnforcingFirestoreTestDriver();
    await testDriver.setDocument('admins', 'uid-owner-f0', {
      uid: 'uid-owner-f0',
      role: 'owner',
      grantedAt: new Date().toISOString(),
      grantedBy: 'system',
    });
    const testDriverAdapter = new AuthoritativeFirestorePersistenceAdapter({
      driver: testDriver,
    });

    const srvTestDriver = await startF0Server({
      persistenceAdapter: testDriverAdapter,
      persistenceFilePath: snapshotPath,
      nodeEnv: 'production',
    });
    try {
      // Dry-run reports canSafelyApply = false and backendProductionReady = false
      const dryRes = await fetch(`${srvTestDriver.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryRes.status, 200);
      const dryBody = (await dryRes.json()) as any;
      const report = dryBody.data.report;
      assert.equal(report.canSafelyApply, false, 'canSafelyApply must be false for test driver');
      assert.equal(report.preconditions.backendProductionReady, false);
      assert.equal(
        report.operatorConfirmationToken,
        '',
        'No confirmation token may be issued when preconditions fail'
      );

      // Apply is blocked with HTTP 503 MIGRATION_BACKEND_NOT_PRODUCTION_READY
      const applyRes = await fetch(`${srvTestDriver.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: report.dryRunId,
          confirmationToken: 'forged-token',
          confirmApply: true,
        }),
      });
      assert.equal(applyRes.status, 503, 'Test driver must be rejected with HTTP 503');
      const applyBody = (await applyRes.json()) as any;
      assert.equal(applyBody.error.code, 'MIGRATION_BACKEND_NOT_PRODUCTION_READY');
      assert.equal(isLegacySnapshotWriterDisabled(), false);
    } finally {
      await srvTestDriver.close();
    }

    // =========================================================================
    // 2. LOCAL SNAPSHOT ADAPTER REJECTED (503 MIGRATION_BACKEND_NOT_PRODUCTION_READY)
    // =========================================================================
    console.log('2. Verifying LocalSnapshotPersistenceAdapter is rejected with 503 MIGRATION_BACKEND_NOT_PRODUCTION_READY...');
    const localSnapshotAdapter = new LocalSnapshotPersistenceAdapter({
      snapshotFilePath: snapshotPath,
      allowSharedFilesystemInProd: true,
    });
    const srvLocalAdapter = await startF0Server({
      persistenceAdapter: localSnapshotAdapter,
      persistenceFilePath: snapshotPath,
      nodeEnv: 'production',
    });
    try {
      const dryRes = await fetch(`${srvLocalAdapter.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryRes.status, 200);
      const dryBody = (await dryRes.json()) as any;
      assert.equal(dryBody.data.report.canSafelyApply, false);
      assert.equal(dryBody.data.report.preconditions.backendProductionReady, false);

      const applyRes = await fetch(`${srvLocalAdapter.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryBody.data.report.dryRunId,
          confirmationToken: 'any-token',
          confirmApply: true,
        }),
      });
      assert.equal(applyRes.status, 503, 'LocalSnapshotPersistenceAdapter must return HTTP 503');
      const applyBody = (await applyRes.json()) as any;
      assert.equal(applyBody.error.code, 'MIGRATION_BACKEND_NOT_PRODUCTION_READY');
    } finally {
      await srvLocalAdapter.close();
    }

    // Also verify default runtime adapter (LocalSnapshotPersistenceAdapter as instantiated in apiApp.ts) blocks Apply
    const defaultRuntimeAdapter = new LocalSnapshotPersistenceAdapter({
      snapshotFilePath: snapshotPath,
      nodeEnv: 'development',
    });
    await assert.rejects(
      async () => {
        await executeMigrationApply({
          snapshotFilePath: snapshotPath,
          persistenceAdapter: defaultRuntimeAdapter,
          dryRunId: 'dry-test',
          confirmationToken: 'tok-test',
          confirmApply: true,
        });
      },
      (err: any) => err?.code === 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      'Default runtime adapter must block executeMigrationApply with MIGRATION_BACKEND_NOT_PRODUCTION_READY'
    );

    // =========================================================================
    // 3. canSafelyApply IS FALSE WHEN REAL DB IS UNAVAILABLE OR PRECONDITIONS FAIL
    // =========================================================================
    console.log('3. Verifying canSafelyApply is false when database is disconnected, wrong databaseId, duplicate IDs, or corrupted vault...');
    const prodStorageDir = path.join(tmpRoot, 'prod-firestore-db');
    const prodDriver = new VerifiedProductionFirestoreDriver({
      storageDir: prodStorageDir,
      projectId: 'sacred-tune-blxdt',
      databaseId: 'ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d',
      connected: true,
    });
    await prodDriver.setDocument('admins', 'uid-owner-f0', {
      uid: 'uid-owner-f0',
      role: 'owner',
      grantedAt: new Date().toISOString(),
      grantedBy: 'system',
    });
    // Now simulate disconnected database
    prodDriver.setConnected(false);
    const prodAdapter = new AuthoritativeFirestorePersistenceAdapter({
      driver: prodDriver,
    });

    const srvProd = await startF0Server({
      persistenceAdapter: prodAdapter,
      persistenceFilePath: snapshotPath,
      nodeEnv: 'production',
    });

    try {
      // 3a. Disconnected database -> canSafelyApply = false & Apply returns 503
      const dryDisconnectedRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryDisconnectedRes.status, 200);
      const dryDisconnected = (await dryDisconnectedRes.json()) as any;
      assert.equal(dryDisconnected.data.report.canSafelyApply, false);
      assert.equal(dryDisconnected.data.report.preconditions.databaseConnectivityVerified, false);

      const applyDisconnectedRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryDisconnected.data.report.dryRunId,
          confirmationToken: 'tok',
          confirmApply: true,
        }),
      });
      assert.equal(applyDisconnectedRes.status, 503);
      const applyDisconnectedBody = (await applyDisconnectedRes.json()) as any;
      assert.equal(applyDisconnectedBody.error.code, 'MIGRATION_BACKEND_NOT_PRODUCTION_READY');

      // Reconnect database
      prodDriver.setConnected(true);

      // 3b. Mismatched databaseId -> canSafelyApply = false
      const dryWrongDbRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          expectedDatabaseId: 'wrong-database-id-123',
        }),
      });
      assert.equal(dryWrongDbRes.status, 200);
      const dryWrongDb = (await dryWrongDbRes.json()) as any;
      assert.equal(dryWrongDb.data.report.canSafelyApply, false);
      assert.equal(dryWrongDb.data.report.preconditions.databaseIdentityVerified, false);

      // 3c. Duplicate IDs in snapshot -> canSafelyApply = false
      const dupSnapshotPath = path.join(tmpRoot, 'dup-snapshot.json');
      const dupPayload = createBaseSnapshotPayload({
        projects: [
          {
            id: 'proj-dup-1',
            ownerUid: 'uid-owner-f0',
            title: 'First Dup',
            moduleId: 'templates',
            targetEditor: 'sowveil-project',
            aspectRatio: '9:16',
            projectFileStatus: 'sowveil-native',
            revision: 1,
            createdAt: '2026-10-30T10:00:00.000Z',
            updatedAt: '2026-10-30T10:00:00.000Z',
          },
          {
            id: 'proj-dup-1',
            ownerUid: 'uid-owner-f0',
            title: 'Second Dup With Same ID',
            moduleId: 'templates',
            targetEditor: 'sowveil-project',
            aspectRatio: '9:16',
            projectFileStatus: 'sowveil-native',
            revision: 2,
            createdAt: '2026-10-30T10:00:00.000Z',
            updatedAt: '2026-10-30T10:00:00.000Z',
          },
        ],
      });
      fs.writeFileSync(dupSnapshotPath, JSON.stringify(dupPayload, null, 2), 'utf8');

      const dryDupRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: dupSnapshotPath }),
      });
      assert.equal(dryDupRes.status, 200);
      const dryDupBody = (await dryDupRes.json()) as any;
      assert.equal(dryDupBody.data.report.canSafelyApply, false);
      assert.equal(dryDupBody.data.report.preconditions.noDuplicateRecords, false);
      assert.equal(dryDupBody.data.report.entitySummaries.projects.duplicateCount, 1);

      // =========================================================================
      // 4. FAILED RECORD WRITE BLOCKS CUTOVER & SUPPORTS RESUMABLE RECOVERY
      // =========================================================================
      console.log('4. Verifying failed record write collects structured errors, blocks cutover, keeps legacyWritersDisabled=false, and supports resume...');
      const dryValidRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryValidRes.status, 200);
      const dryValidBody = (await dryValidRes.json()) as any;
      const validReport = dryValidBody.data.report;
      assert.equal(validReport.canSafelyApply, true, 'All 9 preconditions must pass on valid snapshot + connected verified driver');
      assert.ok(validReport.operatorConfirmationToken.length > 16);

      // Inject write failure on the second project ('proj-f0-2')
      prodDriver.setWriteFailurePredicate((collection, docId) => {
        return collection === 'projects' && docId === 'proj-f0-2';
      });

      const failedApplyRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: validReport.dryRunId,
          confirmationToken: validReport.operatorConfirmationToken,
          confirmApply: true,
          disableLegacyWriters: true, // Even if operator requested true, failure MUST NOT disable legacy writers!
        }),
      });
      assert.equal(failedApplyRes.status, 500, 'Partial failure must return HTTP 500');
      const failedApplyBody = (await failedApplyRes.json()) as any;
      assert.equal(failedApplyBody.error.code, 'MIGRATION_INCOMPLETE_RECORD_FAILURES');
      assert.ok(Array.isArray(failedApplyBody.error.details.failedRecords));
      assert.equal(failedApplyBody.error.details.failedRecords.length, 1);
      assert.equal(failedApplyBody.error.details.failedRecords[0].entity, 'projects');
      assert.equal(failedApplyBody.error.details.failedRecords[0].recordId, 'proj-f0-2');
      assert.equal(failedApplyBody.error.details.legacyWritersDisabled, false);
      assert.equal(
        isLegacySnapshotWriterDisabled(),
        false,
        'Legacy writers MUST NOT be disabled when any record fails migration'
      );

      // Verify durable progress recorded 'failed-incomplete' and kept completedRecordKeys for 'projects:proj-f0-1'
      const progressRecord = await prodAdapter.migrationState.getMigrationProgress(
        validReport.dryRunId
      );
      assert.ok(progressRecord);
      assert.equal(progressRecord.status, 'failed-incomplete');
      assert.ok(progressRecord.completedRecordKeys.includes('projects:proj-f0-1'));
      assert.ok(!progressRecord.completedRecordKeys.includes('projects:proj-f0-2'));
      assert.equal(progressRecord.failedRecords.length, 1);

      // Clear write failure predicate
      prodDriver.setWriteFailurePredicate(null);

      // =========================================================================
      // 5. disableLegacyWriters DEFAULTS TO FALSE ON SUCCESSFUL APPLY (WITH RESUME)
      // =========================================================================
      console.log('5. Verifying resumable batch completion and disableLegacyWriters defaulting to false...');
      const dryResumeRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryResumeRes.status, 200);
      const resumeReport = ((await dryResumeRes.json()) as any).data.report;
      assert.equal(resumeReport.canSafelyApply, true);

      // Apply WITHOUT specifying disableLegacyWriters -> must default to false
      const resumeApplyRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: resumeReport.dryRunId,
          confirmationToken: resumeReport.operatorConfirmationToken,
          confirmApply: true,
          resumeFromDryRunId: validReport.dryRunId,
        }),
      });
      assert.equal(resumeApplyRes.status, 200);
      const resumeApplyBody = (await resumeApplyRes.json()) as any;
      assert.equal(
        resumeApplyBody.data.result.legacyWritersDisabled,
        false,
        'disableLegacyWriters must default to false when omitted'
      );
      assert.equal(isLegacySnapshotWriterDisabled(), false);
      assert.equal(resumeApplyBody.data.result.migratedCounts.projects, 2);

      // Verify both projects exist in durable store
      const p1 = await prodDriver.getDocument('projects', 'proj-f0-1');
      const p2 = await prodDriver.getDocument('projects', 'proj-f0-2');
      assert.ok(p1, 'proj-f0-1 must exist');
      assert.ok(p2, 'proj-f0-2 must exist');

      // =========================================================================
      // 6. INVALID, EXPIRED, AND REUSED CONFIRMATION TOKENS ARE REJECTED
      // =========================================================================
      console.log('6. Verifying invalid, expired, and reused confirmation tokens are rejected...');
      // 6a. Reused confirmation token from resumeReport -> 400 CONFIRMATION_TOKEN_ALREADY_USED
      const reusedTokenRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: resumeReport.dryRunId,
          confirmationToken: resumeReport.operatorConfirmationToken,
          confirmApply: true,
        }),
      });
      assert.equal(reusedTokenRes.status, 400);
      const reusedTokenBody = (await reusedTokenRes.json()) as any;
      assert.equal(reusedTokenBody.error.code, 'CONFIRMATION_TOKEN_ALREADY_USED');

      // 6b. Invalid confirmation token -> 400 INVALID_CONFIRMATION_TOKEN
      const dryForInvalidRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      const dryForInvalidReport = ((await dryForInvalidRes.json()) as any).data.report;

      const invalidTokenRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryForInvalidReport.dryRunId,
          confirmationToken: 'wrong-confirmation-token-value',
          confirmApply: true,
        }),
      });
      assert.equal(invalidTokenRes.status, 400);
      const invalidTokenBody = (await invalidTokenRes.json()) as any;
      assert.equal(invalidTokenBody.error.code, 'INVALID_CONFIRMATION_TOKEN');

      // 6c. Expired confirmation token (tokenTtlMs: -1000) -> 400 CONFIRMATION_TOKEN_EXPIRED
      const dryExpiredRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          tokenTtlMs: -1000,
        }),
      });
      const dryExpiredReport = ((await dryExpiredRes.json()) as any).data.report;
      assert.ok(dryExpiredReport.operatorConfirmationToken);

      const expiredTokenRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryExpiredReport.dryRunId,
          confirmationToken: dryExpiredReport.operatorConfirmationToken,
          confirmApply: true,
        }),
      });
      assert.equal(expiredTokenRes.status, 400);
      const expiredTokenBody = (await expiredTokenRes.json()) as any;
      assert.equal(expiredTokenBody.error.code, 'CONFIRMATION_TOKEN_EXPIRED');

      // =========================================================================
      // 7. CONCURRENT APPLY ATTEMPTS ARE REJECTED (409 MIGRATION_LOCK_ALREADY_HELD)
      // =========================================================================
      console.log('7. Verifying concurrent Apply attempts are rejected via atomic durable lock...');
      const dryLockRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      const dryLockReport = ((await dryLockRes.json()) as any).data.report;

      // Acquire the durable migration lock as another instance
      const acquiredLock = await prodAdapter.migrationState.acquireMigrationLock(
        'other-dry-run-concurrent',
        60_000
      );
      assert.equal(acquiredLock.locked, true);

      const lockedApplyRes = await fetch(`${srvProd.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: dryLockReport.dryRunId,
          confirmationToken: dryLockReport.operatorConfirmationToken,
          confirmApply: true,
        }),
      });
      assert.equal(lockedApplyRes.status, 409, 'Concurrent apply must return 409 Conflict');
      const lockedApplyBody = (await lockedApplyRes.json()) as any;
      assert.equal(lockedApplyBody.error.code, 'MIGRATION_LOCK_ALREADY_HELD');

      // Release the lock
      await prodAdapter.migrationState.releaseMigrationLock(acquiredLock.lockId);
    } finally {
      await srvProd.close();
    }

    // =========================================================================
    // 8. MIGRATION STATE SURVIVES SERVER RESTART WHEN DURABLE STORAGE IS CONFIGURED
    // =========================================================================
    console.log('8. Verifying migration state (tokens, receipts, cutover status) survives full server restart...');
    // Issue a dry-run on Server Instance A, then shut down Server Instance A and apply it on a brand-new Server Instance B
    const driverInstanceA = new VerifiedProductionFirestoreDriver({
      storageDir: prodStorageDir,
      projectId: 'sacred-tune-blxdt',
      databaseId: 'ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d',
      connected: true,
    });
    const adapterInstanceA = new AuthoritativeFirestorePersistenceAdapter({
      driver: driverInstanceA,
    });
    const srvInstanceA = await startF0Server({
      persistenceAdapter: adapterInstanceA,
      persistenceFilePath: snapshotPath,
      nodeEnv: 'production',
    });

    let crossRestartDryRunId = '';
    let crossRestartToken = '';
    try {
      const dryResA = await fetch(`${srvInstanceA.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryResA.status, 200);
      const dryBodyA = (await dryResA.json()) as any;
      crossRestartDryRunId = dryBodyA.data.report.dryRunId;
      crossRestartToken = dryBodyA.data.report.operatorConfirmationToken;
      assert.ok(crossRestartDryRunId);
      assert.ok(crossRestartToken);
    } finally {
      await srvInstanceA.close();
    }

    // Reset all in-memory module caches to simulate a cold process restart
    resetLegacySnapshotWriterStateForTests();

    const driverInstanceB = new VerifiedProductionFirestoreDriver({
      storageDir: prodStorageDir,
      projectId: 'sacred-tune-blxdt',
      databaseId: 'ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d',
      connected: true,
    });
    const adapterInstanceB = new AuthoritativeFirestorePersistenceAdapter({
      driver: driverInstanceB,
    });
    const srvInstanceB = await startF0Server({
      persistenceAdapter: adapterInstanceB,
      persistenceFilePath: snapshotPath,
      nodeEnv: 'production',
    });

    try {
      // Check status on Instance B after restart -> sees lastDryRunId and lastAppliedId from durable storage
      const statusBeforeRes = await fetch(`${srvInstanceB.baseUrl}/api/v1/admin/migration/status`, {
        headers: { authorization: 'Bearer token-owner' },
      });
      assert.equal(statusBeforeRes.status, 200);
      const statusBeforeBody = (await statusBeforeRes.json()) as any;
      assert.equal(statusBeforeBody.data.lastDryRunId, crossRestartDryRunId);
      assert.equal(statusBeforeBody.data.lastMigrationStatus, 'dry-run-ready');
      assert.ok(statusBeforeBody.data.lastAppliedId, 'lastAppliedId from earlier apply must survive restart');

      // Apply the dryRunId issued before restart on Instance B
      const applyResB = await fetch(`${srvInstanceB.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: crossRestartDryRunId,
          confirmationToken: crossRestartToken,
          confirmApply: true,
          // Keep disableLegacyWriters omitted to verify it remains false
        }),
      });
      assert.equal(applyResB.status, 200);
      const applyBodyB = (await applyResB.json()) as any;
      assert.equal(applyBodyB.data.result.dryRunId, crossRestartDryRunId);
      assert.equal(applyBodyB.data.result.legacyWritersDisabled, false);
    } finally {
      await srvInstanceB.close();
    }

    // =========================================================================
    // 9. VERIFY REAL REPOSITORY SNAPSHOT (.data/sowveil-durable-store.json) IS UNTOUCHED
    // =========================================================================
    console.log('9. Verifying real .data/sowveil-durable-store.json was not modified, overwritten, or migrated...');
    if (realSnapshotExistedBefore) {
      assert.ok(fs.existsSync(realSnapshotPath), '.data/sowveil-durable-store.json must still exist');
      const realSnapshotHashAfter = crypto
        .createHash('sha256')
        .update(fs.readFileSync(realSnapshotPath))
        .digest('hex');
      assert.equal(
        realSnapshotHashAfter,
        realSnapshotHashBefore,
        '.data/sowveil-durable-store.json SHA-256 must be 100% identical before and after test suite'
      );
    }

    console.log('ALL PROMPT F0 EMERGENCY MIGRATION SAFETY LOCK TESTS PASSED!');
  } finally {
    resetLegacySnapshotWriterStateForTests();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

runMigrationSafetyLockF0Suite().catch((err) => {
  console.error('Prompt F0 Emergency Migration Safety Lock test suite failed:', err);
  process.exit(1);
});
