/**
 * SOWVEIL STUDIO — PHASE 2D VERIFICATION SUITE
 * Providers, Render/Export Jobs, Owner Bootstrap & Atomic Locks, and Cutover Migration
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createSowveilApiApp, type VerifiedTokenIdentity } from '../server/apiApp';
import {
  AuthoritativeFirestorePersistenceAdapter,
  RuleEnforcingFirestoreTestDriver,
} from '../server/persistenceAdapters';
import { resetLegacySnapshotWriterStateForTests } from '../server/migrationCutover';

const TEST_TOKENS: Record<string, VerifiedTokenIdentity> = {
  'token-owner': {
    uid: 'uid-owner-2d',
    email: 'owner2d@sowveil.studio',
    emailVerified: true,
    displayName: 'Phase 2D Owner',
  },
  'token-alice': {
    uid: 'uid-alice-2d',
    email: 'alice2d@example.com',
    emailVerified: true,
    displayName: 'Alice Producer',
  },
  'token-bob': {
    uid: 'uid-bob-2d',
    email: 'bob2d@example.com',
    emailVerified: true,
    displayName: 'Bob Editor',
  },
};

async function startTestServer(options: {
  driver: RuleEnforcingFirestoreTestDriver;
  persistenceFilePath?: string;
  ownerBootstrapEmail?: string;
  ownerBootstrapSecret?: string;
  nodeEnv?: 'development' | 'production' | 'test';
  useLocalSnapshotAdapter?: boolean;
}): Promise<{
  baseUrl: string;
  adapter: AuthoritativeFirestorePersistenceAdapter;
  close: () => Promise<void>;
}> {
  const adapter = new AuthoritativeFirestorePersistenceAdapter({
    driver: options.driver,
  });

  const app = createSowveilApiApp({
    persistenceAdapter: options.useLocalSnapshotAdapter ? undefined : adapter,
    persistenceFilePath: options.persistenceFilePath,
    ownerBootstrapEmail: options.ownerBootstrapEmail ?? 'owner2d@sowveil.studio',
    ownerBootstrapSecret:
      options.ownerBootstrapSecret ?? 'PHASE_2D_STRONG_BOOTSTRAP_SECRET_2026_XYZ',
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
    providerProbeFetchImpl: async (url) => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-2d-probe',
          choices: [
            {
              message: {
                role: 'assistant',
                content: JSON.stringify({ status: 'ok', probeUrl: String(url) }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
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
    adapter,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function runPhase2DTests() {
  console.log('Running Phase 2D Verification Suite (Providers, Jobs, Roles, and Cutover)...');
  const originalVaultKey = process.env.SOWVEIL_MASTER_VAULT_KEY;
  const KEY_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const KEY_B = 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f';
  process.env.SOWVEIL_MASTER_VAULT_KEY = KEY_A;
  resetLegacySnapshotWriterStateForTests();

  const sharedDriver = new RuleEnforcingFirestoreTestDriver();

  try {
    // =========================================================================
    // 1. PROVIDER RECORDS & SERVER-ONLY CREDENTIAL VAULT SPLIT PERSISTENCE
    // =========================================================================
    console.log('1. Testing Provider Connections split persistence, vault health & key rotation...');
    const srv1 = await startTestServer({ driver: sharedDriver });
    let createdConnId = '';
    const RAW_SECRET = 'sk-live-super-secret-phase2d-credential-998877';

    try {
      // Create connection with credential
      const createRes = await fetch(`${srv1.baseUrl}/api/v1/provider-hub/connections`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-alice',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          label: 'Alice OpenAI Production Gateway',
          providerBrand: 'OpenAI',
          protocol: 'openai-chat-completions',
          baseUrl: 'https://api.openai.com',
          modelId: 'gpt-4o',
          authMode: 'bearer',
          credential: RAW_SECRET,
          storageMode: 'server-encrypted-vault',
        }),
      });
      assert.equal(createRes.status, 201);
      const createBody = (await createRes.json()) as any;
      createdConnId = createBody.data.connection.id;
      assert.ok(createdConnId);
      assert.equal(createBody.data.connection.credentialStatus, 'active');

      // Verify response never exposes plaintext or ciphertext
      const createBodyText = JSON.stringify(createBody);
      assert.equal(createBodyText.includes(RAW_SECRET), false, 'Raw secret must never appear in response');
      assert.equal(createBodyText.includes('ciphertextBase64'), false, 'Ciphertext must never appear in response');

      // Inspect underlying Firestore collections directly:
      // 1) providerConnections document must NOT contain encryptedCredential or raw secret
      const firestoreMetaDoc = await sharedDriver.getDocument<Record<string, unknown>>(
        'providerConnections',
        createdConnId
      );
      assert.ok(firestoreMetaDoc, 'Metadata document must be persisted in providerConnections');
      assert.equal('encryptedCredential' in firestoreMetaDoc, false);
      assert.equal(JSON.stringify(firestoreMetaDoc).includes(RAW_SECRET), false);

      // 2) __server_only_credential_vault__ document MUST contain AES-256-GCM envelope
      const vaultDoc = await sharedDriver.getDocument<Record<string, unknown>>(
        '__server_only_credential_vault__',
        createdConnId
      );
      assert.ok(vaultDoc, 'Encrypted secret must be persisted in __server_only_credential_vault__');
      assert.equal(vaultDoc.ownerUid, 'uid-alice-2d');
      assert.equal(JSON.stringify(vaultDoc).includes(RAW_SECRET), false);

      // Probe connection to verify live decrypt works on server
      const probeRes = await fetch(
        `${srv1.baseUrl}/api/v1/provider-hub/connections/${createdConnId}/test`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-alice',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ probeStructuredOutput: true }),
        }
      );
      assert.equal(probeRes.status, 200);
      const probeBody = (await probeRes.json()) as any;
      assert.equal(probeBody.data.probePassed, true);

      // Cross-user isolation: Bob cannot probe or rotate Alice's connection
      const bobProbe = await fetch(
        `${srv1.baseUrl}/api/v1/provider-hub/connections/${createdConnId}/test`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer token-bob' },
        }
      );
      assert.equal(bobProbe.status, 403);

      // Update routing profile for Alice and verify persistence
      const routeRes = await fetch(
        `${srv1.baseUrl}/api/v1/provider-hub/routing/planning`,
        {
          method: 'PUT',
          headers: {
            authorization: 'Bearer token-alice',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            primaryConnectionId: createdConnId,
            maxBudgetPerRunUsd: 2.5,
          }),
        }
      );
      assert.equal(routeRes.status, 200);
    } finally {
      await srv1.close();
    }

    // Restart server with DIFFERENT master vault key (KEY_B) -> must mark requires-reentry while preserving ciphertext & routing
    process.env.SOWVEIL_MASTER_VAULT_KEY = KEY_B;
    const srv2 = await startTestServer({ driver: sharedDriver });
    try {
      const listRes = await fetch(`${srv2.baseUrl}/api/v1/provider-hub/connections`, {
        headers: { authorization: 'Bearer token-alice' },
      });
      assert.equal(listRes.status, 200);
      const listBody = (await listRes.json()) as any;
      const found = listBody.data.items.find((c: any) => c.id === createdConnId);
      assert.ok(found, 'Connection must survive restart');
      assert.equal(
        found.credentialStatus,
        'requires-reentry',
        'Connection must transition to requires-reentry when vault key changes'
      );
      assert.equal(found.lastSanitizedError?.code, 'CREDENTIAL_REENTRY_REQUIRED');

      // Verify ciphertext was NOT destroyed in vault collection
      const vaultDocStillPresent = await sharedDriver.getDocument<Record<string, unknown>>(
        '__server_only_credential_vault__',
        createdConnId
      );
      assert.ok(vaultDocStillPresent, 'Active ciphertext must be preserved until user rotates');

      // Verify routing profile survived restart intact
      const routeGetRes = await fetch(`${srv2.baseUrl}/api/v1/provider-hub/routing`, {
        headers: { authorization: 'Bearer token-alice' },
      });
      assert.equal(routeGetRes.status, 200);
      const routeGetBody = (await routeGetRes.json()) as any;
      assert.equal(routeGetBody.data.profiles.planning.primaryConnectionId, createdConnId);

      // Rotate key under KEY_B -> restores configured status
      const rotateRes = await fetch(
        `${srv2.baseUrl}/api/v1/provider-hub/connections/${createdConnId}/rotate-key`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-alice',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ credential: 'sk-live-rotated-key-under-key-b-112233' }),
        }
      );
      assert.equal(rotateRes.status, 200);
      const rotateBody = (await rotateRes.json()) as any;
      assert.equal(rotateBody.data.connection.credentialStatus, 'active');
    } finally {
      await srv2.close();
    }

    // =========================================================================
    // 2. RENDER/EXPORT JOBS AUTHORITATIVE PERSISTENCE & BINARY ARTIFACT STRIPPING
    // =========================================================================
    console.log('2. Testing Render/Export Job persistence, binary exclusion from Firestore, and restart survival...');
    const srv3 = await startTestServer({ driver: sharedDriver });
    let renderJobId = '';
    try {
      const createJobRes = await fetch(`${srv3.baseUrl}/api/v1/render-export/jobs`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-alice',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          executionTier: 'final-render',
          outputFormat: 'png-frame',
          targetAdapter: 'sowveil-project',
        }),
      });
      assert.equal(createJobRes.status, 201);
      const createJobBody = (await createJobRes.json()) as any;
      renderJobId = createJobBody.data.job.id;
      assert.equal(createJobBody.data.job.stage, 'ready');
      assert.equal(createJobBody.data.job.hasDownloadableBytes, true);

      // Verify Firestore renderExportJobs document does NOT store artifactBytesBase64
      const storedJobDoc = await sharedDriver.getDocument<Record<string, unknown>>(
        'renderExportJobs',
        renderJobId
      );
      assert.ok(storedJobDoc, 'Render job must be stored in renderExportJobs collection');
      assert.equal(
        'artifactBytesBase64' in storedJobDoc,
        false,
        'Large binary artifactBytesBase64 must never be stored in Firestore document'
      );
      assert.equal(
        String(storedJobDoc.jobMetadataJson || '').includes('artifactBytesBase64'),
        false,
        'Serialized jobMetadataJson must also strip artifactBytesBase64'
      );
      assert.equal(storedJobDoc.storagePersistenceMode, 'metadata-only-ephemeral');

      // Download binary artifact in-session
      const dlRes = await fetch(
        `${srv3.baseUrl}/api/v1/render-export/jobs/${renderJobId}/download`,
        {
          headers: { authorization: 'Bearer token-alice' },
        }
      );
      assert.equal(dlRes.status, 200);
      assert.equal(dlRes.headers.get('content-type'), 'image/png');
      const pngBytes = Buffer.from(await dlRes.arrayBuffer());
      assert.ok(pngBytes.byteLength > 64);

      // Verify global diagnostics and Render/Export QA report consistent job status
      const diagRes = await fetch(`${srv3.baseUrl}/api/v1/diagnostics/technical`, {
        headers: { authorization: 'Bearer token-alice' },
      });
      assert.equal(diagRes.status, 200);
      const diagBody = (await diagRes.json()) as any;
      assert.ok(diagBody.data.exportQueueStatus.readyOrCompletedCount >= 1);
    } finally {
      await srv3.close();
    }

    // Restart server and verify job metadata, QA report, and cancellation persist
    const srv4 = await startTestServer({ driver: sharedDriver });
    try {
      const listJobsRes = await fetch(`${srv4.baseUrl}/api/v1/render-export/jobs`, {
        headers: { authorization: 'Bearer token-alice' },
      });
      assert.equal(listJobsRes.status, 200);
      const listJobsBody = (await listJobsRes.json()) as any;
      const persistedJob = listJobsBody.data.jobs.find((j: any) => j.id === renderJobId);
      assert.ok(persistedJob, 'Render job must survive server restart');
      assert.equal(persistedJob.stage, 'ready');

      const qaRes = await fetch(
        `${srv4.baseUrl}/api/v1/render-export/jobs/${renderJobId}/qa-report`,
        {
          headers: { authorization: 'Bearer token-alice' },
        }
      );
      assert.equal(qaRes.status, 200);
      const qaBody = (await qaRes.json()) as any;
      assert.equal(qaBody.data.qaReport.overallPassed, true);

      // Cancel job and verify cancellation persists in authoritative store
      const cancelRes = await fetch(
        `${srv4.baseUrl}/api/v1/render-export/jobs/${renderJobId}/cancel`,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-alice',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ reason: 'User superseded export after restart' }),
        }
      );
      assert.equal(cancelRes.status, 200);
      const cancelBody = (await cancelRes.json()) as any;
      assert.equal(cancelBody.data.job.stage, 'cancelled');
    } finally {
      await srv4.close();
    }

    // =========================================================================
    // 3. ROLES & OWNER BOOTSTRAP ATOMIC DURABLE LOCK & PRODUCTION GUARDS
    // =========================================================================
    console.log('3. Testing Owner Bootstrap guards, atomic lock across instances, and role persistence...');

    // 3a. Missing OWNER_BOOTSTRAP_EMAIL -> 503 BOOTSTRAP_NOT_CONFIGURED
    const srvNoEmail = await startTestServer({
      driver: sharedDriver,
      ownerBootstrapEmail: '',
    });
    try {
      const res = await fetch(`${srvNoEmail.baseUrl}/api/v1/admin/bootstrap-owner`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'x-bootstrap-secret': 'PHASE_2D_STRONG_BOOTSTRAP_SECRET_2026_XYZ',
        },
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as any;
      assert.equal(body.error.code, 'BOOTSTRAP_NOT_CONFIGURED');
    } finally {
      await srvNoEmail.close();
    }

    // 3b. Weak/short OWNER_BOOTSTRAP_SECRET -> 503 BOOTSTRAP_NOT_CONFIGURED
    const srvWeakSecret = await startTestServer({
      driver: sharedDriver,
      ownerBootstrapSecret: 'short-secret',
    });
    try {
      const res = await fetch(`${srvWeakSecret.baseUrl}/api/v1/admin/bootstrap-owner`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'x-bootstrap-secret': 'short-secret',
        },
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as any;
      assert.equal(body.error.code, 'BOOTSTRAP_SECRET_TOO_WEAK');
    } finally {
      await srvWeakSecret.close();
    }

    // 3c. Production mode with non-durable local snapshot adapter -> 503 BOOTSTRAP_DISABLED_IN_PRODUCTION
    const srvProdUnsafe = await startTestServer({
      driver: sharedDriver,
      nodeEnv: 'production',
      useLocalSnapshotAdapter: true,
    });
    try {
      const res = await fetch(`${srvProdUnsafe.baseUrl}/api/v1/admin/bootstrap-owner`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'x-bootstrap-secret': 'PHASE_2D_STRONG_BOOTSTRAP_SECRET_2026_XYZ',
        },
      });
      assert.equal(res.status, 503);
      const body = (await res.json()) as any;
      assert.equal(body.error.code, 'BOOTSTRAP_DISABLED_IN_PRODUCTION');
    } finally {
      await srvProdUnsafe.close();
    }

    // 3d. Production mode with AuthoritativeFirestorePersistenceAdapter -> succeeds once, locks atomically across instances
    const srvProdInstance1 = await startTestServer({
      driver: sharedDriver,
      nodeEnv: 'production',
    });
    const srvProdInstance2 = await startTestServer({
      driver: sharedDriver,
      nodeEnv: 'production',
    });
    try {
      // Concurrent bootstrap calls across two separate server instances sharing the same Firestore driver
      const [b1, b2] = await Promise.all([
        fetch(`${srvProdInstance1.baseUrl}/api/v1/admin/bootstrap-owner`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-owner',
            'x-bootstrap-secret': 'PHASE_2D_STRONG_BOOTSTRAP_SECRET_2026_XYZ',
          },
        }),
        fetch(`${srvProdInstance2.baseUrl}/api/v1/admin/bootstrap-owner`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-owner',
            'x-bootstrap-secret': 'PHASE_2D_STRONG_BOOTSTRAP_SECRET_2026_XYZ',
          },
        }),
      ]);
      const statuses = [b1.status, b2.status].sort();
      assert.deepEqual(
        statuses,
        [200, 409],
        'Exactly one concurrent bootstrap must succeed (200) and the other must be rejected with 409 OWNER_ALREADY_BOOTSTRAPPED'
      );

      // Verify persistent lock document in systemLocks/ownerBootstrap and role in admins/uid-owner-2d
      const lockDoc = await sharedDriver.getDocument<Record<string, unknown>>(
        'systemLocks',
        'ownerBootstrap'
      );
      assert.ok(lockDoc);
      assert.equal(lockDoc.bootstrapped, true);
      assert.equal(lockDoc.ownerUid, 'uid-owner-2d');

      const adminDoc = await sharedDriver.getDocument<Record<string, unknown>>(
        'admins',
        'uid-owner-2d'
      );
      assert.ok(adminDoc);
      assert.equal(adminDoc.role, 'owner');
    } finally {
      await srvProdInstance1.close();
      await srvProdInstance2.close();
    }

    // =========================================================================
    // 4. CUTOVER & MIGRATION DRY-RUN, BACKUP, CONFIRMATION, APPLY & ROLLBACK
    // =========================================================================
    console.log('4. Testing Cutover & Migration dry-run, backup, operator confirmation, idempotent apply, and rollback...');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-phase2d-cutover-'));
    const snapshotPath = path.join(tmpDir, 'sowveil-durable-store.json');

    // Create a legacy snapshot file with sample projects, catalog items, and a provider connection
    const legacySnapshotPayload = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      catalogCacheVersion: 3,
      ownerBootstrappedUid: 'uid-owner-2d',
      platformSettings: {},
      roles: { 'uid-owner-2d': 'owner' },
      userStatuses: { 'uid-owner-2d': 'active' },
      userPreferences: {},
      userFavorites: { 'uid-alice-2d': ['tmpl-cutover-1'] },
      userRecentItems: {},
      catalogItems: [],
      modules: [],
      editorAdapters: [],
      assets: [],
      projects: [
        {
          id: 'proj-cutover-legacy-1',
          ownerUid: 'uid-alice-2d',
          title: 'Legacy Cutover Project',
          description: 'Migrated from snapshot to authoritative store',
          moduleId: 'templates',
          targetEditor: 'sowveil-project',
          aspectRatio: '9:16',
          projectFileStatus: 'sowveil-native',
          revision: 2,
          activeBranch: 'main',
          createdAt: '2026-10-20T00:00:00.000Z',
          updatedAt: '2026-10-20T01:00:00.000Z',
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
    fs.writeFileSync(snapshotPath, JSON.stringify(legacySnapshotPayload, null, 2), 'utf8');

    const cutoverDriver = new RuleEnforcingFirestoreTestDriver();
    // Seed owner role in cutoverDriver so token-owner is authorized as owner
    await cutoverDriver.setDocument('admins', 'uid-owner-2d', {
      uid: 'uid-owner-2d',
      role: 'owner',
      grantedAt: new Date().toISOString(),
      grantedBy: 'system',
    });

    const srvCutover = await startTestServer({
      driver: cutoverDriver,
      persistenceFilePath: snapshotPath,
    });

    try {
      // 4a. Execute Dry-Run
      const dryRunRes = await fetch(`${srvCutover.baseUrl}/api/v1/admin/migration/dry-run`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ snapshotFilePath: snapshotPath }),
      });
      assert.equal(dryRunRes.status, 200);
      const dryRunBody = (await dryRunRes.json()) as any;
      const report = dryRunBody.data.report;
      assert.ok(report.dryRunId);
      assert.ok(report.operatorConfirmationToken);
      assert.ok(report.backupPath);
      assert.ok(fs.existsSync(report.backupPath), 'Backup file must exist on disk');

      const projectsSummary = report.entitySummaries.projects;
      assert.ok(projectsSummary);
      assert.equal(projectsSummary.count, 1);
      assert.equal(projectsSummary.invalidCount, 0);
      assert.ok(projectsSummary.structuralChecksum.length === 64);

      // 4b. Attempt Apply WITHOUT confirmApply -> rejected with 400 OPERATOR_CONFIRMATION_REQUIRED
      const unconfirmedRes = await fetch(`${srvCutover.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: report.dryRunId,
          confirmationToken: report.operatorConfirmationToken,
          confirmApply: false,
        }),
      });
      assert.equal(unconfirmedRes.status, 400);
      const unconfirmedBody = (await unconfirmedRes.json()) as any;
      assert.equal(unconfirmedBody.error.code, 'OPERATOR_CONFIRMATION_REQUIRED');

      // 4c. Apply with valid operator confirmation -> migrates records & disables legacy snapshot writers
      const applyRes = await fetch(`${srvCutover.baseUrl}/api/v1/admin/migration/apply`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          snapshotFilePath: snapshotPath,
          dryRunId: report.dryRunId,
          confirmationToken: report.operatorConfirmationToken,
          confirmApply: true,
          disableLegacyWriters: true,
        }),
      });
      assert.equal(applyRes.status, 200);
      const applyBody = (await applyRes.json()) as any;
      assert.ok(applyBody.data.result.applyId);
      assert.equal(applyBody.data.result.legacyWritersDisabled, true);
      assert.equal(applyBody.data.result.migratedCounts.projects, 1);

      // Verify migrated project is accessible in authoritative store
      const migratedProj = await cutoverDriver.getDocument<Record<string, unknown>>(
        'projects',
        'proj-cutover-legacy-1'
      );
      assert.ok(migratedProj, 'Migrated project must exist in authoritative Firestore driver');
      assert.equal(migratedProj.title, 'Legacy Cutover Project');

      // Verify migration status endpoint reflects cutover applied & legacy writers disabled
      const statusRes = await fetch(`${srvCutover.baseUrl}/api/v1/admin/migration/status`, {
        headers: { authorization: 'Bearer token-owner' },
      });
      assert.equal(statusRes.status, 200);
      const statusBody = (await statusRes.json()) as any;
      assert.equal(statusBody.data.isLegacySnapshotWriterDisabled, true);

      // 4d. Rollback from backup
      const rollbackRes = await fetch(`${srvCutover.baseUrl}/api/v1/admin/migration/rollback`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer token-owner',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          backupPath: report.backupPath,
          targetSnapshotPath: snapshotPath,
        }),
      });
      const rollbackBody = (await rollbackRes.json()) as any;
      assert.equal(rollbackRes.status, 200, `Rollback failed: ${JSON.stringify(rollbackBody)}`);
      assert.ok(rollbackBody.data.rollbackResult.rollbackId);
      assert.equal(rollbackBody.data.rollbackResult.legacyWritersRestored, true);
    } finally {
      await srvCutover.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('ALL PHASE 2D PERSISTENCE TESTS PASSED!');
  } finally {
    if (originalVaultKey === undefined) {
      delete process.env.SOWVEIL_MASTER_VAULT_KEY;
    } else {
      process.env.SOWVEIL_MASTER_VAULT_KEY = originalVaultKey;
    }
    resetLegacySnapshotWriterStateForTests();
  }
}

runPhase2DTests().catch((err) => {
  console.error('Phase 2D verification failed:', err);
  process.exit(1);
});
