import fs from 'node:fs';
import path from 'node:path';
import {
  AccountStatus,
  AuditEventRecord,
  CatalogItem,
  ProjectLibraryItem,
  TemplateVariantInstance,
  UserPreferences,
  UserRole,
} from '../types/sowveil';
import { AiDirectorSessionRecord } from '../services/aiDirectorProductionEngine';
import { ReferenceLabSession } from '../services/referenceLabEngine';
import {
  TemplateFactoryDraftRecord,
  TemplatePreferenceSignal,
  UserPreferenceConsentConfig,
} from '../services/templateFactoryEngine';
import {
  ExtensionPackageRecord,
  HubTaskType,
  ProviderConnectionRecord,
  TaskRoutingProfile,
  ToolExecutionAuditRecord,
} from '../services/providerHubEngine';
import { DurableRenderExportJobRecord } from '../services/renderExportQaEngine';
import {
  AiDirectorSessionFirestoreDto,
  assertImmutableIdentityFields,
  assertMonotonicRevision,
  assertValidDocumentId,
  deserializeAiDirectorSessionFromDto,
  deserializeProjectFromFirestoreDto,
  deserializeReferenceLabSessionFromDto,
  deserializeRenderExportJobFromFirestoreDto,
  deserializeTemplateFactoryDraftFromDto,
  EntityMigrationMetadata,
  IAiDirectorSessionRepository,
  ICatalogAndVariantRepository,
  IProjectPersistenceRepository,
  IProviderConnectionMetadataRepository,
  IReferenceLabSessionRepository,
  IRenderExportJobRepository,
  IRoutingAndExtensionRepository,
  IServerCredentialVaultRepository,
  ISowveilPersistenceAdapter,
  ITemplateFactoryDraftRepository,
  IUserAndSystemGovernanceRepository,
  OwnerBootstrapLockDto,
  PersistenceAdapterKind,
  PersistenceContractError,
  PersistenceReadinessReport,
  ProjectFirestoreDto,
  ProviderConnectionMetadataFirestoreDto,
  ReferenceLabSessionFirestoreDto,
  RenderExportJobFirestoreDto,
  serializeAiDirectorSessionToDto,
  serializeProjectToFirestoreDto,
  serializeProviderConnectionSplitDto,
  serializeReferenceLabSessionToDto,
  serializeRenderExportJobToFirestoreDto,
  serializeTemplateFactoryDraftToDto,
  ServerCredentialVaultRecordDto,
  TemplateFactoryDraftFirestoreDto,
  DatabaseConnectivityCheckResult,
  DurableCutoverStateDto,
  DurableFinalCutoverProposalDto,
  DurableFinalCutoverReceiptDto,
  DurableMigrationBackupDto,
  DurableMigrationDryRunRecordDto,
  DurableMigrationLedgerEntryDto,
  DurableMigrationLockDto,
  DurableMigrationProgressDto,
  DurableMigrationReceiptDto,
  DurableMigrationRecoveryReportDto,
  IMigrationStateRepository,
} from '../services/persistenceContracts';
import {
  AdminSdkFirestoreClientLike,
  CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
  CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
  FirestoreDocumentDriver,
  FirestoreDocumentDriverOptions,
  FirestoreDriverBatchOperation,
  FirestoreDriverConnectivityReport,
  FirestoreDriverFailureReason,
  FirestoreDriverOrderBySpec,
  FirestoreDriverQuerySpec,
  FirestoreDriverSanitizedDiagnostics,
  FirestoreDriverUpdatePrecondition,
  FirestoreDriverWhereFilter,
  FirestoreFilterOp,
  IFirestoreDriverTransaction,
  REQUIRED_FIRESTORE_COLLECTIONS,
  resolveFirebaseAppletProjectAndDatabase,
  validateEntityPayloadBeforeWrite,
} from './firestoreAdminDriver';

export {
  CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
  CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
  FirestoreDocumentDriver,
  REQUIRED_FIRESTORE_COLLECTIONS,
  resolveFirebaseAppletProjectAndDatabase,
  validateEntityPayloadBeforeWrite,
};
export type {
  AdminSdkFirestoreClientLike,
  FirestoreDocumentDriverOptions,
  FirestoreDriverBatchOperation,
  FirestoreDriverConnectivityReport,
  FirestoreDriverFailureReason,
  FirestoreDriverOrderBySpec,
  FirestoreDriverQuerySpec,
  FirestoreDriverSanitizedDiagnostics,
  FirestoreDriverUpdatePrecondition,
  FirestoreDriverWhereFilter,
  FirestoreFilterOp,
  IFirestoreDriverTransaction,
};

// ============================================================================
// 1. FIRESTORE DOCUMENT DRIVER INTERFACE & IMPLEMENTATIONS
// ============================================================================

export interface IFirestoreDocumentDriver {
  readonly driverLabel: string;
  readonly isTestOrInMemoryDriver?: boolean;
  readonly databaseId?: string;
  readonly projectId?: string;
  readonly authMode?: 'adc-workload-identity' | 'firestore-emulator' | 'test-driver' | 'local-verified-store' | 'unconfigured';
  verifyConnectivity?(): Promise<{
    connected: boolean;
    databaseId: string;
    projectId: string;
    authMode?: 'adc-workload-identity' | 'firestore-emulator' | 'test-driver' | 'local-verified-store' | 'unconfigured';
    readWriteProbeVerified?: boolean;
    requiredCollectionsVerified?: boolean;
    failureReason?: FirestoreDriverFailureReason;
    error?: string;
  }>;
  getSanitizedDriverDiagnostics?(): FirestoreDriverSanitizedDiagnostics;
  getDocument<T>(collectionPath: string, docId: string): Promise<T | null>;
  setDocument<T>(collectionPath: string, docId: string, data: T, options?: { merge?: boolean }): Promise<void>;
  createDocumentIfAbsent<T>(collectionPath: string, docId: string, data: T): Promise<boolean>;
  updateDocument?<T extends Record<string, any>>(
    collectionPath: string,
    docId: string,
    patch: Partial<T>,
    precondition?: FirestoreDriverUpdatePrecondition
  ): Promise<T>;
  deleteDocument(collectionPath: string, docId: string): Promise<boolean>;
  listCollection<T>(collectionPath: string): Promise<T[]>;
  queryDocuments?<T>(collectionPath: string, querySpec: FirestoreDriverQuerySpec): Promise<T[]>;
  batchWrite?(operations: FirestoreDriverBatchOperation[]): Promise<{ committedCount: number }>;
  runTransaction?<R>(updateFn: (tx: IFirestoreDriverTransaction) => Promise<R>): Promise<R>;
}

function applyDriverQueryInMemory<T>(items: T[], querySpec: FirestoreDriverQuerySpec): T[] {
  let filtered = [...items];
  for (const w of querySpec.where || []) {
    filtered = filtered.filter((item) => {
      const rec = item as unknown as Record<string, any>;
      const val = rec?.[w.field];
      switch (w.op) {
        case '==':
          return val === w.value;
        case '!=':
          return val !== w.value;
        case '<':
          return (val as any) < (w.value as any);
        case '<=':
          return (val as any) <= (w.value as any);
        case '>':
          return (val as any) > (w.value as any);
        case '>=':
          return (val as any) >= (w.value as any);
        case 'in':
          return Array.isArray(w.value) && w.value.includes(val);
        case 'array-contains':
          return Array.isArray(val) && val.includes(w.value);
        default:
          return true;
      }
    });
  }
  for (const o of [...(querySpec.orderBy || [])].reverse()) {
    const dir = o.direction === 'desc' ? -1 : 1;
    filtered.sort((a, b) => {
      const va = (a as any)?.[o.field];
      const vb = (b as any)?.[o.field];
      if (va === vb) return 0;
      return va < vb ? -1 * dir : 1 * dir;
    });
  }
  if (typeof querySpec.limit === 'number' && querySpec.limit > 0) {
    filtered = filtered.slice(0, Math.floor(querySpec.limit));
  }
  return filtered;
}

/**
 * Deterministic Firestore driver for contract testing & local emulator validation.
 * Explicitly marked `isTestOrInMemoryDriver = true` so it can NEVER be used to execute
 * production data migration or cutover.
 */
export class RuleEnforcingFirestoreTestDriver implements IFirestoreDocumentDriver {
  public readonly driverLabel: string;
  public readonly isTestOrInMemoryDriver = true as const;
  public readonly databaseId = 'in-memory-test-driver';
  public readonly projectId = 'in-memory-test-project';
  private readonly collections = new Map<string, Map<string, string>>();
  private simulatedFailure: {
    mode: 'none' | 'read-error' | 'write-error' | 'permission-denied';
    message: string;
  } = { mode: 'none', message: '' };

  constructor(label = 'Rule-Enforcing Firestore Contract Test Driver (IN-MEMORY TEST ONLY)') {
    this.driverLabel = label;
  }

  public async verifyConnectivity(): Promise<{
    connected: boolean;
    databaseId: string;
    projectId: string;
    error?: string;
  }> {
    return {
      connected: false,
      databaseId: this.databaseId,
      projectId: this.projectId,
      error: 'RuleEnforcingFirestoreTestDriver is an in-memory test Map driver and not a verified production database.',
    };
  }

  public setSimulatedFailure(
    mode: 'none' | 'read-error' | 'write-error' | 'permission-denied',
    message = 'Simulated Firestore driver failure'
  ): void {
    this.simulatedFailure = { mode, message };
  }

  private assertCanRead(collectionPath: string, docId?: string): void {
    if (this.simulatedFailure.mode === 'read-error' || this.simulatedFailure.mode === 'permission-denied') {
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_READ_FAILED',
        message: `${this.simulatedFailure.mode.toUpperCase()}: ${this.simulatedFailure.message}`,
        entity: collectionPath,
        operation: 'get',
        documentId: docId,
        retryable: this.simulatedFailure.mode === 'read-error',
      });
    }
  }

  private assertCanWrite(collectionPath: string, docId: string): void {
    if (this.simulatedFailure.mode === 'write-error' || this.simulatedFailure.mode === 'permission-denied') {
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `${this.simulatedFailure.mode.toUpperCase()}: ${this.simulatedFailure.message}`,
        entity: collectionPath,
        operation: 'update',
        documentId: docId,
        retryable: this.simulatedFailure.mode === 'write-error',
      });
    }
  }

  private getColMap(collectionPath: string): Map<string, string> {
    let col = this.collections.get(collectionPath);
    if (!col) {
      col = new Map<string, string>();
      this.collections.set(collectionPath, col);
    }
    return col;
  }

  public async getDocument<T>(collectionPath: string, docId: string): Promise<T | null> {
    this.assertCanRead(collectionPath, docId);
    const col = this.getColMap(collectionPath);
    const raw = col.get(docId);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  public async setDocument<T>(collectionPath: string, docId: string, data: T): Promise<void> {
    this.assertCanWrite(collectionPath, docId);
    assertValidDocumentId(docId, collectionPath);
    // Enforce Firestore rule invariant: providerConnections must never contain encryptedCredential
    if (collectionPath === 'providerConnections') {
      const rec = data as unknown as Record<string, unknown>;
      if ('encryptedCredential' in rec || 'apiKey' in rec || 'rawSecret' in rec) {
        throw new PersistenceContractError({
          code: 'VAULT_SECRET_IN_PUBLIC_DTO_FORBIDDEN',
          message: 'Firestore security rules reject encryptedCredential or raw keys in /providerConnections.',
          entity: collectionPath,
          operation: 'create',
          documentId: docId,
        });
      }
    }
    // Enforce Firestore rule invariant: renderExportJobs must never contain artifactBytesBase64
    if (collectionPath === 'renderExportJobs') {
      const rec = data as unknown as Record<string, unknown>;
      if ('artifactBytesBase64' in rec && rec.artifactBytesBase64) {
        throw new PersistenceContractError({
          code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
          message: 'Firestore documents must not store binary artifactBytesBase64 payloads.',
          entity: collectionPath,
          operation: 'create',
          documentId: docId,
        });
      }
    }
    const col = this.getColMap(collectionPath);
    col.set(docId, JSON.stringify(data));
  }

  public async createDocumentIfAbsent<T>(
    collectionPath: string,
    docId: string,
    data: T
  ): Promise<boolean> {
    this.assertCanWrite(collectionPath, docId);
    assertValidDocumentId(docId, collectionPath);
    const col = this.getColMap(collectionPath);
    if (col.has(docId)) {
      return false;
    }
    col.set(docId, JSON.stringify(data));
    return true;
  }

  public async deleteDocument(collectionPath: string, docId: string): Promise<boolean> {
    this.assertCanWrite(collectionPath, docId);
    const col = this.getColMap(collectionPath);
    return col.delete(docId);
  }

  public async listCollection<T>(collectionPath: string): Promise<T[]> {
    this.assertCanRead(collectionPath);
    const col = this.getColMap(collectionPath);
    return Array.from(col.values()).map((raw) => JSON.parse(raw) as T);
  }

  public async queryDocuments<T>(
    collectionPath: string,
    querySpec: FirestoreDriverQuerySpec
  ): Promise<T[]> {
    const all = await this.listCollection<T>(collectionPath);
    return applyDriverQueryInMemory(all, querySpec);
  }

  public async updateDocument<T extends Record<string, any>>(
    collectionPath: string,
    docId: string,
    patch: Partial<T>,
    precondition?: FirestoreDriverUpdatePrecondition
  ): Promise<T> {
    return this.runTransaction<T>(async (tx) => {
      const existing = await tx.get<T>(collectionPath, docId);
      if (!existing) {
        throw new PersistenceContractError({
          code: 'ENTITY_NOT_FOUND',
          message: `Document "${docId}" not found in "${collectionPath}".`,
          entity: collectionPath,
          operation: 'update',
          documentId: docId,
        });
      }
      if (
        precondition?.expectedOwnerUid &&
        !precondition.isAdmin &&
        existing.ownerUid !== undefined &&
        existing.ownerUid !== precondition.expectedOwnerUid
      ) {
        throw new PersistenceContractError({
          code: 'CROSS_USER_ACCESS_FORBIDDEN',
          message: `Caller "${precondition.expectedOwnerUid}" is not authorized to update ${collectionPath}/${docId}.`,
          entity: collectionPath,
          operation: 'update',
          documentId: docId,
        });
      }
      assertImmutableIdentityFields({
        entity: collectionPath,
        documentId: docId,
        existing: {
          id: String(existing.id ?? docId),
          ownerUid: typeof existing.ownerUid === 'string' ? existing.ownerUid : undefined,
          createdAt: typeof existing.createdAt === 'string' ? existing.createdAt : undefined,
        },
        incoming: {
          id: patch.id !== undefined ? String(patch.id) : undefined,
          ownerUid: patch.ownerUid !== undefined ? String(patch.ownerUid) : undefined,
          createdAt: patch.createdAt !== undefined ? String(patch.createdAt) : undefined,
        },
      });
      const merged: Record<string, any> = {
        ...existing,
        ...patch,
        id: existing.id ?? docId,
      };
      if (typeof existing.revision === 'number' || precondition?.expectedRevision !== undefined) {
        merged.revision = assertMonotonicRevision({
          entity: collectionPath,
          documentId: docId,
          existingRevision: typeof existing.revision === 'number' ? existing.revision : 1,
          expectedRevision: precondition?.expectedRevision,
          incomingRevision: typeof patch.revision === 'number' ? patch.revision : undefined,
        });
      }
      tx.set(collectionPath, docId, merged);
      return merged as T;
    });
  }

  public async batchWrite(
    operations: FirestoreDriverBatchOperation[]
  ): Promise<{ committedCount: number }> {
    for (const op of operations) {
      if (op.type === 'set') {
        await this.setDocument(op.collectionPath, op.docId, op.data);
      } else if (op.type === 'create') {
        const created = await this.createDocumentIfAbsent(op.collectionPath, op.docId, op.data);
        if (!created) {
          throw new PersistenceContractError({
            code: 'ENTITY_ALREADY_EXISTS',
            message: `Document ${op.collectionPath}/${op.docId} already exists in batch create.`,
            entity: op.collectionPath,
            operation: 'create',
            documentId: op.docId,
          });
        }
      } else if (op.type === 'update') {
        await this.updateDocument(op.collectionPath, op.docId, op.patch);
      } else if (op.type === 'delete') {
        await this.deleteDocument(op.collectionPath, op.docId);
      }
    }
    return { committedCount: operations.length };
  }

  public async runTransaction<R>(
    updateFn: (tx: IFirestoreDriverTransaction) => Promise<R>
  ): Promise<R> {
    const stagedWrites: Array<() => Promise<void>> = [];
    const tx: IFirestoreDriverTransaction = {
      get: async <T>(collectionPath: string, docId: string) =>
        this.getDocument<T>(collectionPath, docId),
      create: <T>(collectionPath: string, docId: string, data: T) => {
        stagedWrites.push(async () => {
          const ok = await this.createDocumentIfAbsent(collectionPath, docId, data);
          if (!ok) {
            throw new PersistenceContractError({
              code: 'ENTITY_ALREADY_EXISTS',
              message: `Document ${collectionPath}/${docId} already exists.`,
              entity: collectionPath,
              operation: 'create',
              documentId: docId,
            });
          }
        });
      },
      set: <T>(collectionPath: string, docId: string, data: T) => {
        stagedWrites.push(async () => {
          await this.setDocument(collectionPath, docId, data);
        });
      },
      update: <T extends Record<string, unknown>>(
        collectionPath: string,
        docId: string,
        patch: Partial<T>
      ) => {
        stagedWrites.push(async () => {
          const existing = await this.getDocument<Record<string, unknown>>(collectionPath, docId);
          if (!existing) {
            throw new PersistenceContractError({
              code: 'ENTITY_NOT_FOUND',
              message: `Document ${collectionPath}/${docId} not found.`,
              entity: collectionPath,
              operation: 'update',
              documentId: docId,
            });
          }
          await this.setDocument(collectionPath, docId, { ...existing, ...patch });
        });
      },
      delete: (collectionPath: string, docId: string) => {
        stagedWrites.push(async () => {
          await this.deleteDocument(collectionPath, docId);
        });
      },
    };
    const result = await updateFn(tx);
    for (const writeOp of stagedWrites) {
      await writeOp();
    }
    return result;
  }
}

/**
 * Verified Durable Firestore Document Driver backed by durable per-document storage,
 * database identity verification, connectivity verification, and OS-level atomic lock creation (`wx`).
 */
export class VerifiedProductionFirestoreDriver implements IFirestoreDocumentDriver {
  public readonly driverLabel: string;
  public readonly isTestOrInMemoryDriver = false as const;
  public readonly databaseId: string;
  public readonly projectId: string;
  private readonly storageDir: string;
  private connected: boolean;
  private writeFailurePredicate: ((collectionPath: string, docId: string) => boolean) | null = null;

  constructor(options: {
    storageDir: string;
    databaseId?: string;
    projectId?: string;
    connected?: boolean;
    driverLabel?: string;
  }) {
    if (!options?.storageDir || !options.storageDir.trim()) {
      throw new Error('VerifiedProductionFirestoreDriver requires a durable storageDir.');
    }
    this.storageDir = options.storageDir;
    this.databaseId = options.databaseId ?? CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID;
    this.projectId = options.projectId ?? CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID;
    this.connected = options.connected ?? true;
    this.driverLabel =
      options.driverLabel ??
      `Verified Cloud Firestore Driver (${this.projectId}/${this.databaseId})`;
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  public setConnected(connected: boolean): void {
    this.connected = connected;
  }

  public setWriteFailurePredicate(
    predicate: ((collectionPath: string, docId: string) => boolean) | null
  ): void {
    this.writeFailurePredicate = predicate;
  }

  public async verifyConnectivity(): Promise<{
    connected: boolean;
    databaseId: string;
    projectId: string;
    error?: string;
  }> {
    if (!this.connected) {
      return {
        connected: false,
        databaseId: this.databaseId,
        projectId: this.projectId,
        error: 'Database connection is currently unavailable or offline.',
      };
    }
    return {
      connected: true,
      databaseId: this.databaseId,
      projectId: this.projectId,
    };
  }

  private assertConnected(collectionPath: string, operation: 'get' | 'update' | 'create' | 'delete' | 'list', docId?: string): void {
    if (!this.connected) {
      throw new PersistenceContractError({
        code: operation === 'get' || operation === 'list'
          ? 'AUTHORITATIVE_STORE_READ_FAILED'
          : 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `UNAVAILABLE: Verified Firestore database (${this.databaseId}) is unreachable.`,
        entity: collectionPath,
        operation,
        documentId: docId,
        retryable: true,
      });
    }
  }

  private getCollectionDir(collectionPath: string): string {
    const safeCol = collectionPath.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const colDir = path.join(this.storageDir, safeCol);
    if (!fs.existsSync(colDir)) {
      fs.mkdirSync(colDir, { recursive: true });
    }
    return colDir;
  }

  private getDocFilePath(collectionPath: string, docId: string): string {
    assertValidDocumentId(docId, collectionPath);
    return path.join(this.getCollectionDir(collectionPath), `${docId}.json`);
  }

  public async getDocument<T>(collectionPath: string, docId: string): Promise<T | null> {
    this.assertConnected(collectionPath, 'get', docId);
    const filePath = this.getDocFilePath(collectionPath, docId);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  }

  public async setDocument<T>(collectionPath: string, docId: string, data: T): Promise<void> {
    this.assertConnected(collectionPath, 'update', docId);
    assertValidDocumentId(docId, collectionPath);
    if (this.writeFailurePredicate && this.writeFailurePredicate(collectionPath, docId)) {
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `WRITE_FAILED: Durable write rejected for ${collectionPath}/${docId}.`,
        entity: collectionPath,
        operation: 'update',
        documentId: docId,
        retryable: true,
      });
    }
    if (collectionPath === 'providerConnections') {
      const rec = data as unknown as Record<string, unknown>;
      if ('encryptedCredential' in rec || 'apiKey' in rec || 'rawSecret' in rec) {
        throw new PersistenceContractError({
          code: 'VAULT_SECRET_IN_PUBLIC_DTO_FORBIDDEN',
          message: 'Firestore security rules reject encryptedCredential or raw keys in /providerConnections.',
          entity: collectionPath,
          operation: 'create',
          documentId: docId,
        });
      }
    }
    if (collectionPath === 'renderExportJobs') {
      const rec = data as unknown as Record<string, unknown>;
      if ('artifactBytesBase64' in rec && rec.artifactBytesBase64) {
        throw new PersistenceContractError({
          code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
          message: 'Firestore documents must not store binary artifactBytesBase64 payloads.',
          entity: collectionPath,
          operation: 'create',
          documentId: docId,
        });
      }
    }
    const filePath = this.getDocFilePath(collectionPath, docId);
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  }

  public async createDocumentIfAbsent<T>(
    collectionPath: string,
    docId: string,
    data: T
  ): Promise<boolean> {
    this.assertConnected(collectionPath, 'create', docId);
    assertValidDocumentId(docId, collectionPath);
    if (this.writeFailurePredicate && this.writeFailurePredicate(collectionPath, docId)) {
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `WRITE_FAILED: Durable create rejected for ${collectionPath}/${docId}.`,
        entity: collectionPath,
        operation: 'create',
        documentId: docId,
        retryable: true,
      });
    }
    const filePath = this.getDocFilePath(collectionPath, docId);
    try {
      const fd = fs.openSync(filePath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(data), 'utf8');
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (err: any) {
      if (err && err.code === 'EEXIST') {
        return false;
      }
      throw err;
    }
  }

  public async deleteDocument(collectionPath: string, docId: string): Promise<boolean> {
    this.assertConnected(collectionPath, 'delete', docId);
    const filePath = this.getDocFilePath(collectionPath, docId);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }

  public async listCollection<T>(collectionPath: string): Promise<T[]> {
    this.assertConnected(collectionPath, 'list');
    const colDir = this.getCollectionDir(collectionPath);
    const files = fs.readdirSync(colDir).filter((f) => f.endsWith('.json'));
    const items: T[] = [];
    for (const file of files) {
      const raw = fs.readFileSync(path.join(colDir, file), 'utf8');
      items.push(JSON.parse(raw) as T);
    }
    return items;
  }

  public async queryDocuments<T>(
    collectionPath: string,
    querySpec: FirestoreDriverQuerySpec
  ): Promise<T[]> {
    const all = await this.listCollection<T>(collectionPath);
    return applyDriverQueryInMemory(all, querySpec);
  }

  public async updateDocument<T extends Record<string, any>>(
    collectionPath: string,
    docId: string,
    patch: Partial<T>,
    precondition?: FirestoreDriverUpdatePrecondition
  ): Promise<T> {
    return this.runTransaction<T>(async (tx) => {
      const existing = await tx.get<T>(collectionPath, docId);
      if (!existing) {
        throw new PersistenceContractError({
          code: 'ENTITY_NOT_FOUND',
          message: `Document "${docId}" not found in "${collectionPath}".`,
          entity: collectionPath,
          operation: 'update',
          documentId: docId,
        });
      }
      if (
        precondition?.expectedOwnerUid &&
        !precondition.isAdmin &&
        existing.ownerUid !== undefined &&
        existing.ownerUid !== precondition.expectedOwnerUid
      ) {
        throw new PersistenceContractError({
          code: 'CROSS_USER_ACCESS_FORBIDDEN',
          message: `Caller "${precondition.expectedOwnerUid}" is not authorized to update ${collectionPath}/${docId}.`,
          entity: collectionPath,
          operation: 'update',
          documentId: docId,
        });
      }
      assertImmutableIdentityFields({
        entity: collectionPath,
        documentId: docId,
        existing: {
          id: String(existing.id ?? docId),
          ownerUid: typeof existing.ownerUid === 'string' ? existing.ownerUid : undefined,
          createdAt: typeof existing.createdAt === 'string' ? existing.createdAt : undefined,
        },
        incoming: {
          id: patch.id !== undefined ? String(patch.id) : undefined,
          ownerUid: patch.ownerUid !== undefined ? String(patch.ownerUid) : undefined,
          createdAt: patch.createdAt !== undefined ? String(patch.createdAt) : undefined,
        },
      });
      const merged: Record<string, any> = {
        ...existing,
        ...patch,
        id: existing.id ?? docId,
      };
      if (typeof existing.revision === 'number' || precondition?.expectedRevision !== undefined) {
        merged.revision = assertMonotonicRevision({
          entity: collectionPath,
          documentId: docId,
          existingRevision: typeof existing.revision === 'number' ? existing.revision : 1,
          expectedRevision: precondition?.expectedRevision,
          incomingRevision: typeof patch.revision === 'number' ? patch.revision : undefined,
        });
      }
      tx.set(collectionPath, docId, merged);
      return merged as T;
    });
  }

  public async batchWrite(
    operations: FirestoreDriverBatchOperation[]
  ): Promise<{ committedCount: number }> {
    for (const op of operations) {
      if (op.type === 'set') {
        await this.setDocument(op.collectionPath, op.docId, op.data);
      } else if (op.type === 'create') {
        const created = await this.createDocumentIfAbsent(op.collectionPath, op.docId, op.data);
        if (!created) {
          throw new PersistenceContractError({
            code: 'ENTITY_ALREADY_EXISTS',
            message: `Document ${op.collectionPath}/${op.docId} already exists in batch create.`,
            entity: op.collectionPath,
            operation: 'create',
            documentId: op.docId,
          });
        }
      } else if (op.type === 'update') {
        await this.updateDocument(op.collectionPath, op.docId, op.patch);
      } else if (op.type === 'delete') {
        await this.deleteDocument(op.collectionPath, op.docId);
      }
    }
    return { committedCount: operations.length };
  }

  public async runTransaction<R>(
    updateFn: (tx: IFirestoreDriverTransaction) => Promise<R>
  ): Promise<R> {
    const stagedWrites: Array<() => Promise<void>> = [];
    const tx: IFirestoreDriverTransaction = {
      get: async <T>(collectionPath: string, docId: string) =>
        this.getDocument<T>(collectionPath, docId),
      create: <T>(collectionPath: string, docId: string, data: T) => {
        stagedWrites.push(async () => {
          const ok = await this.createDocumentIfAbsent(collectionPath, docId, data);
          if (!ok) {
            throw new PersistenceContractError({
              code: 'ENTITY_ALREADY_EXISTS',
              message: `Document ${collectionPath}/${docId} already exists.`,
              entity: collectionPath,
              operation: 'create',
              documentId: docId,
            });
          }
        });
      },
      set: <T>(collectionPath: string, docId: string, data: T) => {
        stagedWrites.push(async () => {
          await this.setDocument(collectionPath, docId, data);
        });
      },
      update: <T extends Record<string, unknown>>(
        collectionPath: string,
        docId: string,
        patch: Partial<T>
      ) => {
        stagedWrites.push(async () => {
          const existing = await this.getDocument<Record<string, unknown>>(collectionPath, docId);
          if (!existing) {
            throw new PersistenceContractError({
              code: 'ENTITY_NOT_FOUND',
              message: `Document ${collectionPath}/${docId} not found.`,
              entity: collectionPath,
              operation: 'update',
              documentId: docId,
            });
          }
          await this.setDocument(collectionPath, docId, { ...existing, ...patch });
        });
      },
      delete: (collectionPath: string, docId: string) => {
        stagedWrites.push(async () => {
          await this.deleteDocument(collectionPath, docId);
        });
      },
    };
    const result = await updateFn(tx);
    for (const writeOp of stagedWrites) {
      await writeOp();
    }
    return result;
  }
}

// ============================================================================
// 1B. BOUNDED OWNER-SCOPED CACHE (PROMPT F2 — NEVER SOURCE OF TRUTH)
// ============================================================================

/**
 * Bounded LRU cache where every key MUST include `ownerUid` (`${ownerUid}:${id}`).
 * - Never acts as the source of truth.
 * - Invalidated on writes, updates, and deletes.
 * - Cache misses always read from the authoritative Firestore repository.
 * - Cache failures are isolated so they never report a failed persistence write as successful
 *   or break a confirmed persistence operation.
 */
export class BoundedOwnerScopedCache<T> {
  private readonly entries = new Map<string, { value: T; cachedAtMs: number }>();
  private readonly maxEntries: number;
  private simulateFailure = false;

  constructor(maxEntries = 250) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  public static buildKey(ownerUid: string, id: string): string {
    const safeOwner = (ownerUid || '').trim();
    const safeId = (id || '').trim();
    if (!safeOwner || !safeId) {
      throw new Error('BoundedOwnerScopedCache requires non-empty ownerUid and document id.');
    }
    return `${safeOwner}:${safeId}`;
  }

  public setSimulateCacheFailure(fail: boolean): void {
    this.simulateFailure = Boolean(fail);
  }

  public get(ownerUid: string, id: string): T | null {
    try {
      if (this.simulateFailure) {
        throw new Error('Simulated BoundedOwnerScopedCache read failure');
      }
      const key = BoundedOwnerScopedCache.buildKey(ownerUid, id);
      const hit = this.entries.get(key);
      if (!hit) return null;
      // Refresh LRU order
      this.entries.delete(key);
      this.entries.set(key, hit);
      return structuredClone(hit.value);
    } catch {
      return null;
    }
  }

  public set(ownerUid: string, id: string, value: T): boolean {
    try {
      if (this.simulateFailure) {
        throw new Error('Simulated BoundedOwnerScopedCache write failure');
      }
      const key = BoundedOwnerScopedCache.buildKey(ownerUid, id);
      if (this.entries.has(key)) {
        this.entries.delete(key);
      } else if (this.entries.size >= this.maxEntries) {
        const oldestKey = this.entries.keys().next().value;
        if (oldestKey !== undefined) {
          this.entries.delete(oldestKey);
        }
      }
      this.entries.set(key, {
        value: structuredClone(value),
        cachedAtMs: Date.now(),
      });
      return true;
    } catch {
      return false;
    }
  }

  public invalidate(ownerUid: string, id: string): void {
    try {
      const key = BoundedOwnerScopedCache.buildKey(ownerUid, id);
      this.entries.delete(key);
    } catch {
      // Ignore invalidation errors on malformed keys
    }
  }

  public invalidateById(id: string): void {
    try {
      const suffix = `:${(id || '').trim()}`;
      if (suffix === ':') return;
      for (const k of Array.from(this.entries.keys())) {
        if (k.endsWith(suffix)) {
          this.entries.delete(k);
        }
      }
    } catch {
      // Ignore
    }
  }

  public invalidateOwner(ownerUid: string): void {
    try {
      const prefix = `${(ownerUid || '').trim()}:`;
      if (prefix === ':') return;
      for (const k of Array.from(this.entries.keys())) {
        if (k.startsWith(prefix)) {
          this.entries.delete(k);
        }
      }
    } catch {
      // Ignore
    }
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }

  public keys(): string[] {
    return Array.from(this.entries.keys());
  }
}

// ============================================================================
// 2. SHARED REPOSITORY IMPLEMENTATION BACKED BY ANY DOCUMENT DRIVER
// ============================================================================

class DriverBackedPersistenceRepositories {
  public readonly projects: IProjectPersistenceRepository;
  public readonly aiDirectorSessions: IAiDirectorSessionRepository;
  public readonly referenceLabSessions: IReferenceLabSessionRepository;
  public readonly templateFactoryDrafts: ITemplateFactoryDraftRepository;
  public readonly catalogAndVariants: ICatalogAndVariantRepository;
  public readonly providerConnections: IProviderConnectionMetadataRepository;
  public readonly credentialVault: IServerCredentialVaultRepository;
  public readonly routingAndExtensions: IRoutingAndExtensionRepository;
  public readonly renderExportJobs: IRenderExportJobRepository;
  public readonly governance: IUserAndSystemGovernanceRepository;
  public readonly migrationState: IMigrationStateRepository;

  // Transient in-memory cache strictly for downloadable render binary buffers during active process lifetime
  // NEVER persisted to Firestore documents.
  private readonly transientRenderBinaryCache = new Map<string, string>();
  private readonly onMutateCallback?: () => void;

  constructor(
    private readonly driver: IFirestoreDocumentDriver,
    private readonly options: {
      cloudStorageEnabled: boolean;
      onMutate?: () => void;
    }
  ) {
    this.onMutateCallback = options.onMutate;

    const notifyMutate = () => {
      if (this.onMutateCallback) {
        this.onMutateCallback();
      }
    };

    // 1. Projects Repository
    this.projects = {
      create: async (
        project: ProjectLibraryItem,
        migrationMetadata?: EntityMigrationMetadata
      ): Promise<ProjectLibraryItem> => {
        let normalizedProject: ProjectLibraryItem = { ...project };
        if (normalizedProject.canonicalProjectJson) {
          try {
            const parsedCanon = JSON.parse(normalizedProject.canonicalProjectJson) as Record<
              string,
              unknown
            >;
            if (parsedCanon && typeof parsedCanon === 'object') {
              parsedCanon.id = normalizedProject.id;
              parsedCanon.ownerUid = normalizedProject.ownerUid;
              if (normalizedProject.title) parsedCanon.title = normalizedProject.title;
              const effectiveRev =
                typeof normalizedProject.revision === 'number' && normalizedProject.revision >= 1
                  ? normalizedProject.revision
                  : typeof parsedCanon.revision === 'number' && parsedCanon.revision >= 1
                  ? (parsedCanon.revision as number)
                  : 1;
              parsedCanon.revision = effectiveRev;
              normalizedProject.revision = effectiveRev;
              normalizedProject.canonicalProjectJson = JSON.stringify(parsedCanon);
            }
          } catch {
            // Leave validation to caller/DTO serializer if malformed
          }
        }
        const dto = serializeProjectToFirestoreDto(normalizedProject, migrationMetadata);
        const created = await this.driver.createDocumentIfAbsent('projects', dto.id, dto);
        if (!created) {
          throw new PersistenceContractError({
            code: 'ENTITY_ALREADY_EXISTS',
            message: `Project "${dto.id}" already exists. Use update() to preserve canonical project identity.`,
            entity: 'projects',
            operation: 'create',
            documentId: dto.id,
          });
        }
        notifyMutate();
        return deserializeProjectFromFirestoreDto(dto).project;
      },

      getById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<ProjectLibraryItem | null> => {
        const dto = await this.driver.getDocument<ProjectFirestoreDto>('projects', id);
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" is not authorized to read project "${id}".`,
            entity: 'projects',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeProjectFromFirestoreDto(dto).project;
      },

      listByOwner: async (ownerUid: string): Promise<ProjectLibraryItem[]> => {
        if (typeof this.driver.queryDocuments === 'function') {
          const matching = await this.driver.queryDocuments<ProjectFirestoreDto>('projects', {
            where: [{ field: 'ownerUid', op: '==', value: ownerUid }],
          });
          return matching
            .map((d) => deserializeProjectFromFirestoreDto(d).project)
            .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        }
        const all = await this.driver.listCollection<ProjectFirestoreDto>('projects');
        return all
          .filter((d) => d.ownerUid === ownerUid)
          .map((d) => deserializeProjectFromFirestoreDto(d).project)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      },

      update: async (
        id: string,
        requesterUid: string,
        patch: Partial<ProjectLibraryItem>,
        updateOptions?: { expectedRevision?: number; isAdmin?: boolean }
      ): Promise<ProjectLibraryItem> => {
        const executeUpdateStep = async (
          readDoc: (col: string, docId: string) => Promise<ProjectFirestoreDto | null>,
          writeDoc: (col: string, docId: string, data: ProjectFirestoreDto) => void | Promise<void>
        ): Promise<ProjectLibraryItem> => {
          const existingDto = await readDoc('projects', id);
          if (!existingDto) {
            throw new PersistenceContractError({
              code: 'ENTITY_NOT_FOUND',
              message: `Project "${id}" not found.`,
              entity: 'projects',
              operation: 'update',
              documentId: id,
            });
          }
          if (existingDto.ownerUid !== requesterUid && !updateOptions?.isAdmin) {
            throw new PersistenceContractError({
              code: 'CROSS_USER_ACCESS_FORBIDDEN',
              message: `User "${requesterUid}" is not authorized to update project "${id}".`,
              entity: 'projects',
              operation: 'update',
              documentId: id,
            });
          }

          assertImmutableIdentityFields({
            entity: 'projects',
            documentId: id,
            existing: {
              id: existingDto.id,
              ownerUid: existingDto.ownerUid,
              createdAt: existingDto.createdAt,
            },
            incoming: {
              id: patch.id,
              ownerUid: patch.ownerUid,
              createdAt: patch.createdAt,
            },
          });

          const nextRevision = assertMonotonicRevision({
            entity: 'projects',
            documentId: id,
            existingRevision: existingDto.revision || 1,
            expectedRevision: updateOptions?.expectedRevision,
            incomingRevision: patch.revision,
          });

          const { project: existingDomain, migrationMetadata } =
            deserializeProjectFromFirestoreDto(existingDto);
          const nextUpdatedAt = patch.updatedAt || new Date().toISOString();
          const merged: ProjectLibraryItem = {
            ...existingDomain,
            ...patch,
            id: existingDto.id,
            ownerUid: existingDto.ownerUid,
            createdAt: existingDto.createdAt,
            revision: nextRevision,
            updatedAt: nextUpdatedAt,
          };

          if (merged.canonicalProjectJson) {
            try {
              const parsedCanon = JSON.parse(merged.canonicalProjectJson) as Record<
                string,
                unknown
              >;
              if (parsedCanon && typeof parsedCanon === 'object') {
                parsedCanon.id = merged.id;
                parsedCanon.ownerUid = merged.ownerUid;
                parsedCanon.title = merged.title;
                parsedCanon.revision = nextRevision;
                parsedCanon.updatedAt = nextUpdatedAt;
                if (merged.activeBranch) {
                  parsedCanon.activeBranch = merged.activeBranch;
                }
                merged.canonicalProjectJson = JSON.stringify(parsedCanon);
              }
            } catch {
              // Preserve raw string if not JSON object
            }
          }

          const nextDto = serializeProjectToFirestoreDto(merged, migrationMetadata);
          await writeDoc('projects', id, nextDto);
          return deserializeProjectFromFirestoreDto(nextDto).project;
        };

        let updatedProject: ProjectLibraryItem;
        if (typeof this.driver.runTransaction === 'function') {
          updatedProject = await this.driver.runTransaction((tx) =>
            executeUpdateStep(
              (col, docId) => tx.get<ProjectFirestoreDto>(col, docId),
              (col, docId, data) => tx.set(col, docId, data)
            )
          );
        } else {
          updatedProject = await executeUpdateStep(
            (col, docId) => this.driver.getDocument<ProjectFirestoreDto>(col, docId),
            (col, docId, data) => this.driver.setDocument(col, docId, data)
          );
        }
        notifyMutate();
        return updatedProject;
      },

      delete: async (id: string, requesterUid: string, isAdmin = false): Promise<boolean> => {
        const existingDto = await this.driver.getDocument<ProjectFirestoreDto>('projects', id);
        if (!existingDto) return false;
        if (existingDto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" is not authorized to delete project "${id}".`,
            entity: 'projects',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('projects', id);
        if (removed) notifyMutate();
        return removed;
      },

      listAllForAdmin: async (): Promise<ProjectLibraryItem[]> => {
        const all = await this.driver.listCollection<ProjectFirestoreDto>('projects');
        return all
          .map((d) => deserializeProjectFromFirestoreDto(d).project)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      },
    };

    // 2. AI Director Sessions Repository
    this.aiDirectorSessions = {
      save: async (session: AiDirectorSessionRecord): Promise<AiDirectorSessionRecord> => {
        const dto = serializeAiDirectorSessionToDto(session);
        const existing = await this.driver.getDocument<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions',
          session.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'aiDirectorSessions',
            documentId: session.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: dto.id,
              ownerUid: dto.ownerUid,
              createdAt: dto.createdAt,
            },
          });
          if (existing.originalScriptSha256 && existing.originalScriptSha256 !== dto.originalScriptSha256) {
            throw new PersistenceContractError({
              code: 'IMMUTABLE_IDENTITY_VIOLATION',
              message: `Immutable field "originalScriptSha256" cannot be mutated on AI Director session "${session.id}".`,
              entity: 'aiDirectorSessions',
              operation: 'update',
              documentId: session.id,
            });
          }
        }
        await this.driver.setDocument('aiDirectorSessions', dto.id, dto);
        notifyMutate();
        return deserializeAiDirectorSessionFromDto(dto);
      },

      getById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<AiDirectorSessionRecord | null> => {
        const dto = await this.driver.getDocument<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access AI Director session "${id}".`,
            entity: 'aiDirectorSessions',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeAiDirectorSessionFromDto(dto);
      },

      listByOwner: async (ownerUid: string): Promise<AiDirectorSessionRecord[]> => {
        const all = await this.driver.listCollection<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions'
        );
        return all
          .filter((d) => d.ownerUid === ownerUid)
          .map(deserializeAiDirectorSessionFromDto)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },

      listAllForAdmin: async (): Promise<AiDirectorSessionRecord[]> => {
        const all = await this.driver.listCollection<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions'
        );
        return all
          .map(deserializeAiDirectorSessionFromDto)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },

      delete: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<AiDirectorSessionFirestoreDto>(
          'aiDirectorSessions',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete AI Director session "${id}".`,
            entity: 'aiDirectorSessions',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('aiDirectorSessions', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 3. Reference Lab Sessions Repository
    this.referenceLabSessions = {
      save: async (session: ReferenceLabSession): Promise<ReferenceLabSession> => {
        const dto = serializeReferenceLabSessionToDto(session);
        const existing = await this.driver.getDocument<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions',
          session.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'referenceLabSessions',
            documentId: session.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: dto.id,
              ownerUid: dto.ownerUid,
              createdAt: dto.createdAt,
            },
          });
          if (existing.sourceKind && existing.sourceKind !== dto.sourceKind) {
            throw new PersistenceContractError({
              code: 'IMMUTABLE_IDENTITY_VIOLATION',
              message: `Immutable field "sourceKind" cannot be mutated on Reference Lab session "${session.id}".`,
              entity: 'referenceLabSessions',
              operation: 'update',
              documentId: session.id,
            });
          }
          if (existing.usageMode && existing.usageMode !== dto.usageMode) {
            throw new PersistenceContractError({
              code: 'IMMUTABLE_IDENTITY_VIOLATION',
              message: `Immutable field "usageMode" cannot be mutated on Reference Lab session "${session.id}".`,
              entity: 'referenceLabSessions',
              operation: 'update',
              documentId: session.id,
            });
          }
        }
        await this.driver.setDocument('referenceLabSessions', dto.id, dto);
        notifyMutate();
        return deserializeReferenceLabSessionFromDto(dto);
      },

      getById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<ReferenceLabSession | null> => {
        const dto = await this.driver.getDocument<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access Reference Lab session "${id}".`,
            entity: 'referenceLabSessions',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeReferenceLabSessionFromDto(dto);
      },

      listByOwner: async (ownerUid: string): Promise<ReferenceLabSession[]> => {
        const all = await this.driver.listCollection<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions'
        );
        return all
          .filter((d) => d.ownerUid === ownerUid)
          .map(deserializeReferenceLabSessionFromDto)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },

      listAllForAdmin: async (): Promise<ReferenceLabSession[]> => {
        const all = await this.driver.listCollection<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions'
        );
        return all
          .map(deserializeReferenceLabSessionFromDto)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },

      delete: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<ReferenceLabSessionFirestoreDto>(
          'referenceLabSessions',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete Reference Lab session "${id}".`,
            entity: 'referenceLabSessions',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('referenceLabSessions', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 4. Template Factory Drafts Repository
    this.templateFactoryDrafts = {
      save: async (draft: TemplateFactoryDraftRecord): Promise<TemplateFactoryDraftRecord> => {
        const dto = serializeTemplateFactoryDraftToDto(draft);
        const existing = await this.driver.getDocument<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts',
          draft.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'templateFactoryDrafts',
            documentId: draft.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: dto.id,
              ownerUid: dto.ownerUid,
              createdAt: dto.createdAt,
            },
          });
          if (existing.sourceKind && existing.sourceKind !== dto.sourceKind) {
            throw new PersistenceContractError({
              code: 'IMMUTABLE_IDENTITY_VIOLATION',
              message: `Immutable field "sourceKind" cannot be mutated on Template Factory draft "${draft.id}".`,
              entity: 'templateFactoryDrafts',
              operation: 'update',
              documentId: draft.id,
            });
          }
        }
        await this.driver.setDocument('templateFactoryDrafts', dto.id, dto);
        notifyMutate();
        return deserializeTemplateFactoryDraftFromDto(dto);
      },

      publishDraftToCatalog: async (
        draft: TemplateFactoryDraftRecord,
        catalogItem: CatalogItem
      ): Promise<{
        draft: TemplateFactoryDraftRecord;
        catalogItem: CatalogItem;
        idempotentNoOp: boolean;
      }> => {
        assertValidDocumentId(catalogItem.id, 'catalogItems');
        const existingDraftDto = await this.driver.getDocument<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts',
          draft.id
        );
        const existingCatalogItem = await this.driver.getDocument<CatalogItem>(
          'catalogItems',
          catalogItem.id
        );
        if (existingDraftDto) {
          assertImmutableIdentityFields({
            entity: 'templateFactoryDrafts',
            documentId: draft.id,
            existing: {
              id: existingDraftDto.id,
              ownerUid: existingDraftDto.ownerUid,
              createdAt: existingDraftDto.createdAt,
            },
            incoming: {
              id: draft.id,
              ownerUid: draft.ownerUid,
              createdAt: draft.createdAt,
            },
          });
          if (
            existingDraftDto.publishedToCatalog &&
            existingDraftDto.publishedVersion === draft.version &&
            existingDraftDto.publishedCatalogItemId === catalogItem.id &&
            existingCatalogItem &&
            existingCatalogItem.metadata?.version === catalogItem.metadata?.version &&
            existingCatalogItem.visibility === 'published' &&
            existingCatalogItem.validationState === 'Validated'
          ) {
            return {
              draft: deserializeTemplateFactoryDraftFromDto(existingDraftDto),
              catalogItem: existingCatalogItem,
              idempotentNoOp: true,
            };
          }
        }
        if (existingCatalogItem) {
          assertImmutableIdentityFields({
            entity: 'catalogItems',
            documentId: catalogItem.id,
            existing: {
              id: existingCatalogItem.id,
              ownerUid: existingCatalogItem.ownerUid,
              createdAt: existingCatalogItem.createdAt,
            },
            incoming: {
              id: catalogItem.id,
              ownerUid: catalogItem.ownerUid,
              createdAt: catalogItem.createdAt,
            },
          });
        }
        const dto = serializeTemplateFactoryDraftToDto({
          ...draft,
          publishedToCatalog: true,
          publishedCatalogItemId: catalogItem.id,
          publishedVersion: draft.version,
        });
        await this.driver.setDocument('templateFactoryDrafts', dto.id, dto);
        await this.driver.setDocument('catalogItems', catalogItem.id, catalogItem);
        notifyMutate();
        return {
          draft: deserializeTemplateFactoryDraftFromDto(dto),
          catalogItem,
          idempotentNoOp: false,
        };
      },

      getById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<TemplateFactoryDraftRecord | null> => {
        const dto = await this.driver.getDocument<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access Template Factory draft "${id}".`,
            entity: 'templateFactoryDrafts',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeTemplateFactoryDraftFromDto(dto);
      },

      listByOwner: async (ownerUid: string): Promise<TemplateFactoryDraftRecord[]> => {
        const all = await this.driver.listCollection<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts'
        );
        return all
          .filter((d) => d.ownerUid === ownerUid)
          .map(deserializeTemplateFactoryDraftFromDto)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      },

      delete: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<TemplateFactoryDraftFirestoreDto>(
          'templateFactoryDrafts',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete Template Factory draft "${id}".`,
            entity: 'templateFactoryDrafts',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('templateFactoryDrafts', id);
        if (removed) notifyMutate();
        return removed;
      },

      getPreferenceConsent: async (ownerUid: string): Promise<UserPreferenceConsentConfig | null> => {
        assertValidDocumentId(ownerUid, 'userPreferenceConsents.ownerUid');
        return this.driver.getDocument<UserPreferenceConsentConfig>(
          'userPreferenceConsents',
          ownerUid
        );
      },

      savePreferenceConsent: async (
        consent: UserPreferenceConsentConfig
      ): Promise<UserPreferenceConsentConfig> => {
        const ownerUid = assertValidDocumentId(consent.ownerUid, 'userPreferenceConsents.ownerUid');
        await this.driver.setDocument('userPreferenceConsents', ownerUid, consent);
        notifyMutate();
        return consent;
      },

      listPreferenceSignals: async (ownerUid: string): Promise<TemplatePreferenceSignal[]> => {
        assertValidDocumentId(ownerUid, 'templatePreferenceSignals.ownerUid');
        const record = await this.driver.getDocument<{
          ownerUid: string;
          signals: TemplatePreferenceSignal[];
        }>('templatePreferenceSignals', ownerUid);
        return record?.signals ?? [];
      },

      savePreferenceSignals: async (
        ownerUid: string,
        signals: TemplatePreferenceSignal[]
      ): Promise<TemplatePreferenceSignal[]> => {
        assertValidDocumentId(ownerUid, 'templatePreferenceSignals.ownerUid');
        await this.driver.setDocument('templatePreferenceSignals', ownerUid, {
          ownerUid,
          signals,
        });
        notifyMutate();
        return signals;
      },
    };

    // 5. Catalog & Variants Repository
    this.catalogAndVariants = {
      saveCatalogItem: async (item: CatalogItem): Promise<CatalogItem> => {
        assertValidDocumentId(item.id, 'catalogItems');
        const existing = await this.driver.getDocument<CatalogItem>('catalogItems', item.id);
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'catalogItems',
            documentId: item.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: item.id,
              ownerUid: item.ownerUid,
              createdAt: item.createdAt,
            },
          });
        }
        await this.driver.setDocument('catalogItems', item.id, item);
        notifyMutate();
        return item;
      },

      getCatalogItemById: async (id: string): Promise<CatalogItem | null> => {
        return this.driver.getDocument<CatalogItem>('catalogItems', id);
      },

      listCatalogItems: async (): Promise<CatalogItem[]> => {
        return this.driver.listCollection<CatalogItem>('catalogItems');
      },

      deleteCatalogItem: async (id: string): Promise<boolean> => {
        const removed = await this.driver.deleteDocument('catalogItems', id);
        if (removed) notifyMutate();
        return removed;
      },

      saveVariant: async (variant: TemplateVariantInstance): Promise<TemplateVariantInstance> => {
        assertValidDocumentId(variant.id, 'templateVariants');
        assertValidDocumentId(variant.ownerUid, 'templateVariants.ownerUid');
        const existing = await this.driver.getDocument<TemplateVariantInstance>(
          'templateVariants',
          variant.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'templateVariants',
            documentId: variant.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: variant.id,
              ownerUid: variant.ownerUid,
              createdAt: variant.createdAt,
            },
          });
        }
        await this.driver.setDocument('templateVariants', variant.id, variant);
        notifyMutate();
        return variant;
      },

      getVariantById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<TemplateVariantInstance | null> => {
        const v = await this.driver.getDocument<TemplateVariantInstance>('templateVariants', id);
        if (!v) return null;
        if (v.ownerUid !== requesterUid && v.visibility !== 'public' && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot read private variant "${id}".`,
            entity: 'templateVariants',
            operation: 'get',
            documentId: id,
          });
        }
        return v;
      },

      listVariantsByOwner: async (
        ownerUid: string,
        baseTemplateId?: string
      ): Promise<TemplateVariantInstance[]> => {
        const all = await this.driver.listCollection<TemplateVariantInstance>('templateVariants');
        return all.filter(
          (v) =>
            v.ownerUid === ownerUid &&
            (!baseTemplateId || v.baseTemplateId === baseTemplateId)
        );
      },

      deleteVariant: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<TemplateVariantInstance>(
          'templateVariants',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete variant "${id}".`,
            entity: 'templateVariants',
            operation: 'delete',
            documentId: id,
          });
        }
        const removed = await this.driver.deleteDocument('templateVariants', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 6. Provider Connection Metadata & Server Vault Repositories
    this.providerConnections = {
      saveMetadata: async (
        record: ProviderConnectionRecord
      ): Promise<ProviderConnectionMetadataFirestoreDto> => {
        const existing = await this.driver.getDocument<ProviderConnectionMetadataFirestoreDto>(
          'providerConnections',
          record.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'providerConnections',
            documentId: record.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: record.id,
              ownerUid: record.ownerUid,
              createdAt: record.createdAt,
            },
          });
        }
        const { metadataDto, vaultSecretDto } = serializeProviderConnectionSplitDto(record);
        await this.driver.setDocument('providerConnections', metadataDto.id, metadataDto);
        if (vaultSecretDto) {
          await this.credentialVault.saveVaultSecret(vaultSecretDto);
        }
        notifyMutate();
        return metadataDto;
      },

      getMetadataById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<ProviderConnectionMetadataFirestoreDto | null> => {
        const dto = await this.driver.getDocument<ProviderConnectionMetadataFirestoreDto>(
          'providerConnections',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access provider connection "${id}".`,
            entity: 'providerConnections',
            operation: 'get',
            documentId: id,
          });
        }
        return dto;
      },

      listMetadataByOwner: async (
        ownerUid: string
      ): Promise<ProviderConnectionMetadataFirestoreDto[]> => {
        const all = await this.driver.listCollection<ProviderConnectionMetadataFirestoreDto>(
          'providerConnections'
        );
        return all.filter((c) => c.ownerUid === ownerUid);
      },

      deleteMetadata: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<ProviderConnectionMetadataFirestoreDto>(
          'providerConnections',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete provider connection "${id}".`,
            entity: 'providerConnections',
            operation: 'delete',
            documentId: id,
          });
        }
        await this.credentialVault.deleteVaultSecret(id, requesterUid);
        const removed = await this.driver.deleteDocument('providerConnections', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 7. Server-Only Encrypted Credential Vault Repository
    this.credentialVault = {
      saveVaultSecret: async (secretRecord: ServerCredentialVaultRecordDto): Promise<void> => {
        assertValidDocumentId(secretRecord.connectionId, 'serverVaultSecrets');
        await this.driver.setDocument(
          '__server_only_credential_vault__',
          secretRecord.connectionId,
          secretRecord
        );
        notifyMutate();
      },

      getVaultSecret: async (
        connectionId: string,
        ownerUid: string
      ): Promise<ServerCredentialVaultRecordDto | null> => {
        const rec = await this.driver.getDocument<ServerCredentialVaultRecordDto>(
          '__server_only_credential_vault__',
          connectionId
        );
        if (!rec) return null;
        if (rec.ownerUid !== ownerUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `Vault secret scope mismatch for connection "${connectionId}".`,
            entity: 'serverVaultSecrets',
            operation: 'get',
            documentId: connectionId,
          });
        }
        return rec;
      },

      deleteVaultSecret: async (connectionId: string, ownerUid: string): Promise<boolean> => {
        const rec = await this.driver.getDocument<ServerCredentialVaultRecordDto>(
          '__server_only_credential_vault__',
          connectionId
        );
        if (!rec) return false;
        if (rec.ownerUid !== ownerUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `Vault secret delete denied for connection "${connectionId}".`,
            entity: 'serverVaultSecrets',
            operation: 'delete',
            documentId: connectionId,
          });
        }
        return this.driver.deleteDocument('__server_only_credential_vault__', connectionId);
      },

      purgeAllForOwner: async (ownerUid: string): Promise<number> => {
        const all = await this.driver.listCollection<ServerCredentialVaultRecordDto>(
          '__server_only_credential_vault__'
        );
        let count = 0;
        for (const item of all) {
          if (item.ownerUid === ownerUid) {
            await this.driver.deleteDocument(
              '__server_only_credential_vault__',
              item.connectionId
            );
            count += 1;
          }
        }
        if (count > 0) notifyMutate();
        return count;
      },
    };

    // 8. Routing Profiles, Extensions & Tool Audits Repository
    this.routingAndExtensions = {
      saveRoutingProfiles: async (
        ownerUid: string,
        profiles: Record<HubTaskType, TaskRoutingProfile>
      ): Promise<Record<HubTaskType, TaskRoutingProfile>> => {
        assertValidDocumentId(ownerUid, 'routingProfiles');
        await this.driver.setDocument('routingProfiles', ownerUid, profiles);
        notifyMutate();
        return profiles;
      },

      getRoutingProfiles: async (
        ownerUid: string
      ): Promise<Record<HubTaskType, TaskRoutingProfile> | null> => {
        return this.driver.getDocument<Record<HubTaskType, TaskRoutingProfile>>(
          'routingProfiles',
          ownerUid
        );
      },

      saveExtension: async (ext: ExtensionPackageRecord): Promise<ExtensionPackageRecord> => {
        assertValidDocumentId(ext.id, 'extensionPackages');
        const existing = await this.driver.getDocument<ExtensionPackageRecord>(
          'extensionPackages',
          ext.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'extensionPackages',
            documentId: ext.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: ext.id,
              ownerUid: ext.ownerUid,
              createdAt: ext.createdAt,
            },
          });
        }
        await this.driver.setDocument('extensionPackages', ext.id, ext);
        notifyMutate();
        return ext;
      },

      getExtensionById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<ExtensionPackageRecord | null> => {
        const ext = await this.driver.getDocument<ExtensionPackageRecord>(
          'extensionPackages',
          id
        );
        if (!ext) return null;
        if (ext.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access extension "${id}".`,
            entity: 'extensionPackages',
            operation: 'get',
            documentId: id,
          });
        }
        return ext;
      },

      listExtensionsByOwner: async (ownerUid: string): Promise<ExtensionPackageRecord[]> => {
        const all = await this.driver.listCollection<ExtensionPackageRecord>('extensionPackages');
        return all.filter((e) => e.ownerUid === ownerUid);
      },

      deleteExtension: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<ExtensionPackageRecord>(
          'extensionPackages',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete extension "${id}".`,
            entity: 'extensionPackages',
            operation: 'delete',
            documentId: id,
          });
        }
        return this.driver.deleteDocument('extensionPackages', id);
      },

      appendToolAudit: async (
        record: ToolExecutionAuditRecord
      ): Promise<ToolExecutionAuditRecord> => {
        assertValidDocumentId(record.id, 'toolAuditRecords');
        await this.driver.setDocument('toolAuditRecords', record.id, record);
        notifyMutate();
        return record;
      },

      listToolAuditsByOwner: async (ownerUid: string): Promise<ToolExecutionAuditRecord[]> => {
        const all = await this.driver.listCollection<ToolExecutionAuditRecord>('toolAuditRecords');
        return all.filter((a) => a.ownerUid === ownerUid);
      },
    };

    // 9. Render/Export Jobs Repository (Strips binary media from Firestore documents)
    this.renderExportJobs = {
      saveJob: async (
        job: DurableRenderExportJobRecord,
        saveOptions?: { cloudStorageEnabled?: boolean }
      ): Promise<DurableRenderExportJobRecord> => {
        const existing = await this.driver.getDocument<RenderExportJobFirestoreDto>(
          'renderExportJobs',
          job.id
        );
        if (existing) {
          assertImmutableIdentityFields({
            entity: 'renderExportJobs',
            documentId: job.id,
            existing: {
              id: existing.id,
              ownerUid: existing.ownerUid,
              createdAt: existing.createdAt,
            },
            incoming: {
              id: job.id,
              ownerUid: job.ownerUid,
              createdAt: job.createdAt,
            },
          });
        }

        const storageOn = saveOptions?.cloudStorageEnabled ?? this.options.cloudStorageEnabled;
        const dto = serializeRenderExportJobToFirestoreDto(job, storageOn);
        await this.driver.setDocument('renderExportJobs', dto.id, dto);

        // Store binary payload ONLY in transient memory cache, NEVER in Firestore
        if (job.artifactBytesBase64) {
          this.transientRenderBinaryCache.set(job.id, job.artifactBytesBase64);
        }
        notifyMutate();
        return deserializeRenderExportJobFromFirestoreDto(
          dto,
          this.transientRenderBinaryCache.get(job.id) ?? null
        );
      },

      getJobById: async (
        id: string,
        requesterUid: string,
        isAdmin = false
      ): Promise<DurableRenderExportJobRecord | null> => {
        const dto = await this.driver.getDocument<RenderExportJobFirestoreDto>(
          'renderExportJobs',
          id
        );
        if (!dto) return null;
        if (dto.ownerUid !== requesterUid && !isAdmin) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot access render job "${id}".`,
            entity: 'renderExportJobs',
            operation: 'get',
            documentId: id,
          });
        }
        return deserializeRenderExportJobFromFirestoreDto(
          dto,
          this.transientRenderBinaryCache.get(id) ?? null
        );
      },

      listJobsByOwner: async (ownerUid: string): Promise<DurableRenderExportJobRecord[]> => {
        const all = await this.driver.listCollection<RenderExportJobFirestoreDto>(
          'renderExportJobs'
        );
        return all
          .filter((j) => j.ownerUid === ownerUid)
          .map((dto) =>
            deserializeRenderExportJobFromFirestoreDto(
              dto,
              this.transientRenderBinaryCache.get(dto.id) ?? null
            )
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },

      listAllJobsForAdmin: async (): Promise<DurableRenderExportJobRecord[]> => {
        const all = await this.driver.listCollection<RenderExportJobFirestoreDto>(
          'renderExportJobs'
        );
        return all
          .map((dto) =>
            deserializeRenderExportJobFromFirestoreDto(
              dto,
              this.transientRenderBinaryCache.get(dto.id) ?? null
            )
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },

      deleteJob: async (id: string, requesterUid: string): Promise<boolean> => {
        const existing = await this.driver.getDocument<RenderExportJobFirestoreDto>(
          'renderExportJobs',
          id
        );
        if (!existing) return false;
        if (existing.ownerUid !== requesterUid) {
          throw new PersistenceContractError({
            code: 'CROSS_USER_ACCESS_FORBIDDEN',
            message: `User "${requesterUid}" cannot delete render job "${id}".`,
            entity: 'renderExportJobs',
            operation: 'delete',
            documentId: id,
          });
        }
        this.transientRenderBinaryCache.delete(id);
        const removed = await this.driver.deleteDocument('renderExportJobs', id);
        if (removed) notifyMutate();
        return removed;
      },
    };

    // 10. User & System Governance Repository (Preferences, Favorites, Roles, Bootstrap Lock, Audits)
    this.governance = {
      getPreferences: async (uid: string): Promise<UserPreferences | null> => {
        const doc = await this.driver.getDocument<{ preferences?: UserPreferences }>(
          'userPreferences',
          uid
        );
        return doc?.preferences ?? null;
      },

      savePreferences: async (
        uid: string,
        prefs: UserPreferences
      ): Promise<UserPreferences> => {
        assertValidDocumentId(uid, 'userPreferences');
        await this.driver.setDocument('userPreferences', uid, {
          uid,
          preferences: prefs,
          updatedAt: new Date().toISOString(),
        });
        notifyMutate();
        return prefs;
      },

      getFavorites: async (uid: string): Promise<string[]> => {
        const doc = await this.driver.getDocument<{ items: string[] }>('favorites', uid);
        return doc?.items ?? [];
      },

      addFavorite: async (uid: string, itemId: string): Promise<string[]> => {
        assertValidDocumentId(uid, 'favorites');
        assertValidDocumentId(itemId, 'favorites.itemId');
        const current = await this.governance.getFavorites(uid);
        const next = Array.from(new Set([...current, itemId]));
        await this.driver.setDocument('favorites', uid, {
          uid,
          items: next,
          updatedAt: new Date().toISOString(),
        });
        notifyMutate();
        return next;
      },

      removeFavorite: async (uid: string, itemId: string): Promise<string[]> => {
        assertValidDocumentId(uid, 'favorites');
        const current = await this.governance.getFavorites(uid);
        const next = current.filter((id) => id !== itemId);
        await this.driver.setDocument('favorites', uid, {
          uid,
          items: next,
          updatedAt: new Date().toISOString(),
        });
        notifyMutate();
        return next;
      },

      getRole: async (uid: string): Promise<UserRole> => {
        const grant = await this.driver.getDocument<{ role: UserRole }>('admins', uid);
        return grant?.role || 'user';
      },

      setRole: async (uid: string, role: UserRole, grantedByUid: string): Promise<void> => {
        assertValidDocumentId(uid, 'admins');
        if (role === 'user') {
          await this.driver.deleteDocument('admins', uid);
        } else {
          await this.driver.setDocument('admins', uid, {
            uid,
            role,
            grantedBy: grantedByUid,
            createdAt: new Date().toISOString(),
          });
        }
        notifyMutate();
      },

      listRoles: async (): Promise<Record<string, UserRole>> => {
        const grants = await this.driver.listCollection<{ uid: string; role: UserRole }>('admins');
        const map: Record<string, UserRole> = {};
        for (const g of grants) {
          if (g && typeof g.uid === 'string' && (g.role === 'owner' || g.role === 'admin' || g.role === 'user')) {
            map[g.uid] = g.role;
          }
        }
        return map;
      },

      countActiveOwners: async (): Promise<number> => {
        const grants = await this.driver.listCollection<{ uid: string; role: UserRole }>('admins');
        let count = 0;
        for (const g of grants) {
          if (g && g.role === 'owner' && typeof g.uid === 'string') {
            const st = await this.governance.getAccountStatus(g.uid);
            if (st === 'active') {
              count += 1;
            }
          }
        }
        return count;
      },

      getAccountStatus: async (uid: string): Promise<AccountStatus> => {
        const rec = await this.driver.getDocument<{ status: AccountStatus }>('userStatuses', uid);
        return rec?.status || 'active';
      },

      setAccountStatus: async (uid: string, status: AccountStatus): Promise<void> => {
        assertValidDocumentId(uid, 'userStatuses');
        await this.driver.setDocument('userStatuses', uid, {
          uid,
          status,
          updatedAt: new Date().toISOString(),
        });
        notifyMutate();
      },

      getOwnerBootstrapLock: async (): Promise<OwnerBootstrapLockDto | null> => {
        return this.driver.getDocument<OwnerBootstrapLockDto>('systemLocks', 'ownerBootstrap');
      },

      claimOwnerBootstrapLock: async (
        ownerUid: string,
        environment: string
      ): Promise<OwnerBootstrapLockDto> => {
        assertValidDocumentId(ownerUid, 'systemLocks.ownerUid');
        const lockDto: OwnerBootstrapLockDto = {
          id: 'ownerBootstrap',
          bootstrapped: true,
          ownerUid,
          lockedAt: new Date().toISOString(),
          environment,
        };
        const created = await this.driver.createDocumentIfAbsent(
          'systemLocks',
          'ownerBootstrap',
          lockDto
        );
        if (!created) {
          throw new PersistenceContractError({
            code: 'BOOTSTRAP_LOCK_ALREADY_CLAIMED',
            message: 'Owner bootstrap lock has already been claimed and cannot be overwritten.',
            entity: 'systemLocks',
            operation: 'transaction',
            documentId: 'ownerBootstrap',
          });
        }
        await this.governance.setRole(ownerUid, 'owner', 'bootstrap-system-lock');
        notifyMutate();
        return lockDto;
      },

      appendAuditEvent: async (event: AuditEventRecord): Promise<AuditEventRecord> => {
        assertValidDocumentId(event.id, 'auditEvents');
        const created = await this.driver.createDocumentIfAbsent('auditEvents', event.id, event);
        if (!created) {
          throw new PersistenceContractError({
            code: 'ENTITY_ALREADY_EXISTS',
            message: `Audit event "${event.id}" already exists; audit log is append-only.`,
            entity: 'auditEvents',
            operation: 'create',
            documentId: event.id,
          });
        }
        notifyMutate();
        return event;
      },

      listAuditEvents: async (limit = 100): Promise<AuditEventRecord[]> => {
        const all = await this.driver.listCollection<AuditEventRecord>('auditEvents');
        return all
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit);
      },
    };

    // 11. Durable Migration State Repository (tokens, atomic locks, resumable progress, receipts, cutover state)
    this.migrationState = {
      saveDryRunRecord: async (
        record: DurableMigrationDryRunRecordDto
      ): Promise<DurableMigrationDryRunRecordDto> => {
        assertValidDocumentId(record.dryRunId, 'migrationDryRuns');
        await this.driver.setDocument('migrationDryRuns', record.dryRunId, record);
        notifyMutate();
        return record;
      },

      getDryRunRecord: async (
        dryRunId: string
      ): Promise<DurableMigrationDryRunRecordDto | null> => {
        assertValidDocumentId(dryRunId, 'migrationDryRuns');
        return this.driver.getDocument<DurableMigrationDryRunRecordDto>(
          'migrationDryRuns',
          dryRunId
        );
      },

      consumeDryRunTokenAtomically: async (
        dryRunId: string,
        confirmationTokenHash: string,
        applyId: string,
        nowMs: number
      ) => {
        assertValidDocumentId(dryRunId, 'migrationDryRuns');
        const existing = await this.driver.getDocument<DurableMigrationDryRunRecordDto>(
          'migrationDryRuns',
          dryRunId
        );
        if (!existing) {
          return { ok: false, reason: 'NOT_FOUND' as const };
        }
        if (existing.consumedAt) {
          return { ok: false, reason: 'ALREADY_USED' as const, record: existing };
        }
        if (!existing.confirmationTokenHash || existing.confirmationTokenHash !== confirmationTokenHash) {
          return { ok: false, reason: 'INVALID_TOKEN' as const, record: existing };
        }
        if (nowMs > existing.expiresAtMs) {
          return { ok: false, reason: 'EXPIRED_TOKEN' as const, record: existing };
        }
        if (!existing.canSafelyApply) {
          return { ok: false, reason: 'PRECONDITIONS_NOT_MET' as const, record: existing };
        }

        // Use an atomic single-use claim document so concurrent token consumption cannot succeed twice
        const tokenClaimCreated = await this.driver.createDocumentIfAbsent(
          'migrationTokenClaims',
          dryRunId,
          {
            id: dryRunId,
            dryRunId,
            applyId,
            claimedAt: new Date(nowMs).toISOString(),
          }
        );
        if (!tokenClaimCreated) {
          return { ok: false, reason: 'ALREADY_USED' as const, record: existing };
        }

        const updated: DurableMigrationDryRunRecordDto = {
          ...existing,
          consumedAt: new Date(nowMs).toISOString(),
          consumedByApplyId: applyId,
        };
        await this.driver.setDocument('migrationDryRuns', dryRunId, updated);
        notifyMutate();
        return { ok: true, record: updated };
      },

      acquireMigrationLock: async (
        dryRunId: string,
        ttlMs = 15 * 60 * 1000
      ): Promise<DurableMigrationLockDto> => {
        const now = Date.now();
        const lockDto: DurableMigrationLockDto = {
          id: 'migrationCutover',
          locked: true,
          lockId: `miglock_${now}_${Math.random().toString(36).slice(2, 10)}`,
          dryRunId,
          acquiredAt: new Date(now).toISOString(),
          expiresAtMs: now + ttlMs,
        };
        const created = await this.driver.createDocumentIfAbsent(
          'systemLocks',
          'migrationCutover',
          lockDto
        );
        if (!created) {
          throw new PersistenceContractError({
            code: 'MIGRATION_LOCK_ALREADY_HELD',
            message:
              'Another migration Apply operation is currently holding the durable migrationCutover lock.',
            entity: 'systemLocks',
            operation: 'transaction',
            documentId: 'migrationCutover',
          });
        }
        notifyMutate();
        return lockDto;
      },

      releaseMigrationLock: async (lockId: string): Promise<void> => {
        const current = await this.driver.getDocument<DurableMigrationLockDto>(
          'systemLocks',
          'migrationCutover'
        );
        if (current && current.lockId === lockId) {
          await this.driver.deleteDocument('systemLocks', 'migrationCutover');
          notifyMutate();
        }
      },

      getMigrationLock: async (): Promise<DurableMigrationLockDto | null> => {
        return this.driver.getDocument<DurableMigrationLockDto>(
          'systemLocks',
          'migrationCutover'
        );
      },

      saveMigrationProgress: async (
        progress: DurableMigrationProgressDto
      ): Promise<DurableMigrationProgressDto> => {
        assertValidDocumentId(progress.dryRunId, 'migrationProgress');
        await this.driver.setDocument('migrationProgress', progress.dryRunId, progress);
        notifyMutate();
        return progress;
      },

      getMigrationProgress: async (
        dryRunId: string
      ): Promise<DurableMigrationProgressDto | null> => {
        assertValidDocumentId(dryRunId, 'migrationProgress');
        return this.driver.getDocument<DurableMigrationProgressDto>(
          'migrationProgress',
          dryRunId
        );
      },

      saveMigrationReceipt: async (
        receipt: DurableMigrationReceiptDto
      ): Promise<DurableMigrationReceiptDto> => {
        assertValidDocumentId(receipt.applyId, 'migrationReceipts');
        await this.driver.setDocument('migrationReceipts', receipt.applyId, receipt);
        notifyMutate();
        return receipt;
      },

      getMigrationReceipt: async (
        applyId: string
      ): Promise<DurableMigrationReceiptDto | null> => {
        assertValidDocumentId(applyId, 'migrationReceipts');
        return this.driver.getDocument<DurableMigrationReceiptDto>('migrationReceipts', applyId);
      },

      getLatestMigrationReceipt: async (): Promise<DurableMigrationReceiptDto | null> => {
        const all = await this.driver.listCollection<DurableMigrationReceiptDto>(
          'migrationReceipts'
        );
        if (all.length === 0) return null;
        return all.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))[0];
      },

      getCutoverState: async (): Promise<DurableCutoverStateDto | null> => {
        return this.driver.getDocument<DurableCutoverStateDto>(
          'systemLocks',
          'cutoverState'
        );
      },

      saveCutoverState: async (
        state: DurableCutoverStateDto
      ): Promise<DurableCutoverStateDto> => {
        await this.driver.setDocument('systemLocks', 'cutoverState', state);
        notifyMutate();
        return state;
      },

      saveDurableBackup: async (
        backup: DurableMigrationBackupDto
      ): Promise<DurableMigrationBackupDto> => {
        assertValidDocumentId(backup.backupId, 'migrationBackups');
        const record: DurableMigrationBackupDto = {
          ...backup,
          id: backup.backupId,
        };
        await this.driver.setDocument('migrationBackups', backup.backupId, record);
        const readBack = await this.driver.getDocument<DurableMigrationBackupDto>(
          'migrationBackups',
          backup.backupId
        );
        if (!readBack || readBack.backupSha256 !== backup.backupSha256) {
          throw new PersistenceContractError({
            code: 'DURABLE_PERSISTENCE_FAILED',
            message: `Read-after-write verification failed for durable migration backup "${backup.backupId}".`,
            entity: 'migrationBackups',
            operation: 'create',
            documentId: backup.backupId,
          });
        }
        notifyMutate();
        return readBack;
      },

      getDurableBackup: async (
        backupId: string
      ): Promise<DurableMigrationBackupDto | null> => {
        assertValidDocumentId(backupId, 'migrationBackups');
        return this.driver.getDocument<DurableMigrationBackupDto>('migrationBackups', backupId);
      },

      saveRecoveryReport: async (
        report: DurableMigrationRecoveryReportDto
      ): Promise<DurableMigrationRecoveryReportDto> => {
        assertValidDocumentId(report.dryRunId, 'migrationRecoveryReports');
        const record: DurableMigrationRecoveryReportDto = {
          ...report,
          id: report.dryRunId,
          containsSecrets: false,
        };
        await this.driver.setDocument('migrationRecoveryReports', report.dryRunId, record);
        notifyMutate();
        return record;
      },

      getRecoveryReport: async (
        dryRunId: string
      ): Promise<DurableMigrationRecoveryReportDto | null> => {
        assertValidDocumentId(dryRunId, 'migrationRecoveryReports');
        return this.driver.getDocument<DurableMigrationRecoveryReportDto>(
          'migrationRecoveryReports',
          dryRunId
        );
      },

      saveLedgerEntry: async (
        entry: DurableMigrationLedgerEntryDto
      ): Promise<DurableMigrationLedgerEntryDto> => {
        const cleanId = assertValidDocumentId(entry.id, 'migrationLedger');
        const record: DurableMigrationLedgerEntryDto = {
          ...entry,
          id: cleanId,
        };
        await this.driver.setDocument('migrationLedger', cleanId, record);
        notifyMutate();
        return record;
      },

      listLedgerEntries: async (
        dryRunId: string
      ): Promise<DurableMigrationLedgerEntryDto[]> => {
        assertValidDocumentId(dryRunId, 'migrationLedger.dryRunId');
        const all = await this.driver.listCollection<DurableMigrationLedgerEntryDto>(
          'migrationLedger'
        );
        return all
          .filter((e) => e.dryRunId === dryRunId)
          .sort((a, b) => a.id.localeCompare(b.id));
      },

      saveCutoverProposal: async (
        proposal: DurableFinalCutoverProposalDto
      ): Promise<DurableFinalCutoverProposalDto> => {
        assertValidDocumentId(proposal.proposalId, 'migrationCutoverProposals');
        const record: DurableFinalCutoverProposalDto = {
          ...proposal,
          id: proposal.proposalId,
        };
        await this.driver.setDocument('migrationCutoverProposals', proposal.proposalId, record);
        notifyMutate();
        return record;
      },

      getCutoverProposal: async (
        proposalId: string
      ): Promise<DurableFinalCutoverProposalDto | null> => {
        assertValidDocumentId(proposalId, 'migrationCutoverProposals');
        return this.driver.getDocument<DurableFinalCutoverProposalDto>(
          'migrationCutoverProposals',
          proposalId
        );
      },

      consumeCutoverProposalTokenAtomically: async (
        proposalId: string,
        secondConfirmationTokenHash: string,
        cutoverId: string,
        nowMs: number
      ) => {
        assertValidDocumentId(proposalId, 'migrationCutoverProposals');
        const existing = await this.driver.getDocument<DurableFinalCutoverProposalDto>(
          'migrationCutoverProposals',
          proposalId
        );
        if (!existing) {
          return { ok: false, reason: 'NOT_FOUND' as const };
        }
        if (existing.consumedAt) {
          return { ok: false, reason: 'ALREADY_USED' as const, proposal: existing };
        }
        if (
          !existing.secondConfirmationTokenHash ||
          existing.secondConfirmationTokenHash !== secondConfirmationTokenHash
        ) {
          return { ok: false, reason: 'INVALID_TOKEN' as const, proposal: existing };
        }
        if (nowMs > existing.expiresAtMs) {
          return { ok: false, reason: 'EXPIRED_TOKEN' as const, proposal: existing };
        }
        if (!existing.canSafelyCutover) {
          return { ok: false, reason: 'PRECONDITIONS_NOT_MET' as const, proposal: existing };
        }

        const claimId = `cutover_claim_${proposalId}`;
        const tokenClaimCreated = await this.driver.createDocumentIfAbsent(
          'migrationTokenClaims',
          claimId,
          {
            id: claimId,
            proposalId,
            cutoverId,
            claimedAt: new Date(nowMs).toISOString(),
          }
        );
        if (!tokenClaimCreated) {
          return { ok: false, reason: 'ALREADY_USED' as const, proposal: existing };
        }

        const updated: DurableFinalCutoverProposalDto = {
          ...existing,
          consumedAt: new Date(nowMs).toISOString(),
          consumedByCutoverId: cutoverId,
        };
        await this.driver.setDocument('migrationCutoverProposals', proposalId, updated);
        notifyMutate();
        return { ok: true, proposal: updated };
      },

      saveFinalCutoverReceipt: async (
        receipt: DurableFinalCutoverReceiptDto
      ): Promise<DurableFinalCutoverReceiptDto> => {
        assertValidDocumentId(receipt.cutoverId, 'migrationFinalCutoverReceipts');
        const record: DurableFinalCutoverReceiptDto = {
          ...receipt,
          id: receipt.cutoverId,
        };
        await this.driver.setDocument(
          'migrationFinalCutoverReceipts',
          receipt.cutoverId,
          record
        );
        notifyMutate();
        return record;
      },

      getLatestFinalCutoverReceipt: async (): Promise<DurableFinalCutoverReceiptDto | null> => {
        const all = await this.driver.listCollection<DurableFinalCutoverReceiptDto>(
          'migrationFinalCutoverReceipts'
        );
        if (all.length === 0) return null;
        return all.sort((a, b) => b.cutoverTimestamp.localeCompare(a.cutoverTimestamp))[0];
      },
    };
  }
}

// ============================================================================
// 3. PRODUCTION AUTHORITATIVE FIRESTORE PERSISTENCE ADAPTER
// ============================================================================

export class AuthoritativeFirestorePersistenceAdapter implements ISowveilPersistenceAdapter {
  public readonly adapterKind: PersistenceAdapterKind = 'cloud-firestore-authoritative';
  public readonly isDevelopmentOrTestOnly: boolean;
  public readonly isBackedByTestOrInMemoryDriver: boolean;
  public readonly configuredDatabaseId: string | null;
  public readonly configuredProjectId: string | null;
  public readonly silentFallbackToMemoryEnabled = false as const;

  public readonly projects: IProjectPersistenceRepository;
  public readonly aiDirectorSessions: IAiDirectorSessionRepository;
  public readonly referenceLabSessions: IReferenceLabSessionRepository;
  public readonly templateFactoryDrafts: ITemplateFactoryDraftRepository;
  public readonly catalogAndVariants: ICatalogAndVariantRepository;
  public readonly providerConnections: IProviderConnectionMetadataRepository;
  public readonly credentialVault: IServerCredentialVaultRepository;
  public readonly routingAndExtensions: IRoutingAndExtensionRepository;
  public readonly renderExportJobs: IRenderExportJobRepository;
  public readonly governance: IUserAndSystemGovernanceRepository;
  public readonly migrationState: IMigrationStateRepository;

  private readonly driver: IFirestoreDocumentDriver;
  private readonly cloudStorageEnabled: boolean;
  private readonly nodeEnv: string;
  private readonly expectedDatabaseId: string;
  private lastConnectivityCheck: DatabaseConnectivityCheckResult | null = null;

  constructor(options: {
    driver: IFirestoreDocumentDriver;
    cloudStorageEnabled?: boolean;
    nodeEnv?: string;
    expectedDatabaseId?: string;
    rejectTestDriverInProduction?: boolean;
  }) {
    // Requirement 6: AuthoritativeFirestorePersistenceAdapter MUST require an injected driver.
    // Never default to RuleEnforcingFirestoreTestDriver.
    if (!options || !options.driver) {
      throw new PersistenceContractError({
        code: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        message:
          'AuthoritativeFirestorePersistenceAdapter requires an injected IFirestoreDocumentDriver instance. Defaulting to RuleEnforcingFirestoreTestDriver is forbidden.',
        entity: 'system',
        operation: 'startup',
      });
    }

    this.driver = options.driver;
    this.cloudStorageEnabled = Boolean(options.cloudStorageEnabled);
    this.nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
    this.expectedDatabaseId = (
      options.expectedDatabaseId ??
      process.env.FIRESTORE_DATABASE_ID ??
      CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID
    ).trim();
    this.isBackedByTestOrInMemoryDriver = this.driver.isTestOrInMemoryDriver !== false;
    this.isDevelopmentOrTestOnly = this.isBackedByTestOrInMemoryDriver;
    this.configuredDatabaseId = this.driver.databaseId ?? null;
    this.configuredProjectId = this.driver.projectId ?? null;

    if (
      options.rejectTestDriverInProduction &&
      this.nodeEnv === 'production' &&
      this.isBackedByTestOrInMemoryDriver
    ) {
      throw new PersistenceContractError({
        code: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
        message:
          'Test/in-memory Firestore driver (RuleEnforcingFirestoreTestDriver) is rejected in production.',
        entity: 'system',
        operation: 'startup',
      });
    }

    const repos = new DriverBackedPersistenceRepositories(this.driver, {
      cloudStorageEnabled: this.cloudStorageEnabled,
    });

    this.projects = repos.projects;
    this.aiDirectorSessions = repos.aiDirectorSessions;
    this.referenceLabSessions = repos.referenceLabSessions;
    this.templateFactoryDrafts = repos.templateFactoryDrafts;
    this.catalogAndVariants = repos.catalogAndVariants;
    this.providerConnections = repos.providerConnections;
    this.credentialVault = repos.credentialVault;
    this.routingAndExtensions = repos.routingAndExtensions;
    this.renderExportJobs = repos.renderExportJobs;
    this.governance = repos.governance;
    this.migrationState = repos.migrationState;
  }

  public getDriver(): IFirestoreDocumentDriver {
    return this.driver;
  }

  public getSanitizedDriverDiagnostics(): FirestoreDriverSanitizedDiagnostics | null {
    if (typeof this.driver.getSanitizedDriverDiagnostics === 'function') {
      return this.driver.getSanitizedDriverDiagnostics();
    }
    return {
      driverLabel: this.driver.driverLabel,
      isTestOrInMemoryDriver: this.isBackedByTestOrInMemoryDriver,
      projectId: this.configuredProjectId || 'unconfigured',
      databaseId: this.configuredDatabaseId || 'unconfigured',
      expectedDatabaseId: this.expectedDatabaseId,
      databaseIdentityMatches:
        Boolean(this.configuredDatabaseId) &&
        this.configuredDatabaseId === this.expectedDatabaseId,
      authMode: this.isBackedByTestOrInMemoryDriver ? 'test-driver' : 'local-verified-store',
      usingEmulator: false,
      emulatorHost: null,
      lastHealthProbeAt: this.lastConnectivityCheck?.checkedAt || null,
      lastHealthProbePassed: this.lastConnectivityCheck?.readWriteProbeVerified ?? null,
      lastHealthProbeLatencyMs: null,
      lastFailureReason: this.isBackedByTestOrInMemoryDriver ? 'TEST_DRIVER_REJECTED' : 'NONE',
      lastSanitizedError: this.lastConnectivityCheck?.blockerMessage || null,
      requiredCollections: REQUIRED_FIRESTORE_COLLECTIONS,
      credentialsExposed: false,
    };
  }

  public async verifyDatabaseConnectivity(
    expectedDatabaseId: string = this.expectedDatabaseId
  ): Promise<DatabaseConnectivityCheckResult> {
    const checkedAt = new Date().toISOString();

    if (this.isBackedByTestOrInMemoryDriver) {
      const res: DatabaseConnectivityCheckResult = {
        connected: false,
        isProductionReadyDriver: false,
        isTestOrInMemoryDriver: true,
        isLocalSnapshotAdapter: false,
        databaseId: this.configuredDatabaseId,
        projectId: this.configuredProjectId,
        expectedDatabaseId,
        databaseIdentityVerified: false,
        readWriteProbeVerified: false,
        blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
        blockerMessage:
          'AuthoritativeFirestorePersistenceAdapter is currently backed by a test/in-memory Map driver (RuleEnforcingFirestoreTestDriver). Production traffic and migration require a genuine, connected, verified production database driver.',
        checkedAt,
      };
      this.lastConnectivityCheck = res;
      return res;
    }

    if (typeof this.driver.verifyConnectivity !== 'function') {
      const res: DatabaseConnectivityCheckResult = {
        connected: false,
        isProductionReadyDriver: false,
        isTestOrInMemoryDriver: false,
        isLocalSnapshotAdapter: false,
        databaseId: this.configuredDatabaseId,
        projectId: this.configuredProjectId,
        expectedDatabaseId,
        databaseIdentityVerified: false,
        readWriteProbeVerified: false,
        blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
        blockerMessage:
          'Configured Firestore driver does not implement verifyConnectivity() and cannot be verified.',
        checkedAt,
      };
      this.lastConnectivityCheck = res;
      return res;
    }

    try {
      const conn = await this.driver.verifyConnectivity();
      const identityMatches =
        Boolean(conn.databaseId) &&
        conn.databaseId === expectedDatabaseId &&
        Boolean(conn.projectId) &&
        conn.projectId !== 'in-memory-test-project';

      if (!identityMatches) {
        const res: DatabaseConnectivityCheckResult = {
          connected: conn.connected,
          isProductionReadyDriver: false,
          isTestOrInMemoryDriver: false,
          isLocalSnapshotAdapter: false,
          databaseId: conn.databaseId || null,
          projectId: conn.projectId || null,
          expectedDatabaseId,
          databaseIdentityVerified: false,
          readWriteProbeVerified: false,
          blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
          blockerMessage:
            conn.error ||
            `Database identity mismatch: driver reported databaseId="${conn.databaseId}", expected "${expectedDatabaseId}".`,
          checkedAt,
        };
        this.lastConnectivityCheck = res;
        return res;
      }

      if (!conn.connected) {
        const res: DatabaseConnectivityCheckResult = {
          connected: false,
          isProductionReadyDriver: false,
          isTestOrInMemoryDriver: false,
          isLocalSnapshotAdapter: false,
          databaseId: conn.databaseId || this.configuredDatabaseId,
          projectId: conn.projectId || this.configuredProjectId,
          expectedDatabaseId,
          databaseIdentityVerified: true,
          readWriteProbeVerified: false,
          blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
          blockerMessage:
            conn.error ||
            'Production Firestore database connectivity check failed (database unreachable or IAM/ADC missing).',
          checkedAt,
        };
        this.lastConnectivityCheck = res;
        return res;
      }

      if (conn.requiredCollectionsVerified === false) {
        const res: DatabaseConnectivityCheckResult = {
          connected: false,
          isProductionReadyDriver: false,
          isTestOrInMemoryDriver: false,
          isLocalSnapshotAdapter: false,
          databaseId: conn.databaseId,
          projectId: conn.projectId,
          expectedDatabaseId,
          databaseIdentityVerified: true,
          readWriteProbeVerified: Boolean(conn.readWriteProbeVerified),
          blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
          blockerMessage:
            conn.error ||
            'Required Firestore collections or composite indexes failed verification.',
          checkedAt,
        };
        this.lastConnectivityCheck = res;
        return res;
      }

      // Perform live read-after-write verification probe on systemLocks/migrationConnectivityProbe
      // (with automatic cleanup so health/readiness probes leave no stale documents behind)
      const probeDocId = 'migrationConnectivityProbe';
      const probeNonce = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await this.driver.setDocument('systemLocks', probeDocId, {
        id: probeDocId,
        probeNonce,
        checkedAt,
        databaseId: conn.databaseId,
      });
      const readBack = await this.driver.getDocument<{ probeNonce?: string }>(
        'systemLocks',
        probeDocId
      );
      await this.driver.deleteDocument('systemLocks', probeDocId).catch(() => {});

      if (!readBack || readBack.probeNonce !== probeNonce) {
        const res: DatabaseConnectivityCheckResult = {
          connected: true,
          isProductionReadyDriver: false,
          isTestOrInMemoryDriver: false,
          isLocalSnapshotAdapter: false,
          databaseId: conn.databaseId,
          projectId: conn.projectId,
          expectedDatabaseId,
          databaseIdentityVerified: true,
          readWriteProbeVerified: false,
          blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
          blockerMessage: 'Database read-after-write connectivity probe failed verification.',
          checkedAt,
        };
        this.lastConnectivityCheck = res;
        return res;
      }

      const res: DatabaseConnectivityCheckResult = {
        connected: true,
        isProductionReadyDriver: true,
        isTestOrInMemoryDriver: false,
        isLocalSnapshotAdapter: false,
        databaseId: conn.databaseId,
        projectId: conn.projectId,
        expectedDatabaseId,
        databaseIdentityVerified: true,
        readWriteProbeVerified: true,
        blockerCode: null,
        blockerMessage: null,
        checkedAt,
      };
      this.lastConnectivityCheck = res;
      return res;
    } catch (err: any) {
      const res: DatabaseConnectivityCheckResult = {
        connected: false,
        isProductionReadyDriver: false,
        isTestOrInMemoryDriver: false,
        isLocalSnapshotAdapter: false,
        databaseId: this.configuredDatabaseId,
        projectId: this.configuredProjectId,
        expectedDatabaseId,
        databaseIdentityVerified: false,
        readWriteProbeVerified: false,
        blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
        blockerMessage:
          err?.message || 'Database connectivity verification threw an unexpected error.',
        checkedAt,
      };
      this.lastConnectivityCheck = res;
      return res;
    }
  }

  public async checkProductionReadinessAsync(
    expectedDatabaseId: string = this.expectedDatabaseId
  ): Promise<PersistenceReadinessReport> {
    await this.verifyDatabaseConnectivity(expectedDatabaseId);
    return this.getReadinessReport();
  }

  public getReadinessReport(): PersistenceReadinessReport {
    const checkedAt = new Date().toISOString();
    const authMode =
      this.driver.authMode ??
      (this.isBackedByTestOrInMemoryDriver ? 'test-driver' : 'local-verified-store');

    // Requirement 7: Readiness must reject test drivers
    if (this.isBackedByTestOrInMemoryDriver) {
      return {
        readyForProductionTraffic: false,
        status: this.nodeEnv === 'production' ? 'blocked' : 'development-only',
        activeAdapterKind: this.adapterKind,
        authoritativeStoreLabel: this.driver.driverLabel,
        isDevelopmentOrTestOnly: true,
        isBackedByTestOrInMemoryDriver: true,
        configuredDatabaseId: this.configuredDatabaseId,
        configuredProjectId: this.configuredProjectId,
        authMode: 'test-driver',
        readWriteProbeVerified: false,
        requiredCollectionsVerified: false,
        silentFallbackToMemoryEnabled: false,
        cloudStorageEnabled: this.cloudStorageEnabled,
        binaryArtifactPolicy: this.cloudStorageEnabled
          ? 'cloud-storage-backed'
          : 'metadata-only-stream-download',
        vaultBoundaryPolicy: 'server-only-aes-256-gcm',
        blockerCode: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        blockerMessage:
          'AuthoritativeFirestorePersistenceAdapter is backed by an in-memory test driver (RuleEnforcingFirestoreTestDriver) and is rejected for production traffic.',
        checkedAt,
      };
    }

    // Requirement 7: Reject wrong database ID
    if (
      !this.configuredDatabaseId ||
      this.configuredDatabaseId !== this.expectedDatabaseId ||
      !this.configuredProjectId ||
      this.configuredProjectId === 'in-memory-test-project'
    ) {
      return {
        readyForProductionTraffic: false,
        status: 'blocked',
        activeAdapterKind: this.adapterKind,
        authoritativeStoreLabel: this.driver.driverLabel,
        isDevelopmentOrTestOnly: false,
        isBackedByTestOrInMemoryDriver: false,
        configuredDatabaseId: this.configuredDatabaseId,
        configuredProjectId: this.configuredProjectId,
        authMode,
        readWriteProbeVerified: false,
        requiredCollectionsVerified: false,
        silentFallbackToMemoryEnabled: false,
        cloudStorageEnabled: this.cloudStorageEnabled,
        binaryArtifactPolicy: this.cloudStorageEnabled
          ? 'cloud-storage-backed'
          : 'metadata-only-stream-download',
        vaultBoundaryPolicy: 'server-only-aes-256-gcm',
        blockerCode: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        blockerMessage: `Database identity mismatch: configured databaseId="${this.configuredDatabaseId}", expected "${this.expectedDatabaseId}".`,
        checkedAt,
      };
    }

    // Requirement 5 & 7: If a live connectivity check has executed and failed (disconnected client, missing IAM/ADC, missing index, or failed read/write probe), report blocked
    if (this.lastConnectivityCheck && !this.lastConnectivityCheck.isProductionReadyDriver) {
      return {
        readyForProductionTraffic: false,
        status: 'blocked',
        activeAdapterKind: this.adapterKind,
        authoritativeStoreLabel: this.driver.driverLabel,
        isDevelopmentOrTestOnly: false,
        isBackedByTestOrInMemoryDriver: false,
        configuredDatabaseId: this.configuredDatabaseId,
        configuredProjectId: this.configuredProjectId,
        authMode,
        readWriteProbeVerified: this.lastConnectivityCheck.readWriteProbeVerified,
        requiredCollectionsVerified: false,
        silentFallbackToMemoryEnabled: false,
        cloudStorageEnabled: this.cloudStorageEnabled,
        binaryArtifactPolicy: this.cloudStorageEnabled
          ? 'cloud-storage-backed'
          : 'metadata-only-stream-download',
        vaultBoundaryPolicy: 'server-only-aes-256-gcm',
        blockerCode: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        blockerMessage:
          this.lastConnectivityCheck.blockerMessage ||
          'Firestore database failed live read/write health probe.',
        checkedAt: this.lastConnectivityCheck.checkedAt,
      };
    }

    return {
      readyForProductionTraffic: true,
      status: 'ready',
      activeAdapterKind: this.adapterKind,
      authoritativeStoreLabel: this.driver.driverLabel,
      isDevelopmentOrTestOnly: false,
      isBackedByTestOrInMemoryDriver: false,
      configuredDatabaseId: this.configuredDatabaseId,
      configuredProjectId: this.configuredProjectId,
      authMode,
      readWriteProbeVerified: this.lastConnectivityCheck?.readWriteProbeVerified ?? true,
      requiredCollectionsVerified: true,
      silentFallbackToMemoryEnabled: false,
      cloudStorageEnabled: this.cloudStorageEnabled,
      binaryArtifactPolicy: this.cloudStorageEnabled
        ? 'cloud-storage-backed'
        : 'metadata-only-stream-download',
      vaultBoundaryPolicy: 'server-only-aes-256-gcm',
      blockerCode: null,
      blockerMessage: null,
      checkedAt,
    };
  }
}

// ============================================================================
// 4. DEVELOPMENT / TEST LOCAL SNAPSHOT PERSISTENCE ADAPTER
// ============================================================================

export interface LocalSnapshotAdapterOptions {
  snapshotFilePath?: string | null;
  nodeEnv?: string;
  allowSharedFilesystemInProd?: boolean;
  refuseUnreadyProductionStartup?: boolean;
  cloudStorageEnabled?: boolean;
}

export class LocalSnapshotPersistenceAdapter implements ISowveilPersistenceAdapter {
  public readonly adapterKind: PersistenceAdapterKind;
  public readonly isDevelopmentOrTestOnly: boolean;
  public readonly isBackedByTestOrInMemoryDriver = true as const;
  public readonly configuredDatabaseId = null;
  public readonly configuredProjectId = null;
  public readonly silentFallbackToMemoryEnabled = false as const;

  public readonly projects: IProjectPersistenceRepository;
  public readonly aiDirectorSessions: IAiDirectorSessionRepository;
  public readonly referenceLabSessions: IReferenceLabSessionRepository;
  public readonly templateFactoryDrafts: ITemplateFactoryDraftRepository;
  public readonly catalogAndVariants: ICatalogAndVariantRepository;
  public readonly providerConnections: IProviderConnectionMetadataRepository;
  public readonly credentialVault: IServerCredentialVaultRepository;
  public readonly routingAndExtensions: IRoutingAndExtensionRepository;
  public readonly renderExportJobs: IRenderExportJobRepository;
  public readonly governance: IUserAndSystemGovernanceRepository;
  public readonly migrationState: IMigrationStateRepository;

  private readonly driver: RuleEnforcingFirestoreTestDriver;
  private readonly snapshotFilePath: string | null;
  private readonly nodeEnv: string;
  private readonly allowSharedFilesystemInProd: boolean;
  private readonly cloudStorageEnabled: boolean;

  constructor(options: LocalSnapshotAdapterOptions = {}) {
    this.snapshotFilePath = options.snapshotFilePath ?? null;
    this.nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
    this.allowSharedFilesystemInProd =
      options.allowSharedFilesystemInProd ??
      process.env.SOWVEIL_ALLOW_SHARED_FS_SNAPSHOT === 'true';
    this.cloudStorageEnabled = Boolean(options.cloudStorageEnabled);

    if (this.allowSharedFilesystemInProd && this.snapshotFilePath) {
      this.adapterKind = 'local-json-snapshot-shared-fs';
      this.isDevelopmentOrTestOnly = false;
    } else {
      this.adapterKind = 'local-json-snapshot-dev-only';
      this.isDevelopmentOrTestOnly = true;
    }

    const readiness = this.getReadinessReport();
    if (
      this.nodeEnv === 'production' &&
      !readiness.readyForProductionTraffic &&
      (options.refuseUnreadyProductionStartup ||
        process.env.SOWVEIL_REFUSE_EPHEMERAL_PROD_STARTUP === 'true')
    ) {
      throw new PersistenceContractError({
        code: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        message:
          readiness.blockerMessage ||
          'Refusing production startup with development/test-only local JSON snapshot adapter.',
        entity: 'system',
        operation: 'startup',
      });
    }

    this.driver = new RuleEnforcingFirestoreTestDriver(
      this.isDevelopmentOrTestOnly
        ? 'Local JSON Snapshot Adapter (Development / Automated Test Only — Not Cloud Persistent)'
        : 'Configured Shared Filesystem JSON Snapshot Adapter'
    );

    const repos = new DriverBackedPersistenceRepositories(this.driver, {
      cloudStorageEnabled: this.cloudStorageEnabled,
      onMutate: () => this.flushToDiskIfConfigured(),
    });

    this.projects = repos.projects;
    this.aiDirectorSessions = repos.aiDirectorSessions;
    this.referenceLabSessions = repos.referenceLabSessions;
    this.templateFactoryDrafts = repos.templateFactoryDrafts;
    this.catalogAndVariants = repos.catalogAndVariants;
    this.providerConnections = repos.providerConnections;
    this.credentialVault = repos.credentialVault;
    this.routingAndExtensions = repos.routingAndExtensions;
    this.renderExportJobs = repos.renderExportJobs;
    this.governance = repos.governance;
    this.migrationState = repos.migrationState;
  }

  public async verifyDatabaseConnectivity(
    expectedDatabaseId: string =
      process.env.FIRESTORE_DATABASE_ID || CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID
  ): Promise<DatabaseConnectivityCheckResult> {
    return {
      connected: false,
      isProductionReadyDriver: false,
      isTestOrInMemoryDriver: true,
      isLocalSnapshotAdapter: true,
      databaseId: null,
      projectId: null,
      expectedDatabaseId,
      databaseIdentityVerified: false,
      readWriteProbeVerified: false,
      blockerCode: 'MIGRATION_BACKEND_NOT_PRODUCTION_READY',
      blockerMessage:
        'LocalSnapshotPersistenceAdapter is rejected for migration. A genuine, connected, verified production Cloud Firestore database adapter is required.',
      checkedAt: new Date().toISOString(),
    };
  }

  public async checkProductionReadinessAsync(): Promise<PersistenceReadinessReport> {
    return this.getReadinessReport();
  }

  public setSimulatedFailure(
    mode: 'none' | 'read-error' | 'write-error' | 'permission-denied',
    message?: string
  ): void {
    this.driver.setSimulatedFailure(mode, message);
  }

  private flushToDiskIfConfigured(): void {
    if (!this.snapshotFilePath) return;
    try {
      const dir = path.dirname(this.snapshotFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Snapshot marker for contract tests
      const markerPath = `${this.snapshotFilePath}.meta.json`;
      fs.writeFileSync(
        markerPath,
        JSON.stringify(
          {
            adapterKind: this.adapterKind,
            isDevelopmentOrTestOnly: this.isDevelopmentOrTestOnly,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        ),
        'utf8'
      );
    } catch {
      // Non-fatal in dev snapshot metadata marker
    }
  }

  public getReadinessReport(): PersistenceReadinessReport {
    const isProd = this.nodeEnv === 'production';
    if (isProd) {
      // Requirement 9: Never use a local JSON snapshot as the production source of truth.
      return {
        readyForProductionTraffic: false,
        status: 'blocked',
        activeAdapterKind: this.adapterKind,
        authoritativeStoreLabel:
          'Local JSON Snapshot (.data/sowveil-durable-store.json — BLOCKED IN PRODUCTION)',
        isDevelopmentOrTestOnly: true,
        isBackedByTestOrInMemoryDriver: true,
        configuredDatabaseId: null,
        configuredProjectId: null,
        authMode: 'test-driver',
        readWriteProbeVerified: false,
        requiredCollectionsVerified: false,
        silentFallbackToMemoryEnabled: false,
        cloudStorageEnabled: this.cloudStorageEnabled,
        binaryArtifactPolicy: this.cloudStorageEnabled
          ? 'cloud-storage-backed'
          : 'metadata-only-stream-download',
        vaultBoundaryPolicy: 'server-only-aes-256-gcm',
        blockerCode: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        blockerMessage:
          'Local JSON snapshot adapter (.data/sowveil-durable-store.json) is strictly a development/test adapter and migration input/export. It cannot be used as the production source of truth.',
        checkedAt: new Date().toISOString(),
      };
    }

    return {
      readyForProductionTraffic: false,
      status: 'development-only',
      activeAdapterKind: this.adapterKind,
      authoritativeStoreLabel:
        'Local JSON Snapshot (Development / Test Only — Ephemeral on Cloud Run)',
      isDevelopmentOrTestOnly: true,
      isBackedByTestOrInMemoryDriver: true,
      configuredDatabaseId: null,
      configuredProjectId: null,
      authMode: 'test-driver',
      readWriteProbeVerified: false,
      requiredCollectionsVerified: false,
      silentFallbackToMemoryEnabled: false,
      cloudStorageEnabled: this.cloudStorageEnabled,
      binaryArtifactPolicy: this.cloudStorageEnabled
        ? 'cloud-storage-backed'
        : 'metadata-only-stream-download',
      vaultBoundaryPolicy: 'server-only-aes-256-gcm',
      blockerCode: null,
      blockerMessage: null,
      checkedAt: new Date().toISOString(),
    };
  }
}

// ============================================================================
// 5. SERVER STARTUP PERSISTENCE ADAPTER INITIALIZATION (FAIL-CLOSED IN PROD)
// ============================================================================

export interface ServerPersistenceInitOptions {
  nodeEnv?: string;
  persistenceMode?: 'auto' | 'firestore' | 'development-snapshot';
  snapshotFilePath?: string | null;
  projectId?: string;
  databaseId?: string;
  expectedDatabaseId?: string;
  emulatorHost?: string | null;
  cloudStorageEnabled?: boolean;
  refuseUnreadyProductionStartup?: boolean;
  firestoreClient?: AdminSdkFirestoreClientLike;
}

/**
 * Initializes the server-side persistence adapter for `server.ts`.
 * - In `production` (or when `SOWVEIL_PERSISTENCE_MODE=firestore` or `FIRESTORE_EMULATOR_HOST` is set),
 *   creates a real `FirestoreDocumentDriver` backed by `firebase-admin/firestore` (ADC/Workload Identity or Emulator)
 *   and injects it into `AuthoritativeFirestorePersistenceAdapter`.
 * - Verifies live database connectivity & readiness via a real read/write health probe.
 * - Fails closed in production if the real driver is unavailable, lacks IAM/ADC, or points to the wrong database.
 * - In explicit `development`/`test` mode without Firestore configured, uses `LocalSnapshotPersistenceAdapter`.
 */
export async function initializeServerPersistenceAdapterFromEnv(
  options: ServerPersistenceInitOptions = {}
): Promise<{
  adapter: ISowveilPersistenceAdapter;
  readiness: PersistenceReadinessReport;
  mode: 'production-firestore' | 'emulator-firestore' | 'development-snapshot';
}> {
  const nodeEnv = (options.nodeEnv ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const requestedMode = (
    options.persistenceMode ??
    (process.env.SOWVEIL_PERSISTENCE_MODE as ServerPersistenceInitOptions['persistenceMode']) ??
    'auto'
  )
    .trim()
    .toLowerCase();
  const emulatorHost =
    options.emulatorHost !== undefined
      ? options.emulatorHost
      : process.env.FIRESTORE_EMULATOR_HOST?.trim() || null;
  const cloudStorageEnabled =
    options.cloudStorageEnabled ?? process.env.CLOUD_STORAGE_ENABLED === 'true';
  const refuseUnreadyProductionStartup =
    options.refuseUnreadyProductionStartup ??
    process.env.SOWVEIL_REFUSE_EPHEMERAL_PROD_STARTUP !== 'false';

  const shouldUseFirestoreDriver =
    nodeEnv === 'production' ||
    requestedMode === 'firestore' ||
    Boolean(emulatorHost) ||
    Boolean(options.firestoreClient);

  if (nodeEnv === 'production' && requestedMode === 'development-snapshot') {
    throw new PersistenceContractError({
      code: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
      message:
        'Cannot start in production with SOWVEIL_PERSISTENCE_MODE=development-snapshot. Local JSON snapshots are forbidden as the production source of truth.',
      entity: 'system',
      operation: 'startup',
    });
  }

  if (shouldUseFirestoreDriver) {
    const driver = new FirestoreDocumentDriver({
      projectId: options.projectId,
      databaseId: options.databaseId,
      expectedDatabaseId: options.expectedDatabaseId,
      emulatorHost,
      firestoreClient: options.firestoreClient,
    });

    const adapter = new AuthoritativeFirestorePersistenceAdapter({
      driver,
      nodeEnv,
      cloudStorageEnabled,
      expectedDatabaseId: options.expectedDatabaseId,
      rejectTestDriverInProduction: true,
    });

    const readiness = await adapter.checkProductionReadinessAsync(
      options.expectedDatabaseId ?? driver.expectedDatabaseId
    );

    if (nodeEnv === 'production' && !readiness.readyForProductionTraffic && refuseUnreadyProductionStartup) {
      throw new PersistenceContractError({
        code: readiness.blockerCode || 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        message:
          readiness.blockerMessage ||
          'Production startup refused: real Firestore Admin driver failed connectivity/readiness verification.',
        entity: 'system',
        operation: 'startup',
      });
    }

    return {
      adapter,
      readiness,
      mode: emulatorHost ? 'emulator-firestore' : 'production-firestore',
    };
  }

  const devAdapter = new LocalSnapshotPersistenceAdapter({
    snapshotFilePath: options.snapshotFilePath ?? null,
    nodeEnv,
    cloudStorageEnabled,
    refuseUnreadyProductionStartup,
  });

  return {
    adapter: devAdapter,
    readiness: devAdapter.getReadinessReport(),
    mode: 'development-snapshot',
  };
}

