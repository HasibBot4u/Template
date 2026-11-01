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
  BoundedOwnerScopedCache,
} from '../server/persistenceAdapters';
import { FirestoreWorkspaceRepository } from '../repositories/workspaceRepository';

process.env.SOWVEIL_MASTER_VAULT_KEY =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

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
 * Shared transactional Admin SDK Firestore harness supporting multiple independent
 * Express server instances over a single authoritative Firestore database.
 */
class SharedAdminFirestoreHarness implements AdminSdkFirestoreClientLike {
  private readonly store = new Map<
    string,
    Map<string, { data: Record<string, unknown>; version: number }>
  >();

  private getCollectionMap(name: string) {
    let col = this.store.get(name);
    if (!col) {
      col = new Map();
      this.store.set(name, col);
    }
    return col;
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
            const existing = colMap.get(docId);
            if (!existing) {
              return { id: docId, exists: false, data: () => undefined };
            }
            return { id: docId, exists: true, data: () => deepClone(existing.data) };
          },
          async create(data: Record<string, unknown>): Promise<unknown> {
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
          self.getCollectionMap(colName).delete(docId);
        });
        return tx;
      },
    };

    const result = await updateFunction(tx);
    for (const writeOp of stagedWrites) {
      writeOp();
    }
    return result;
  }
}

async function startTestServer(app: ReturnType<typeof createApiApp>): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function requestJson(
  baseUrl: string,
  method: string,
  urlPath: string,
  options: {
    token?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {};
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

const TOKENS = {
  owner: 'tok_owner_f2',
  alice: 'tok_alice_f2',
  bob: 'tok_bob_f2',
};

const tokenVerifier = async (token: string) => {
  if (token === TOKENS.owner) {
    return {
      uid: 'uid_owner_f2',
      email: 'owner-f2@sowveil.studio',
      emailVerified: true,
    };
  }
  if (token === TOKENS.alice) {
    return {
      uid: 'uid_alice_f2',
      email: 'alice-f2@sowveil.studio',
      emailVerified: true,
    };
  }
  if (token === TOKENS.bob) {
    return {
      uid: 'uid_bob_f2',
      email: 'bob-f2@sowveil.studio',
      emailVerified: true,
    };
  }
  throw new Error('Invalid token');
};

describe('PROMPT F2 — Server Repository Cutover Without Data Migration', () => {
  it('1. BoundedOwnerScopedCache enforces ownerUid-prefixed keys, invalidates on write/delete, and never masks persistence on cache failure', () => {
    const cache = new BoundedOwnerScopedCache<{ id: string; title: string }>(3);

    assert.throws(
      () => BoundedOwnerScopedCache.buildKey('', 'proj_1'),
      /requires non-empty ownerUid/
    );
    assert.equal(cache.set('', 'proj_1', { id: 'proj_1', title: 'Bad' }), false);

    assert.equal(BoundedOwnerScopedCache.buildKey('uid_alice', 'proj_1'), 'uid_alice:proj_1');
    const k1 = cache.set('uid_alice', 'proj_1', { id: 'proj_1', title: 'P1' });
    assert.equal(k1, true);
    assert.deepEqual(cache.get('uid_alice', 'proj_1'), { id: 'proj_1', title: 'P1' });
    assert.equal(cache.get('uid_bob', 'proj_1'), null);

    cache.invalidate('uid_alice', 'proj_1');
    assert.equal(cache.get('uid_alice', 'proj_1'), null);

    // Simulated cache failure returns null on get and false on set without throwing
    cache.setSimulateCacheFailure(true);
    assert.equal(cache.set('uid_alice', 'proj_2', { id: 'proj_2', title: 'P2' }), false);
    assert.equal(cache.get('uid_alice', 'proj_2'), null);
    cache.setSimulateCacheFailure(false);
  });

  it('2. Does NOT auto-migrate or overwrite .data/sowveil-durable-store.json when AuthoritativeFirestorePersistenceAdapter is active', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-f2-nomigrate-'));
    const legacySnapshotPath = path.join(tmpDir, 'sowveil-durable-store.json');
    const legacyContent = JSON.stringify(
      {
        version: 1,
        savedAt: '2026-01-01T00:00:00.000Z',
        projects: [
          {
            id: 'legacy_only_proj_999',
            ownerUid: 'uid_alice_f2',
            title: 'Legacy Unmigrated Project',
            description: 'Must not be auto-imported in F2',
            compCount: 1,
            projectFileStatus: 'metadata-only',
            fileSizeBytes: 100,
            fileSizeLabel: '100 B',
            hasExternalFootageWarning: false,
            archived: false,
            tags: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      null,
      2
    );
    fs.writeFileSync(legacySnapshotPath, legacyContent, 'utf8');

    const harness = new SharedAdminFirestoreHarness();
    const driver = new FirestoreDocumentDriver({
      firestoreClient: harness,
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
    });
    const adapter = new AuthoritativeFirestorePersistenceAdapter({ driver });

    const app = createApiApp({
      tokenVerifier,
      persistenceFilePath: legacySnapshotPath,
      persistenceAdapter: adapter,
    });
    const srv = await startTestServer(app);

    try {
      // Alice lists projects -> legacy_only_proj_999 must NOT be auto-imported
      const listRes = await requestJson(srv.baseUrl, 'GET', '/api/v1/projects', {
        token: TOKENS.alice,
      });
      assert.equal(listRes.status, 200);
      assert.equal(
        listRes.json.data.items.some((p: any) => p.id === 'legacy_only_proj_999'),
        false
      );

      // Alice creates a new project -> written to Firestore, legacy snapshot file remains untouched
      const createRes = await requestJson(srv.baseUrl, 'POST', '/api/v1/projects', {
        token: TOKENS.alice,
        body: {
          id: 'proj_firestore_only_1',
          title: 'Firestore Cutover Project',
          description: 'Stored in authoritative Firestore',
        },
      });
      assert.equal(createRes.status, 201);
      assert.equal(harness.hasDocument('projects', 'proj_firestore_only_1'), true);

      const snapshotAfter = fs.readFileSync(legacySnapshotPath, 'utf8');
      assert.equal(snapshotAfter, legacyContent);
    } finally {
      await srv.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('3. Multi-instance cutover across all 10 domain repositories (Projects, AI Director, Reference Lab, Template Factory, Catalog/Variants, Providers, Routing/Extensions, Render Jobs, Roles/Governance, and Browser WorkspaceRepository)', async () => {
    process.env.OWNER_BOOTSTRAP_EMAIL = 'owner-f2@sowveil.studio';
    process.env.OWNER_BOOTSTRAP_SECRET = 'f2-bootstrap-secret-9876543210-secure';

    const harness = new SharedAdminFirestoreHarness();
    const driver = new FirestoreDocumentDriver({
      firestoreClient: harness,
      projectId: CANONICAL_PRODUCTION_FIREBASE_PROJECT_ID,
      databaseId: CANONICAL_PRODUCTION_FIRESTORE_DATABASE_ID,
    });

    // Two separate adapter & Express app instances sharing the same Firestore database
    const adapterA = new AuthoritativeFirestorePersistenceAdapter({ driver });
    const adapterB = new AuthoritativeFirestorePersistenceAdapter({ driver });

    const appA = createApiApp({
      tokenVerifier,
      persistenceFilePath: null,
      persistenceAdapter: adapterA,
    });
    const appB = createApiApp({
      tokenVerifier,
      persistenceFilePath: null,
      persistenceAdapter: adapterB,
    });

    const srvA = await startTestServer(appA);
    const srvB = await startTestServer(appB);

    try {
      // --- A. GOVERNANCE, ROLES, PREFERENCES, FAVORITES & AUDIT EVENTS ---
      const bootRes = await requestJson(srvA.baseUrl, 'POST', '/api/v1/admin/bootstrap-owner', {
        token: TOKENS.owner,
        body: { bootstrapSecret: 'f2-bootstrap-secret-9876543210-secure' },
      });
      assert.equal(bootRes.status, 200);
      assert.equal(bootRes.json.data.role, 'owner');

      // Instance B immediately recognizes owner role from Firestore
      const meOwnerB = await requestJson(srvB.baseUrl, 'GET', '/api/v1/me', {
        token: TOKENS.owner,
      });
      assert.equal(meOwnerB.status, 200);
      assert.equal(meOwnerB.json.data.role, 'owner');

      // Preferences written on A, read on B
      const prefPatchA = await requestJson(srvA.baseUrl, 'PATCH', '/api/v1/me/preferences', {
        token: TOKENS.alice,
        body: { reducedMotion: true, defaultSortOrder: 'favorites' },
      });
      assert.equal(prefPatchA.status, 200);
      assert.equal(prefPatchA.json.data.reducedMotion, true);

      const prefGetB = await requestJson(srvB.baseUrl, 'GET', '/api/v1/me/preferences', {
        token: TOKENS.alice,
      });
      assert.equal(prefGetB.status, 200);
      assert.equal(prefGetB.json.data.reducedMotion, true);
      assert.equal(prefGetB.json.data.defaultSortOrder, 'favorites');

      // Favorites written on A, read & removed on B
      const favAddA = await requestJson(
        srvA.baseUrl,
        'PUT',
        '/api/v1/me/favorites/ta-rise-up',
        { token: TOKENS.alice }
      );
      assert.equal(favAddA.status, 200);
      assert.equal(favAddA.json.data.items.includes('ta-rise-up'), true);

      const favGetB = await requestJson(srvB.baseUrl, 'GET', '/api/v1/me/favorites', {
        token: TOKENS.alice,
      });
      assert.equal(favGetB.status, 200);
      assert.deepEqual(favGetB.json.data.items, ['ta-rise-up']);

      // --- B. PROJECTS & EDITOR COMMANDS WITH OPTIMISTIC CONCURRENCY & PAGINATION ---
      for (let i = 1; i <= 3; i++) {
        const res = await requestJson(srvA.baseUrl, 'POST', '/api/v1/projects', {
          token: TOKENS.alice,
          body: {
            id: `proj_f2_alice_${i}`,
            title: `Alice Project ${i}`,
            description: `Description ${i}`,
            projectFileStatus: 'sowveil-native',
          },
        });
        assert.equal(res.status, 201);
        assert.equal(res.json.data.id, `proj_f2_alice_${i}`);
        assert.equal(res.json.data.revision, 1);
      }

      // Paginated list on instance B
      const page1B = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/projects?limit=2&offset=0',
        { token: TOKENS.alice }
      );
      assert.equal(page1B.status, 200);
      assert.equal(page1B.json.data.items.length, 2);
      assert.equal(page1B.json.data.total, 3);
      assert.equal(page1B.json.data.hasMore, true);

      // Cross-user access denied on instance B
      const bobReadAlice = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/projects/proj_f2_alice_1',
        { token: TOKENS.bob }
      );
      assert.equal(bobReadAlice.status, 403);

      // Update on instance B with expectedRevision: 1 -> revision 2
      const patchB = await requestJson(
        srvB.baseUrl,
        'PATCH',
        '/api/v1/projects/proj_f2_alice_1',
        {
          token: TOKENS.alice,
          body: {
            title: 'Alice Project 1 Updated on B',
            expectedRevision: 1,
          },
        }
      );
      assert.equal(patchB.status, 200);
      assert.equal(patchB.json.data.revision, 2);

      // Stale revision on instance A (expectedRevision: 1) -> 409 REVISION_CONFLICT
      const stalePatchA = await requestJson(
        srvA.baseUrl,
        'PATCH',
        '/api/v1/projects/proj_f2_alice_1',
        {
          token: TOKENS.alice,
          body: {
            title: 'Stale Overwrite Attempt',
            expectedRevision: 1,
          },
        }
      );
      assert.equal(stalePatchA.status, 409);
      assert.equal(stalePatchA.json.error.code, 'REVISION_CONFLICT');

      // Instance A reads fresh revision 2 from Firestore on cache invalidation / read
      const getFreshA = await requestJson(
        srvA.baseUrl,
        'GET',
        '/api/v1/projects/proj_f2_alice_1',
        { token: TOKENS.alice }
      );
      assert.equal(getFreshA.status, 200);
      assert.equal(getFreshA.json.data.revision, 2);
      assert.equal(getFreshA.json.data.title, 'Alice Project 1 Updated on B');

      // Editor command on instance B mutates canonical project and increments revision to 3
      const cmdB = await requestJson(srvB.baseUrl, 'POST', '/api/v1/editor/command', {
        token: TOKENS.alice,
        body: {
          project: JSON.parse(getFreshA.json.data.canonicalProjectJson),
          command: {
            commandId: 'cmd_f2_add_marker_1',
            type: 'ADD_MARKER',
            actorType: 'user',
            actorId: 'uid_alice_f2',
            expectedRevision: 2,
            timestamp: new Date().toISOString(),
            payload: {
              label: 'Cutover Beat 1',
              timeSec: 1.5,
              colorHex: '#10b981',
            },
          },
        },
      });
      assert.equal(cmdB.status, 200);
      assert.equal(cmdB.json.data.project.revision, 3);

      // --- C. AI DIRECTOR SESSIONS ---
      const aiCreateA = await requestJson(
        srvA.baseUrl,
        'POST',
        '/api/v1/ai-director/sessions',
        {
          token: TOKENS.alice,
          body: {
            title: 'F2 Launch Trailer Script',
            scriptText:
              'Scene 1: Open on dark glass interface.\n\nScene 2: Reveal kinetic typography.',
            autonomyMode: 'supervised',
          },
        }
      );
      assert.equal(aiCreateA.status, 201);
      const aiSessionId = aiCreateA.json.data.session.id;

      const aiListB = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/ai-director/sessions?limit=10&offset=0',
        { token: TOKENS.alice }
      );
      assert.equal(aiListB.status, 200);
      assert.equal(aiListB.json.data.items.some((s: any) => s.id === aiSessionId), true);

      const firstQuestionId = aiCreateA.json.data.session.questions?.[0]?.id;
      if (firstQuestionId) {
        const aiAnswerB = await requestJson(
          srvB.baseUrl,
          'POST',
          `/api/v1/ai-director/sessions/${aiSessionId}/questions`,
          {
            token: TOKENS.alice,
            body: {
              questionId: firstQuestionId,
              selectedOption: aiCreateA.json.data.session.questions[0].options[0],
            },
          }
        );
        assert.equal(aiAnswerB.status, 200);
      }

      // --- D. REFERENCE LAB SESSIONS ---
      const refCreateA = await requestJson(
        srvA.baseUrl,
        'POST',
        '/api/v1/reference-lab/sessions',
        {
          token: TOKENS.alice,
          body: {
            title: 'F2 Reference Reconstruction',
            usageMode: 'authorized-reconstruction',
            sourceKind: 'uploaded-video',
            durationSec: 6,
            fps: 30,
            width: 1920,
            height: 1080,
          },
        }
      );
      assert.equal(refCreateA.status, 201);
      const refSessionId = refCreateA.json.data.session.id;

      const refSaveB = await requestJson(
        srvB.baseUrl,
        'POST',
        `/api/v1/reference-lab/sessions/${refSessionId}/save-project`,
        {
          token: TOKENS.alice,
          body: {},
        }
      );
      assert.equal(refSaveB.status, 201);
      const savedRefProjId = refSaveB.json.data.project.id;
      assert.ok(savedRefProjId);

      const getRefProjA = await requestJson(
        srvA.baseUrl,
        'GET',
        `/api/v1/projects/${savedRefProjId}`,
        { token: TOKENS.alice }
      );
      assert.equal(getRefProjA.status, 200);
      assert.equal(getRefProjA.json.data.id, savedRefProjId);

      // --- E. TEMPLATE FACTORY DRAFTS, PUBLISH & PREFERENCE LEARNING ---
      const tfCreateA = await requestJson(
        srvA.baseUrl,
        'POST',
        '/api/v1/template-factory/drafts',
        {
          token: TOKENS.alice,
          body: {
            title: 'F2 Kinetic Title Card',
            moduleId: 'text-animation',
            description: 'Kinetic title card template',
            licenseType: 'Sowveil Original',
          },
        }
      );
      assert.equal(tfCreateA.status, 201);
      const draftId = tfCreateA.json.data.draft.id;

      const tfPublishB = await requestJson(
        srvB.baseUrl,
        'POST',
        `/api/v1/template-factory/drafts/${draftId}/publish`,
        {
          token: TOKENS.alice,
          body: { explicitUserConfirmation: true },
        }
      );
      assert.equal(tfPublishB.status, 200);
      const publishedItemId = tfPublishB.json.data.catalogItem.id;

      const catGetA = await requestJson(
        srvA.baseUrl,
        'GET',
        `/api/v1/catalog/${publishedItemId}`,
        { token: TOKENS.alice }
      );
      assert.equal(catGetA.status, 200);
      assert.equal(catGetA.json.data.id, publishedItemId);

      // Preference consent & signal on A -> rankings on B
      const consentA = await requestJson(
        srvA.baseUrl,
        'POST',
        '/api/v1/template-factory/feedback/consent',
        {
          token: TOKENS.alice,
          body: { consentToPreferenceRanking: true },
        }
      );
      assert.equal(consentA.status, 200);

      const sigA = await requestJson(
        srvA.baseUrl,
        'POST',
        '/api/v1/template-factory/feedback/signal',
        {
          token: TOKENS.alice,
          body: {
            templateId: 'ta-rise-up',
            action: 'approve',
            moduleId: 'text-animation',
          },
        }
      );
      assert.equal(sigA.status, 200);

      const rankingsB = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/template-factory/rankings?moduleId=text-animation',
        { token: TOKENS.alice }
      );
      assert.equal(rankingsB.status, 200);
      assert.equal(
        rankingsB.json.data.preferenceConsent.consentToPreferenceRanking,
        true
      );

      // --- F. TEMPLATE VARIANTS & CATALOG FORK ---
      const varCreateA = await requestJson(
        srvA.baseUrl,
        'POST',
        '/api/v1/template-variants',
        {
          token: TOKENS.alice,
          body: {
            baseTemplateId: 'ta-rise-up',
            name: 'Alice Custom Variant F2',
            parameterOverrides: { headlineText: 'CUSTOM F2' },
          },
        }
      );
      assert.equal(varCreateA.status, 201);
      const variantId = varCreateA.json.data.id;

      const varGetB = await requestJson(
        srvB.baseUrl,
        'GET',
        `/api/v1/template-variants/${variantId}`,
        { token: TOKENS.alice }
      );
      assert.equal(varGetB.status, 200);
      assert.equal(varGetB.json.data.name, 'Alice Custom Variant F2');

      const forkB = await requestJson(
        srvB.baseUrl,
        'POST',
        '/api/v1/catalog/ta-rise-up/fork',
        {
          token: TOKENS.alice,
          body: {
            newName: 'Forked Rise Up F2',
            variantId,
          },
        }
      );
      assert.equal(forkB.status, 201);
      assert.equal(
        harness.hasDocument('catalogItems', forkB.json.data.forkedTemplate.id),
        true
      );

      // --- G. PROVIDER HUB CONNECTIONS, ROUTING, EXTENSIONS & TOOL AUDITS ---
      const connCreateA = await requestJson(
        srvA.baseUrl,
        'POST',
        '/api/v1/provider-hub/connections',
        {
          token: TOKENS.alice,
          body: {
            baseUrl: 'https://generativelanguage.googleapis.com',
            providerBrand: 'Google Gemini',
            protocol: 'google-gemini',
            label: 'Alice Gemini Key F2',
            modelId: 'gemini-2.5-flash',
            credential: 'AIzaSyTestKeyForPromptF2Cutover123456',
          },
        }
      );
      assert.equal(connCreateA.status, 201);
      const connectionId = connCreateA.json.data.connection.id;

      const connListB = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/provider-hub/connections',
        { token: TOKENS.alice }
      );
      assert.equal(connListB.status, 200);
      assert.equal(connListB.json.data.items.some((c: any) => c.id === connectionId), true);

      const routePutA = await requestJson(
        srvA.baseUrl,
        'PUT',
        '/api/v1/provider-hub/routing/planning',
        {
          token: TOKENS.alice,
          body: {
            primaryConnectionId: connectionId,
            maxBudgetPerRunUsd: 1.25,
          },
        }
      );
      assert.equal(routePutA.status, 200);

      const routeGetB = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/provider-hub/routing',
        { token: TOKENS.alice }
      );
      assert.equal(routeGetB.status, 200);
      assert.equal(routeGetB.json.data.profiles.planning.maxBudgetPerRunUsd, 1.25);

      const extCreateA = await requestJson(srvA.baseUrl, 'POST', '/api/v1/extensions', {
        token: TOKENS.alice,
        body: {
          name: 'F2 Safe Beat Analyzer',
          kind: 'github-repo',
          sourceUrl: 'https://github.com/sowveil/skills',
          commitOrReleasePin: 'abcdef1234567890',
          version: '1.0.0',
          license: 'MIT',
          declaredCapabilities: ['inspect-script'],
          requestedPermissions: ['read-project'],
          rawInstructionOrManifestContent: 'export function run(input) { return { ok: true }; }',
          explicitApprovalGranted: true,
        },
      });
      assert.equal(extCreateA.status, 201);
      const extId = extCreateA.json.data.extension.id;

      const extListB = await requestJson(srvB.baseUrl, 'GET', '/api/v1/extensions', {
        token: TOKENS.alice,
      });
      assert.equal(extListB.status, 200);
      assert.equal(extListB.json.data.items.some((e: any) => e.id === extId), true);

      // --- H. RENDER / EXPORT JOBS ---
      const jobCreateA = await requestJson(
        srvA.baseUrl,
        'POST',
        '/api/v1/render-export/jobs',
        {
          token: TOKENS.alice,
          body: {
            projectId: 'proj_f2_alice_1',
            outputFormat: 'sowveil-json',
            executionTier: 'final-render',
          },
        }
      );
      assert.equal(jobCreateA.status, 201);
      const renderJobId = jobCreateA.json.data.job.id;

      const jobListB = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/render-export/jobs',
        { token: TOKENS.alice }
      );
      assert.equal(jobListB.status, 200);
      assert.equal(jobListB.json.data.items.some((j: any) => j.id === renderJobId), true);

      // --- I. CACHE FAILURE DOES NOT REPORT FALSE SUCCESS OR BREAK FIRESTORE PERSISTENCE ---
      (appA as any).setSimulateCacheFailure(true);
      const noCacheProjRes = await requestJson(srvA.baseUrl, 'POST', '/api/v1/projects', {
        token: TOKENS.alice,
        body: {
          id: 'proj_f2_cache_bypass',
          title: 'Saved Directly To Firestore While Cache Disabled',
        },
      });
      assert.equal(noCacheProjRes.status, 201);
      const readOnB = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/projects/proj_f2_cache_bypass',
        { token: TOKENS.alice }
      );
      assert.equal(readOnB.status, 200);
      assert.equal(
        readOnB.json.data.title,
        'Saved Directly To Firestore While Cache Disabled'
      );
      (appA as any).setSimulateCacheFailure(false);

      // --- J. UNIFIED BROWSER FirestoreWorkspaceRepository VIA SERVER API ---
      const browserRepo = new FirestoreWorkspaceRepository();
      browserRepo.configureServerApiTransport({
        baseUrl: srvA.baseUrl,
        getAuthToken: async () => TOKENS.alice,
      });

      const browserCreated = await browserRepo.createProject({
        id: 'proj_f2_browser_unified',
        ownerUid: 'uid_alice_f2',
        title: 'Unified Browser-Server Project',
        description: 'Created via FirestoreWorkspaceRepository -> /api/v1/projects',
        compCount: 2,
        projectFileStatus: 'sowveil-native',
        fileSizeBytes: 2048,
        fileSizeLabel: '2.0 KB',
        hasExternalFootageWarning: false,
        archived: false,
        tags: ['f2', 'unified'],
      });
      assert.equal(browserCreated.id, 'proj_f2_browser_unified');
      assert.equal(harness.hasDocument('projects', 'proj_f2_browser_unified'), true);

      const serverBReadBrowserProj = await requestJson(
        srvB.baseUrl,
        'GET',
        '/api/v1/projects/proj_f2_browser_unified',
        { token: TOKENS.alice }
      );
      assert.equal(serverBReadBrowserProj.status, 200);
      assert.equal(
        serverBReadBrowserProj.json.data.title,
        'Unified Browser-Server Project'
      );
    } finally {
      await srvA.close();
      await srvB.close();
    }
  });
});
