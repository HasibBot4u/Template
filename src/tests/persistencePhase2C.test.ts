import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { createApiApp } from '../server/apiApp';
import {
  AuthoritativeFirestorePersistenceAdapter,
  RuleEnforcingFirestoreTestDriver,
} from '../server/persistenceAdapters';
import {
  buildCanonicalProjectFixtures,
  CanonicalProjectStore,
  createMinimalCanonicalProject,
  serializeCanonicalProject,
} from '../services/canonicalProjectEngine';

function createRichTestCanonicalProject(title = 'Factory Source Motion Project') {
  const base = buildCanonicalProjectFixtures().multiTrackProject;
  const store = new CanonicalProjectStore(base);
  store.dispatch({
    type: 'addEffect',
    clipId: 'clip_headline_1',
    effect: {
      id: 'fx_glow_test_1',
      effectType: 'optical-glow',
      name: 'Optical Neon Glow',
      enabled: true,
      rendererSupport: 'supported',
      supportedInAlightXml: true,
      parameters: {
        intensity: 0.85,
        tintColor: '#F06424',
      },
    },
  });
  store.dispatch({
    type: 'insertTransition',
    clipId: 'clip_headline_1',
    edge: 'in',
    transition: {
      id: 'tr_in_test_1',
      type: 'whip-pan',
      durationSec: 0.45,
      easingCurve: [0.22, 1, 0.36, 1],
      parameters: {},
    },
  });
  const doc = store.getProject();
  doc.title = title;
  doc.provenance.authorUid = 'user-alice';
  doc.tracks[0].clips[0].assetId = 'asset_txt_neon_punch_01';
  doc.assetReferences = [
    {
      assetId: 'asset_txt_neon_punch_01',
      role: 'primary-media',
      title: 'Neon Punch Asset',
      mimeType: 'application/json',
      required: true,
      missing: false,
      licenseType: 'Sowveil Original',
    },
  ];
  return doc;
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function startTestServer(
  options: Parameters<typeof createApiApp>[0] & {
    durableStorePath?: string;
    enforceStrictDurableStorage?: boolean;
  } = {}
): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const { durableStorePath, enforceStrictDurableStorage, ...restOptions } = options;
  const app = createApiApp({
    persistenceFilePath: durableStorePath,
    refuseUnreadyProductionStartup: enforceStrictDurableStorage,
    tokenVerifier: async (token: string) => {
      if (token === 'test-user-alice') {
        return {
          uid: 'user-alice',
          email: 'alice@example.com',
          emailVerified: true,
        };
      }
      if (token === 'test-user-bob') {
        return {
          uid: 'user-bob',
          email: 'bob@example.com',
          emailVerified: true,
        };
      }
      throw new Error('INVALID_TOKEN');
    },
    ...restOptions,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

async function apiJson<T = any>(
  baseUrl: string,
  endpoint: string,
  options: {
    method?: string;
    token?: string;
    body?: unknown;
  } = {}
): Promise<{ status: number; json: any; data: any }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as any;
  const data = json && typeof json === 'object' && 'data' in json ? json.data : json;
  return { status: res.status, json, data };
}

async function runPhase2CTests() {
  console.log('Running Phase 2C Sessions & Template Factory Persistence Tests...');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-phase2c-'));
  const snapshotPath = path.join(tmpDir, 'durable-store.json');
  const sharedFirestoreDriver = new RuleEnforcingFirestoreTestDriver();

  const makeFirestoreAdapter = () =>
    new AuthoritativeFirestorePersistenceAdapter({
      driver: sharedFirestoreDriver,
    });

  let sharedAdapter = makeFirestoreAdapter();

  // =========================================================================
  // 1. AI DIRECTOR WORKFLOW STAGES, CHECKPOINTS, ROLLBACK & PERSISTENCE
  // =========================================================================
  console.log('Test 1: AI Director intake -> questions -> plan -> produce -> refine -> rollback -> save-project');
  {
    const srv = await startTestServer({
      durableStorePath: snapshotPath,
      persistenceAdapter: sharedAdapter,
      enforceStrictDurableStorage: false,
    });

    try {
      // 1.1 Intake
      const rawScript =
        'Introducing Sowveil Studio. A modern motion graphics engine with 20 real modules.\nExperience seamless editing and real-time canvas rendering.';
      const intakeRes = await apiJson(srv.baseUrl, '/api/v1/ai-director/sessions', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          scriptText: rawScript,
          userIntent: 'Produce a 15-second product launch reel with bold kinetic typography.',
          targetModuleId: 'text-animation',
          visualTheme: 'tech-minimal',
          targetDurationSec: 15,
        },
      });

      assert(intakeRes.status === 201, `Expected 201 on intake, got ${intakeRes.status}`);
      const session = intakeRes.data.session;
      assert(session.id && session.id.startsWith('dir_sess_'), 'Expected stable dir_sess_ session ID');
      assert(session.ownerUid === 'user-alice', 'Session ownerUid must match authenticated user');
      assert(session.segments.length > 0, 'Script must be parsed into segments');
      assert(session.stage === 'questions-clarification', 'Initial stage must be questions-clarification');
      assert(session.planRevisions.length >= 1, 'Initial plan revision must be recorded');
      assert(
        session.segments[0].startOffset === 0,
        'First segment startOffset must be 0'
      );

      const sessionId = session.id;

      // 1.2 Questions stage
      const firstQ = session.questions[0];
      const qRes = await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${sessionId}/questions`, {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          answers: firstQ
            ? {
                [firstQ.id]: {
                  answer: firstQ.options[0] || 'High retention kinetic pacing',
                  lockDecision: true,
                },
              }
            : undefined,
          applyDefaultsToUnanswered: true,
        },
      });
      assert(qRes.status === 200, `Expected 200 on questions, got ${qRes.status}`);
      assert(
        qRes.data.session.stage === 'brief-shot-plan',
        'Workflow stage must advance to brief-shot-plan'
      );
      assert(
        qRes.data.session.planRevisions.length >= 1,
        'Plan revision must be preserved'
      );

      // 1.3 Plan stage: approve whole plan
      const planRes = await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${sessionId}/plan`, {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          action: 'approve-all',
        },
      });
      assert(planRes.status === 200, `Expected 200 on plan, got ${planRes.status}`);
      const plannedShots = planRes.data.session.shots;
      assert(plannedShots.length > 0, 'Plan must contain planned shots');
      assert(
        planRes.data.session.coverageLedger.coveragePercent >= 90,
        'Whole-script coverage must meet threshold'
      );

      // 1.4 Produce stage
      const produceRes = await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${sessionId}/produce`, {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          onlyApprovedShots: false,
        },
      });
      assert(produceRes.status === 200, `Expected 200 on produce, got ${produceRes.status}`);
      assert(
        produceRes.data.session.stage === 'acceptance-verified' ||
          produceRes.data.session.stage === 'adaptive-refinement',
        'Workflow stage must advance to acceptance-verified or adaptive-refinement'
      );
      assert(
        produceRes.data.session.productionCheckpoints.length >= 1,
        'Production checkpoint must be created'
      );
      assert(
        produceRes.data.session.canonicalProject.tracks.length > 0,
        'Produced canonical project must have timeline tracks'
      );

      // 1.5 Refine stage (if refinement suggestions exist)
      let postRefineSession = produceRes.data.session;
      if (postRefineSession.refinementSuggestions?.length > 0) {
        const suggestionId = postRefineSession.refinementSuggestions[0].suggestionId;
        const refineRes = await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${sessionId}/refine`, {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            suggestionId,
          },
        });
        assert(refineRes.status === 200, `Expected 200 on refine, got ${refineRes.status}`);
        const appliedSug = refineRes.data.session.refinementSuggestions.find(
          (s: any) => s.suggestionId === suggestionId
        );
        assert(
          appliedSug?.status === 'applied',
          'Applied refinement suggestion status must be applied'
        );
        postRefineSession = refineRes.data.session;
      }

      // 1.6 Rollback to previous checkpoint
      const targetCheckpointId = postRefineSession.productionCheckpoints[0].checkpointId;
      const rollbackRes = await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${sessionId}/rollback`, {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          checkpointId: targetCheckpointId,
        },
      });
      assert(rollbackRes.status === 200, `Expected 200 on rollback, got ${rollbackRes.status}`);
      assert(
        rollbackRes.data.session.productionCheckpoints.length >= 1,
        'Checkpoints must be retained after rollback'
      );

      // 1.7 Save to canonical Project Library
      const saveProjRes = await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${sessionId}/save-project`, {
        method: 'POST',
        token: 'test-user-alice',
        body: {},
      });
      assert(saveProjRes.status === 200, `Expected 200 on save-project, got ${saveProjRes.status}`);
      const savedProject = saveProjRes.data.project;
      assert(savedProject.id, 'Saved project must have an ID');
      assert(savedProject.ownerUid === 'user-alice', 'Saved project owner must be user-alice');
      assert(
        saveProjRes.data.session.savedProjectId === savedProject.id,
        'Session must durably store savedProjectId link'
      );

      // Verify session via GET
      const getSessionRes = await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${sessionId}`, {
        token: 'test-user-alice',
      });
      assert(getSessionRes.status === 200, 'Expected 200 on GET session');
      assert(
        getSessionRes.data.session.savedProjectId === savedProject.id,
        'Retrieved session must reflect savedProjectId'
      );

      // 1.8 Cross-user isolation: Bob cannot access Alice's AI Director session
      const bobRes = await apiJson(srv.baseUrl, `/api/v1/ai-director/sessions/${sessionId}`, {
        token: 'test-user-bob',
      });
      assert(bobRes.status === 403, `Expected 403 for Bob accessing Alice's session, got ${bobRes.status}`);

      const bobListRes = await apiJson(srv.baseUrl, '/api/v1/ai-director/sessions', {
        token: 'test-user-bob',
      });
      assert(bobListRes.status === 200, 'Bob can list his own sessions');
      assert(
        !bobListRes.data.items.some((s: any) => s.id === sessionId),
        "Bob's session list must NOT contain Alice's session"
      );
    } finally {
      await srv.close();
    }
  }

  // =========================================================================
  // 2. REFERENCE LAB SESSIONS, HONEST MEDIA ANALYSIS & CLASSIFICATION
  // =========================================================================
  console.log('Test 2: Reference Lab filename-only honesty vs parsed presets & corrections');
  {
    const srv = await startTestServer({
      durableStorePath: snapshotPath,
      persistenceAdapter: sharedAdapter,
      enforceStrictDurableStorage: false,
    });

    try {
      // 2.1 Filename-only upload: MUST be marked filename-only-unparsed and NEVER claim measured from frame
      const filenameOnlyRes = await apiJson(srv.baseUrl, '/api/v1/reference-lab/sessions', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          title: 'Unparsed User Upload',
          usageMode: 'reference-inspired',
          sourceKind: 'uploaded-video',
          suppliedFileNames: ['raw_user_screen_recording.mp4'],
          rightsDeclarationChecked: true,
          allowRemoteModelUpload: false,
        },
      });

      assert(filenameOnlyRes.status === 201, `Expected 201 on session create, got ${filenameOnlyRes.status}`);
      const unparsedSession = filenameOnlyRes.data.session;
      assert(
        unparsedSession.mediaSpecs.mediaAnalysisState === 'filename-only-unparsed',
        `Expected mediaAnalysisState 'filename-only-unparsed', got '${unparsedSession.mediaSpecs.mediaAnalysisState}'`
      );
      assert(
        unparsedSession.mediaSpecs.sourceMediaParsed === false,
        'Filename-only upload must have sourceMediaParsed: false'
      );
      assert(
        unparsedSession.mediaSpecs.parsedSourceMetadata === null,
        'Filename-only upload must have parsedSourceMetadata: null'
      );
      assert(
        unparsedSession.fidelityReport.mediaAnalysisState === 'filename-only-unparsed',
        'Fidelity report must record filename-only-unparsed state'
      );
      assert(
        unparsedSession.fidelityReport.sourceMediaParsed === false,
        'Fidelity report must record sourceMediaParsed: false'
      );

      // Verify fieldClassificationSummary
      const summary = unparsedSession.fidelityReport.fieldClassificationSummary;
      assert(summary, 'Fidelity report must include fieldClassificationSummary');
      assert(
        Array.isArray(summary.observed) &&
          Array.isArray(summary.inferred) &&
          Array.isArray(summary.generated) &&
          Array.isArray(summary.unknown),
        'Summary must distinguish observed, inferred, generated, and unknown'
      );
      assert(
        summary.unknown.some((k: string) => k.startsWith('mediaSpecs.')),
        'Summary unknown fields must include unparsed mediaSpecs fields'
      );
      assert(
        unparsedSession.fidelityReport.unrecoverableProperties.some(
          (u: any) => u.propertyKey === 'unparsed_filename_only_upload'
        ),
        'Unrecoverable properties must include unparsed_filename_only_upload'
      );

      // Verify no unparsed observations claim 'measured from frame'
      for (const obs of unparsedSession.observations) {
        assert(
          obs.provenanceSource !== 'measured from frame',
          `Filename-only session observation '${obs.id}' cannot claim 'measured from frame'`
        );
      }

      // 2.2 Built-in preset upload: parses media preset correctly
      const presetRes = await apiJson(srv.baseUrl, '/api/v1/reference-lab/sessions', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          title: 'Preset Reconstruction',
          usageMode: 'authorized-reconstruction',
          sourceKind: 'built-in-preset',
          presetId: 'ref_preset_kinetic_saas_hero',
          rightsDeclarationChecked: true,
          allowRemoteModelUpload: false,
        },
      });
      assert(presetRes.status === 201, `Expected 201 for preset session, got ${presetRes.status}`);
      const presetSession = presetRes.data.session;
      assert(
        presetSession.mediaSpecs.mediaAnalysisState === 'verified-preset',
        `Built-in preset must have mediaAnalysisState: verified-preset, got ${presetSession.mediaSpecs.mediaAnalysisState}`
      );
      assert(
        presetSession.mediaSpecs.sourceMediaParsed === true,
        'Built-in preset must have sourceMediaParsed: true'
      );
      assert(
        presetSession.mediaSpecs.parsedSourceMetadata?.parsedFromMediaBytes === true,
        'Built-in preset must record parsedFromMediaBytes: true'
      );

      const presetSessionId = presetSession.id;

      // 2.3 Correction actions on session
      const actionRes = await apiJson(
        srv.baseUrl,
        `/api/v1/reference-lab/sessions/${presetSessionId}/action`,
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            actionType: 'speed-ramp',
            shotId: presetSession.shots[0].id,
            speedMultiplier: 1.25,
          },
        }
      );
      assert(actionRes.status === 200, `Expected 200 for action, got ${actionRes.status}`);
      assert(
        actionRes.data.session.correctionHistory.length > 0,
        'Correction history must be updated'
      );

      // 2.4 Save Reference Lab session to Project Library
      const saveRefProjRes = await apiJson(
        srv.baseUrl,
        `/api/v1/reference-lab/sessions/${presetSessionId}/save-project`,
        {
          method: 'POST',
          token: 'test-user-alice',
        }
      );
      assert(saveRefProjRes.status === 201, `Expected 201 for save-project, got ${saveRefProjRes.status}`);
      assert(
        saveRefProjRes.data.session.savedProjectId,
        'Reference session must link savedProjectId'
      );

      // 2.5 Save Reference Lab session as Template
      const saveRefTplRes = await apiJson(
        srv.baseUrl,
        `/api/v1/reference-lab/sessions/${presetSessionId}/save-template`,
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            promoteToValidated: true,
          },
        }
      );
      assert(saveRefTplRes.status === 201, `Expected 201 for save-template, got ${saveRefTplRes.status}`);
      assert(
        saveRefTplRes.data.session.savedDraftTemplateId,
        'Reference session must link savedDraftTemplateId'
      );
      assert(
        saveRefTplRes.data.session.promotedValidatedTemplateId,
        'Reference session must link promotedValidatedTemplateId'
      );

      // 2.6 Cross-user isolation: Bob cannot view Alice's reference session
      const bobRefRes = await apiJson(
        srv.baseUrl,
        `/api/v1/reference-lab/sessions/${presetSessionId}`,
        {
          token: 'test-user-bob',
        }
      );
      assert(bobRefRes.status === 403, `Expected 403 for Bob, got ${bobRefRes.status}`);
    } finally {
      await srv.close();
    }
  }

  // =========================================================================
  // 3. TEMPLATE FACTORY DRAFTS, FORK, MERGE, DEPRECATE & IDEMPOTENT PUBLISH
  // =========================================================================
  console.log('Test 3: Template Factory draft operations & idempotent catalog publication');
  {
    const srv = await startTestServer({
      durableStorePath: snapshotPath,
      persistenceAdapter: sharedAdapter,
      enforceStrictDurableStorage: false,
    });

    try {
      // 3.1 Create a valid canonical project to base draft on
      const projectDoc = buildCanonicalProjectFixtures().multiTrackProject;

      // 3.2 Create Template Factory Draft
      const draftPayload = {
        title: 'Kinetic Velocity Title',
        slug: 'kinetic-velocity-title',
        description: 'High-energy typography reveal with spring easing and customizable slots.',
        moduleId: 'text-animation',
        categoryId: 'typography',
        tags: ['kinetic', 'title', 'bold', 'tech'],
        sourceKind: 'canonical-project',
        usageMode: 'original-creation',
        canonicalTemplateProject: createRichTestCanonicalProject('Kinetic Velocity Title'),
        licenseType: 'Sowveil Original',
        attribution: 'Sowveil Studio Motion Team',
      };

      const createDraftRes = await apiJson(srv.baseUrl, '/api/v1/template-factory/drafts', {
        method: 'POST',
        token: 'test-user-alice',
        body: draftPayload,
      });

      assert(createDraftRes.status === 201, `Expected 201 on create draft, got ${createDraftRes.status}`);
      const draft = createDraftRes.data.draft;
      const draftId = draft.id;
      assert(draftId && draftId.startsWith('tpl_factory_'), 'Expected stable tpl_factory_ draft ID');
      assert(draft.ownerUid === 'user-alice', 'Draft ownerUid must be user-alice');
      assert(draft.extractedParameters.length > 0, 'Draft must extract editable parameters');
      assert(draft.qualityReport.quarantinedFromValidatedCatalog === false, 'Draft should pass 10-point quality gate');

      // 3.3 Fork Draft
      const forkRes = await apiJson(
        srv.baseUrl,
        `/api/v1/template-factory/drafts/${draftId}/fork`,
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            newTitle: 'Kinetic Velocity Title (Mobile 9:16 Fork)',
          },
        }
      );
      assert(forkRes.status === 201, `Expected 201 on fork, got ${forkRes.status}`);
      const forkedDraft = forkRes.data.draft;
      assert(forkedDraft.id !== draftId, 'Forked draft must have distinct ID');
      assert(forkedDraft.ownerUid === 'user-alice', 'Forked draft owner must be user-alice');

      // 3.4 Deprecate Forked Draft
      const deprecateRes = await apiJson(
        srv.baseUrl,
        `/api/v1/template-factory/drafts/${forkedDraft.id}/deprecate`,
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            reason: 'Superseded by responsive master template.',
            replacementTemplateId: draftId,
          },
        }
      );
      assert(deprecateRes.status === 200, `Expected 200 on deprecate, got ${deprecateRes.status}`);
      assert(
        deprecateRes.data.draft.deprecationStatus?.isDeprecated === true,
        'Draft must be marked deprecated'
      );

      // 3.5 Publish Primary Draft to Authoritative Catalog
      const publishRes = await apiJson(
        srv.baseUrl,
        `/api/v1/template-factory/drafts/${draftId}/publish`,
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            explicitUserConfirmation: true,
          },
        }
      );
      assert(publishRes.status === 200, `Expected 200 on publish, got ${publishRes.status}`);
      const publishedDraft = publishRes.data.draft;
      const publishedCatalogItem = publishRes.data.catalogItem;
      assert(
        publishedDraft.publishedToCatalog === true,
        'Draft must be flagged publishedToCatalog: true'
      );
      assert(
        publishedDraft.publishedCatalogItemId,
        'Draft must store publishedCatalogItemId'
      );
      assert(
        publishedCatalogItem.validationState === 'Validated',
        'Published catalog item must be Validated'
      );

      const firstPublishedCatalogItemId = publishedDraft.publishedCatalogItemId;
      const firstPublishedVersionCount = publishedDraft.versionHistory.length;

      // 3.6 IDEMPOTENT PUBLISH RETRY: Re-publishing must NOT duplicate catalog items or versions
      const retryPublishRes = await apiJson(
        srv.baseUrl,
        `/api/v1/template-factory/drafts/${draftId}/publish`,
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            explicitUserConfirmation: true,
          },
        }
      );
      assert(retryPublishRes.status === 200, `Expected 200 on retry publish, got ${retryPublishRes.status}`);
      assert(
        retryPublishRes.data.idempotentNoOp === true,
        'Retry publish must return idempotentNoOp: true'
      );
      assert(
        retryPublishRes.data.draft.publishedCatalogItemId === firstPublishedCatalogItemId,
        'Published catalog item ID must remain stable across retries'
      );
      assert(
        retryPublishRes.data.draft.versionHistory.length === firstPublishedVersionCount,
        'Version history must not append duplicate entries on retry publish'
      );

      // 3.7 Verify published template is queryable via GET /api/v1/catalog
      const catalogRes = await apiJson(
        srv.baseUrl,
        `/api/v1/catalog?moduleId=text-animation`,
        {
          token: 'test-user-alice',
        }
      );
      assert(catalogRes.status === 200, 'Expected 200 on catalog query');
      const foundInCatalog = catalogRes.data.items.find(
        (item: any) => item.id === firstPublishedCatalogItemId
      );
      assert(
        foundInCatalog,
        'Published template must appear in GET /api/v1/catalog for text-animation module'
      );
      assert(
        foundInCatalog.validationState === 'Validated',
        'Catalog item validation state must be Validated'
      );

      // 3.8 User preference consent & transparent signals
      const consentRes = await apiJson(
        srv.baseUrl,
        '/api/v1/template-factory/feedback/consent',
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            consentToPreferenceRanking: true,
          },
        }
      );
      assert(consentRes.status === 200, `Expected 200 on consent update, got ${consentRes.status}: ${JSON.stringify(consentRes.json)}`);
      assert(
        consentRes.data.preferenceConsent.consentToPreferenceRanking === true,
        'Consent config must be true'
      );

      const signalRes = await apiJson(
        srv.baseUrl,
        '/api/v1/template-factory/feedback/signal',
        {
          method: 'POST',
          token: 'test-user-alice',
          body: {
            templateId: firstPublishedCatalogItemId,
            moduleId: 'text-animation',
            action: 'mark-preferred',
            styleTag: 'kinetic',
          },
        }
      );
      assert(signalRes.status === 200, `Expected 200 on feedback signal, got ${signalRes.status}: ${JSON.stringify(signalRes.json)}`);
      assert(
        signalRes.data.preferenceSignals.some((s: { action: string }) => s.action === 'mark-preferred'),
        'Signal action must be recorded'
      );
    } finally {
      await srv.close();
    }
  }

  // =========================================================================
  // 4. SERVER RESTART / PERSISTENCE SURVIVAL TEST
  // =========================================================================
  console.log('Test 4: Durability across server restart with shared persistence adapter');
  {
    // Start server A, create records
    let createdSessionId = '';
    let createdDraftId = '';
    let publishedItemId = '';

    const srvA = await startTestServer({
      durableStorePath: snapshotPath,
      persistenceAdapter: sharedAdapter,
      enforceStrictDurableStorage: false,
    });

    try {
      // AI Director session
      const aiRes = await apiJson(srvA.baseUrl, '/api/v1/ai-director/sessions', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          scriptText: 'Durability survival verification across restart.',
          userIntent: 'Durability test',
          targetModuleId: 'easing',
        },
      });
      assert(aiRes.status === 201, 'Expected 201 on session create in srvA');
      createdSessionId = aiRes.data.session.id;

      // Template draft
      const draftRes = await apiJson(srvA.baseUrl, '/api/v1/template-factory/drafts', {
        method: 'POST',
        token: 'test-user-alice',
        body: {
          title: 'Durability Template',
          slug: 'durability-template',
          description: 'Testing restart survival.',
          moduleId: 'easing',
          categoryId: 'transitions',
          tags: ['easing', 'smooth'],
          sourceKind: 'canonical-project',
          usageMode: 'original-creation',
          canonicalTemplateProject: createRichTestCanonicalProject('Durability Template'),
          licenseType: 'Sowveil Original',
          attribution: 'Sowveil Test Suite',
        },
      });
      assert(draftRes.status === 201, 'Expected 201 on draft create in srvA');
      createdDraftId = draftRes.data.draft.id;

      // Publish draft
      const pubRes = await apiJson(
        srvA.baseUrl,
        `/api/v1/template-factory/drafts/${createdDraftId}/publish`,
        {
          method: 'POST',
          token: 'test-user-alice',
          body: { explicitUserConfirmation: true },
        }
      );
      assert(pubRes.status === 200, 'Expected 200 on publish in srvA');
      publishedItemId = pubRes.data.draft.publishedCatalogItemId;
    } finally {
      await srvA.close();
    }

    // Now start fresh Server B using the SAME shared adapter
    const srvB = await startTestServer({
      durableStorePath: snapshotPath,
      persistenceAdapter: sharedAdapter,
      enforceStrictDurableStorage: false,
    });

    try {
      // Check AI Director session survived
      const getSessionRes = await apiJson(srvB.baseUrl, `/api/v1/ai-director/sessions/${createdSessionId}`, {
        token: 'test-user-alice',
      });
      assert(getSessionRes.status === 200, 'AI Director session must survive server restart');
      assert(
        getSessionRes.data.session.id === createdSessionId,
        'Retrieved session ID must match'
      );

      // Check Template Factory draft survived
      const getDraftRes = await apiJson(srvB.baseUrl, `/api/v1/template-factory/drafts/${createdDraftId}`, {
        token: 'test-user-alice',
      });
      assert(getDraftRes.status === 200, 'Template Factory draft must survive server restart');
      assert(
        getDraftRes.data.draft.publishedToCatalog === true,
        'Draft publishedToCatalog state must survive restart'
      );
      assert(
        getDraftRes.data.draft.publishedCatalogItemId === publishedItemId,
        'Draft publishedCatalogItemId must survive restart'
      );

      // Check published catalog item queryable in fresh server
      const catalogRes = await apiJson(srvB.baseUrl, `/api/v1/catalog?moduleId=easing`, {
        token: 'test-user-alice',
      });
      assert(catalogRes.status === 200, 'Catalog query must succeed on restarted server');
      const item = catalogRes.data.items.find((i: any) => i.id === publishedItemId);
      assert(item, 'Published catalog item must survive server restart and be queryable');
    } finally {
      await srvB.close();
    }
  }

  console.log('All Phase 2C persistence tests PASSED successfully.');
}

runPhase2CTests().catch((err) => {
  console.error('Phase 2C test failure:', err);
  process.exit(1);
});
