import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp, VerifiedTokenIdentity } from '../server/apiApp';

const MOCK_TOKENS: Record<string, VerifiedTokenIdentity> = {
  token_alice: {
    uid: 'user_alice',
    email: 'alice@example.com',
    emailVerified: true,
    displayName: 'Alice Motion',
  },
  token_mallory: {
    uid: 'user_mallory',
    email: 'mallory@example.com',
    emailVerified: true,
    displayName: 'Mallory Attacker',
  },
  token_unverified: {
    uid: 'user_unverified',
    email: 'mdhasibul4u@gmail.com',
    emailVerified: false,
    displayName: 'Spoofed Unverified Owner',
  },
  token_owner: {
    uid: 'user_owner_1',
    email: 'mdhasibul4u@gmail.com',
    emailVerified: true,
    displayName: 'Studio Owner',
  },
};

async function startTestServer() {
  const app = createApiApp({
    ownerBootstrapEmail: 'mdhasibul4u@gmail.com',
    ownerBootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026',
    storageEnabled: false,
    tokenVerifier: async (token: string) => {
      if (token === 'token_expired') {
        const err = new Error('Token has expired');
        (err as { code?: string }).code = 'TOKEN_EXPIRED';
        throw err;
      }
      const identity = MOCK_TOKENS[token];
      if (!identity) {
        const err = new Error('Malformed or unknown token');
        (err as { code?: string }).code = 'INVALID_TOKEN';
        throw err;
      }
      return identity;
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('Phase 3 API Security: Rejects unauthenticated access, expired tokens, malformed tokens, and unverified emails', async () => {
  const srv = await startTestServer();
  try {
    // 1. Unauthenticated request to /api/v1/me
    const unauthRes = await fetch(`${srv.baseUrl}/api/v1/me`);
    assert.equal(unauthRes.status, 401);
    const unauthJson = await unauthRes.json();
    assert.equal(unauthJson.ok, false);
    assert.equal(unauthJson.error.code, 'UNAUTHENTICATED');
    assert.ok(unauthJson.requestId.startsWith('req_'));

    // 2. Expired token
    const expRes = await fetch(`${srv.baseUrl}/api/v1/me`, {
      headers: { Authorization: 'Bearer token_expired' },
    });
    assert.equal(expRes.status, 401);
    const expJson = await expRes.json();
    assert.equal(expJson.error.code, 'TOKEN_EXPIRED');

    // 3. Invalid token
    const badRes = await fetch(`${srv.baseUrl}/api/v1/projects`, {
      headers: { Authorization: 'Bearer malformed_garbage_token' },
    });
    assert.equal(badRes.status, 401);
    const badJson = await badRes.json();
    assert.equal(badJson.error.code, 'INVALID_TOKEN');

    // 4. Unverified email spoof attempt
    const unverifiedRes = await fetch(`${srv.baseUrl}/api/v1/me`, {
      headers: { Authorization: 'Bearer token_unverified' },
    });
    assert.equal(unverifiedRes.status, 403);
    const unverifiedJson = await unverifiedRes.json();
    assert.equal(unverifiedJson.error.code, 'EMAIL_NOT_VERIFIED');
  } finally {
    await srv.close();
  }
});

test('Phase 3 API Security: Prevents self-role escalation, blocks draft catalog reads for ordinary users, and enforces one-time owner bootstrap', async () => {
  const srv = await startTestServer();
  try {
    // 1. Alice attempts to escalate her role via PATCH /api/v1/me/preferences
    const escRes = await fetch(`${srv.baseUrl}/api/v1/me/preferences`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({ role: 'owner', reducedMotion: true }),
    });
    assert.equal(escRes.status, 403);
    const escJson = await escRes.json();
    assert.equal(escJson.error.code, 'ROLE_ESCALATION_FORBIDDEN');

    // 2. Alice attempts to access draft catalog record
    const draftRes = await fetch(`${srv.baseUrl}/api/v1/catalog/draft-internal-rig`, {
      headers: { Authorization: 'Bearer token_alice' },
    });
    assert.equal(draftRes.status, 403);
    const draftJson = await draftRes.json();
    assert.equal(draftJson.error.code, 'DRAFT_ACCESS_FORBIDDEN');

    // 3. Alice attempts to create a catalog item (admin-only route)
    const createCatRes = await fetch(`${srv.baseUrl}/api/v1/catalog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({
        id: 'hacked-item',
        moduleId: 'text-animation',
        name: 'Hacked',
        slug: 'hacked',
        summary: 'Summary',
        description: 'Desc',
        categoryId: 'all',
        packLabel: 'Pack',
      }),
    });
    assert.equal(createCatRes.status, 403);
    const createCatJson = await createCatRes.json();
    assert.equal(createCatJson.error.code, 'FORBIDDEN_ROLE');

    // 4. Alice attempts to bootstrap herself as owner (wrong email)
    const aliceBootRes = await fetch(`${srv.baseUrl}/api/v1/admin/bootstrap-owner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({ bootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026' }),
    });
    assert.equal(aliceBootRes.status, 403);
    const aliceBootJson = await aliceBootRes.json();
    assert.equal(aliceBootJson.error.code, 'OWNER_EMAIL_MISMATCH');

    // 5. Verified owner bootstraps with valid secret -> 200 OK
    const ownerBootRes = await fetch(`${srv.baseUrl}/api/v1/admin/bootstrap-owner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner',
      },
      body: JSON.stringify({ bootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026' }),
    });
    assert.equal(ownerBootRes.status, 200);
    const ownerBootJson = await ownerBootRes.json();
    assert.equal(ownerBootJson.data.role, 'owner');

    // 6. Second bootstrap attempt is permanently locked -> 409 OWNER_ALREADY_BOOTSTRAPPED
    const secondBootRes = await fetch(`${srv.baseUrl}/api/v1/admin/bootstrap-owner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner',
      },
      body: JSON.stringify({ bootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026' }),
    });
    assert.equal(secondBootRes.status, 409);
    const secondBootJson = await secondBootRes.json();
    assert.equal(secondBootJson.error.code, 'OWNER_ALREADY_BOOTSTRAPPED');

    // 7. Bootstrapped owner can now read draft catalog items and audit logs
    const ownerDraftRes = await fetch(`${srv.baseUrl}/api/v1/catalog/draft-internal-rig`, {
      headers: { Authorization: 'Bearer token_owner' },
    });
    assert.equal(ownerDraftRes.status, 200);

    const auditRes = await fetch(`${srv.baseUrl}/api/v1/admin/audit-events`, {
      headers: { Authorization: 'Bearer token_owner' },
    });
    assert.equal(auditRes.status, 200);
    const auditJson = await auditRes.json();
    assert.ok(auditJson.data.items.length >= 3);
  } finally {
    await srv.close();
  }
});

test('Phase 3 API Security: Prevents cross-user project access, rejects invalid payloads & blob URLs, and enforces duplicate favorite/job idempotence', async () => {
  const srv = await startTestServer();
  try {
    // 1. Alice creates a private project
    const createProjRes = await fetch(`${srv.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({
        title: 'Alice Private SaaS Launch',
        description: 'Confidential motion launch deck',
        compCount: null,
        projectFileStatus: 'metadata-only',
        fileSizeBytes: null,
      }),
    });
    assert.equal(createProjRes.status, 201);
    const aliceProj = (await createProjRes.json()).data;
    assert.equal(aliceProj.ownerUid, 'user_alice');
    assert.equal(aliceProj.compCount, null);

    // 2. Mallory attempts to read, patch, and delete Alice's project -> 403 CROSS_USER_ACCESS_FORBIDDEN
    const malloryGet = await fetch(`${srv.baseUrl}/api/v1/projects/${aliceProj.id}`, {
      headers: { Authorization: 'Bearer token_mallory' },
    });
    assert.equal(malloryGet.status, 403);
    assert.equal((await malloryGet.json()).error.code, 'CROSS_USER_ACCESS_FORBIDDEN');

    const malloryPatch = await fetch(`${srv.baseUrl}/api/v1/projects/${aliceProj.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_mallory',
      },
      body: JSON.stringify({ title: 'Pwned Title' }),
    });
    assert.equal(malloryPatch.status, 403);

    const malloryDelete = await fetch(`${srv.baseUrl}/api/v1/projects/${aliceProj.id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token_mallory' },
    });
    assert.equal(malloryDelete.status, 403);

    // 3. Reject invalid payload (empty title) & local blob: URL
    const invalidProjRes = await fetch(`${srv.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({ title: '' }),
    });
    assert.equal(invalidProjRes.status, 400);
    assert.equal((await invalidProjRes.json()).error.code, 'VALIDATION_ERROR');

    const blobProjRes = await fetch(`${srv.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({
        title: 'Fake Cloud Upload',
        description: 'Uploaded to blob:http://localhost:3000/1234-5678',
      }),
    });
    assert.equal(blobProjRes.status, 400);
    assert.equal((await blobProjRes.json()).error.code, 'LOCAL_BLOB_URL_FORBIDDEN');

    // 4. Storage upload URL endpoint returns 503 STORAGE_NOT_CONFIGURED
    const storageRes = await fetch(`${srv.baseUrl}/api/v1/assets/upload-url`, {
      method: 'POST',
      headers: { Authorization: 'Bearer token_alice' },
    });
    assert.equal(storageRes.status, 503);
    assert.equal((await storageRes.json()).error.code, 'STORAGE_NOT_CONFIGURED');

    // 5. Idempotent favorite PUT
    await fetch(`${srv.baseUrl}/api/v1/me/favorites/ta-rise-up`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer token_alice' },
    });
    const favSecondRes = await fetch(`${srv.baseUrl}/api/v1/me/favorites/ta-rise-up`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer token_alice' },
    });
    const favData = (await favSecondRes.json()).data;
    assert.equal(favData.total, 1);
    assert.deepEqual(favData.items, ['ta-rise-up']);

    // 6. Job creation idempotency & duplicate terminal result rejection
    const jobCreate1 = await fetch(`${srv.baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({
        type: 'ae-operation',
        title: 'Apply Rise Up',
        moduleId: 'text-animation',
        operation: 'applyTextAnimation',
        idempotencyKey: 'idem_alice_rise_1',
      }),
    });
    assert.equal(jobCreate1.status, 201);
    const job1 = (await jobCreate1.json()).data;

    // Duplicate job creation with same idempotencyKey returns existing job (200)
    const jobCreate2 = await fetch(`${srv.baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({
        type: 'ae-operation',
        title: 'Apply Rise Up',
        moduleId: 'text-animation',
        operation: 'applyTextAnimation',
        idempotencyKey: 'idem_alice_rise_1',
      }),
    });
    assert.equal(jobCreate2.status, 200);
    const job2 = (await jobCreate2.json()).data;
    assert.equal(job1.id, job2.id);

    // Transition queued -> claimed -> running -> succeeded
    await fetch(`${srv.baseUrl}/api/v1/connector/jobs/${job1.id}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({ status: 'claimed' }),
    });
    await fetch(`${srv.baseUrl}/api/v1/connector/jobs/${job1.id}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({ status: 'running' }),
    });
    const succeedRes = await fetch(`${srv.baseUrl}/api/v1/connector/jobs/${job1.id}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({ status: 'succeeded', redactedMessage: 'Applied to timeline' }),
    });
    assert.equal(succeedRes.status, 200);

    // Duplicate result submission on terminal job must fail with 409 DUPLICATE_TERMINAL_JOB_RESULT
    const dupResultRes = await fetch(`${srv.baseUrl}/api/v1/connector/jobs/${job1.id}/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({ status: 'succeeded', redactedMessage: 'Duplicate replay' }),
    });
    assert.equal(dupResultRes.status, 409);
    assert.equal((await dupResultRes.json()).error.code, 'DUPLICATE_TERMINAL_JOB_RESULT');
  } finally {
    await srv.close();
  }
});

test('Phase 3 API Security: Missing OWNER_BOOTSTRAP_EMAIL or production non-durable snapshot lock disables bootstrap safely', async () => {
  const prevOwnerEmail = process.env.OWNER_BOOTSTRAP_EMAIL;
  delete process.env.OWNER_BOOTSTRAP_EMAIL;

  // 1. Server with missing OWNER_BOOTSTRAP_EMAIL (no fallback to hardcoded address)
  const appMissingEmail = createApiApp({
    ownerBootstrapEmail: '',
    ownerBootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026',
    storageEnabled: false,
    tokenVerifier: async (token: string) => {
      const identity = MOCK_TOKENS[token];
      if (!identity) throw new Error('Invalid token');
      return identity;
    },
  });
  const srvMissingEmail = http.createServer(appMissingEmail);
  await new Promise<void>((resolve) => srvMissingEmail.listen(0, '127.0.0.1', resolve));
  const addr1 = srvMissingEmail.address();
  const baseUrl1 = `http://127.0.0.1:${typeof addr1 === 'object' && addr1 ? addr1.port : 0}`;

  // 2. Server running in production mode where local disk snapshot lock is not durable/race-safe
  const appProd = createApiApp({
    ownerBootstrapEmail: 'owner@sowveil.studio',
    ownerBootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026',
    nodeEnv: 'production',
    storageEnabled: false,
    tokenVerifier: async () => ({
      uid: 'prod_owner_uid',
      email: 'owner@sowveil.studio',
      emailVerified: true,
      displayName: 'Prod Owner',
    }),
  });
  const srvProd = http.createServer(appProd);
  await new Promise<void>((resolve) => srvProd.listen(0, '127.0.0.1', resolve));
  const addr2 = srvProd.address();
  const baseUrl2 = `http://127.0.0.1:${typeof addr2 === 'object' && addr2 ? addr2.port : 0}`;

  try {
    // Missing OWNER_BOOTSTRAP_EMAIL -> canBootstrapOwner is false and POST /api/v1/admin/bootstrap-owner returns 503 BOOTSTRAP_NOT_CONFIGURED
    const meRes = await fetch(`${baseUrl1}/api/v1/me`, {
      headers: { Authorization: 'Bearer token_owner' },
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.data.canBootstrapOwner, false);

    const bootMissingEmailRes = await fetch(`${baseUrl1}/api/v1/admin/bootstrap-owner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner',
      },
      body: JSON.stringify({ bootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026' }),
    });
    assert.equal(bootMissingEmailRes.status, 503);
    const bootMissingEmailJson = await bootMissingEmailRes.json();
    assert.equal(bootMissingEmailJson.error.code, 'BOOTSTRAP_NOT_CONFIGURED');
    assert.match(bootMissingEmailJson.error.message, /OWNER_BOOTSTRAP_EMAIL/);

    // Production mode -> canBootstrapOwner is false and POST /api/v1/admin/bootstrap-owner returns 503 BOOTSTRAP_DISABLED_IN_PRODUCTION
    const meProdRes = await fetch(`${baseUrl2}/api/v1/me`, {
      headers: { Authorization: 'Bearer token_owner' },
    });
    assert.equal(meProdRes.status, 200);
    const meProdJson = await meProdRes.json();
    assert.equal(meProdJson.data.canBootstrapOwner, false);

    const bootProdRes = await fetch(`${baseUrl2}/api/v1/admin/bootstrap-owner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner',
      },
      body: JSON.stringify({ bootstrapSecret: 'TEST_BOOTSTRAP_SECRET_2026' }),
    });
    assert.equal(bootProdRes.status, 503);
    const bootProdJson = await bootProdRes.json();
    assert.equal(bootProdJson.error.code, 'BOOTSTRAP_DISABLED_IN_PRODUCTION');
  } finally {
    if (prevOwnerEmail !== undefined) {
      process.env.OWNER_BOOTSTRAP_EMAIL = prevOwnerEmail;
    }
    await new Promise<void>((resolve) => srvMissingEmail.close(() => resolve()));
    await new Promise<void>((resolve) => srvProd.close(() => resolve()));
  }
});
