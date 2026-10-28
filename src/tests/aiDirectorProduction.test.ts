import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import { validateCanonicalProject } from '../services/canonicalProjectEngine';
import {
  answerDirectorQuestions,
  applyAdaptiveRefinement,
  BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS,
  computeCompleteCoverageLedger,
  createAiDirectorSession,
  evaluateDirectorAcceptanceGate,
  executeDirectorProductionPlan,
  rollbackDirectorToCheckpoint,
  segmentScriptWithExactOffsets,
  updateDirectorShotPlanAndApprovals,
} from '../services/aiDirectorProductionEngine';
import { createApiApp } from '../server/apiApp';

test('AI Director 1: Short, multi-paragraph, and long scripts (>11,000 chars) preserve exact character offsets without tail truncation', () => {
  // 1. Short script
  const shortScript = 'Launch faster with Sowveil Studio. Every frame stays editable.';
  const shortResult = segmentScriptWithExactOffsets(shortScript, {
    preserveEveryRepetition: true,
  });
  assert.equal(shortResult.segments.length, 2);
  for (const seg of shortResult.segments) {
    assert.equal(
      shortScript.slice(seg.startOffset, seg.endOffset),
      seg.exactOriginalText,
      `Exact offset mismatch for ${seg.segmentId}`
    );
  }

  // 2. Multi-paragraph script from built-in sample
  const sampleScript = BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText;
  const multiResult = segmentScriptWithExactOffsets(sampleScript, {
    preserveEveryRepetition: true,
  });
  assert.ok(multiResult.segments.length >= 6);
  for (const seg of multiResult.segments) {
    assert.equal(
      sampleScript.slice(seg.startOffset, seg.endOffset),
      seg.exactOriginalText
    );
  }

  // 3. Long script (>11,000 chars across multiple chunks)
  const paragraphs: string[] = [];
  for (let i = 1; i <= 55; i++) {
    paragraphs.push(
      `Section ${i}: Sowveil Studio maintains canonical v2.0.0 timeline fidelity across all 20 motion modules. Paragraph ${i} verifies chunked offset reconciliation without dropping tail content at marker TAIL_GUARD_${i}.`
    );
  }
  const longScript = paragraphs.join('\n\n');
  assert.ok(
    longScript.length > 11000,
    `Expected long script > 11000 chars, got ${longScript.length}`
  );

  const longResult = segmentScriptWithExactOffsets(longScript, {
    preserveEveryRepetition: true,
  });
  assert.ok(
    longResult.chunkCountProcessed >= 3,
    `Expected >= 3 chunks, got ${longResult.chunkCountProcessed}`
  );
  assert.equal(longResult.segments.length, 220);
  for (const seg of longResult.segments) {
    assert.equal(
      longScript.slice(seg.startOffset, seg.endOffset),
      seg.exactOriginalText
    );
  }

  // Verify the very last sentence ("TAIL_GUARD_55") is preserved with exact offsets
  const lastSeg = longResult.segments[longResult.segments.length - 1];
  assert.ok(
    lastSeg.exactOriginalText.includes('TAIL_GUARD_55'),
    'Tail passage must never be truncated'
  );
  assert.equal(
    longScript.slice(lastSeg.startOffset, lastSeg.endOffset),
    lastSeg.exactOriginalText
  );
});

test('AI Director 2: Repeated lines/refrains are preserved as distinct offset-exact segments and tracked in meaningfulRepetitions', () => {
  const refrainScript = [
    'Build once, ship everywhere.',
    'Creators need speed and precision on mobile.',
    'Build once, ship everywhere.',
    'Every template parameter remains live and editable.',
    'Build once, ship everywhere.',
  ].join('\n\n');

  const session = createAiDirectorSession({
    ownerUid: 'user-refrain',
    title: 'Refrain Preservation Test',
    rawScriptText: refrainScript,
    preserveEveryRepetition: true,
  });

  assert.equal(session.segments.length, 5, 'All 5 occurrences must be preserved');
  const refrainSegments = session.segments.filter(
    (s) => s.exactOriginalText === 'Build once, ship everywhere.'
  );
  assert.equal(
    refrainSegments.length,
    3,
    'All 3 refrain occurrences must be distinct segments'
  );
  assert.equal(refrainSegments[0].isRepetitionOfSegmentId, null);
  assert.equal(refrainSegments[1].isRepetitionOfSegmentId, refrainSegments[0].segmentId);
  assert.equal(refrainSegments[2].isRepetitionOfSegmentId, refrainSegments[0].segmentId);
  assert.equal(session.analysisReport.meaningfulRepetitions.length, 2);
});

test('AI Director 3: Coverage ledger detects uncovered segments vs. explicit user-approved omissions', () => {
  const session = createAiDirectorSession({
    ownerUid: 'user-cov',
    rawScriptText:
      'First passage for coverage test.\n\nSecond passage that will be omitted with user consent.\n\nThird passage for timeline.',
  });

  assert.equal(session.coverageLedger.totalSegments, 3);
  assert.equal(session.coverageLedger.isReadyForProduction, true);
  assert.equal(session.coverageLedger.uncoveredSegments, 0);

  // Explicitly omit seg_0002 with user approval
  const afterOmit = updateDirectorShotPlanAndApprovals(session, {
    action: 'omit-segment-with-consent',
    segmentIdToOmit: 'seg_0002',
    omissionReason: 'Cut for 15s social pacing per user approval',
  });

  assert.equal(afterOmit.coverageLedger.omittedWithApprovalSegments, 1);
  assert.equal(afterOmit.coverageLedger.isReadyForProduction, true);

  // Simulate an accidental uncovered segment (no shot mapped and not omitted by user)
  const brokenSegments = JSON.parse(JSON.stringify(afterOmit.segments));
  const brokenLedger = computeCompleteCoverageLedger(
    afterOmit.originalScriptText,
    brokenSegments,
    afterOmit.shots.slice(0, 1) // drops shot for seg_0003
  );
  assert.equal(brokenLedger.isReadyForProduction, false);
  assert.equal(brokenLedger.uncoveredSegments, 1);
  assert.deepEqual(brokenLedger.uncoveredSegmentIds, ['seg_0003']);
});

test('AI Director 4: Question deduplication remembers answered fingerprints and no-questions workflow records assumptions', () => {
  // 1. Standard question flow + fingerprint deduplication
  const session = createAiDirectorSession({
    ownerUid: 'user-q',
    rawScriptText: 'A concise product teaser for Sowveil Studio.',
  });

  assert.ok(session.questions.length >= 2);
  const firstQ = session.questions[0];

  const answered = answerDirectorQuestions(session, {
    answers: {
      [firstQ.id]: {
        answer: firstQ.options[0],
        lockDecision: true,
      },
    },
    applyDefaultsToUnanswered: true,
  });

  assert.ok(
    answered.answeredQuestionFingerprints.includes(firstQ.fingerprint),
    'Answered question fingerprint must be stored'
  );
  const updatedFirstQ = answered.questions.find((q) => q.id === firstQ.id)!;
  assert.equal(updatedFirstQ.status, 'locked');
  assert.equal(updatedFirstQ.lockedByUser, true);

  // 2. No-questions workflow fast-tracks to brief-shot-plan and records assumptions
  const noQSession = createAiDirectorSession({
    ownerUid: 'user-noq',
    rawScriptText: 'Fast-track script with no-questions workflow enabled.',
    noQuestionsWorkflow: true,
  });

  assert.equal(noQSession.stage, 'brief-shot-plan');
  assert.ok(
    noQSession.productionBrief.deliverablesAndRestrictions.recordedAssumptions.length >= 2,
    'No-questions mode must explicitly record assumptions in the Production Brief'
  );
});

test('AI Director 5: 20-field Production Brief, 22-field Shot Plan, and 4-Tier Asset Ranking validate real catalog templates', () => {
  const session = createAiDirectorSession({
    ownerUid: 'user-brief',
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
  });

  const briefKeys = [
    'targetAudience',
    'targetPlatform',
    'productionGoal',
    'runtimeSec',
    'aspectRatio',
    'frameRate',
    'language',
    'visualStyle',
    'pacingProfile',
    'colorPalette',
    'typographySpec',
    'footageAndAssetsPolicy',
    'cameraLanguage',
    'graphicsAndOverlays',
    'voiceoverDirection',
    'captionsPolicy',
    'sfxDirection',
    'musicDirection',
    'transitionsPolicy',
    'accessibilityRequirements',
    'deliverablesAndRestrictions',
  ];
  for (const key of briefKeys) {
    assert.ok(
      key in session.productionBrief,
      `Missing required Production Brief field: ${key}`
    );
  }

  assert.ok(session.shots.length >= 6);
  const validCatalogIds = new Set(SEED_CATALOG_ITEMS.map((i) => i.id));

  for (const shot of session.shots) {
    const requiredShotKeys = [
      'shotId',
      'shotNumber',
      'scriptSegmentIds',
      'exactTextCoverage',
      'characterStartOffset',
      'characterEndOffset',
      'startTimeSec',
      'estimatedDurationSec',
      'beatAndEmotionalPurpose',
      'subjectAndAction',
      'compositionFramingCameraMovement',
      'backgroundEnvironment',
      'paletteAndLighting',
      'typographyAndGraphics',
      'assetsRequiredAndPreferredSource',
      'templateCandidatesAndRationale',
      'animationAndEasing',
      'transitionInOut',
      'audioVoiceSfxMusicIntent',
      'effects3dCompositing',
      'technicalParameters',
      'fallbackApproach',
      'risksAndWarnings',
      'estimatedWorkAndCostUsd',
      'editableParameters',
    ];
    for (const k of requiredShotKeys) {
      assert.ok(k in shot, `Shot ${shot.shotId} missing field ${k}`);
    }

    assert.ok(
      validCatalogIds.has(shot.editableParameters.selectedTemplateId),
      `Shot ${shot.shotId} selectedTemplateId "${shot.editableParameters.selectedTemplateId}" must exist in SEED_CATALOG_ITEMS`
    );

    const tiers = new Set(
      shot.assetsRequiredAndPreferredSource.rankedCandidates.map((c) => c.tierRank)
    );
    assert.ok(tiers.has(1), 'Must include Tier 1 (Sowveil Catalog)');
    assert.ok(tiers.has(3), 'Must include Tier 3 (Installed Skill Workflow)');
    assert.ok(tiers.has(4), 'Must include Tier 4 (Procedural Fallback)');
  }

  // Verify assigning a non-existent template ID throws TEMPLATE_NOT_FOUND
  assert.throws(
    () =>
      updateDirectorShotPlanAndApprovals(session, {
        action: 'edit-shot',
        shotId: session.shots[0].shotId,
        editablePatch: {
          selectedTemplateId: 'tpl_non_existent_fake_999',
        },
      }),
    /TEMPLATE_NOT_FOUND/
  );
});

test('AI Director 6: Approval gate blocks unapproved production, compiles CanonicalProjectDocument v2.0.0 on approval, and isolates per-shot dependency failures', () => {
  const session = createAiDirectorSession({
    ownerUid: 'user-prod',
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[1].scriptText,
    autonomyMode: 'require-approval',
  });

  // 1. Attempting production before approval must throw
  assert.throws(
    () => executeDirectorProductionPlan(session),
    /APPROVAL_REQUIRED_BEFORE_PRODUCTION/,
    'Must block production when require-approval is active and shots are pending approval'
  );

  // 2. Approve whole plan
  const approved = updateDirectorShotPlanAndApprovals(session, {
    action: 'approve-all',
  });
  assert.ok(approved.shots.every((s) => s.approvalState === 'approved'));

  // 3. Execute production while simulating a dependency failure on shot_002
  const produced = executeDirectorProductionPlan(approved, {
    simulateFailedShotIds: ['shot_002'],
  });

  assert.ok(produced.canonicalProject, 'CanonicalProjectDocument v2.0.0 must be compiled');
  const validation = validateCanonicalProject(produced.canonicalProject!);
  assert.equal(
    validation.valid,
    true,
    `Compiled CanonicalProjectDocument failed validation: ${JSON.stringify(validation.errors)}`
  );

  // Verify shot_002 fell back gracefully without deleting any scenes or other shots
  assert.equal(
    produced.canonicalProject!.scenes.length,
    approved.shots.length,
    'All scenes must be preserved even when one shot triggers its fallback'
  );
  const fallbackShot = produced.shots.find((s) => s.shotId === 'shot_002')!;
  assert.equal(fallbackShot.fallbackApproach.activated, true);
  assert.equal(fallbackShot.productionStatus, 'fallback-isolated');

  const fallbackProv = produced.generatedAssetRecords.find((p) => p.shotId === 'shot_002');
  assert.ok(fallbackProv && fallbackProv.status === 'fallback-substituted');

  // Verify 4-way traceability maps every active segment and shot
  for (const shot of produced.shots) {
    assert.ok(
      (produced.traceability.shotToTimelineClipsMap[shot.shotId] || []).length >= 4,
      `Shot ${shot.shotId} must trace to vector, text, caption, and audio timeline clips`
    );
  }
  assert.equal(produced.coverageLedger.producedSegments, produced.segments.length);
  assert.equal(produced.coverageLedger.coveragePercent, 100);
});

test('AI Director 7: Adaptive refinements respect user-locked fields, create reversible checkpoints, and support rollback + 10-point Acceptance Gate', () => {
  let session = createAiDirectorSession({
    ownerUid: 'user-ref',
    rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
    autonomyMode: 'bounded-autonomy',
  });

  session = executeDirectorProductionPlan(session);
  assert.equal(
    session.acceptanceGate.passed,
    true,
    `Expected all 10 Acceptance Gate checks to pass, got failures: ${session.acceptanceGate.blockingReasons.join('; ')}`
  );
  assert.ok(session.refinementSuggestions.length >= 1);

  const firstSuggestion = session.refinementSuggestions[0];
  const targetShotId = firstSuggestion.affectedShotIds[0];
  const targetField = firstSuggestion.targetEditableField;

  // 1. Lock the field on the target shot and verify applyAdaptiveRefinement blocks it
  const lockedSession = updateDirectorShotPlanAndApprovals(session, {
    action: 'lock-shot',
    shotId: targetShotId,
    lockFields: [targetField],
  });

  assert.throws(
    () => applyAdaptiveRefinement(lockedSession, firstSuggestion.suggestionId),
    /LOCKED_DECISION_PROTECTED/,
    'Applying a refinement that mutates a user-locked field must throw'
  );

  // 2. Apply the refinement on the unlocked session and verify checkpoint creation + rollback
  const refinedSession = applyAdaptiveRefinement(session, firstSuggestion.suggestionId);
  assert.ok(
    refinedSession.productionCheckpoints.length >= 2,
    'Applying refinement must save a pre-refinement checkpoint'
  );

  const preRefinementCheckpointId = refinedSession.productionCheckpoints[0].checkpointId;
  const rolledBack = rollbackDirectorToCheckpoint(refinedSession, preRefinementCheckpointId);

  const origShot = session.shots.find((s) => s.shotId === targetShotId)!;
  const restoredShot = rolledBack.shots.find((s) => s.shotId === targetShotId)!;
  assert.equal(
    restoredShot.editableParameters[targetField],
    origShot.editableParameters[targetField],
    'Rollback must restore the exact shot parameter state from the checkpoint'
  );

  const finalGate = evaluateDirectorAcceptanceGate(rolledBack);
  assert.equal(finalGate.passed, true);
});

test('AI Director 8: REST API endpoints enforce owner scoping (IDOR 403 protection) and save compiled project to Project Library', async () => {
  const app = createApiApp({
    tokenVerifier: async (token: string) => {
      if (token === 'token-alice') {
        return { uid: 'uid-alice', email: 'alice@sowveil.studio', emailVerified: true };
      }
      if (token === 'token-bob') {
        return { uid: 'uid-bob', email: 'bob@sowveil.studio', emailVerified: true };
      }
      throw new Error('Invalid token');
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Create session as Alice
    const createRes = await fetch(`${baseUrl}/api/v1/ai-director/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-alice',
      },
      body: JSON.stringify({
        title: 'Alice Confidential Launch Plan',
        rawScriptText: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS[0].scriptText,
        intake: {
          noQuestionsWorkflow: true,
        },
      }),
    });
    assert.equal(createRes.status, 201);
    const createJson = await createRes.json();
    const sessionId = createJson.data.session.id;

    // 2. Bob attempts IDOR read & mutation -> must receive 403
    const bobGetRes = await fetch(`${baseUrl}/api/v1/ai-director/sessions/${sessionId}`, {
      headers: { Authorization: 'Bearer token-bob' },
    });
    assert.equal(bobGetRes.status, 403);

    const bobProduceRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${sessionId}/produce`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-bob',
        },
      }
    );
    assert.equal(bobProduceRes.status, 403);

    // 3. Alice approves whole plan, compiles canonical project, and saves to Project Library
    const planRes = await fetch(`${baseUrl}/api/v1/ai-director/sessions/${sessionId}/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-alice',
      },
      body: JSON.stringify({ action: 'approve-all' }),
    });
    assert.equal(planRes.status, 200);

    const produceRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${sessionId}/produce`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
        body: JSON.stringify({}),
      }
    );
    assert.equal(produceRes.status, 200);

    const saveRes = await fetch(
      `${baseUrl}/api/v1/ai-director/sessions/${sessionId}/save-project`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-alice',
        },
      }
    );
    assert.equal(saveRes.status, 200);
    const saveJson = await saveRes.json();
    assert.ok(saveJson.data.project.id);
    assert.equal(saveJson.data.session.acceptanceGate.passed, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
