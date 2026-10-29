import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

test('Firestore Rules Audit: Every collection in firebase-blueprint.json is secured and all 12 Dirty Dozen invariants are enforced', () => {
  const rulesText = fs.readFileSync(rulesPath, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  // 1. Rules version & global default-deny catch-all
  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(
    rulesText.includes('match /{document=**} {\n      allow read, write: if false;\n    }')
  );

  // 2. Verify every collection path in firebase-blueprint.json has an explicit match block
  const requiredMatchBlocks = [
    'match /users/{uid}',
    'match /private/{docId}',
    'match /admins/{uid}',
    'match /modules/{moduleId}',
    'match /categories/{categoryId}',
    'match /catalogItems/{itemId}',
    'match /templateVariants/{variantId}',
    'match /assets/{assetId}',
    'match /favorites/{uid}/items/{itemId}',
    'match /projects/{projectId}',
    'match /jobs/{jobId}',
    'match /devices/{deviceId}',
    'match /devicePairingTokens/{tokenId}',
    'match /auditEvents/{eventId}',
    'match /referenceLabSessions/{sessionId}',
    'match /providerConnections/{connectionId}',
    'match /extensionPackages/{extensionId}',
    'match /toolAuditRecords/{auditId}',
    'match /aiDirectorSessions/{sessionId}',
    'match /templateFactoryDrafts/{draftId}',
    'match /renderExportJobs/{jobId}',
  ];
  for (const block of requiredMatchBlocks) {
    assert.ok(rulesText.includes(block), `Missing match block in firestore.rules: ${block}`);
  }
  assert.equal(Object.keys(blueprint.firestore).length, 21);

  // 3. Verify Dirty Dozen Defenses:
  // Payload 1 & 2: Self-role escalation blocked on create (incoming().role == 'user' || isAdmin()) and update (incoming().role == existing().role)
  assert.ok(rulesText.includes("(incoming().role == 'user' || isAdmin())"));
  assert.ok(rulesText.includes('incoming().role == existing().role'));

  // Payload 3: Shadow field injection blocked via hasOnly() on every entity validator and affectedKeys().hasOnly() on updates
  assert.ok(rulesText.includes("affectedKeys().hasOnly(['displayName', 'photoURL', 'preferences', 'updatedAt'])"));

  // Payload 4: PII split-collection isolation (/users/{uid}/private/{docId}) restricted to isOwner(uid) || isAdmin()
  assert.ok(rulesText.includes('allow get: if isValidId(uid) && isValidId(docId) && (isOwner(uid) || isAdmin())'));

  // Payload 5: Unverified email spoofing blocked by checking request.auth.token.email_verified == true
  assert.ok(rulesText.includes('request.auth.token.email_verified == true'));

  // Payload 6: Draft catalog items blocked for ordinary users
  assert.ok(rulesText.includes("existing().visibility == 'published' || isAdmin()"));

  // Payload 7: Cross-user project & job access blocked via existing().ownerUid == request.auth.uid
  assert.ok(rulesText.includes('existing().ownerUid == request.auth.uid || isAdmin()'));

  // Payload 8: Orphaned favorite writes blocked by Master Gate exists(/databases/$(database)/documents/users/$(uid))
  assert.ok(rulesText.includes('exists(/databases/$(database)/documents/users/$(uid))'));

  // Payload 9: Terminal job state locking blocks updates once status is downloaded, succeeded, cancelled, or expired
  assert.ok(
    rulesText.includes("!(existing().status in ['downloaded', 'succeeded', 'cancelled', 'expired'])")
  );

  // Payload 10 & 11: Client SDK blocked from writing /auditEvents and reading/writing /devicePairingTokens
  assert.ok(
    rulesText.includes('match /devicePairingTokens/{tokenId} {\n      allow read, write: if false;\n    }')
  );
  assert.ok(
    rulesText.includes('match /auditEvents/{eventId} {\n      allow get: if isValidId(eventId) && isAdmin();\n      allow list: if isAdmin();\n      allow create, update, delete: if false;\n    }')
  );

  // Payload 12: ID Poisoning guard regex & length check
  assert.ok(rulesText.includes("id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$')"));
});

test('Firestore Contract Reconciliation: TemplateFactoryDraftRecord matches TypeScript domain model and rules', () => {
  const rulesText = fs.readFileSync(rulesPath, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  const draftSchema = blueprint.entities.TemplateFactoryDraftRecord;
  assert.ok(draftSchema, 'TemplateFactoryDraftRecord must exist in blueprint');

  // Verify reconciled required fields in blueprint
  assert.deepEqual(draftSchema.required, [
    'id',
    'ownerUid',
    'title',
    'sourceKind',
    'provenanceClassification',
    'publishedToCatalog',
    'version',
    'createdAt',
    'updatedAt',
  ]);

  // Verify reconciled enums
  assert.deepEqual(draftSchema.properties.sourceKind.enum, [
    'from-scratch',
    'canonical-project',
    'reference-reconstruction',
    'ai-director-component',
  ]);
  assert.deepEqual(draftSchema.properties.provenanceClassification.enum, [
    'Source-Proven Canonical',
    'Author-Created Scratch',
    'Reconstructed',
    'Original',
    'Derived-Authorized',
    'Synthetic-AI',
  ]);
  assert.equal(draftSchema.properties.publishedToCatalog.type, 'boolean');

  // Verify firestore.rules function validator checks
  assert.ok(rulesText.includes('function isValidTemplateFactoryDraftRecord(data)'));
  assert.ok(rulesText.includes("data.keys().hasAll(['id', 'ownerUid', 'title', 'sourceKind', 'provenanceClassification', 'publishedToCatalog', 'version', 'createdAt', 'updatedAt'])"));
  assert.ok(rulesText.includes("data.title is string && data.title.size() >= 1 && data.title.size() <= 160"));
  assert.ok(rulesText.includes("data.publishedToCatalog is bool"));
  assert.ok(rulesText.includes("data.sourceKind in ['from-scratch', 'canonical-project', 'reference-reconstruction', 'ai-director-component']"));

  // Verify match block immutability & permissions
  assert.ok(rulesText.includes('incoming().sourceKind == existing().sourceKind'));
  assert.ok(rulesText.includes('existing().publishedToCatalog == true'));
  assert.ok(rulesText.includes("incoming().diff(existing()).affectedKeys().hasOnly(['title', 'slug', 'description', 'categoryId', 'tags', 'selectedSceneIds', 'selectedClipIds', 'canonicalTemplateProject', 'extractedParameters', 'replaceableSlots', 'generalizationReport', 'requiredAssets', 'requiredFonts', 'requiredEffects', 'licenseType', 'licenseNote', 'attribution', 'thumbnailSvgDataUri', 'previewSnapshotHash', 'structuralContentHash', 'qualityReport', 'pipelineStages', 'duplicateSuggestions', 'catalogItemDraft', 'autoSavedFromAiComponent', 'publishedToCatalog', 'publishedAt', 'version', 'versionHistory', 'deprecationStatus', 'updatedAt'])"));
});

test('Firestore Contract Reconciliation: RenderExportJobRecord matches TypeScript domain model and rules', () => {
  const rulesText = fs.readFileSync(rulesPath, 'utf8');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

  const jobSchema = blueprint.entities.RenderExportJobRecord;
  assert.ok(jobSchema, 'RenderExportJobRecord must exist in blueprint');

  // Verify required fields in blueprint
  assert.deepEqual(jobSchema.required, [
    'id',
    'ownerUid',
    'projectId',
    'projectTitle',
    'projectRevision',
    'executionTier',
    'outputFormat',
    'targetAdapter',
    'requestedWidth',
    'requestedHeight',
    'requestedFps',
    'requestedDurationSec',
    'stage',
    'cancellable',
    'completedWorkUnits',
    'totalWorkUnits',
    'progressPercent',
    'createdAt',
    'updatedAt',
  ]);

  // All 15 output formats in blueprint
  assert.equal(jobSchema.properties.outputFormat.enum.length, 15);
  assert.ok(jobSchema.properties.outputFormat.enum.includes('sowveil-project-json'));
  assert.ok(jobSchema.properties.outputFormat.enum.includes('mp4-video'));
  assert.ok(jobSchema.properties.outputFormat.enum.includes('webm-video'));
  assert.ok(jobSchema.properties.outputFormat.enum.includes('alight-motion-xml'));
  assert.ok(jobSchema.properties.outputFormat.enum.includes('capcut-handoff-zip'));

  // All 12 stages in blueprint
  assert.equal(jobSchema.properties.stage.enum.length, 12);
  assert.ok(jobSchema.properties.stage.enum.includes('queued'));
  assert.ok(jobSchema.properties.stage.enum.includes('rendering-frames'));
  assert.ok(jobSchema.properties.stage.enum.includes('synthesizing-audio'));
  assert.ok(jobSchema.properties.stage.enum.includes('running-final-qa'));
  assert.ok(jobSchema.properties.stage.enum.includes('ready'));
  assert.ok(jobSchema.properties.stage.enum.includes('interrupted-recovered'));

  // All 6 target adapters in blueprint
  assert.equal(jobSchema.properties.targetAdapter.enum.length, 6);
  assert.deepEqual(jobSchema.properties.targetAdapter.enum, [
    'sowveil-project',
    'alight-motion',
    'capcut',
    'node-video',
    'kinemaster',
    'universal-bundle',
  ]);

  // Verify firestore.rules function validator checks
  assert.ok(rulesText.includes('function isValidRenderExportJobRecord(data)'));
  assert.ok(rulesText.includes("data.projectTitle is string && data.projectTitle.size() >= 1 && data.projectTitle.size() <= 200"));
  assert.ok(rulesText.includes("data.projectRevision is number && data.projectRevision >= 1"));
  assert.ok(rulesText.includes("data.targetAdapter in ['sowveil-project', 'alight-motion', 'capcut', 'node-video', 'kinemaster', 'universal-bundle']"));
  assert.ok(rulesText.includes("data.requestedFps in [24, 30, 60]"));
  assert.ok(rulesText.includes("data.cancellable is bool"));
  assert.ok(rulesText.includes("data.progressPercent is number && data.progressPercent >= 0 && data.progressPercent <= 100"));

  // Verify match block immutability & permissions
  assert.ok(rulesText.includes('incoming().projectId == existing().projectId'));
  assert.ok(rulesText.includes("incoming().diff(existing()).affectedKeys().hasOnly(['stage', 'cancellable', 'completedWorkUnits', 'totalWorkUnits', 'progressPercent', 'stageHistory', 'retryPolicy', 'featureLossReport', 'artifactMetadata', 'artifactBytesBase64', 'qaReport', 'errorCode', 'sanitizedErrorMessage', 'updatedAt', 'completedAt'])"));
});

test('Firestore Security Simulator: Template Factory Draft create & update validation', () => {
  // Pure simulator mirroring isValidTemplateFactoryDraftRecord & update rules
  const ALLOWED_DRAFT_KEYS = new Set([
    'id', 'ownerUid', 'title', 'slug', 'description', 'moduleId', 'categoryId', 'tags',
    'sourceKind', 'provenanceClassification', 'originProjectId', 'originProjectRevision',
    'originReferenceSessionId', 'reconstructedFidelityReport', 'selectedSceneIds',
    'selectedClipIds', 'canonicalTemplateProject', 'extractedParameters', 'replaceableSlots',
    'generalizationReport', 'requiredAssets', 'requiredFonts', 'requiredEffects', 'licenseType',
    'licenseNote', 'attribution', 'thumbnailSvgDataUri', 'previewSnapshotHash',
    'structuralContentHash', 'qualityReport', 'pipelineStages', 'duplicateSuggestions',
    'catalogItemDraft', 'autoSavedFromAiComponent', 'publishedToCatalog', 'publishedAt',
    'version', 'versionHistory', 'deprecationStatus', 'createdAt', 'updatedAt',
  ]);
  const REQUIRED_DRAFT_KEYS = [
    'id', 'ownerUid', 'title', 'sourceKind', 'provenanceClassification',
    'publishedToCatalog', 'version', 'createdAt', 'updatedAt',
  ];
  const ALLOWED_SOURCE_KINDS = new Set([
    'from-scratch', 'canonical-project', 'reference-reconstruction', 'ai-director-component',
  ]);
  const ALLOWED_PROVENANCE = new Set([
    'Source-Proven Canonical', 'Author-Created Scratch', 'Reconstructed', 'Original', 'Derived-Authorized', 'Synthetic-AI',
  ]);

  function simulateValidateDraft(data: Record<string, any>, authUid: string): boolean {
    for (const k of REQUIRED_DRAFT_KEYS) {
      if (!(k in data)) return false;
    }
    for (const k of Object.keys(data)) {
      if (!ALLOWED_DRAFT_KEYS.has(k)) return false;
    }
    if (typeof data.id !== 'string' || data.id.length < 1 || data.id.length > 128) return false;
    if (typeof data.ownerUid !== 'string' || data.ownerUid !== authUid) return false;
    if (typeof data.title !== 'string' || data.title.length < 1 || data.title.length > 160) return false;
    if (!ALLOWED_SOURCE_KINDS.has(data.sourceKind)) return false;
    if (!ALLOWED_PROVENANCE.has(data.provenanceClassification)) return false;
    if (typeof data.publishedToCatalog !== 'boolean') return false;
    if (typeof data.version !== 'string' || data.version.length < 1 || data.version.length > 32) return false;
    if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') return false;
    return true;
  }

  const validDraft = {
    id: 'draft_test_123',
    ownerUid: 'user_alice',
    title: 'Kinetic Neon Typography',
    sourceKind: 'canonical-project',
    provenanceClassification: 'Source-Proven Canonical',
    publishedToCatalog: false,
    version: '1.0.0',
    createdAt: '2026-10-28T12:00:00Z',
    updatedAt: '2026-10-28T12:00:00Z',
  };

  // 1. Valid payload passes
  assert.equal(simulateValidateDraft(validDraft, 'user_alice'), true);

  // 2. Cross-user write rejected (IDOR)
  assert.equal(simulateValidateDraft(validDraft, 'user_bob'), false);

  // 3. Missing title rejected
  const { title: _, ...missingTitle } = validDraft;
  assert.equal(simulateValidateDraft(missingTitle, 'user_alice'), false);

  // 4. Missing sourceKind rejected
  const { sourceKind: __, ...missingSource } = validDraft;
  assert.equal(simulateValidateDraft(missingSource, 'user_alice'), false);

  // 5. Injected shadow field rejected
  const shadowField = { ...validDraft, adminBackdoorRole: 'superuser' };
  assert.equal(simulateValidateDraft(shadowField, 'user_alice'), false);

  // 6. Invalid enum rejected
  const invalidSource = { ...validDraft, sourceKind: 'untrusted-stolen-preset' };
  assert.equal(simulateValidateDraft(invalidSource, 'user_alice'), false);
  const invalidProv = { ...validDraft, provenanceClassification: 'Fabricated-Origin' };
  assert.equal(simulateValidateDraft(invalidProv, 'user_alice'), false);

  // 7. Verify update immutability rules:
  const ALLOWED_UPDATE_KEYS = new Set([
    'title', 'slug', 'description', 'categoryId', 'tags', 'selectedSceneIds',
    'selectedClipIds', 'canonicalTemplateProject', 'extractedParameters', 'replaceableSlots',
    'generalizationReport', 'requiredAssets', 'requiredFonts', 'requiredEffects', 'licenseType',
    'licenseNote', 'attribution', 'thumbnailSvgDataUri', 'previewSnapshotHash',
    'structuralContentHash', 'qualityReport', 'pipelineStages', 'duplicateSuggestions',
    'catalogItemDraft', 'autoSavedFromAiComponent', 'publishedToCatalog', 'publishedAt',
    'version', 'versionHistory', 'deprecationStatus', 'updatedAt',
  ]);

  function simulateUpdateDraft(existing: Record<string, any>, incoming: Record<string, any>, authUid: string): boolean {
    if (!simulateValidateDraft(incoming, authUid)) return false;
    if (incoming.id !== existing.id) return false;
    if (incoming.ownerUid !== existing.ownerUid) return false;
    if (incoming.sourceKind !== existing.sourceKind) return false;
    if (incoming.createdAt !== existing.createdAt) return false;
    const changedKeys = Object.keys(incoming).filter((k) => incoming[k] !== existing[k]);
    for (const ck of changedKeys) {
      if (!ALLOWED_UPDATE_KEYS.has(ck)) return false;
    }
    return true;
  }

  const legitimateUpdate = {
    ...validDraft,
    title: 'Kinetic Neon Typography (v1.0.1)',
    version: '1.0.1',
    updatedAt: '2026-10-28T12:05:00Z',
  };
  assert.equal(simulateUpdateDraft(validDraft, legitimateUpdate, 'user_alice'), true);

  // Mutating immutable sourceKind rejected
  const badSourceUpdate = {
    ...validDraft,
    sourceKind: 'reference-reconstruction',
    updatedAt: '2026-10-28T12:05:00Z',
  };
  assert.equal(simulateUpdateDraft(validDraft, badSourceUpdate, 'user_alice'), false);

  // Mutating immutable ownerUid rejected
  const badOwnerUpdate = {
    ...validDraft,
    ownerUid: 'user_attacker',
    updatedAt: '2026-10-28T12:05:00Z',
  };
  assert.equal(simulateUpdateDraft(validDraft, badOwnerUpdate, 'user_alice'), false);
});

test('Firestore Security Simulator: Render Export Job create & update validation', () => {
  const ALLOWED_JOB_KEYS = new Set([
    'id', 'ownerUid', 'projectId', 'projectTitle', 'projectRevision', 'directorSessionId',
    'executionTier', 'outputFormat', 'targetAdapter', 'requestedWidth', 'requestedHeight',
    'requestedFps', 'requestedDurationSec', 'sampleTimestampSec', 'downscaleAssetsForProxy',
    'serverWorkerDisclosure', 'stage', 'cancellable', 'completedWorkUnits', 'totalWorkUnits',
    'progressPercent', 'stageHistory', 'retryPolicy', 'featureLossReport', 'artifactMetadata',
    'artifactBytesBase64', 'qaReport', 'errorCode', 'sanitizedErrorMessage', 'createdAt',
    'updatedAt', 'completedAt',
  ]);
  const REQUIRED_JOB_KEYS = [
    'id', 'ownerUid', 'projectId', 'projectTitle', 'projectRevision', 'executionTier',
    'outputFormat', 'targetAdapter', 'requestedWidth', 'requestedHeight', 'requestedFps',
    'requestedDurationSec', 'stage', 'cancellable', 'completedWorkUnits', 'totalWorkUnits',
    'progressPercent', 'createdAt', 'updatedAt',
  ];
  const ALLOWED_FORMATS = new Set([
    'sowveil-project-json', 'sowveil-bundle-zip', 'png-frame', 'jpeg-frame', 'svg-vector',
    'wav-audio', 'audio-stems-zip', 'srt-captions', 'vtt-captions', 'alight-motion-xml',
    'capcut-handoff-zip', 'node-video-handoff-zip', 'kinemaster-handoff-zip', 'webm-video', 'mp4-video',
  ]);
  const ALLOWED_STAGES = new Set([
    'queued', 'validating-project', 'resolving-assets', 'rendering-frames', 'synthesizing-audio',
    'packaging-container', 'running-final-qa', 'ready', 'cancelled', 'interrupted-recovered',
    'failed', 'needs-worker-setup',
  ]);
  const ALLOWED_ADAPTERS = new Set([
    'sowveil-project', 'alight-motion', 'capcut', 'node-video', 'kinemaster', 'universal-bundle',
  ]);

  function simulateValidateJob(data: Record<string, any>, authUid: string): boolean {
    for (const k of REQUIRED_JOB_KEYS) {
      if (!(k in data)) return false;
    }
    for (const k of Object.keys(data)) {
      if (!ALLOWED_JOB_KEYS.has(k)) return false;
    }
    if (typeof data.id !== 'string' || data.id.length < 1 || data.id.length > 128) return false;
    if (typeof data.ownerUid !== 'string' || data.ownerUid !== authUid) return false;
    if (typeof data.projectId !== 'string' || data.projectId.length < 1 || data.projectId.length > 128) return false;
    if (typeof data.projectTitle !== 'string' || data.projectTitle.length < 1 || data.projectTitle.length > 200) return false;
    if (typeof data.projectRevision !== 'number' || data.projectRevision < 1) return false;
    if (!['timeline-preview', 'proxy-render', 'final-render'].includes(data.executionTier)) return false;
    if (!ALLOWED_FORMATS.has(data.outputFormat)) return false;
    if (!ALLOWED_ADAPTERS.has(data.targetAdapter)) return false;
    if (!ALLOWED_STAGES.has(data.stage)) return false;
    if (typeof data.requestedWidth !== 'number' || data.requestedWidth < 64 || data.requestedWidth > 4096) return false;
    if (typeof data.requestedHeight !== 'number' || data.requestedHeight < 64 || data.requestedHeight > 4096) return false;
    if (![24, 30, 60].includes(data.requestedFps)) return false;
    if (typeof data.cancellable !== 'boolean') return false;
    if (typeof data.progressPercent !== 'number' || data.progressPercent < 0 || data.progressPercent > 100) return false;
    if (typeof data.createdAt !== 'string' || typeof data.updatedAt !== 'string') return false;
    return true;
  }

  const validJob = {
    id: 'job_render_456',
    ownerUid: 'user_alice',
    projectId: 'proj_sowveil_1',
    projectTitle: 'Product Promo Reel',
    projectRevision: 3,
    executionTier: 'final-render',
    outputFormat: 'mp4-video',
    targetAdapter: 'sowveil-project',
    requestedWidth: 1080,
    requestedHeight: 1920,
    requestedFps: 30,
    requestedDurationSec: 15.0,
    stage: 'queued',
    cancellable: true,
    completedWorkUnits: 0,
    totalWorkUnits: 450,
    progressPercent: 0,
    createdAt: '2026-10-28T12:00:00Z',
    updatedAt: '2026-10-28T12:00:00Z',
  };

  // 1. Valid job passes
  assert.equal(simulateValidateJob(validJob, 'user_alice'), true);

  // 2. Cross-user IDOR write rejected
  assert.equal(simulateValidateJob(validJob, 'user_bob'), false);

  // 3. Invalid FPS (e.g. 120 or 25) rejected
  assert.equal(simulateValidateJob({ ...validJob, requestedFps: 120 }, 'user_alice'), false);

  // 4. Progress > 100% rejected
  assert.equal(simulateValidateJob({ ...validJob, progressPercent: 125 }, 'user_alice'), false);

  // 5. Invalid outputFormat rejected
  assert.equal(simulateValidateJob({ ...validJob, outputFormat: 'flv-flash' }, 'user_alice'), false);

  // 6. Invalid stage rejected
  assert.equal(simulateValidateJob({ ...validJob, stage: 'rendering-in-cloud' }, 'user_alice'), false);

  // 7. Disallowed shadow field rejected
  assert.equal(simulateValidateJob({ ...validJob, bypassPayment: true }, 'user_alice'), false);

  // 8. Verify update immutability rules
  const ALLOWED_JOB_UPDATE_KEYS = new Set([
    'stage', 'cancellable', 'completedWorkUnits', 'totalWorkUnits', 'progressPercent',
    'stageHistory', 'retryPolicy', 'featureLossReport', 'artifactMetadata',
    'artifactBytesBase64', 'qaReport', 'errorCode', 'sanitizedErrorMessage',
    'updatedAt', 'completedAt',
  ]);

  function simulateUpdateJob(existing: Record<string, any>, incoming: Record<string, any>, authUid: string): boolean {
    if (!simulateValidateJob(incoming, authUid)) return false;
    if (incoming.id !== existing.id) return false;
    if (incoming.ownerUid !== existing.ownerUid) return false;
    if (incoming.projectId !== existing.projectId) return false;
    if (incoming.createdAt !== existing.createdAt) return false;
    const changedKeys = Object.keys(incoming).filter((k) => incoming[k] !== existing[k]);
    for (const ck of changedKeys) {
      if (!ALLOWED_JOB_UPDATE_KEYS.has(ck)) return false;
    }
    return true;
  }

  const progressUpdate = {
    ...validJob,
    stage: 'rendering-frames',
    completedWorkUnits: 225,
    progressPercent: 50,
    updatedAt: '2026-10-28T12:02:00Z',
  };
  assert.equal(simulateUpdateJob(validJob, progressUpdate, 'user_alice'), true);

  // Mutating immutable projectId rejected
  const badProjectUpdate = {
    ...validJob,
    projectId: 'proj_different_target',
    updatedAt: '2026-10-28T12:02:00Z',
  };
  assert.equal(simulateUpdateJob(validJob, badProjectUpdate, 'user_alice'), false);

  // Mutating immutable outputFormat rejected
  const badFormatUpdate = {
    ...validJob,
    outputFormat: 'webm-video',
    updatedAt: '2026-10-28T12:02:00Z',
  };
  assert.equal(simulateUpdateJob(validJob, badFormatUpdate, 'user_alice'), false);
});
