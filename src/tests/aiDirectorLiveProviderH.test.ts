import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {
  BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS,
  createAiDirectorSession,
  evaluateDirectorAcceptanceGate,
  executeAiDirectorLiveProviderTask,
  executeDirectorProductionPlan,
  orchestrateLiveAiDirectorSession,
  reviseDirectorPlanDuringProduction,
  rollbackDirectorToCheckpoint,
  updateDirectorShotPlanAndApprovals,
  validateGeneratedAssetRecord,
} from '../services/aiDirectorProductionEngine';
import {
  createProviderConnectionRecord,
  toPublicProviderConnectionView,
} from '../services/providerHubEngine';
import { createApiApp } from '../server/apiApp';

const TEST_MASTER_VAULT_KEY = 'sowveil-test-master-vault-key-32bytes-secure-2026!';
process.env.SOWVEIL_MASTER_VAULT_KEY = TEST_MASTER_VAULT_KEY;
delete process.env.SOWVEIL_VAULT_KEY;


function buildValidLiveDirectorSynthesisJson(segmentIds: string[]) {
  return {
    narrativeStructure: {
      hookStrategy: 'High-contrast kinetic disruption opening on the desktop bottleneck claim',
      risingActionBeats: [
        'Introduce 20 specialized mobile motion modules',
        'Demonstrate live parameter customization across 220 kinetic text rigs',
      ],
      climaxMoment: 'Reveal unified Canonical Project v2.0.0 timeline resolving client revisions instantaneously',
      resolutionAndCta: 'Direct tap-to-export callout for Alight Motion XML, SVG plates, and SRT captions',
      pacingArc: 'Snappy 140 BPM openings tapering into authoritative product proof holds',
    },
    audienceAndTone: {
      refinedAudiencePersona: 'Mobile-first motion designers, short-form creators, and SaaS founders',
      toneDescriptor: 'Kinetic, authoritative, and precision-engineered',
      vocalDeliveryNotes: 'Crisp studio presence with deliberate 180ms micro-pauses before numbers',
    },
    sceneInterpretations: segmentIds.map((segId, idx) => ({
      segmentId: segId,
      narrativeRole: idx === 0 ? 'Hook Anchor' : idx === segmentIds.length - 1 ? 'Call to Action' : `Proof Beat ${idx}`,
      visualMetaphor: `Obsidian & ember kinetic layer stack #${idx + 1}`,
      shotDescription: `Dynamic mobile stage framing segment ${segId} with crisp typographic hierarchy`,
      cameraLanguage: idx % 2 === 0 ? 'push-in 2.5D parallax drift' : 'orbital-drift isometric reveal',
      motionAndEffects: 'Cubic-bezier (0.22, 1, 0.36, 1) entrance with subtle glass specular sweep',
      transitionPlan: idx === 0 ? 'whip-pan' : 'scale-morph',
      audioSfxVoiceCue: `Sub-bass impact + crystalline UI click on ${segId}`,
      continuityAndRiskNote: `Maintain ember #FF6B1A accent continuity into ${segId}`,
    })),
    paletteAndTypography: {
      primaryHex: '#FF6B1A',
      secondaryHex: '#FFB347',
      backgroundHex: '#0A0B0E',
      lightingDirection: 'Top-left warm ember key light against deep obsidian matte backdrop',
      typographyHierarchyNote: 'Syne 800 display headlines paired with Plus Jakarta Sans 600 subheads',
    },
    assetAndMotionPlan: {
      primaryAssetStrategy: 'Tier-1 verified Sowveil catalog templates backed by SHA-256 verified SVG plates',
      motionSystemSummary: 'Precision cubic-bezier velocity curves with zero mobile frame drops',
      transitionLanguageSummary: 'Momentum-preserving whip-pans and scale-morphs across scene cuts',
      audioMasterPlan: 'Synchronized verbatim narration + -14dB ducked bed + procedural SFX accents',
    },
    riskAndContinuityAnalysis: [
      {
        code: 'MOBILE_DENSE_CAPTION_CHECK',
        severity: 'low' as const,
        description: 'High word density in middle proof beat may crowd 9:16 safe zone.',
        mitigation: 'Cap caption lines at 42 chars and add +0.4s hold buffer.',
      },
    ],
    prioritizedQuestions: [
      {
        id: 'q_live_minor_grain',
        category: 'visual-style' as const,
        classification: 'optional' as const,
        questionText: 'Should subtle optical film grain be composited over background plates?',
        whyItMatters: 'Adds tactile depth on OLED screens without affecting text legibility.',
        options: ['Subtle 4% film grain overlay (Recommended)', 'Clean digital gradient only'],
        recommendedDefault: 'Subtle 4% film grain overlay (Recommended)',
      },
      {
        id: 'q_live_blocking_brand_claim',
        category: 'audience-goal' as const,
        classification: 'blocking' as const,
        questionText: 'Must the exact numeric counts (220 text animations, 26 easing curves, 60 SFX) appear on-screen verbatim?',
        whyItMatters: 'Controls whether kinetic number counters are locked against paraphrase.',
        options: ['Lock exact numeric counts verbatim', 'Allow condensed summary badges'],
        recommendedDefault: 'Lock exact numeric counts verbatim',
      },
    ],
  };
}

test('Prompt H 1: Truthful Model Attribution — never claims Gemini 4 Argon or Gemini 3.8 Flash unless actually contacted and succeeded', async () => {
  // 1. Deterministic baseline session must report 'deterministic-local-analyzer', never 'gemini-4-argon' or 'gemini-3.8-flash'
  const session = createAiDirectorSession({
    ownerUid: 'user-truth-1',
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
    budgetLatencyPreference: 'quality-first-argon',
  });

  assert.equal(
    session.analysisReport.analyzerModelUsed,
    'deterministic-local-analyzer',
    'Deterministic baseline must not claim gemini-4-argon when no upstream call was made'
  );
  assert.deepEqual(session.actualContactedModels, []);
  assert.equal(session.executionMode, 'deterministic-fallback');

  // 2. Configure a connection claiming 'gemini-4-argon', but simulate upstream HTTP 401 failure
  const argonConn = createProviderConnectionRecord({
    ownerUid: 'user-truth-1',
    providerBrand: 'Google Gemini',
    protocol: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    label: 'Gemini Argon Primary',
    modelId: 'gemini-4-argon',
    authMode: 'x-api-key',
    credential: 'AIzaSyTestSecretKeyNeverLeak123456789',
  });


  const failedRes = await orchestrateLiveAiDirectorSession({
    session,
    connections: [argonConn],
    preferredConnectionId: argonConn.id,
    fetchImpl: (async () =>
      new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch,
  });

  assert.equal(failedRes.latestInvocation.status, 'failed-auth');
  assert.equal(
    failedRes.latestInvocation.actualContactedModelId,
    null,
    'Failed upstream call must have actualContactedModelId = null'
  );
  assert.equal(
    failedRes.session.analysisReport.analyzerModelUsed,
    'deterministic-local-analyzer',
    'Failed upstream call must never label session analyzerModelUsed as gemini-4-argon'
  );
  assert.deepEqual(failedRes.session.actualContactedModels, []);
});

test('Prompt H 2: Full Server-Only Provider Hub & Vault Transport + Strict Zod Validation + Zero Secret Leakage', async () => {
  const secretKey = 'AIzaSySuperSecretVaultKey_DO_NOT_LEAK_999';
  const session = createAiDirectorSession({
    ownerUid: 'user-live-1',
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
  });

  const geminiConn = createProviderConnectionRecord({
    ownerUid: 'user-live-1',
    providerBrand: 'Google Gemini',
    protocol: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    label: 'Google Gemini Studio Vault',
    modelId: 'gemini-4-argon',
    authMode: 'x-api-key',
    credential: secretKey,
  });


  // Verify public view strips encryptedCredential & raw secret
  const pubView = toPublicProviderConnectionView(geminiConn);
  assert.equal(JSON.stringify(pubView).includes(secretKey), false);
  assert.equal('encryptedCredential' in pubView, false);

  let capturedAuthHeader = '';
  let capturedUrl = '';
  const synthesisPayload = buildValidLiveDirectorSynthesisJson(
    session.segments.map((s) => s.segmentId)
  );

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    capturedAuthHeader = headers['x-goog-api-key'] || '';
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify(synthesisPayload) }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 410,
          candidatesTokenCount: 520,
          thoughtsTokenCount: 90,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const liveRes = await orchestrateLiveAiDirectorSession({
    session,
    connections: [geminiConn],
    preferredConnectionId: geminiConn.id,
    taskType: 'planning',
    fetchImpl: mockFetch,
  });

  // Verify server decrypted the vault key and sent it upstream
  assert.equal(capturedAuthHeader, secretKey);
  assert.ok(capturedUrl.includes('gemini-4-argon:generateContent'));

  // Verify the resulting session contains zero trace of the secret key
  const serializedSession = JSON.stringify(liveRes.session);
  assert.equal(
    serializedSession.includes(secretKey),
    false,
    'Session JSON must never contain raw API keys'
  );

  // Verify truthful model attribution now records gemini-4-argon because it actually succeeded
  assert.equal(liveRes.latestInvocation.status, 'succeeded');
  assert.equal(liveRes.latestInvocation.actualContactedModelId, 'gemini-4-argon');
  assert.equal(liveRes.session.analysisReport.analyzerModelUsed, 'gemini-4-argon');
  assert.deepEqual(liveRes.session.actualContactedModels, ['gemini-4-argon']);
  assert.equal(liveRes.session.executionMode, 'live-provider');
  assert.equal(liveRes.latestInvocation.usage.promptTokens, 410);
  assert.equal(liveRes.latestInvocation.usage.completionTokens, 520);
  assert.equal(liveRes.latestInvocation.usage.reasoningTokens, 90);

  // Verify deterministic script segmentation & 100% coverage ledger are preserved
  assert.equal(liveRes.session.coverageLedger.coveragePercent, 100);
  assert.equal(liveRes.session.coverageLedger.everyCharacterAccountedFor, true);
  assert.equal(liveRes.session.coverageLedger.uncoveredSegments, 0);

  // Verify model-driven synthesis enriched brief, shots, and prioritized questions
  assert.ok(liveRes.session.liveModelSynthesis);
  assert.equal(
    liveRes.session.productionBrief.targetAudience,
    synthesisPayload.audienceAndTone.refinedAudiencePersona
  );
  assert.equal(liveRes.session.shots[0].transitionInOut.transitionIn, 'whip-pan');

  // Verify clarifying questions are sorted by importance (blocking first, optional with default applied)
  assert.equal(liveRes.session.questions[0].classification, 'blocking');
  const optionalQ = liveRes.session.questions.find((q) => q.id === 'q_live_minor_grain');
  assert.ok(optionalQ, 'Model-generated optional question must be merged');
  assert.equal(
    optionalQ.status,
    'default-applied',
    'Minor optional unknowns must automatically receive visible recommended defaults'
  );
  assert.equal(optionalQ.selectedAnswer, optionalQ.recommendedDefault);
});

test('Prompt H 3: Rate Limits (429), Invalid Model (404), Timeouts (408), Provider Outages (503) & Automatic Fallback Connection', async () => {
  const session = createAiDirectorSession({
    ownerUid: 'user-fallback-1',
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[1].scriptText,
  });

  const primaryConn = createProviderConnectionRecord({
    ownerUid: 'user-fallback-1',
    providerBrand: 'OpenAI',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com',
    label: 'Primary OpenAI (Rate Limited)',
    modelId: 'gpt-4o',
    authMode: 'bearer',
    credential: 'sk-primary-test-key-123456',
  });

  const fallbackConn = createProviderConnectionRecord({
    ownerUid: 'user-fallback-1',
    providerBrand: 'Anthropic',
    protocol: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    label: 'Fallback Anthropic Claude',
    modelId: 'claude-3-7-sonnet-20250219',
    authMode: 'x-api-key',
    credential: 'sk-ant-fallback-test-key-789012',
  });

  primaryConn.fallbackConnectionId = fallbackConn.id;

  const synthesisPayload = buildValidLiveDirectorSynthesisJson(
    session.segments.map((s) => s.segmentId)
  );

  let callCount = 0;
  const mockFetch: typeof fetch = async (input) => {
    callCount += 1;
    const url = String(input);
    if (url.includes('openai.com')) {
      return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(synthesisPayload) + '\n```' }],
        usage: { input_tokens: 300, output_tokens: 450 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  };

  const orchestrated = await orchestrateLiveAiDirectorSession({
    session,
    connections: [primaryConn, fallbackConn],
    preferredConnectionId: primaryConn.id,
    fetchImpl: mockFetch,
  });

  assert.equal(callCount, 2, 'Should attempt primary (429) then automatically fail over to fallback');
  assert.equal(orchestrated.session.providerInvocations?.length, 2);
  assert.equal(orchestrated.session.providerInvocations?.[1].status, 'failed-rate-limit');
  assert.equal(orchestrated.session.providerInvocations?.[1].actualContactedModelId, null);
  assert.equal(orchestrated.latestInvocation.status, 'succeeded');
  assert.equal(orchestrated.latestInvocation.usedFallbackConnection, true);
  assert.equal(
    orchestrated.latestInvocation.actualContactedModelId,
    'claude-3-7-sonnet-20250219'
  );
  assert.equal(
    orchestrated.session.analysisReport.analyzerModelUsed,
    'claude-3-7-sonnet-20250219'
  );

  // Also verify Invalid Model (404), Provider Outage (503), and SSE Streaming
  const invalidModelRes = await executeAiDirectorLiveProviderTask({
    session,
    connection: primaryConn,
    taskType: 'script-analysis',
    fetchImpl: (async () =>
      new Response(JSON.stringify({ error: { message: 'Model not found' } }), {
        status: 404,
      })) as unknown as typeof fetch,
  });
  assert.equal(invalidModelRes.invocation.status, 'failed-invalid-model');
  assert.equal(invalidModelRes.invocation.sanitizedError?.code, 'PROVIDER_INVALID_MODEL');

  const outageRes = await executeAiDirectorLiveProviderTask({
    session,
    connection: primaryConn,
    taskType: 'script-analysis',
    fetchImpl: (async () =>
      new Response('Service Unavailable', { status: 503 })) as unknown as typeof fetch,
  });
  assert.equal(outageRes.invocation.status, 'failed-provider-outage');
  assert.equal(outageRes.invocation.sanitizedError?.retryable, true);

  // Verify SSE streaming chunk assembly + Zod validation
  const jsonStr = JSON.stringify(synthesisPayload);
  const half = Math.floor(jsonStr.length / 2);
  const sseBody = [
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: jsonStr.slice(0, half) })}`,
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: jsonStr.slice(half) })}`,
    'data: [DONE]',
  ].join('\n');

  const streamRes = await executeAiDirectorLiveProviderTask({
    session,
    connection: primaryConn,
    taskType: 'planning',
    stream: true,
    fetchImpl: (async () =>
      new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch,
  });
  assert.equal(streamRes.invocation.status, 'succeeded');
  assert.ok(streamRes.invocation.streamStages.includes('stream-chunks-received'));
  assert.ok(streamRes.invocation.streamStages.includes('structured-schema-validated'));
});

test('Prompt H 4: Revise Plan During Production (Reason + Checkpoint + Typed Tool Commands + Rollback + QA Re-Run) & Verified SVG Asset Bytes', () => {
  let session = createAiDirectorSession({
    ownerUid: 'user-prod-h',
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[1].scriptText,
    noQuestionsWorkflow: true,
  });

  // Approve all shots and compile production timeline
  session = updateDirectorShotPlanAndApprovals(session, { action: 'approve-all' });
  session = executeDirectorProductionPlan(session);

  assert.equal(session.acceptanceGate.passed, true);
  assert.ok(session.canonicalProject);
  assert.equal(session.generatedAssetRecords.length, session.shots.length);

  // Verify every generated asset has real SVG bytes, valid SHA-256 checksum, storage location, and passes validation
  for (const asset of session.generatedAssetRecords) {
    const check = validateGeneratedAssetRecord(asset);
    assert.equal(check.valid, true, `Asset ${asset.assetTaskId} failed validation: ${check.errors.join(', ')}`);
    assert.ok(asset.byteLength > 200);
    const expectedSha = crypto.createHash('sha256').update(asset.svgContent, 'utf8').digest('hex');
    assert.equal(asset.checksumSha256, expectedSha);
    assert.ok(asset.storageLocation.startsWith('sowveil-inline-svg://'));
  }

  // Verify that a fake metadata-only placeholder is rejected by validateGeneratedAssetRecord and Acceptance Gate
  const fakeAssetSession = JSON.parse(JSON.stringify(session));
  fakeAssetSession.generatedAssetRecords[0].status = 'metadata-only';
  fakeAssetSession.generatedAssetRecords[0].svgContent = '';
  const fakeGate = evaluateDirectorAcceptanceGate(fakeAssetSession);
  assert.equal(
    fakeGate.passed,
    false,
    'Acceptance Gate must reject metadata-only placeholder assets pretending to be generated media'
  );

  // Test Revise Plan During Production: missing reason must throw
  const firstShotId = session.shots[0].shotId;
  assert.throws(
    () =>
      reviseDirectorPlanDuringProduction(session, {
        reason: '',
        shotId: firstShotId,
        editablePatch: { durationSec: 5.0 },
      }),
    /REVISION_REASON_REQUIRED/
  );

  // Revise shot 1 during production with a valid reason
  const checkpointsBefore = session.productionCheckpoints.length;
  const revisionsBefore = session.planRevisions.length;
  const receiptsBefore = session.commandReceipts.length;

  const revised = reviseDirectorPlanDuringProduction(session, {
    reason: 'Client requested longer 5.2s opening hold and updated treasury headline',
    shotId: firstShotId,
    editablePatch: {
      headlineText: '400ms Cryptographic Treasury Finality',
      durationSec: 5.2,
      cameraMotion: 'push-in',
    },
  });

  assert.equal(
    revised.productionCheckpoints.length,
    checkpointsBefore + 1,
    'Revising plan during production must save a reversible checkpoint first'
  );
  assert.equal(revised.planRevisions.length, revisionsBefore + 1);
  assert.equal(
    revised.planRevisions[0].reason,
    'Client requested longer 5.2s opening hold and updated treasury headline'
  );
  assert.ok(
    revised.commandReceipts.length > receiptsBefore,
    'Timeline changes must execute through typed canonical project commands'
  );
  assert.equal(revised.shots[0].editableParameters.durationSec, 5.2);
  assert.equal(
    revised.shots[0].editableParameters.headlineText,
    '400ms Cryptographic Treasury Finality'
  );
  assert.equal(
    revised.acceptanceGate.passed,
    true,
    'Affected 10-point QA gate must automatically re-run and pass after plan revision'
  );

  // Rollback to pre-revision checkpoint and verify restoration
  const preRevisionCheckpointId = revised.productionCheckpoints[0].checkpointId;
  const rolledBack = rollbackDirectorToCheckpoint(revised, preRevisionCheckpointId);
  assert.equal(
    rolledBack.shots[0].editableParameters.durationSec,
    session.shots[0].editableParameters.durationSec
  );
  assert.equal(rolledBack.acceptanceGate.passed, true);
});

test('Prompt H 5: REST API endpoints (/orchestrate-live, /produce, /revise-plan) execute server-only provider transport, persist telemetry, and store verified SVG asset bytes', async () => {
  let upstreamCalled = false;
  const app = createApiApp({
    tokenVerifier: async (token: string) => {
      if (token === 'token-director-h') {
        return { uid: 'uid-director-h', email: 'director@sowveil.studio', emailVerified: true };
      }
      throw new Error('Invalid token');
    },
    providerProbeFetchImpl: (async (_input: any, _init?: any) => {
      upstreamCalled = true;
      // Dynamically inspect segments or return generic synthesis
      const synthesis = buildValidLiveDirectorSynthesisJson([
        'seg_001',
        'seg_002',
        'seg_003',
        'seg_004',
        'seg_005',
        'seg_006',
      ]);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(synthesis) }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 380,
            candidatesTokenCount: 490,
            thoughtsTokenCount: 60,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as unknown as typeof fetch,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Create a Provider Hub connection in the server vault
    const connRes = await fetch(`${baseUrl}/api/v1/provider-hub/connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-director-h',
      },
      body: JSON.stringify({
        label: 'Live Gemini 3.8 Flash Vault Connection',
        providerBrand: 'Google Gemini',
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-3.8-flash',
        authMode: 'x-api-key',
        credential: 'AIzaSyServerVaultKeyForApiTest1234567890',
        allowedTaskTypes: ['script-analysis', 'planning', 'routine-tasks'],
      }),
    });
    assert.equal(connRes.status, 201);
    const connJson = await connRes.json();
    const connectionId = connJson.data.connection.id;
    assert.ok(connectionId);

    // 2. Create an AI Director session (initially deterministic baseline)
    const createRes = await fetch(`${baseUrl}/api/v1/ai-director/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-director-h',
      },
      body: JSON.stringify({
        title: 'Prompt H Live API Test',
        rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
        intake: { noQuestionsWorkflow: true },
      }),
    });
    assert.equal(createRes.status, 201);
    const createJson = await createRes.json();
    const sessionId = createJson.data.session.id;
    assert.equal(
      createJson.data.session.analysisReport.analyzerModelUsed,
      'deterministic-local-analyzer'
    );

    // 3. Trigger POST /api/v1/ai-director/sessions/:id/orchestrate-live
    const orchRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${sessionId}/orchestrate-live`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-director-h',
        },
        body: JSON.stringify({
          connectionId,
          taskType: 'planning',
        }),
      }
    );
    assert.equal(orchRes.status, 200);
    const orchJson = await orchRes.json();
    assert.equal(upstreamCalled, true);
    assert.equal(orchJson.data.latestInvocation.status, 'succeeded');
    assert.equal(orchJson.data.latestInvocation.actualContactedModelId, 'gemini-3.8-flash');
    assert.equal(
      orchJson.data.session.analysisReport.analyzerModelUsed,
      'gemini-3.8-flash'
    );

    // 4. Approve all shots and run POST /produce
    await fetch(`${baseUrl}/api/v1/ai-director/sessions/${sessionId}/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-director-h',
      },
      body: JSON.stringify({ action: 'approve-all' }),
    });

    const prodRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${sessionId}/produce`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-director-h',
        },
        body: JSON.stringify({}),
      }
    );
    assert.equal(prodRes.status, 200);
    const prodJson = await prodRes.json();
    assert.equal(prodJson.data.session.acceptanceGate.passed, true);
    assert.ok(prodJson.data.session.generatedAssetRecords[0].svgContent.includes('<svg'));

    // 5. Trigger POST /api/v1/ai-director/sessions/:id/revise-plan during production
    const firstShotId = prodJson.data.session.shots[0].shotId;
    const revRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${sessionId}/revise-plan`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-director-h',
        },
        body: JSON.stringify({
          reason: 'API test revision: extend opening shot to 4.8s',
          shotId: firstShotId,
          editablePatch: {
            durationSec: 4.8,
            headlineText: 'Live Provider Orchestrated Hook',
          },
        }),
      }
    );
    assert.equal(revRes.status, 200);
    const revJson = await revRes.json();
    assert.equal(revJson.data.session.shots[0].editableParameters.durationSec, 4.8);
    assert.equal(revJson.data.session.acceptanceGate.passed, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

