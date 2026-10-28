import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSowveilApiApp } from '../server/apiApp';
import {
  buildCanonicalProjectFixtures,
  CanonicalProjectStore,
  serializeCanonicalProject,
} from '../services/canonicalProjectEngine';
import { computeDeterministicSnapshotHash } from '../services/marketplaceEngine';
import { createReferenceLabSession } from '../services/referenceLabEngine';
import {
  extractEditableParametersFromProject,
  runTemplateFactoryPipeline,
  applyExposedParameterOverridesToProject,
  evaluateTemplateQualityGate,
  forkFactoryTemplate,
  mergeFactoryTemplates,
  restoreFactoryTemplateVersion,
  deprecateFactoryTemplate,
  updateFactoryTemplateDependencies,
  resolveDuplicateSuggestion,
  publishFactoryTemplateToCatalog,
  createDefaultPreferenceConsent,
  recordTemplateFeedbackSignal,
  rankTemplatesWithTransparentSignals,
} from '../services/templateFactoryEngine';

function createRichTestCanonicalProject() {
  const base = buildCanonicalProjectFixtures().multiTrackProject;
  const store = new CanonicalProjectStore(base);
  // Add an effect, a transition, and an asset reference so all 9 parameter categories are represented
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
  doc.tracks[0].clips[0].assetId = 'asset_hero_plate_01';
  doc.assetReferences.push({
    assetId: 'asset_hero_plate_01',
    role: 'primary-media',
    title: 'Hero Plate Asset',
    mimeType: 'image/png',
    required: true,
    missing: false,
    licenseType: 'Sowveil Original',
  });
  return doc;
}

async function withTestServer(
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const app = createSowveilApiApp({
    tokenVerifier: async (token: string) => {
      if (token === 'token-factory-owner') {
        return {
          uid: 'user_factory_5',
          email: 'factory@sowveil.studio',
          emailVerified: true,
        };
      }
      throw new Error('Invalid token');
    },
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('Template Factory — extracts all 9 parameter categories and preserves source project untouched', () => {
  const sourceProject = createRichTestCanonicalProject();
  const beforeHash = computeDeterministicSnapshotHash(
    serializeCanonicalProject(sourceProject)
  );

  const extraction = extractEditableParametersFromProject(sourceProject);
  const afterHash = computeDeterministicSnapshotHash(
    serializeCanonicalProject(sourceProject)
  );

  assert.equal(
    beforeHash,
    afterHash,
    'Source canonical project must remain completely untouched during parameter extraction'
  );
  assert.equal(
    extraction.generalizationReport.sourceUnchangedVerified,
    true,
    'GeneralizationReport must verify source project was not mutated'
  );

  const countByCat = (cat: string) =>
    extraction.extractedParameters.filter((p) => p.category === cat).length;

  assert.ok(countByCat('text') > 0, 'Should extract text parameters');
  assert.ok(countByCat('colors') > 0, 'Should extract color parameters');
  assert.ok(countByCat('assets') > 0, 'Should extract asset parameters');
  assert.ok(countByCat('timing') > 0, 'Should extract timing parameters');
  assert.ok(countByCat('speed') > 0, 'Should extract speed parameters');
  assert.ok(
    countByCat('transform') > 0,
    'Should extract transform (position/scale/rotation/opacity) parameters'
  );
  assert.ok(countByCat('effects') > 0, 'Should extract effect parameters');
  assert.ok(countByCat('audio') > 0, 'Should extract audio parameters');
  assert.ok(
    countByCat('transitions') > 0,
    'Should extract transition parameters'
  );
});

test('Template Factory — 10-stage pipeline from scratch, canonical project, and Reference Lab reconstruction with honest provenance', () => {
  const ownerUid = 'user_factory_2';
  const showcaseProject = createRichTestCanonicalProject();
  const sourceBeforeHash = computeDeterministicSnapshotHash(
    serializeCanonicalProject(showcaseProject)
  );

  // 1. Canonical project derivation
  const fromProjectDraft = runTemplateFactoryPipeline({
    ownerUid,
    sourceKind: 'canonical-project',
    title: 'Derived Multi-Track SaaS Template',
    description: 'Derived from canonical project graph',
    moduleId: 'text-animation',
    tags: ['kinetic', 'saas', 'headline'],
    sourceProject: showcaseProject,
    licenseType: 'Sowveil Original',
    licenseNote: 'Original Workspace Owner',
    existingFactoryDrafts: [],
  });

  assert.equal(fromProjectDraft.pipelineStages.length, 10);
  assert.equal(
    fromProjectDraft.generalizationReport.sourceUnchangedVerified,
    true
  );
  assert.equal(
    computeDeterministicSnapshotHash(
      serializeCanonicalProject(showcaseProject)
    ),
    sourceBeforeHash,
    'Source project must not be mutated after 10-stage pipeline'
  );
  assert.equal(fromProjectDraft.publishedToCatalog, false);
  assert.equal(
    fromProjectDraft.provenanceClassification,
    'Source-Proven Canonical'
  );
  assert.equal(fromProjectDraft.originProjectId, showcaseProject.id);
  assert.equal(
    fromProjectDraft.qualityReport.quarantinedFromValidatedCatalog,
    false
  );

  // 2. Reference Lab Reconstruction derivation (must enforce Reconstructed provenance + strip fake "Recovered Original" claim)
  const analyzedRefSession = createReferenceLabSession({
    ownerUid,
    title: 'Viral Reel Reconstruction',
    usageMode: 'authorized-reconstruction',
    sourceKind: 'uploaded-video',
    suppliedFileNames: ['uploaded-demo-reel.mp4'],
    durationSec: 6,
  });

  const fromRefDraft = runTemplateFactoryPipeline({
    ownerUid,
    sourceKind: 'reference-reconstruction',
    title: 'Claiming Recovered Original Reel Template',
    description: 'Derived from Reference Lab session',
    moduleId: 'templates',
    tags: ['reel', 'reconstructed'],
    referenceSession: analyzedRefSession,
    licenseType: 'User Owned',
    existingFactoryDrafts: [fromProjectDraft],
  });

  assert.equal(
    fromRefDraft.provenanceClassification,
    'Reconstructed',
    'Templates derived from Reference Lab / flattened video must be labeled Reconstructed'
  );
  assert.ok(
    fromRefDraft.reconstructedFidelityReport,
    'Must attach property-level reconstructedFidelityReport'
  );
  assert.ok(
    !fromRefDraft.title.includes('Recovered Original'),
    'Must strip any false "Recovered Original" claim on reconstructed templates'
  );
});

test('Template Factory — 10-Point Quality Gate, parameter preview mutation, missing dependency quarantine, and publish license gate', () => {
  const ownerUid = 'user_factory_3';
  const draft = runTemplateFactoryPipeline({
    ownerUid,
    sourceKind: 'from-scratch',
    title: 'Quality Gate Test Template',
    description: 'Testing 10-point quality gate',
    moduleId: 'text-animation',
    tags: ['test', 'quality'],
    licenseType: 'Sowveil Original',
    existingFactoryDrafts: [],
  });

  assert.equal(draft.qualityReport.checks.opensCorrectly, true);
  assert.equal(draft.qualityReport.checks.exposedParamsUpdatePreview, true);
  assert.equal(
    draft.qualityReport.checks.renderDeterministicWithinTolerance,
    true
  );
  assert.ok(
    draft.qualityReport.determinismEvidence.maxCoordDelta <= 0.001
  );
  assert.equal(draft.qualityReport.quarantinedFromValidatedCatalog, false);

  // Verify mutating an exposed text parameter actually mutates the evaluated canonical project
  const textParam = draft.extractedParameters.find(
    (p) => p.category === 'text' && p.exposed
  );
  assert.ok(textParam, 'Expected at least one exposed text parameter');
  const mutatedProject = applyExposedParameterOverridesToProject(
    draft.canonicalTemplateProject,
    draft.extractedParameters,
    { [textParam.key]: 'OVERRIDDEN HEADLINE 2026' }
  );
  assert.notEqual(
    computeDeterministicSnapshotHash(
      serializeCanonicalProject(mutatedProject)
    ),
    computeDeterministicSnapshotHash(
      serializeCanonicalProject(draft.canonicalTemplateProject)
    ),
    'Applying exposed parameter override must deterministically update evaluated project state'
  );

  // Introduce a missing asset dependency -> must quarantine template from Validated catalog
  const projectWithMissingAsset = {
    ...draft.canonicalTemplateProject,
    assetReferences: [
      ...draft.canonicalTemplateProject.assetReferences,
      {
        assetId: 'missing_asset_999',
        role: 'primary-media' as const,
        title: 'Missing Hero Logo',
        mimeType: 'image/png',
        required: true,
        missing: true,
        licenseType: 'User Owned' as const,
      },
    ],
  };

  const quarantinedReport = evaluateTemplateQualityGate({
    project: projectWithMissingAsset,
    extractedParameters: draft.extractedParameters,
    catalogItemDraft: draft.catalogItemDraft,
    provenanceClassification: draft.provenanceClassification,
    hasFidelityReportForReconstructed: Boolean(
      draft.reconstructedFidelityReport
    ),
  });

  assert.ok(quarantinedReport.missingDependencies.length > 0);
  assert.equal(
    quarantinedReport.quarantinedFromValidatedCatalog,
    true,
    'Broken template with missing dependency must be quarantined from Validated catalog'
  );

  // Verify publish gate blocks auto-publish (explicitUserConfirmation: false) and Unknown / Reference Metadata Only licenses
  const autoPublishAttempt = publishFactoryTemplateToCatalog({
    draft,
    actorUid: ownerUid,
    explicitUserConfirmation: false,
  });
  assert.equal(
    autoPublishAttempt.ok,
    false,
    'Auto-publishing without explicit user confirmation must be blocked'
  );

  const unknownLicenseDraft: typeof draft = {
    ...draft,
    licenseType: 'Unknown',
  };
  const unknownLicensePublish = publishFactoryTemplateToCatalog({
    draft: unknownLicenseDraft,
    actorUid: ownerUid,
    explicitUserConfirmation: true,
  });
  assert.equal(
    unknownLicensePublish.ok,
    false,
    'Publishing a template with Unknown license must be blocked'
  );

  // Valid explicit publish succeeds
  const validPublish = publishFactoryTemplateToCatalog({
    draft,
    actorUid: ownerUid,
    explicitUserConfirmation: true,
  });
  assert.equal(validPublish.ok, true);
  assert.equal(validPublish.updatedDraft?.publishedToCatalog, true);
});

test('Template Factory — Content-hash & semantic similarity deduplication and full lifecycle (fork, merge, version restore, deprecate, dependency update)', () => {
  const ownerUid = 'user_factory_4';
  const firstDraft = runTemplateFactoryPipeline({
    ownerUid,
    sourceKind: 'from-scratch',
    title: 'Primary Kinetic Card',
    description: 'First template',
    moduleId: 'ui-saas',
    tags: ['saas', 'card', 'kinetic', 'metric'],
    licenseType: 'Sowveil Original',
    existingFactoryDrafts: [],
  });

  // Creating a second identical/similar template triggers deduplication suggestion without deleting work
  const secondDraft = runTemplateFactoryPipeline({
    ownerUid,
    sourceKind: 'from-scratch',
    title: 'Primary Kinetic Card',
    description: 'Similar template',
    moduleId: 'ui-saas',
    tags: ['saas', 'card', 'kinetic', 'metric'],
    licenseType: 'Sowveil Original',
    existingFactoryDrafts: [firstDraft],
  });

  assert.ok(
    secondDraft.duplicateSuggestions.length > 0,
    'Must surface content-hash / semantic similarity duplicate suggestion'
  );
  const suggestion = secondDraft.duplicateSuggestions[0];
  assert.equal(suggestion.existingTemplateId, firstDraft.id);
  assert.equal(suggestion.matchType, 'exact-content-hash');

  // Resolve suggestion and then undo
  const linkedDraft = resolveDuplicateSuggestion(
    secondDraft,
    suggestion.suggestionId,
    'link-as-version'
  );
  assert.equal(
    linkedDraft.duplicateSuggestions[0].status,
    'linked-as-version'
  );

  const undoneDraft = resolveDuplicateSuggestion(
    linkedDraft,
    suggestion.suggestionId,
    'undo-suggestion'
  );
  assert.equal(undoneDraft.duplicateSuggestions[0].status, 'pending-review');

  // Lifecycle: Fork, Merge, Restore Version, Deprecate, Update Dependencies
  const forked = forkFactoryTemplate(
    firstDraft,
    ownerUid,
    'Forked SaaS Card'
  );
  assert.equal(forked.catalogItemDraft.forkedFromTemplateId, firstDraft.id);
  assert.equal(forked.publishedToCatalog, false);

  const merged = mergeFactoryTemplates({
    primaryDraft: firstDraft,
    secondaryDraft: forked,
    actorUid: ownerUid,
  });
  assert.equal(merged.version, '1.0.1');

  const restored = restoreFactoryTemplateVersion(merged, '1.0.0', ownerUid);
  assert.equal(restored.version, '1.0.2');

  const deprecated = deprecateFactoryTemplate(
    restored,
    'Replaced by v3 design system',
    forked.id
  );
  assert.equal(deprecated.deprecationStatus.isDeprecated, true);
  assert.equal(deprecated.deprecationStatus.replacementTemplateId, forked.id);

  const depUpdated = updateFactoryTemplateDependencies(
    forked,
    { addFonts: ['Space Grotesk'] },
    ownerUid
  );
  assert.ok(depUpdated.requiredFonts.includes('Space Grotesk'));
});

test('Template Factory — Transparent preference & ranking signals with explicit consent and REST API + AI Director auto-reuse integration', async () => {
  const ownerUid = 'user_factory_5';
  const r1 = runTemplateFactoryPipeline({
    ownerUid,
    sourceKind: 'from-scratch',
    title: 'Template Alpha',
    description: 'Alpha',
    moduleId: 'text-animation',
    tags: ['alpha'],
    licenseType: 'Sowveil Original',
    existingFactoryDrafts: [],
  });
  const r2 = runTemplateFactoryPipeline({
    ownerUid,
    sourceKind: 'from-scratch',
    title: 'Template Beta',
    description: 'Beta',
    moduleId: 'text-animation',
    tags: ['beta'],
    licenseType: 'Sowveil Original',
    existingFactoryDrafts: [r1],
  });

  // Without consent, signals are blocked
  const noConsent = {
    ...createDefaultPreferenceConsent(ownerUid),
    consentToPreferenceRanking: false,
  };
  const blockedSignalRes = recordTemplateFeedbackSignal({
    ownerUid,
    consentConfig: noConsent,
    existingSignals: [],
    templateId: r2.id,
    action: 'mark-preferred',
  });
  assert.equal(
    blockedSignalRes.recorded,
    false,
    'Preference signals must not be recorded when user consent is false'
  );

  // Enable explicit consent -> transparent ranking boosts Template Beta above Template Alpha
  const withConsent = createDefaultPreferenceConsent(ownerUid);
  assert.equal(withConsent.allowCrossUserSharing, false);
  assert.equal(withConsent.silentModelTrainingEnabled, false);

  const allowedSignalRes = recordTemplateFeedbackSignal({
    ownerUid,
    consentConfig: withConsent,
    existingSignals: [],
    templateId: r2.id,
    action: 'mark-preferred',
    styleTag: 'beta',
  });
  assert.equal(allowedSignalRes.recorded, true);

  const ranked = rankTemplatesWithTransparentSignals({
    ownerUid,
    consentConfig: allowedSignalRes.updatedConsent,
    userSignals: allowedSignalRes.signals,
    templates: [r1.catalogItemDraft, r2.catalogItemDraft],
  });
  assert.equal(
    ranked[0].templateId,
    r2.id,
    'Consented preference signal must rank preferred template first'
  );

  // Verify end-to-end REST API + AI Director automatic reuse draft capture
  await withTestServer(async (baseUrl) => {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-factory-owner',
    };

    // 1. Create an AI Director session, approve plan, and produce timeline -> should auto-save private Template Factory drafts!
    const createDirectorRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: 'Auto Reuse Test Script',
          rawScriptText:
            'Hook the viewer with bold kinetic typography.\nReveal the SaaS dashboard metrics with smooth easing.',
          intake: {
            noQuestionsWorkflow: true,
          },
        }),
      }
    );
    assert.equal(createDirectorRes.status, 201);
    const createJson = await createDirectorRes.json();
    const directorSession = (createJson.data || createJson).session;

    const planRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${directorSession.id}/plan`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'approve-all' }),
      }
    );
    assert.equal(planRes.status, 200);

    const produceRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${directorSession.id}/produce`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      }
    );
    assert.equal(produceRes.status, 200);

    // 2. Fetch drafts from Template Factory API and verify AI Director auto-captured reusable draft persistence
    const listRes = await fetch(`${baseUrl}/api/v1/template-factory/drafts`, {
      headers,
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    const listData = listJson.data || listJson;
    assert.ok(
      Array.isArray(listData.items) && listData.items.length > 0,
      'AI Director timeline compilation must automatically save reusable scene/project components as private Template Factory Drafts'
    );
    assert.equal(
      listData.items[0].autoSavedFromAiComponent,
      true,
      'Auto-saved AI component must carry autoSavedFromAiComponent: true'
    );
    assert.equal(
      listData.items[0].publishedToCatalog,
      false,
      'Auto-saved AI components must be stored as private Drafts, never auto-published'
    );
  });
});
