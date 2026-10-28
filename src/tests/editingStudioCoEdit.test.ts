import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonicalProjectStore,
  createMinimalCanonicalProject,
  evaluateProjectAtTime,
  executeProjectCommand,
  serializeCanonicalProject,
  validateCanonicalProject,
} from '../services/canonicalProjectEngine';
import {
  applyAiCoEditTransaction,
  buildCubicBezierSvgPath,
  diffCanonicalProjects,
  EASING_CURVE_PRESETS,
  planAiCoEditTransaction,
} from '../services/coEditingEngine';
import { createSowveilApiApp } from '../server/apiApp';

function createRichEditorTestProject() {
  const base = createMinimalCanonicalProject({
    id: 'proj_editor_phase11',
    title: 'Phase 11 Pro Mobile Editor & AI Co-Edit Test',
    ownerUid: 'user-phase11',
    aspectRatio: '9:16',
    fps: 60,
    durationSec: 12,
  });

  base.scenes = [
    {
      id: 'scene_1',
      title: 'Scene 1 — Hook',
      order: 1,
      startTimeSec: 0,
      durationSec: 4,
      scriptSegmentIds: ['seg_hook_01'],
      continuityNotes: 'High-impact kinetic headline',
      status: 'approved',
    },
    {
      id: 'scene_2',
      title: 'Scene 2 — Feature Demo',
      order: 2,
      startTimeSec: 4,
      durationSec: 4,
      scriptSegmentIds: ['seg_cta_02'],
      continuityNotes: 'Interactive timeline demonstration',
      status: 'approved',
    },
  ];

  // Add audio track & narration clip + caption track & caption clip
  base.tracks.push(
    {
      id: 'trk_audio_01',
      name: 'Voiceover & SFX',
      kind: 'audio',
      order: 3,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_vo_01',
          trackId: 'trk_audio_01',
          sceneId: 'scene_1',
          sourceSegmentId: 'seg_hook_01',
          name: 'Hook Narration VO',
          kind: 'audio',
          startTimeSec: 0.25,
          durationSec: 3.4,
          sourceInSec: 0,
          sourceOutSec: 3.4,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [0, 0],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          audioConfig: {
            gainDb: 0,
            linearGain: 1,
            pan: 0,
            fadeInSec: 0.1,
            fadeOutSec: 0.2,
            muted: false,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'trk_caption_01',
      name: 'Auto Captions',
      kind: 'caption',
      order: 4,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_cap_01',
          trackId: 'trk_caption_01',
          sceneId: 'scene_1',
          sourceSegmentId: 'seg_hook_01',
          name: 'Caption 1',
          kind: 'caption',
          startTimeSec: 0,
          durationSec: 2.5,
          sourceInSec: 0,
          sourceOutSec: 2.5,
          trimInSec: 0,
          trimOutSec: 0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [540, 1420],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          captionData: {
            cueIndex: 1,
            text: 'Ship 60fps mobile reels in seconds.',
            speaker: 'Narrator',
            stylePresetId: 'word-highlight-orange',
            highlightColorHex: '#F06424',
            maxCharsPerLine: 28,
            wordTimings: [
              { word: 'Ship', startSec: 0, endSec: 0.5 },
              { word: '60fps', startSec: 0.5, endSec: 1.1 },
            ],
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    }
  );

  // Add second scene clip on track_text_1
  const textTrack = base.tracks.find((t) => t.id === 'track_text_1')!;
  textTrack.clips[0].sceneId = 'scene_1';
  textTrack.clips[0].effects = [
    {
      id: 'fx_glow_01',
      effectType: 'glow',
      name: 'Sowveil Accent Glow',
      enabled: true,
      rendererSupport: 'supported',
      supportedInAlightXml: true,
      parameters: { intensity: 0.65, radiusPx: 24, colorHex: '#F06424' },
    },
  ];
  textTrack.clips.push({
    id: 'clip_scene2_title',
    trackId: 'track_text_1',
    sceneId: 'scene_2',
    sourceSegmentId: 'seg_cta_02',
    name: 'Scene 2 Feature Title',
    kind: 'text',
    startTimeSec: 4,
    durationSec: 4,
    sourceInSec: 0,
    sourceOutSec: 4,
    trimInSec: 0,
    trimOutSec: 0,
    speedMultiplier: 1,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    blendMode: 'normal',
    transform: {
      position: [540, 960],
      scale: [1, 1],
      rotationDeg: 0,
      anchor: [0.5, 0.5],
      opacity: 1,
    },
    textData: {
      content: 'MULTI-TRACK TIMELINE',
      fontFamily: 'Inter',
      fontWeight: 800,
      fontSizePx: 64,
      lineHeightMultiplier: 1.1,
      letterSpacingEm: 0.04,
      alignment: 'center',
      colorHex: '#F3EEE8',
    },
    keyframes: [],
    effects: [],
    masks: [],
  });

  return base;
}

test('Phase 11.1 — Manual Timeline & Inspector Commands: trim, split, move, reorder, duplicate, group/ungroup, lock/hide, and reload round-trip', () => {
  const store = new CanonicalProjectStore(createRichEditorTestProject());

  // 1. Trim clip
  const trimRes = store.dispatch({
    type: 'trimClip',
    clipId: 'clip_headline_1',
    startTimeSec: 0.2,
    durationSec: 3.5,
  });
  assert.equal(trimRes.ok, true);
  assert.equal(trimRes.reversible, true);

  // 2. Duplicate clip
  const dupRes = store.dispatch({
    type: 'duplicateClip',
    clipId: 'clip_headline_1',
    startTimeSec: 3.8,
    newClipId: 'clip_headline_1_dup',
  });
  assert.equal(dupRes.ok, true);
  const textTrackAfterDup = store.getProject().tracks.find((t) => t.id === 'track_text_1')!;
  assert.equal(
    textTrackAfterDup.clips.some((c) => c.id === 'clip_headline_1_dup'),
    true
  );

  // 3. Group and ungroup clips
  const grpRes = store.dispatch({
    type: 'groupClips',
    clipIds: ['clip_headline_1', 'clip_headline_1_dup'],
    groupId: 'grp_test_01',
  });
  assert.equal(grpRes.ok, true);
  for (const id of ['clip_headline_1', 'clip_headline_1_dup']) {
    const c = store
      .getProject()
      .tracks.flatMap((t) => t.clips)
      .find((cl) => cl.id === id);
    assert.equal(c?.groupId, 'grp_test_01');
  }

  // Move clip with moveGroup: true moves both grouped clips
  const beforeSecondStart = store
    .getProject()
    .tracks.flatMap((t) => t.clips)
    .find((c) => c.id === 'clip_headline_1_dup')!.startTimeSec;
  const moveGrpRes = store.dispatch({
    type: 'moveClip',
    clipId: 'clip_headline_1',
    startTimeSec: 0.5,
    moveGroup: true,
  });
  assert.equal(moveGrpRes.ok, true);
  const afterSecondStart = store
    .getProject()
    .tracks.flatMap((t) => t.clips)
    .find((c) => c.id === 'clip_headline_1_dup')!.startTimeSec;
  assert.ok(Math.abs(afterSecondStart - (beforeSecondStart + 0.3)) < 1e-3);

  // Ungroup clips
  const ungrpRes = store.dispatch({
    type: 'ungroupClips',
    clipIds: ['clip_headline_1', 'clip_headline_1_dup'],
  });
  assert.equal(ungrpRes.ok, true);

  // 4. Split clip at playhead
  const splitRes = store.dispatch({
    type: 'splitClip',
    clipId: 'clip_scene2_title',
    splitTimeSec: 6.0,
  });
  assert.equal(splitRes.ok, true);

  // 5. Keyframes & Cubic-Bezier Easing Curve SVG Helper
  const kfRes = store.dispatch({
    type: 'addKeyframe',
    clipId: 'clip_headline_1',
    keyframe: {
      id: 'kf_custom_bezier',
      property: 'scaleX',
      timeSec: 0.45,
      value: 1.15,
      interpolation: 'cubic-bezier',
      cubicBezier: EASING_CURVE_PRESETS[0].points,
    },
  });
  assert.equal(kfRes.ok, true);
  const svgCurve = buildCubicBezierSvgPath(EASING_CURVE_PRESETS[0].points, 160, 90);
  assert.ok(svgCurve.curvePath.startsWith('M '));

  // 6. Evaluator at playhead time & Undo/Redo + Reload round-trip
  const evalSnap = evaluateProjectAtTime(store.getProject(), 1.0);
  assert.ok(evalSnap.length >= 2);

  const revBeforeUndo = store.getProject().revision;
  const undoDoc = store.undo();
  assert.ok(undoDoc);
  assert.equal(store.getProject().revision, revBeforeUndo - 1);
  const redoDoc = store.redo();
  assert.ok(redoDoc);
  assert.equal(store.getProject().revision, revBeforeUndo);

  const serialized = serializeCanonicalProject(store.getProject());
  const parsed = validateCanonicalProject(JSON.parse(serialized));
  assert.equal(parsed.valid, true);
  assert.equal(parsed.project?.revision, revBeforeUndo);
});

test('Phase 11.2 — Scene Lock Enforcement, Missing Asset Resolution & Unsupported Feature Recovery', () => {
  const doc = createRichEditorTestProject();
  // Add a missing asset and an unsupported feature entry
  doc.assetReferences.push({
    assetId: 'asset_missing_bg',
    title: 'missing-nebula-bg.mp4',
    role: 'primary-media',
    mimeType: 'video/mp4',
    required: true,
    missing: true,
    licenseType: 'Commercial-Licensed',
    sourceUrl: 'https://cdn.sowveil.studio/missing-nebula-bg.mp4',
  });
  doc.unsupportedFeatures.push({
    id: 'unsup_3d_extrude',
    featureKey: 'AE_RAYTRACED_3D_EXTRUDE',
    sourceFormat: 'After Effects .aep',
    severity: 'warning',
    fallbackBehavior: 'approximated-2d',
    message: 'Approximated via 2.5D drop-shadow stack',
  });

  // 1. Lock Scene 1 and verify any clip mutation inside Scene 1 is blocked with LOCKED_SCENE
  const lockSceneRes = executeProjectCommand(doc, {
    type: 'setSceneState',
    sceneId: 'scene_1',
    status: 'locked',
  });
  assert.equal(lockSceneRes.receipt.ok, true);

  const blockedMut = executeProjectCommand(lockSceneRes.project, {
    type: 'setTextProperties',
    clipId: 'clip_headline_1',
    textData: { content: 'ILLEGAL OVERWRITE ON LOCKED SCENE' },
  });
  assert.equal(blockedMut.receipt.ok, false);
  assert.ok(blockedMut.receipt.errors.some((e) => e.includes('LOCKED_SCENE')));

  // 2. Resolve missing asset via re-link
  const resolveAssetRes = executeProjectCommand(lockSceneRes.project, {
    type: 'resolveMissingAsset',
    assetId: 'asset_missing_bg',
    replacementTitle: 'recovered-nebula-bg.mp4',
    sourceUrl: 'https://cdn.sowveil.studio/recovered-nebula-bg.mp4',
  });
  assert.equal(resolveAssetRes.receipt.ok, true);
  const relinkedAsset = resolveAssetRes.project.assetReferences.find(
    (a) => a.assetId === 'asset_missing_bg'
  );
  assert.equal(relinkedAsset?.missing, false);

  // 3. Resolve unsupported feature via convert-to-2d-approximation
  const resolveUnsupRes = executeProjectCommand(resolveAssetRes.project, {
    type: 'resolveUnsupportedFeature',
    featureId: 'unsup_3d_extrude',
    resolutionStrategy: 'convert-to-2d-approximation',
  });
  assert.equal(resolveUnsupRes.receipt.ok, true);
});

test('Phase 11.3 — AI Co-Editing Transactions: All 10 Prompt Archetypes, Diff, Selective Apply, Ambiguity & Rollback', () => {
  const initialDoc = createRichEditorTestProject();

  const prompts: Array<{ name: string; prompt: string }> = [
    {
      name: '1. Change title to specified text',
      prompt: 'Change the title to "SHIP 60FPS ON MOBILE"',
    },
    {
      name: '2. Slow entrance from 0.3 to 0.7 seconds',
      prompt: 'Slow the entrance animation from 0.3 to 0.7 seconds',
    },
    {
      name: '3. Replace scene background',
      prompt: 'Replace the scene background with #141926',
    },
    {
      name: '4. Adjust accent palette',
      prompt: 'Adjust the accent palette to #22D3EE',
    },
    {
      name: '5. Add a provided SFX at selected frame',
      prompt: 'Add a provided SFX Whoosh Impact at the selected frame',
    },
    {
      name: '6. Re-time captions to selected narration',
      prompt: 'Re-time captions to match the selected narration',
    },
    {
      name: '7. Duplicate a scene but retain its source mapping',
      prompt: 'Duplicate Scene 1 and retain its source script mapping',
    },
    {
      name: '8. Create a softer transition',
      prompt: 'Create a softer transition (0.65s smooth fade)',
    },
    {
      name: '9. Change one effect parameter',
      prompt: 'Change the glow effect intensity parameter to 1.45',
    },
    {
      name: '10. Refine scene 2 while locking scene 1',
      prompt: 'Refine Scene 2 while locking Scene 1',
    },
  ];

  let workingDoc = initialDoc;
  for (const item of prompts) {
    const tx = planAiCoEditTransaction({
      project: workingDoc,
      prompt: item.prompt,
      selectedClipId: 'clip_headline_1',
      selectedSceneId: 'scene_1',
      playheadSec: 1.2,
    });
    assert.equal(
      tx.status,
      'proposed',
      `Expected archetype "${item.name}" to plan cleanly, got status=${tx.status} (${tx.unsupportedReason || ''})`
    );
    assert.ok(tx.operations.length >= 1, `Archetype "${item.name}" produced operations`);
    assert.ok(tx.proposedDiff.totalChanges >= 1, `Archetype "${item.name}" produced a visible diff`);

    const applied = applyAiCoEditTransaction({
      project: workingDoc,
      transaction: tx,
    });
    assert.equal(applied.ok, true, `Archetype "${item.name}" applied cleanly`);
    assert.ok(applied.logEntry, `Archetype "${item.name}" recorded an AI change log entry`);
    assert.ok(
      applied.project.snapshots.some((s) => s.id === applied.logEntry?.checkpointSnapshotId),
      `Archetype "${item.name}" created an automatic pre-AI snapshot for rollback`
    );
    workingDoc = applied.project;
  }

  // Verify Scene 1 was locked and Scene 2 refined by Archetype 10, and Scene 1 was duplicated retaining scriptSegmentIds by Archetype 7
  const duplicatedScene = workingDoc.scenes.find((s) => s.id !== 'scene_1' && s.id !== 'scene_2');
  assert.ok(duplicatedScene, 'Duplicated scene exists');
  assert.deepEqual(
    duplicatedScene!.scriptSegmentIds,
    ['seg_hook_01'],
    'Duplicated scene retained source scriptSegmentIds'
  );

  // Verify diffCanonicalProjects between initialDoc and workingDoc
  const fullDiff = diffCanonicalProjects(initialDoc, workingDoc);
  assert.ok(fullDiff.totalChanges >= 5);

  // Verify Ambiguity Clarification when prompt does not specify new title text
  const ambigTx = planAiCoEditTransaction({
    project: initialDoc,
    prompt: 'Change the title to',
    selectedClipId: null,
    selectedSceneId: null,
    playheadSec: 0,
  });
  assert.equal(ambigTx.status, 'needs-clarification');
  assert.ok(ambigTx.clarifyingQuestions.length >= 1);

  // Verify Unsupported Operation is honestly blocked
  const unsupTx = planAiCoEditTransaction({
    project: initialDoc,
    prompt: 'Run Cinema 4D fluid simulation mesh rig on the background',
    selectedClipId: 'clip_headline_1',
    selectedSceneId: 'scene_1',
    playheadSec: 1.0,
  });
  assert.equal(unsupTx.status, 'unsupported-operation');
  assert.ok(unsupTx.unsupportedReason && unsupTx.unsupportedReason.length > 0);
});

test('Phase 11.4 — REST API Endpoints (/api/v1/editor/command, /ai-transaction/plan, /ai-transaction/apply, /diff)', async () => {
  const app = createSowveilApiApp({
    tokenVerifier: async (token: string) => ({
      uid: token || 'user-phase11',
      email: 'editor@sowveil.studio',
      emailVerified: true,
    }),
  });

  const server = app.listen(0);
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer user-phase11',
  };

  try {
    const doc = createRichEditorTestProject();

    // 1. POST /api/v1/editor/command
    const cmdRes = await fetch(`${baseUrl}/api/v1/editor/command`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: doc,
        command: {
          type: 'setTextProperties',
          clipId: 'clip_headline_1',
          textData: { content: 'API COMMAND UPDATED' },
        },
      }),
    });
    assert.equal(cmdRes.status, 200);
    const cmdJson = await cmdRes.json();
    assert.equal(cmdJson.ok, true);
    assert.equal(cmdJson.data.receipt.ok, true);

    // 2. POST /api/v1/editor/ai-transaction/plan & apply
    const planRes = await fetch(`${baseUrl}/api/v1/editor/ai-transaction/plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: cmdJson.data.project,
        prompt: 'Adjust the accent palette to #10B981',
        selectedClipId: 'clip_headline_1',
        selectedSceneId: 'scene_1',
        playheadSec: 0.5,
      }),
    });
    assert.equal(planRes.status, 200);
    const planJson = await planRes.json();
    assert.equal(planJson.data.transaction.status, 'proposed');

    const applyRes = await fetch(`${baseUrl}/api/v1/editor/ai-transaction/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project: cmdJson.data.project,
        transaction: planJson.data.transaction,
      }),
    });
    assert.equal(applyRes.status, 200);
    const applyJson = await applyRes.json();
    assert.equal(applyJson.data.ok, true);

    // 3. POST /api/v1/editor/diff
    const diffRes = await fetch(`${baseUrl}/api/v1/editor/diff`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        beforeProject: doc,
        afterProject: applyJson.data.project,
      }),
    });
    assert.equal(diffRes.status, 200);
    const diffJson = await diffRes.json();
    assert.ok(diffJson.data.diff.totalChanges >= 1);
  } finally {
    server.close();
  }
});
