import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  applyReferenceCorrectionAction,
  BUILT_IN_REFERENCE_PRESETS,
  buildDraftTemplateFromReferenceSession,
  convertReferenceSessionToProjectRecord,
  createReferenceLabSession,
  inspectReferenceSourceUrl,
  validateAndPromoteReferenceTemplate,
} from '../services/referenceLabEngine';
import {
  validateCanonicalProject,
} from '../services/canonicalProjectEngine';
import { createApiApp } from '../server/apiApp';

test('Reference Lab: Public URL & Blocked URL Inspection (YouTube, Instagram, Pinterest, Direct HTTPS, DRM/Login/SSRF blocks)', () => {
  // 1. Public YouTube URL is accepted for metadata/provenance but honestly requires lawful upload/screenshots
  const yt = inspectReferenceSourceUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(yt.allowedForIngestion, true);
  assert.equal(yt.platformCategory, 'youtube');
  assert.equal(yt.accessStatus, 'public-page-metadata-only');
  assert.equal(yt.requiresUserMediaUpload, true);
  assert.ok(yt.lawfulFallbackInstruction.includes('lawful video download'));

  // 2. Public Instagram & Pinterest URLs are accepted with honest fallback disclosure
  const ig = inspectReferenceSourceUrl('https://www.instagram.com/reel/C8abc123/');
  assert.equal(ig.allowedForIngestion, true);
  assert.equal(ig.platformCategory, 'instagram');
  assert.equal(ig.requiresUserMediaUpload, true);

  const pin = inspectReferenceSourceUrl('https://www.pinterest.com/pin/123456789/');
  assert.equal(pin.allowedForIngestion, true);
  assert.equal(pin.platformCategory, 'pinterest');
  assert.equal(pin.requiresUserMediaUpload, true);

  // 3. Direct HTTPS media URL is permitted for direct ingestion
  const direct = inspectReferenceSourceUrl('https://cdn.example.com/demos/kinetic-reel.mp4');
  assert.equal(direct.allowedForIngestion, true);
  assert.equal(direct.platformCategory, 'direct-media');
  assert.equal(direct.accessStatus, 'direct-media-permitted');
  assert.equal(direct.requiresUserMediaUpload, false);

  // 4. Blocked URLs: Login-walled, DRM, Paywall, or Private URLs are rejected
  const drmUrl = inspectReferenceSourceUrl('https://www.youtube.com/private/drm/stream');
  assert.equal(drmUrl.allowedForIngestion, false);
  assert.equal(drmUrl.errorCode, 'RESTRICTED_AUTH_OR_DRM_URL_FORBIDDEN');

  const paywallUrl = inspectReferenceSourceUrl('https://media.example.com/paywall/member-only');
  assert.equal(paywallUrl.allowedForIngestion, false);
  assert.equal(paywallUrl.errorCode, 'RESTRICTED_AUTH_OR_DRM_URL_FORBIDDEN');

  // 5. Blocked URLs: SSRF loopback / internal metadata endpoints are rejected
  const ssrfUrl = inspectReferenceSourceUrl('http://169.254.169.254/latest/meta-data/');
  assert.equal(ssrfUrl.allowedForIngestion, false);
  assert.ok(ssrfUrl.errorCode);
});

test('Reference Lab: Permitted Upload Flow, Timecode Alignment, and Reproducible Pipeline Metadata', () => {
  const session = createReferenceLabSession({
    ownerUid: 'user_ref_1',
    title: 'Kinetic Launch Upload',
    usageMode: 'authorized-reconstruction',
    sourceKind: 'uploaded-video',
    presetId: BUILT_IN_REFERENCE_PRESETS[0].id,
    suppliedFileNames: ['brand-launch.mp4'],
    durationSec: 6,
    width: 1080,
    height: 1920,
    fps: 60,
    allowRemoteModelUpload: false,
    cancelledBeforeRemoteUpload: true,
    attributionText: 'Owned brand asset reel',
  });

  // Rights declaration & remote upload cancellation recorded
  assert.equal(session.rightsDeclaration.usageMode, 'authorized-reconstruction');
  assert.equal(session.rightsDeclaration.allowRemoteModelUpload, false);
  assert.equal(session.rightsDeclaration.cancelledBeforeRemoteUpload, true);
  assert.equal(session.rightsDeclaration.isUserDeclarationNotOwnershipProof, true);

  // Pipeline reproducibility metadata recorded
  assert.equal(
    session.pipelineMetadata.analyzerVersion,
    '2.0.0-deterministic-frame-graph'
  );
  assert.equal(
    session.pipelineMetadata.modelId,
    'local-deterministic-frame-analyzer-v2'
  );
  assert.equal(session.pipelineMetadata.samplingConfig.localOnlyMode, true);

  // Shot segmentation & timecode alignment
  assert.equal(session.shots.length, 3);
  assert.equal(session.fidelityReport.localCheckResult.alignedTimecodes, true);
  assert.equal(session.fidelityReport.localCheckResult.validCanonicalSchema, true);
  for (let i = 0; i < session.shots.length; i++) {
    const shot = session.shots[i];
    assert.ok(shot.endTimeSec > shot.startTimeSec);
    assert.ok(shot.representativeTimestampsSec.length >= 2);
    assert.ok(shot.denseSampleTimestampsSec.length >= 2);
    if (i > 0) {
      assert.ok(shot.startTimeSec >= session.shots[i - 1].endTimeSec - 0.001);
    }
  }

  // Every property observation records explicit provenance and confidence
  assert.ok(session.observations.length >= 6);
  for (const obs of session.observations) {
    assert.ok(
      [
        'provided source project',
        'measured from frame',
        'inferred',
        'generated approximation',
        'unknown',
      ].includes(obs.provenanceSource)
    );
    assert.ok(obs.confidence >= 0 && obs.confidence <= 1);
  }
});

test('Reference Lab: Distinct Outputs for Authorized Reconstruction vs Reference-Inspired Mode', () => {
  const authorized = createReferenceLabSession({
    ownerUid: 'user_ref_2',
    usageMode: 'authorized-reconstruction',
    sourceKind: 'uploaded-video',
    presetId: 'ref_preset_sowveil_hook',
    allowRemoteModelUpload: false,
    attributionText: 'Authorized source',
  });

  const inspired = createReferenceLabSession({
    ownerUid: 'user_ref_2',
    usageMode: 'reference-inspired',
    sourceKind: 'uploaded-video',
    presetId: 'ref_preset_sowveil_hook',
    allowRemoteModelUpload: false,
    attributionText: 'Visual reference only',
  });

  // 1. Reference-Inspired mode includes an explicit independenceManifest
  assert.equal(authorized.fidelityReport.independenceManifest, undefined);
  assert.ok(inspired.fidelityReport.independenceManifest);
  assert.ok(
    inspired.fidelityReport.independenceManifest.keptCreativeLessons.length >= 3
  );
  assert.ok(
    inspired.fidelityReport.independenceManifest.replacedDistinctiveElements.length >= 3
  );

  // 2. Duration and shot timing are shifted in Reference-Inspired mode
  assert.notEqual(
    authorized.mediaSpecs.durationSec,
    inspired.mediaSpecs.durationSec
  );

  // 3. Text copy and color palette in Reference-Inspired mode are independently generated
  const authTextClips = authorized.canonicalProject.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === 'text')
    .map((c) => c.textData?.content);
  const inspTextClips = inspired.canonicalProject.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === 'text')
    .map((c) => c.textData?.content);

  assert.notDeepEqual(authTextClips, inspTextClips);
  assert.ok(authTextClips[0]?.includes('LAUNCH IN 60 SECONDS'));
  assert.ok(inspTextClips[0]?.includes('INSPIRED CONCEPT:'));
});

test('Reference Lab: Editable Canonical Layer Graph & Interactive Refinement Queue Controls', () => {
  let session = createReferenceLabSession({
    ownerUid: 'user_ref_3',
    usageMode: 'authorized-reconstruction',
    sourceKind: 'uploaded-video',
    presetId: 'ref_preset_sowveil_hook',
    allowRemoteModelUpload: false,
  });

  // 1. adjust-transition
  session = applyReferenceCorrectionAction(session, {
    actionType: 'adjust-transition',
    shotId: 'shot_01',
    transitionType: 'zoom-blur',
    transitionDurationSec: 0.45,
  });
  assert.equal(session.shots[0].transitionIn, 'zoom-blur');
  assert.equal(session.fidelityReport.localCheckResult.passed, true);

  // 2. slow-title-entrance
  const textTrackBefore = session.canonicalProject.tracks.find((t) => t.kind === 'text')!;
  const titleBefore = textTrackBefore.clips.find((c) => c.id === 'clip_ref_text_1')!;
  const oldEntranceTime = titleBefore.keyframes[1].timeSec;

  session = applyReferenceCorrectionAction(session, {
    actionType: 'slow-title-entrance',
    shotId: 'shot_01',
    slowdownFactor: 1.5,
  });
  const textTrackAfter = session.canonicalProject.tracks.find((t) => t.kind === 'text')!;
  const titleAfter = textTrackAfter.clips.find((c) => c.id === 'clip_ref_text_1')!;
  assert.ok(titleAfter.keyframes[1].timeSec > oldEntranceTime);
  assert.equal(session.fidelityReport.localCheckResult.passed, true);

  // 3. replace-background-asset
  session = applyReferenceCorrectionAction(session, {
    actionType: 'replace-background-asset',
    shotId: 'shot_01',
    newBackgroundColorHex: '#182238',
  });
  assert.equal(session.canonicalProject.canvas.backgroundColorHex, '#182238');
  assert.equal(session.fidelityReport.localCheckResult.passed, true);

  // 4. match-color
  session = applyReferenceCorrectionAction(session, {
    actionType: 'match-color',
    shotId: 'shot_01',
    colorHexToMatch: '#00F5D4',
  });
  assert.equal(session.shots[0].typographyAnalysis.textColorHex, '#00F5D4');

  // 5. preserve-layer
  session = applyReferenceCorrectionAction(session, {
    actionType: 'preserve-layer',
    shotId: 'shot_01',
  });
  const lockedTitle = session.canonicalProject.tracks
    .find((t) => t.kind === 'text')!
    .clips.find((c) => c.id === 'clip_ref_text_1')!;
  assert.equal(lockedTitle.locked, true);

  // 6. reanalyze-segment
  const oldConfidence = session.shots[1].confidenceScore;
  session = applyReferenceCorrectionAction(session, {
    actionType: 'reanalyze-segment',
    shotId: 'shot_02',
  });
  assert.ok(session.shots[1].confidenceScore > oldConfidence);

  // 7. correct-observation
  const targetObsId = session.observations[0].id;
  session = applyReferenceCorrectionAction(session, {
    actionType: 'correct-observation',
    shotId: 'shot_01',
    observationId: targetObsId,
    correctedValue: 'CUSTOM VERIFIED HEADLINE',
  });
  const updatedObs = session.observations.find((o) => o.id === targetObsId)!;
  assert.equal(updatedObs.userCorrectedValue, 'CUSTOM VERIFIED HEADLINE');
  assert.equal(updatedObs.uncertain, false);
  assert.equal(updatedObs.confidence, 1.0);
});

test('Reference Lab: Fidelity Report, Project Library Conversion & Template Draft-to-Validated Promotion', () => {
  const session = createReferenceLabSession({
    ownerUid: 'user_ref_4',
    usageMode: 'authorized-reconstruction',
    sourceKind: 'uploaded-video',
    presetId: 'ref_preset_sowveil_hook',
    allowRemoteModelUpload: false,
  });

  // 1. Fidelity report completeness & honest disclosure
  const report = session.fidelityReport;
  assert.equal(report.pixelIdenticalClaimed, false);
  assert.ok(report.reconstructedEditableProperties.length >= 3);
  assert.ok(report.approximatedProperties.length >= 1);
  assert.ok(report.unrecoverableProperties.length >= 2);
  assert.equal(report.perShotConfidence.length, session.shots.length);
  assert.ok(report.knownDifferences.length >= 2);
  assert.ok(report.requiredUserDecisions.length >= 1);

  // 2. Save to Project Library produces valid CanonicalProjectDocument v2.0.0 record
  const projectRecord = convertReferenceSessionToProjectRecord(session);
  assert.equal(projectRecord.ownerUid, 'user_ref_4');
  assert.equal(projectRecord.projectFileStatus, 'sowveil-native');
  assert.ok(projectRecord.canonicalProjectJson);
  const parsedProj = JSON.parse(projectRecord.canonicalProjectJson!);
  assert.equal(validateCanonicalProject(parsedProj).valid, true);

  // 3. Save as Private Draft Template & Promote to Validated after render smoke test + editability check
  const draftTemplate = buildDraftTemplateFromReferenceSession(session);
  assert.equal(draftTemplate.visibility, 'private');
  assert.equal(draftTemplate.validationState, 'Draft');
  // Unknown third-party rights are never published as Free
  assert.notEqual(draftTemplate.licenseType, 'Free');
  assert.ok((draftTemplate.editableParams || []).length >= 3);

  const promotion = validateAndPromoteReferenceTemplate(session, draftTemplate);
  assert.equal(promotion.promoted, true);
  assert.equal(promotion.localChecks.renderSmokeTestPassed, true);
  assert.equal(promotion.template.validationState, 'Validated');
  assert.equal(promotion.template.lastValidationRecord?.passed, true);
});

test('Reference Lab API Endpoints: Owner-Scoped Session Creation, Refinement, Project Save & Template Promotion', async () => {
  const app = createApiApp({
    tokenVerifier: async (token) => {
      if (token === 'token_alice') {
        return {
          uid: 'uid_alice',
          email: 'alice@example.com',
          emailVerified: true,
          displayName: 'Alice',
        };
      }
      return {
        uid: 'uid_bob',
        email: 'bob@example.com',
        emailVerified: true,
        displayName: 'Bob',
      };
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Create Reference Lab session as Alice
    const createRes = await fetch(`${baseUrl}/api/v1/reference-lab/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_alice',
      },
      body: JSON.stringify({
        title: 'API Reconstruction Session',
        usageMode: 'reference-inspired',
        sourceKind: 'uploaded-video',
        presetId: 'ref_preset_sowveil_hook',
        allowRemoteModelUpload: false,
        cancelledBeforeRemoteUpload: true,
        attributionText: 'Visual inspiration only',
      }),
    });
    assert.equal(createRes.status, 201);
    const createdBody = await createRes.json();
    const sessionId = createdBody.data.session.id;
    assert.equal(
      createdBody.data.session.rightsDeclaration.usageMode,
      'reference-inspired'
    );

    // 2. Cross-user IDOR check: Bob cannot access or mutate Alice's session
    const bobGet = await fetch(
      `${baseUrl}/api/v1/reference-lab/sessions/${sessionId}`,
      {
        headers: { Authorization: 'Bearer token_bob' },
      }
    );
    assert.equal(bobGet.status, 403);

    // 3. Apply refinement action as Alice
    const actionRes = await fetch(
      `${baseUrl}/api/v1/reference-lab/sessions/${sessionId}/actions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_alice',
        },
        body: JSON.stringify({
          actionType: 'match-color',
          shotId: 'shot_01',
          colorHexToMatch: '#38BDF8',
        }),
      }
    );
    assert.equal(actionRes.status, 200);
    const actionBody = await actionRes.json();
    assert.equal(actionBody.data.localChecks.passed, true);

    // 4. Save to Project Library as Alice
    const saveProjRes = await fetch(
      `${baseUrl}/api/v1/reference-lab/sessions/${sessionId}/save-project`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token_alice' },
      }
    );
    assert.equal(saveProjRes.status, 201);
    const saveProjBody = await saveProjRes.json();
    assert.ok(saveProjBody.data.project.id.startsWith('proj_ref_'));

    // 5. Save and promote template to Validated as Alice
    const saveTplRes = await fetch(
      `${baseUrl}/api/v1/reference-lab/sessions/${sessionId}/save-template`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token_alice',
        },
        body: JSON.stringify({ promoteToValidated: true }),
      }
    );
    assert.equal(saveTplRes.status, 201);
    const saveTplBody = await saveTplRes.json();
    assert.equal(saveTplBody.data.template.validationState, 'Validated');
    assert.equal(saveTplBody.data.template.licenseType, 'Sowveil Original');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
