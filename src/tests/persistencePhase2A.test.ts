import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp } from '../server/apiApp';
import {
  AuthoritativeFirestorePersistenceAdapter,
  LocalSnapshotPersistenceAdapter,
  RuleEnforcingFirestoreTestDriver,
} from '../server/persistenceAdapters';
import {
  deserializeProjectFromFirestoreDto,
  deserializeRenderExportJobFromFirestoreDto,
  ISowveilPersistenceAdapter,
  PersistenceContractError,
  serializeProjectToFirestoreDto,
  serializeProviderConnectionSplitDto,
  serializeRenderExportJobToFirestoreDto,
} from '../services/persistenceContracts';
import { classifyLocalSnapshotStore } from '../server/durableStore';
import { encryptCredentialForVault } from '../server/credentialVault';
import { ProjectLibraryItem } from '../types/sowveil';
import { ProviderConnectionRecord } from '../services/providerHubEngine';
import { DurableRenderExportJobRecord } from '../services/renderExportQaEngine';

const TEST_MASTER_VAULT_KEY = 'phase2a-contract-test-master-vault-key-2026-strong';

function runAdapterContractSuite(
  suiteName: string,
  createAdapter: () => {
    adapter: ISowveilPersistenceAdapter;
    setSimulatedFailure: (
      mode: 'none' | 'read-error' | 'write-error' | 'permission-denied',
      msg?: string
    ) => void;
  }
) {
  describe(`Persistence Contract Suite: ${suiteName}`, () => {
    it('1. Preserves Project ID, ownerUid, createdAt, revision monotonicity, and migrationMetadata', async () => {
      const { adapter } = createAdapter();
      const initialProject: ProjectLibraryItem = {
        id: 'proj_canonical_101',
        ownerUid: 'user_alice',
        title: 'Neon SaaS Launch Trailer',
        description: 'Canonical v2.0.0 project timeline',
        compCount: 4,
        projectFileStatus: 'sowveil-native',
        fileSizeBytes: 18400,
        fileSizeLabel: '18.4 KB',
        revision: 1,
        activeBranch: 'main',
        hasExternalFootageWarning: false,
        archived: false,
        tags: ['saas', 'launch'],
        createdAt: '2026-10-28T12:00:00.000Z',
        updatedAt: '2026-10-28T12:00:00.000Z',
      };

      const created = await adapter.projects.create(initialProject, {
        dtoSchemaVersion: '2.0.0',
        migratedFromVersion: '1.0.0',
        migrationWarnings: ['Normalized easing handles'],
      });
      assert.equal(created.id, 'proj_canonical_101');
      assert.equal(created.ownerUid, 'user_alice');
      assert.equal(created.revision, 1);

      // Update with valid expectedRevision increments revision monotonically
      const updated = await adapter.projects.update(
        'proj_canonical_101',
        'user_alice',
        { title: 'Neon SaaS Launch Trailer v2' },
        { expectedRevision: 1 }
      );
      assert.equal(updated.id, 'proj_canonical_101');
      assert.equal(updated.ownerUid, 'user_alice');
      assert.equal(updated.createdAt, '2026-10-28T12:00:00.000Z');
      assert.equal(updated.revision, 2);
      assert.equal(updated.title, 'Neon SaaS Launch Trailer v2');

      // Stale expectedRevision must fail with REVISION_CONFLICT (409)
      await assert.rejects(
        () =>
          adapter.projects.update(
            'proj_canonical_101',
            'user_alice',
            { title: 'Stale Overwrite' },
            { expectedRevision: 1 }
          ),
        (err: unknown) =>
          err instanceof PersistenceContractError &&
          err.code === 'REVISION_CONFLICT' &&
          err.statusCode === 409
      );

      // Mutating immutable id, ownerUid, or createdAt must fail closed
      await assert.rejects(
        () =>
          adapter.projects.update('proj_canonical_101', 'user_alice', {
            id: 'proj_hijacked_id',
          }),
        (err: unknown) =>
          err instanceof PersistenceContractError &&
          err.code === 'IMMUTABLE_IDENTITY_VIOLATION'
      );

      await assert.rejects(
        () =>
          adapter.projects.update('proj_canonical_101', 'user_alice', {
            ownerUid: 'user_bob',
          }),
        (err: unknown) =>
          err instanceof PersistenceContractError &&
          err.code === 'IMMUTABLE_OWNER_VIOLATION'
      );

      // Cross-user access must fail closed with CROSS_USER_ACCESS_FORBIDDEN (403)
      await assert.rejects(
        () => adapter.projects.getById('proj_canonical_101', 'user_mallory'),
        (err: unknown) =>
          err instanceof PersistenceContractError &&
          err.code === 'CROSS_USER_ACCESS_FORBIDDEN' &&
          err.statusCode === 403
      );
    });

    it('2. Separates ProviderConnection metadata from AES-256-GCM Server Vault secrets', async () => {
      const { adapter } = createAdapter();
      const encrypted = encryptCredentialForVault(
        'AIzaSyTestSecretKeyForPhase2AVerification99',
        {
          ownerUid: 'user_alice',
          workspaceId: 'ws_user_alice',
          connectionId: 'conn_gemini_1',
          protocol: 'google-gemini',
        },
        1,
        TEST_MASTER_VAULT_KEY
      );

      const fullRecord: ProviderConnectionRecord = {
        id: 'conn_gemini_1',
        ownerUid: 'user_alice',
        workspaceId: 'ws_user_alice',
        label: 'Primary Gemini Production Key',
        providerBrand: 'google-gemini',
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        endpointSettings: {},
        modelId: 'gemini-2.5-flash',
        authMode: 'x-api-key',
        storageMode: 'server-encrypted-vault',
        storageSecurityWarning: null,
        maskedCredential: 'AIza...n99',
        credentialFingerprint: 'fp_sha256_test',
        credentialStatus: 'active',
        encryptedCredential: encrypted,
        keyVersion: 1,
        timeoutMs: 15000,
        maxOutputTokens: 4096,
        allowedTaskTypes: ['script-analysis', 'planning'],
        capabilities: {} as ProviderConnectionRecord['capabilities'],
        fallbackConnectionId: null,
        budgetPolicy: {
          mode: 'hard-stop',
          monthlyLimitUsd: 25,
          spentCurrentMonthUsd: 0,
          maxPerRequestUsd: 0.5,
          rateLimitRpm: 30,
        },
        lastTestedAt: null,
        lastTestStatus: 'Not tested',
        lastSanitizedError: null,
        createdAt: '2026-10-29T00:00:00.000Z',
        updatedAt: '2026-10-29T00:00:00.000Z',
        rotatedAt: null,
      };

      const savedMeta = await adapter.providerConnections.saveMetadata(fullRecord);
      assert.equal(savedMeta.id, 'conn_gemini_1');
      assert.equal(savedMeta.maskedCredential, 'AIza...n99');
      assert.equal(
        'encryptedCredential' in (savedMeta as unknown as Record<string, unknown>),
        false,
        'Public/Firestore provider metadata DTO must never contain encryptedCredential'
      );

      // Server-only vault repository holds the encrypted payload scoped to ownerUid
      const vaultSecret = await adapter.credentialVault.getVaultSecret(
        'conn_gemini_1',
        'user_alice'
      );
      assert.ok(vaultSecret);
      assert.equal(vaultSecret.encryptedCredential.ciphertextHex, encrypted.ciphertextHex);

      // Another user cannot read the vault secret
      await assert.rejects(
        () => adapter.credentialVault.getVaultSecret('conn_gemini_1', 'user_mallory'),
        (err: unknown) =>
          err instanceof PersistenceContractError &&
          err.code === 'CROSS_USER_ACCESS_FORBIDDEN'
      );
    });

    it('3. Strips binary media from RenderExportJob Firestore DTOs while keeping truthful metadata', async () => {
      const { adapter } = createAdapter();
      const fakePngBase64 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC', 'utf8').toString('base64');

      const job: DurableRenderExportJobRecord = {
        id: 'rjob_phase2a_1',
        ownerUid: 'user_alice',
        projectId: 'proj_canonical_101',
        projectTitle: 'Neon SaaS Launch Trailer',
        projectRevision: 2,
        directorSessionId: null,
        executionTier: 'final-render',
        outputFormat: 'png-frame',
        targetAdapter: 'sowveil-project',
        requestedWidth: 1920,
        requestedHeight: 1080,
        requestedFps: 30,
        requestedDurationSec: 5,
        sampleTimestampSec: 1,
        downscaleAssetsForProxy: false,
        stage: 'ready',
        cancellable: false,
        completedWorkUnits: 4,
        totalWorkUnits: 4,
        progressPercent: 100,
        stageHistory: [],
        retryPolicy: {
          attemptCount: 1,
          maxAttempts: 3,
          backoffBaseMs: 1000,
          nextEligibleRetryAt: null,
          lastFailureReason: null,
        },
        errorCode: null,
        sanitizedErrorMessage: null,
        serverWorkerDisclosure: {
          serverWorkerRequired: false,
          serverWorkerConfigured: false,
          userApprovedDataUpload: false,
          estimatedDataTransferBytes: 0,
          estimatedCostUsd: 0,
          status: 'local-eligible',
          disclosureMessage: 'Rendered locally in server memory.',
        },
        featureLossReport: {} as DurableRenderExportJobRecord['featureLossReport'],
        qaReport: null,
        artifactMetadata: {
          fileName: 'frame.png',
          mimeType: 'image/png',
          container: 'png',
          codec: 'rgba-deflate',
          sizeBytes: 64,
          sha256: 'abc123sha256',
          crc32Hex: '1a2b3c4d',
          width: 1920,
          height: 1080,
          fps: 30,
          durationSec: 5,
          projectRevision: 2,
          rendererVersion: '2.0.0',
          validatedAfterWrite: true,
          validationSummary: 'IHDR verified',
        },
        artifactBytesBase64: fakePngBase64,
        createdAt: '2026-10-29T01:00:00.000Z',
        updatedAt: '2026-10-29T01:00:05.000Z',
        completedAt: '2026-10-29T01:00:05.000Z',
      };

      const rawDto = serializeRenderExportJobToFirestoreDto(job, false);
      assert.equal(rawDto.storagePersistenceMode, 'metadata-only-ephemeral');
      assert.equal(
        rawDto.jobMetadataJson.includes(fakePngBase64),
        false,
        'Binary artifactBytesBase64 must never be serialized into Firestore jobMetadataJson'
      );

      // Deserializing from Firestore without transient buffer yields artifactBytesBase64: null
      const rehydratedAfterColdStart = deserializeRenderExportJobFromFirestoreDto(rawDto, null);
      assert.equal(rehydratedAfterColdStart.artifactBytesBase64, null);
      assert.equal(rehydratedAfterColdStart.artifactMetadata?.sha256, 'abc123sha256');

      await adapter.renderExportJobs.saveJob(job, { cloudStorageEnabled: false });
      const fetched = await adapter.renderExportJobs.getJobById('rjob_phase2a_1', 'user_alice');
      assert.ok(fetched);
      assert.equal(fetched.id, 'rjob_phase2a_1');
    });

    it('4. Enforces atomic Owner Bootstrap Lock and append-only Audit Events', async () => {
      const { adapter } = createAdapter();
      const initialLock = await adapter.governance.getOwnerBootstrapLock();
      assert.equal(initialLock, null);

      const claimed = await adapter.governance.claimOwnerBootstrapLock(
        'owner_uid_1',
        'development'
      );
      assert.equal(claimed.bootstrapped, true);
      assert.equal(claimed.ownerUid, 'owner_uid_1');
      assert.equal(await adapter.governance.getRole('owner_uid_1'), 'owner');

      // Second claim attempt must fail closed with BOOTSTRAP_LOCK_ALREADY_CLAIMED (409)
      await assert.rejects(
        () => adapter.governance.claimOwnerBootstrapLock('attacker_uid_2', 'development'),
        (err: unknown) =>
          err instanceof PersistenceContractError &&
          err.code === 'BOOTSTRAP_LOCK_ALREADY_CLAIMED' &&
          err.statusCode === 409
      );
    });

    it('5. Fails closed on datastore errors and NEVER silently falls back to Map/localStorage', async () => {
      const { adapter, setSimulatedFailure } = createAdapter();
      assert.equal(adapter.silentFallbackToMemoryEnabled, false);

      setSimulatedFailure('write-error', 'Firestore network transport unavailable');
      await assert.rejects(
        () =>
          adapter.projects.create({
            id: 'proj_fail_closed_1',
            ownerUid: 'user_alice',
            title: 'Should Not Silently Succeed',
            description: '',
            compCount: 1,
            projectFileStatus: 'metadata-only',
            fileSizeBytes: null,
            fileSizeLabel: 'Unknown',
            hasExternalFootageWarning: false,
            tags: [],
            updatedAt: '2026-10-29T01:00:00.000Z',
          }),
        (err: unknown) =>
          err instanceof PersistenceContractError &&
          err.code === 'AUTHORITATIVE_STORE_WRITE_FAILED' &&
          err.statusCode === 503
      );

      // Re-enable reads and confirm the failed write was NOT stored in any fallback Map
      setSimulatedFailure('none');
      const ghost = await adapter.projects.getById('proj_fail_closed_1', 'user_alice');
      assert.equal(ghost, null);
    });
  });
}

// Run shared contract suite against BOTH LocalSnapshotPersistenceAdapter and AuthoritativeFirestorePersistenceAdapter
runAdapterContractSuite('LocalSnapshotPersistenceAdapter (Dev/Test Adapter)', () => {
  const adapter = new LocalSnapshotPersistenceAdapter({
    nodeEnv: 'test',
    cloudStorageEnabled: false,
  });
  return {
    adapter,
    setSimulatedFailure: (mode, msg) => adapter.setSimulatedFailure(mode, msg),
  };
});

runAdapterContractSuite('AuthoritativeFirestorePersistenceAdapter (Production Contract Adapter)', () => {
  const driver = new RuleEnforcingFirestoreTestDriver();
  const adapter = new AuthoritativeFirestorePersistenceAdapter({
    driver,
    cloudStorageEnabled: false,
  });
  return {
    adapter,
    setSimulatedFailure: (mode, msg) => driver.setSimulatedFailure(mode, msg),
  };
});

describe('Phase 2A: Production Readiness Gate, Snapshot Classification & Sanitized Diagnostics', () => {
  it('Marks JSON snapshot store as development-test-only unless SOWVEIL_ALLOW_SHARED_FS_SNAPSHOT=true', () => {
    assert.equal(
      classifyLocalSnapshotStore({ allowSharedFilesystemInProd: false }),
      'development-test-only'
    );
    assert.equal(
      classifyLocalSnapshotStore({ allowSharedFilesystemInProd: true }),
      'configured-shared-filesystem'
    );

    const devSnapAdapter = new LocalSnapshotPersistenceAdapter({
      nodeEnv: 'production',
      allowSharedFilesystemInProd: false,
      refuseUnreadyProductionStartup: false,
    });
    const report = devSnapAdapter.getReadinessReport();
    assert.equal(report.isDevelopmentOrTestOnly, true);
    assert.equal(report.readyForProductionTraffic, false);
    assert.equal(report.status, 'blocked');
    assert.equal(report.blockerCode, 'PRODUCTION_DURABLE_ADAPTER_REQUIRED');

    // When refuseUnreadyProductionStartup is enabled in production with dev snapshot adapter, startup throws
    assert.throws(
      () =>
        new LocalSnapshotPersistenceAdapter({
          nodeEnv: 'production',
          allowSharedFilesystemInProd: false,
          refuseUnreadyProductionStartup: true,
        }),
      (err: unknown) =>
        err instanceof PersistenceContractError &&
        err.code === 'PRODUCTION_DURABLE_ADAPTER_REQUIRED'
    );
  });

  it('Exposes sanitized persistence diagnostics and blocks /api/v1/ready in production when using dev snapshot adapter', async () => {
    const appBlockedProd = createApiApp({
      nodeEnv: 'production',
      persistenceFilePath: null,
      allowSharedFilesystemInProd: false,
      refuseUnreadyProductionStartup: false,
    });
    const serverBlocked = http.createServer(appBlockedProd);
    await new Promise<void>((resolve) => serverBlocked.listen(0, '127.0.0.1', resolve));
    const portBlocked = (serverBlocked.address() as { port: number }).port;

    try {
      const readyRes = await fetch(`http://127.0.0.1:${portBlocked}/api/v1/ready`);
      assert.equal(readyRes.status, 503);
      const readyJson = (await readyRes.json()) as {
        ok: boolean;
        error: { code: string; details: { persistenceReadiness: { status: string; activeAdapterKind: string } } };
      };
      assert.equal(readyJson.ok, false);
      assert.equal(readyJson.error.code, 'PRODUCTION_DURABLE_ADAPTER_REQUIRED');
      assert.equal(readyJson.error.details.persistenceReadiness.status, 'blocked');
      assert.equal(
        readyJson.error.details.persistenceReadiness.activeAdapterKind,
        'local-json-snapshot-dev-only'
      );

      const diagRes = await fetch(`http://127.0.0.1:${portBlocked}/api/v1/diagnostics/persistence`);
      assert.equal(diagRes.status, 200);
      const diagText = await diagRes.text();
      assert.equal(diagText.includes(TEST_MASTER_VAULT_KEY), false);
      const diagJson = JSON.parse(diagText);
      assert.equal(diagJson.data.redactionPolicy.exposesMasterVaultKey, false);
      assert.equal(diagJson.data.redactionPolicy.exposesProviderCredentials, false);
      assert.equal(diagJson.data.redactionPolicy.exposesPrivateProjectPayloads, false);
    } finally {
      await new Promise<void>((resolve) => serverBlocked.close(() => resolve()));
    }

    // Now verify /api/v1/ready returns 200 when configured with AuthoritativeFirestorePersistenceAdapter in production
    const appReadyProd = createApiApp({
      nodeEnv: 'production',
      persistenceAdapter: new AuthoritativeFirestorePersistenceAdapter(),
    });
    const serverReady = http.createServer(appReadyProd);
    await new Promise<void>((resolve) => serverReady.listen(0, '127.0.0.1', resolve));
    const portReady = (serverReady.address() as { port: number }).port;

    try {
      const readyRes = await fetch(`http://127.0.0.1:${portReady}/api/v1/ready`);
      assert.equal(readyRes.status, 200);
      const readyJson = (await readyRes.json()) as {
        ok: boolean;
        data: { status: string; readyForProductionTraffic: boolean };
      };
      assert.equal(readyJson.ok, true);
      assert.equal(readyJson.data.status, 'ready');
      assert.equal(readyJson.data.readyForProductionTraffic, true);
    } finally {
      await new Promise<void>((resolve) => serverReady.close(() => resolve()));
    }
  });

  it('Rejects local blob: URLs and oversized binary payloads in Project DTO serialization', () => {
    assert.throws(
      () =>
        serializeProjectToFirestoreDto({
          id: 'proj_blob_reject',
          ownerUid: 'user_alice',
          title: 'Project with blob:http://localhost:3000/1234',
          description: 'Invalid cloud url',
          compCount: 1,
          projectFileStatus: 'metadata-only',
          fileSizeBytes: null,
          fileSizeLabel: 'Unknown',
          hasExternalFootageWarning: false,
          tags: [],
          updatedAt: '2026-10-29T01:00:00.000Z',
        }),
      (err: unknown) =>
        err instanceof PersistenceContractError && err.code === 'STORAGE_NOT_CONFIGURED'
    );

    const dto = serializeProjectToFirestoreDto(
      {
        id: 'proj_roundtrip_1',
        ownerUid: 'user_alice',
        title: 'Clean Project',
        description: 'Valid metadata',
        compCount: 2,
        projectFileStatus: 'sowveil-native',
        fileSizeBytes: 2048,
        fileSizeLabel: '2 KB',
        revision: 4,
        hasExternalFootageWarning: false,
        tags: ['clean'],
        createdAt: '2026-10-28T00:00:00.000Z',
        updatedAt: '2026-10-29T01:00:00.000Z',
      },
      { dtoSchemaVersion: '2.0.0', migratedFromVersion: '1.0.0' }
    );
    const roundTrip = deserializeProjectFromFirestoreDto(dto);
    assert.equal(roundTrip.project.id, 'proj_roundtrip_1');
    assert.equal(roundTrip.project.revision, 4);
    assert.equal(roundTrip.migrationMetadata?.dtoSchemaVersion, '2.0.0');
  });
});
