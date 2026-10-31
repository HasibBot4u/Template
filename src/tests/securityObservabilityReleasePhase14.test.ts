import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp, VerifiedTokenIdentity } from '../server/apiApp';

function startTestServer() {
  process.env.SOWVEIL_MASTER_VAULT_KEY =
    'sowveil-test-suite-master-vault-key-phase14-9988776655';
  delete process.env.SOWVEIL_VAULT_KEY;
  const tokenMap = new Map<string, VerifiedTokenIdentity>([
    [
      'token-alice',
      {
        uid: 'uid_alice',
        email: 'alice@example.com',
        emailVerified: true,
        displayName: 'Alice Studio',
      },
    ],
    [
      'token-bob',
      {
        uid: 'uid_bob',
        email: 'bob@example.com',
        emailVerified: true,
        displayName: 'Bob Studio',
      },
    ],
  ]);

  const app = createApiApp({
    tokenVerifier: async (token: string) => {
      const id = tokenMap.get(token);
      if (!id) throw new Error('Invalid token');
      return id;
    },
  });

  const server = http.createServer(app);
  return new Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

test('Phase 14.1: Cross-account IDOR isolation across Projects, Reference Lab, Provider Hub, Extensions, AI Director, Template Factory, and Render/Export', async () => {
  const srv = await startTestServer();
  try {
    const aliceHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-alice',
    };
    const bobHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-bob',
    };

    // 1. Alice creates a Project
    const projRes = await fetch(`${srv.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        title: 'Alice Confidential Launch Project',
        description: 'Private commercial edit',
        compCount: 2,
        projectFileStatus: 'sowveil-native',
        fileSizeLabel: '1.2 MB',
        resolution: '1080x1920',
        durationLabel: '00:12',
        fps: 30,
        aeVersion: 'Sowveil 2.4',
        hasExternalFootageWarning: false,
        archived: false,
        tags: ['confidential'],
      }),
    });
    assert.equal(projRes.status, 201);
    const aliceProj = (await projRes.json()).data;

    // 2. Alice creates a Reference Lab session
    const refRes = await fetch(`${srv.baseUrl}/api/v1/reference-lab/sessions`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        title: 'Alice Private Reference Study',
        usageMode: 'authorized-reconstruction',
        sourceKind: 'uploaded-video',
        presetId: 'ref_preset_sowveil_hook',
        allowRemoteModelUpload: false,
        cancelledBeforeRemoteUpload: true,
        attributionText: 'Alice owned reference reel',
      }),
    });
    assert.equal(refRes.status, 201);
    const aliceRefSession = (await refRes.json()).data.session;

    // 3. Alice creates a Provider Hub connection with a raw API key
    const rawAliceSecret = 'sk-live-secret-alice-99999-do-not-leak';
    const connRes = await fetch(`${srv.baseUrl}/api/v1/provider-hub/connections`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        label: 'Alice Private OpenAI Endpoint',
        providerBrand: 'OpenAI',
        protocol: 'openai-chat-completions',
        baseUrl: 'https://api.openai.com',
        modelId: 'gpt-4o',
        authMode: 'bearer',
        credential: rawAliceSecret,
      }),
    });
    assert.equal(connRes.status, 201);
    const aliceConn = (await connRes.json()).data.connection;
    assert.ok(!JSON.stringify(aliceConn).includes(rawAliceSecret));

    // 4. Alice installs a sandboxed Extension
    const extRes = await fetch(`${srv.baseUrl}/api/v1/extensions`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        name: 'Alice Custom Kinetic Skill',
        kind: 'skill-folder',
        sourceUrl: 'https://github.com/sowveil/kinetic-skill',
        commitOrReleasePin: 'v1.2.0-89ab34cd',
        license: 'MIT',
        requestedPermissions: ['read-project', 'read-catalog'],
        rawInstructionOrManifestContent: '# Kinetic Skill\nSafe curve helper.',
        explicitApprovalGranted: true,
      }),
    });
    assert.equal(extRes.status, 201);
    const aliceExt = (await extRes.json()).data.extension;

    // 5. Alice creates an AI Director session with a confidential script
    const secretScriptPhrase = 'CONFIDENTIAL_LAUNCH_CODE_X99_DO_NOT_LOG';
    const dirRes = await fetch(`${srv.baseUrl}/api/v1/ai-director/sessions`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        title: 'Alice Confidential Script Run',
        scriptText: `Hook: ${secretScriptPhrase}. Scene two reveals the product metrics.`,
        intake: {
          intendedPlatform: 'tiktok-reels-shorts',
          targetDurationSec: 15,
          aspectRatio: '9:16',
        },
      }),
    });
    assert.equal(dirRes.status, 201);
    const aliceDirSession = (await dirRes.json()).data.session;

    // 6. Alice creates a Template Factory private draft
    const draftRes = await fetch(`${srv.baseUrl}/api/v1/template-factory/create`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        sourceKind: 'canonical-project',
        projectId: aliceProj.id,
        title: 'Alice Private Brand Template',
      }),
    });
    assert.equal(draftRes.status, 201);
    const aliceDraft = (await draftRes.json()).data.draft;

    // 7. Alice executes a Render/Export job
    const renderRes = await fetch(`${srv.baseUrl}/api/v1/render-export/jobs`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        projectId: aliceProj.id,
        executionTier: 'final-render',
        outputFormat: 'png-frame',
      }),
    });
    assert.equal(renderRes.status, 201);
    const aliceRenderJob = (await renderRes.json()).data.job;

    // --- VERIFY BOB CANNOT READ OR MUTATE ANY OF ALICE'S RESOURCES (IDOR BLOCKED) ---
    const bobGetProj = await fetch(`${srv.baseUrl}/api/v1/projects/${aliceProj.id}`, {
      headers: bobHeaders,
    });
    assert.equal(bobGetProj.status, 403);

    const bobCmdProj = await fetch(`${srv.baseUrl}/api/v1/projects/${aliceProj.id}/commands`, {
      method: 'POST',
      headers: bobHeaders,
      body: JSON.stringify({ type: 'undo' }),
    });
    assert.equal(bobCmdProj.status, 403);

    const bobGetRef = await fetch(
      `${srv.baseUrl}/api/v1/reference-lab/sessions/${aliceRefSession.id}`,
      { headers: bobHeaders }
    );
    assert.equal(bobGetRef.status, 403);

    const bobRotateKey = await fetch(
      `${srv.baseUrl}/api/v1/provider-hub/connections/${aliceConn.id}/rotate-key`,
      {
        method: 'POST',
        headers: bobHeaders,
        body: JSON.stringify({ credential: 'sk-bob-hijack' }),
      }
    );
    assert.equal(bobRotateKey.status, 403);

    const bobPatchExt = await fetch(`${srv.baseUrl}/api/v1/extensions/${aliceExt.id}`, {
      method: 'PATCH',
      headers: bobHeaders,
      body: JSON.stringify({ version: '9.9.9' }),
    });
    assert.equal(bobPatchExt.status, 403);

    const bobGetDir = await fetch(
      `${srv.baseUrl}/api/v1/ai-director/sessions/${aliceDirSession.id}`,
      { headers: bobHeaders }
    );
    assert.ok(bobGetDir.status === 403 || bobGetDir.status === 404);

    const bobPatchDraft = await fetch(
      `${srv.baseUrl}/api/v1/template-factory/drafts/${aliceDraft.id}`,
      {
        method: 'PATCH',
        headers: bobHeaders,
        body: JSON.stringify({ title: 'Bob Hijacked Draft' }),
      }
    );
    assert.equal(bobPatchDraft.status, 403);

    const bobDownloadRender = await fetch(
      `${srv.baseUrl}/api/v1/render-export/jobs/${aliceRenderJob.id}/download`,
      { headers: bobHeaders }
    );
    assert.equal(bobDownloadRender.status, 404);
  } finally {
    await srv.close();
  }
});

test('Phase 14.2: Cache partitioning, privacy-aware operational telemetry, and complete account data export & deletion', async () => {
  const srv = await startTestServer();
  try {
    const aliceHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-alice',
    };
    const bobHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-bob',
    };

    // 1. Public unauthenticated catalog uses public cache-control
    const pubCatRes = await fetch(`${srv.baseUrl}/api/v1/catalog?limit=5`);
    assert.equal(pubCatRes.status, 200);
    const pubCacheHeader = pubCatRes.headers.get('cache-control') || '';
    assert.ok(pubCacheHeader.includes('public'));

    // 2. Authenticated catalog and private endpoints strictly enforce no-store & private
    const authCatRes = await fetch(`${srv.baseUrl}/api/v1/catalog?limit=5`, {
      headers: aliceHeaders,
    });
    assert.equal(authCatRes.status, 200);
    const authCacheHeader = authCatRes.headers.get('cache-control') || '';
    assert.ok(authCacheHeader.includes('no-store') && authCacheHeader.includes('private'));

    // 3. Create records for Alice & Bob
    const rawAliceApiKey = 'sk-alice-vault-secret-777777';
    await fetch(`${srv.baseUrl}/api/v1/provider-hub/connections`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        label: 'Alice Vault Key Test',
        protocol: 'openai-chat-completions',
        baseUrl: 'https://api.openai.com',
        modelId: 'gpt-4o',
        authMode: 'bearer',
        credential: rawAliceApiKey,
      }),
    });

    const rawScriptText = 'PRIVATE_SCRIPT_PASSAGE_NEVER_IN_TELEMETRY_LOGS_8888';
    await fetch(`${srv.baseUrl}/api/v1/ai-director/sessions`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        title: 'Alice Script Privacy Test',
        scriptText: rawScriptText,
      }),
    });

    await fetch(`${srv.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers: bobHeaders,
      body: JSON.stringify({
        title: 'Bob Independent Project',
        description: 'Bob workspace project',
        compCount: 1,
        projectFileStatus: 'sowveil-native',
        fileSizeLabel: '500 KB',
        resolution: '1080x1920',
        durationLabel: '00:05',
        fps: 30,
        aeVersion: 'Sowveil 2.4',
        hasExternalFootageWarning: false,
        archived: false,
        tags: ['bob'],
      }),
    });

    // 4. Verify operational telemetry endpoint & sensitive payload rejection
    const rejectTelemetryRes = await fetch(`${srv.baseUrl}/api/v1/telemetry/opt-in`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        optInAggregateUsage: true,
        rawScript: 'should be rejected',
      }),
    });
    assert.equal(rejectTelemetryRes.status, 400);

    const optInRes = await fetch(`${srv.baseUrl}/api/v1/telemetry/opt-in`, {
      method: 'POST',
      headers: aliceHeaders,
      body: JSON.stringify({
        optInAggregateUsage: true,
        featureEventKey: 'editor_timeline_scrub',
      }),
    });
    assert.equal(optInRes.status, 200);
    const optInData = (await optInRes.json()).data;
    assert.equal(optInData.optInAggregateUsage, true);
    assert.equal(optInData.aggregateFeatureCounters.editor_timeline_scrub, 1);

    const opTelRes = await fetch(`${srv.baseUrl}/api/v1/telemetry/operational`, {
      headers: aliceHeaders,
    });
    assert.equal(opTelRes.status, 200);
    assert.ok((opTelRes.headers.get('cache-control') || '').includes('no-store'));
    const opTelBodyText = await opTelRes.text();
    assert.ok(!opTelBodyText.includes(rawAliceApiKey), 'Telemetry must never contain API keys');
    assert.ok(!opTelBodyText.includes(rawScriptText), 'Telemetry must never contain raw scripts');
    const opTelData = JSON.parse(opTelBodyText).data;
    assert.equal(opTelData.privacyRedactionPolicy.logsRawScripts, false);
    assert.equal(opTelData.privacyRedactionPolicy.logsApiKeysOrTokens, false);

    // 5. Export Alice's account data and verify completeness + secret redaction
    const exportRes = await fetch(`${srv.baseUrl}/api/v1/me/data-export`, {
      headers: aliceHeaders,
    });
    assert.equal(exportRes.status, 200);
    const exportText = await exportRes.text();
    assert.ok(!exportText.includes(rawAliceApiKey), 'Data export must never leak raw secret keys');
    const exportData = JSON.parse(exportText).data;
    assert.equal(exportData.profile.uid, 'uid_alice');
    assert.equal(exportData.aiDirectorSessions.length, 1);
    assert.ok(exportData.providerConnectionsRedacted.length >= 1);

    // 6. Verify Account Deletion requires confirmation and then purges all of Alice's data while preserving Bob's data
    const unconfirmedDel = await fetch(`${srv.baseUrl}/api/v1/me/account-data`, {
      method: 'DELETE',
      headers: aliceHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(unconfirmedDel.status, 400);

    const confirmedDel = await fetch(`${srv.baseUrl}/api/v1/me/account-data`, {
      method: 'DELETE',
      headers: aliceHeaders,
      body: JSON.stringify({ confirmDelete: 'DELETE_MY_ACCOUNT_DATA' }),
    });
    assert.equal(confirmedDel.status, 200);
    const delResult = (await confirmedDel.json()).data;
    assert.equal(delResult.deletedUid, 'uid_alice');
    assert.equal(delResult.secretVaultPurged, true);
    assert.equal(delResult.deletedCounts.aiDirectorSessions, 1);
    assert.ok(delResult.deletedCounts.providerConnectionsAndVaultKeys >= 1);

    // Verify Alice's AI Director sessions are now 0
    const aliceAfterExport = await fetch(`${srv.baseUrl}/api/v1/me/data-export`, {
      headers: aliceHeaders,
    });
    const aliceAfterData = (await aliceAfterExport.json()).data;
    assert.equal(aliceAfterData.aiDirectorSessions.length, 0);
    assert.equal(aliceAfterData.projects.length, 0);

    // Verify Bob's project is untouched
    const bobProjectsRes = await fetch(`${srv.baseUrl}/api/v1/projects`, {
      headers: bobHeaders,
    });
    const bobProjectsData = (await bobProjectsRes.json()).data;
    assert.equal(bobProjectsData.total, 1);
    assert.equal(bobProjectsData.items[0].title, 'Bob Independent Project');
  } finally {
    await srv.close();
  }
});
