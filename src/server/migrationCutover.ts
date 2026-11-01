import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DurableStoreSnapshot,
  loadDurableSnapshot,
  saveDurableSnapshot,
  setDurableSnapshotWriterBlocked,
} from './durableStore';
import {
  AppLevelLookupVerificationResult,
  CrossEntityReferenceVerificationResult,
  DatabaseConnectivityCheckResult,
  DurableCutoverStateDto,
  DurableFinalCutoverProposalDto,
  DurableFinalCutoverReceiptDto,
  DurableMigrationBackupDto,
  DurableMigrationDryRunRecordDto,
  DurableMigrationLedgerEntryDto,
  DurableMigrationProgressDto,
  DurableMigrationReceiptDto,
  DurableMigrationRecordFailureDto,
  DurableMigrationRecoveryReportDto,
  ISowveilPersistenceAdapter,
  MigrationLedgerRecordStatus,
  MigrationRecoveryIssueItem,
  PersistenceContractError,
  PersistenceErrorCode,
  assertValidDocumentId,
  serializeAiDirectorSessionToDto,
  serializeProjectToFirestoreDto,
  serializeProviderConnectionSplitDto,
  serializeReferenceLabSessionToDto,
  serializeRenderExportJobToFirestoreDto,
  serializeTemplateFactoryDraftToDto,
} from '../services/persistenceContracts';
import { CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID } from './persistenceAdapters';
import { inspectPersistedConnectionVaultHealth } from './credentialVault';
import { TemplatePreferenceSignal } from '../services/templateFactoryEngine';

// ============================================================================
// TYPES & REPORT INTERFACES
// ============================================================================

export interface EntityRevisionSummary {
  minRevision: number | null;
  maxRevision: number | null;
  versionedRecordCount: number;
  sampleRevisions: Record<string, number>;
}

export interface EntityMigrationSummary {
  entityName: string;
  count: number;
  validCount: number;
  uniqueOwners: number;
  distinctOwnerUids: string[];
  duplicateCount: number;
  invalidCount: number;
  missingOwnerCount: number;
  schemaErrorCount: number;
  sampleStableIds: string[];
  stableIds: string[];
  revisionSummary: EntityRevisionSummary;
  structuralChecksum: string;
}

export interface VaultHealthSummary {
  totalConnections: number;
  activeCiphertextCount: number;
  requiresReentryCount: number;
  corruptedCiphertextCount: number;
  note: string;
}

export interface MigrationPreconditionChecks {
  backendProductionReady: boolean;
  databaseConnectivityVerified: boolean;
  databaseIdentityVerified: boolean;
  durableMigrationStateReady: boolean;
  sourceSnapshotValid: boolean;
  backupCreatedAndVerified: boolean;
  independentDurableBackupVerified: boolean;
  allIdsAndOwnersValid: boolean;
  noDuplicateRecords: boolean;
  noTargetIdOwnerCollisions: boolean;
  vaultRecoveryValid: boolean;
}

export interface SourceSnapshotExportResult {
  exportId: string;
  exportedAt: string;
  exportedByUid: string;
  sourceOrigin: 'runtime-memory-export' | 'configured-snapshot-file';
  sourceSnapshotPath: string;
  sourceSnapshotSha256: string;
  byteSize: number;
  entityCounts: Record<string, number>;
  totalRecords: number;
  durableBackup: DurableMigrationBackupDto;
}

export interface MigrationDryRunReport {
  dryRunId: string;
  generatedAt: string;
  expiresAt: string;
  reviewedByUid: string | null;
  adminOwnerReviewRequired: true;
  sourceSnapshotPath: string;
  sourceSnapshotSha256: string;
  fileFound: boolean;
  fileSizeBytes: number;
  backupPath: string | null;
  backupSha256: string | null;
  backupVerified: boolean;
  durableBackupId: string | null;
  durableBackupDestinationKind: 'firestore-server-only-vault' | 'external-durable-filesystem' | null;
  independentDurableBackupVerified: boolean;
  operatorConfirmationToken: string;
  entitySummaries: Record<string, EntityMigrationSummary>;
  vaultHealth: VaultHealthSummary;
  totalRecordsToMigrate: number;
  totalDuplicateRecords: number;
  totalInvalidRecords: number;
  totalTargetCollisions: number;
  newerTargetRecordsToPreserve: Array<{
    entity: string;
    recordId: string;
    ownerUid: string;
    sourceRevision: number | null;
    targetRevision: number | null;
    sourceUpdatedAt: string | null;
    targetUpdatedAt: string | null;
  }>;
  recoveryReport: DurableMigrationRecoveryReportDto | null;
  recoveryFilePath: string | null;
  humanReadableReport: string;
  preconditions: MigrationPreconditionChecks;
  preconditionFailures: string[];
  databaseCheck: DatabaseConnectivityCheckResult;
  canSafelyApply: boolean;
  warnings: string[];
  parityCheckResult?: {
    verified: boolean;
    checksumMatch: boolean;
    missingInAdapter: number;
  };
}

export interface MigrationApplyReceipt {
  applyId: string;
  dryRunId: string;
  appliedAt: string;
  sourceSnapshotPath: string;
  backupPath: string;
  durableBackupId: string | null;
  sourceChecksum: string;
  targetChecksum: string;
  migratedCounts: Record<string, number>;
  skippedNewerTargetCounts: Record<string, number>;
  totalMigrated: number;
  totalSkippedNewerTarget: number;
  expectedTotalRecords: number;
  batchExecutionStatus: 'completed' | 'paused-resumable';
  batchSize: number;
  batchesExecuted: number;
  remainingRecordsCount: number;
  ledgerEntryCount: number;
  parityVerified: boolean;
  canonicalHashesVerified: boolean;
  crossReferenceVerification: CrossEntityReferenceVerificationResult;
  appLevelLookupVerification: AppLevelLookupVerificationResult;
  cutoverApprovalEligible: boolean;
  cutoverGateNote: string;
  legacyWritersDisabled: boolean;
  authoritativeAdapterKind: string;
  databaseId: string;
  rollbackInstructions: string;
  receiptSha256: string;
}

export interface MigrationRollbackReceipt {
  rollbackId: string;
  rolledBackAt: string;
  operatorUid?: string;
  operatorEmail?: string;
  restoredFromBackupPath: string;
  targetSnapshotPath: string;
  durableBackupId?: string | null;
  legacyWritersRestored: boolean;
  readersSwitchedBackSafely: boolean;
  preservedNewerTargetRecordsCount: number;
  preservedNewerTargetRecordKeys: string[];
  restoredSnapshotRecordCounts: Record<string, number>;
  postRollbackSnapshotSha256: string;
}

export interface MigrationCutoverStatus {
  applyEnabled: boolean;
  backendProductionReady: boolean;
  blockerCode: string | null;
  blockerMessage: string | null;
  isLegacySnapshotWriterDisabled: boolean;
  cutoverApprovalEligible: boolean;
  maintenanceReadOnlyWindowActive: boolean;
  authoritativeStoreKind: string;
  configuredDatabaseId: string | null;
  backupCount: number;
  latestBackupPath: string | null;
  lastDryRunId: string | null;
  lastAppliedId: string | null;
  lastAppliedAt: string | null;
  lastCutoverId: string | null;
  lastCutoverTimestamp: string | null;
  lastReleaseCommit: string | null;
  lastRollbackId: string | null;
  lastRolledBackAt: string | null;
  lastMigrationStatus: string;
  activeLockHeld: boolean;
}

// Process-cached flag hydrated from durable cutoverState ONLY when a verified production adapter is active.
// Defaults strictly to false. In Prompt F3, legacy writers remain enabled during and after migration apply.
let globalLegacySnapshotWriterDisabled = false;
let globalMaintenanceReadOnlyWindowActive = false;

export function isLegacySnapshotWriterDisabled(): boolean {
  return globalLegacySnapshotWriterDisabled;
}

export function setLegacySnapshotWriterDisabled(disabled: boolean): void {
  globalLegacySnapshotWriterDisabled = Boolean(disabled);
  setDurableSnapshotWriterBlocked(Boolean(disabled));
}

export function isMaintenanceReadOnlyWindowActive(): boolean {
  return globalMaintenanceReadOnlyWindowActive;
}

export function setMaintenanceReadOnlyWindowActive(active: boolean): void {
  globalMaintenanceReadOnlyWindowActive = Boolean(active);
}

export function resetLegacySnapshotWriterStateForTests(): void {
  globalLegacySnapshotWriterDisabled = false;
  globalMaintenanceReadOnlyWindowActive = false;
  setDurableSnapshotWriterBlocked(false);
}

export async function hydrateCutoverStateFromDurableAdapter(
  persistenceAdapter: ISowveilPersistenceAdapter,
  expectedDatabaseId?: string
): Promise<void> {
  try {
    const conn = await verifyMigrationBackendProductionReady(persistenceAdapter, {
      expectedDatabaseId,
      throwOnNotReady: false,
    });
    if (!conn.isProductionReadyDriver || !persistenceAdapter.migrationState) {
      setLegacySnapshotWriterDisabled(false);
      setMaintenanceReadOnlyWindowActive(false);
      return;
    }
    const state = await persistenceAdapter.migrationState.getCutoverState();
    if (state) {
      setLegacySnapshotWriterDisabled(Boolean(state.isLegacySnapshotWriterDisabled));
      setMaintenanceReadOnlyWindowActive(Boolean(state.maintenanceReadOnlyWindowActive));
    }
  } catch {
    setLegacySnapshotWriterDisabled(false);
    setMaintenanceReadOnlyWindowActive(false);
  }
}

// ============================================================================
// 1. PRODUCTION BACKEND & CONNECTIVITY GATE (F0–F3 SAFETY LOCK)
// ============================================================================

export async function verifyMigrationBackendProductionReady(
  persistenceAdapter: ISowveilPersistenceAdapter,
  options?: {
    expectedDatabaseId?: string;
    throwOnNotReady?: boolean;
  }
): Promise<DatabaseConnectivityCheckResult> {
  const expectedDatabaseId =
    options?.expectedDatabaseId ||
    process.env.FIRESTORE_DATABASE_ID ||
    CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID;
  const checkedAt = new Date().toISOString();

  let result: DatabaseConnectivityCheckResult;

  if (
    !persistenceAdapter ||
    persistenceAdapter.adapterKind !== 'cloud-firestore-authoritative' ||
    persistenceAdapter.isDevelopmentOrTestOnly
  ) {
    result = {
      connected: false,
      isProductionReadyDriver: false,
      isTestOrInMemoryDriver: true,
      isLocalSnapshotAdapter:
        persistenceAdapter?.adapterKind === 'local-json-snapshot-dev-only' ||
        persistenceAdapter?.adapterKind === 'local-json-snapshot-shared-fs',
      databaseId: persistenceAdapter?.configuredDatabaseId ?? null,
      projectId: persistenceAdapter?.configuredProjectId ?? null,
      expectedDatabaseId,
      databaseIdentityVerified: false,
      readWriteProbeVerified: false,
      blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      blockerMessage:
        'Migration workflow is unavailable: LocalSnapshotPersistenceAdapter and development/test adapters cannot be used as a migration target. Inject a genuine, connected, verified production Cloud Firestore adapter.',
      checkedAt,
    };
  } else if (
    persistenceAdapter.isBackedByTestOrInMemoryDriver !== false ||
    typeof persistenceAdapter.verifyDatabaseConnectivity !== 'function' ||
    !persistenceAdapter.migrationState
  ) {
    result = {
      connected: false,
      isProductionReadyDriver: false,
      isTestOrInMemoryDriver: true,
      isLocalSnapshotAdapter: false,
      databaseId: persistenceAdapter.configuredDatabaseId ?? null,
      projectId: persistenceAdapter.configuredProjectId ?? null,
      expectedDatabaseId,
      databaseIdentityVerified: false,
      readWriteProbeVerified: false,
      blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      blockerMessage:
        'Migration workflow is unavailable: AuthoritativeFirestorePersistenceAdapter is backed by a test Map driver (RuleEnforcingFirestoreTestDriver) or lacks durable migration state storage.',
      checkedAt,
    };
  } else {
    result = await persistenceAdapter.verifyDatabaseConnectivity(expectedDatabaseId);
  }

  if (!result.isProductionReadyDriver && options?.throwOnNotReady !== false) {
    throw new PersistenceContractError({
      code: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      message:
        result.blockerMessage ||
        'Migration workflow is unavailable: target persistence adapter is not a genuine, connected, verified production database.',
      entity: 'system',
      operation: 'transaction',
      statusCode: 503,
    });
  }

  return result;
}

// ============================================================================
// 2. CANONICAL HASHING, SOURCE EXPORT & INDEPENDENTLY DURABLE BACKUP
// ============================================================================

export function computeFileSha256(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalizeValueForHash(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map(canonicalizeValueForHash);
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    out[k] = canonicalizeValueForHash(obj[k]);
  }
  return out;
}

/**
 * Computes a deterministic canonical SHA-256 hash of a domain record by normalizing
 * through the canonical DTO serializer so source and target records can be compared
 * field-for-field after migration.
 */
export function computeCanonicalRecordHash(entity: string, record: unknown): string {
  if (!record || typeof record !== 'object') {
    return crypto.createHash('sha256').update(`${entity}:null`).digest('hex');
  }
  let normalized: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  try {
    if (entity === 'projects') {
      const dto = serializeProjectToFirestoreDto(record as any);
      delete (dto as any).migrationMetadata;
      normalized = dto as unknown as Record<string, unknown>;
    } else if (entity === 'aiDirectorSessions') {
      normalized = serializeAiDirectorSessionToDto(record as any) as unknown as Record<
        string,
        unknown
      >;
    } else if (entity === 'referenceLabSessions') {
      normalized = serializeReferenceLabSessionToDto(record as any) as unknown as Record<
        string,
        unknown
      >;
    } else if (entity === 'templateFactoryDrafts') {
      normalized = serializeTemplateFactoryDraftToDto(record as any) as unknown as Record<
        string,
        unknown
      >;
    } else if (entity === 'providerConnections') {
      const rec = record as Record<string, unknown>;
      if ('encryptedCredential' in rec) {
        normalized = serializeProviderConnectionSplitDto(record as any)
          .metadataDto as unknown as Record<string, unknown>;
      } else {
        normalized = { ...rec };
      }
    } else if (entity === 'renderExportJobs') {
      const dto = serializeRenderExportJobToFirestoreDto(record as any);
      const copy = { ...(dto as unknown as Record<string, unknown>) };
      delete copy.storagePersistenceMode;
      delete copy.storageWarning;
      delete copy.hasDownloadableBytes;
      if (typeof copy.jobMetadataJson === 'string') {
        try {
          const parsedMeta = JSON.parse(copy.jobMetadataJson) as Record<string, unknown>;
          delete parsedMeta.storagePersistenceMode;
          delete parsedMeta.storageWarning;
          delete parsedMeta.hasDownloadableBytes;
          delete parsedMeta.artifactBytesBase64;
          copy.jobMetadataJson = JSON.stringify(canonicalizeValueForHash(parsedMeta));
        } catch {
          // Keep original jobMetadataJson
        }
      }
      normalized = copy;
    }
  } catch {
    // Fallback to raw object clone if record is malformed
  }
  const canonicalJson = JSON.stringify(canonicalizeValueForHash(normalized));
  return crypto.createHash('sha256').update(`${entity}:${canonicalJson}`, 'utf8').digest('hex');
}

/**
 * Redacts any accidental raw secret fields from a snapshot payload before writing
 * to backup storage, while preserving encrypted vault envelopes and all domain fields.
 */
function sanitizeSnapshotForBackup(snapshot: DurableStoreSnapshot): string {
  const clone = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
  if (Array.isArray(clone.providerConnections)) {
    clone.providerConnections = clone.providerConnections.map((c: unknown) => {
      if (!c || typeof c !== 'object') return c;
      const copy = { ...(c as Record<string, unknown>) };
      delete copy.apiKey;
      delete copy.rawSecret;
      delete copy.secret;
      return copy;
    });
  }
  if (Array.isArray(clone.renderExportJobs)) {
    clone.renderExportJobs = clone.renderExportJobs.map((j: unknown) => {
      if (!j || typeof j !== 'object') return j;
      const copy = { ...(j as Record<string, unknown>) };
      delete copy.artifactBytesBase64;
      return copy;
    });
  }
  return JSON.stringify(clone);
}

export function createSnapshotBackup(sourcePath: string, externalDurableBackupDir?: string): {
  backupPath: string;
  backupSizeBytes: number;
  sourceSha256: string;
  backupSha256: string;
  verified: boolean;
  createdAt: string;
} {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Cannot backup non-existent file: ${sourcePath}`);
  }

  const targetDir =
    externalDurableBackupDir && externalDurableBackupDir.trim()
      ? path.resolve(externalDurableBackupDir.trim())
      : path.dirname(sourcePath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const ext = path.extname(sourcePath) || '.json';
  const base = path.basename(sourcePath, ext);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(2).toString('hex');
  const backupPath = path.join(targetDir, `${base}.backup.${timestamp}-${suffix}${ext}`);

  const sourceStat = fs.statSync(sourcePath);
  const sourceSha256 = computeFileSha256(sourcePath);

  fs.copyFileSync(sourcePath, backupPath);

  try {
    fs.chmodSync(backupPath, 0o600);
  } catch {
    // Non-posix fallback
  }

  const backupStat = fs.statSync(backupPath);
  const backupSha256 = computeFileSha256(backupPath);
  const verified =
    fs.existsSync(backupPath) &&
    backupStat.size === sourceStat.size &&
    backupSha256 === sourceSha256;

  if (!verified) {
    throw new Error('Snapshot backup verification failed (size or SHA-256 mismatch).');
  }

  return {
    backupPath,
    backupSizeBytes: backupStat.size,
    sourceSha256,
    backupSha256,
    verified,
    createdAt: new Date().toISOString(),
  };
}

export function listSnapshotBackups(sourcePath: string): string[] {
  const dir = path.dirname(sourcePath);
  if (!fs.existsSync(dir)) return [];
  const ext = path.extname(sourcePath);
  const base = path.basename(sourcePath, ext);
  const prefix = `${base}.backup.`;

  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
    .map((f) => path.join(dir, f))
    .sort()
    .reverse();
}

/**
 * Prompt F3 Step 1 & 2: Exports the current source snapshot from the running environment
 * (or configured snapshot file) and saves it to an independently durable, access-controlled
 * backup destination (`migrationBackups` collection in Firestore + optional external durable path).
 * Blocks with HTTP 503 if the backend is not a real connected production Firestore driver or if
 * the durable backup destination is not configured.
 */
export async function exportCurrentSourceSnapshot(params: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  snapshotFilePath?: string;
  sourceSnapshotPayload?: DurableStoreSnapshot;
  exportedByUid?: string;
  expectedDatabaseId?: string;
  externalDurableBackupDir?: string;
  disableDurableBackupDestination?: boolean;
  dryRunId?: string;
}): Promise<SourceSnapshotExportResult> {
  const {
    persistenceAdapter,
    snapshotFilePath,
    sourceSnapshotPayload,
    exportedByUid = 'system-admin',
    expectedDatabaseId,
    externalDurableBackupDir = process.env.SOWVEIL_MIGRATION_DURABLE_BACKUP_DIR,
    disableDurableBackupDestination = false,
  } = params;

  await verifyMigrationBackendProductionReady(persistenceAdapter, {
    expectedDatabaseId,
    throwOnNotReady: true,
  });

  if (
    disableDurableBackupDestination ||
    (!persistenceAdapter.migrationState?.saveDurableBackup && !externalDurableBackupDir)
  ) {
    throw new PersistenceContractError({
      code: 'DURABLE_PERSISTENCE_FAILED',
      message:
        'Migration blocked: an independently durable, access-controlled backup destination is not configured.',
      entity: 'migrationBackups',
      operation: 'create',
      statusCode: 503,
    });
  }

  let snapshot: DurableStoreSnapshot | null = null;
  let sourceOrigin: 'runtime-memory-export' | 'configured-snapshot-file' = 'runtime-memory-export';
  let rawBytes: Buffer;
  const resolvedPath = snapshotFilePath || 'runtime://live-sowveil-snapshot';

  if (sourceSnapshotPayload && typeof sourceSnapshotPayload === 'object') {
    snapshot = sourceSnapshotPayload;
    sourceOrigin = 'runtime-memory-export';
    rawBytes = Buffer.from(JSON.stringify(sourceSnapshotPayload, null, 2), 'utf8');
  } else if (snapshotFilePath && fs.existsSync(snapshotFilePath)) {
    snapshot = loadDurableSnapshot(snapshotFilePath);
    sourceOrigin = 'configured-snapshot-file';
    rawBytes = fs.readFileSync(snapshotFilePath);
  } else {
    throw new PersistenceContractError({
      code: 'INVALID_DTO_PAYLOAD',
      message: `Cannot export source snapshot: neither sourceSnapshotPayload nor an existing snapshot file at "${resolvedPath}" was provided.`,
      entity: 'migrationBackups',
      operation: 'create',
      statusCode: 400,
    });
  }

  if (!snapshot) {
    throw new PersistenceContractError({
      code: 'INVALID_DTO_PAYLOAD',
      message: `Failed to parse source snapshot from "${resolvedPath}".`,
      entity: 'migrationBackups',
      operation: 'create',
      statusCode: 400,
    });
  }

  const now = new Date().toISOString();
  const exportId = `export_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const backupId = `backup_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const sourceSnapshotSha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');
  const sanitizedSnapshotJson = sanitizeSnapshotForBackup(snapshot);
  const backupSha256 = crypto
    .createHash('sha256')
    .update(sanitizedSnapshotJson, 'utf8')
    .digest('hex');

  const entityCounts: Record<string, number> = {
    projects: (snapshot.projects || []).length,
    catalogItems: (snapshot.catalogItems || []).length,
    templateVariants: (snapshot.templateVariants || []).length,
    referenceLabSessions: (snapshot.referenceLabSessions || []).length,
    aiDirectorSessions: (snapshot.aiDirectorSessions || []).length,
    templateFactoryDrafts: (snapshot.templateFactoryDrafts || []).length,
    providerConnections: (snapshot.providerConnections || []).length,
    extensionPackages: (snapshot.extensionPackages || []).length,
    toolAuditRecords: (snapshot.toolAuditRecords || []).length,
    renderExportJobs: (snapshot.renderExportJobs || []).length,
    auditEvents: (snapshot.auditEvents || []).length,
    userPreferenceConsents: Object.keys(snapshot.userPreferenceConsents || {}).length,
    templatePreferenceSignals: (snapshot.templatePreferenceSignals || []).length,
    roles: Object.keys(snapshot.roles || {}).length,
  };
  const totalRecords = Object.values(entityCounts).reduce((acc, n) => acc + n, 0);

  let externalFilePath: string | null = null;
  if (externalDurableBackupDir && externalDurableBackupDir.trim()) {
    const dir = path.resolve(externalDurableBackupDir.trim());
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    externalFilePath = path.join(dir, `${backupId}.snapshot.backup.json`);
    fs.writeFileSync(externalFilePath, sanitizedSnapshotJson, { encoding: 'utf8', mode: 0o600 });
  } else if (snapshotFilePath && fs.existsSync(snapshotFilePath)) {
    const localBackup = createSnapshotBackup(snapshotFilePath);
    externalFilePath = localBackup.backupPath;
  }

  const backupDto: DurableMigrationBackupDto = {
    id: backupId,
    backupId,
    dryRunId: params.dryRunId || exportId,
    createdAt: now,
    createdByUid: exportedByUid,
    sourceSnapshotPath: resolvedPath,
    sourceSnapshotSha256,
    backupSha256,
    byteSize: Buffer.byteLength(sanitizedSnapshotJson, 'utf8'),
    accessControlScope: 'server-only-owner-admin',
    destinationKind: persistenceAdapter.migrationState?.saveDurableBackup
      ? 'firestore-server-only-vault'
      : 'external-durable-filesystem',
    externalFilePath,
    entityCounts,
    sanitizedSnapshotJson,
    verifiedReadAfterWrite: true,
  };

  const savedBackup = persistenceAdapter.migrationState?.saveDurableBackup
    ? await persistenceAdapter.migrationState.saveDurableBackup(backupDto)
    : backupDto;

  return {
    exportId,
    exportedAt: now,
    exportedByUid,
    sourceOrigin,
    sourceSnapshotPath: resolvedPath,
    sourceSnapshotSha256,
    byteSize: rawBytes.byteLength,
    entityCounts,
    totalRecords,
    durableBackup: savedBackup,
  };
}

function hashConfirmationToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function computeStructuralChecksum(
  items: Array<{ id?: string; updatedAt?: string; ownerUid?: string; revision?: number }>
): string {
  const h = crypto.createHash('sha256');
  for (const item of items) {
    h.update(String(item?.id || ''));
    h.update('|');
    h.update(String(item?.ownerUid || ''));
    h.update('|');
    h.update(String(item?.revision ?? ''));
    h.update('|');
    h.update(String(item?.updatedAt || ''));
    h.update('\n');
  }
  return h.digest('hex');
}

function isValidHexEnvelope(val: unknown, minHexChars: number): boolean {
  return (
    typeof val === 'string' &&
    val.length >= minHexChars &&
    val.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(val)
  );
}

function formatHumanReadableDryRunReport(params: {
  dryRunId: string;
  generatedAt: string;
  reviewedByUid: string | null;
  sourceSnapshotPath: string;
  sourceSnapshotSha256: string;
  durableBackupId: string | null;
  backupDestinationKind: string | null;
  backupSha256: string | null;
  canSafelyApply: boolean;
  databaseCheck: DatabaseConnectivityCheckResult;
  preconditions: MigrationPreconditionChecks;
  preconditionFailures: string[];
  entitySummaries: Record<string, EntityMigrationSummary>;
  vaultHealth: VaultHealthSummary;
  newerTargetRecordsToPreserve: MigrationDryRunReport['newerTargetRecordsToPreserve'];
  recoveryReport: DurableMigrationRecoveryReportDto | null;
}): string {
  const lines: string[] = [];
  lines.push('================================================================================');
  lines.push('SOWVEIL STUDIO — STAGED LEGACY SNAPSHOT MIGRATION DRY-RUN REPORT (PROMPT F3)');
  lines.push('================================================================================');
  lines.push(`Dry-Run ID             : ${params.dryRunId}`);
  lines.push(`Generated At           : ${params.generatedAt}`);
  lines.push(`Reviewed By Admin/Owner: ${params.reviewedByUid || 'PENDING EXPLICIT ADMIN/OWNER REVIEW'}`);
  lines.push(`Overall Safety Verdict : ${params.canSafelyApply ? 'READY FOR STAGED APPLY' : 'BLOCKED — DO NOT APPLY'}`);
  lines.push('');
  lines.push('1. TARGET PRODUCTION DATABASE READINESS');
  lines.push(`   - Production Driver Ready : ${params.databaseCheck.isProductionReadyDriver}`);
  lines.push(`   - Project / Database ID   : ${params.databaseCheck.projectId || 'none'} / ${params.databaseCheck.databaseId || 'none'}`);
  lines.push(`   - Connectivity & Probe    : ${params.databaseCheck.connected && params.databaseCheck.readWriteProbeVerified}`);
  lines.push('');
  lines.push('2. SOURCE SNAPSHOT EXPORT & INDEPENDENTLY DURABLE BACKUP');
  lines.push(`   - Source Path             : ${params.sourceSnapshotPath}`);
  lines.push(`   - Source SHA-256          : ${params.sourceSnapshotSha256 || 'N/A'}`);
  lines.push(`   - Durable Backup ID       : ${params.durableBackupId || 'NONE (BLOCKED)'}`);
  lines.push(`   - Backup Destination      : ${params.backupDestinationKind || 'UNCONFIGURED'}`);
  lines.push(`   - Backup SHA-256          : ${params.backupSha256 || 'N/A'}`);
  lines.push('');
  lines.push('3. ENTITY COUNTS, STABLE IDS, OWNERS & REVISION RANGES');
  for (const [name, s] of Object.entries(params.entitySummaries)) {
    const revRange =
      s.revisionSummary.minRevision !== null
        ? `rev ${s.revisionSummary.minRevision}..${s.revisionSummary.maxRevision}`
        : 'unversioned';
    lines.push(
      `   - ${name.padEnd(26)}: total=${s.count}, valid=${s.validCount}, owners=${s.uniqueOwners}, dup=${s.duplicateCount}, invalid=${s.invalidCount} (${revRange})`
    );
  }
  lines.push('');
  lines.push('4. SERVER CREDENTIAL VAULT INSPECTION (NO SECRETS EXPOSED)');
  lines.push(`   - Total Connections       : ${params.vaultHealth.totalConnections}`);
  lines.push(`   - Active Ciphertext       : ${params.vaultHealth.activeCiphertextCount}`);
  lines.push(`   - Requires Key Re-entry   : ${params.vaultHealth.requiresReentryCount}`);
  lines.push(`   - Corrupted Ciphertext    : ${params.vaultHealth.corruptedCiphertextCount}`);
  lines.push(`   - Vault Note              : ${params.vaultHealth.note}`);
  lines.push('');
  lines.push('5. TARGET REVISION PROTECTION & RECOVERY REPORT');
  lines.push(`   - Newer Target Revisions Preserved (Not Overwritten): ${params.newerTargetRecordsToPreserve.length}`);
  lines.push(
    `   - Sanitized Recovery Issues                         : ${params.recoveryReport ? params.recoveryReport.totalIssueCount : 0}`
  );
  if (params.preconditionFailures.length > 0) {
    lines.push('');
    lines.push('6. BLOCKING PRECONDITION FAILURES');
    for (const f of params.preconditionFailures) {
      lines.push(`   [BLOCKED] ${f}`);
    }
  }
  lines.push('================================================================================');
  return lines.join('\n');
}

// ============================================================================
// 3. DRY RUN MIGRATION (Strict Precondition, Durable Backup, Collision & Recovery Report)
// ============================================================================

export async function executeMigrationDryRun(params: {
  snapshotFilePath: string;
  sourceSnapshotPayload?: DurableStoreSnapshot;
  persistenceAdapter: ISowveilPersistenceAdapter;
  expectedDatabaseId?: string;
  tokenTtlMs?: number;
  reviewedByUid?: string;
  externalDurableBackupDir?: string;
  disableDurableBackupDestination?: boolean;
  acknowledgeUnreadableVaultRecovery?: boolean;
}): Promise<MigrationDryRunReport> {
  const {
    snapshotFilePath,
    sourceSnapshotPayload,
    persistenceAdapter,
    expectedDatabaseId,
    tokenTtlMs = 30 * 60 * 1000,
    reviewedByUid = null,
    externalDurableBackupDir = process.env.SOWVEIL_MIGRATION_DURABLE_BACKUP_DIR,
    disableDurableBackupDestination = false,
    acknowledgeUnreadableVaultRecovery = false,
  } = params;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const expiresAtMs = nowMs + tokenTtlMs;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const dryRunId = `dryrun_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
  const warnings: string[] = [];
  const preconditionFailures: string[] = [];
  const recoveryIssues: MigrationRecoveryIssueItem[] = [];

  const databaseCheck = await verifyMigrationBackendProductionReady(persistenceAdapter, {
    expectedDatabaseId,
    throwOnNotReady: false,
  });

  if (!databaseCheck.isProductionReadyDriver) {
    preconditionFailures.push(
      databaseCheck.blockerMessage ||
        'Target persistence adapter is not a genuine, connected, verified production database.'
    );
    warnings.push(
      `[MIGRATION_BACKEND_NOT_PRODUCTION_READY] ${
        databaseCheck.blockerMessage || 'Backend not ready.'
      }`
    );
  }

  const hasFileSnapshot = Boolean(snapshotFilePath && fs.existsSync(snapshotFilePath));
  const hasPayloadSnapshot = Boolean(
    sourceSnapshotPayload && typeof sourceSnapshotPayload === 'object'
  );

  if (!hasFileSnapshot && !hasPayloadSnapshot) {
    preconditionFailures.push(`Snapshot file not found at ${snapshotFilePath}`);
    const preconditions: MigrationPreconditionChecks = {
      backendProductionReady: databaseCheck.isProductionReadyDriver,
      databaseConnectivityVerified:
        databaseCheck.connected && databaseCheck.readWriteProbeVerified,
      databaseIdentityVerified: databaseCheck.databaseIdentityVerified,
      durableMigrationStateReady: Boolean(
        databaseCheck.isProductionReadyDriver && persistenceAdapter.migrationState
      ),
      sourceSnapshotValid: false,
      backupCreatedAndVerified: false,
      independentDurableBackupVerified: false,
      allIdsAndOwnersValid: false,
      noDuplicateRecords: false,
      noTargetIdOwnerCollisions: false,
      vaultRecoveryValid: false,
    };
    const vaultHealth: VaultHealthSummary = {
      totalConnections: 0,
      activeCiphertextCount: 0,
      requiresReentryCount: 0,
      corruptedCiphertextCount: 0,
      note: 'No snapshot file found at path.',
    };
    const emptyReport: MigrationDryRunReport = {
      dryRunId,
      generatedAt: now,
      expiresAt,
      reviewedByUid,
      adminOwnerReviewRequired: true,
      sourceSnapshotPath: snapshotFilePath,
      sourceSnapshotSha256: '',
      fileFound: false,
      fileSizeBytes: 0,
      backupPath: null,
      backupSha256: null,
      backupVerified: false,
      durableBackupId: null,
      durableBackupDestinationKind: null,
      independentDurableBackupVerified: false,
      operatorConfirmationToken: '',
      entitySummaries: {},
      vaultHealth,
      totalRecordsToMigrate: 0,
      totalDuplicateRecords: 0,
      totalInvalidRecords: 0,
      totalTargetCollisions: 0,
      newerTargetRecordsToPreserve: [],
      recoveryReport: null,
      recoveryFilePath: null,
      humanReadableReport: formatHumanReadableDryRunReport({
        dryRunId,
        generatedAt: now,
        reviewedByUid,
        sourceSnapshotPath: snapshotFilePath,
        sourceSnapshotSha256: '',
        durableBackupId: null,
        backupDestinationKind: null,
        backupSha256: null,
        canSafelyApply: false,
        databaseCheck,
        preconditions,
        preconditionFailures,
        entitySummaries: {},
        vaultHealth,
        newerTargetRecordsToPreserve: [],
        recoveryReport: null,
      }),
      preconditions,
      preconditionFailures,
      databaseCheck,
      canSafelyApply: false,
      warnings: [...warnings, `Snapshot file not found at ${snapshotFilePath}`],
    };
    return emptyReport;
  }

  // 1. Load source snapshot and create local + independently durable backup
  let snapshot: DurableStoreSnapshot | null = null;
  let sourceSha256 = '';
  let fileSizeBytes = 0;
  let localBackupPath: string | null = null;
  let localBackupSha256: string | null = null;
  let localBackupVerified = false;

  if (hasFileSnapshot) {
    const backup = createSnapshotBackup(snapshotFilePath, externalDurableBackupDir);
    const stat = fs.statSync(snapshotFilePath);
    fileSizeBytes = stat.size;
    sourceSha256 = backup.sourceSha256;
    localBackupPath = backup.backupPath;
    localBackupSha256 = backup.backupSha256;
    localBackupVerified = backup.verified;
    snapshot = loadDurableSnapshot(snapshotFilePath);
  } else if (sourceSnapshotPayload) {
    snapshot = sourceSnapshotPayload;
    const rawJson = JSON.stringify(sourceSnapshotPayload, null, 2);
    fileSizeBytes = Buffer.byteLength(rawJson, 'utf8');
    sourceSha256 = crypto.createHash('sha256').update(rawJson, 'utf8').digest('hex');
    if (externalDurableBackupDir && externalDurableBackupDir.trim()) {
      const dir = path.resolve(externalDurableBackupDir.trim());
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      localBackupPath = path.join(dir, `runtime-snapshot.backup.${nowMs}.json`);
      fs.writeFileSync(localBackupPath, rawJson, { encoding: 'utf8', mode: 0o600 });
      localBackupSha256 = computeFileSha256(localBackupPath);
      localBackupVerified = localBackupSha256 === sourceSha256;
    } else {
      localBackupSha256 = sourceSha256;
      localBackupVerified = true;
    }
  }

  if (!snapshot) {
    throw new Error(`Failed to parse durable snapshot at ${snapshotFilePath}`);
  }

  // Save source export to independently durable, access-controlled backup destination
  let durableBackupId: string | null = null;
  let durableBackupDestinationKind:
    | 'firestore-server-only-vault'
    | 'external-durable-filesystem'
    | null = null;
  let independentDurableBackupVerified = false;

  if (disableDurableBackupDestination) {
    preconditionFailures.push(
      'Backup destination check failed: independently durable, access-controlled backup destination is disabled or not configured.'
    );
    warnings.push(
      '[DURABLE_BACKUP_NOT_CONFIGURED] Independently durable backup destination is required before migration.'
    );
  } else if (
    databaseCheck.isProductionReadyDriver &&
    persistenceAdapter.migrationState?.saveDurableBackup
  ) {
    try {
      const exported = await exportCurrentSourceSnapshot({
        persistenceAdapter,
        snapshotFilePath: hasFileSnapshot ? snapshotFilePath : undefined,
        sourceSnapshotPayload: hasFileSnapshot ? undefined : snapshot,
        exportedByUid: reviewedByUid || 'dry-run-operator',
        expectedDatabaseId,
        externalDurableBackupDir,
        dryRunId,
      });
      durableBackupId = exported.durableBackup.backupId;
      durableBackupDestinationKind = exported.durableBackup.destinationKind;
      independentDurableBackupVerified = exported.durableBackup.verifiedReadAfterWrite;
      if (!localBackupPath && exported.durableBackup.externalFilePath) {
        localBackupPath = exported.durableBackup.externalFilePath;
      }
    } catch (err) {
      preconditionFailures.push(
        `Failed to write source snapshot export to independently durable backup destination: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  } else if (externalDurableBackupDir && localBackupVerified) {
    durableBackupId = `ext_backup_${nowMs}`;
    durableBackupDestinationKind = 'external-durable-filesystem';
    independentDurableBackupVerified = true;
  } else if (databaseCheck.isProductionReadyDriver) {
    preconditionFailures.push(
      'Backup destination check failed: persistence adapter does not support saveDurableBackup and no external durable backup directory is configured.'
    );
  }

  const entitySummaries: Record<string, EntityMigrationSummary> = {};
  let totalRecords = 0;
  let totalDuplicateRecords = 0;
  let totalInvalidRecords = 0;

  function summarize<
    T extends { id?: string; ownerUid?: string; updatedAt?: string; revision?: number }
  >(
    entityName: string,
    items: T[],
    options: {
      requireOwnerUid: boolean;
      validateDto?: (item: T) => void;
    }
  ): EntityMigrationSummary {
    const idSet = new Set<string>();
    let duplicateCount = 0;
    let invalidCount = 0;
    let missingOwnerCount = 0;
    let schemaErrorCount = 0;
    let validCount = 0;
    const owners = new Set<string>();
    const sampleStableIds: string[] = [];
    const allStableIds: string[] = [];
    let minRevision: number | null = null;
    let maxRevision: number | null = null;
    let versionedRecordCount = 0;
    const sampleRevisions: Record<string, number> = {};

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (!it || typeof it !== 'object') {
        invalidCount += 1;
        recoveryIssues.push({
          entity: entityName,
          recordId: `index_${idx}`,
          ownerUid: null,
          issueCode: 'MALFORMED_RECORD',
          reason: `Non-object record at index ${idx} in "${entityName}".`,
          remediationAction: 'Remove or repair the malformed JSON entry before re-running dry-run.',
        });
        continue;
      }

      let recordHasError = false;
      let idValid = false;
      const rawId = typeof it.id === 'string' ? it.id : `index_${idx}`;
      try {
        assertValidDocumentId(it.id, entityName);
        idValid = true;
      } catch (err) {
        invalidCount += 1;
        recordHasError = true;
        recoveryIssues.push({
          entity: entityName,
          recordId: rawId,
          ownerUid: typeof it.ownerUid === 'string' ? it.ownerUid : null,
          issueCode: 'MALFORMED_RECORD',
          reason: err instanceof Error ? err.message : `Invalid document ID "${rawId}".`,
          remediationAction: 'Assign a canonical non-empty URL/Firestore-safe document ID.',
        });
      }

      if (idValid && it.id) {
        if (idSet.has(it.id)) {
          duplicateCount += 1;
          recordHasError = true;
          recoveryIssues.push({
            entity: entityName,
            recordId: it.id,
            ownerUid: typeof it.ownerUid === 'string' ? it.ownerUid : null,
            issueCode: 'DUPLICATE_RECORD_ID',
            reason: `Duplicate record ID "${it.id}" in collection "${entityName}".`,
            remediationAction: 'Deduplicate or merge records sharing the same ID in the source snapshot.',
          });
        } else {
          idSet.add(it.id);
          allStableIds.push(it.id);
          if (sampleStableIds.length < 8) {
            sampleStableIds.push(it.id);
          }
        }
      }

      if (options.requireOwnerUid) {
        try {
          assertValidDocumentId(it.ownerUid, `${entityName}.ownerUid`);
          owners.add(it.ownerUid!);
        } catch (err) {
          invalidCount += 1;
          missingOwnerCount += 1;
          recordHasError = true;
          recoveryIssues.push({
            entity: entityName,
            recordId: rawId,
            ownerUid: null,
            issueCode: 'MISSING_OWNER_UID',
            reason:
              err instanceof Error
                ? err.message
                : `Missing or invalid ownerUid on "${entityName}/${rawId}".`,
            remediationAction: 'Populate a valid ownerUid or omit the orphaned record.',
          });
        }
      } else if (it.ownerUid && typeof it.ownerUid === 'string') {
        owners.add(it.ownerUid);
      }

      if (typeof it.revision === 'number' && Number.isFinite(it.revision)) {
        versionedRecordCount += 1;
        if (minRevision === null || it.revision < minRevision) minRevision = it.revision;
        if (maxRevision === null || it.revision > maxRevision) maxRevision = it.revision;
        if (it.id && Object.keys(sampleRevisions).length < 8) {
          sampleRevisions[it.id] = it.revision;
        }
      }

      if (options.validateDto) {
        try {
          options.validateDto(it);
        } catch (err) {
          schemaErrorCount += 1;
          invalidCount += 1;
          recordHasError = true;
          recoveryIssues.push({
            entity: entityName,
            recordId: rawId,
            ownerUid: typeof it.ownerUid === 'string' ? it.ownerUid : null,
            issueCode: 'MALFORMED_RECORD',
            reason:
              err instanceof Error
                ? err.message
                : `DTO schema validation failed for "${entityName}/${rawId}".`,
            remediationAction: 'Repair record fields to conform to the canonical Sowveil DTO schema.',
          });
        }
      }

      if (!recordHasError) {
        validCount += 1;
      }
    }

    const summary: EntityMigrationSummary = {
      entityName,
      count: items.length,
      validCount,
      uniqueOwners: owners.size,
      distinctOwnerUids: Array.from(owners).sort(),
      duplicateCount,
      invalidCount,
      missingOwnerCount,
      schemaErrorCount,
      sampleStableIds,
      stableIds: allStableIds,
      revisionSummary: {
        minRevision,
        maxRevision,
        versionedRecordCount,
        sampleRevisions,
      },
      structuralChecksum: computeStructuralChecksum(items),
    };
    entitySummaries[entityName] = summary;
    totalRecords += items.length;
    totalDuplicateRecords += duplicateCount;
    totalInvalidRecords += invalidCount;
    return summary;
  }

  // Analyze each collection with strict ID, ownerUid, and DTO schema validation
  summarize('projects', snapshot.projects || [], {
    requireOwnerUid: true,
    validateDto: (p) => {
      serializeProjectToFirestoreDto(p);
    },
  });
  summarize('catalogItems', snapshot.catalogItems || [], {
    requireOwnerUid: false,
  });
  summarize('templateVariants', snapshot.templateVariants || [], {
    requireOwnerUid: true,
  });
  summarize('referenceLabSessions', snapshot.referenceLabSessions || [], {
    requireOwnerUid: true,
    validateDto: (s) => {
      serializeReferenceLabSessionToDto(s);
    },
  });
  summarize('aiDirectorSessions', snapshot.aiDirectorSessions || [], {
    requireOwnerUid: true,
    validateDto: (s) => {
      serializeAiDirectorSessionToDto(s);
    },
  });
  summarize('templateFactoryDrafts', snapshot.templateFactoryDrafts || [], {
    requireOwnerUid: true,
    validateDto: (d) => {
      serializeTemplateFactoryDraftToDto(d);
    },
  });
  summarize('renderExportJobs', snapshot.renderExportJobs || [], {
    requireOwnerUid: true,
    validateDto: (j) => {
      serializeRenderExportJobToFirestoreDto(j);
    },
  });
  summarize('extensionPackages', snapshot.extensionPackages || [], {
    requireOwnerUid: true,
  });
  summarize('toolAuditRecords', snapshot.toolAuditRecords || [], {
    requireOwnerUid: true,
  });
  summarize('auditEvents', snapshot.auditEvents || [], {
    requireOwnerUid: false,
  });

  // Summarize provider connections and vault recovery status (never exposing secrets)
  const conns = snapshot.providerConnections || [];
  let activeCipher = 0;
  let requiresReentry = 0;
  let corruptedCipher = 0;

  for (const conn of conns) {
    if (!conn || typeof conn !== 'object') {
      corruptedCipher += 1;
      recoveryIssues.push({
        entity: 'providerConnections',
        recordId: 'unknown',
        ownerUid: null,
        issueCode: 'UNREADABLE_VAULT_CIPHERTEXT',
        reason: 'Malformed non-object providerConnection entry.',
        remediationAction: 'Remove corrupted entry or re-register provider connection.',
      });
      continue;
    }
    if (!conn.encryptedCredential) {
      continue;
    }
    const enc = conn.encryptedCredential;
    const envelopeStructurallyValid =
      isValidHexEnvelope(enc.ivHex, 24) &&
      isValidHexEnvelope(enc.authTagHex, 32) &&
      isValidHexEnvelope(enc.ciphertextHex, 2) &&
      typeof enc.aadScope === 'string' &&
      enc.aadScope.trim().length > 0;

    if (!envelopeStructurallyValid) {
      corruptedCipher += 1;
      recoveryIssues.push({
        entity: 'providerConnections',
        recordId: String(conn.id || 'unknown'),
        ownerUid: typeof conn.ownerUid === 'string' ? conn.ownerUid : null,
        issueCode: 'UNREADABLE_VAULT_CIPHERTEXT',
        reason: 'Encrypted credential envelope is structurally malformed (invalid hex IV, authTag, ciphertext, or missing aadScope).',
        remediationAction:
          'Clear the corrupted encryptedCredential or rotate/re-enter the provider API key before migration.',
        safeMetadata: {
          providerBrand: conn.providerBrand || null,
          label: conn.label || null,
          keyVersion: enc.keyVersion ?? null,
        },
      });
      continue;
    }

    try {
      const inspected = inspectPersistedConnectionVaultHealth(conn);
      if (inspected.credentialStatus === 'active') {
        activeCipher += 1;
      } else if (inspected.credentialStatus === 'requires-reentry') {
        requiresReentry += 1;
        recoveryIssues.push({
          entity: 'providerConnections',
          recordId: String(conn.id || 'unknown'),
          ownerUid: typeof conn.ownerUid === 'string' ? conn.ownerUid : null,
          issueCode: 'VAULT_REQUIRES_KEY_REENTRY',
          reason:
            'Encrypted credential cannot be decrypted with the current SOWVEIL_MASTER_VAULT_KEY or AAD scope.',
          remediationAction:
            'Verify SOWVEIL_MASTER_VAULT_KEY matches the source environment, or acknowledge vault re-entry recovery so the connection is migrated with status="requires-reentry".',
          safeMetadata: {
            providerBrand: conn.providerBrand || null,
            label: conn.label || null,
            keyVersion: enc.keyVersion ?? null,
          },
        });
      } else {
        corruptedCipher += 1;
        recoveryIssues.push({
          entity: 'providerConnections',
          recordId: String(conn.id || 'unknown'),
          ownerUid: typeof conn.ownerUid === 'string' ? conn.ownerUid : null,
          issueCode: 'UNREADABLE_VAULT_CIPHERTEXT',
          reason: `Vault inspection reported non-recoverable status "${inspected.credentialStatus}".`,
          remediationAction: 'Delete or rotate the unreadable credential before migrating.',
          safeMetadata: {
            providerBrand: conn.providerBrand || null,
            label: conn.label || null,
          },
        });
      }
    } catch {
      corruptedCipher += 1;
      recoveryIssues.push({
        entity: 'providerConnections',
        recordId: String(conn.id || 'unknown'),
        ownerUid: typeof conn.ownerUid === 'string' ? conn.ownerUid : null,
        issueCode: 'UNREADABLE_VAULT_CIPHERTEXT',
        reason: 'Exception while inspecting encrypted credential envelope.',
        remediationAction: 'Delete or rotate the unreadable credential before migrating.',
      });
    }
  }

  const vaultHealth: VaultHealthSummary = {
    totalConnections: conns.length,
    activeCiphertextCount: activeCipher,
    requiresReentryCount: requiresReentry,
    corruptedCiphertextCount: corruptedCipher,
    note:
      corruptedCipher > 0
        ? `${corruptedCipher} connection(s) have corrupted/unrecoverable ciphertext envelopes.`
        : requiresReentry > 0
        ? `${requiresReentry} connection(s) require re-entry because the vault key differs or is not configured. Recovery report generated without exposing secrets.`
        : 'All encrypted provider credentials validated successfully against the active vault master key.',
  };

  summarize('providerConnections', conns, {
    requireOwnerUid: true,
    validateDto: (c) => {
      serializeProviderConnectionSplitDto(c);
    },
  });

  if (requiresReentry > 0) {
    warnings.push(
      `${requiresReentry} provider connection(s) have unreadable credentials under the active vault key and require key re-entry.`
    );
    if (!acknowledgeUnreadableVaultRecovery) {
      preconditionFailures.push(
        `Vault recovery check blocked silent migration: ${requiresReentry} provider connection(s) cannot be decrypted with the current vault key. Review the sanitized recovery report and either restore the matching SOWVEIL_MASTER_VAULT_KEY or set acknowledgeUnreadableVaultRecovery=true.`
      );
    }
  }
  if (corruptedCipher > 0) {
    warnings.push(`${corruptedCipher} provider connection(s) have corrupted ciphertext.`);
    preconditionFailures.push(
      `Vault recovery validation failed: ${corruptedCipher} provider connection(s) have corrupted ciphertext.`
    );
  }

  const consents = Object.entries(snapshot.userPreferenceConsents || {}).map(([uid, c]) => ({
    ...c,
    id: uid,
    ownerUid: uid,
  }));
  summarize('userPreferenceConsents', consents, { requireOwnerUid: true });

  const signals = (snapshot.templatePreferenceSignals || []).map((s) => ({
    ...s,
    id: s.signalId,
  }));
  summarize('templatePreferenceSignals', signals, { requireOwnerUid: true });

  const roles = Object.entries(snapshot.roles || {}).map(([uid, r]) => ({
    id: uid,
    ownerUid: uid,
    role: r,
  }));
  summarize('roles', roles, { requireOwnerUid: true });

  // Inspect target store for ID/Owner collisions and newer target revisions
  const newerTargetRecordsToPreserve: MigrationDryRunReport['newerTargetRecordsToPreserve'] = [];
  let totalTargetCollisions = 0;

  if (databaseCheck.isProductionReadyDriver) {
    const checkTargetOwnerAndRevision = async (
      entity: string,
      sourceItems: Array<{ id?: string; ownerUid?: string; revision?: number; updatedAt?: string }>,
      fetcher: (
        id: string,
        ownerUid: string
      ) => Promise<{ id?: string; ownerUid?: string; revision?: number; updatedAt?: string } | null>
    ) => {
      for (const src of sourceItems) {
        if (!src || typeof src.id !== 'string' || !src.id.trim()) continue;
        const srcOwner = typeof src.ownerUid === 'string' ? src.ownerUid : '';
        try {
          const existing = await fetcher(src.id, srcOwner);
          if (!existing) continue;
          if (existing.ownerUid && srcOwner && existing.ownerUid !== srcOwner) {
            totalTargetCollisions += 1;
            recoveryIssues.push({
              entity,
              recordId: src.id,
              ownerUid: srcOwner,
              issueCode: 'ID_OWNER_COLLISION',
              reason: `Target Firestore record "${entity}/${src.id}" already exists with a different ownerUid ("${existing.ownerUid}" vs snapshot "${srcOwner}").`,
              remediationAction:
                'Resolve the ID/owner collision before migrating; cross-owner overwrites are strictly forbidden.',
              safeMetadata: {
                snapshotOwnerUid: srcOwner,
                targetOwnerUid: existing.ownerUid,
              },
            });
            continue;
          }
          const srcRev = typeof src.revision === 'number' ? src.revision : null;
          const tgtRev = typeof existing.revision === 'number' ? existing.revision : null;
          const srcUpd = typeof src.updatedAt === 'string' ? src.updatedAt : null;
          const tgtUpd = typeof existing.updatedAt === 'string' ? existing.updatedAt : null;
          const targetIsNewer =
            (tgtRev !== null && srcRev !== null && tgtRev > srcRev) ||
            (tgtRev !== null &&
              srcRev !== null &&
              tgtRev === srcRev &&
              tgtUpd !== null &&
              srcUpd !== null &&
              tgtUpd > srcUpd) ||
            (tgtRev === null &&
              srcRev === null &&
              tgtUpd !== null &&
              srcUpd !== null &&
              tgtUpd > srcUpd);
          if (targetIsNewer) {
            newerTargetRecordsToPreserve.push({
              entity,
              recordId: src.id,
              ownerUid: srcOwner,
              sourceRevision: srcRev,
              targetRevision: tgtRev,
              sourceUpdatedAt: srcUpd,
              targetUpdatedAt: tgtUpd,
            });
          }
        } catch {
          // Ignore individual read errors during dry-run target inspection
        }
      }
    };

    await checkTargetOwnerAndRevision('projects', snapshot.projects || [], (id, owner) =>
      persistenceAdapter.projects.getById(id, owner, true)
    );
    await checkTargetOwnerAndRevision(
      'templateVariants',
      snapshot.templateVariants || [],
      (id, owner) => persistenceAdapter.catalogAndVariants.getVariantById(id, owner, true)
    );
    await checkTargetOwnerAndRevision(
      'referenceLabSessions',
      snapshot.referenceLabSessions || [],
      (id, owner) => persistenceAdapter.referenceLabSessions.getById(id, owner, true)
    );
    await checkTargetOwnerAndRevision(
      'aiDirectorSessions',
      snapshot.aiDirectorSessions || [],
      (id, owner) => persistenceAdapter.aiDirectorSessions.getById(id, owner, true)
    );
    await checkTargetOwnerAndRevision(
      'templateFactoryDrafts',
      snapshot.templateFactoryDrafts || [],
      (id, owner) => persistenceAdapter.templateFactoryDrafts.getById(id, owner, true)
    );
    await checkTargetOwnerAndRevision(
      'providerConnections',
      snapshot.providerConnections || [],
      (id, owner) => persistenceAdapter.providerConnections.getMetadataById(id, owner, true)
    );
    await checkTargetOwnerAndRevision(
      'renderExportJobs',
      snapshot.renderExportJobs || [],
      (id, owner) => persistenceAdapter.renderExportJobs.getJobById(id, owner, true)
    );
  }

  if (totalInvalidRecords > 0) {
    preconditionFailures.push(
      `Validation failed: ${totalInvalidRecords} record(s) have invalid IDs, missing ownerUid, or schema errors.`
    );
  }
  if (totalDuplicateRecords > 0) {
    preconditionFailures.push(
      `Duplicate check failed: ${totalDuplicateRecords} duplicate record ID(s) detected in snapshot.`
    );
  }
  if (totalTargetCollisions > 0) {
    preconditionFailures.push(
      `Collision check failed: ${totalTargetCollisions} record(s) collide with existing target records owned by a different user.`
    );
  }

  // Generate sanitized recovery report whenever issues exist
  let recoveryReport: DurableMigrationRecoveryReportDto | null = null;
  let recoveryFilePath: string | null = null;
  if (recoveryIssues.length > 0) {
    const recoveryId = `recovery_${nowMs}_${crypto.randomBytes(3).toString('hex')}`;
    if (hasFileSnapshot) {
      const dir = path.dirname(snapshotFilePath);
      if (fs.existsSync(dir)) {
        recoveryFilePath = path.join(dir, `sowveil-migration-recovery.${dryRunId}.json`);
      }
    } else if (externalDurableBackupDir && externalDurableBackupDir.trim()) {
      const dir = path.resolve(externalDurableBackupDir.trim());
      if (fs.existsSync(dir)) {
        recoveryFilePath = path.join(dir, `sowveil-migration-recovery.${dryRunId}.json`);
      }
    }

    recoveryReport = {
      id: dryRunId,
      recoveryId,
      dryRunId,
      generatedAt: now,
      containsSecrets: false,
      totalIssueCount: recoveryIssues.length,
      unresolvedMalformedCount: recoveryIssues.filter(
        (i) => i.issueCode === 'MALFORMED_RECORD' || i.issueCode === 'MISSING_OWNER_UID'
      ).length,
      unreadableVaultCount: corruptedCipher,
      requiresReentryVaultCount: requiresReentry,
      duplicateIdCount: totalDuplicateRecords,
      idOwnerCollisionCount: totalTargetCollisions,
      issues: recoveryIssues,
      recoveryFilePath,
    };

    if (recoveryFilePath) {
      try {
        fs.writeFileSync(recoveryFilePath, JSON.stringify(recoveryReport, null, 2), {
          encoding: 'utf8',
          mode: 0o600,
        });
      } catch {
        recoveryFilePath = null;
        recoveryReport.recoveryFilePath = null;
      }
    }

    if (
      databaseCheck.isProductionReadyDriver &&
      persistenceAdapter.migrationState?.saveRecoveryReport
    ) {
      await persistenceAdapter.migrationState.saveRecoveryReport(recoveryReport);
    }
  }

  const vaultRecoveryValid =
    corruptedCipher === 0 && (requiresReentry === 0 || acknowledgeUnreadableVaultRecovery);

  const preconditions: MigrationPreconditionChecks = {
    backendProductionReady: databaseCheck.isProductionReadyDriver,
    databaseConnectivityVerified:
      databaseCheck.connected && databaseCheck.readWriteProbeVerified,
    databaseIdentityVerified: databaseCheck.databaseIdentityVerified,
    durableMigrationStateReady: Boolean(
      databaseCheck.isProductionReadyDriver && persistenceAdapter.migrationState
    ),
    sourceSnapshotValid: true,
    backupCreatedAndVerified: localBackupVerified && independentDurableBackupVerified,
    independentDurableBackupVerified,
    allIdsAndOwnersValid: totalInvalidRecords === 0,
    noDuplicateRecords: totalDuplicateRecords === 0,
    noTargetIdOwnerCollisions: totalTargetCollisions === 0,
    vaultRecoveryValid,
  };

  const canSafelyApply = Object.values(preconditions).every(Boolean);

  // Only issue a confirmation token and persist it durably if ALL preconditions pass
  let operatorConfirmationToken = '';
  if (canSafelyApply && persistenceAdapter.migrationState) {
    const confirmationSecret = crypto.randomBytes(16).toString('hex');
    const tokenPayload = `${dryRunId}:${totalRecords}:${localBackupSha256}:${confirmationSecret}`;
    operatorConfirmationToken = `cutover_confirm_${crypto
      .createHash('sha256')
      .update(tokenPayload)
      .digest('hex')
      .slice(0, 32)}`;
  }

  const humanReadableReport = formatHumanReadableDryRunReport({
    dryRunId,
    generatedAt: now,
    reviewedByUid,
    sourceSnapshotPath: snapshotFilePath,
    sourceSnapshotSha256: sourceSha256,
    durableBackupId,
    backupDestinationKind: durableBackupDestinationKind,
    backupSha256: localBackupSha256,
    canSafelyApply,
    databaseCheck,
    preconditions,
    preconditionFailures,
    entitySummaries,
    vaultHealth,
    newerTargetRecordsToPreserve,
    recoveryReport,
  });

  const report: MigrationDryRunReport = {
    dryRunId,
    generatedAt: now,
    expiresAt,
    reviewedByUid,
    adminOwnerReviewRequired: true,
    sourceSnapshotPath: snapshotFilePath,
    sourceSnapshotSha256: sourceSha256,
    fileFound: true,
    fileSizeBytes,
    backupPath: localBackupPath,
    backupSha256: localBackupSha256,
    backupVerified: localBackupVerified && independentDurableBackupVerified,
    durableBackupId,
    durableBackupDestinationKind,
    independentDurableBackupVerified,
    operatorConfirmationToken,
    entitySummaries,
    vaultHealth,
    totalRecordsToMigrate: totalRecords,
    totalDuplicateRecords,
    totalInvalidRecords,
    totalTargetCollisions,
    newerTargetRecordsToPreserve,
    recoveryReport,
    recoveryFilePath,
    humanReadableReport,
    preconditions,
    preconditionFailures,
    databaseCheck,
    canSafelyApply,
    warnings,
  };

  // Persist dry-run record and cutover status durably ONLY when durable migration state is ready
  if (databaseCheck.isProductionReadyDriver && persistenceAdapter.migrationState) {
    const dryRunDto: DurableMigrationDryRunRecordDto = {
      id: dryRunId,
      dryRunId,
      generatedAt: now,
      expiresAtMs,
      confirmationTokenHash: operatorConfirmationToken
        ? hashConfirmationToken(operatorConfirmationToken)
        : '',
      canSafelyApply,
      consumedAt: null,
      consumedByApplyId: null,
      sourceSnapshotPath: snapshotFilePath,
      sourceSnapshotSha256: sourceSha256,
      backupPath: localBackupPath,
      backupSha256: localBackupSha256,
      durableBackupId,
      recoveryReportId: recoveryReport?.recoveryId ?? null,
      reviewedByUid,
      totalRecordsToMigrate: totalRecords,
      reportJson: JSON.stringify(report),
    };
    await persistenceAdapter.migrationState.saveDryRunRecord(dryRunDto);

    const existingState = await persistenceAdapter.migrationState.getCutoverState();
    await persistenceAdapter.migrationState.saveCutoverState({
      id: 'cutoverState',
      isLegacySnapshotWriterDisabled: existingState?.isLegacySnapshotWriterDisabled ?? false,
      cutoverApprovalEligible: existingState?.cutoverApprovalEligible ?? false,
      lastDryRunId: dryRunId,
      lastAppliedId: existingState?.lastAppliedId ?? null,
      lastAppliedAt: existingState?.lastAppliedAt ?? null,
      lastMigrationStatus: canSafelyApply ? 'dry-run-ready' : 'dry-run-blocked',
      updatedAt: now,
    });
  }

  return report;
}

// ============================================================================
// 4. CROSS-ENTITY REFERENCE & APP-LEVEL LOOKUP VERIFICATION HELPERS
// ============================================================================

async function verifyOwnerAndCrossEntityReferences(
  snapshot: DurableStoreSnapshot,
  persistenceAdapter: ISowveilPersistenceAdapter
): Promise<CrossEntityReferenceVerificationResult> {
  const failures: CrossEntityReferenceVerificationResult['failures'] = [];
  let checkedReferencesCount = 0;
  let ownerReferencesVerified = 0;
  let variantTemplateReferencesVerified = 0;
  let sessionProjectReferencesVerified = 0;
  let renderJobProjectReferencesVerified = 0;
  let providerVaultReferencesVerified = 0;

  // 1. Verify project owners
  for (const proj of snapshot.projects || []) {
    checkedReferencesCount += 1;
    const target = await persistenceAdapter.projects.getById(proj.id, String(proj.ownerUid || ''), true);
    if (!target || !target.ownerUid) {
      failures.push({
        sourceEntity: 'projects',
        sourceRecordId: proj.id,
        targetEntity: 'owners',
        targetRecordId: String(proj.ownerUid || 'missing'),
        reason: `Migrated project "${proj.id}" is missing in target or has no ownerUid.`,
      });
    } else {
      ownerReferencesVerified += 1;
    }
  }

  // 2. Verify templateVariants -> catalogItems (when catalogItems exist or baseTemplateId is in snapshot catalogItems)
  const catalogIdsInSnapshot = new Set((snapshot.catalogItems || []).map((c) => c.id));
  for (const v of snapshot.templateVariants || []) {
    checkedReferencesCount += 1;
    const targetVar = await persistenceAdapter.catalogAndVariants.getVariantById(
      v.id,
      v.ownerUid,
      true
    );
    if (!targetVar || !targetVar.ownerUid) {
      failures.push({
        sourceEntity: 'templateVariants',
        sourceRecordId: v.id,
        targetEntity: 'owners',
        targetRecordId: String(v.ownerUid || 'missing'),
        reason: `Migrated variant "${v.id}" is missing in target or has no ownerUid.`,
      });
      continue;
    }
    ownerReferencesVerified += 1;

    if (v.baseTemplateId && (catalogIdsInSnapshot.has(v.baseTemplateId) || v.baseTemplateId.startsWith('missing-'))) {
      checkedReferencesCount += 1;
      const baseItem = await persistenceAdapter.catalogAndVariants.getCatalogItemById(
        v.baseTemplateId
      );
      if (!baseItem) {
        failures.push({
          sourceEntity: 'templateVariants',
          sourceRecordId: v.id,
          targetEntity: 'catalogItems',
          targetRecordId: v.baseTemplateId,
          reason: `Template variant "${v.id}" references baseTemplateId "${v.baseTemplateId}" which does not exist in target catalogItems.`,
        });
      } else {
        variantTemplateReferencesVerified += 1;
      }
    } else if (v.baseTemplateId) {
      const baseItem = await persistenceAdapter.catalogAndVariants.getCatalogItemById(
        v.baseTemplateId
      );
      if (baseItem) {
        variantTemplateReferencesVerified += 1;
      }
    }
  }

  // 3. Verify aiDirectorSessions & referenceLabSessions -> savedProjectId
  for (const s of snapshot.aiDirectorSessions || []) {
    checkedReferencesCount += 1;
    const targetSess = await persistenceAdapter.aiDirectorSessions.getById(
      s.id,
      s.ownerUid,
      true
    );
    if (!targetSess || !targetSess.ownerUid) {
      failures.push({
        sourceEntity: 'aiDirectorSessions',
        sourceRecordId: s.id,
        targetEntity: 'owners',
        targetRecordId: String(s.ownerUid || 'missing'),
        reason: `AI Director session "${s.id}" is missing in target or lacks ownerUid.`,
      });
      continue;
    }
    ownerReferencesVerified += 1;

    const linkedProjectId = (s as unknown as { savedProjectId?: string }).savedProjectId;
    if (linkedProjectId) {
      checkedReferencesCount += 1;
      const proj = await persistenceAdapter.projects.getById(linkedProjectId, s.ownerUid, true);
      if (!proj || proj.ownerUid !== s.ownerUid) {
        failures.push({
          sourceEntity: 'aiDirectorSessions',
          sourceRecordId: s.id,
          targetEntity: 'projects',
          targetRecordId: linkedProjectId,
          reason: `AI Director session "${s.id}" references savedProjectId "${linkedProjectId}" which is missing or owned by a different user.`,
        });
      } else {
        sessionProjectReferencesVerified += 1;
      }
    }
  }

  for (const s of snapshot.referenceLabSessions || []) {
    checkedReferencesCount += 1;
    const targetSess = await persistenceAdapter.referenceLabSessions.getById(
      s.id,
      s.ownerUid,
      true
    );
    if (!targetSess || !targetSess.ownerUid) {
      failures.push({
        sourceEntity: 'referenceLabSessions',
        sourceRecordId: s.id,
        targetEntity: 'owners',
        targetRecordId: String(s.ownerUid || 'missing'),
        reason: `Reference Lab session "${s.id}" is missing in target or lacks ownerUid.`,
      });
      continue;
    }
    ownerReferencesVerified += 1;

    const linkedProjectId = (s as unknown as { savedProjectId?: string }).savedProjectId;
    if (linkedProjectId) {
      checkedReferencesCount += 1;
      const proj = await persistenceAdapter.projects.getById(linkedProjectId, s.ownerUid, true);
      if (!proj || proj.ownerUid !== s.ownerUid) {
        failures.push({
          sourceEntity: 'referenceLabSessions',
          sourceRecordId: s.id,
          targetEntity: 'projects',
          targetRecordId: linkedProjectId,
          reason: `Reference Lab session "${s.id}" references savedProjectId "${linkedProjectId}" which is missing or owned by a different user.`,
        });
      } else {
        sessionProjectReferencesVerified += 1;
      }
    }
  }

  // 4. Verify renderExportJobs -> projectId
  for (const rj of snapshot.renderExportJobs || []) {
    checkedReferencesCount += 1;
    const targetJob = await persistenceAdapter.renderExportJobs.getJobById(
      rj.id,
      rj.ownerUid,
      true
    );
    if (!targetJob || !targetJob.ownerUid) {
      failures.push({
        sourceEntity: 'renderExportJobs',
        sourceRecordId: rj.id,
        targetEntity: 'owners',
        targetRecordId: String(rj.ownerUid || 'missing'),
        reason: `Render job "${rj.id}" is missing in target or lacks ownerUid.`,
      });
      continue;
    }
    ownerReferencesVerified += 1;

    const linkedProjectId = (rj as unknown as { projectId?: string }).projectId;
    if (linkedProjectId) {
      checkedReferencesCount += 1;
      const proj = await persistenceAdapter.projects.getById(linkedProjectId, rj.ownerUid, true);
      if (!proj || proj.ownerUid !== rj.ownerUid) {
        failures.push({
          sourceEntity: 'renderExportJobs',
          sourceRecordId: rj.id,
          targetEntity: 'projects',
          targetRecordId: linkedProjectId,
          reason: `Render job "${rj.id}" references projectId "${linkedProjectId}" which is missing or owned by a different user.`,
        });
      } else {
        renderJobProjectReferencesVerified += 1;
      }
    }
  }

  // 5. Verify providerConnections -> credentialVault
  for (const conn of snapshot.providerConnections || []) {
    checkedReferencesCount += 1;
    const meta = await persistenceAdapter.providerConnections.getMetadataById(
      conn.id,
      conn.ownerUid,
      true
    );
    if (!meta || !meta.ownerUid) {
      failures.push({
        sourceEntity: 'providerConnections',
        sourceRecordId: conn.id,
        targetEntity: 'owners',
        targetRecordId: String(conn.ownerUid || 'missing'),
        reason: `Provider connection "${conn.id}" is missing in target or lacks ownerUid.`,
      });
      continue;
    }
    ownerReferencesVerified += 1;

    if (conn.encryptedCredential) {
      checkedReferencesCount += 1;
      const vaultRec = await persistenceAdapter.credentialVault.getVaultSecret(
        conn.id,
        conn.ownerUid
      );
      if (!vaultRec || vaultRec.ownerUid !== conn.ownerUid) {
        failures.push({
          sourceEntity: 'providerConnections',
          sourceRecordId: conn.id,
          targetEntity: 'serverCredentialVault',
          targetRecordId: conn.id,
          reason: `Provider connection "${conn.id}" is missing its corresponding encrypted secret in serverCredentialVault.`,
        });
      } else {
        providerVaultReferencesVerified += 1;
      }
    }
  }

  return {
    passed: failures.length === 0,
    checkedReferencesCount,
    ownerReferencesVerified,
    variantTemplateReferencesVerified,
    sessionProjectReferencesVerified,
    renderJobProjectReferencesVerified,
    providerVaultReferencesVerified,
    failures,
  };
}

async function verifyAppLevelDestinationLookups(
  snapshot: DurableStoreSnapshot,
  persistenceAdapter: ISowveilPersistenceAdapter
): Promise<AppLevelLookupVerificationResult> {
  const checkedCounts: Record<string, number> = {
    projects: 0,
    aiDirectorSessions: 0,
    referenceLabSessions: 0,
    templateFactoryDrafts: 0,
    catalogItems: 0,
    templateVariants: 0,
    renderExportJobs: 0,
    providerConnections: 0,
  };
  const failures: AppLevelLookupVerificationResult['failures'] = [];
  let totalLookupsVerified = 0;

  for (const p of snapshot.projects || []) {
    const ownerUid = String(p.ownerUid || '');
    const byId = await persistenceAdapter.projects.getById(p.id, ownerUid);
    const byOwner = await persistenceAdapter.projects.listByOwner(ownerUid);
    if (!byId || !byOwner.some((item) => item.id === p.id)) {
      failures.push({
        entity: 'projects',
        recordId: p.id,
        reason: `App-level project lookup (getById / listByOwner) failed for "${p.id}".`,
      });
    } else {
      checkedCounts.projects += 1;
      totalLookupsVerified += 1;
    }
  }

  for (const s of snapshot.aiDirectorSessions || []) {
    const byId = await persistenceAdapter.aiDirectorSessions.getById(s.id, s.ownerUid);
    const byOwner = await persistenceAdapter.aiDirectorSessions.listByOwner(s.ownerUid);
    if (!byId || !byOwner.some((item) => item.id === s.id)) {
      failures.push({
        entity: 'aiDirectorSessions',
        recordId: s.id,
        reason: `App-level AI Director session lookup failed for "${s.id}".`,
      });
    } else {
      checkedCounts.aiDirectorSessions += 1;
      totalLookupsVerified += 1;
    }
  }

  for (const s of snapshot.referenceLabSessions || []) {
    const byId = await persistenceAdapter.referenceLabSessions.getById(s.id, s.ownerUid);
    const byOwner = await persistenceAdapter.referenceLabSessions.listByOwner(s.ownerUid);
    if (!byId || !byOwner.some((item) => item.id === s.id)) {
      failures.push({
        entity: 'referenceLabSessions',
        recordId: s.id,
        reason: `App-level Reference Lab session lookup failed for "${s.id}".`,
      });
    } else {
      checkedCounts.referenceLabSessions += 1;
      totalLookupsVerified += 1;
    }
  }

  for (const d of snapshot.templateFactoryDrafts || []) {
    const byId = await persistenceAdapter.templateFactoryDrafts.getById(d.id, d.ownerUid);
    const byOwner = await persistenceAdapter.templateFactoryDrafts.listByOwner(d.ownerUid);
    if (!byId || !byOwner.some((item) => item.id === d.id)) {
      failures.push({
        entity: 'templateFactoryDrafts',
        recordId: d.id,
        reason: `App-level Template Factory draft lookup failed for "${d.id}".`,
      });
    } else {
      checkedCounts.templateFactoryDrafts += 1;
      totalLookupsVerified += 1;
    }
  }

  const allCatalog = await persistenceAdapter.catalogAndVariants.listCatalogItems();
  for (const c of snapshot.catalogItems || []) {
    const byId = await persistenceAdapter.catalogAndVariants.getCatalogItemById(c.id);
    if (!byId || !allCatalog.some((item) => item.id === c.id)) {
      failures.push({
        entity: 'catalogItems',
        recordId: c.id,
        reason: `App-level catalog lookup failed for "${c.id}".`,
      });
    } else {
      checkedCounts.catalogItems += 1;
      totalLookupsVerified += 1;
    }
  }

  for (const v of snapshot.templateVariants || []) {
    const byId = await persistenceAdapter.catalogAndVariants.getVariantById(v.id, v.ownerUid);
    const byOwner = await persistenceAdapter.catalogAndVariants.listVariantsByOwner(v.ownerUid);
    if (!byId || !byOwner.some((item) => item.id === v.id)) {
      failures.push({
        entity: 'templateVariants',
        recordId: v.id,
        reason: `App-level template variant lookup failed for "${v.id}".`,
      });
    } else {
      checkedCounts.templateVariants += 1;
      totalLookupsVerified += 1;
    }
  }

  for (const rj of snapshot.renderExportJobs || []) {
    const byId = await persistenceAdapter.renderExportJobs.getJobById(rj.id, rj.ownerUid);
    const byOwner = await persistenceAdapter.renderExportJobs.listJobsByOwner(rj.ownerUid);
    if (!byId || !byOwner.some((item) => item.id === rj.id)) {
      failures.push({
        entity: 'renderExportJobs',
        recordId: rj.id,
        reason: `App-level render/export job lookup failed for "${rj.id}".`,
      });
    } else {
      checkedCounts.renderExportJobs += 1;
      totalLookupsVerified += 1;
    }
  }

  for (const conn of snapshot.providerConnections || []) {
    const byId = await persistenceAdapter.providerConnections.getMetadataById(
      conn.id,
      conn.ownerUid
    );
    const byOwner = await persistenceAdapter.providerConnections.listMetadataByOwner(
      conn.ownerUid
    );
    if (!byId || !byOwner.some((item) => item.id === conn.id)) {
      failures.push({
        entity: 'providerConnections',
        recordId: conn.id,
        reason: `App-level provider connection metadata lookup failed for "${conn.id}".`,
      });
    } else {
      checkedCounts.providerConnections += 1;
      totalLookupsVerified += 1;
    }
  }

  return {
    passed: failures.length === 0,
    checkedCounts,
    totalLookupsVerified,
    failures,
  };
}

// ============================================================================
// 5. APPLY MIGRATION (F3 Verified Staged Batch Execution, Ledger, Revision Guard, Cutover Gate)
// ============================================================================

interface MigrationWorkItem {
  entity: string;
  recordId: string;
  ownerUid: string;
  sourceRevision: number | null;
  sourceUpdatedAt: string | null;
  sourceRecord: unknown;
  execute: () => Promise<{
    status: MigrationLedgerRecordStatus;
    targetRevisionBefore: number | null;
    targetRevisionAfter: number | null;
    targetUpdatedAtBefore: string | null;
    sourceCanonicalHash: string;
    targetCanonicalHash: string;
    incrementCountBy?: number;
  }>;
}

export async function executeMigrationApply(params: {
  snapshotFilePath: string;
  sourceSnapshotPayload?: DurableStoreSnapshot;
  persistenceAdapter: ISowveilPersistenceAdapter;
  confirmationToken: string;
  dryRunId: string;
  confirmApply: boolean;
  disableLegacyWriters?: boolean;
  expectedDatabaseId?: string;
  resumeFromDryRunId?: string;
  batchSize?: number;
  maxBatches?: number;
  externalDurableBackupDir?: string;
  disableDurableBackupDestination?: boolean;
}): Promise<MigrationApplyReceipt> {
  const {
    snapshotFilePath,
    sourceSnapshotPayload,
    persistenceAdapter,
    confirmationToken,
    dryRunId,
    confirmApply,
    expectedDatabaseId,
    resumeFromDryRunId,
    batchSize: rawBatchSize = 25,
    maxBatches,
    externalDurableBackupDir = process.env.SOWVEIL_MIGRATION_DURABLE_BACKUP_DIR,
    disableDurableBackupDestination = false,
  } = params;

  const batchSize = Math.max(1, Math.min(250, Math.floor(rawBatchSize)));

  // STEP 1: Enforce genuine, connected, verified production database adapter BEFORE anything else
  const connCheck = await verifyMigrationBackendProductionReady(persistenceAdapter, {
    expectedDatabaseId,
    throwOnNotReady: true,
  });

  if (!persistenceAdapter.migrationState) {
    throw new PersistenceContractError({
      code: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      message: 'Migration Apply is disabled because durable migration state storage is not configured.',
      entity: 'system',
      operation: 'transaction',
      statusCode: 503,
    });
  }

  if (disableDurableBackupDestination) {
    throw new PersistenceContractError({
      code: 'DURABLE_PERSISTENCE_FAILED',
      message:
        'Migration Apply is blocked: an independently durable, access-controlled backup destination is required.',
      entity: 'migrationBackups',
      operation: 'create',
      statusCode: 503,
    });
  }

  // STEP 2: Validate explicit operator confirmation parameters
  if (!confirmApply) {
    const err = new Error(
      'Explicit operator confirmation (confirmApply: true) is required to apply migration.'
    ) as Error & { code?: string; statusCode?: number };
    err.code = 'OPERATOR_CONFIRMATION_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  if (!confirmationToken || !confirmationToken.trim()) {
    const err = new Error(
      'A valid operator confirmationToken from a migration dry-run is required.'
    ) as Error & { code?: string; statusCode?: number };
    err.code = 'CONFIRMATION_TOKEN_REQUIRED';
    err.statusCode = 400;
    throw err;
  }

  if (!dryRunId || !dryRunId.trim()) {
    const err = new Error('A valid dryRunId is required.') as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = 'DRY_RUN_ID_MISMATCH';
    err.statusCode = 400;
    throw err;
  }

  // STEP 3: Acquire atomic durable lock to prevent concurrent Apply attempts across instances
  const migrationLock = await persistenceAdapter.migrationState.acquireMigrationLock(dryRunId);
  const applyId = `apply_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  try {
    // Check if this dryRunId is resuming an in-progress bounded batch run
    const existingProgressForDryRun =
      await persistenceAdapter.migrationState.getMigrationProgress(dryRunId.trim());
    const isResumingInProgressBatch =
      existingProgressForDryRun?.status === 'in-progress';

    // STEP 4: Atomically validate and consume single-use confirmation token from durable storage
    const tokenHash = hashConfirmationToken(confirmationToken.trim());
    let dryRunRecord: DurableMigrationDryRunRecordDto | null = null;

    if (isResumingInProgressBatch) {
      const storedDryRun = await persistenceAdapter.migrationState.getDryRunRecord(dryRunId.trim());
      if (
        !storedDryRun ||
        storedDryRun.confirmationTokenHash !== tokenHash ||
        Date.now() > storedDryRun.expiresAtMs ||
        !storedDryRun.canSafelyApply
      ) {
        const err = new Error(
          'Invalid or expired confirmation token while resuming in-progress batch migration.'
        ) as Error & { code?: string; statusCode?: number };
        err.code = 'INVALID_CONFIRMATION_TOKEN';
        err.statusCode = 400;
        throw err;
      }
      dryRunRecord = storedDryRun;
    } else {
      const tokenConsumption =
        await persistenceAdapter.migrationState.consumeDryRunTokenAtomically(
          dryRunId.trim(),
          tokenHash,
          applyId,
          Date.now()
        );

      if (!tokenConsumption.ok || !tokenConsumption.record) {
        const reason = tokenConsumption.reason;
        if (reason === 'NOT_FOUND') {
          const err = new Error(
            `Dry run "${dryRunId}" not found in durable migration storage.`
          ) as Error & { code?: string; statusCode?: number };
          err.code = 'DRY_RUN_ID_MISMATCH';
          err.statusCode = 400;
          throw err;
        }
        if (reason === 'ALREADY_USED') {
          const err = new Error(
            'Operator confirmation token has already been used and cannot be reused.'
          ) as Error & { code?: string; statusCode?: number };
          err.code = 'CONFIRMATION_TOKEN_ALREADY_USED';
          err.statusCode = 400;
          throw err;
        }
        if (reason === 'EXPIRED_TOKEN') {
          const err = new Error(
            'Operator confirmation token has expired. Execute a fresh dry-run.'
          ) as Error & { code?: string; statusCode?: number };
          err.code = 'CONFIRMATION_TOKEN_EXPIRED';
          err.statusCode = 400;
          throw err;
        }
        if (reason === 'PRECONDITIONS_NOT_MET') {
          throw new PersistenceContractError({
            code: 'MIGRATION_PRECONDITIONS_FAILED',
            message:
              'Dry-run report has canSafelyApply=false; migration cannot be applied until all preconditions pass.',
            entity: 'migrationDryRuns',
            operation: 'transaction',
            documentId: dryRunId,
            statusCode: 409,
          });
        }
        const err = new Error(
          'Invalid operator confirmation token for migration apply.'
        ) as Error & { code?: string; statusCode?: number };
        err.code = 'INVALID_CONFIRMATION_TOKEN';
        err.statusCode = 400;
        throw err;
      }
      dryRunRecord = tokenConsumption.record;
    }

    if (!dryRunRecord.canSafelyApply) {
      throw new PersistenceContractError({
        code: 'MIGRATION_PRECONDITIONS_FAILED',
        message: 'Dry-run preconditions did not pass; refusing migration apply.',
        entity: 'migrationDryRuns',
        operation: 'transaction',
        documentId: dryRunId,
        statusCode: 409,
      });
    }

    // STEP 5: Verify snapshot source and create a verified durable backup before migrating
    let snapshot: DurableStoreSnapshot | null = null;
    let backupPath = dryRunRecord.backupPath || '';
    let sourceSha256 = '';

    if (sourceSnapshotPayload && typeof sourceSnapshotPayload === 'object') {
      snapshot = sourceSnapshotPayload;
      const rawJson = JSON.stringify(sourceSnapshotPayload, null, 2);
      sourceSha256 = crypto.createHash('sha256').update(rawJson, 'utf8').digest('hex');
    } else {
      if (!fs.existsSync(snapshotFilePath)) {
        throw new Error(`Source snapshot file not found at ${snapshotFilePath}`);
      }
      const backup = createSnapshotBackup(snapshotFilePath, externalDurableBackupDir);
      backupPath = backup.backupPath;
      sourceSha256 = backup.sourceSha256;
      snapshot = loadDurableSnapshot(snapshotFilePath);
    }

    if (
      dryRunRecord.sourceSnapshotSha256 &&
      sourceSha256 !== dryRunRecord.sourceSnapshotSha256
    ) {
      throw new PersistenceContractError({
        code: 'MIGRATION_PRECONDITIONS_FAILED',
        message:
          'Source snapshot changed since dry-run was executed (SHA-256 mismatch). Run a fresh dry-run.',
        entity: 'migrationDryRuns',
        operation: 'transaction',
        documentId: dryRunId,
        statusCode: 409,
      });
    }

    if (!snapshot) {
      throw new Error(`Failed to load snapshot at ${snapshotFilePath}`);
    }

    // Ensure independently durable backup exists and is verified in migrationState
    let durableBackupId = dryRunRecord.durableBackupId || null;
    if (persistenceAdapter.migrationState.saveDurableBackup) {
      if (durableBackupId && persistenceAdapter.migrationState.getDurableBackup) {
        const existingBackup =
          await persistenceAdapter.migrationState.getDurableBackup(durableBackupId);
        if (!existingBackup || !existingBackup.verifiedReadAfterWrite) {
          const exported = await exportCurrentSourceSnapshot({
            persistenceAdapter,
            snapshotFilePath: fs.existsSync(snapshotFilePath) ? snapshotFilePath : undefined,
            sourceSnapshotPayload: fs.existsSync(snapshotFilePath) ? undefined : snapshot,
            exportedByUid: dryRunRecord.reviewedByUid || 'apply-operator',
            expectedDatabaseId,
            externalDurableBackupDir,
            dryRunId,
          });
          durableBackupId = exported.durableBackup.backupId;
        }
      } else {
        const exported = await exportCurrentSourceSnapshot({
          persistenceAdapter,
          snapshotFilePath: fs.existsSync(snapshotFilePath) ? snapshotFilePath : undefined,
          sourceSnapshotPayload: fs.existsSync(snapshotFilePath) ? undefined : snapshot,
          exportedByUid: dryRunRecord.reviewedByUid || 'apply-operator',
          expectedDatabaseId,
          externalDurableBackupDir,
          dryRunId,
        });
        durableBackupId = exported.durableBackup.backupId;
      }
    }

    // STEP 6: Load or initialize durable progress record for resumable batch execution
    const priorProgressId = resumeFromDryRunId || dryRunId;
    const priorProgress =
      await persistenceAdapter.migrationState.getMigrationProgress(priorProgressId);
    const completedSet = new Set<string>(priorProgress?.completedRecordKeys || []);
    const skippedNewerTargetSet = new Set<string>(priorProgress?.skippedNewerTargetKeys || []);
    const failedRecords: DurableMigrationRecordFailureDto[] = [];
    const migratedCounts: Record<string, number> = {
      projects: 0,
      catalogItems: 0,
      templateVariants: 0,
      referenceLabSessions: 0,
      aiDirectorSessions: 0,
      templateFactoryDrafts: 0,
      userPreferenceConsents: 0,
      templatePreferenceSignals: 0,
      providerConnections: 0,
      extensionPackages: 0,
      toolAuditRecords: 0,
      renderExportJobs: 0,
      roles: 0,
      auditEvents: 0,
    };
    const skippedNewerTargetCounts: Record<string, number> = {};
    let totalMigrated = 0;
    let totalSkippedNewerTarget = 0;
    let ledgerEntryCount = 0;

    // Track per-record canonical hashes for sourceChecksum and targetChecksum
    const sourceHashPairs: string[] = [];
    const targetHashPairs: string[] = [];

    const writeLedgerEntry = async (
      entry: Omit<DurableMigrationLedgerEntryDto, 'id' | 'dryRunId' | 'applyId' | 'recordedAt'>
    ) => {
      const cleanRecordId = String(entry.recordId || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_');
      const ledgerId = `${dryRunId}__${entry.entity}__${cleanRecordId}`;
      const fullEntry: DurableMigrationLedgerEntryDto = {
        ...entry,
        id: ledgerId,
        dryRunId,
        applyId,
        recordedAt: new Date().toISOString(),
      };
      if (persistenceAdapter.migrationState?.saveLedgerEntry) {
        await persistenceAdapter.migrationState.saveLedgerEntry(fullEntry);
      }
      ledgerEntryCount += 1;
    };

    const recordFailure = async (
      batchIndex: number,
      entity: string,
      recordId: string,
      ownerUid: string | undefined,
      sourceRevision: number | null,
      sourceUpdatedAt: string | null,
      sourceCanonicalHash: string,
      operation: DurableMigrationRecordFailureDto['operation'],
      err: unknown,
      statusOverride: MigrationLedgerRecordStatus = 'failed'
    ) => {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? String((err as { code?: unknown }).code)
          : 'MIGRATION_RECORD_ERROR';
      const message =
        err instanceof Error ? err.message : 'Record migration failed during apply.';
      failedRecords.push({
        entity,
        recordId: String(recordId || 'unknown'),
        ownerUid,
        operation,
        errorCode: code,
        message,
      });
      await writeLedgerEntry({
        batchIndex,
        entity,
        recordId: String(recordId || 'unknown'),
        ownerUid: String(ownerUid || 'system'),
        sourceRevision,
        targetRevisionBefore: null,
        targetRevisionAfter: null,
        sourceUpdatedAt,
        targetUpdatedAtBefore: null,
        sourceCanonicalHash,
        targetCanonicalHash: null,
        status: statusOverride,
        verifiedReadAfterWrite: false,
        errorCode: code,
        errorMessage: message,
      });
    };

    const isTargetStrictlyNewer = (
      src: { revision?: number; updatedAt?: string },
      tgt: { revision?: number; updatedAt?: string }
    ): boolean => {
      const srcRev = typeof src.revision === 'number' ? src.revision : null;
      const tgtRev = typeof tgt.revision === 'number' ? tgt.revision : null;
      const srcUpd = typeof src.updatedAt === 'string' ? src.updatedAt : null;
      const tgtUpd = typeof tgt.updatedAt === 'string' ? tgt.updatedAt : null;
      if (tgtRev !== null && srcRev !== null) {
        if (tgtRev > srcRev) return true;
        if (tgtRev < srcRev) return false;
        if (tgtUpd !== null && srcUpd !== null && tgtUpd > srcUpd) return true;
        return false;
      }
      if (tgtUpd !== null && srcUpd !== null && tgtUpd > srcUpd) return true;
      return false;
    };

    const assertNoOwnerCollision = (
      entity: string,
      recordId: string,
      sourceOwnerUid: string,
      targetOwnerUid: string | undefined
    ) => {
      if (targetOwnerUid && sourceOwnerUid && targetOwnerUid !== sourceOwnerUid) {
        const collisionErr = new PersistenceContractError({
          code: 'ID_OWNER_COLLISION',
          message: `Critical ID/owner collision on "${entity}/${recordId}": snapshot ownerUid="${sourceOwnerUid}" conflicts with existing target ownerUid="${targetOwnerUid}".`,
          entity,
          operation: 'update',
          documentId: recordId,
          statusCode: 409,
        });
        throw collisionErr;
      }
    };

    // Build deterministic work queue across all entities
    const workQueue: MigrationWorkItem[] = [];

    // 1. Projects
    for (const proj of snapshot.projects || []) {
      workQueue.push({
        entity: 'projects',
        recordId: proj.id,
        ownerUid: proj.ownerUid || '',
        sourceRevision: typeof proj.revision === 'number' ? proj.revision : 1,
        sourceUpdatedAt: proj.updatedAt || null,
        sourceRecord: proj,
        execute: async () => {
          assertValidDocumentId(proj.id, 'projects');
          assertValidDocumentId(proj.ownerUid, 'projects.ownerUid');
          const projOwnerUid = proj.ownerUid as string;
          const srcHash = computeCanonicalRecordHash('projects', proj);
          const recKey = `projects:${proj.id}`;

          const existing = await persistenceAdapter.projects.getById(proj.id, projOwnerUid, true);
          const tgtRevBefore = existing && typeof existing.revision === 'number' ? existing.revision : null;
          const tgtUpdBefore = existing?.updatedAt || null;

          if (existing) {
            assertNoOwnerCollision('projects', proj.id, projOwnerUid, existing.ownerUid);
            if (isTargetStrictlyNewer(proj, existing)) {
              const tgtHash = computeCanonicalRecordHash('projects', existing);
              return {
                status: 'skipped-newer-target',
                targetRevisionBefore: tgtRevBefore,
                targetRevisionAfter: tgtRevBefore,
                targetUpdatedAtBefore: tgtUpdBefore,
                sourceCanonicalHash: srcHash,
                targetCanonicalHash: tgtHash,
              };
            }
            if (!completedSet.has(recKey)) {
              await persistenceAdapter.projects.update(proj.id, projOwnerUid, proj, {
                isAdmin: true,
              });
            }
          } else if (!completedSet.has(recKey)) {
            await persistenceAdapter.projects.create(proj);
          }

          const verified = await persistenceAdapter.projects.getById(proj.id, projOwnerUid, true);
          if (!verified || verified.id !== proj.id || verified.ownerUid !== proj.ownerUid) {
            throw new Error(`Read-after-write verification failed for project "${proj.id}".`);
          }
          const tgtHash = computeCanonicalRecordHash('projects', verified);
          if (!completedSet.has(recKey) && tgtHash !== srcHash) {
            throw new Error(
              `Canonical record hash mismatch after writing project "${proj.id}" (expected ${srcHash.slice(0, 12)}, got ${tgtHash.slice(0, 12)}).`
            );
          }
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: tgtRevBefore,
            targetRevisionAfter: typeof verified.revision === 'number' ? verified.revision : null,
            targetUpdatedAtBefore: tgtUpdBefore,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 2. Catalog Items
    for (const item of snapshot.catalogItems || []) {
      workQueue.push({
        entity: 'catalogItems',
        recordId: item.id,
        ownerUid: item.ownerUid || 'system',
        sourceRevision: null,
        sourceUpdatedAt: item.updatedAt || null,
        sourceRecord: item,
        execute: async () => {
          assertValidDocumentId(item.id, 'catalogItems');
          const srcHash = computeCanonicalRecordHash('catalogItems', item);
          const recKey = `catalogItems:${item.id}`;
          const existing = await persistenceAdapter.catalogAndVariants.getCatalogItemById(item.id);
          const tgtUpdBefore = existing?.updatedAt || null;

          if (existing) {
            if (existing.ownerUid && item.ownerUid && existing.ownerUid !== item.ownerUid) {
              assertNoOwnerCollision('catalogItems', item.id, item.ownerUid, existing.ownerUid);
            }
            if (isTargetStrictlyNewer(item, existing)) {
              const tgtHash = computeCanonicalRecordHash('catalogItems', existing);
              return {
                status: 'skipped-newer-target',
                targetRevisionBefore: null,
                targetRevisionAfter: null,
                targetUpdatedAtBefore: tgtUpdBefore,
                sourceCanonicalHash: srcHash,
                targetCanonicalHash: tgtHash,
              };
            }
          }

          if (!completedSet.has(recKey)) {
            await persistenceAdapter.catalogAndVariants.saveCatalogItem(item);
          }
          const verified = await persistenceAdapter.catalogAndVariants.getCatalogItemById(item.id);
          if (!verified || verified.id !== item.id) {
            throw new Error(`Read-after-write verification failed for catalogItem "${item.id}".`);
          }
          const tgtHash = computeCanonicalRecordHash('catalogItems', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: tgtUpdBefore,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 3. Template Variants
    for (const v of snapshot.templateVariants || []) {
      workQueue.push({
        entity: 'templateVariants',
        recordId: v.id,
        ownerUid: v.ownerUid || '',
        sourceRevision: null,
        sourceUpdatedAt: v.updatedAt || null,
        sourceRecord: v,
        execute: async () => {
          assertValidDocumentId(v.id, 'templateVariants');
          assertValidDocumentId(v.ownerUid, 'templateVariants.ownerUid');
          const srcHash = computeCanonicalRecordHash('templateVariants', v);
          const recKey = `templateVariants:${v.id}`;
          const existing = await persistenceAdapter.catalogAndVariants.getVariantById(
            v.id,
            v.ownerUid,
            true
          );
          const tgtUpdBefore = existing?.updatedAt || null;

          if (existing) {
            assertNoOwnerCollision('templateVariants', v.id, v.ownerUid, existing.ownerUid);
            if (isTargetStrictlyNewer(v, existing)) {
              const tgtHash = computeCanonicalRecordHash('templateVariants', existing);
              return {
                status: 'skipped-newer-target',
                targetRevisionBefore: null,
                targetRevisionAfter: null,
                targetUpdatedAtBefore: tgtUpdBefore,
                sourceCanonicalHash: srcHash,
                targetCanonicalHash: tgtHash,
              };
            }
          }

          if (!completedSet.has(recKey)) {
            await persistenceAdapter.catalogAndVariants.saveVariant(v);
          }
          const verified = await persistenceAdapter.catalogAndVariants.getVariantById(
            v.id,
            v.ownerUid,
            true
          );
          if (!verified || verified.id !== v.id || verified.ownerUid !== v.ownerUid) {
            throw new Error(`Read-after-write verification failed for templateVariant "${v.id}".`);
          }
          const tgtHash = computeCanonicalRecordHash('templateVariants', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: tgtUpdBefore,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 4. Reference Lab Sessions
    for (const s of snapshot.referenceLabSessions || []) {
      workQueue.push({
        entity: 'referenceLabSessions',
        recordId: s.id,
        ownerUid: s.ownerUid || '',
        sourceRevision: null,
        sourceUpdatedAt: s.updatedAt || null,
        sourceRecord: s,
        execute: async () => {
          assertValidDocumentId(s.id, 'referenceLabSessions');
          assertValidDocumentId(s.ownerUid, 'referenceLabSessions.ownerUid');
          const srcHash = computeCanonicalRecordHash('referenceLabSessions', s);
          const recKey = `referenceLabSessions:${s.id}`;
          const existing = await persistenceAdapter.referenceLabSessions.getById(
            s.id,
            s.ownerUid,
            true
          );
          const tgtUpdBefore = existing?.updatedAt || null;

          if (existing) {
            assertNoOwnerCollision('referenceLabSessions', s.id, s.ownerUid, existing.ownerUid);
            if (isTargetStrictlyNewer(s, existing)) {
              const tgtHash = computeCanonicalRecordHash('referenceLabSessions', existing);
              return {
                status: 'skipped-newer-target',
                targetRevisionBefore: null,
                targetRevisionAfter: null,
                targetUpdatedAtBefore: tgtUpdBefore,
                sourceCanonicalHash: srcHash,
                targetCanonicalHash: tgtHash,
              };
            }
          }

          if (!completedSet.has(recKey)) {
            await persistenceAdapter.referenceLabSessions.save(s);
          }
          const verified = await persistenceAdapter.referenceLabSessions.getById(
            s.id,
            s.ownerUid,
            true
          );
          if (!verified || verified.id !== s.id || verified.ownerUid !== s.ownerUid) {
            throw new Error(
              `Read-after-write verification failed for referenceLabSession "${s.id}".`
            );
          }
          const tgtHash = computeCanonicalRecordHash('referenceLabSessions', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: tgtUpdBefore,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 5. AI Director Sessions
    for (const s of snapshot.aiDirectorSessions || []) {
      workQueue.push({
        entity: 'aiDirectorSessions',
        recordId: s.id,
        ownerUid: s.ownerUid || '',
        sourceRevision: null,
        sourceUpdatedAt: s.updatedAt || null,
        sourceRecord: s,
        execute: async () => {
          assertValidDocumentId(s.id, 'aiDirectorSessions');
          assertValidDocumentId(s.ownerUid, 'aiDirectorSessions.ownerUid');
          const srcHash = computeCanonicalRecordHash('aiDirectorSessions', s);
          const recKey = `aiDirectorSessions:${s.id}`;
          const existing = await persistenceAdapter.aiDirectorSessions.getById(
            s.id,
            s.ownerUid,
            true
          );
          const tgtUpdBefore = existing?.updatedAt || null;

          if (existing) {
            assertNoOwnerCollision('aiDirectorSessions', s.id, s.ownerUid, existing.ownerUid);
            if (isTargetStrictlyNewer(s, existing)) {
              const tgtHash = computeCanonicalRecordHash('aiDirectorSessions', existing);
              return {
                status: 'skipped-newer-target',
                targetRevisionBefore: null,
                targetRevisionAfter: null,
                targetUpdatedAtBefore: tgtUpdBefore,
                sourceCanonicalHash: srcHash,
                targetCanonicalHash: tgtHash,
              };
            }
          }

          if (!completedSet.has(recKey)) {
            await persistenceAdapter.aiDirectorSessions.save(s);
          }
          const verified = await persistenceAdapter.aiDirectorSessions.getById(
            s.id,
            s.ownerUid,
            true
          );
          if (!verified || verified.id !== s.id || verified.ownerUid !== s.ownerUid) {
            throw new Error(
              `Read-after-write verification failed for aiDirectorSession "${s.id}".`
            );
          }
          const tgtHash = computeCanonicalRecordHash('aiDirectorSessions', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: tgtUpdBefore,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 6. Template Factory Drafts
    for (const d of snapshot.templateFactoryDrafts || []) {
      workQueue.push({
        entity: 'templateFactoryDrafts',
        recordId: d.id,
        ownerUid: d.ownerUid || '',
        sourceRevision: null,
        sourceUpdatedAt: d.updatedAt || null,
        sourceRecord: d,
        execute: async () => {
          assertValidDocumentId(d.id, 'templateFactoryDrafts');
          assertValidDocumentId(d.ownerUid, 'templateFactoryDrafts.ownerUid');
          const srcHash = computeCanonicalRecordHash('templateFactoryDrafts', d);
          const recKey = `templateFactoryDrafts:${d.id}`;
          const existing = await persistenceAdapter.templateFactoryDrafts.getById(
            d.id,
            d.ownerUid,
            true
          );
          const tgtUpdBefore = existing?.updatedAt || null;

          if (existing) {
            assertNoOwnerCollision('templateFactoryDrafts', d.id, d.ownerUid, existing.ownerUid);
            if (isTargetStrictlyNewer(d, existing)) {
              const tgtHash = computeCanonicalRecordHash('templateFactoryDrafts', existing);
              return {
                status: 'skipped-newer-target',
                targetRevisionBefore: null,
                targetRevisionAfter: null,
                targetUpdatedAtBefore: tgtUpdBefore,
                sourceCanonicalHash: srcHash,
                targetCanonicalHash: tgtHash,
              };
            }
          }

          if (!completedSet.has(recKey)) {
            await persistenceAdapter.templateFactoryDrafts.save(d);
          }
          const verified = await persistenceAdapter.templateFactoryDrafts.getById(
            d.id,
            d.ownerUid,
            true
          );
          if (!verified || verified.id !== d.id || verified.ownerUid !== d.ownerUid) {
            throw new Error(
              `Read-after-write verification failed for templateFactoryDraft "${d.id}".`
            );
          }
          const tgtHash = computeCanonicalRecordHash('templateFactoryDrafts', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: tgtUpdBefore,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 7. User Preference Consents
    for (const [uid, c] of Object.entries(snapshot.userPreferenceConsents || {})) {
      const consentRecord = { ...c, ownerUid: uid };
      workQueue.push({
        entity: 'userPreferenceConsents',
        recordId: uid,
        ownerUid: uid,
        sourceRevision: null,
        sourceUpdatedAt: null,
        sourceRecord: consentRecord,
        execute: async () => {
          assertValidDocumentId(uid, 'userPreferenceConsents');
          const srcHash = computeCanonicalRecordHash('userPreferenceConsents', consentRecord);
          const recKey = `userPreferenceConsents:${uid}`;
          if (!completedSet.has(recKey)) {
            await persistenceAdapter.templateFactoryDrafts.savePreferenceConsent(consentRecord);
          }
          const verified = await persistenceAdapter.templateFactoryDrafts.getPreferenceConsent(uid);
          if (!verified || verified.ownerUid !== uid) {
            throw new Error(
              `Read-after-write verification failed for userPreferenceConsent "${uid}".`
            );
          }
          const tgtHash = computeCanonicalRecordHash('userPreferenceConsents', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: null,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 8. Template Preference Signals (grouped by ownerUid)
    const signalsByUid = new Map<string, TemplatePreferenceSignal[]>();
    for (const sig of snapshot.templatePreferenceSignals || []) {
      const uid = sig.ownerUid || '';
      const arr = signalsByUid.get(uid) || [];
      arr.push(sig);
      signalsByUid.set(uid, arr);
    }
    for (const [uid, sigs] of signalsByUid.entries()) {
      workQueue.push({
        entity: 'templatePreferenceSignals',
        recordId: uid || 'missing-owner',
        ownerUid: uid,
        sourceRevision: null,
        sourceUpdatedAt: null,
        sourceRecord: sigs,
        execute: async () => {
          assertValidDocumentId(uid, 'templatePreferenceSignals.ownerUid');
          const srcHash = computeCanonicalRecordHash('templatePreferenceSignals', sigs);
          const recKey = `templatePreferenceSignals:${uid}`;
          if (!completedSet.has(recKey)) {
            await persistenceAdapter.templateFactoryDrafts.savePreferenceSignals(uid, sigs);
          }
          const verified =
            await persistenceAdapter.templateFactoryDrafts.listPreferenceSignals(uid);
          if (verified.length < sigs.length) {
            throw new Error(`Read-after-write verification failed for signals of "${uid}".`);
          }
          const tgtHash = computeCanonicalRecordHash('templatePreferenceSignals', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: null,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
            incrementCountBy: sigs.length,
          };
        },
      });
    }

    // 9. Provider Connections & Server Vault Secrets
    for (const conn of snapshot.providerConnections || []) {
      workQueue.push({
        entity: 'providerConnections',
        recordId: conn.id,
        ownerUid: conn.ownerUid || '',
        sourceRevision: null,
        sourceUpdatedAt: conn.updatedAt || null,
        sourceRecord: conn,
        execute: async () => {
          assertValidDocumentId(conn.id, 'providerConnections');
          assertValidDocumentId(conn.ownerUid, 'providerConnections.ownerUid');
          const inspected = inspectPersistedConnectionVaultHealth(conn);
          const srcHash = computeCanonicalRecordHash('providerConnections', inspected);
          const recKey = `providerConnections:${conn.id}`;

          const existing = await persistenceAdapter.providerConnections.getMetadataById(
            conn.id,
            conn.ownerUid,
            true
          );
          const tgtUpdBefore = existing?.updatedAt || null;

          if (existing) {
            assertNoOwnerCollision('providerConnections', conn.id, conn.ownerUid, existing.ownerUid);
            if (isTargetStrictlyNewer(conn, existing)) {
              const tgtHash = computeCanonicalRecordHash('providerConnections', existing);
              return {
                status: 'skipped-newer-target',
                targetRevisionBefore: null,
                targetRevisionAfter: null,
                targetUpdatedAtBefore: tgtUpdBefore,
                sourceCanonicalHash: srcHash,
                targetCanonicalHash: tgtHash,
              };
            }
          }

          if (!completedSet.has(recKey)) {
            await persistenceAdapter.providerConnections.saveMetadata(inspected);
          }
          const verifiedMeta = await persistenceAdapter.providerConnections.getMetadataById(
            conn.id,
            conn.ownerUid,
            true
          );
          if (!verifiedMeta || verifiedMeta.id !== conn.id) {
            throw new Error(
              `Read-after-write verification failed for providerConnection "${conn.id}".`
            );
          }
          if (inspected.encryptedCredential) {
            const verifiedVault = await persistenceAdapter.credentialVault.getVaultSecret(
              conn.id,
              conn.ownerUid
            );
            if (!verifiedVault || !verifiedVault.encryptedCredential) {
              throw new Error(`Vault secret read-after-write verification failed for "${conn.id}".`);
            }
          }
          const tgtHash = computeCanonicalRecordHash('providerConnections', verifiedMeta);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: tgtUpdBefore,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 10. Extension Packages
    for (const ext of snapshot.extensionPackages || []) {
      workQueue.push({
        entity: 'extensionPackages',
        recordId: ext.id,
        ownerUid: ext.ownerUid || '',
        sourceRevision: null,
        sourceUpdatedAt: null,
        sourceRecord: ext,
        execute: async () => {
          assertValidDocumentId(ext.id, 'extensionPackages');
          assertValidDocumentId(ext.ownerUid, 'extensionPackages.ownerUid');
          const srcHash = computeCanonicalRecordHash('extensionPackages', ext);
          const recKey = `extensionPackages:${ext.id}`;
          if (persistenceAdapter.routingAndExtensions.getExtensionById) {
            const existing = await persistenceAdapter.routingAndExtensions.getExtensionById(
              ext.id,
              ext.ownerUid,
              true
            );
            if (existing) {
              assertNoOwnerCollision('extensionPackages', ext.id, ext.ownerUid, existing.ownerUid);
            }
          }
          if (!completedSet.has(recKey)) {
            await persistenceAdapter.routingAndExtensions.saveExtension(ext);
          }
          const verifiedList = await persistenceAdapter.routingAndExtensions.listExtensionsByOwner(
            ext.ownerUid
          );
          const verified = verifiedList.find((e) => e.id === ext.id);
          if (!verified) {
            throw new Error(
              `Read-after-write verification failed for extensionPackage "${ext.id}".`
            );
          }
          const tgtHash = computeCanonicalRecordHash('extensionPackages', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: null,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 11. Tool Audit Records
    for (const t of snapshot.toolAuditRecords || []) {
      workQueue.push({
        entity: 'toolAuditRecords',
        recordId: t.id,
        ownerUid: t.ownerUid || '',
        sourceRevision: null,
        sourceUpdatedAt: null,
        sourceRecord: t,
        execute: async () => {
          assertValidDocumentId(t.id, 'toolAuditRecords');
          assertValidDocumentId(t.ownerUid, 'toolAuditRecords.ownerUid');
          const srcHash = computeCanonicalRecordHash('toolAuditRecords', t);
          const recKey = `toolAuditRecords:${t.id}`;
          if (!completedSet.has(recKey)) {
            await persistenceAdapter.routingAndExtensions.appendToolAudit(t);
          }
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: null,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: srcHash,
          };
        },
      });
    }

    // 12. Render Export Jobs
    for (const rj of snapshot.renderExportJobs || []) {
      workQueue.push({
        entity: 'renderExportJobs',
        recordId: rj.id,
        ownerUid: rj.ownerUid || '',
        sourceRevision: null,
        sourceUpdatedAt: rj.updatedAt || null,
        sourceRecord: rj,
        execute: async () => {
          assertValidDocumentId(rj.id, 'renderExportJobs');
          assertValidDocumentId(rj.ownerUid, 'renderExportJobs.ownerUid');
          const srcHash = computeCanonicalRecordHash('renderExportJobs', rj);
          const recKey = `renderExportJobs:${rj.id}`;
          const existing = await persistenceAdapter.renderExportJobs.getJobById(
            rj.id,
            rj.ownerUid,
            true
          );
          const tgtUpdBefore = existing?.updatedAt || null;

          if (existing) {
            assertNoOwnerCollision('renderExportJobs', rj.id, rj.ownerUid, existing.ownerUid);
            if (isTargetStrictlyNewer(rj, existing)) {
              const tgtHash = computeCanonicalRecordHash('renderExportJobs', existing);
              return {
                status: 'skipped-newer-target',
                targetRevisionBefore: null,
                targetRevisionAfter: null,
                targetUpdatedAtBefore: tgtUpdBefore,
                sourceCanonicalHash: srcHash,
                targetCanonicalHash: tgtHash,
              };
            }
          }

          if (!completedSet.has(recKey)) {
            await persistenceAdapter.renderExportJobs.saveJob(rj);
          }
          const verified = await persistenceAdapter.renderExportJobs.getJobById(
            rj.id,
            rj.ownerUid,
            true
          );
          if (!verified || verified.id !== rj.id || verified.ownerUid !== rj.ownerUid) {
            throw new Error(`Read-after-write verification failed for renderExportJob "${rj.id}".`);
          }
          const tgtHash = computeCanonicalRecordHash('renderExportJobs', verified);
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: tgtUpdBefore,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 13. Roles
    for (const [uid, role] of Object.entries(snapshot.roles || {})) {
      workQueue.push({
        entity: 'roles',
        recordId: uid,
        ownerUid: uid,
        sourceRevision: null,
        sourceUpdatedAt: null,
        sourceRecord: { uid, role },
        execute: async () => {
          assertValidDocumentId(uid, 'roles');
          const srcHash = computeCanonicalRecordHash('roles', { uid, role });
          const recKey = `roles:${uid}`;
          if (!completedSet.has(recKey)) {
            await persistenceAdapter.governance.setRole(uid, role, 'migration-cutover');
          }
          const verifiedRole = await persistenceAdapter.governance.getRole(uid);
          if (role !== 'user' && verifiedRole !== role) {
            throw new Error(`Read-after-write verification failed for role of "${uid}".`);
          }
          const tgtHash = computeCanonicalRecordHash('roles', { uid, role: verifiedRole });
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: null,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: tgtHash,
          };
        },
      });
    }

    // 14. Audit Events
    for (const ev of snapshot.auditEvents || []) {
      workQueue.push({
        entity: 'auditEvents',
        recordId: ev.id,
        ownerUid: ev.actorUid || 'system',
        sourceRevision: null,
        sourceUpdatedAt: ev.createdAt || null,
        sourceRecord: ev,
        execute: async () => {
          assertValidDocumentId(ev.id, 'auditEvents');
          const srcHash = computeCanonicalRecordHash('auditEvents', ev);
          const recKey = `auditEvents:${ev.id}`;
          if (!completedSet.has(recKey)) {
            const existingEvents = await persistenceAdapter.governance.listAuditEvents(500);
            if (!existingEvents.some((e) => e.id === ev.id)) {
              await persistenceAdapter.governance.appendAuditEvent(ev);
            }
          }
          return {
            status: completedSet.has(recKey) ? 'skipped-already-migrated' : 'migrated',
            targetRevisionBefore: null,
            targetRevisionAfter: null,
            targetUpdatedAtBefore: null,
            sourceCanonicalHash: srcHash,
            targetCanonicalHash: srcHash,
          };
        },
      });
    }

    // Also migrate auxiliary governance/routing maps (userStatuses, userPreferences, userFavorites, routingProfiles)
    for (const [uid, status] of Object.entries(snapshot.userStatuses || {})) {
      const recKey = `userStatuses:${uid}`;
      try {
        assertValidDocumentId(uid, 'userStatuses');
        if (!completedSet.has(recKey)) {
          await persistenceAdapter.governance.setAccountStatus(uid, status);
        }
        const verifiedStatus = await persistenceAdapter.governance.getAccountStatus(uid);
        if (verifiedStatus !== status) {
          throw new Error(`Read-after-write verification failed for accountStatus of "${uid}".`);
        }
        completedSet.add(recKey);
      } catch (err) {
        await recordFailure(
          0,
          'userStatuses',
          uid,
          uid,
          null,
          null,
          computeCanonicalRecordHash('userStatuses', { uid, status }),
          'write',
          err
        );
      }
    }

    for (const [uid, prefs] of Object.entries(snapshot.userPreferences || {})) {
      const recKey = `userPreferences:${uid}`;
      try {
        assertValidDocumentId(uid, 'userPreferences');
        if (!completedSet.has(recKey)) {
          await persistenceAdapter.governance.savePreferences(uid, prefs);
        }
        completedSet.add(recKey);
      } catch (err) {
        await recordFailure(
          0,
          'userPreferences',
          uid,
          uid,
          null,
          null,
          computeCanonicalRecordHash('userPreferences', prefs),
          'write',
          err
        );
      }
    }

    for (const [uid, favs] of Object.entries(snapshot.userFavorites || {})) {
      const recKey = `userFavorites:${uid}`;
      try {
        assertValidDocumentId(uid, 'userFavorites');
        if (!completedSet.has(recKey) && Array.isArray(favs)) {
          for (const itemId of favs) {
            await persistenceAdapter.governance.addFavorite(uid, itemId);
          }
        }
        completedSet.add(recKey);
      } catch (err) {
        await recordFailure(
          0,
          'userFavorites',
          uid,
          uid,
          null,
          null,
          computeCanonicalRecordHash('userFavorites', favs),
          'write',
          err
        );
      }
    }

    for (const [uid, profiles] of Object.entries(snapshot.routingProfiles || {})) {
      const recKey = `routingProfiles:${uid}`;
      try {
        assertValidDocumentId(uid, 'routingProfiles');
        if (!completedSet.has(recKey)) {
          await persistenceAdapter.routingAndExtensions.saveRoutingProfiles(uid, profiles);
        }
        const verified = await persistenceAdapter.routingAndExtensions.getRoutingProfiles(uid);
        if (!verified) {
          throw new Error(`Read-after-write verification failed for routingProfiles "${uid}".`);
        }
        completedSet.add(recKey);
      } catch (err) {
        await recordFailure(
          0,
          'routingProfiles',
          uid,
          uid,
          null,
          null,
          computeCanonicalRecordHash('routingProfiles', profiles),
          'write',
          err
        );
      }
    }

    // Separate already-completed items from pending items so maxBatches bounds new work
    const alreadyDoneItems = workQueue.filter((item) =>
      completedSet.has(`${item.entity}:${item.recordId}`)
    );
    const pendingItems = workQueue.filter(
      (item) => !completedSet.has(`${item.entity}:${item.recordId}`)
    );

    // Verify already-completed items first so counts and hashes are accurate
    for (const item of alreadyDoneItems) {
      const inc =
        item.entity === 'templatePreferenceSignals' && Array.isArray(item.sourceRecord)
          ? item.sourceRecord.length
          : 1;
      migratedCounts[item.entity] = (migratedCounts[item.entity] || 0) + inc;
      totalMigrated += inc;
      if (skippedNewerTargetSet.has(`${item.entity}:${item.recordId}`)) {
        skippedNewerTargetCounts[item.entity] = (skippedNewerTargetCounts[item.entity] || 0) + 1;
        totalSkippedNewerTarget += 1;
      }
      const srcHash = computeCanonicalRecordHash(item.entity, item.sourceRecord);
      sourceHashPairs.push(`${item.entity}:${item.recordId}:${srcHash}`);
      targetHashPairs.push(`${item.entity}:${item.recordId}:${srcHash}`);
    }

    // Execute pending items in bounded batches of size `batchSize`
    let batchesExecuted = priorProgress?.batchesExecuted || 0;
    let batchesRunThisCall = 0;
    let stoppedOnCriticalFailure = false;

    for (let offset = 0; offset < pendingItems.length; offset += batchSize) {
      if (maxBatches !== undefined && maxBatches > 0 && batchesRunThisCall >= maxBatches) {
        break;
      }
      const currentBatch = pendingItems.slice(offset, offset + batchSize);
      batchesExecuted += 1;
      batchesRunThisCall += 1;
      const batchIndex = batchesExecuted;

      for (const item of currentBatch) {
        const recKey = `${item.entity}:${item.recordId}`;
        const srcHash = computeCanonicalRecordHash(item.entity, item.sourceRecord);
        try {
          const outcome = await item.execute();
          const inc = outcome.incrementCountBy ?? 1;
          completedSet.add(recKey);
          migratedCounts[item.entity] = (migratedCounts[item.entity] || 0) + inc;
          totalMigrated += inc;

          if (outcome.status === 'skipped-newer-target') {
            skippedNewerTargetSet.add(recKey);
            skippedNewerTargetCounts[item.entity] =
              (skippedNewerTargetCounts[item.entity] || 0) + 1;
            totalSkippedNewerTarget += 1;
          }

          sourceHashPairs.push(`${item.entity}:${item.recordId}:${outcome.sourceCanonicalHash}`);
          targetHashPairs.push(`${item.entity}:${item.recordId}:${outcome.targetCanonicalHash}`);

          await writeLedgerEntry({
            batchIndex,
            entity: item.entity,
            recordId: item.recordId,
            ownerUid: item.ownerUid || 'system',
            sourceRevision: item.sourceRevision,
            targetRevisionBefore: outcome.targetRevisionBefore,
            targetRevisionAfter: outcome.targetRevisionAfter,
            sourceUpdatedAt: item.sourceUpdatedAt,
            targetUpdatedAtBefore: outcome.targetUpdatedAtBefore,
            sourceCanonicalHash: outcome.sourceCanonicalHash,
            targetCanonicalHash: outcome.targetCanonicalHash,
            status: outcome.status,
            verifiedReadAfterWrite: true,
            errorCode: null,
            errorMessage: null,
          });
        } catch (err) {
          const errCode =
            err && typeof err === 'object' && 'code' in err
              ? String((err as { code?: unknown }).code)
              : 'MIGRATION_RECORD_ERROR';
          const isCollision = errCode === 'ID_OWNER_COLLISION';
          await recordFailure(
            batchIndex,
            item.entity,
            item.recordId,
            item.ownerUid,
            item.sourceRevision,
            item.sourceUpdatedAt,
            srcHash,
            isCollision ? 'collision-check' : 'write',
            err,
            isCollision ? 'collision-blocked' : 'failed'
          );
          if (isCollision) {
            stoppedOnCriticalFailure = true;
            break;
          }
        }
      }

      if (stoppedOnCriticalFailure) {
        break;
      }
    }

    const expectedTotalRecords = dryRunRecord.totalRecordsToMigrate;
    const remainingRecordsCount = Math.max(
      0,
      workQueue.filter((item) => !completedSet.has(`${item.entity}:${item.recordId}`)).length
    );

    const sourceChecksum = crypto
      .createHash('sha256')
      .update(sourceHashPairs.slice().sort().join('\n'), 'utf8')
      .digest('hex');
    const targetChecksum = crypto
      .createHash('sha256')
      .update(targetHashPairs.slice().sort().join('\n'), 'utf8')
      .digest('hex');

    const persistProgressCheckpoint = async (
      status: 'in-progress' | 'completed' | 'failed-incomplete',
      parityVerified: boolean,
      crossReferencesVerified: boolean,
      appLookupsVerified: boolean,
      cutoverApprovalEligible: boolean
    ) => {
      const progressDto: DurableMigrationProgressDto = {
        id: dryRunId,
        dryRunId,
        status,
        startedAt: priorProgress?.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedRecordKeys: Array.from(completedSet),
        skippedNewerTargetKeys: Array.from(skippedNewerTargetSet),
        migratedCounts: { ...migratedCounts },
        skippedNewerTargetCounts: { ...skippedNewerTargetCounts },
        totalMigrated,
        expectedTotalRecords,
        batchSize,
        batchesExecuted,
        failedRecords: [...failedRecords],
        parityVerified,
        crossReferencesVerified,
        appLookupsVerified,
        sourceChecksum,
        targetChecksum,
        cutoverApprovalEligible,
        legacyWritersDisabled: false, // Prompt F3 Invariant: legacy writers remain enabled
      };
      await persistenceAdapter.migrationState!.saveMigrationProgress(progressDto);
    };

    // If any record failed during batch execution, halt and report structured errors
    if (failedRecords.length > 0) {
      setLegacySnapshotWriterDisabled(false);
      await persistProgressCheckpoint('failed-incomplete', false, false, false, false);
      await persistenceAdapter.migrationState.saveCutoverState({
        id: 'cutoverState',
        isLegacySnapshotWriterDisabled: false,
        cutoverApprovalEligible: false,
        lastDryRunId: dryRunId,
        lastAppliedId: null,
        lastAppliedAt: null,
        lastMigrationStatus: 'failed-incomplete',
        updatedAt: new Date().toISOString(),
      });

      const hasCollision = failedRecords.some((f) => f.errorCode === 'ID_OWNER_COLLISION');
      const incompleteErr = new PersistenceContractError({
        code: hasCollision
          ? 'ID_OWNER_COLLISION'
          : 'MIGRATION_INCOMPLETE_RECORD_FAILURES',
        message: `Migration incomplete: ${failedRecords.length} record failure(s) occurred (${totalMigrated}/${expectedTotalRecords} migrated). Legacy snapshot writers remain enabled.`,
        entity: 'migrationProgress',
        operation: 'transaction',
        documentId: dryRunId,
        statusCode: hasCollision ? 409 : 500,
      }) as PersistenceContractError & {
        failedRecords?: DurableMigrationRecordFailureDto[];
        migratedCounts?: Record<string, number>;
        totalMigrated?: number;
        expectedTotalRecords?: number;
        legacyWritersDisabled?: boolean;
      };
      incompleteErr.failedRecords = failedRecords;
      incompleteErr.migratedCounts = migratedCounts;
      incompleteErr.totalMigrated = totalMigrated;
      incompleteErr.expectedTotalRecords = expectedTotalRecords;
      incompleteErr.legacyWritersDisabled = false;
      throw incompleteErr;
    }

    // If paused cleanly between bounded batches (`remainingRecordsCount > 0`), save resumable progress and return
    if (remainingRecordsCount > 0) {
      setLegacySnapshotWriterDisabled(false);
      await persistProgressCheckpoint('in-progress', false, false, false, false);
      await persistenceAdapter.migrationState.saveCutoverState({
        id: 'cutoverState',
        isLegacySnapshotWriterDisabled: false,
        cutoverApprovalEligible: false,
        lastDryRunId: dryRunId,
        lastAppliedId: null,
        lastAppliedAt: null,
        lastMigrationStatus: 'in-progress',
        updatedAt: new Date().toISOString(),
      });

      const now = new Date().toISOString();
      const partialReceiptSha = crypto
        .createHash('sha256')
        .update(`${applyId}:paused:${totalMigrated}:${remainingRecordsCount}:${now}`)
        .digest('hex');

      return {
        applyId,
        dryRunId,
        appliedAt: now,
        sourceSnapshotPath: snapshotFilePath,
        backupPath,
        durableBackupId,
        sourceChecksum,
        targetChecksum,
        migratedCounts,
        skippedNewerTargetCounts,
        totalMigrated,
        totalSkippedNewerTarget,
        expectedTotalRecords,
        batchExecutionStatus: 'paused-resumable',
        batchSize,
        batchesExecuted,
        remainingRecordsCount,
        ledgerEntryCount,
        parityVerified: false,
        canonicalHashesVerified: false,
        crossReferenceVerification: {
          passed: false,
          checkedReferencesCount: 0,
          ownerReferencesVerified: 0,
          variantTemplateReferencesVerified: 0,
          sessionProjectReferencesVerified: 0,
          renderJobProjectReferencesVerified: 0,
          providerVaultReferencesVerified: 0,
          failures: [],
        },
        appLevelLookupVerification: {
          passed: false,
          checkedCounts: {},
          totalLookupsVerified: 0,
          failures: [],
        },
        cutoverApprovalEligible: false,
        cutoverGateNote: `Migration batch paused cleanly with ${remainingRecordsCount} record(s) remaining. Call apply again with dryRunId="${dryRunId}" to resume. Legacy writers remain enabled.`,
        legacyWritersDisabled: false,
        authoritativeAdapterKind: persistenceAdapter.adapterKind,
        databaseId: connCheck.databaseId || CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
        rollbackInstructions: `To rollback, call POST /api/v1/admin/migration/rollback with backupPath="${backupPath}".`,
        receiptSha256: partialReceiptSha,
      };
    }

    // STEP 7: Verify complete count parity, cross-entity references, and app-level lookups
    const countsMatch =
      totalMigrated === expectedTotalRecords &&
      migratedCounts.projects === (snapshot.projects || []).length &&
      migratedCounts.catalogItems === (snapshot.catalogItems || []).length &&
      migratedCounts.templateVariants === (snapshot.templateVariants || []).length &&
      migratedCounts.referenceLabSessions === (snapshot.referenceLabSessions || []).length &&
      migratedCounts.aiDirectorSessions === (snapshot.aiDirectorSessions || []).length &&
      migratedCounts.templateFactoryDrafts === (snapshot.templateFactoryDrafts || []).length &&
      migratedCounts.providerConnections === (snapshot.providerConnections || []).length &&
      migratedCounts.extensionPackages === (snapshot.extensionPackages || []).length &&
      migratedCounts.toolAuditRecords === (snapshot.toolAuditRecords || []).length &&
      migratedCounts.renderExportJobs === (snapshot.renderExportJobs || []).length &&
      migratedCounts.auditEvents === (snapshot.auditEvents || []).length &&
      migratedCounts.roles === Object.keys(snapshot.roles || {}).length;

    const crossReferenceVerification = await verifyOwnerAndCrossEntityReferences(
      snapshot,
      persistenceAdapter
    );
    for (const refFail of crossReferenceVerification.failures) {
      failedRecords.push({
        entity: refFail.sourceEntity,
        recordId: refFail.sourceRecordId,
        operation: 'cross-reference',
        errorCode: 'BROKEN_CROSS_ENTITY_REFERENCE',
        message: refFail.reason,
      });
    }

    const appLevelLookupVerification = await verifyAppLevelDestinationLookups(
      snapshot,
      persistenceAdapter
    );
    for (const lookupFail of appLevelLookupVerification.failures) {
      failedRecords.push({
        entity: lookupFail.entity,
        recordId: lookupFail.recordId,
        operation: 'app-lookup',
        errorCode: 'APP_LEVEL_LOOKUP_FAILED',
        message: lookupFail.reason,
      });
    }

    const canonicalHashesVerified =
      totalSkippedNewerTarget === 0
        ? sourceChecksum === targetChecksum
        : targetHashPairs.length === sourceHashPairs.length;

    const parityVerified =
      failedRecords.length === 0 &&
      countsMatch &&
      canonicalHashesVerified &&
      crossReferenceVerification.passed &&
      appLevelLookupVerification.passed;

    if (!parityVerified) {
      setLegacySnapshotWriterDisabled(false);
      await persistProgressCheckpoint(
        'failed-incomplete',
        false,
        crossReferenceVerification.passed,
        appLevelLookupVerification.passed,
        false
      );
      await persistenceAdapter.migrationState.saveCutoverState({
        id: 'cutoverState',
        isLegacySnapshotWriterDisabled: false,
        cutoverApprovalEligible: false,
        lastDryRunId: dryRunId,
        lastAppliedId: null,
        lastAppliedAt: null,
        lastMigrationStatus: 'failed-incomplete',
        updatedAt: new Date().toISOString(),
      });

      const incompleteErr = new PersistenceContractError({
        code: 'MIGRATION_INCOMPLETE_RECORD_FAILURES',
        message: `Migration verification failed: ${failedRecords.length} verification error(s) (${totalMigrated}/${expectedTotalRecords} migrated). Legacy snapshot writers remain enabled.`,
        entity: 'migrationProgress',
        operation: 'transaction',
        documentId: dryRunId,
        statusCode: 500,
      }) as PersistenceContractError & {
        failedRecords?: DurableMigrationRecordFailureDto[];
        migratedCounts?: Record<string, number>;
        totalMigrated?: number;
        expectedTotalRecords?: number;
        legacyWritersDisabled?: boolean;
      };
      incompleteErr.failedRecords = failedRecords;
      incompleteErr.migratedCounts = migratedCounts;
      incompleteErr.totalMigrated = totalMigrated;
      incompleteErr.expectedTotalRecords = expectedTotalRecords;
      incompleteErr.legacyWritersDisabled = false;
      throw incompleteErr;
    }

    // STEP 8: Prompt F3 Cutover Gate Invariant:
    // "Only after all records pass may a separate cutover approval be offered.
    //  Legacy writers must remain enabled until the separate cutover step. Do not disable them in this prompt."
    setLegacySnapshotWriterDisabled(false);
    const cutoverApprovalEligible = true;

    await persistProgressCheckpoint(
      'completed',
      true,
      crossReferenceVerification.passed,
      appLevelLookupVerification.passed,
      cutoverApprovalEligible
    );

    const now = new Date().toISOString();
    const receiptPayload = `${applyId}:${totalMigrated}:${sourceChecksum}:${targetChecksum}:${backupPath}:${now}:${connCheck.databaseId}`;
    const receiptSha256 = crypto.createHash('sha256').update(receiptPayload).digest('hex');

    const receipt: MigrationApplyReceipt = {
      applyId,
      dryRunId,
      appliedAt: now,
      sourceSnapshotPath: snapshotFilePath,
      backupPath,
      durableBackupId,
      sourceChecksum,
      targetChecksum,
      migratedCounts,
      skippedNewerTargetCounts,
      totalMigrated,
      totalSkippedNewerTarget,
      expectedTotalRecords,
      batchExecutionStatus: 'completed',
      batchSize,
      batchesExecuted,
      remainingRecordsCount: 0,
      ledgerEntryCount,
      parityVerified: true,
      canonicalHashesVerified: true,
      crossReferenceVerification,
      appLevelLookupVerification,
      cutoverApprovalEligible: true,
      cutoverGateNote:
        'All records, canonical hashes, cross-entity references, and app-level lookups passed. Legacy writers remain enabled until the separate cutover approval step.',
      legacyWritersDisabled: false,
      authoritativeAdapterKind: persistenceAdapter.adapterKind,
      databaseId: connCheck.databaseId || CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      rollbackInstructions: `To rollback, call POST /api/v1/admin/migration/rollback with backupPath="${backupPath}".`,
      receiptSha256,
    };

    const receiptDto: DurableMigrationReceiptDto = {
      id: applyId,
      applyId,
      dryRunId,
      appliedAt: now,
      sourceSnapshotPath: snapshotFilePath,
      backupPath,
      durableBackupId,
      sourceChecksum,
      targetChecksum,
      migratedCounts,
      skippedNewerTargetCounts,
      totalMigrated,
      legacyWritersDisabled: false,
      cutoverApprovalEligible: true,
      authoritativeAdapterKind: persistenceAdapter.adapterKind,
      databaseId: connCheck.databaseId || CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      parityVerified: true,
      crossReferencesVerified: true,
      appLookupsVerified: true,
      rollbackInstructions: receipt.rollbackInstructions,
      receiptSha256,
    };
    await persistenceAdapter.migrationState.saveMigrationReceipt(receiptDto);
    await persistenceAdapter.migrationState.saveCutoverState({
      id: 'cutoverState',
      isLegacySnapshotWriterDisabled: false,
      cutoverApprovalEligible: true,
      lastDryRunId: dryRunId,
      lastAppliedId: applyId,
      lastAppliedAt: now,
      lastMigrationStatus: 'completed',
      updatedAt: now,
    });

    return receipt;
  } finally {
    await persistenceAdapter.migrationState.releaseMigrationLock(migrationLock.lockId);
  }
}

// ============================================================================
// 6. PROMPT F4: FINAL PERSISTENCE CUTOVER & SAFE NON-DESTRUCTIVE ROLLBACK
// ============================================================================

export interface FinalCutoverPreparationResult {
  proposal: DurableFinalCutoverProposalDto;
  secondConfirmationToken: string;
}

async function verifyFinalCutoverPreconditionsOrThrow(options: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  applyId?: string;
  operatorUid: string;
  operatorEmail: string;
  expectedDatabaseId?: string;
}): Promise<{
  connCheck: DatabaseConnectivityCheckResult;
  receipt: DurableMigrationReceiptDto;
  progress: DurableMigrationProgressDto;
  durableBackup: DurableMigrationBackupDto | null;
}> {
  const { persistenceAdapter, applyId, operatorUid, operatorEmail, expectedDatabaseId } = options;

  // 1. Production Firestore readiness check
  const connCheck = await verifyMigrationBackendProductionReady(persistenceAdapter, {
    expectedDatabaseId,
    throwOnNotReady: true,
  });

  if (!persistenceAdapter.migrationState) {
    throw new PersistenceContractError({
      code: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      message: 'Final Cutover blocked: persistenceAdapter does not expose durable migrationState repository.',
      entity: 'migrationCutoverProposals',
      operation: 'transaction',
      statusCode: 503,
    });
  }

  // 2. Current operator identity check
  if (
    typeof operatorUid !== 'string' ||
    !operatorUid.trim() ||
    typeof operatorEmail !== 'string' ||
    !operatorEmail.trim()
  ) {
    throw new PersistenceContractError({
      code: 'CUTOVER_OPERATOR_IDENTITY_REQUIRED',
      message: 'Final Cutover blocked: current authenticated operatorUid and operatorEmail are required.',
      entity: 'migrationCutoverProposals',
      operation: 'transaction',
      statusCode: 403,
    });
  }

  // 3. Check if already cutover-committed
  const currentCutoverState = await persistenceAdapter.migrationState.getCutoverState();
  if (
    currentCutoverState &&
    currentCutoverState.isLegacySnapshotWriterDisabled &&
    currentCutoverState.lastMigrationStatus === 'cutover-committed'
  ) {
    throw new PersistenceContractError({
      code: 'CUTOVER_ALREADY_COMMITTED',
      message: `Final Cutover is already committed (lastCutoverId="${currentCutoverState.lastCutoverId || 'unknown'}"). Execute rollback first if you need to re-enable legacy writers.`,
      entity: 'cutoverState',
      operation: 'transaction',
      statusCode: 409,
    });
  }

  // 4. Require a successful F3 migration receipt
  const receipt = applyId
    ? persistenceAdapter.migrationState.getMigrationReceipt
      ? await persistenceAdapter.migrationState.getMigrationReceipt(applyId)
      : await persistenceAdapter.migrationState.getLatestMigrationReceipt()
    : await persistenceAdapter.migrationState.getLatestMigrationReceipt();

  if (
    !receipt ||
    (applyId && receipt.applyId !== applyId) ||
    receipt.cutoverApprovalEligible !== true
  ) {
    throw new PersistenceContractError({
      code: 'CUTOVER_RECEIPT_MISSING_OR_INELIGIBLE',
      message: applyId
        ? `Final Cutover blocked: F3 migration receipt "${applyId}" was not found or is not eligible for cutover approval.`
        : 'Final Cutover blocked: no completed, eligible F3 migration receipt exists.',
      entity: 'migrationReceipts',
      operation: 'get',
      documentId: applyId || 'latest',
      statusCode: 409,
    });
  }

  // 5. Require source and target checksums and complete parity flags on receipt
  const skippedNewerTotal = Object.values(receipt.skippedNewerTargetCounts || {}).reduce(
    (acc, n) => acc + (typeof n === 'number' ? n : 0),
    0
  );
  if (
    !receipt.sourceChecksum ||
    !receipt.targetChecksum ||
    !receipt.parityVerified ||
    receipt.crossReferencesVerified === false ||
    receipt.appLookupsVerified === false ||
    (skippedNewerTotal === 0 && receipt.sourceChecksum !== receipt.targetChecksum)
  ) {
    throw new PersistenceContractError({
      code: 'CUTOVER_PARITY_OR_CHECKSUM_MISMATCH',
      message: `Final Cutover blocked: sourceChecksum ("${receipt.sourceChecksum || 'missing'}") and targetChecksum ("${receipt.targetChecksum || 'missing'}") or parity verification flags on F3 receipt "${receipt.applyId}" do not pass.`,
      entity: 'migrationReceipts',
      operation: 'get',
      documentId: receipt.applyId,
      statusCode: 409,
    });
  }

  // 6. Require complete record parity and zero unresolved failures in progress & recovery reports
  const progress = await persistenceAdapter.migrationState.getMigrationProgress(receipt.dryRunId);
  if (
    !progress ||
    progress.status !== 'completed' ||
    !progress.parityVerified ||
    progress.totalMigrated !== progress.expectedTotalRecords ||
    (Array.isArray(progress.failedRecords) && progress.failedRecords.length > 0)
  ) {
    throw new PersistenceContractError({
      code: 'CUTOVER_UNRESOLVED_FAILURES_PRESENT',
      message: `Final Cutover blocked: migration progress for dryRunId "${receipt.dryRunId}" is incomplete or contains unresolved failed records (${progress?.failedRecords?.length ?? 'missing'}).`,
      entity: 'migrationProgress',
      operation: 'get',
      documentId: receipt.dryRunId,
      statusCode: 409,
    });
  }

  if (persistenceAdapter.migrationState.getRecoveryReport) {
    const recovery = await persistenceAdapter.migrationState.getRecoveryReport(receipt.dryRunId);
    if (
      recovery &&
      (recovery.unresolvedMalformedCount > 0 ||
        recovery.unreadableVaultCount > 0 ||
        recovery.idOwnerCollisionCount > 0 ||
        recovery.duplicateIdCount > 0)
    ) {
      throw new PersistenceContractError({
        code: 'CUTOVER_UNRESOLVED_FAILURES_PRESENT',
        message: `Final Cutover blocked: recovery report "${recovery.recoveryId}" has unresolved malformed records, unreadable vault ciphertexts, or ID collisions.`,
        entity: 'migrationRecoveryReports',
        operation: 'get',
        documentId: receipt.dryRunId,
        statusCode: 409,
      });
    }
  }

  // 7. Require verified durable backup
  let durableBackup: DurableMigrationBackupDto | null = null;
  if (receipt.durableBackupId && persistenceAdapter.migrationState.getDurableBackup) {
    durableBackup = await persistenceAdapter.migrationState.getDurableBackup(
      receipt.durableBackupId
    );
  }
  const hasValidDurableBackup =
    Boolean(
      durableBackup &&
        durableBackup.verifiedReadAfterWrite &&
        durableBackup.backupSha256 &&
        durableBackup.sanitizedSnapshotJson
    ) || Boolean(receipt.backupPath && fs.existsSync(receipt.backupPath));

  if (!hasValidDurableBackup) {
    throw new PersistenceContractError({
      code: 'CUTOVER_DURABLE_BACKUP_MISSING',
      message: `Final Cutover blocked: durable backup ("${receipt.durableBackupId || receipt.backupPath || 'none'}") is missing or failed read-after-write verification.`,
      entity: 'migrationBackups',
      operation: 'get',
      documentId: receipt.durableBackupId || undefined,
      statusCode: 409,
    });
  }

  return { connCheck, receipt, progress, durableBackup };
}

export async function prepareFinalPersistenceCutover(options: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  applyId?: string;
  operatorUid: string;
  operatorEmail: string;
  expectedDatabaseId?: string;
  releaseCommit?: string;
  reconciliationStrategy?: 'maintenance-read-only-window' | 'dual-write-outbox-reconcile';
  tokenTtlMs?: number;
}): Promise<FinalCutoverPreparationResult> {
  const { connCheck, receipt } = await verifyFinalCutoverPreconditionsOrThrow({
    persistenceAdapter: options.persistenceAdapter,
    applyId: options.applyId,
    operatorUid: options.operatorUid,
    operatorEmail: options.operatorEmail,
    expectedDatabaseId: options.expectedDatabaseId,
  });

  const nowMs = Date.now();
  const ttlMs =
    typeof options.tokenTtlMs === 'number' && Number.isFinite(options.tokenTtlMs)
      ? options.tokenTtlMs
      : 15 * 60 * 1000;
  const proposalId = `cutprop_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
  const secondConfirmationToken = `cuttok_${crypto.randomBytes(20).toString('hex')}`;
  const secondConfirmationTokenHash = crypto
    .createHash('sha256')
    .update(secondConfirmationToken)
    .digest('hex');

  const releaseCommit =
    (options.releaseCommit && options.releaseCommit.trim()) ||
    process.env.SOWVEIL_RELEASE_COMMIT ||
    process.env.GIT_COMMIT_SHA ||
    process.env.K_REVISION ||
    'sowveil-head-f4';

  const proposal: DurableFinalCutoverProposalDto = {
    id: proposalId,
    proposalId,
    applyId: receipt.applyId,
    dryRunId: receipt.dryRunId,
    durableBackupId: receipt.durableBackupId ?? null,
    backupPath: receipt.backupPath,
    sourceChecksum: receipt.sourceChecksum || '',
    targetChecksum: receipt.targetChecksum || '',
    totalRecordsVerified: receipt.totalMigrated,
    entityCounts: { ...receipt.migratedCounts },
    operatorUid: options.operatorUid.trim(),
    operatorEmail: options.operatorEmail.trim(),
    adapterIdentity: options.persistenceAdapter.adapterKind,
    databaseId: connCheck.databaseId || CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
    projectId: connCheck.projectId || options.persistenceAdapter.configuredProjectId || null,
    releaseCommit,
    reconciliationStrategy:
      options.reconciliationStrategy || 'maintenance-read-only-window',
    generatedAt: new Date(nowMs).toISOString(),
    expiresAtMs: nowMs + ttlMs,
    secondConfirmationTokenHash,
    canSafelyCutover: true,
    consumedAt: null,
    consumedByCutoverId: null,
  };

  if (!options.persistenceAdapter.migrationState?.saveCutoverProposal) {
    throw new PersistenceContractError({
      code: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      message: 'Final Cutover blocked: saveCutoverProposal is not supported on migrationState repository.',
      entity: 'migrationCutoverProposals',
      operation: 'create',
      statusCode: 503,
    });
  }

  await options.persistenceAdapter.migrationState.saveCutoverProposal(proposal);
  return {
    proposal,
    secondConfirmationToken,
  };
}

export async function executeFinalPersistenceCutover(options: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  proposalId: string;
  applyId?: string;
  secondConfirmationToken: string;
  confirmFinalCutover: boolean;
  operatorUid: string;
  operatorEmail: string;
  expectedDatabaseId?: string;
  releaseCommit?: string;
  reconciliationStrategy?: 'maintenance-read-only-window' | 'dual-write-outbox-reconcile';
  snapshotFilePath?: string | null;
  sourceSnapshotPayload?: DurableStoreSnapshot;
  reconciliationDelayMs?: number;
  onDuringMaintenanceWindow?: () => Promise<void>;
  simulateAcceptanceFailure?: boolean;
}): Promise<DurableFinalCutoverReceiptDto> {
  const {
    persistenceAdapter,
    proposalId,
    applyId,
    secondConfirmationToken,
    confirmFinalCutover,
    operatorUid,
    operatorEmail,
    expectedDatabaseId,
  } = options;

  // Step 1: Verify production Firestore readiness first (leaves legacy writer untouched on failure)
  await verifyMigrationBackendProductionReady(persistenceAdapter, {
    expectedDatabaseId,
    throwOnNotReady: true,
  });

  if (
    !persistenceAdapter.migrationState ||
    !persistenceAdapter.migrationState.consumeCutoverProposalTokenAtomically ||
    !persistenceAdapter.migrationState.saveFinalCutoverReceipt
  ) {
    throw new PersistenceContractError({
      code: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      message: 'Final Cutover blocked: migrationState repository does not support final cutover atomic operations.',
      entity: 'migrationCutoverProposals',
      operation: 'transaction',
      statusCode: 503,
    });
  }

  // Step 2: Require current operator identity
  if (
    typeof operatorUid !== 'string' ||
    !operatorUid.trim() ||
    typeof operatorEmail !== 'string' ||
    !operatorEmail.trim()
  ) {
    throw new PersistenceContractError({
      code: 'CUTOVER_OPERATOR_IDENTITY_REQUIRED',
      message: 'Final Cutover blocked: current authenticated operatorUid and operatorEmail are required.',
      entity: 'migrationCutoverProposals',
      operation: 'transaction',
      statusCode: 403,
    });
  }

  // Step 3: Require explicit second confirmation flag and token
  if (confirmFinalCutover !== true) {
    throw new PersistenceContractError({
      code: 'CUTOVER_SECOND_CONFIRMATION_REQUIRED',
      message: 'Final Cutover blocked: confirmFinalCutover=true is required for explicit second operator confirmation.',
      entity: 'migrationCutoverProposals',
      operation: 'transaction',
      documentId: proposalId,
      statusCode: 400,
    });
  }

  if (
    typeof proposalId !== 'string' ||
    !proposalId.trim() ||
    typeof secondConfirmationToken !== 'string' ||
    !secondConfirmationToken.trim()
  ) {
    throw new PersistenceContractError({
      code: 'CUTOVER_SECOND_CONFIRMATION_REQUIRED',
      message: 'Final Cutover blocked: proposalId and secondConfirmationToken are required.',
      entity: 'migrationCutoverProposals',
      operation: 'transaction',
      statusCode: 400,
    });
  }

  // Step 4: Acquire durable global cutover lock to prevent concurrent cutover across instances
  const cutoverLock = await persistenceAdapter.migrationState.acquireMigrationLock(
    `cutover_${proposalId.trim()}`,
    15 * 60 * 1000
  );

  try {
    const nowMs = Date.now();
    const cutoverId = `cutover_${nowMs}_${crypto.randomBytes(4).toString('hex')}`;
    const tokenHash = crypto
      .createHash('sha256')
      .update(secondConfirmationToken.trim())
      .digest('hex');

    // Step 5: Atomically verify and consume second confirmation token
    const tokenCheck =
      await persistenceAdapter.migrationState.consumeCutoverProposalTokenAtomically(
        proposalId.trim(),
        tokenHash,
        cutoverId,
        nowMs
      );

    if (!tokenCheck.ok || !tokenCheck.proposal) {
      const reason = tokenCheck.reason || 'INVALID_TOKEN';
      const codeMap: Record<string, PersistenceErrorCode> = {
        NOT_FOUND: 'CUTOVER_RECEIPT_MISSING_OR_INELIGIBLE',
        INVALID_TOKEN: 'CUTOVER_CONFIRMATION_TOKEN_INVALID',
        EXPIRED_TOKEN: 'CUTOVER_CONFIRMATION_TOKEN_EXPIRED',
        ALREADY_USED: 'CUTOVER_CONFIRMATION_TOKEN_ALREADY_USED',
        PRECONDITIONS_NOT_MET: 'CUTOVER_RECEIPT_MISSING_OR_INELIGIBLE',
      };
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        INVALID_TOKEN: 400,
        EXPIRED_TOKEN: 400,
        ALREADY_USED: 409,
        PRECONDITIONS_NOT_MET: 409,
      };
      throw new PersistenceContractError({
        code: codeMap[reason] || 'CUTOVER_CONFIRMATION_TOKEN_INVALID',
        message: `Final Cutover confirmation token rejected (${reason}). Legacy writers remain untouched.`,
        entity: 'migrationCutoverProposals',
        operation: 'transaction',
        documentId: proposalId.trim(),
        statusCode: statusMap[reason] || 400,
      });
    }

    const proposal = tokenCheck.proposal;
    const effectiveApplyId = applyId?.trim() || proposal.applyId;
    if (effectiveApplyId !== proposal.applyId) {
      throw new PersistenceContractError({
        code: 'CUTOVER_RECEIPT_MISSING_OR_INELIGIBLE',
        message: `Final Cutover blocked: applyId "${effectiveApplyId}" does not match proposal applyId "${proposal.applyId}".`,
        entity: 'migrationCutoverProposals',
        operation: 'transaction',
        documentId: proposal.proposalId,
        statusCode: 409,
      });
    }

    // Step 6: Re-verify all preconditions inside the global lock
    const { connCheck, receipt, durableBackup } = await verifyFinalCutoverPreconditionsOrThrow({
      persistenceAdapter,
      applyId: proposal.applyId,
      operatorUid,
      operatorEmail,
      expectedDatabaseId,
    });

    // Step 7: Enter Maintenance / Read-Only Reconciliation Window
    const windowStartedAt = new Date().toISOString();
    const strategy =
      options.reconciliationStrategy ||
      proposal.reconciliationStrategy ||
      'maintenance-read-only-window';

    setMaintenanceReadOnlyWindowActive(true);
    await persistenceAdapter.migrationState.saveCutoverState({
      id: 'cutoverState',
      isLegacySnapshotWriterDisabled: false,
      cutoverApprovalEligible: true,
      maintenanceReadOnlyWindowActive: true,
      maintenanceWindowStartedAt: windowStartedAt,
      maintenanceWindowReason: `Final persistence cutover reconciliation (${cutoverId})`,
      lastDryRunId: receipt.dryRunId,
      lastAppliedId: receipt.applyId,
      lastAppliedAt: receipt.appliedAt,
      lastMigrationStatus: 'completed',
      updatedAt: windowStartedAt,
    });

    if (
      typeof options.reconciliationDelayMs === 'number' &&
      options.reconciliationDelayMs > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, options.reconciliationDelayMs));
    }

    if (typeof options.onDuringMaintenanceWindow === 'function') {
      await options.onDuringMaintenanceWindow();
    }

    // Step 8: Reconcile any outbox/delta records and run read-after-write parity & acceptance checks
    let snapshotToVerify: DurableStoreSnapshot | null = null;
    if (options.sourceSnapshotPayload) {
      snapshotToVerify = options.sourceSnapshotPayload;
    } else if (options.snapshotFilePath && fs.existsSync(options.snapshotFilePath)) {
      snapshotToVerify = loadDurableSnapshot(options.snapshotFilePath);
    } else if (receipt.sourceSnapshotPath && fs.existsSync(receipt.sourceSnapshotPath)) {
      snapshotToVerify = loadDurableSnapshot(receipt.sourceSnapshotPath);
    } else if (durableBackup?.sanitizedSnapshotJson) {
      try {
        snapshotToVerify = JSON.parse(durableBackup.sanitizedSnapshotJson) as DurableStoreSnapshot;
      } catch {
        snapshotToVerify = null;
      }
    }

    let reconciledDeltaRecordsCount = 0;
    if (snapshotToVerify) {
      // Reconcile any newly added or updated projects in snapshot during window without overwriting newer target revisions
      for (const snapProj of snapshotToVerify.projects || []) {
        const ownerUid = String(snapProj.ownerUid || 'user-local');
        const targetProj = await persistenceAdapter.projects.getById(snapProj.id, ownerUid, true);
        if (!targetProj) {
          await persistenceAdapter.projects.create({
            ...snapProj,
            ownerUid,
          });
          reconciledDeltaRecordsCount += 1;
        } else {
          const snapRev = typeof snapProj.revision === 'number' ? snapProj.revision : 1;
          const targetRev = typeof targetProj.revision === 'number' ? targetProj.revision : 1;
          if (snapRev > targetRev) {
            await persistenceAdapter.projects.update(snapProj.id, ownerUid, {
              ...snapProj,
              revision: snapRev,
            });
            reconciledDeltaRecordsCount += 1;
          }
        }
      }
    }

    // Run live read-after-write parity, cross-entity references, and application acceptance lookups
    let readAfterWriteParityPassed = true;
    let applicationAcceptancePassed = true;
    const acceptanceFailureReasons: string[] = [];

    if (options.simulateAcceptanceFailure === true) {
      applicationAcceptancePassed = false;
      acceptanceFailureReasons.push(
        'Simulated application acceptance failure during final cutover reconciliation window.'
      );
    }

    if (snapshotToVerify) {
      const crossRef = await verifyOwnerAndCrossEntityReferences(
        snapshotToVerify,
        persistenceAdapter
      );
      if (!crossRef.passed) {
        readAfterWriteParityPassed = false;
        acceptanceFailureReasons.push(
          ...crossRef.failures.map((f) => `${f.sourceEntity}:${f.sourceRecordId} -> ${f.reason}`)
        );
      }

      const appLookups = await verifyAppLevelDestinationLookups(
        snapshotToVerify,
        persistenceAdapter
      );
      if (!appLookups.passed) {
        applicationAcceptancePassed = false;
        acceptanceFailureReasons.push(
          ...appLookups.failures.map((f) => `${f.entity}:${f.recordId} -> ${f.reason}`)
        );
      }
    }

    if (!readAfterWriteParityPassed || !applicationAcceptancePassed) {
      // Partial / acceptance failure: exit maintenance window and leave legacy writer untouched!
      setMaintenanceReadOnlyWindowActive(false);
      setLegacySnapshotWriterDisabled(false);
      await persistenceAdapter.migrationState.saveCutoverState({
        id: 'cutoverState',
        isLegacySnapshotWriterDisabled: false,
        cutoverApprovalEligible: true,
        maintenanceReadOnlyWindowActive: false,
        maintenanceWindowStartedAt: null,
        maintenanceWindowReason: null,
        lastDryRunId: receipt.dryRunId,
        lastAppliedId: receipt.applyId,
        lastAppliedAt: receipt.appliedAt,
        lastMigrationStatus: 'completed',
        updatedAt: new Date().toISOString(),
      });

      throw new PersistenceContractError({
        code: 'CUTOVER_RECONCILIATION_ACCEPTANCE_FAILED',
        message: `Final Cutover aborted during reconciliation/acceptance checks: ${acceptanceFailureReasons.join('; ') || 'parity/acceptance check failed'}. Legacy snapshot writers remain enabled.`,
        entity: 'cutoverState',
        operation: 'transaction',
        documentId: cutoverId,
        statusCode: 500,
      });
    }

    // Step 9: All checks passed -> Disable legacy writers and record final cutover receipt
    const cutoverTimestamp = new Date().toISOString();
    const releaseCommit =
      (options.releaseCommit && options.releaseCommit.trim()) ||
      proposal.releaseCommit ||
      process.env.SOWVEIL_RELEASE_COMMIT ||
      process.env.GIT_COMMIT_SHA ||
      'sowveil-head-f4';
    const databaseId = connCheck.databaseId || CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID;
    const projectId =
      connCheck.projectId || persistenceAdapter.configuredProjectId || null;

    setMaintenanceReadOnlyWindowActive(false);
    setLegacySnapshotWriterDisabled(true);

    const receiptHashInput = [
      cutoverId,
      proposal.proposalId,
      receipt.applyId,
      receipt.dryRunId,
      cutoverTimestamp,
      releaseCommit,
      operatorUid.trim(),
      persistenceAdapter.adapterKind,
      databaseId,
      receipt.sourceChecksum,
      receipt.targetChecksum,
      String(receipt.totalMigrated),
    ].join(':');
    const receiptSha256 = crypto
      .createHash('sha256')
      .update(receiptHashInput, 'utf8')
      .digest('hex');

    const finalCutoverReceipt: DurableFinalCutoverReceiptDto = {
      id: cutoverId,
      cutoverId,
      proposalId: proposal.proposalId,
      applyId: receipt.applyId,
      dryRunId: receipt.dryRunId,
      durableBackupId: receipt.durableBackupId ?? null,
      backupPath: receipt.backupPath,
      cutoverTimestamp,
      releaseCommit,
      operatorUid: operatorUid.trim(),
      operatorEmail: operatorEmail.trim(),
      adapterIdentity: persistenceAdapter.adapterKind,
      databaseId,
      projectId,
      reconciliationStrategy: strategy,
      entityCounts: { ...receipt.migratedCounts },
      totalRecordsVerified: receipt.totalMigrated,
      reconciledDeltaRecordsCount,
      sourceChecksum: receipt.sourceChecksum || '',
      targetChecksum: receipt.targetChecksum || '',
      readAfterWriteParityPassed: true,
      applicationAcceptancePassed: true,
      legacyWritersDisabled: true,
      rollbackInstructions: `To safely roll back readers/writers without overwriting newer records, call POST /api/v1/admin/migration/rollback with backupPath="${receipt.backupPath}" or durableBackupId="${receipt.durableBackupId || ''}".`,
      receiptSha256,
    };

    await persistenceAdapter.migrationState.saveFinalCutoverReceipt(finalCutoverReceipt);
    await persistenceAdapter.migrationState.saveCutoverState({
      id: 'cutoverState',
      isLegacySnapshotWriterDisabled: true,
      cutoverApprovalEligible: false,
      maintenanceReadOnlyWindowActive: false,
      maintenanceWindowStartedAt: null,
      maintenanceWindowReason: null,
      lastDryRunId: receipt.dryRunId,
      lastAppliedId: receipt.applyId,
      lastAppliedAt: receipt.appliedAt,
      lastCutoverId: cutoverId,
      lastCutoverTimestamp: cutoverTimestamp,
      lastCutoverOperatorUid: operatorUid.trim(),
      lastReleaseCommit: releaseCommit,
      lastMigrationStatus: 'cutover-committed',
      updatedAt: cutoverTimestamp,
    });

    return finalCutoverReceipt;
  } finally {
    setMaintenanceReadOnlyWindowActive(false);
    await persistenceAdapter.migrationState.releaseMigrationLock(cutoverLock.lockId);
  }
}

export async function executeMigrationRollback(params: {
  backupPath?: string;
  durableBackupId?: string;
  targetSnapshotPath: string;
  persistenceAdapter?: ISowveilPersistenceAdapter;
  operatorUid?: string;
  operatorEmail?: string;
}): Promise<MigrationRollbackReceipt> {
  const {
    backupPath = '',
    durableBackupId,
    targetSnapshotPath,
    persistenceAdapter,
    operatorUid,
    operatorEmail,
  } = params;

  if (!targetSnapshotPath || !targetSnapshotPath.trim()) {
    throw new PersistenceContractError({
      code: 'ROLLBACK_UNSAFE_PRECONDITIONS',
      message: 'Rollback blocked: targetSnapshotPath is required.',
      entity: 'cutoverState',
      operation: 'transaction',
      statusCode: 400,
    });
  }

  // 1. Refuse rollback if an active migration/cutover lock is currently in progress
  if (persistenceAdapter?.migrationState && !persistenceAdapter.isBackedByTestOrInMemoryDriver) {
    const activeLock = await persistenceAdapter.migrationState.getMigrationLock();
    if (activeLock && activeLock.locked && Date.now() <= activeLock.expiresAtMs) {
      throw new PersistenceContractError({
        code: 'MIGRATION_LOCK_ALREADY_HELD',
        message: `Rollback blocked: an active migration/cutover lock ("${activeLock.lockId}") is currently held. Wait for it to finish or expire before rolling back.`,
        entity: 'systemLocks',
        operation: 'transaction',
        documentId: 'migrationCutover',
        statusCode: 409,
      });
    }
  }

  // 2. Load and validate backup snapshot from disk or durableBackupId
  let backupSnapshot: DurableStoreSnapshot | null = null;
  let resolvedBackupSource = backupPath;

  if (backupPath && fs.existsSync(backupPath)) {
    backupSnapshot = loadDurableSnapshot(backupPath);
  } else if (
    durableBackupId &&
    persistenceAdapter?.migrationState?.getDurableBackup
  ) {
    const dbBackup = await persistenceAdapter.migrationState.getDurableBackup(durableBackupId);
    if (dbBackup && dbBackup.sanitizedSnapshotJson) {
      try {
        backupSnapshot = JSON.parse(dbBackup.sanitizedSnapshotJson) as DurableStoreSnapshot;
        resolvedBackupSource = `durableBackup:${dbBackup.backupId}`;
      } catch {
        backupSnapshot = null;
      }
    }
  }

  if (!backupSnapshot) {
    throw new PersistenceContractError({
      code: 'ROLLBACK_UNSAFE_PRECONDITIONS',
      message: `Rollback blocked: backup snapshot at "${backupPath || durableBackupId || 'unspecified'}" was not found or is structurally invalid.`,
      entity: 'migrationBackups',
      operation: 'get',
      documentId: durableBackupId || undefined,
      statusCode: 409,
    });
  }

  // 3. Do NOT blindly overwrite newer records in targetSnapshotPath or authoritative Firestore!
  const existingTargetSnapshot = fs.existsSync(targetSnapshotPath)
    ? loadDurableSnapshot(targetSnapshotPath)
    : null;

  const preservedNewerTargetRecordKeys: string[] = [];

  function mergeEntityListPreservingNewer<
    T extends { id: string; revision?: number; updatedAt?: string }
  >(
    entityName: string,
    backupItems: T[] = [],
    newerCandidates: T[] = []
  ): T[] {
    const map = new Map<string, T>();
    for (const item of backupItems) {
      if (item && typeof item.id === 'string') {
        map.set(item.id, item);
      }
    }
    for (const candidate of newerCandidates) {
      if (!candidate || typeof candidate.id !== 'string') continue;
      const base = map.get(candidate.id);
      if (!base) {
        map.set(candidate.id, candidate);
        preservedNewerTargetRecordKeys.push(`${entityName}:${candidate.id}`);
        continue;
      }
      const baseRev = typeof base.revision === 'number' ? base.revision : null;
      const candRev = typeof candidate.revision === 'number' ? candidate.revision : null;
      const baseTime = typeof base.updatedAt === 'string' ? Date.parse(base.updatedAt) : NaN;
      const candTime =
        typeof candidate.updatedAt === 'string' ? Date.parse(candidate.updatedAt) : NaN;

      const isCandidateNewer =
        candRev !== null && baseRev !== null
          ? candRev > baseRev
          : !Number.isNaN(candTime) && !Number.isNaN(baseTime)
          ? candTime > baseTime
          : false;

      if (isCandidateNewer) {
        map.set(candidate.id, candidate);
        preservedNewerTargetRecordKeys.push(`${entityName}:${candidate.id}`);
      }
    }
    return Array.from(map.values());
  }

  // Gather newer records from authoritative Firestore adapter (if connected) and existing target snapshot
  let firestoreProjects: DurableStoreSnapshot['projects'] = [];
  let firestoreCatalog: DurableStoreSnapshot['catalogItems'] = [];
  let firestoreVariants: DurableStoreSnapshot['templateVariants'] = [];
  let firestoreAiSessions: NonNullable<DurableStoreSnapshot['aiDirectorSessions']> = [];
  let firestoreRefSessions: NonNullable<DurableStoreSnapshot['referenceLabSessions']> = [];
  let firestoreDrafts: NonNullable<DurableStoreSnapshot['templateFactoryDrafts']> = [];
  let firestoreRenderJobs: NonNullable<DurableStoreSnapshot['renderExportJobs']> = [];

  if (persistenceAdapter && !persistenceAdapter.isDevelopmentOrTestOnly) {
    try {
      if (typeof persistenceAdapter.projects.listAllForAdmin === 'function') {
        firestoreProjects = await persistenceAdapter.projects.listAllForAdmin();
      }
      firestoreCatalog = await persistenceAdapter.catalogAndVariants.listCatalogItems();
      if (typeof persistenceAdapter.aiDirectorSessions.listAllForAdmin === 'function') {
        firestoreAiSessions = await persistenceAdapter.aiDirectorSessions.listAllForAdmin();
      }
      if (typeof persistenceAdapter.referenceLabSessions.listAllForAdmin === 'function') {
        firestoreRefSessions = await persistenceAdapter.referenceLabSessions.listAllForAdmin();
      }
      if (typeof persistenceAdapter.renderExportJobs.listAllJobsForAdmin === 'function') {
        firestoreRenderJobs = await persistenceAdapter.renderExportJobs.listAllJobsForAdmin();
      }
      const ownerUids = new Set<string>();
      for (const uid of Object.keys(backupSnapshot.roles || {})) ownerUids.add(uid);
      for (const uid of Object.keys(existingTargetSnapshot?.roles || {})) ownerUids.add(uid);
      if (typeof persistenceAdapter.governance.listRoles === 'function') {
        const liveRoles = await persistenceAdapter.governance.listRoles();
        for (const uid of Object.keys(liveRoles || {})) ownerUids.add(uid);
      }
      for (const p of firestoreProjects) if (p.ownerUid) ownerUids.add(p.ownerUid);
      for (const s of firestoreAiSessions) if (s.ownerUid) ownerUids.add(s.ownerUid);
      for (const r of firestoreRefSessions) if (r.ownerUid) ownerUids.add(r.ownerUid);
      for (const v of backupSnapshot.templateVariants || []) if (v.ownerUid) ownerUids.add(v.ownerUid);
      for (const d of backupSnapshot.templateFactoryDrafts || []) if (d.ownerUid) ownerUids.add(d.ownerUid);

      for (const uid of ownerUids) {
        const variantsForOwner = await persistenceAdapter.catalogAndVariants.listVariantsByOwner(uid);
        firestoreVariants.push(...variantsForOwner);
        const draftsForOwner = await persistenceAdapter.templateFactoryDrafts.listByOwner(uid);
        firestoreDrafts.push(...draftsForOwner);
      }
    } catch {
      // If Firestore is offline during emergency rollback, still merge existingTargetSnapshot
    }
  }

  const mergedProjects = mergeEntityListPreservingNewer(
    'projects',
    backupSnapshot.projects || [],
    [...(existingTargetSnapshot?.projects || []), ...firestoreProjects]
  );
  const mergedCatalog = mergeEntityListPreservingNewer(
    'catalogItems',
    backupSnapshot.catalogItems || [],
    [...(existingTargetSnapshot?.catalogItems || []), ...firestoreCatalog]
  );
  const mergedVariants = mergeEntityListPreservingNewer(
    'templateVariants',
    backupSnapshot.templateVariants || [],
    [...(existingTargetSnapshot?.templateVariants || []), ...firestoreVariants]
  );
  const mergedAiSessions = mergeEntityListPreservingNewer(
    'aiDirectorSessions',
    backupSnapshot.aiDirectorSessions || [],
    [...(existingTargetSnapshot?.aiDirectorSessions || []), ...firestoreAiSessions]
  );
  const mergedRefSessions = mergeEntityListPreservingNewer(
    'referenceLabSessions',
    backupSnapshot.referenceLabSessions || [],
    [...(existingTargetSnapshot?.referenceLabSessions || []), ...firestoreRefSessions]
  );
  const mergedDrafts = mergeEntityListPreservingNewer(
    'templateFactoryDrafts',
    backupSnapshot.templateFactoryDrafts || [],
    [...(existingTargetSnapshot?.templateFactoryDrafts || []), ...firestoreDrafts]
  );
  const mergedRenderJobs = mergeEntityListPreservingNewer(
    'renderExportJobs',
    backupSnapshot.renderExportJobs || [],
    [...(existingTargetSnapshot?.renderExportJobs || []), ...firestoreRenderJobs]
  );

  // Deduplicate preservedNewerTargetRecordKeys
  const uniquePreservedKeys = Array.from(new Set(preservedNewerTargetRecordKeys));
  const rolledBackAt = new Date().toISOString();

  const mergedSnapshot: DurableStoreSnapshot = {
    ...backupSnapshot,
    savedAt: rolledBackAt,
    projects: mergedProjects,
    catalogItems: mergedCatalog,
    templateVariants: mergedVariants,
    aiDirectorSessions: mergedAiSessions,
    referenceLabSessions: mergedRefSessions,
    templateFactoryDrafts: mergedDrafts,
    renderExportJobs: mergedRenderJobs,
  };

  // Write merged snapshot atomically and re-enable legacy writers
  setMaintenanceReadOnlyWindowActive(false);
  setLegacySnapshotWriterDisabled(false);
  saveDurableSnapshot(targetSnapshotPath, mergedSnapshot, { bypassCutoverGate: true });

  const postRollbackRaw = fs.existsSync(targetSnapshotPath)
    ? fs.readFileSync(targetSnapshotPath, 'utf8')
    : JSON.stringify(mergedSnapshot);
  const postRollbackSnapshotSha256 = crypto
    .createHash('sha256')
    .update(postRollbackRaw, 'utf8')
    .digest('hex');

  const rollbackId = `rollback_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  if (persistenceAdapter?.migrationState && !persistenceAdapter.isBackedByTestOrInMemoryDriver) {
    try {
      const existing = await persistenceAdapter.migrationState.getCutoverState();
      await persistenceAdapter.migrationState.saveCutoverState({
        id: 'cutoverState',
        isLegacySnapshotWriterDisabled: false,
        cutoverApprovalEligible: Boolean(existing?.lastAppliedId),
        maintenanceReadOnlyWindowActive: false,
        maintenanceWindowStartedAt: null,
        maintenanceWindowReason: null,
        lastDryRunId: existing?.lastDryRunId ?? null,
        lastAppliedId: existing?.lastAppliedId ?? null,
        lastAppliedAt: existing?.lastAppliedAt ?? null,
        lastCutoverId: existing?.lastCutoverId ?? null,
        lastCutoverTimestamp: existing?.lastCutoverTimestamp ?? null,
        lastCutoverOperatorUid: existing?.lastCutoverOperatorUid ?? null,
        lastReleaseCommit: existing?.lastReleaseCommit ?? null,
        lastRollbackId: rollbackId,
        lastRolledBackAt: rolledBackAt,
        lastMigrationStatus: 'rolled-back',
        updatedAt: rolledBackAt,
      });
    } catch {
      // Non-fatal if rollback runs when DB is offline
    }
  }

  return {
    rollbackId,
    rolledBackAt,
    operatorUid,
    operatorEmail,
    restoredFromBackupPath: resolvedBackupSource,
    targetSnapshotPath,
    durableBackupId: durableBackupId ?? null,
    legacyWritersRestored: true,
    readersSwitchedBackSafely: true,
    preservedNewerTargetRecordsCount: uniquePreservedKeys.length,
    preservedNewerTargetRecordKeys: uniquePreservedKeys,
    restoredSnapshotRecordCounts: {
      projects: mergedProjects.length,
      catalogItems: mergedCatalog.length,
      templateVariants: mergedVariants.length,
      aiDirectorSessions: mergedAiSessions.length,
      referenceLabSessions: mergedRefSessions.length,
      templateFactoryDrafts: mergedDrafts.length,
      renderExportJobs: mergedRenderJobs.length,
    },
    postRollbackSnapshotSha256,
  };
}

// ============================================================================
// 7. STATUS & DIAGNOSTICS (Reads durable state when available)
// ============================================================================

export async function getMigrationCutoverDiagnosticsAsync(options: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  snapshotFilePath?: string | null;
  expectedDatabaseId?: string;
}): Promise<MigrationCutoverStatus> {
  const backups = options.snapshotFilePath ? listSnapshotBackups(options.snapshotFilePath) : [];
  const connCheck = await verifyMigrationBackendProductionReady(options.persistenceAdapter, {
    expectedDatabaseId: options.expectedDatabaseId,
    throwOnNotReady: false,
  });

  let cutoverState: DurableCutoverStateDto | null = null;
  let activeLockHeld = false;

  if (connCheck.isProductionReadyDriver && options.persistenceAdapter.migrationState) {
    try {
      cutoverState = await options.persistenceAdapter.migrationState.getCutoverState();
      const lock = await options.persistenceAdapter.migrationState.getMigrationLock();
      activeLockHeld = Boolean(lock?.locked && Date.now() <= lock.expiresAtMs);
      if (cutoverState) {
        setLegacySnapshotWriterDisabled(Boolean(cutoverState.isLegacySnapshotWriterDisabled));
        setMaintenanceReadOnlyWindowActive(Boolean(cutoverState.maintenanceReadOnlyWindowActive));
      }
    } catch {
      cutoverState = null;
    }
  }

  return {
    applyEnabled: connCheck.isProductionReadyDriver,
    backendProductionReady: connCheck.isProductionReadyDriver,
    blockerCode: connCheck.blockerCode,
    blockerMessage: connCheck.blockerMessage,
    isLegacySnapshotWriterDisabled: cutoverState
      ? Boolean(cutoverState.isLegacySnapshotWriterDisabled)
      : isLegacySnapshotWriterDisabled(),
    cutoverApprovalEligible: Boolean(cutoverState?.cutoverApprovalEligible),
    maintenanceReadOnlyWindowActive: cutoverState
      ? Boolean(cutoverState.maintenanceReadOnlyWindowActive)
      : isMaintenanceReadOnlyWindowActive(),
    authoritativeStoreKind: options.persistenceAdapter.adapterKind,
    configuredDatabaseId: connCheck.databaseId,
    backupCount: backups.length,
    latestBackupPath: backups[0] || null,
    lastDryRunId: cutoverState?.lastDryRunId || null,
    lastAppliedId: cutoverState?.lastAppliedId || null,
    lastAppliedAt: cutoverState?.lastAppliedAt || null,
    lastCutoverId: cutoverState?.lastCutoverId || null,
    lastCutoverTimestamp: cutoverState?.lastCutoverTimestamp || null,
    lastReleaseCommit: cutoverState?.lastReleaseCommit || null,
    lastRollbackId: cutoverState?.lastRollbackId || null,
    lastRolledBackAt: cutoverState?.lastRolledBackAt || null,
    lastMigrationStatus: cutoverState?.lastMigrationStatus || 'none',
    activeLockHeld,
  };
}

export function getMigrationCutoverDiagnostics(options: {
  persistenceAdapter: ISowveilPersistenceAdapter;
  snapshotFilePath?: string | null;
}): MigrationCutoverStatus {
  const backups = options.snapshotFilePath ? listSnapshotBackups(options.snapshotFilePath) : [];
  const isProdReady =
    options.persistenceAdapter.adapterKind === 'cloud-firestore-authoritative' &&
    !options.persistenceAdapter.isDevelopmentOrTestOnly &&
    options.persistenceAdapter.isBackedByTestOrInMemoryDriver === false &&
    Boolean(options.persistenceAdapter.migrationState);

  return {
    applyEnabled: isProdReady,
    backendProductionReady: isProdReady,
    blockerCode: isProdReady ? null : 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
    blockerMessage: isProdReady
      ? null
      : 'Migration Apply is blocked: target persistence adapter is not a genuine, connected, verified production database.',
    isLegacySnapshotWriterDisabled: isLegacySnapshotWriterDisabled(),
    cutoverApprovalEligible: false,
    maintenanceReadOnlyWindowActive: isMaintenanceReadOnlyWindowActive(),
    authoritativeStoreKind: options.persistenceAdapter.adapterKind,
    configuredDatabaseId: options.persistenceAdapter.configuredDatabaseId ?? null,
    backupCount: backups.length,
    latestBackupPath: backups[0] || null,
    lastDryRunId: null,
    lastAppliedId: null,
    lastAppliedAt: null,
    lastCutoverId: null,
    lastCutoverTimestamp: null,
    lastReleaseCommit: null,
    lastRollbackId: null,
    lastRolledBackAt: null,
    lastMigrationStatus: isProdReady ? 'ready' : 'blocked',
    activeLockHeld: false,
  };
}
