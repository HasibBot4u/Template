import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  applyAdaptiveRefinement,
  BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS,
  computeDirector12StepWorkflow,
  createAiDirectorSession,
  DETERMINISTIC_NO_PROVIDER_BANNER,
  DIRECTOR_12_STEP_WORKFLOW_DEFINITIONS,
  executeDirectorProductionPlan,
  orchestrateLiveAiDirectorSession,
  promoteValidatedDirectorAssets,
  resolveDirectorModelRouterConnection,
  reviseDirectorPlanDuringProduction,
  updateDirectorShotPlanAndApprovals,
  validateAndSanitizeDirectorToolCalls,
} from '../services/aiDirectorProductionEngine';
import {
  buildDefaultRoutingProfiles,
  createProviderConnectionRecord,
  toPublicProviderConnectionView,
} from '../services/providerHubEngine';
import { isProviderConnectionReadyForLiveInvocation } from '../server/credentialVault';
import { createApiApp } from '../server/apiApp';
import {
  executeAuthenticatedApiRequest,
  setDefaultAuthTokenResolverForTesting,
} from '../services/apiClient';
import { sharedCanonicalEditorSession } from '../services/canonicalEditorSession';
import { AiDirectorWorkspace } from '../components/AiDirectorWorkspace';
import { LandscapeCreativeStudio } from '../components/LandscapeCreativeStudio';

const TEST_MASTER_VAULT_KEY = 'sowveil-test-master-vault-key-32bytes-secure-2026!';
process.env.SOWVEIL_MASTER_VAULT_KEY = TEST_MASTER_VAULT_KEY;
delete process.env.SOWVEIL_VAULT_KEY;

function buildMockDirectorStructuredResponse(segmentIds: string[]) {
  return {
    narrativeStructure: {
      hookStrategy: 'Disruptive mobile timeline thesis on frame 1',
      risingActionBeats: [
        'Contrast 6-inch mobile screen vs desktop keyframe clutter',
        'Highlight 20 modules & 220 kinetic text presets',
      ],
      climaxMoment: 'Show instant Canonical Project v2.0.0 timeline compilation',
      resolutionAndCta: 'Export to Alight Motion XML, SVG plates, and SRT captions',
      pacingArc: 'Fast 140 BPM hook into authoritative product proof holds',
    },
    audienceAndTone: {
      refinedAudiencePersona: 'Mobile motion designers & short-form editors',
      toneDescriptor: 'Kinetic, high-contrast, authoritative',
      vocalDeliveryNotes: 'Crisp studio narration with 150ms micro-pauses before numbers',
    },
    sceneInterpretations: segmentIds.map((segId, idx) => ({
      segmentId: segId,
      narrativeRole: idx === 0 ? 'Hook' : idx === segmentIds.length - 1 ? 'CTA' : `Beat ${idx}`,
      visualMetaphor: `Obsidian & ember kinetic layer stack #${idx + 1}`,
      shotDescription: `Mobile stage framing ${segId} with high-contrast kinetic typography`,
      cameraLanguage: idx % 2 === 0 ? 'push-in' : 'orbital-drift',
      motionAndEffects: 'Cubic-bezier (0.22, 1, 0.36, 1) entrance',
      transitionPlan: idx === 0 ? 'whip-pan' : 'scale-morph',
      audioSfxVoiceCue: `Sub-bass impact + UI click on ${segId}`,
      continuityAndRiskNote: `Maintain ember #F06424 accent continuity into ${segId}`,
    })),
    paletteAndTypography: {
      primaryHex: '#F06424',
      secondaryHex: '#E4B45A',
      backgroundHex: '#0B0A09',
      lightingDirection: 'Top-left warm ember key light against deep obsidian matte backdrop',
      typographyHierarchyNote: 'Inter 800 display headlines with 600 subheads',
    },
    assetAndMotionPlan: {
      primaryAssetStrategy: 'Tier-1 verified Sowveil catalog templates + SHA-256 SVG plates',
      motionSystemSummary: 'Cubic-bezier velocity curves with zero frame drops',
      transitionLanguageSummary: 'Momentum-preserving whip-pans across cuts',
      audioMasterPlan: 'Synchronized narration + ducked bed + procedural SFX accents',
    },
    riskAndContinuityAnalysis: [
      {
        code: 'MOBILE_SAFE_ZONE_CHECK',
        severity: 'low' as const,
        description: 'Dense proof beat caption could approach bottom gesture bar.',
        mitigation: 'Constrain caption safe zone and add +0.4s hold buffer.',
      },
    ],
    prioritizedQuestions: [
      {
        id: 'q_live_brand_counts',
        category: 'audience-goal' as const,
        classification: 'important' as const,
        questionText: 'Should numeric module counts (220 text animations, 26 easings, 60 SFX) remain verbatim?',
        whyItMatters: 'Ensures factual parity with the Sowveil 20-module catalog.',
        options: ['Keep exact numeric counts verbatim', 'Summarize counts'],
        recommendedDefault: 'Keep exact numeric counts verbatim',
      },
    ],
  };
}

test('Phase 10.1 & 10.3: AiDirectorWorkspace & App route obtain Firebase ID token via shared apiClient without optional props and show "No provider configured — deterministic baseline only"', async () => {
  const savedGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const unconfiguredServerEnvConn = createProviderConnectionRecord({
      ownerUid: 'user-route-auth-1',
      label: 'Unconfigured Server Env Connection',
      providerBrand: 'Google Gemini',
      protocol: 'google-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      modelId: 'gemini-4-argon',
      authMode: 'server-env',
    });
    assert.equal(
      isProviderConnectionReadyForLiveInvocation(unconfiguredServerEnvConn),
      false,
      'server-env connection without GEMINI_API_KEY in env must not be treated as ready for live invocation'
    );
    const pubView = toPublicProviderConnectionView(unconfiguredServerEnvConn);
    assert.ok(pubView.maskedCredential.includes('not set'));

    // 2. Render AiDirectorWorkspace exactly as mounted in App.tsx (/app/ai-director) WITHOUT getAuthToken or authToken props
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/app/ai-director'] },
        React.createElement(AiDirectorWorkspace, {
          userUid: 'user-route-auth-1',
          onBackToReference: () => {},
        })
      )
    );
    assert.ok(
      html.includes(DETERMINISTIC_NO_PROVIDER_BANNER),
      'AiDirectorWorkspace must display "No provider configured — deterministic baseline only" when no provider is configured'
    );
    assert.ok(
      html.includes('data-testid="director-12-step-workflow-bar"'),
      'AiDirectorWorkspace must render the explicit 12-Step Production Pipeline bar'
    );

    // 3. Verify shared authenticated API client uses getFirebaseIdToken when getAuthToken prop is omitted
    let capturedAuthHeader: string | null = null;
    setDefaultAuthTokenResolverForTesting(async () => 'firebase-id-token-from-shared-client-999');
    try {
      const res = await executeAuthenticatedApiRequest<{ items: unknown[] }>(
        '/api/v1/ai-director/sessions',
        {
          fetchImpl: (async (_url: RequestInfo | URL, init?: RequestInit) => {
            const headers = (init?.headers || {}) as Record<string, string>;
            capturedAuthHeader = headers.Authorization || null;
            return new Response(
              JSON.stringify({ ok: true, data: { items: [] } }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }) as typeof fetch,
        }
      );
      assert.equal(res.ok, true);
      assert.equal(capturedAuthHeader, 'Bearer firebase-id-token-from-shared-client-999');
    } finally {
      setDefaultAuthTokenResolverForTesting(null);
    }
  } finally {
    if (savedGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = savedGeminiKey;
    }
  }
});

test('Phase 10.2: Embedded LandscapeCreativeStudio AI Director panel is connected to the same orchestration service and shows truthful deterministic baseline banner', () => {
  const demoDoc = sharedCanonicalEditorSession.getState().project;
  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/app/landscape-studio'] },
      React.createElement(LandscapeCreativeStudio, {
        initialProject: demoDoc,
        catalogItems: [],
        projects: [],
        ownerUid: 'user-landscape-director-1',
        initialRightPanelTab: 'director',
      })
    )
  );

  // Verify the embedded AI Director panel renders the truthful provider banner, 12-step pipeline, and orchestration controls
  assert.ok(
    html.includes('data-testid="embedded-director-provider-banner"'),
    'Embedded Landscape Studio AI panel must render truthful provider status banner'
  );
  assert.ok(
    html.includes(DETERMINISTIC_NO_PROVIDER_BANNER),
    'Embedded Landscape Studio AI panel must show "No provider configured — deterministic baseline only" when no provider is configured'
  );
  assert.ok(
    html.includes('data-testid="embedded-director-12-step-workflow"'),
    'Embedded Landscape Studio AI panel must render the 12-step production workflow'
  );
  assert.ok(
    html.includes('data-testid="embedded-director-analyze-btn"'),
    'Embedded Landscape Studio AI panel must expose Analyze & Plan action'
  );
  assert.ok(
    html.includes('data-testid="embedded-director-compile-btn"'),
    'Embedded Landscape Studio AI panel must expose Compile Timeline action'
  );
});

test('Phase 10.5 & 10.6: Model Router honors Gemini 4 Argon (planning) vs Gemini 3.8 Flash (routine) and Schema Validator rejects malformed/unsafe tool calls while retaining 100% script & segment IDs', async () => {
  const uid = 'user-router-test';
  const argonConn = createProviderConnectionRecord({
    ownerUid: uid,
    label: 'Primary Argon Planning Connection',
    providerBrand: 'Google Gemini',
    protocol: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    modelId: 'gemini-4-argon',
    authMode: 'x-api-key',
    credential: 'AIzaSyArgonTestKey1234567890',
    allowedTaskTypes: ['planning', 'script-analysis'],
  });
  const flashConn = createProviderConnectionRecord({
    ownerUid: uid,
    label: 'Fast Flash Routine Connection',
    providerBrand: 'Google Gemini',
    protocol: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    modelId: 'gemini-3.8-flash',
    authMode: 'x-api-key',
    credential: 'AIzaSyFlashTestKey1234567890',
    allowedTaskTypes: ['routine-tasks', 'evaluation'],
  });

  const conns = [argonConn, flashConn];
  const routingProfiles = buildDefaultRoutingProfiles(conns);

  // 1. Whole-script planning prefers Gemini 4 Argon
  const sessionArgon = createAiDirectorSession({
    ownerUid: uid,
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
    budgetLatencyPreference: 'quality-first-argon',
  });
  const routedPlanning = resolveDirectorModelRouterConnection({
    session: sessionArgon,
    connections: conns,
    routingProfiles,
    taskType: 'planning',
  });
  assert.equal(routedPlanning.primaryConnection?.modelId, 'gemini-4-argon');

  // 2. Cheaper routine task prefers Gemini 3.8 Flash
  const sessionFlash = createAiDirectorSession({
    ownerUid: uid,
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
    budgetLatencyPreference: 'low-cost-fast-flash',
  });
  const routedRoutine = resolveDirectorModelRouterConnection({
    session: sessionFlash,
    connections: conns,
    routingProfiles,
    taskType: 'routine-tasks',
  });
  assert.equal(routedRoutine.primaryConnection?.modelId, 'gemini-3.8-flash');

  // 3. Validate and sanitize tool calls: accept registered tool calls and reject unsafe/unregistered/destructive-unapproved tool calls
  const rawToolCalls: Array<{
    id?: string;
    name?: string;
    arguments?: Record<string, unknown>;
  }> = [
    {
      id: 'tc_valid_1',
      name: 'timeline.execute_command',
      arguments: {
        type: 'trimClip',
        clipId: 'clip_txt_shot_0001',
        trimOutSec: 4.2,
      },
    },
    {
      id: 'tc_unsafe_unregistered',
      name: 'executeArbitraryShellCommand',
      arguments: { cmd: 'rm -rf /' },
    },
    {
      id: 'tc_unsafe_traversal',
      name: 'timeline.execute_command',
      arguments: { clipId: '../../etc/passwd', secret: 'process.env.GEMINI_API_KEY' },
    },
    {
      id: 'tc_destructive_unapproved',
      name: 'project.delete_track_or_clip',
      arguments: { clipId: 'clip_txt_shot_0001' },
    },
  ];

  const toolValidation = validateAndSanitizeDirectorToolCalls(rawToolCalls);
  assert.equal(toolValidation.acceptedToolCalls.length, 1);
  assert.equal(toolValidation.acceptedToolCalls[0].name, 'timeline.execute_command');
  assert.equal(toolValidation.rejectedToolCalls.length, 3);

  // 4. Verify incomplete/malformed model output during orchestrateLiveAiDirectorSession retains 100% of script and stable segment IDs
  const originalSegments = sessionArgon.segments.map((s) => ({
    id: s.segmentId,
    text: s.exactOriginalText,
    start: s.startOffset,
    end: s.endOffset,
  }));

  const malformedOrchestration = await orchestrateLiveAiDirectorSession({
    session: sessionArgon,
    connections: conns,
    routingProfiles,
    preferredConnectionId: argonConn.id,
    taskType: 'planning',
    fetchImpl: (async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      incompleteField: 'missing required narrativeStructure and sceneInterpretations',
                    }),
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, totalTokenCount: 140 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as unknown as typeof fetch,
  });

  assert.equal(malformedOrchestration.latestInvocation.status, 'failed-schema-validation');
  assert.equal(
    malformedOrchestration.session.originalScriptText,
    sessionArgon.originalScriptText,
    'Full original script text must be retained when model output fails schema validation'
  );
  assert.deepEqual(
    malformedOrchestration.session.segments.map((s) => ({
      id: s.segmentId,
      text: s.exactOriginalText,
      start: s.startOffset,
      end: s.endOffset,
    })),
    originalSegments,
    'Stable segment IDs and exact character offsets must be retained when model output fails validation'
  );
});

test('Phase 10.7–10.14 (MOCK PROVIDER + TOOL TRANSPORT E2E TEST): Full 12-Step workflow, Canonical Command Proposals with preview/diff & approval gate, shared command bus execution, mid-production checkpoint delta, and draft asset promotion', async () => {
  // NOTE: This test is explicitly labeled as a MOCK PROVIDER TRANSPORT test — never a live provider test.
  const mockUid = 'user-mock-e2e-director';
  let mockUpstreamRequests = 0;

  const app = createApiApp({
    tokenVerifier: async (token: string) => {
      if (token === 'mock-e2e-token') {
        return {
          uid: mockUid,
          email: 'director-e2e@sowveil.studio',
          name: 'Director E2E Tester',
          emailVerified: true,
        };
      }
      throw new Error('Invalid token');
    },
    providerProbeFetchImpl: (async (url: string, init?: RequestInit) => {
      mockUpstreamRequests += 1;
      const bodyStr = typeof init?.body === 'string' ? init.body : '';
      const segMatches = Array.from(bodyStr.matchAll(/seg_\d{4}/g)).map((m) => m[0]);
      const uniqueSegIds =
        segMatches.length > 0 ? Array.from(new Set(segMatches)) : ['seg_0001', 'seg_0002'];
      const payload = buildMockDirectorStructuredResponse(uniqueSegIds);

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(payload) }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 380,
            candidatesTokenCount: 260,
            totalTokenCount: 640,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as unknown as typeof fetch,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer mock-e2e-token',
  };

  try {
    // 1. Create a session BEFORE configuring any provider -> must show "No provider configured — deterministic baseline only"
    const baselineRes = await fetch(`${baseUrl}/api/v1/ai-director/sessions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        title: 'Mock Transport E2E Launch Reel',
        rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
        intake: {
          noQuestionsWorkflow: true,
          autonomyMode: 'require-approval',
        },
      }),
    });
    assert.equal(baselineRes.status, 201);
    const baselineJson = await baselineRes.json();
    let session = baselineJson.data.session;
    assert.equal(session.providerStatusBanner, DETERMINISTIC_NO_PROVIDER_BANNER);
    assert.equal(session.workflowSteps.length, 12);
    assert.deepEqual(
      session.workflowSteps.map((s: { label: string }) => s.label),
      DIRECTOR_12_STEP_WORKFLOW_DEFINITIONS.map((d) => d.label)
    );
    assert.equal(
      session.workflowSteps[0].status,
      'completed-deterministic-baseline',
      'Deterministic step must never be labeled as completed-live-ai'
    );

    // 2. Register a Provider Hub connection for Gemini 4 Argon
    const connRes = await fetch(`${baseUrl}/api/v1/provider-hub/connections`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        label: 'Mock Transport Gemini 4 Argon',
        providerBrand: 'Google Gemini',
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-4-argon',
        authMode: 'x-api-key',
        credential: 'AIzaSyMockTransportArgonKey1234567890',
        allowedTaskTypes: ['script-analysis', 'planning', 'shot-planning'],
      }),
    });
    assert.equal(connRes.status, 201);
    const connJson = await connRes.json();
    const connectionId = connJson.data.connection.id;

    // 3. Invoke /orchestrate-live and verify actual model invocation evidence
    const liveRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${session.id}/orchestrate-live`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          connectionId,
          taskType: 'planning',
        }),
      }
    );
    assert.equal(liveRes.status, 200);
    const liveJson = await liveRes.json();
    session = liveJson.data.session;
    const inv = liveJson.data.latestInvocation;
    assert.equal(mockUpstreamRequests, 1);
    assert.equal(inv.status, 'succeeded');
    assert.equal(inv.actualContactedModelId, 'gemini-4-argon');
    assert.equal(inv.usage.totalTokens, 640);
    assert.ok(session.providerStatusBanner.includes('gemini-4-argon'));
    assert.equal(
      session.workflowSteps.find((s: { stepId: string }) => s.stepId === 'analyze')?.status,
      'completed-live-ai'
    );

    // 4. Approve plan and execute production (/produce)
    await fetch(`${baseUrl}/api/v1/ai-director/sessions/${session.id}/plan`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ action: 'approve-all' }),
    });

    const prodRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${session.id}/produce`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({}),
      }
    );
    assert.equal(prodRes.status, 200);
    const prodJson = await prodRes.json();
    session = prodJson.data.session;
    assert.ok(session.canonicalProject);
    assert.equal(session.acceptanceGate.passed, true);

    // 5. Verify AI-generated assets start in 'draft' state with provenance & license/dependencies, and promote only after validation passes
    assert.ok(session.generatedAssetRecords.length > 0);
    for (const asset of session.generatedAssetRecords) {
      assert.equal(asset.lifecycleState, 'draft');
      assert.equal(asset.visibility, 'private');
      assert.ok(Array.isArray(asset.dependencies) && asset.dependencies.length > 0);
      assert.ok(asset.licenseType.length > 0);
      assert.ok(asset.provenanceNote.length > 0);
    }

    const promoteRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${session.id}/promote-assets`,
      {
        method: 'POST',
        headers: authHeaders,
      }
    );
    assert.equal(promoteRes.status, 200);
    const promoteJson = await promoteRes.json();
    session = promoteJson.data.session;
    assert.ok(promoteJson.data.promotedAssetIds.length > 0);
    assert.equal(promoteJson.data.rejectedAssetIds.length, 0);
    assert.equal(session.generatedAssetRecords[0].lifecycleState, 'validated-promoted');

    // 6. Verify Typed Canonical Command Proposals have commands, before/after values, rationale, expected visual effect, affected script spans, and previewDiff
    const firstSuggestion = session.refinementSuggestions[0];
    assert.ok(firstSuggestion, 'Expected at least one refinement suggestion');
    const proposal = firstSuggestion.canonicalCommandProposal;
    assert.ok(proposal, 'Refinement suggestion must include a typed canonicalCommandProposal');
    assert.ok(proposal.commands.length > 0);
    assert.ok(proposal.propertyChanges.length > 0);
    assert.notEqual(
      proposal.propertyChanges[0].beforeValue,
      proposal.propertyChanges[0].afterValue
    );
    assert.ok(proposal.rationale.length > 0);
    assert.ok(proposal.expectedVisualEffect.length > 0);
    assert.ok(proposal.affectedScriptSpans.length > 0);
    assert.ok(proposal.previewDiff);
    assert.equal(proposal.requiresApproval, true);

    // 7. Verify require-approval blocks unapproved refinement execution
    assert.throws(
      () => {
        applyAdaptiveRefinement(session, firstSuggestion.suggestionId, {
          approvedByUser: false,
        });
      },
      /requires explicit user approval/,
      'Refinement must require explicit approval by default when autonomyMode is require-approval'
    );

    // 8. Approve and execute refinement via API and sync to sharedCanonicalEditorSession
    const revBeforeRefine = session.canonicalProject.revision;
    const refineRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${session.id}/refine`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          suggestionId: firstSuggestion.suggestionId,
          approvedByUser: true,
        }),
      }
    );
    assert.equal(refineRes.status, 200);
    const refineJson = await refineRes.json();
    session = refineJson.data.session;
    assert.ok(session.canonicalProject.revision > revBeforeRefine);
    assert.equal(
      session.refinementSuggestions.find(
        (r: { suggestionId: string }) => r.suggestionId === firstSuggestion.suggestionId
      )?.status,
      'applied'
    );

    // Sync to sharedCanonicalEditorSession and verify shared editor core reflects the exact revision
    sharedCanonicalEditorSession.openProjectDocument(session.canonicalProject, {
      isDemoMode: false,
      savedRevision: session.canonicalProject.revision,
      saveState: 'Saved',
      forceReplace: true,
    });
    assert.equal(
      sharedCanonicalEditorSession.getState().project?.revision,
      session.canonicalProject.revision
    );

    // 9. Mid-production improvement (/revise-plan): creates checkpoint, records reason & before/after delta, preserves prior edit, and re-runs QA
    const checkpointsBefore = session.productionCheckpoints.length;
    const revisionsBefore = session.planRevisions.length;
    const targetShotId = session.shots[0].shotId;
    const oldDuration = session.shots[0].editableParameters.durationSec;

    const reviseRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${session.id}/revise-plan`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          reason: 'Mid-production improvement: give hook headline +0.9s breathing room',
          shotId: targetShotId,
          editablePatch: {
            durationSec: Number((oldDuration + 0.9).toFixed(2)),
            headlineText: 'SOWVEIL 2.0: PRECISION MOBILE TIMELINE',
          },
          approvedByUser: true,
        }),
      }
    );
    assert.equal(reviseRes.status, 200);
    const reviseJson = await reviseRes.json();
    session = reviseJson.data.session;
    assert.equal(session.productionCheckpoints.length, checkpointsBefore + 1);
    assert.equal(session.planRevisions.length, revisionsBefore + 1);

    const latestRevision = session.planRevisions[0];
    assert.ok(latestRevision.reason.includes('Mid-production improvement'));
    assert.ok(latestRevision.checkpointId);
    assert.ok(latestRevision.revisionDelta, 'Revision must include CanonicalProjectDiff delta');
    assert.ok(
      Array.isArray(latestRevision.propertyDeltas) && latestRevision.propertyDeltas.length > 0,
      'Revision must record before/after propertyDeltas'
    );
    assert.equal(session.acceptanceGate.passed, true);

    // 10. Save Editable Project (/save-project) and verify Step 11 (save-editable-project) completes
    const saveRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${session.id}/save-project`,
      {
        method: 'POST',
        headers: authHeaders,
      }
    );
    assert.equal(saveRes.status, 200);
    const saveJson = await saveRes.json();
    session = saveJson.data.session;
    assert.ok(session.savedProjectId);
    const saveStep = session.workflowSteps.find(
      (s: { stepId: string }) => s.stepId === 'save-editable-project'
    );
    assert.ok(
      saveStep?.status === 'completed-live-ai' ||
        saveStep?.status === 'completed-deterministic-baseline',
      'Step 11 (Save Editable Project) must be marked completed after saving'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const REAL_LIVE_API_KEY = process.env.SOWVEIL_LIVE_PROVIDER_TEST_KEY || '';

test(
  'Phase 10.14 (REAL LIVE PROVIDER TEST — GATED ON REAL API KEY): Live Gemini upstream invocation',
  { skip: !REAL_LIVE_API_KEY ? 'Skipped: No SOWVEIL_LIVE_PROVIDER_TEST_KEY configured in environment' : false },
  async () => {
    const uid = 'user-real-live-provider';
    const session = createAiDirectorSession({
      ownerUid: uid,
      rawScriptText:
        'Sowveil Studio brings 20 professional motion modules to Android creators.\nEdit canonical timelines with real keyframes and verified exports.',
      noQuestionsWorkflow: true,
    });
    const liveConn = createProviderConnectionRecord({
      ownerUid: uid,
      label: 'Real Live Gemini Provider',
      providerBrand: 'Google Gemini',
      protocol: 'google-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      modelId: process.env.SOWVEIL_LIVE_PROVIDER_MODEL_ID || 'gemini-2.5-flash',
      authMode: 'x-api-key',
      credential: REAL_LIVE_API_KEY,
      allowedTaskTypes: ['planning', 'script-analysis'],
    });
    const routingProfiles = buildDefaultRoutingProfiles([liveConn]);
    const result = await orchestrateLiveAiDirectorSession({
      session,
      connections: [liveConn],
      routingProfiles,
      preferredConnectionId: liveConn.id,
      taskType: 'planning',
    });
    assert.ok(result.latestInvocation.invocationId);
    assert.equal(result.latestInvocation.connectionId, liveConn.id);
    assert.ok((result.latestInvocation.httpStatus ?? 0) > 0);
  }
);
