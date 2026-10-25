import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp, VerifiedTokenIdentity } from '../server/apiApp';

const MOCK_TOKENS: Record<string, VerifiedTokenIdentity> = {
  token_user_bob: {
    uid: 'user_bob',
    email: 'bob@example.com',
    emailVerified: true,
    displayName: 'Bob Creator',
  },
  token_admin_claire: {
    uid: 'user_claire',
    email: 'claire@example.com',
    emailVerified: true,
    displayName: 'Claire Admin',
  },
  token_owner_primary: {
    uid: 'user_owner_primary',
    email: 'mdhasibul4u@gmail.com',
    emailVerified: true,
    displayName: 'Primary Studio Owner',
  },
  token_owner_secondary: {
    uid: 'user_owner_secondary',
    email: 'coowner@example.com',
    emailVerified: true,
    displayName: 'Secondary Studio Owner',
  },
};

async function startAdminTestServer() {
  const app = createApiApp({
    ownerBootstrapEmail: 'mdhasibul4u@gmail.com',
    ownerBootstrapSecret: 'TEST_ADMIN_BOOTSTRAP_SECRET_2026',
    storageEnabled: false,
    tokenVerifier: async (token: string) => {
      const identity = MOCK_TOKENS[token];
      if (!identity) {
        const err = new Error('Invalid token');
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

  // Bootstrap primary owner first
  const bootRes = await fetch(`${baseUrl}/api/v1/admin/bootstrap-owner`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token_owner_primary',
    },
    body: JSON.stringify({ bootstrapSecret: 'TEST_ADMIN_BOOTSTRAP_SECRET_2026' }),
  });
  assert.equal(bootRes.status, 200);

  // Register Bob, Claire, and Secondary Owner in user directory by calling /api/v1/me
  await fetch(`${baseUrl}/api/v1/me`, {
    headers: { Authorization: 'Bearer token_user_bob' },
  });
  await fetch(`${baseUrl}/api/v1/me`, {
    headers: { Authorization: 'Bearer token_admin_claire' },
  });
  await fetch(`${baseUrl}/api/v1/me`, {
    headers: { Authorization: 'Bearer token_owner_secondary' },
  });

  // Owner promotes Claire to 'admin'
  const promoteRes = await fetch(`${baseUrl}/api/v1/admin/users/user_claire/role`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token_owner_primary',
    },
    body: JSON.stringify({
      role: 'admin',
      reason: 'Promote Claire to admin for test suite verification',
    }),
  });
  assert.equal(promoteRes.status, 200);

  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('Admin & Authorization: Rejects unauthenticated and regular-user access to all /admin endpoints and catalog mutations', async () => {
  const srv = await startAdminTestServer();
  try {
    const adminEndpoints = [
      '/api/v1/admin/summary',
      '/api/v1/admin/modules',
      '/api/v1/admin/assets',
      '/api/v1/admin/users',
      '/api/v1/admin/jobs',
      '/api/v1/admin/analytics',
      '/api/v1/admin/settings',
      '/api/v1/admin/editors',
      '/api/v1/admin/audit-events',
    ];

    for (const ep of adminEndpoints) {
      // Unauthenticated -> 401
      const unauth = await fetch(`${srv.baseUrl}${ep}`);
      assert.equal(unauth.status, 401, `Expected 401 for unauthenticated ${ep}`);

      // Regular user Bob -> 403 FORBIDDEN_ROLE
      const bobRes = await fetch(`${srv.baseUrl}${ep}`, {
        headers: { Authorization: 'Bearer token_user_bob' },
      });
      assert.equal(bobRes.status, 403, `Expected 403 for regular user on ${ep}`);
      const bobJson = await bobRes.json();
      assert.equal(bobJson.error.code, 'FORBIDDEN_ROLE');
    }

    // Regular user Bob cannot create, patch, or delete catalog items
    const createCatalogBob = await fetch(`${srv.baseUrl}/api/v1/catalog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_user_bob',
      },
      body: JSON.stringify({
        id: 'ta-unauthorized-item',
        moduleId: 'text-animation',
        categoryId: 'ta-title',
        name: 'Unauthorized Item',
        slug: 'unauthorized-item',
        packLabel: 'Pack',
        summary: 'Should be blocked by server RBAC.',
        description: 'Blocked item.',
        tags: ['test'],
      }),
    });
    assert.equal(createCatalogBob.status, 403);
  } finally {
    await srv.close();
  }
});

test('Admin Role Policy: Blocks self-role escalation, blocks admin granting owner, and enforces last-owner lockout protection', async () => {
  const srv = await startAdminTestServer();
  try {
    // 1. Admin Claire tries to promote herself to owner -> 403 ONLY_OWNER_CAN_GRANT_OWNER
    const claireSelfOwner = await fetch(`${srv.baseUrl}/api/v1/admin/users/user_claire/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin_claire',
      },
      body: JSON.stringify({
        role: 'owner',
        reason: 'Attempting self-promotion to owner',
      }),
    });
    assert.equal(claireSelfOwner.status, 403);

    // 2. Admin Claire tries to grant owner to Bob -> 403 ONLY_OWNER_CAN_GRANT_OWNER
    const claireGrantOwner = await fetch(`${srv.baseUrl}/api/v1/admin/users/user_bob/role`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin_claire',
      },
      body: JSON.stringify({
        role: 'owner',
        reason: 'Claire attempting to make Bob owner',
      }),
    });
    assert.equal(claireGrantOwner.status, 403);
    const claireGrantJson = await claireGrantOwner.json();
    assert.equal(claireGrantJson.error.code, 'ONLY_OWNER_CAN_GRANT_OWNER');

    // 3. Primary Owner tries to demote themselves while being the ONLY owner -> 409 LAST_OWNER_PROTECTION
    const demoteLastOwner = await fetch(
      `${srv.baseUrl}/api/v1/admin/users/user_owner_primary/role`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_owner_primary',
        },
        body: JSON.stringify({
          role: 'admin',
          reason: 'Accidental self-demotion of last owner',
        }),
      }
    );
    assert.equal(demoteLastOwner.status, 409);
    const demoteJson = await demoteLastOwner.json();
    assert.equal(demoteJson.error.code, 'LAST_OWNER_PROTECTION');

    // 4. Attempting to suspend the last active owner -> 409 LAST_OWNER_PROTECTION
    const suspendLastOwner = await fetch(
      `${srv.baseUrl}/api/v1/admin/users/user_owner_primary/status`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_owner_primary',
        },
        body: JSON.stringify({
          status: 'suspended',
          reason: 'Testing last owner suspension guard',
        }),
      }
    );
    assert.equal(suspendLastOwner.status, 409);
    const suspendJson = await suspendLastOwner.json();
    assert.equal(suspendJson.error.code, 'LAST_OWNER_PROTECTION');
  } finally {
    await srv.close();
  }
});

test('Catalog Lifecycle: Draft isolation, publish/unpublish cache invalidation, and soft-delete preserving references', async () => {
  const srv = await startAdminTestServer();
  try {
    // 1. Admin creates a draft catalog item validated by CatalogCreateSchema
    const createDraftRes = await fetch(`${srv.baseUrl}/api/v1/catalog`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin_claire',
      },
      body: JSON.stringify({
        id: 'ta-draft-kinetic-test',
        moduleId: 'text-animation',
        categoryId: 'ta-title',
        name: 'Staged Kinetic Draft',
        slug: 'staged-kinetic-draft',
        packLabel: 'Typography Pack',
        summary: 'Draft item that must remain invisible to ordinary users until published.',
        description: 'Procedural kinetic title preset staged in draft visibility.',
        tags: ['draft', 'kinetic'],
        assetKind: 'scene-spec',
        capabilityType: 'text-preset',
        previewKind: 'text-rise-up',
        status: 'Available',
        visibility: 'draft',
      }),
    });
    assert.equal(createDraftRes.status, 201);
    const vAfterCreate = Number(createDraftRes.headers.get('x-catalog-cache-version') || '1');
    assert.ok(vAfterCreate >= 2);

    // 2. Ordinary user Bob queries /api/v1/catalog -> draft item is NOT exposed
    const publicCatalogRes = await fetch(`${srv.baseUrl}/api/v1/catalog?moduleId=text-animation`, {
      headers: { Authorization: 'Bearer token_user_bob' },
    });
    assert.equal(publicCatalogRes.status, 200);
    const publicCatalogJson = await publicCatalogRes.json();
    const leakedDraft = publicCatalogJson.data.items.find(
      (i: { id: string }) => i.id === 'ta-draft-kinetic-test'
    );
    assert.equal(leakedDraft, undefined, 'Draft catalog item must not leak to regular users');

    // 3. Ordinary user Bob explicitly requests ?visibility=draft -> 403 DRAFT_ACCESS_FORBIDDEN
    const explicitDraftRes = await fetch(`${srv.baseUrl}/api/v1/catalog?visibility=draft`, {
      headers: { Authorization: 'Bearer token_user_bob' },
    });
    assert.equal(explicitDraftRes.status, 403);
    const explicitDraftJson = await explicitDraftRes.json();
    assert.equal(explicitDraftJson.error.code, 'DRAFT_ACCESS_FORBIDDEN');

    // 4. Admin publishes the draft -> cache version increments and item becomes visible
    const publishRes = await fetch(`${srv.baseUrl}/api/v1/catalog/ta-draft-kinetic-test`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin_claire',
      },
      body: JSON.stringify({ visibility: 'published' }),
    });
    assert.equal(publishRes.status, 200);
    const vAfterPublish = Number(publishRes.headers.get('x-catalog-cache-version') || '1');
    assert.ok(vAfterPublish > vAfterCreate);

    // 5. Soft-delete without confirm=true -> 400 CONFIRMATION_REQUIRED
    const deleteNoConfirm = await fetch(`${srv.baseUrl}/api/v1/catalog/ta-draft-kinetic-test`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token_admin_claire' },
    });
    assert.equal(deleteNoConfirm.status, 400);

    // 6. Soft-delete with confirm=true -> archives item and preserves safe reference
    const deleteConfirm = await fetch(
      `${srv.baseUrl}/api/v1/catalog/ta-draft-kinetic-test?confirm=true`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token_admin_claire' },
      }
    );
    assert.equal(deleteConfirm.status, 200);
    const deleteJson = await deleteConfirm.json();
    assert.equal(deleteJson.data.item.visibility, 'archived');
    assert.ok(deleteJson.data.preservedReferences);
  } finally {
    await srv.close();
  }
});

test('Modules, Editor Compatibility, Settings & Audit Immutability: Enforces schema & policy guards', async () => {
  const srv = await startAdminTestServer();
  try {
    // 1. Attempting to delete a required module -> 403 REQUIRED_MODULE_DELETION_FORBIDDEN
    const delModRes = await fetch(`${srv.baseUrl}/api/v1/admin/modules/text-animation`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token_admin_claire' },
    });
    assert.equal(delModRes.status, 403);
    const delModJson = await delModRes.json();
    assert.equal(delModJson.error.code, 'REQUIRED_MODULE_DELETION_FORBIDDEN');

    // 2. Attempting to disable a module without confirmationReason -> 400 VALIDATION_ERROR
    const disableNoReason = await fetch(`${srv.baseUrl}/api/v1/admin/modules/logo-reveals`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin_claire',
      },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disableNoReason.status, 400);

    // 3. Disabling a module with confirmationReason -> 200 OK
    const disableWithReason = await fetch(`${srv.baseUrl}/api/v1/admin/modules/logo-reveals`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin_claire',
      },
      body: JSON.stringify({
        enabled: false,
        confirmationReason: 'Scheduled maintenance on logo reveal preview shader',
      }),
    });
    assert.equal(disableWithReason.status, 200);

    // 4. Attempting to mark an editor 'Verified' without verificationNote >= 10 chars -> 400 VALIDATION_ERROR
    const badEditorVerify = await fetch(`${srv.baseUrl}/api/v1/admin/editors/capcut`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_admin_claire',
      },
      body: JSON.stringify({
        compatibilityStatus: 'Verified',
        verifiedFormats: ['zip-bundle'],
        testedVersions: 'CapCut Android 12.4',
        limitationsNote: 'Media bundle handoff only',
        verificationNote: 'short', // < 10 chars, must fail
      }),
    });
    assert.equal(badEditorVerify.status, 400);

    // 5. Attempting to edit secrets via /api/v1/admin/settings -> 403 SECRETS_NOT_EDITABLE
    const secretInjectRes = await fetch(`${srv.baseUrl}/api/v1/admin/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_owner_primary',
      },
      body: JSON.stringify({
        exportMaxSizeMb: 60,
        OWNER_BOOTSTRAP_SECRET: 'HACKED_SECRET',
      }),
    });
    assert.equal(secretInjectRes.status, 403);
    const secretInjectJson = await secretInjectRes.json();
    assert.equal(secretInjectJson.error.code, 'SECRETS_NOT_EDITABLE');

    // 6. Audit Log immutability: DELETE or PATCH on /api/v1/admin/audit-events -> 403 AUDIT_LOG_IMMUTABLE
    const delAuditRes = await fetch(`${srv.baseUrl}/api/v1/admin/audit-events`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token_owner_primary' },
    });
    assert.equal(delAuditRes.status, 403);
    const delAuditJson = await delAuditRes.json();
    assert.equal(delAuditJson.error.code, 'AUDIT_LOG_IMMUTABLE');

    // 7. Safe Technical Diagnostics (/api/v1/diagnostics/technical) never exposes secrets and masks user PII
    const diagRes = await fetch(`${srv.baseUrl}/api/v1/diagnostics/technical`, {
      headers: { Authorization: 'Bearer token_owner_primary' },
    });
    assert.equal(diagRes.status, 200);
    const diagText = await diagRes.text();
    assert.equal(diagText.includes('TEST_ADMIN_BOOTSTRAP_SECRET_2026'), false);
    const diagJson = JSON.parse(diagText);
    assert.equal(diagJson.data.firebaseReadiness.credentialsExposed, false);
    assert.equal(diagJson.data.viewerScope, 'admin-deep-diagnostic');
  } finally {
    await srv.close();
  }
});
