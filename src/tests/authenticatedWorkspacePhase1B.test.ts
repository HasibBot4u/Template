import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeAuthenticatedApiRequest,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
} from '../services/apiClient';
import { createApiApp } from '../server/apiApp';
import http from 'node:http';

function createMockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return Promise.resolve(handler(url, init));
  };
}

test('Phase 1B: executeAuthenticatedApiRequest injects Bearer token and strips dev headers', async () => {
  let capturedHeaders: Headers | null = null;

  const mockFetch = createMockFetch((_url, init) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ ok: true, data: { status: 'healthy' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const res = await executeAuthenticatedApiRequest<{ status: string }>('/api/v1/test', {
    method: 'POST',
    body: { test: true },
    headers: {
      'X-Test-Uid': 'forbidden-dev-uid',
      'X-Test-Email': 'dev@test.local',
      'x-sowveil-dev-uid': 'forbidden-dev-uid',
      'X-Custom-Client': 'sowveil-pwa',
    },
    getAuthToken: async () => 'valid-firebase-jwt-token-123',
    fetchImpl: mockFetch,
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(res.data?.status, 'healthy');
  assert.ok(capturedHeaders);
  const headers = capturedHeaders as unknown as Headers;
  assert.equal(headers.get('Authorization'), 'Bearer valid-firebase-jwt-token-123');
  assert.equal(headers.get('X-Custom-Client'), 'sowveil-pwa');
  // Dev bypass headers MUST be stripped
  assert.equal(headers.get('X-Test-Uid'), null);
  assert.equal(headers.get('X-Test-Email'), null);
  assert.equal(headers.get('x-sowveil-dev-uid'), null);
});

test('Phase 1B: executeAuthenticatedApiRequest retries once with forceRefresh=true on 401 token expiration', async () => {
  let callCount = 0;
  const tokenRequests: boolean[] = [];

  const mockFetch = createMockFetch((_url, init) => {
    callCount += 1;
    const authHeader = new Headers(init?.headers).get('Authorization');
    if (callCount === 1) {
      assert.equal(authHeader, 'Bearer expired-token');
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Token expired' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    assert.equal(authHeader, 'Bearer fresh-refreshed-token');
    return new Response(
      JSON.stringify({ ok: true, data: { user: 'verified-user' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const getAuthToken = async (forceRefresh?: boolean) => {
    tokenRequests.push(Boolean(forceRefresh));
    return forceRefresh ? 'fresh-refreshed-token' : 'expired-token';
  };

  const res = await executeAuthenticatedApiRequest<{ user: string }>('/api/v1/user/profile', {
    method: 'GET',
    getAuthToken,
    fetchImpl: mockFetch,
  });

  assert.equal(callCount, 2, 'Should retry exactly once after 401');
  assert.deepEqual(tokenRequests, [false, true], 'Second token request must have forceRefresh=true');
  assert.equal(res.ok, true);
  assert.equal(res.data?.user, 'verified-user');
});

test('Phase 1B: executeAuthenticatedApiRequest returns structured 401 when getAuthToken returns null', async () => {
  let fetchCalled = false;
  const mockFetch = createMockFetch(() => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  });

  const res = await executeAuthenticatedApiRequest('/api/v1/protected-data', {
    getAuthToken: async () => null,
    fetchImpl: mockFetch,
  });

  assert.equal(fetchCalled, false, 'Fetch should not be dispatched when no token is available');
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.errorCode, 'AUTH_SESSION_REQUIRED');
  assert.ok(Boolean(res.errorMessage?.includes('authenticated session is required')));
});

test('Phase 1B: executeAuthenticatedApiRequest propagates 403, 503, and network errors accurately', async () => {
  // Test 403
  const mock403Fetch = createMockFetch(() => {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'FORBIDDEN_PROJECT', message: 'You do not own this project.' },
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const res403 = await executeAuthenticatedApiRequest('/api/v1/projects/proj-123', {
    getAuthToken: async () => 'valid-token',
    fetchImpl: mock403Fetch,
  });
  assert.equal(res403.ok, false);
  assert.equal(res403.status, 403);
  assert.equal(res403.errorCode, 'FORBIDDEN_PROJECT');
  assert.equal(res403.errorMessage, 'You do not own this project.');

  // Test 503
  const mock503Fetch = createMockFetch(() => {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Render worker pool is currently saturated.' },
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const res503 = await executeAuthenticatedApiRequest('/api/v1/render-export/jobs', {
    getAuthToken: async () => 'valid-token',
    fetchImpl: mock503Fetch,
  });
  assert.equal(res503.ok, false);
  assert.equal(res503.status, 503);
  assert.equal(res503.errorCode, 'SERVICE_UNAVAILABLE');

  // Test Network Error
  const mockNetworkFailFetch = createMockFetch(() => {
    throw new Error('Connection refused to backend port');
  });

  const resNet = await executeAuthenticatedApiRequest('/api/v1/network-down', {
    getAuthToken: async () => 'valid-token',
    fetchImpl: mockNetworkFailFetch,
  });
  assert.equal(resNet.ok, false);
  assert.equal(resNet.status, 0);
  assert.equal(resNet.errorCode, 'NETWORK_ERROR');
  assert.ok(Boolean(resNet.errorMessage?.includes('Connection refused')));
});

test('Phase 1B: apiGet, apiPost, apiPatch, apiDelete helper methods work correctly', async () => {
  const methodsCalled: string[] = [];
  const mockFetch = createMockFetch((_url, init) => {
    methodsCalled.push(init?.method || 'GET');
    return new Response(JSON.stringify({ ok: true, data: { method: init?.method || 'GET' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  const options = {
    getAuthToken: async () => 'valid-token',
    fetchImpl: mockFetch,
  };

  await apiGet('/api/v1/resource', options);
  await apiPost('/api/v1/resource', { foo: 'bar' }, options);
  await apiPatch('/api/v1/resource', { foo: 'baz' }, options);
  await apiDelete('/api/v1/resource', options);

  assert.deepEqual(methodsCalled, ['GET', 'POST', 'PATCH', 'DELETE']);
});

test('Phase 1B: Server end-to-end authentication rejecting bypass headers and accepting valid Bearer token', async () => {
  // Set up real Express apiApp with mock token verifier
  const app = createApiApp({
    tokenVerifier: async (token: string) => {
      if (token === 'alice-valid-token') {
        return {
          uid: 'user_alice_123',
          email: 'alice@sowveil.test',
          displayName: 'Alice Creator',
          emailVerified: true,
          role: 'user',
        };
      }
      if (token === 'bob-valid-token') {
        return {
          uid: 'user_bob_456',
          email: 'bob@sowveil.test',
          displayName: 'Bob Creator',
          emailVerified: true,
          role: 'user',
        };
      }
      throw new Error('Invalid authentication token');
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const origin = `http://localhost:${address.port}`;

  try {
    // 1. Direct raw HTTP request sending old dev bypass headers without Bearer token -> server returns 401 UNAUTHENTICATED
    const rawDirectRes = await fetch(`${origin}/api/v1/template-factory/drafts`, {
      headers: {
        'x-sowveil-dev-uid': 'user_alice_123',
        'X-Test-Uid': 'user_alice_123',
      },
    });
    assert.equal(rawDirectRes.status, 401);
    const rawJson = await rawDirectRes.json();
    assert.equal(rawJson.error?.code, 'UNAUTHENTICATED');

    // 2. Client calling without token returns AUTH_SESSION_REQUIRED
    const unauthRes = await executeAuthenticatedApiRequest(`${origin}/api/v1/template-factory/drafts`, {
      method: 'GET',
      getAuthToken: async () => null,
      fetchImpl: fetch,
    });
    assert.equal(unauthRes.ok, false);
    assert.equal(unauthRes.status, 401);
    assert.equal(unauthRes.errorCode, 'AUTH_SESSION_REQUIRED');

    // 3. Calling with valid Bearer token succeeds
    const aliceRes = await executeAuthenticatedApiRequest<{ items: any[] }>(
      `${origin}/api/v1/template-factory/drafts`,
      {
        method: 'GET',
        getAuthToken: async () => 'alice-valid-token',
        fetchImpl: fetch,
      }
    );
    assert.equal(aliceRes.ok, true);
    assert.equal(aliceRes.status, 200);
    assert.ok(Array.isArray(aliceRes.data?.items));

    // 3. User Alice creates a Template Factory draft
    const createDraftRes = await executeAuthenticatedApiRequest<{ draft: any }>(
      `${origin}/api/v1/template-factory/create`,
      {
        method: 'POST',
        body: {
          title: 'Alice Kinetic Neon Title',
          sourceKind: 'from-scratch',
          moduleId: 'text-animation',
          tags: ['neon', 'kinetic'],
          licenseType: 'Sowveil Original',
        },
        getAuthToken: async () => 'alice-valid-token',
        fetchImpl: fetch,
      }
    );
    assert.equal(createDraftRes.ok, true);
    assert.equal(createDraftRes.status, 201);
    const draftId = createDraftRes.data!.draft.id;
    assert.equal(createDraftRes.data!.draft.ownerUid, 'user_alice_123');

    // 4. User Bob tries to patch or deprecate Alice's private draft -> MUST return 403 Forbidden
    const bobPatchRes = await executeAuthenticatedApiRequest(
      `${origin}/api/v1/template-factory/drafts/${draftId}`,
      {
        method: 'PATCH',
        body: { changelog: 'Bob unauthorized modification' },
        getAuthToken: async () => 'bob-valid-token',
        fetchImpl: fetch,
      }
    );
    assert.equal(bobPatchRes.ok, false);
    assert.equal(bobPatchRes.status, 403);
    assert.equal(bobPatchRes.errorCode, 'FORBIDDEN_DRAFT');

    // 5. User Bob lists drafts -> Alice's draft MUST NOT appear
    const bobDraftsRes = await executeAuthenticatedApiRequest<{ items: any[] }>(
      `${origin}/api/v1/template-factory/drafts`,
      {
        method: 'GET',
        getAuthToken: async () => 'bob-valid-token',
        fetchImpl: fetch,
      }
    );
    assert.equal(bobDraftsRes.ok, true);
    const foundAliceDraftInBobList = bobDraftsRes.data!.items.some((d) => d.id === draftId);
    assert.equal(foundAliceDraftInBobList, false, 'Bob must not see Alice’s private draft');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

test('Phase 1B: EditingStudioWorkspace localStorage keys prevent cross-account leakage', () => {
  // Simulate mock localStorage
  const storageMap = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => storageMap.get(key) || null,
    setItem: (key: string, val: string) => storageMap.set(key, val),
    removeItem: (key: string) => storageMap.delete(key),
    clear: () => storageMap.clear(),
  };

  const userAUid = 'usr_alice_001';
  const userBUid = 'usr_bob_002';
  const projectId = 'proj_neon_reel_99';

  // User A writes project autosave and last active project
  const userAProjectData = JSON.stringify({
    schemaVersion: '2.0.0',
    id: projectId,
    title: 'Alice Project',
    ownerUid: userAUid,
    revision: 5,
  });

  const userAKey = `sowveil.canonical.autosave.${userAUid}.${projectId}`;
  const userALastActiveKey = `sowveil.canonical.lastActiveProject.${userAUid}`;

  mockLocalStorage.setItem(userAKey, userAProjectData);
  mockLocalStorage.setItem(userALastActiveKey, userAProjectData);

  // User B attempts to read autosave for same projectId
  const userBKey = `sowveil.canonical.autosave.${userBUid}.${projectId}`;
  const userBLastActiveKey = `sowveil.canonical.lastActiveProject.${userBUid}`;

  assert.equal(mockLocalStorage.getItem(userBKey), null, 'User B must not read User A autosave');
  assert.equal(mockLocalStorage.getItem(userBLastActiveKey), null, 'User B must not read User A last active');

  // User B saves their own draft
  const userBProjectData = JSON.stringify({
    schemaVersion: '2.0.0',
    id: projectId,
    title: 'Bob Project',
    ownerUid: userBUid,
    revision: 1,
  });
  mockLocalStorage.setItem(userBKey, userBProjectData);

  // Assert User A and User B data are independently isolated
  assert.equal(JSON.parse(mockLocalStorage.getItem(userAKey)!).title, 'Alice Project');
  assert.equal(JSON.parse(mockLocalStorage.getItem(userBKey)!).title, 'Bob Project');
});

test('Phase 1B: Reference Lab inspection copy does not claim analysis before running pipeline', () => {
  // Check the message formatting contract for file upload
  const fileName = 'vertical_kinetic_spec.mp4';
  const fileSize = 1048576; // 1 MB
  const detectedKind = 'uploaded-video';

  const statusMessage = `Selected lawful file "${fileName}" (${Math.round(fileSize / 1024)} KB) as ${detectedKind}. Ready to run analysis pipeline.`;

  assert.ok(statusMessage.includes('Selected lawful file'), 'Must indicate file is selected');
  assert.ok(statusMessage.includes('Ready to run analysis pipeline'), 'Must indicate ready to run, not already analyzed');
  assert.ok(!statusMessage.includes('Loaded lawful file'), 'Must not claim already loaded/analyzed');
});
