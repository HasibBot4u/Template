import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApiApp } from '../server/apiApp';
import {
  AdminSdkCollectionReferenceLike,
  AdminSdkDocumentReferenceLike,
  AdminSdkDocumentSnapshotLike,
  AdminSdkFirestoreClientLike,
  AdminSdkQueryLike,
  AdminSdkQuerySnapshotLike,
  AdminSdkTransactionLike,
  AdminSdkWriteBatchLike,
  CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
  CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
  FirestoreDocumentDriver,
  FirestoreFilterOp,
} from '../server/firestoreAdminDriver';
import {
  AuthoritativeFirestorePersistenceAdapter,
  initializeServerPersistenceAdapterFromEnv,
  LocalSnapshotPersistenceAdapter,
  RuleEnforcingFirestoreTestDriver,
} from '../server/persistenceAdapters';
import { isLegacySnapshotWriterDisabled } from '../server/migrationCutover';
import {
  PersistenceContractError,
  ProjectFirestoreDto,
} from '../services/persistenceContracts';
import { ProjectLibraryItem } from '../types/sowveil';

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getNestedField(record: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let current: unknown = record;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Deterministic transactional Admin SDK Firestore client simulator that implements
 * exact Firebase Admin SDK semantics:
 * - Atomic `.create()` throwing gRPC code 6 (`ALREADY_EXISTS`) when doc exists
 * - Optimistic concurrency control in `runTransaction` (read-before-write enforcement + version skew abort/retry)
 * - `.batch()` atomic commits
 * - `.where()`, `.orderBy()`, `.limit()` queries with optional simulated missing-index (`FAILED_PRECONDITION`)
 * - Configurable simulated failure modes (`disconnected`, `missing-iam`, `missing-index`, `probe-mismatch`)
 */
class TransactionalAdminSdkClientHarness implements AdminSdkFirestoreClientLike {
  private readonly store = new Map<
    string,
    Map<string, { data: Record<string, unknown>; version: number }>
  >();

  public failureMode:
    | 'none'
    | 'disconnected'
    | 'missing-iam'
    | 'missing-index'
    | 'probe-mismatch' = 'none';

  public missingIndexCollection: string | null = null;
  public transactionConflictOnceForDoc: string | null = null;

  private getCollectionMap(name: string) {
    let col = this.store.get(name);
    if (!col) {
      col = new Map();
      this.store.set(name, col);
    }
    return col;
  }

  private checkFailure(context: 'read' | 'write' | 'query', collectionName: string): void {
    if (this.failureMode === 'disconnected') {
      const err = new Error('14 UNAVAILABLE: failed to connect to all addresses') as Error & {
        code?: number;
      };
      err.code = 14;
      throw err;
    }
    if (this.failureMode === 'missing-iam') {
      const err = new Error(
        '7 PERMISSION_DENIED: Missing or insufficient permissions / Could not load the default credentials'
      ) as Error & { code?: number };
      err.code = 7;
      throw err;
    }
    if (
      context === 'query' &&
      (this.failureMode === 'missing-index' || this.missingIndexCollection === collectionName)
    ) {
      const err = new Error(
        `9 FAILED_PRECONDITION: The query on collection ${collectionName} requires an index.`
      ) as Error & { code?: number };
      err.code = 9;
      throw err;
    }
  }

  public hasDocument(collectionName: string, docId: string): boolean {
    return this.getCollectionMap(collectionName).has(docId);
  }

  public collection(collectionPath: string): AdminSdkCollectionReferenceLike {
    const self = this;
    const colMap = this.getCollectionMap(collectionPath);

    const buildQuery = (
      filters: Array<{ field: string; op: FirestoreFilterOp; value: unknown }>,
      orders: Array<{ field: string; dir: 'asc' | 'desc' }>,
      limitCount?: number
    ): AdminSdkQueryLike => ({
      where(fieldPath: string, opStr: FirestoreFilterOp, value: unknown) {
        return buildQuery([...filters, { field: fieldPath, op: opStr, value }], orders, limitCount);
      },
      orderBy(fieldPath: string, directionStr: 'asc' | 'desc' = 'asc') {
        return buildQuery(filters, [...orders, { field: fieldPath, dir: directionStr }], limitCount);
      },
      limit(n: number) {
        return buildQuery(filters, orders, n);
      },
      async get(): Promise<AdminSdkQuerySnapshotLike> {
        self.checkFailure('query', collectionPath);
        let entries = Array.from(colMap.entries()).map(([id, entry]) => ({
          id,
          data: deepClone(entry.data),
        }));

        for (const f of filters) {
          entries = entries.filter((item) => {
            const actual = getNestedField(item.data, f.field);
            switch (f.op) {
              case '==':
                return actual === f.value;
              case '!=':
                return actual !== f.value;
              case '<':
                return (actual as number | string) < (f.value as number | string);
              case '<=':
                return (actual as number | string) <= (f.value as number | string);
              case '>':
                return (actual as number | string) > (f.value as number | string);
              case '>=':
                return (actual as number | string) >= (f.value as number | string);
              case 'array-contains':
                return Array.isArray(actual) && actual.includes(f.value);
              case 'in':
                return Array.isArray(f.value) && f.value.includes(actual);
              default:
                return false;
            }
          });
        }

        if (orders.length > 0) {
          entries.sort((a, b) => {
            for (const o of orders) {
              const va = getNestedField(a.data, o.field) as number | string | undefined;
              const vb = getNestedField(b.data, o.field) as number | string | undefined;
              if (va === vb) continue;
              if (va === undefined) return o.dir === 'asc' ? -1 : 1;
              if (vb === undefined) return o.dir === 'asc' ? 1 : -1;
              const cmp = va < vb ? -1 : 1;
              return o.dir === 'asc' ? cmp : -cmp;
            }
            return 0;
          });
        }

        if (typeof limitCount === 'number' && limitCount >= 0) {
          entries = entries.slice(0, limitCount);
        }

        const docs = entries.map((e) => ({
          id: e.id,
          exists: true,
          data: () => deepClone(e.data),
        }));
        return {
          docs,
          empty: docs.length === 0,
          size: docs.length,
        };
      },
    });

    const baseQuery = buildQuery([], []);

    return {
      ...baseQuery,
      id: collectionPath,
      doc(docId: string): AdminSdkDocumentReferenceLike {
        return {
          id: docId,
          path: `${collectionPath}/${docId}`,
          async get(): Promise<AdminSdkDocumentSnapshotLike> {
            self.checkFailure('read', collectionPath);
            const existing = colMap.get(docId);
            if (!existing) {
              return { id: docId, exists: false, data: () => undefined };
            }
            const cloned = deepClone(existing.data);
            if (self.failureMode === 'probe-mismatch' && collectionPath === 'systemLocks') {
              cloned.probeToken = 'corrupted_token';
            }
            return { id: docId, exists: true, data: () => cloned };
          },
          async create(data: Record<string, unknown>): Promise<unknown> {
            self.checkFailure('write', collectionPath);
            if (colMap.has(docId)) {
              const err = new Error(
                `6 ALREADY_EXISTS: Document already exists: ${collectionPath}/${docId}`
              ) as Error & { code?: number };
              err.code = 6;
              throw err;
            }
            colMap.set(docId, { data: deepClone(data), version: 1 });
            return {};
          },
          async set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown> {
            self.checkFailure('write', collectionPath);
            const prev = colMap.get(docId);
            const nextData =
              options?.merge && prev
                ? { ...deepClone(prev.data), ...deepClone(data) }
                : deepClone(data);
            colMap.set(docId, {
              data: nextData,
              version: (prev?.version ?? 0) + 1,
            });
            return {};
          },
          async update(data: Record<string, unknown>): Promise<unknown> {
            self.checkFailure('write', collectionPath);
            const prev = colMap.get(docId);
            if (!prev) {
              const err = new Error(
                `5 NOT_FOUND: No document to update: ${collectionPath}/${docId}`
              ) as Error & { code?: number };
              err.code = 5;
              throw err;
            }
            colMap.set(docId, {
              data: { ...deepClone(prev.data), ...deepClone(data) },
              version: prev.version + 1,
            });
            return {};
          },
          async delete(): Promise<unknown> {
            self.checkFailure('write', collectionPath);
            colMap.delete(docId);
            return {};
          },
        };
      },
    };
  }

  public batch(): AdminSdkWriteBatchLike {
    const self = this;
    const ops: Array<() => void> = [];
    const batchObj: AdminSdkWriteBatchLike = {
      set(
        docRef: AdminSdkDocumentReferenceLike,
        data: Record<string, unknown>,
        options?: { merge?: boolean }
      ) {
        const [colName, docId] = docRef.path.split('/');
        ops.push(() => {
          self.checkFailure('write', colName);
          const colMap = self.getCollectionMap(colName);
          const prev = colMap.get(docId);
          const nextData =
            options?.merge && prev
              ? { ...deepClone(prev.data), ...deepClone(data) }
              : deepClone(data);
          colMap.set(docId, { data: nextData, version: (prev?.version ?? 0) + 1 });
        });
        return batchObj;
      },
      create(docRef: AdminSdkDocumentReferenceLike, data: Record<string, unknown>) {
        const [colName, docId] = docRef.path.split('/');
        ops.push(() => {
          self.checkFailure('write', colName);
          const colMap = self.getCollectionMap(colName);
          if (colMap.has(docId)) {
            const err = new Error(
              `6 ALREADY_EXISTS: Document already exists: ${docRef.path}`
            ) as Error & { code?: number };
            err.code = 6;
            throw err;
          }
          colMap.set(docId, { data: deepClone(data), version: 1 });
        });
        return batchObj;
      },
      update(docRef: AdminSdkDocumentReferenceLike, data: Record<string, unknown>) {
        const [colName, docId] = docRef.path.split('/');
        ops.push(() => {
          self.checkFailure('write', colName);
          const colMap = self.getCollectionMap(colName);
          const prev = colMap.get(docId);
          if (!prev) {
            const err = new Error(
              `5 NOT_FOUND: No document to update: ${docRef.path}`
            ) as Error & { code?: number };
            err.code = 5;
            throw err;
          }
          colMap.set(docId, {
            data: { ...deepClone(prev.data), ...deepClone(data) },
            version: prev.version + 1,
          });
        });
        return batchObj;
      },
      delete(docRef: AdminSdkDocumentReferenceLike) {
        const [colName, docId] = docRef.path.split('/');
        ops.push(() => {
          self.checkFailure('write', colName);
          self.getCollectionMap(colName).delete(docId);
        });
        return batchObj;
      },
      async commit(): Promise<unknown> {
        for (const op of ops) {
          op();
        }
        return {};
      },
    };
    return batchObj;
  }

  public async runTransaction<T>(
    updateFunction: (tx: AdminSdkTransactionLike) => Promise<T>
  ): Promise<T> {
    const self = this;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const readVersions = new Map<string, number>();
      const stagedWrites: Array<() => void> = [];
      let writeStarted = false;

      const tx: AdminSdkTransactionLike = {
        async get(docRef: AdminSdkDocumentReferenceLike): Promise<AdminSdkDocumentSnapshotLike> {
          if (writeStarted) {
            throw new Error(
              'Firestore transactions require all reads to be executed before all writes.'
            );
          }
          const [colName, docId] = docRef.path.split('/');
          self.checkFailure('read', colName);
          const colMap = self.getCollectionMap(colName);
          const entry = colMap.get(docId);
          readVersions.set(docRef.path, entry?.version ?? 0);
          if (!entry) {
            return { id: docId, exists: false, data: () => undefined };
          }
          return { id: docId, exists: true, data: () => deepClone(entry.data) };
        },
        create(docRef: AdminSdkDocumentReferenceLike, data: Record<string, unknown>) {
          writeStarted = true;
          const [colName, docId] = docRef.path.split('/');
          stagedWrites.push(() => {
            self.checkFailure('write', colName);
            const colMap = self.getCollectionMap(colName);
            if (colMap.has(docId)) {
              const err = new Error(
                `6 ALREADY_EXISTS: Document already exists: ${docRef.path}`
              ) as Error & { code?: number };
              err.code = 6;
              throw err;
            }
            colMap.set(docId, { data: deepClone(data), version: 1 });
          });
          return tx;
        },
        set(
          docRef: AdminSdkDocumentReferenceLike,
          data: Record<string, unknown>,
          options?: { merge?: boolean }
        ) {
          writeStarted = true;
          const [colName, docId] = docRef.path.split('/');
          stagedWrites.push(() => {
            self.checkFailure('write', colName);
            const colMap = self.getCollectionMap(colName);
            const prev = colMap.get(docId);
            const nextData =
              options?.merge && prev
                ? { ...deepClone(prev.data), ...deepClone(data) }
                : deepClone(data);
            colMap.set(docId, { data: nextData, version: (prev?.version ?? 0) + 1 });
          });
          return tx;
        },
        update(docRef: AdminSdkDocumentReferenceLike, data: Record<string, unknown>) {
          writeStarted = true;
          const [colName, docId] = docRef.path.split('/');
          stagedWrites.push(() => {
            self.checkFailure('write', colName);
            const colMap = self.getCollectionMap(colName);
            const prev = colMap.get(docId);
            if (!prev) {
              const err = new Error(
                `5 NOT_FOUND: No document to update: ${docRef.path}`
              ) as Error & { code?: number };
              err.code = 5;
              throw err;
            }
            colMap.set(docId, {
              data: { ...deepClone(prev.data), ...deepClone(data) },
              version: prev.version + 1,
            });
          });
          return tx;
        },
        delete(docRef: AdminSdkDocumentReferenceLike) {
          writeStarted = true;
          const [colName, docId] = docRef.path.split('/');
          stagedWrites.push(() => {
            self.checkFailure('write', colName);
            self.getCollectionMap(colName).delete(docId);
          });
          return tx;
        },
      };

      const result = await updateFunction(tx);

      // Simulate concurrent version modification if configured
      if (self.transactionConflictOnceForDoc) {
        const targetPath = self.transactionConflictOnceForDoc;
        self.transactionConflictOnceForDoc = null;
        const [cName, dId] = targetPath.split('/');
        const existing = self.getCollectionMap(cName).get(dId);
        if (existing) {
          existing.version += 1;
        }
      }

      // Verify optimistic concurrency on all read documents
      let conflicted = false;
      for (const [docPath, expectedVer] of readVersions.entries()) {
        const [cName, dId] = docPath.split('/');
        const currentVer = self.getCollectionMap(cName).get(dId)?.version ?? 0;
        if (currentVer !== expectedVer) {
          conflicted = true;
          break;
        }
      }

      if (conflicted) {
        if (attempt === maxAttempts) {
          const err = new Error(
            '10 ABORTED: Transaction lock contention / version mismatch'
          ) as Error & { code?: number };
          err.code = 10;
          throw err;
        }
        continue;
      }

      for (const writeOp of stagedWrites) {
        writeOp();
      }
      return result;
    }

    throw new Error('Transaction failed after max retries');
  }
}

describe('Prompt F1: Real Server-Side FirestoreDocumentDriver & Production Readiness Gates', () => {
  it('1. AuthoritativeFirestorePersistenceAdapter requires an injected driver and rejects missing driver', () => {
    assert.throws(
      () =>
        // @ts-expect-error testing missing driver runtime check
        new AuthoritativeFirestorePersistenceAdapter({}),
      (err: unknown) =>
        err instanceof PersistenceContractError &&
        err.code === 'PRODUCTION_DURABLE_ADAPTER_REQUIRED'
    );
  });

  it('2. FirestoreDocumentDriver implements get, atomic create-if-absent, set, atomic update, delete, list, query, batchWrite, and runTransaction with schema validation', async () => {
    const clientHarness = new TransactionalAdminSdkClientHarness();
    const driver = new FirestoreDocumentDriver({
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      firestoreClient: clientHarness,
    });

    const adapter = new AuthoritativeFirestorePersistenceAdapter({
      driver,
      nodeEnv: 'production',
    });

    // Verify readiness probe runs a real read/write/cleanup cycle
    const readiness = await adapter.checkProductionReadinessAsync();
    assert.equal(readiness.readyForProductionTraffic, true);
    assert.equal(readiness.status, 'ready');
    assert.equal(readiness.readWriteProbeVerified, true);
    assert.equal(readiness.requiredCollectionsVerified, true);
    assert.equal(readiness.configuredProjectId, CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID);
    assert.equal(readiness.configuredDatabaseId, CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID);

    // Confirm healthProbe document was cleaned up from systemLocks
    const remainingLocks = await driver.listCollection('systemLocks');
    assert.equal(remainingLocks.length, 0);

    // 2a. Atomic createDocumentIfAbsent via projects.create
    const projectA: ProjectLibraryItem = {
      id: 'proj_f1_atomic_1',
      ownerUid: 'user_alice',
      title: 'Atomic Firestore Project',
      description: 'Created via FirestoreDocumentDriver',
      compCount: 2,
      projectFileStatus: 'sowveil-native',
      fileSizeBytes: 8192,
      fileSizeLabel: '8.0 KB',
      revision: 1,
      activeBranch: 'main',
      hasExternalFootageWarning: false,
      archived: false,
      tags: ['firestore', 'f1'],
      createdAt: '2026-10-30T10:00:00.000Z',
      updatedAt: '2026-10-30T10:00:00.000Z',
    };

    const created = await adapter.projects.create(projectA);
    assert.equal(created.id, 'proj_f1_atomic_1');
    assert.equal(created.revision, 1);

    // Duplicate createDocumentIfAbsent must fail atomically with ENTITY_ALREADY_EXISTS
    await assert.rejects(
      () => adapter.projects.create(projectA),
      (err: unknown) =>
        err instanceof PersistenceContractError && err.code === 'ENTITY_ALREADY_EXISTS'
    );

    // 2b. Atomic updateDocument with owner & revision checks
    const currentDto = await driver.getDocument<ProjectFirestoreDto>(
      'projects',
      'proj_f1_atomic_1'
    );
    assert.ok(currentDto);

    const updatedDto = await driver.updateDocument<ProjectFirestoreDto>(
      'projects',
      'proj_f1_atomic_1',
      {
        ...currentDto,
        title: 'Atomic Firestore Project v2',
        revision: 2,
        updatedAt: '2026-10-30T10:05:00.000Z',
      },
      {
        expectedOwnerUid: 'user_alice',
        expectedRevision: 1,
      }
    );
    assert.equal(updatedDto.revision, 2);
    assert.equal(updatedDto.title, 'Atomic Firestore Project v2');

    // Stale revision update must fail with STALE_REVISION_CONFLICT
    await assert.rejects(
      () =>
        driver.updateDocument<ProjectFirestoreDto>(
          'projects',
          'proj_f1_atomic_1',
          {
            ...updatedDto,
            title: 'Stale Write Attempt',
            revision: 2,
          },
          {
            expectedOwnerUid: 'user_alice',
            expectedRevision: 1,
          }
        ),
      (err: unknown) =>
        err instanceof PersistenceContractError && err.code === 'REVISION_CONFLICT'
    );

    // Wrong owner update must fail with CROSS_USER_ACCESS_FORBIDDEN
    await assert.rejects(
      () =>
        driver.updateDocument<ProjectFirestoreDto>(
          'projects',
          'proj_f1_atomic_1',
          {
            ...updatedDto,
            title: 'Cross User Tamper Attempt',
            revision: 3,
          },
          {
            expectedOwnerUid: 'user_mallory',
            expectedRevision: 2,
          }
        ),
      (err: unknown) =>
        err instanceof PersistenceContractError && err.code === 'CROSS_USER_ACCESS_FORBIDDEN'
    );

    // 2c. Batch writes & queryDocuments (where + orderBy + limit)
    const baseDto = await driver.getDocument<ProjectFirestoreDto>('projects', 'proj_f1_atomic_1');
    assert.ok(baseDto);
    await driver.batchWrite([
      {
        type: 'create',
        collectionPath: 'projects',
        docId: 'proj_f1_batch_2',
        data: {
          ...baseDto,
          id: 'proj_f1_batch_2',
          ownerUid: 'user_alice',
          title: 'Batch Project 2',
          revision: 1,
          updatedAt: '2026-10-30T10:10:00.000Z',
        },
      },
      {
        type: 'create',
        collectionPath: 'projects',
        docId: 'proj_f1_batch_3',
        data: {
          ...baseDto,
          id: 'proj_f1_batch_3',
          ownerUid: 'user_bob',
          title: 'Bob Project 3',
          revision: 1,
          updatedAt: '2026-10-30T10:15:00.000Z',
        },
      },
    ]);

    const aliceProjects = await driver.queryDocuments<ProjectFirestoreDto>('projects', {
      where: [{ field: 'ownerUid', op: '==', value: 'user_alice' }],
      orderBy: [{ field: 'updatedAt', direction: 'desc' }],
      limit: 10,
    });
    assert.equal(aliceProjects.length, 2);
    assert.equal(aliceProjects[0].id, 'proj_f1_batch_2');
    assert.equal(aliceProjects[1].id, 'proj_f1_atomic_1');

    // 2d. Transaction retry on concurrent version skew
    clientHarness.transactionConflictOnceForDoc = 'projects/proj_f1_atomic_1';
    const txSaved = await adapter.projects.update(
      'proj_f1_atomic_1',
      'user_alice',
      {
        title: 'Transaction Retried Successfully',
        updatedAt: '2026-10-30T10:20:00.000Z',
      },
      { expectedRevision: 2 }
    );
    assert.equal(txSaved.revision, 3);
    assert.equal(txSaved.title, 'Transaction Retried Successfully');

    // 2e. Schema validation before writes blocks forbidden fields & invalid document IDs
    await assert.rejects(
      () => driver.setDocument('projects', 'invalid/slash/id', baseDto),
      (err: unknown) =>
        err instanceof PersistenceContractError && err.code === 'INVALID_DTO_PAYLOAD'
    );

    await assert.rejects(
      () =>
        driver.setDocument('providerConnections', 'conn_bad_secret', {
          id: 'conn_bad_secret',
          ownerUid: 'user_alice',
          encryptedCredential: { ciphertextBase64: 'leaked' },
        }),
      (err: unknown) =>
        err instanceof PersistenceContractError &&
        err.code === 'VAULT_SECRET_IN_PUBLIC_DTO_FORBIDDEN'
    );
  });

  it('3. Readiness rejects test drivers, disconnected clients, missing IAM/ADC, wrong database ID, and missing required indexes', async () => {
    // 3a. Rejects RuleEnforcingFirestoreTestDriver
    const testDriverAdapter = new AuthoritativeFirestorePersistenceAdapter({
      driver: new RuleEnforcingFirestoreTestDriver(),
      nodeEnv: 'production',
    });
    const testDriverReport = await testDriverAdapter.checkProductionReadinessAsync();
    assert.equal(testDriverReport.readyForProductionTraffic, false);
    assert.equal(testDriverReport.status, 'blocked');
    assert.equal(testDriverReport.blockerCode, 'PRODUCTION_DURABLE_ADAPTER_REQUIRED');

    // 3b. Rejects wrong database ID
    const wrongDbHarness = new TransactionalAdminSdkClientHarness();
    const wrongDbDriver = new FirestoreDocumentDriver({
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: 'wrong-database-id',
      expectedDatabaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      firestoreClient: wrongDbHarness,
    });
    const wrongDbAdapter = new AuthoritativeFirestorePersistenceAdapter({
      driver: wrongDbDriver,
      nodeEnv: 'production',
      expectedDatabaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
    });
    const wrongDbReport = await wrongDbAdapter.checkProductionReadinessAsync();
    assert.equal(wrongDbReport.readyForProductionTraffic, false);
    assert.equal(wrongDbReport.blockerCode, 'PRODUCTION_DURABLE_ADAPTER_REQUIRED');
    assert.match(wrongDbReport.blockerMessage || '', /Database identity mismatch/i);

    // 3c. Rejects disconnected client
    const disconnectedHarness = new TransactionalAdminSdkClientHarness();
    disconnectedHarness.failureMode = 'disconnected';
    const disconnectedDriver = new FirestoreDocumentDriver({
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      firestoreClient: disconnectedHarness,
    });
    const disconnectedAdapter = new AuthoritativeFirestorePersistenceAdapter({
      driver: disconnectedDriver,
      nodeEnv: 'production',
    });
    const disconnectedReport = await disconnectedAdapter.checkProductionReadinessAsync();
    assert.equal(disconnectedReport.readyForProductionTraffic, false);
    assert.equal(disconnectedReport.blockerCode, 'PRODUCTION_DURABLE_ADAPTER_REQUIRED');

    // 3d. Rejects missing IAM / ADC credentials
    const missingIamHarness = new TransactionalAdminSdkClientHarness();
    missingIamHarness.failureMode = 'missing-iam';
    const missingIamDriver = new FirestoreDocumentDriver({
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      firestoreClient: missingIamHarness,
    });
    const missingIamProbe = await missingIamDriver.verifyConnectivity();
    assert.equal(missingIamProbe.connected, false);
    assert.equal(missingIamProbe.failureReason, 'ADC_OR_IAM_MISSING');

    // 3e. Rejects missing required collection / index
    const missingIndexHarness = new TransactionalAdminSdkClientHarness();
    missingIndexHarness.missingIndexCollection = 'catalogItems';
    const missingIndexDriver = new FirestoreDocumentDriver({
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      firestoreClient: missingIndexHarness,
    });
    const missingIndexProbe = await missingIndexDriver.verifyConnectivity();
    assert.equal(missingIndexProbe.connected, false);
    assert.equal(missingIndexProbe.failureReason, 'MISSING_REQUIRED_COLLECTION_OR_INDEX');
  });

  it('4. Production startup (initializeServerPersistenceAdapterFromEnv) fails closed when real Firestore driver is unavailable, and LocalSnapshotPersistenceAdapter is never production-ready', async () => {
    // LocalSnapshotPersistenceAdapter must NEVER report readyForProductionTraffic=true even if allowSharedFilesystemInProd=true
    const localSnap = new LocalSnapshotPersistenceAdapter({
      nodeEnv: 'production',
      allowSharedFilesystemInProd: true,
      refuseUnreadyProductionStartup: false,
    });
    const localReport = localSnap.getReadinessReport();
    assert.equal(localReport.readyForProductionTraffic, false);
    assert.equal(localReport.isDevelopmentOrTestOnly, true);

    // Production startup with disconnected Firestore client fails closed
    const badHarness = new TransactionalAdminSdkClientHarness();
    badHarness.failureMode = 'missing-iam';
    await assert.rejects(
      () =>
        initializeServerPersistenceAdapterFromEnv({
          nodeEnv: 'production',
          firestoreClient: badHarness,
          refuseUnreadyProductionStartup: true,
        }),
      (err: unknown) =>
        err instanceof PersistenceContractError &&
        err.code === 'PRODUCTION_DURABLE_ADAPTER_REQUIRED'
    );

    // Production startup with healthy Firestore client succeeds
    const goodHarness = new TransactionalAdminSdkClientHarness();
    const { adapter, readiness } = await initializeServerPersistenceAdapterFromEnv({
      nodeEnv: 'production',
      firestoreClient: goodHarness,
      refuseUnreadyProductionStartup: true,
    });
    assert.equal(adapter.adapterKind, 'cloud-firestore-authoritative');
    assert.equal(readiness.readyForProductionTraffic, true);
    assert.equal(readiness.readWriteProbeVerified, true);

    // Development mode defaults cleanly to LocalSnapshotPersistenceAdapter when Firestore is not forced
    const devInit = await initializeServerPersistenceAdapterFromEnv({
      nodeEnv: 'development',
      snapshotFilePath: null,
    });
    assert.equal(devInit.adapter.adapterKind, 'local-json-snapshot-dev-only');
  });

  it('5. Enforces server-side owner/auth checks on Express routes backed by FirestoreDocumentDriver and exposes sanitized diagnostics without secrets', async () => {
    const clientHarness = new TransactionalAdminSdkClientHarness();
    const driver = new FirestoreDocumentDriver({
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
      firestoreClient: clientHarness,
    });
    const adapter = new AuthoritativeFirestorePersistenceAdapter({
      driver,
      nodeEnv: 'production',
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-f1-api-test-'));
    const snapPath = path.join(tmpDir, 'sowveil-durable-store.json');

    const app = createApiApp({
      nodeEnv: 'production',
      persistenceFilePath: snapPath,
      persistenceAdapter: adapter,
      tokenVerifier: async (token: string) => {
        if (token.startsWith('dev-token:')) {
          const [, uid, email] = token.split(':');
          return {
            uid: uid || 'user_test',
            email: email || 'test@example.com',
            emailVerified: true,
          };
        }
        throw new Error('Invalid token');
      },
    });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 5a. /api/v1/ready performs real async probe and returns 200
      const readyRes = await fetch(`${baseUrl}/api/v1/ready`);
      assert.equal(readyRes.status, 200);
      const readyJson = (await readyRes.json()) as {
        ok: boolean;
        data: {
          readyForProductionTraffic: boolean;
          persistenceReadiness: {
            readWriteProbeVerified: boolean;
            requiredCollectionsVerified: boolean;
            configuredProjectId: string;
            configuredDatabaseId: string;
          };
        };
      };
      assert.equal(readyJson.ok, true);
      assert.equal(readyJson.data.readyForProductionTraffic, true);
      assert.equal(readyJson.data.persistenceReadiness.readWriteProbeVerified, true);
      assert.equal(readyJson.data.persistenceReadiness.requiredCollectionsVerified, true);
      assert.equal(
        readyJson.data.persistenceReadiness.configuredProjectId,
        CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID
      );
      assert.equal(
        readyJson.data.persistenceReadiness.configuredDatabaseId,
        CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID
      );

      // 5b. /api/v1/diagnostics/persistence exposes sanitized driverDiagnostics without secrets
      const diagRes = await fetch(`${baseUrl}/api/v1/diagnostics/persistence`);
      assert.equal(diagRes.status, 200);
      const diagJson = (await diagRes.json()) as {
        ok: boolean;
        data: {
          driverDiagnostics: {
            projectId: string;
            databaseId: string;
            credentialsExposed: boolean;
            lastHealthProbePassed: boolean;
          };
        };
      };
      assert.equal(diagJson.ok, true);
      assert.equal(diagJson.data.driverDiagnostics.projectId, CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID);
      assert.equal(diagJson.data.driverDiagnostics.databaseId, CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID);
      assert.equal(diagJson.data.driverDiagnostics.credentialsExposed, false);
      assert.equal(diagJson.data.driverDiagnostics.lastHealthProbePassed, true);

      // 5c. Server-side authorization: Alice creates a project, Bob is forbidden from reading or modifying it
      const aliceToken = 'dev-token:user_alice:alice@example.com';
      const bobToken = 'dev-token:user_bob:bob@example.com';

      const createRes = await fetch(`${baseUrl}/api/v1/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aliceToken}`,
        },
        body: JSON.stringify({
          id: 'proj_f1_alice_private',
          title: 'Alice Private Firestore Project',
          description: 'Stored in FirestoreDocumentDriver',
        }),
      });
      assert.equal(createRes.status, 201);

      // Bob cannot read Alice's project
      const bobGetRes = await fetch(`${baseUrl}/api/v1/projects/proj_f1_alice_private`, {
        headers: { Authorization: `Bearer ${bobToken}` },
      });
      assert.equal(bobGetRes.status, 403);

      // Bob cannot update Alice's project
      const bobPatchRes = await fetch(`${baseUrl}/api/v1/projects/proj_f1_alice_private`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bobToken}`,
        },
        body: JSON.stringify({
          title: 'Bob Hijack Attempt',
          expectedRevision: 1,
        }),
      });
      assert.equal(bobPatchRes.status, 403);

      // Legacy snapshot writers remain enabled (Prompt F1 constraint)
      assert.equal(isLegacySnapshotWriterDisabled(), false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
