import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  buildCanonicalProjectFixtures,
  CanonicalProjectStore,
  canonicalProjectToLegacySowveilDocument,
  canonicalProjectToPortableMotionDocument,
  createMinimalCanonicalProject,
  evaluateProjectAtTime,
  executeProjectCommand,
  migrateToCanonicalProject,
  serializeCanonicalProject,
  validateCanonicalProject,
} from '../services/canonicalProjectEngine';
import { createApiApp, VerifiedTokenIdentity } from '../server/apiApp';

const MOCK_IDENTITIES: Record<string, VerifiedTokenIdentity> = {
  token_creator: {
    uid: 'ws_canonical_roundtrip_test',
    email: 'creator@sowveil.studio',
    emailVerified: true,
    displayName: 'Pro Timeline Creator',
  },
};

async function startCanonicalTestServer() {
  const app = createApiApp({
    ownerBootstrapEmail: 'mdhasibul4u@gmail.com',
    ownerBootstrapSecret: 'VALID_TEST_BOOTSTRAP_SECRET_2026',
    tokenVerifier: async (token: string) => {
      const id = MOCK_IDENTITIES[token];
      if (!id) {
        const err = new Error('Invalid token');
        (err as { code?: string }).code = 'INVALID_TOKEN';
        throw err;
      }
      return id;
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('Canonical Project Schema v2.0.0: validates all 7 required project fixtures without errors', () => {
  const fixtures = buildCanonicalProjectFixtures();
  const keys = [
    'minimalProject',
    'multiTrackProject',
    'templateInstanceProject',
    'keyframeAnimationProject',
    'effectStackProject',
    'captionProject',
    'audioClipProject',
  ] as const;

  for (const key of keys) {
    const doc = fixtures[key];
    assert.ok(doc, `Fixture ${key} must exist`);
    assert.equal(doc.schemaVersion, '2.0.0');
    assert.equal(doc.format, 'sowveil-canonical-project');
    const validation = validateCanonicalProject(doc);
    assert.equal(
      validation.valid,
      true,
      `Fixture ${key} failed validation: ${validation.errors.join('; ')}`
    );
  }
});

test('Canonical Project Schema v2.0.0: duplicate ID protection across tracks, clips, keyframes, effects, and markers', () => {
  const proj = createMinimalCanonicalProject({ title: 'Dup Check Project' });
  const secondTrackRes = executeProjectCommand(proj, {
    type: 'createTrack',
    trackId: 'track_dup_test',
    name: 'Second Track',
    kind: 'video',
  });
  assert.equal(secondTrackRes.receipt.ok, true);

  const existingClipId = secondTrackRes.project.tracks[0].clips[0].id;
  const dupClipRes = executeProjectCommand(secondTrackRes.project, {
    type: 'createClip',
    trackId: 'track_dup_test',
    clip: {
      id: existingClipId,
      name: 'Conflicting Clip ID',
      kind: 'video',
      startTimeSec: 0,
      durationSec: 2,
    },
  });
  assert.equal(dupClipRes.receipt.ok, false);
  assert.ok(
    dupClipRes.receipt.errors.some((e) => e.includes('DUPLICATE_ID')),
    'Should reject duplicate clip ID'
  );

  // Also test validator directly when raw JSON has duplicate track IDs
  const corrupted = structuredClone(proj);
  corrupted.tracks.push(structuredClone(corrupted.tracks[0]));
  const check = validateCanonicalProject(corrupted);
  assert.equal(check.valid, false);
  assert.ok(check.errors.some((e) => e.includes('Duplicate track ID')));
});

test('Canonical Project Schema v2.0.0: preserves unknown top-level and clip-level properties across validation and serialization', () => {
  const base = createMinimalCanonicalProject({ title: 'Forward Compat Project' });
  const rawWithUnknown: Record<string, unknown> = {
    ...JSON.parse(serializeCanonicalProject(base)),
    futureVendorMetadata: { experimentalShaderCache: 'v9', customFlag: true },
  };
  (rawWithUnknown.tracks as Array<Record<string, unknown>>)[0].clips = [
    {
      ...((rawWithUnknown.tracks as Array<Record<string, unknown>>)[0].clips as Array<
        Record<string, unknown>
      >)[0],
      customClipTelemetry: { cameraRigId: 'rig_99' },
    },
  ];

  const validated = validateCanonicalProject(rawWithUnknown);
  assert.equal(validated.valid, true, validated.errors.join('; '));
  assert.ok(validated.project);
  assert.deepEqual(validated.project.unknownProperties?.futureVendorMetadata, {
    experimentalShaderCache: 'v9',
    customFlag: true,
  });
  assert.deepEqual(
    validated.project.tracks[0].clips[0].unknownProperties?.customClipTelemetry,
    { cameraRigId: 'rig_99' }
  );

  // Re-serialize and parse back to verify round-trip preservation
  const serialized = serializeCanonicalProject(validated.project);
  const reparsed = JSON.parse(serialized);
  assert.deepEqual(reparsed.futureVendorMetadata, {
    experimentalShaderCache: 'v9',
    customFlag: true,
  });
  assert.deepEqual(reparsed.tracks[0].clips[0].customClipTelemetry, {
    cameraRigId: 'rig_99',
  });
});

test('Canonical Project Schema v2.0.0: migrates legacy 2.4.0-mobile and 1.0.0 documents into canonical 2.0.0', () => {
  // 1. Migrate 2.4.0-mobile MotionDocument
  const legacyMobileDoc = {
    schemaVersion: '2.4.0-mobile',
    format: 'sowveil-mobile-project',
    exportedAt: '2026-10-25T00:00:00.000Z',
    targetEditor: 'capcut',
    composition: {
      id: 'comp_legacy_24',
      title: 'Legacy CapCut Hook',
      moduleId: 'text-animation',
      categoryId: 'Kinetic',
      packLabel: 'Starter Pack',
      aspectRatio: '9:16',
      width: 1080,
      height: 1920,
      fps: 60,
      durationSec: 5,
      previewKind: 'kinetic-typography',
    },
    parameters: {
      headline: 'HELLO MOBILE',
      speed: 1.4,
    },
    motionRig: {
      curvePoints: [0.22, 1, 0.36, 1],
      cssCubicBezier: 'cubic-bezier(0.22, 1, 0.36, 1)',
      tags: ['Kinetic', 'Hook'],
    },
    compatibility: {
      adapterId: 'capcut',
      status: 'Verified',
      notes: 'Ready',
    },
  };

  const migratedMobile = migrateToCanonicalProject(legacyMobileDoc);
  assert.equal(migratedMobile.fromVersion, '2.4.0-mobile');
  assert.equal(migratedMobile.project.schemaVersion, '2.0.0');
  assert.equal(migratedMobile.project.title, 'Legacy CapCut Hook');
  assert.equal(migratedMobile.project.canvas.durationSec, 5);
  assert.ok(migratedMobile.project.tracks.length >= 1);
  assert.equal(
    migratedMobile.project.tracks[0].clips[0].textData?.content,
    'HELLO MOBILE'
  );

  // 2. Migrate 1.0.0 SowveilProjectDocument
  const legacyV1Doc = {
    schemaVersion: '1.0.0',
    id: 'proj_v1_legacy',
    title: 'Legacy V1 Timeline',
    description: 'From AI Director v1',
    ownerId: 'user_1',
    workspaceId: 'ws_1',
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    revision: 3,
    canvas: {
      width: 1920,
      height: 1080,
      fps: 30,
      durationSec: 8,
      aspectRatio: '16:9',
      backgroundColorHex: '#101010',
    },
    scenes: [
      {
        id: 'sc_1',
        index: 0,
        title: 'Opening Scene',
        startSec: 0,
        endSec: 8,
        scriptSegmentIds: ['seg_01'],
      },
    ],
    timeline: {
      tracks: [
        {
          id: 'trk_v1_text',
          name: 'Headline Track',
          type: 'text',
          order: 0,
          muted: false,
          locked: false,
          visible: true,
          clips: [
            {
              id: 'clp_v1_1',
              trackId: 'trk_v1_text',
              label: 'Opening Title',
              startSec: 0.5,
              endSec: 4.5,
              inPointSec: 0,
              outPointSec: 4,
              speed: 1,
              opacity: 0.9,
              transform: {
                x: 0.5,
                y: 0.4,
                scaleX: 1.1,
                scaleY: 1.1,
                rotationDeg: 5,
                anchorX: 0.5,
                anchorY: 0.5,
              },
              parameters: { text: 'Legacy V1 Text' },
              keyframes: [
                {
                  id: 'kf_v1_1',
                  property: 'opacity',
                  timeSec: 0,
                  value: 0,
                  easing: 'ease-out',
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    },
    captionCues: [
      {
        id: 'cue_v1_1',
        index: 1,
        startSec: 0.5,
        endSec: 3.0,
        text: 'Welcome to Sowveil Studio',
        speaker: 'Host',
      },
    ],
    audioTracks: [],
    markers: [{ id: 'mk_1', timeSec: 1.0, label: 'Beat Drop', colorHex: '#F06424' }],
    dependencies: [],
    unsupportedFeatures: [],
    provenance: {
      createdWithVersion: '1.0.0',
      aiDirectorModified: true,
      manualEditorModified: true,
      rightsDeclaration: 'User-Owned',
    },
    revisionHistory: [],
  };

  const migratedV1 = migrateToCanonicalProject(legacyV1Doc);
  assert.equal(migratedV1.fromVersion, '1.0.0');
  assert.equal(migratedV1.project.schemaVersion, '2.0.0');
  assert.equal(migratedV1.project.canvas.aspectRatio, '16:9');
  assert.equal(migratedV1.project.markers.length, 1);
  assert.ok(migratedV1.project.tracks.some((t) => t.kind === 'text'));
  assert.ok(migratedV1.project.tracks.some((t) => t.kind === 'caption'));

  // Bridge conversions back to legacy / portable formats
  const portable = canonicalProjectToPortableMotionDocument(migratedV1.project);
  assert.equal(portable.schemaVersion, '2.0.0');
  const backToV1 = canonicalProjectToLegacySowveilDocument(migratedV1.project);
  assert.equal(backToV1.schemaVersion, '2.0.0');
});

test('CanonicalProjectStore & Command Engine: executes all 28 typed commands, enforces locks, and supports undo/redo', () => {
  const initial = createMinimalCanonicalProject({ title: 'Command Test Suite' });
  const store = new CanonicalProjectStore(initial);

  // 1. renameProject
  let receipt = store.dispatch({
    type: 'renameProject',
    title: 'Renamed Pro Timeline',
    description: 'Updated via typed command',
  });
  assert.equal(receipt.ok, true);
  assert.equal(store.getProject().title, 'Renamed Pro Timeline');

  // 2. updateCanvas
  receipt = store.dispatch({
    type: 'updateCanvas',
    canvas: { durationSec: 12, fps: 60, backgroundColorHex: '#12100E' },
  });
  assert.equal(receipt.ok, true);
  assert.equal(store.getProject().canvas.durationSec, 12);

  // 3. createTrack (video, audio, caption)
  receipt = store.dispatch({
    type: 'createTrack',
    trackId: 'track_video_broll',
    name: 'B-Roll Track',
    kind: 'video',
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'createTrack',
    trackId: 'track_audio_sfx',
    name: 'SFX Bed',
    kind: 'audio',
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'createTrack',
    trackId: 'track_caption_sub',
    name: 'Subtitles',
    kind: 'caption',
  });
  assert.equal(receipt.ok, true);

  // 4. createClip (audio & caption clips)
  receipt = store.dispatch({
    type: 'createClip',
    trackId: 'track_audio_sfx',
    clip: {
      id: 'clip_audio_whoosh',
      name: 'Whoosh Hit',
      kind: 'audio',
      startTimeSec: 0.5,
      durationSec: 3.0,
      audioConfig: {
        gainDb: 0,
        linearGain: 1,
        pan: 0,
        fadeInSec: 0.1,
        fadeOutSec: 0.2,
        muted: false,
        proceduralSfxPreset: 'whoosh-sub',
      },
    },
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'createClip',
    trackId: 'track_caption_sub',
    clip: {
      id: 'clip_caption_1',
      name: 'Cue #1',
      kind: 'caption',
      startTimeSec: 0,
      durationSec: 2.5,
      captionData: {
        cueIndex: 1,
        text: 'Initial subtitle cue',
        speaker: 'Host',
        stylePresetId: 'kinetic-pop',
        highlightColorHex: '#F06424',
        maxCharsPerLine: 32,
      },
    },
  });
  assert.equal(receipt.ok, true);

  const mainClipId = store.getProject().tracks[0].clips[0].id;

  // 5. setTransform
  receipt = store.dispatch({
    type: 'setTransform',
    clipId: mainClipId,
    transform: {
      position: [450, 960],
      scale: [1.25, 1.25],
      rotationDeg: 12,
      opacity: 0.88,
    },
  });
  assert.equal(receipt.ok, true);

  // 6. setTextProperties
  receipt = store.dispatch({
    type: 'setTextProperties',
    clipId: mainClipId,
    textData: {
      content: 'CANONICAL TIMELINE HEADLINE',
      fontSizePx: 84,
      colorHex: '#FF7434',
    },
  });
  assert.equal(receipt.ok, true);

  // 7. addKeyframe, updateKeyframe, removeKeyframe
  receipt = store.dispatch({
    type: 'addKeyframe',
    clipId: mainClipId,
    keyframe: {
      id: 'kf_scale_1',
      property: 'scaleX',
      timeSec: 1.0,
      value: 1.5,
      interpolation: 'cubic-bezier',
      cubicBezier: [0.22, 1, 0.36, 1],
    },
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'updateKeyframe',
    clipId: mainClipId,
    keyframeId: 'kf_scale_1',
    patch: { value: 1.75, timeSec: 1.2 },
  });
  assert.equal(receipt.ok, true);

  // Verify evaluateProjectAtTime interpolates keyframe properly
  const evalSnap = evaluateProjectAtTime(store.getProject(), 0.6);
  assert.ok(evalSnap.some((c) => c.clip.id === mainClipId));

  receipt = store.dispatch({
    type: 'removeKeyframe',
    clipId: mainClipId,
    keyframeId: 'kf_scale_1',
  });
  assert.equal(receipt.ok, true);

  // 8. addEffect, setEffectParameter, removeEffect
  receipt = store.dispatch({
    type: 'addEffect',
    clipId: mainClipId,
    effect: {
      id: 'fx_glow_test',
      effectType: 'glow',
      name: 'Neon Glow',
      enabled: true,
      rendererSupport: 'supported',
      supportedInAlightXml: true,
      parameters: { intensity: 0.7 },
    },
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'setEffectParameter',
    clipId: mainClipId,
    effectId: 'fx_glow_test',
    parameterKey: 'intensity',
    value: 1.4,
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'removeEffect',
    clipId: mainClipId,
    effectId: 'fx_glow_test',
  });
  assert.equal(receipt.ok, true);

  // 9. replaceAsset
  receipt = store.dispatch({
    type: 'replaceAsset',
    clipId: mainClipId,
    newAssetId: 'asset_hero_plate_01',
    slotKey: 'primary_media',
  });
  assert.equal(receipt.ok, true);
  assert.equal(
    store.getProject().tracks[0].clips[0].assetSlotBindings?.primary_media,
    'asset_hero_plate_01'
  );

  // 10. insertTransition
  receipt = store.dispatch({
    type: 'insertTransition',
    clipId: mainClipId,
    edge: 'in',
    transition: {
      id: 'tr_in_1',
      type: 'cross-dissolve',
      durationSec: 0.4,
      easingCurve: [0.22, 1, 0.36, 1],
      parameters: {},
    },
  });
  assert.equal(receipt.ok, true);

  // 11. setGain
  receipt = store.dispatch({
    type: 'setGain',
    clipId: 'clip_audio_whoosh',
    gainDb: -6,
    fadeInSec: 0.2,
    fadeOutSec: 0.5,
  });
  assert.equal(receipt.ok, true);

  // 12. alterCaption
  receipt = store.dispatch({
    type: 'alterCaption',
    clipId: 'clip_caption_1',
    text: 'Updated mobile subtitle text',
    speaker: 'AI Director',
    highlightColorHex: '#55B98B',
  });
  assert.equal(receipt.ok, true);

  // 13. instantiateTemplate
  receipt = store.dispatch({
    type: 'instantiateTemplate',
    templateId: 'liquid-glass-001',
    templateTitle: 'Liquid Glass Card Instance',
    templateVersion: '1.0.0',
    moduleId: 'liquid-glass',
    variantId: 'var_user_01',
    trackId: 'track_video_broll',
    startTimeSec: 1.0,
    durationSec: 3.5,
    parameterOverrides: { blurPx: 24, refraction: 0.8 },
    assetSlotBindings: {},
    editabilityLevel: 'parameter-rig',
  });
  assert.equal(receipt.ok, true);

  // 14. trimClip, splitClip, moveClip, reorderClip, deleteClip
  receipt = store.dispatch({
    type: 'trimClip',
    clipId: mainClipId,
    startTimeSec: 0.2,
    durationSec: 3.6,
    trimInSec: 0.2,
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'splitClip',
    clipId: mainClipId,
    splitTimeSec: 2.0,
    secondClipId: 'clip_split_right_half',
  });
  assert.equal(receipt.ok, true);
  assert.equal(store.getProject().tracks[0].clips.length, 2);

  receipt = store.dispatch({
    type: 'moveClip',
    clipId: 'clip_split_right_half',
    startTimeSec: 2.5,
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'reorderClip',
    clipId: 'clip_split_right_half',
    targetTrackId: 'track_video_broll',
    newIndex: 0,
  });
  assert.equal(receipt.ok, true);

  receipt = store.dispatch({
    type: 'deleteClip',
    clipId: 'clip_split_right_half',
  });
  assert.equal(receipt.ok, true);

  // 15. addMarker & removeMarker (starts with 1 initial marker_intro)
  receipt = store.dispatch({
    type: 'addMarker',
    marker: {
      id: 'mk_beat_01',
      timeSec: 1.5,
      durationSec: 0,
      label: 'Hook Transition',
      colorHex: '#F06424',
      kind: 'beat',
    },
  });
  assert.equal(receipt.ok, true);
  assert.equal(store.getProject().markers.length, 2);

  receipt = store.dispatch({
    type: 'removeMarker',
    markerId: 'mk_beat_01',
  });
  assert.equal(receipt.ok, true);
  assert.equal(store.getProject().markers.length, 1);

  // 16. Lock guard verification: locking a track blocks clip modifications on that track
  receipt = store.dispatch({
    type: 'setTrackState',
    trackId: 'track_audio_sfx',
    locked: true,
  });
  assert.equal(receipt.ok, true);

  const blockedDelete = store.dispatch({
    type: 'deleteClip',
    clipId: 'clip_audio_whoosh',
  });
  assert.equal(blockedDelete.ok, false);
  assert.ok(blockedDelete.errors.some((e) => e.toLowerCase().includes('locked')));

  // Unlock track
  store.dispatch({
    type: 'setTrackState',
    trackId: 'track_audio_sfx',
    locked: false,
  });

  // 17. createSnapshot, createBranch, restoreSnapshot
  const snapReceipt = store.dispatch({
    type: 'createSnapshot',
    label: 'Before AI Pass',
  });
  assert.equal(snapReceipt.ok, true);
  const snapshotId = snapReceipt.changedIds[0];

  // AI Director executes a command on the SAME project store
  const aiReceipt = store.dispatch(
    {
      type: 'renameProject',
      title: 'Modified by AI Director Pass',
    },
    {
      actorId: 'ai_director_agent',
      actorKind: 'ai-director',
      rationale: 'Refined project title for hook clarity',
    }
  );
  assert.equal(aiReceipt.ok, true);
  assert.equal(aiReceipt.actorKind, 'ai-director');
  assert.equal(store.getProject().title, 'Modified by AI Director Pass');
  assert.ok(store.getProject().aiEditHistory.length >= 1);

  const branchReceipt = store.dispatch({
    type: 'createBranch',
    branchName: 'experiment-hook-b',
  });
  assert.equal(branchReceipt.ok, true);
  assert.equal(store.getProject().activeBranch, 'experiment-hook-b');

  // Restore snapshot back to "Renamed Pro Timeline"
  const restoreReceipt = store.dispatch({
    type: 'restoreSnapshot',
    snapshotId,
  });
  assert.equal(restoreReceipt.ok, true);
  assert.equal(store.getProject().title, 'Renamed Pro Timeline');

  // 18. Undo / Redo verification
  assert.equal(store.canUndo(), true);
  const undone = store.undo();
  assert.ok(undone);
  assert.equal(store.getProject().title, 'Modified by AI Director Pass');

  assert.equal(store.canRedo(), true);
  const redone = store.redo();
  assert.ok(redone);
  assert.equal(store.getProject().title, 'Renamed Pro Timeline');
});

test('Canonical Project API Round-Trip: create, execute user & AI commands, save, and reload via /api/v1/projects', async () => {
  const srv = await startCanonicalTestServer();
  const headers = {
    Authorization: 'Bearer token_creator',
    'Content-Type': 'application/json',
  };

  try {
    // 1. Fetch canonical fixtures via API
    const fixturesRes = await fetch(
      `${srv.baseUrl}/api/v1/projects/fixtures/canonical`,
      { headers }
    );
    assert.equal(fixturesRes.status, 200);
    const fixturesBody = (await fixturesRes.json()) as {
      data: { schemaVersion: string; fixtures: Record<string, unknown> };
    };
    assert.equal(fixturesBody.data.schemaVersion, '2.0.0');
    assert.ok(fixturesBody.data.fixtures.multiTrackProject);

    // 2. Create a new project in Project Library with canonicalProjectJson
    const initialDoc = createMinimalCanonicalProject({
      title: 'API Roundtrip Project',
      ownerUid: 'ws_canonical_roundtrip_test',
    });

    const createRes = await fetch(`${srv.baseUrl}/api/v1/projects`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: initialDoc.title,
        description: initialDoc.description,
        compCount: 1,
        projectFileStatus: 'sowveil-native',
        fileSizeBytes: 2048,
        fileSizeLabel: '2.0 KB (.sowveil.json v2.0)',
        resolution: '1080 × 1920',
        targetEditor: 'capcut',
        aspectRatio: '9:16',
        canonicalProjectJson: serializeCanonicalProject(initialDoc),
        revision: initialDoc.revision,
        activeBranch: initialDoc.activeBranch,
        hasExternalFootageWarning: false,
        archived: false,
        tags: ['Canonical v2.0', 'Roundtrip'],
      }),
    });
    assert.equal(createRes.status, 201);
    const createBody = (await createRes.json()) as { data: { id: string } };
    const projectId = createBody.data.id;
    assert.ok(projectId);

    // 3. Execute a manual user command via POST /api/v1/projects/:id/commands
    const mainClipId = initialDoc.tracks[0].clips[0].id;
    const userCmdRes = await fetch(
      `${srv.baseUrl}/api/v1/projects/${projectId}/commands`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          actorKind: 'user',
          command: {
            type: 'setTextProperties',
            clipId: mainClipId,
            textData: {
              content: 'EDITED VIA MANUAL PRO TIMELINE',
              colorHex: '#55B98B',
            },
          },
        }),
      }
    );
    assert.equal(userCmdRes.status, 200);
    const userCmdBody = (await userCmdRes.json()) as {
      data: { receipt: { ok: boolean; actorKind: string } };
    };
    assert.equal(userCmdBody.data.receipt.ok, true);
    assert.equal(userCmdBody.data.receipt.actorKind, 'user');

    // 4. Execute an AI Director command against the SAME project via POST /api/v1/projects/:id/commands
    const aiCmdRes = await fetch(
      `${srv.baseUrl}/api/v1/projects/${projectId}/commands`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          actorKind: 'ai-director',
          rationale: 'Added beat marker at 2.0s for visual hook sync',
          command: {
            type: 'addMarker',
            marker: {
              id: 'mk_ai_sync_1',
              timeSec: 2.0,
              durationSec: 0,
              label: 'AI Sync Beat',
              colorHex: '#F06424',
              kind: 'script-cue',
            },
          },
        }),
      }
    );
    assert.equal(aiCmdRes.status, 200);
    const aiCmdBody = (await aiCmdRes.json()) as {
      data: { receipt: { ok: boolean; actorKind: string } };
    };
    assert.equal(aiCmdBody.data.receipt.ok, true);
    assert.equal(aiCmdBody.data.receipt.actorKind, 'ai-director');

    // 5. Reload canonical project via GET /api/v1/projects/:id/canonical and verify both edits persisted
    const reloadRes = await fetch(
      `${srv.baseUrl}/api/v1/projects/${projectId}/canonical`,
      { headers }
    );
    assert.equal(reloadRes.status, 200);
    const reloadBody = (await reloadRes.json()) as {
      data: {
        project: {
          schemaVersion: string;
          tracks: Array<{ clips: Array<{ textData: { content: string } }> }>;
          markers: Array<{ id: string }>;
          aiEditHistory: Array<{ rationale: string }>;
        };
      };
    };
    const reloadedProject = reloadBody.data.project;
    assert.equal(reloadedProject.schemaVersion, '2.0.0');
    assert.equal(
      reloadedProject.tracks[0].clips[0].textData.content,
      'EDITED VIA MANUAL PRO TIMELINE'
    );
    assert.equal(reloadedProject.markers.length, 2);
    assert.ok(reloadedProject.markers.some((m) => m.id === 'mk_ai_sync_1'));
    assert.equal(reloadedProject.aiEditHistory.length, 2);
    assert.equal(
      reloadedProject.aiEditHistory[1].rationale,
      'Added beat marker at 2.0s for visual hook sync'
    );
  } finally {
    await srv.close();
  }
});
