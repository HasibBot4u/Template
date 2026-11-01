import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  App as FirebaseAdminApp,
  applicationDefault,
  getApp as getFirebaseAdminApp,
  getApps as getFirebaseAdminApps,
  initializeApp as initializeFirebaseAdminApp,
} from 'firebase-admin/app';
import {
  Firestore as FirebaseAdminFirestore,
  getFirestore as getFirebaseAdminFirestore,
} from 'firebase-admin/firestore';
import {
  assertImmutableIdentityFields,
  assertMonotonicRevision,
  assertNoLocalBlobUrls,
  assertValidDocumentId,
  PersistenceContractError,
} from '../services/persistenceContracts';

export const CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID =
  'ai-studio-411ad70d-501b-4df1-8287-ce21e9091d8d';
export const CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID = 'sacred-tune-blxdt';

export const REQUIRED_FIRESTORE_COLLECTIONS = [
  'projects',
  'aiDirectorSessions',
  'referenceLabSessions',
  'templateFactoryDrafts',
  'catalogItems',
  'templateVariants',
  'providerConnections',
  'serverVaultSecrets',
  'routingProfiles',
  'extensionPackages',
  'toolAuditRecords',
  'renderExportJobs',
  'users',
  'userFavorites',
  'admins',
  'userStatuses',
  'systemLocks',
  'auditEvents',
] as const;

// ============================================================================
// 1. DRIVER QUERY, BATCH, TRANSACTION & DIAGNOSTIC INTERFACES
// ============================================================================

export type FirestoreFilterOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'array-contains';

export interface FirestoreDriverWhereFilter {
  field: string;
  op: FirestoreFilterOp;
  value: unknown;
}

export interface FirestoreDriverOrderBySpec {
  field: string;
  direction?: 'asc' | 'desc';
}

export interface FirestoreDriverQuerySpec {
  where?: FirestoreDriverWhereFilter[];
  orderBy?: FirestoreDriverOrderBySpec[];
  limit?: number;
}

export type FirestoreDriverBatchOperation<T = Record<string, unknown>> =
  | {
      type: 'set';
      collectionPath: string;
      docId: string;
      data: T;
      merge?: boolean;
    }
  | {
      type: 'create';
      collectionPath: string;
      docId: string;
      data: T;
    }
  | {
      type: 'update';
      collectionPath: string;
      docId: string;
      patch: Partial<T>;
    }
  | {
      type: 'delete';
      collectionPath: string;
      docId: string;
    };

export interface FirestoreDriverUpdatePrecondition {
  expectedOwnerUid?: string;
  expectedRevision?: number;
  isAdmin?: boolean;
}

export interface IFirestoreDriverTransaction {
  get<T>(collectionPath: string, docId: string): Promise<T | null>;
  create<T>(collectionPath: string, docId: string, data: T): void;
  set<T>(collectionPath: string, docId: string, data: T, options?: { merge?: boolean }): void;
  update<T extends Record<string, unknown>>(
    collectionPath: string,
    docId: string,
    patch: Partial<T>
  ): void;
  delete(collectionPath: string, docId: string): void;
}

export type FirestoreDriverFailureReason =
  | 'NONE'
  | 'TEST_DRIVER_REJECTED'
  | 'DISCONNECTED_CLIENT'
  | 'ADC_OR_IAM_MISSING'
  | 'WRONG_DATABASE_ID'
  | 'WRONG_PROJECT_ID'
  | 'MISSING_REQUIRED_COLLECTION_OR_INDEX'
  | 'READ_WRITE_PROBE_FAILED';

export interface FirestoreDriverConnectivityReport {
  connected: boolean;
  databaseId: string;
  projectId: string;
  authMode: 'adc-workload-identity' | 'firestore-emulator' | 'test-driver' | 'local-verified-store' | 'unconfigured';
  emulatorHost: string | null;
  readWriteProbeVerified: boolean;
  requiredCollectionsVerified: boolean;
  failureReason: FirestoreDriverFailureReason;
  latencyMs: number;
  checkedAt: string;
  error?: string;
}

export interface FirestoreDriverSanitizedDiagnostics {
  driverLabel: string;
  isTestOrInMemoryDriver: boolean;
  projectId: string;
  databaseId: string;
  expectedDatabaseId: string;
  databaseIdentityMatches: boolean;
  authMode: 'adc-workload-identity' | 'firestore-emulator' | 'test-driver' | 'local-verified-store' | 'unconfigured';
  usingEmulator: boolean;
  emulatorHost: string | null;
  lastHealthProbeAt: string | null;
  lastHealthProbePassed: boolean | null;
  lastHealthProbeLatencyMs: number | null;
  lastFailureReason: FirestoreDriverFailureReason;
  lastSanitizedError: string | null;
  requiredCollections: readonly string[];
  credentialsExposed: false;
}

// ============================================================================
// 2. MINIMAL ABSTRACTION OVER FIREBASE-ADMIN FIRESTORE SDK FOR TESTABILITY
// ============================================================================

export interface AdminSdkDocumentSnapshotLike {
  exists: boolean;
  id: string;
  data(): Record<string, unknown> | undefined;
}

export interface AdminSdkQuerySnapshotLike {
  docs: AdminSdkDocumentSnapshotLike[];
  empty: boolean;
  size: number;
}

export interface AdminSdkDocumentReferenceLike {
  id: string;
  path: string;
  get(): Promise<AdminSdkDocumentSnapshotLike>;
  create(data: Record<string, unknown>): Promise<unknown>;
  set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
}

export interface AdminSdkQueryLike {
  where(field: string, op: FirestoreFilterOp, value: unknown): AdminSdkQueryLike;
  orderBy(field: string, direction?: 'asc' | 'desc'): AdminSdkQueryLike;
  limit(limit: number): AdminSdkQueryLike;
  get(): Promise<AdminSdkQuerySnapshotLike>;
}

export interface AdminSdkCollectionReferenceLike extends AdminSdkQueryLike {
  id: string;
  doc(docId: string): AdminSdkDocumentReferenceLike;
}

export interface AdminSdkWriteBatchLike {
  set(
    docRef: AdminSdkDocumentReferenceLike,
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ): AdminSdkWriteBatchLike;
  create(
    docRef: AdminSdkDocumentReferenceLike,
    data: Record<string, unknown>
  ): AdminSdkWriteBatchLike;
  update(
    docRef: AdminSdkDocumentReferenceLike,
    data: Record<string, unknown>
  ): AdminSdkWriteBatchLike;
  delete(docRef: AdminSdkDocumentReferenceLike): AdminSdkWriteBatchLike;
  commit(): Promise<unknown>;
}

export interface AdminSdkTransactionLike {
  get(docRef: AdminSdkDocumentReferenceLike): Promise<AdminSdkDocumentSnapshotLike>;
  create(
    docRef: AdminSdkDocumentReferenceLike,
    data: Record<string, unknown>
  ): AdminSdkTransactionLike;
  set(
    docRef: AdminSdkDocumentReferenceLike,
    data: Record<string, unknown>,
    options?: { merge?: boolean }
  ): AdminSdkTransactionLike;
  update(
    docRef: AdminSdkDocumentReferenceLike,
    data: Record<string, unknown>
  ): AdminSdkTransactionLike;
  delete(docRef: AdminSdkDocumentReferenceLike): AdminSdkTransactionLike;
}

export interface AdminSdkFirestoreClientLike {
  collection(collectionPath: string): AdminSdkCollectionReferenceLike;
  batch(): AdminSdkWriteBatchLike;
  runTransaction<R>(
    updateFunction: (transaction: AdminSdkTransactionLike) => Promise<R>,
    transactionOptions?: { maxAttempts?: number }
  ): Promise<R>;
}

// ============================================================================
// 3. PRE-WRITE SCHEMA & SECURITY INVARIANT VALIDATION
// ============================================================================

const OWNER_SCOPED_COLLECTIONS = new Set<string>([
  'projects',
  'aiDirectorSessions',
  'referenceLabSessions',
  'templateFactoryDrafts',
  'providerConnections',
  'renderExportJobs',
]);

export function validateEntityPayloadBeforeWrite<T>(
  collectionPath: string,
  docId: string,
  data: T,
  operation: 'create' | 'update' = 'update'
): Record<string, unknown> {
  const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
  const cleanDocId = assertValidDocumentId(docId, cleanCol);

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new PersistenceContractError({
      code: 'INVALID_DTO_PAYLOAD',
      message: `Invalid non-object document payload for ${cleanCol}/${cleanDocId}.`,
      entity: cleanCol,
      operation,
      documentId: cleanDocId,
    });
  }

  assertNoLocalBlobUrls(data, cleanCol, cleanDocId);

  const record = data as unknown as Record<string, unknown>;

  if ('id' in record && record.id !== undefined && record.id !== cleanDocId) {
    throw new PersistenceContractError({
      code: 'IMMUTABLE_IDENTITY_VIOLATION',
      message: `Document payload id "${String(record.id)}" does not match target document ID "${cleanDocId}" in collection "${cleanCol}".`,
      entity: cleanCol,
      operation,
      documentId: cleanDocId,
    });
  }

  if (cleanCol === 'providerConnections') {
    if ('encryptedCredential' in record || 'apiKey' in record || 'rawSecret' in record) {
      throw new PersistenceContractError({
        code: 'VAULT_SECRET_IN_PUBLIC_DTO_FORBIDDEN',
        message:
          'Security violation: encryptedCredential or raw secret keys must never be written to /providerConnections.',
        entity: cleanCol,
        operation,
        documentId: cleanDocId,
      });
    }
  }

  if (cleanCol === 'renderExportJobs') {
    if ('artifactBytesBase64' in record && record.artifactBytesBase64) {
      throw new PersistenceContractError({
        code: 'BINARY_MEDIA_IN_FIRESTORE_FORBIDDEN',
        message:
          'Firestore documents must not store binary artifactBytesBase64 payloads.',
        entity: cleanCol,
        operation,
        documentId: cleanDocId,
      });
    }
  }

  if (operation === 'create' && OWNER_SCOPED_COLLECTIONS.has(cleanCol)) {
    assertValidDocumentId(record.ownerUid, `${cleanCol}.ownerUid`);
  }

  // Strip undefined properties cleanly before sending to Firestore
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
}

export function sanitizeFirestoreSdkError(err: unknown): {
  sanitizedMessage: string;
  failureReason: FirestoreDriverFailureReason;
  isAlreadyExists: boolean;
  isNotFound: boolean;
  isAbortedConflict: boolean;
  isMissingIndex: boolean;
  isAuthOrIamError: boolean;
  retryable: boolean;
} {
  const rawMessage = err instanceof Error ? err.message : String(err ?? 'Unknown Firestore error');
  const code = (err as { code?: number | string })?.code;

  // Redact any accidental bearer tokens, private keys, or file paths
  const sanitizedMessage = rawMessage
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[REDACTED_KEY]')
    .replace(/AIza[0-9A-Za-z\-_]{30,}/g, '[REDACTED_API_KEY]')
    .slice(0, 420);

  const isAlreadyExists =
    code === 6 ||
    code === '6' ||
    code === 'ALREADY_EXISTS' ||
    /ALREADY_EXISTS|already exists/i.test(rawMessage);

  const isNotFound =
    code === 5 ||
    code === '5' ||
    code === 'NOT_FOUND' ||
    /NOT_FOUND|No document to update/i.test(rawMessage);

  const isAbortedConflict =
    code === 10 ||
    code === '10' ||
    code === 'ABORTED' ||
    /ABORTED|transaction|cross-transaction|contention/i.test(rawMessage);

  const isMissingIndex =
    code === 9 ||
    code === '9' ||
    code === 'FAILED_PRECONDITION' ||
    /FAILED_PRECONDITION|requires an index|index is currently building/i.test(rawMessage);

  const isAuthOrIamError =
    code === 7 ||
    code === '7' ||
    code === 16 ||
    code === '16' ||
    code === 'PERMISSION_DENIED' ||
    code === 'UNAUTHENTICATED' ||
    /Could not load the default credentials|PERMISSION_DENIED|UNAUTHENTICATED|invalid_grant|MetadataLookupWarning|ENOTFOUND metadata/i.test(
      rawMessage
    );

  const isWrongDatabaseError =
    /Database.*does not exist|database.*not found/i.test(rawMessage);

  let failureReason: FirestoreDriverFailureReason = 'DISCONNECTED_CLIENT';
  if (isAuthOrIamError) {
    failureReason = 'ADC_OR_IAM_MISSING';
  } else if (isMissingIndex) {
    failureReason = 'MISSING_REQUIRED_COLLECTION_OR_INDEX';
  } else if (isWrongDatabaseError) {
    failureReason = 'WRONG_DATABASE_ID';
  }

  const retryable =
    code === 14 ||
    code === '14' ||
    code === 'UNAVAILABLE' ||
    code === 4 ||
    code === 'DEADLINE_EXCEEDED' ||
    isAbortedConflict;

  return {
    sanitizedMessage,
    failureReason,
    isAlreadyExists,
    isNotFound,
    isAbortedConflict,
    isMissingIndex,
    isAuthOrIamError,
    retryable,
  };
}

// ============================================================================
// 4. CONCRETE SERVER-SIDE FIRESTORE DOCUMENT DRIVER (`FirestoreDocumentDriver`)
// ============================================================================

export interface FirestoreDocumentDriverOptions {
  projectId?: string;
  databaseId?: string;
  expectedDatabaseId?: string;
  firestoreClient?: AdminSdkFirestoreClientLike;
  emulatorHost?: string | null;
  driverLabel?: string;
  requiredCollectionsToProbe?: readonly string[];
}

export class FirestoreDocumentDriver {
  public readonly driverLabel: string;
  public readonly isTestOrInMemoryDriver = false as const;
  public readonly projectId: string;
  public readonly databaseId: string;
  public readonly expectedDatabaseId: string;
  public readonly authMode: 'adc-workload-identity' | 'firestore-emulator' | 'unconfigured';
  public readonly emulatorHost: string | null;

  private readonly client: AdminSdkFirestoreClientLike;
  private readonly requiredCollectionsToProbe: readonly string[];
  private lastHealthProbeAt: string | null = null;
  private lastHealthProbePassed: boolean | null = null;
  private lastHealthProbeLatencyMs: number | null = null;
  private lastFailureReason: FirestoreDriverFailureReason = 'NONE';
  private lastSanitizedError: string | null = null;

  constructor(options: FirestoreDocumentDriverOptions = {}) {
    const resolvedConfig = resolveFirebaseAppletProjectAndDatabase();
    this.projectId = (
      options.projectId ??
      process.env.FIREBASE_PROJECT_ID ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      resolvedConfig.projectId
    ).trim();
    this.databaseId = (
      options.databaseId ??
      process.env.FIRESTORE_DATABASE_ID ??
      resolvedConfig.databaseId
    ).trim();
    this.expectedDatabaseId = (
      options.expectedDatabaseId ??
      process.env.FIRESTORE_DATABASE_ID ??
      CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID
    ).trim();

    if (!this.projectId) {
      throw new PersistenceContractError({
        code: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        message: 'FirestoreDocumentDriver requires a configured Firebase projectId.',
        entity: 'system',
        operation: 'startup',
      });
    }
    if (!this.databaseId) {
      throw new PersistenceContractError({
        code: 'PRODUCTION_DURABLE_ADAPTER_REQUIRED',
        message: 'FirestoreDocumentDriver requires a configured Firestore databaseId.',
        entity: 'system',
        operation: 'startup',
      });
    }

    const rawEmulatorHost =
      options.emulatorHost !== undefined
        ? options.emulatorHost
        : process.env.FIRESTORE_EMULATOR_HOST?.trim() || null;
    this.emulatorHost = rawEmulatorHost || null;
    this.authMode = this.emulatorHost ? 'firestore-emulator' : 'adc-workload-identity';
    this.requiredCollectionsToProbe = options.requiredCollectionsToProbe ?? [
      'projects',
      'catalogItems',
      'systemLocks',
    ];

    this.driverLabel =
      options.driverLabel ??
      (this.emulatorHost
        ? `Firebase Admin Firestore Driver [Emulator ${this.emulatorHost}] (${this.projectId}/${this.databaseId})`
        : `Firebase Admin Firestore Driver [ADC/Workload Identity] (${this.projectId}/${this.databaseId})`);

    if (options.firestoreClient) {
      this.client = options.firestoreClient;
    } else {
      this.client = createFirebaseAdminFirestoreInstance({
        projectId: this.projectId,
        databaseId: this.databaseId,
        emulatorHost: this.emulatorHost,
      });
    }
  }

  public static fromEnvironment(options: FirestoreDocumentDriverOptions = {}): FirestoreDocumentDriver {
    return new FirestoreDocumentDriver(options);
  }

  private recordDriverError(err: unknown): {
    sanitizedMessage: string;
    failureReason: FirestoreDriverFailureReason;
    isAlreadyExists: boolean;
    isNotFound: boolean;
    isAbortedConflict: boolean;
    isMissingIndex: boolean;
    isAuthOrIamError: boolean;
    retryable: boolean;
  } {
    const inspected = sanitizeFirestoreSdkError(err);
    this.lastFailureReason = inspected.failureReason;
    this.lastSanitizedError = inspected.sanitizedMessage;
    return inspected;
  }

  public async getDocument<T>(collectionPath: string, docId: string): Promise<T | null> {
    const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
    const cleanDocId = assertValidDocumentId(docId, cleanCol);
    try {
      const snap = await this.client.collection(cleanCol).doc(cleanDocId).get();
      if (!snap.exists) {
        return null;
      }
      const raw = snap.data();
      if (!raw) {
        return null;
      }
      return raw as unknown as T;
    } catch (err) {
      if (err instanceof PersistenceContractError) throw err;
      const inspected = this.recordDriverError(err);
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_READ_FAILED',
        message: `Firestore Admin getDocument(${cleanCol}/${cleanDocId}) failed: ${inspected.sanitizedMessage}`,
        entity: cleanCol,
        operation: 'get',
        documentId: cleanDocId,
        retryable: inspected.retryable,
      });
    }
  }

  public async createDocumentIfAbsent<T>(
    collectionPath: string,
    docId: string,
    data: T
  ): Promise<boolean> {
    const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
    const cleanDocId = assertValidDocumentId(docId, cleanCol);
    const sanitizedPayload = validateEntityPayloadBeforeWrite(cleanCol, cleanDocId, data, 'create');

    try {
      // Firestore Admin SDK .create() is a server-side atomic precondition (exists === false)
      await this.client.collection(cleanCol).doc(cleanDocId).create(sanitizedPayload);
      return true;
    } catch (err) {
      if (err instanceof PersistenceContractError) throw err;
      const inspected = sanitizeFirestoreSdkError(err);
      if (inspected.isAlreadyExists) {
        return false;
      }
      this.recordDriverError(err);
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `Firestore Admin createDocumentIfAbsent(${cleanCol}/${cleanDocId}) failed: ${inspected.sanitizedMessage}`,
        entity: cleanCol,
        operation: 'create',
        documentId: cleanDocId,
        retryable: inspected.retryable,
      });
    }
  }

  public async setDocument<T>(
    collectionPath: string,
    docId: string,
    data: T,
    options?: { merge?: boolean }
  ): Promise<void> {
    const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
    const cleanDocId = assertValidDocumentId(docId, cleanCol);
    const sanitizedPayload = validateEntityPayloadBeforeWrite(cleanCol, cleanDocId, data, 'update');

    try {
      if (options?.merge) {
        await this.client
          .collection(cleanCol)
          .doc(cleanDocId)
          .set(sanitizedPayload, { merge: true });
      } else {
        await this.client.collection(cleanCol).doc(cleanDocId).set(sanitizedPayload);
      }
    } catch (err) {
      if (err instanceof PersistenceContractError) throw err;
      const inspected = this.recordDriverError(err);
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `Firestore Admin setDocument(${cleanCol}/${cleanDocId}) failed: ${inspected.sanitizedMessage}`,
        entity: cleanCol,
        operation: 'update',
        documentId: cleanDocId,
        retryable: inspected.retryable,
      });
    }
  }

  /**
   * Atomic server-side transactional update enforcing ownerUid, immutable identity fields,
   * and expectedRevision / monotonic revision preconditions.
   */
  public async updateDocument<T extends Record<string, any>>(
    collectionPath: string,
    docId: string,
    patch: Partial<T>,
    precondition?: FirestoreDriverUpdatePrecondition
  ): Promise<T> {
    const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
    const cleanDocId = assertValidDocumentId(docId, cleanCol);

    return this.runTransaction<T>(async (tx) => {
      const existing = await tx.get<T>(cleanCol, cleanDocId);
      if (!existing) {
        throw new PersistenceContractError({
          code: 'ENTITY_NOT_FOUND',
          message: `Document "${cleanDocId}" not found in "${cleanCol}".`,
          entity: cleanCol,
          operation: 'update',
          documentId: cleanDocId,
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
          message: `Caller "${precondition.expectedOwnerUid}" is not authorized to update ${cleanCol}/${cleanDocId}.`,
          entity: cleanCol,
          operation: 'update',
          documentId: cleanDocId,
        });
      }

      assertImmutableIdentityFields({
        entity: cleanCol,
        documentId: cleanDocId,
        existing: {
          id: String(existing.id ?? cleanDocId),
          ownerUid: typeof existing.ownerUid === 'string' ? existing.ownerUid : undefined,
          createdAt: typeof existing.createdAt === 'string' ? existing.createdAt : undefined,
        },
        incoming: {
          id: patch.id !== undefined ? String(patch.id) : undefined,
          ownerUid: patch.ownerUid !== undefined ? String(patch.ownerUid) : undefined,
          createdAt: patch.createdAt !== undefined ? String(patch.createdAt) : undefined,
        },
      });

      const merged: Record<string, unknown> = {
        ...existing,
        ...patch,
        id: existing.id ?? cleanDocId,
      };
      if (existing.ownerUid !== undefined) {
        merged.ownerUid = existing.ownerUid;
      }
      if (existing.createdAt !== undefined) {
        merged.createdAt = existing.createdAt;
      }

      if (typeof existing.revision === 'number' || precondition?.expectedRevision !== undefined) {
        const currentRev = typeof existing.revision === 'number' ? existing.revision : 1;
        const nextRev = assertMonotonicRevision({
          entity: cleanCol,
          documentId: cleanDocId,
          existingRevision: currentRev,
          expectedRevision: precondition?.expectedRevision,
          incomingRevision: typeof patch.revision === 'number' ? patch.revision : undefined,
        });
        merged.revision = nextRev;
      }

      const validated = validateEntityPayloadBeforeWrite(cleanCol, cleanDocId, merged, 'update');
      tx.set(cleanCol, cleanDocId, validated);
      return validated as unknown as T;
    });
  }

  public async deleteDocument(collectionPath: string, docId: string): Promise<boolean> {
    const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
    const cleanDocId = assertValidDocumentId(docId, cleanCol);
    try {
      const docRef = this.client.collection(cleanCol).doc(cleanDocId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return false;
      }
      await docRef.delete();
      return true;
    } catch (err) {
      if (err instanceof PersistenceContractError) throw err;
      const inspected = this.recordDriverError(err);
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `Firestore Admin deleteDocument(${cleanCol}/${cleanDocId}) failed: ${inspected.sanitizedMessage}`,
        entity: cleanCol,
        operation: 'delete',
        documentId: cleanDocId,
        retryable: inspected.retryable,
      });
    }
  }

  public async listCollection<T>(collectionPath: string): Promise<T[]> {
    const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
    try {
      const snap = await this.client.collection(cleanCol).get();
      const results: T[] = [];
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data) {
          results.push(data as unknown as T);
        }
      }
      return results;
    } catch (err) {
      if (err instanceof PersistenceContractError) throw err;
      const inspected = this.recordDriverError(err);
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_READ_FAILED',
        message: `Firestore Admin listCollection(${cleanCol}) failed: ${inspected.sanitizedMessage}`,
        entity: cleanCol,
        operation: 'list',
        retryable: inspected.retryable,
      });
    }
  }

  public async queryDocuments<T>(
    collectionPath: string,
    querySpec: FirestoreDriverQuerySpec
  ): Promise<T[]> {
    const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
    try {
      let query: AdminSdkQueryLike = this.client.collection(cleanCol);
      for (const filter of querySpec.where || []) {
        query = query.where(filter.field, filter.op, filter.value);
      }
      for (const order of querySpec.orderBy || []) {
        query = query.orderBy(order.field, order.direction ?? 'asc');
      }
      if (typeof querySpec.limit === 'number' && querySpec.limit > 0) {
        query = query.limit(Math.floor(querySpec.limit));
      }
      const snap = await query.get();
      const results: T[] = [];
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data) {
          results.push(data as unknown as T);
        }
      }
      return results;
    } catch (err) {
      if (err instanceof PersistenceContractError) throw err;
      const inspected = this.recordDriverError(err);
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_READ_FAILED',
        message: `Firestore Admin queryDocuments(${cleanCol}) failed: ${inspected.sanitizedMessage}`,
        entity: cleanCol,
        operation: 'list',
        retryable: inspected.retryable,
      });
    }
  }

  public async batchWrite(
    operations: FirestoreDriverBatchOperation[]
  ): Promise<{ committedCount: number }> {
    if (!Array.isArray(operations) || operations.length === 0) {
      return { committedCount: 0 };
    }

    // Validate all operations upfront before committing any chunk
    const preparedOps = operations.map((op) => {
      const cleanCol = assertValidDocumentId(op.collectionPath, 'collectionPath');
      const cleanDocId = assertValidDocumentId(op.docId, cleanCol);
      if (op.type === 'set' || op.type === 'create') {
        const payload = validateEntityPayloadBeforeWrite(
          cleanCol,
          cleanDocId,
          op.data,
          op.type === 'create' ? 'create' : 'update'
        );
        return { ...op, collectionPath: cleanCol, docId: cleanDocId, data: payload };
      }
      if (op.type === 'update') {
        assertNoLocalBlobUrls(op.patch, cleanCol, cleanDocId);
        const cleanPatch = JSON.parse(JSON.stringify(op.patch ?? {})) as Record<string, unknown>;
        return { ...op, collectionPath: cleanCol, docId: cleanDocId, patch: cleanPatch };
      }
      return { ...op, collectionPath: cleanCol, docId: cleanDocId };
    });

    const MAX_BATCH_SIZE = 450;
    let committedCount = 0;

    try {
      for (let i = 0; i < preparedOps.length; i += MAX_BATCH_SIZE) {
        const chunk = preparedOps.slice(i, i + MAX_BATCH_SIZE);
        const batch = this.client.batch();
        for (const op of chunk) {
          const ref = this.client.collection(op.collectionPath).doc(op.docId);
          if (op.type === 'set') {
            batch.set(ref, op.data, op.merge ? { merge: true } : undefined);
          } else if (op.type === 'create') {
            batch.create(ref, op.data);
          } else if (op.type === 'update') {
            batch.update(ref, op.patch);
          } else if (op.type === 'delete') {
            batch.delete(ref);
          }
        }
        await batch.commit();
        committedCount += chunk.length;
      }
      return { committedCount };
    } catch (err) {
      if (err instanceof PersistenceContractError) throw err;
      const inspected = this.recordDriverError(err);
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `Firestore Admin batchWrite failed: ${inspected.sanitizedMessage}`,
        entity: 'batchWrite',
        operation: 'transaction',
        retryable: inspected.retryable,
      });
    }
  }

  public async runTransaction<R>(
    updateFn: (tx: IFirestoreDriverTransaction) => Promise<R>
  ): Promise<R> {
    try {
      return await this.client.runTransaction(
        async (nativeTx) => {
          let writeInitiated = false;
          const txAdapter: IFirestoreDriverTransaction = {
            get: async <T>(collectionPath: string, docId: string): Promise<T | null> => {
              if (writeInitiated) {
                throw new PersistenceContractError({
                  code: 'INVALID_DTO_PAYLOAD',
                  message:
                    'Firestore transactions require all reads to be executed before any writes.',
                  entity: collectionPath,
                  operation: 'transaction',
                  documentId: docId,
                });
              }
              const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
              const cleanDocId = assertValidDocumentId(docId, cleanCol);
              const snap = await nativeTx.get(this.client.collection(cleanCol).doc(cleanDocId));
              if (!snap.exists) return null;
              const data = snap.data();
              return data ? (data as unknown as T) : null;
            },
            create: <T>(collectionPath: string, docId: string, data: T): void => {
              writeInitiated = true;
              const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
              const cleanDocId = assertValidDocumentId(docId, cleanCol);
              const payload = validateEntityPayloadBeforeWrite(cleanCol, cleanDocId, data, 'create');
              nativeTx.create(this.client.collection(cleanCol).doc(cleanDocId), payload);
            },
            set: <T>(
              collectionPath: string,
              docId: string,
              data: T,
              options?: { merge?: boolean }
            ): void => {
              writeInitiated = true;
              const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
              const cleanDocId = assertValidDocumentId(docId, cleanCol);
              const payload = validateEntityPayloadBeforeWrite(cleanCol, cleanDocId, data, 'update');
              nativeTx.set(
                this.client.collection(cleanCol).doc(cleanDocId),
                payload,
                options?.merge ? { merge: true } : undefined
              );
            },
            update: <T extends Record<string, unknown>>(
              collectionPath: string,
              docId: string,
              patch: Partial<T>
            ): void => {
              writeInitiated = true;
              const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
              const cleanDocId = assertValidDocumentId(docId, cleanCol);
              assertNoLocalBlobUrls(patch, cleanCol, cleanDocId);
              const cleanPatch = JSON.parse(JSON.stringify(patch ?? {})) as Record<string, unknown>;
              nativeTx.update(this.client.collection(cleanCol).doc(cleanDocId), cleanPatch);
            },
            delete: (collectionPath: string, docId: string): void => {
              writeInitiated = true;
              const cleanCol = assertValidDocumentId(collectionPath, 'collectionPath');
              const cleanDocId = assertValidDocumentId(docId, cleanCol);
              nativeTx.delete(this.client.collection(cleanCol).doc(cleanDocId));
            },
          };

          return updateFn(txAdapter);
        },
        { maxAttempts: 5 }
      );
    } catch (err) {
      if (err instanceof PersistenceContractError) throw err;
      const inspected = this.recordDriverError(err);
      if (inspected.isAlreadyExists) {
        throw new PersistenceContractError({
          code: 'ENTITY_ALREADY_EXISTS',
          message: `Transaction failed because document already exists: ${inspected.sanitizedMessage}`,
          entity: 'transaction',
          operation: 'transaction',
        });
      }
      if (inspected.isAbortedConflict) {
        throw new PersistenceContractError({
          code: 'REVISION_CONFLICT',
          message: `Transaction aborted due to concurrent modification conflict: ${inspected.sanitizedMessage}`,
          entity: 'transaction',
          operation: 'transaction',
          retryable: true,
        });
      }
      throw new PersistenceContractError({
        code: 'AUTHORITATIVE_STORE_WRITE_FAILED',
        message: `Firestore Admin transaction failed: ${inspected.sanitizedMessage}`,
        entity: 'transaction',
        operation: 'transaction',
        retryable: inspected.retryable,
      });
    }
  }

  /**
   * Performs a real, non-hardcoded read/write health probe against a dedicated
   * systemLocks health document (with automatic cleanup) AND verifies collection/index queries.
   */
  public async verifyConnectivity(): Promise<FirestoreDriverConnectivityReport> {
    const startMs = Date.now();
    const checkedAt = new Date().toISOString();

    if (
      !this.projectId ||
      this.projectId === 'in-memory-test-project' ||
      this.projectId === 'remixed-project-id'
    ) {
      this.lastHealthProbeAt = checkedAt;
      this.lastHealthProbePassed = false;
      this.lastFailureReason = 'WRONG_PROJECT_ID';
      this.lastSanitizedError = `Invalid or unconfigured Firebase projectId "${this.projectId}".`;
      return {
        connected: false,
        databaseId: this.databaseId,
        projectId: this.projectId,
        authMode: this.authMode,
        emulatorHost: this.emulatorHost,
        readWriteProbeVerified: false,
        requiredCollectionsVerified: false,
        failureReason: 'WRONG_PROJECT_ID',
        latencyMs: Date.now() - startMs,
        checkedAt,
        error: this.lastSanitizedError,
      };
    }

    if (!this.databaseId || this.databaseId !== this.expectedDatabaseId) {
      this.lastHealthProbeAt = checkedAt;
      this.lastHealthProbePassed = false;
      this.lastFailureReason = 'WRONG_DATABASE_ID';
      this.lastSanitizedError = `Configured databaseId "${this.databaseId}" does not match expected "${this.expectedDatabaseId}".`;
      return {
        connected: false,
        databaseId: this.databaseId,
        projectId: this.projectId,
        authMode: this.authMode,
        emulatorHost: this.emulatorHost,
        readWriteProbeVerified: false,
        requiredCollectionsVerified: false,
        failureReason: 'WRONG_DATABASE_ID',
        latencyMs: Date.now() - startMs,
        checkedAt,
        error: this.lastSanitizedError,
      };
    }

    const probeDocId = `healthProbe_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
    const probeNonce = `nonce_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    try {
      // 1. Safe write to dedicated systemLocks health document
      const probeRef = this.client.collection('systemLocks').doc(probeDocId);
      await probeRef.set({
        id: probeDocId,
        probeNonce,
        projectId: this.projectId,
        databaseId: this.databaseId,
        checkedAt,
      });

      // 2. Safe read-after-write verification
      const snap = await probeRef.get();
      const data = snap.exists ? snap.data() : undefined;
      const readWriteVerified = Boolean(data && data.probeNonce === probeNonce);

      // 3. Clean up ephemeral probe document immediately
      await probeRef.delete().catch(() => {});

      if (!readWriteVerified) {
        this.lastHealthProbeAt = checkedAt;
        this.lastHealthProbePassed = false;
        this.lastHealthProbeLatencyMs = Date.now() - startMs;
        this.lastFailureReason = 'READ_WRITE_PROBE_FAILED';
        this.lastSanitizedError =
          'Firestore health probe read-after-write nonce verification failed.';
        return {
          connected: false,
          databaseId: this.databaseId,
          projectId: this.projectId,
          authMode: this.authMode,
          emulatorHost: this.emulatorHost,
          readWriteProbeVerified: false,
          requiredCollectionsVerified: false,
          failureReason: 'READ_WRITE_PROBE_FAILED',
          latencyMs: this.lastHealthProbeLatencyMs,
          checkedAt,
          error: this.lastSanitizedError,
        };
      }

      // 4. Verify required collections / indexes are reachable via bounded limit(1) query
      for (const colName of this.requiredCollectionsToProbe) {
        await this.client.collection(colName).limit(1).get();
      }

      this.lastHealthProbeAt = checkedAt;
      this.lastHealthProbePassed = true;
      this.lastHealthProbeLatencyMs = Date.now() - startMs;
      this.lastFailureReason = 'NONE';
      this.lastSanitizedError = null;

      return {
        connected: true,
        databaseId: this.databaseId,
        projectId: this.projectId,
        authMode: this.authMode,
        emulatorHost: this.emulatorHost,
        readWriteProbeVerified: true,
        requiredCollectionsVerified: true,
        failureReason: 'NONE',
        latencyMs: this.lastHealthProbeLatencyMs,
        checkedAt,
      };
    } catch (err) {
      // Best-effort cleanup if probe doc was created before failure
      await this.client
        .collection('systemLocks')
        .doc(probeDocId)
        .delete()
        .catch(() => {});

      const inspected = this.recordDriverError(err);
      this.lastHealthProbeAt = checkedAt;
      this.lastHealthProbePassed = false;
      this.lastHealthProbeLatencyMs = Date.now() - startMs;

      return {
        connected: false,
        databaseId: this.databaseId,
        projectId: this.projectId,
        authMode: this.authMode,
        emulatorHost: this.emulatorHost,
        readWriteProbeVerified: false,
        requiredCollectionsVerified: !inspected.isMissingIndex,
        failureReason: inspected.failureReason,
        latencyMs: this.lastHealthProbeLatencyMs,
        checkedAt,
        error: inspected.sanitizedMessage,
      };
    }
  }

  public getSanitizedDriverDiagnostics(): FirestoreDriverSanitizedDiagnostics {
    return {
      driverLabel: this.driverLabel,
      isTestOrInMemoryDriver: false,
      projectId: this.projectId,
      databaseId: this.databaseId,
      expectedDatabaseId: this.expectedDatabaseId,
      databaseIdentityMatches: this.databaseId === this.expectedDatabaseId,
      authMode: this.authMode,
      usingEmulator: Boolean(this.emulatorHost),
      emulatorHost: this.emulatorHost,
      lastHealthProbeAt: this.lastHealthProbeAt,
      lastHealthProbePassed: this.lastHealthProbePassed,
      lastHealthProbeLatencyMs: this.lastHealthProbeLatencyMs,
      lastFailureReason: this.lastFailureReason,
      lastSanitizedError: this.lastSanitizedError,
      requiredCollections: REQUIRED_FIRESTORE_COLLECTIONS,
      credentialsExposed: false,
    };
  }
}

// ============================================================================
// 5. FIREBASE ADMIN SDK INITIALIZATION (ADC / WORKLOAD IDENTITY OR EMULATOR)
// ============================================================================

const initializedFirestoreInstances = new Map<string, FirebaseAdminFirestore>();

export function resolveFirebaseAppletProjectAndDatabase(): {
  projectId: string;
  databaseId: string;
} {
  let projectId = CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID;
  let databaseId = CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID;

  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      };
      if (parsed.projectId && parsed.projectId.trim()) {
        projectId = parsed.projectId.trim();
      }
      if (parsed.firestoreDatabaseId && parsed.firestoreDatabaseId.trim()) {
        databaseId = parsed.firestoreDatabaseId.trim();
      }
    }
  } catch {
    // Fallback to canonical constants if config file cannot be parsed
  }

  return { projectId, databaseId };
}

export function createFirebaseAdminFirestoreInstance(options: {
  projectId: string;
  databaseId: string;
  emulatorHost?: string | null;
}): AdminSdkFirestoreClientLike {
  const { projectId, databaseId, emulatorHost } = options;
  const cacheKey = `${projectId}::${databaseId}::${emulatorHost || 'adc'}`;
  const existing = initializedFirestoreInstances.get(cacheKey);
  if (existing) {
    return existing as unknown as AdminSdkFirestoreClientLike;
  }

  if (emulatorHost) {
    process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;
  }

  const appName = `sowveil-admin-${projectId}-${emulatorHost ? 'emulator' : 'adc'}`;
  const existingApps = getFirebaseAdminApps();
  let app: FirebaseAdminApp;

  if (existingApps.some((a) => a.name === appName)) {
    app = getFirebaseAdminApp(appName);
  } else if (emulatorHost) {
    // Firestore Emulator mode: no service account credential needed
    app = initializeFirebaseAdminApp({ projectId }, appName);
  } else {
    // Hosted Cloud Run / GCP production mode: strictly Application Default Credentials / Workload Identity
    app = initializeFirebaseAdminApp(
      {
        credential: applicationDefault(),
        projectId,
      },
      appName
    );
  }

  const firestore = getFirebaseAdminFirestore(app, databaseId);
  try {
    firestore.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Settings may already be frozen if getFirestore was called earlier on this app/db
  }

  initializedFirestoreInstances.set(cacheKey, firestore);
  return firestore as unknown as AdminSdkFirestoreClientLike;
}
