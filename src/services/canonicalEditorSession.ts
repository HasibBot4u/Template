import { useEffect, useState } from 'react';
import {
  CanonicalClip,
  CanonicalKeyframe,
  CanonicalKeyframeInterpolation,
  CanonicalProjectCommand,
  CanonicalProjectDocument,
  CanonicalTrack,
  ProjectCommandReceipt,
} from '../types/canonicalProject';
import {
  MobileAspectRatio,
  ProjectLibraryItem,
  TargetMobileEditorId,
} from '../types/sowveil';
import {
  CanonicalProjectStore,
  canonicalProjectToLibraryRecord,
  createMinimalCanonicalProject,
  evaluateProjectAtTime,
  migrateToCanonicalProject,
  validateCanonicalProject,
} from './canonicalProjectEngine';
import { getDimensionsForAspectRatio } from './editorGateway';
import { EASING_CURVE_PRESETS } from './coEditingEngine';

export type CanonicalSaveState =
  | 'Saved'
  | 'Saving'
  | 'Offline Draft'
  | 'Unsaved Changes'
  | 'Conflict'
  | 'Failed';

export type CanonicalEditorMode = 'chooser' | 'active-project' | 'demo';

export type AnimatablePropertyKey =
  | 'positionX'
  | 'positionY'
  | 'scaleX'
  | 'scaleY'
  | 'rotationDeg'
  | 'opacity'
  | 'audioGainDb';

export interface CanonicalEditorSessionState {
  ownerUid: string;
  mode: CanonicalEditorMode;
  isDemoMode: boolean;
  project: CanonicalProjectDocument | null;
  saveState: CanonicalSaveState;
  lastSavedRevision: number | null;
  lastSavedAt: string | null;
  saveError: string | null;
  conflictServerRevision: number | null;
  isLoadingProject: boolean;
  loadError: string | null;
  // Shared Selection State across Landscape & Standard Editor
  selectedClipId: string | null;
  multiSelectedClipIds: string[];
  selectedTrackId: string | null;
  selectedSceneId: string | null;
  selectedKeyframeId: string | null;
  selectedProperty: AnimatablePropertyKey;
  // Shared Transport & Timeline State across Landscape & Standard Editor
  playheadSec: number;
  isPlaying: boolean;
  loopEnabled: boolean;
  snapEnabled: boolean;
  timelineZoomPxPerSec: number;
  // Shared Undo/Redo & Command Receipts
  canUndo: boolean;
  canRedo: boolean;
  lastReceipt: ProjectCommandReceipt | null;
  receiptHistory: ProjectCommandReceipt[];
}

export function createSevenTrackDemoCanonicalProject(
  ownerUid = 'user-local',
  overrideId?: string,
  title = 'Sowveil Mobile Launch Ad (Demo)',
  aspectRatio: MobileAspectRatio = '9:16'
): CanonicalProjectDocument {
  const base = createMinimalCanonicalProject({
    id: overrideId || `proj_demo_7track_${ownerUid}`,
    ownerUid,
    title,
    description:
      'Explicit 7-track multi-layer sample project for testing Landscape & Standard Studio.',
    targetEditor: 'sowveil-project',
    aspectRatio,
    durationSec: 8,
  });

  const dims = getDimensionsForAspectRatio(aspectRatio);

  const tracks: CanonicalTrack[] = [
    {
      id: 'track_video_1',
      name: 'Video (V1)',
      kind: 'video',
      order: 0,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_bg_footage',
          trackId: 'track_video_1',
          name: 'Cyberpunk Grid Gradient',
          kind: 'video',
          sceneId: 'scene_1',
          startTimeSec: 0,
          durationSec: 8,
          sourceInSec: 0,
          sourceOutSec: 8,
          trimInSec: 0,
          trimOutSec: 8,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          assetId: 'asset_demo_grid_bg',
          transform: {
            position: [dims.width / 2, dims.height / 2],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [
            {
              id: 'kf_demo_v1_op_0',
              property: 'opacity',
              timeSec: 0,
              value: 0.85,
              interpolation: 'ease-out',
              easingPresetId: 'ease-out-cubic',
              cubicBezier: [0.33, 1, 0.68, 1],
            },
            {
              id: 'kf_demo_v1_op_1',
              property: 'opacity',
              timeSec: 1.2,
              value: 1,
              interpolation: 'ease-out',
              easingPresetId: 'ease-out-cubic',
              cubicBezier: [0.33, 1, 0.68, 1],
            },
          ],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_text_1',
      name: 'Text & Titles (T1)',
      kind: 'text',
      order: 1,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_title_main',
          trackId: 'track_text_1',
          name: 'LAUNCH ON ANDROID',
          kind: 'text',
          sceneId: 'scene_1',
          startTimeSec: 0.5,
          durationSec: 3.5,
          sourceInSec: 0,
          sourceOutSec: 3.5,
          trimInSec: 0,
          trimOutSec: 3.5,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [dims.width / 2, dims.height * 0.45],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          textData: {
            content: 'LAUNCH ON ANDROID',
            fontFamily: 'Plus Jakarta Sans',
            fontSizePx: 48,
            fontWeight: 700,
            colorHex: '#F3EEE8',
            alignment: 'center',
            letterSpacingEm: 0.05,
            lineHeightMultiplier: 1.2,
          },
          keyframes: [
            {
              id: 'kf_demo_txt_scale_0',
              property: 'scaleX',
              timeSec: 0.5,
              value: 0.9,
              interpolation: 'cubic-bezier',
              easingPresetId: 'ease-out-expo',
              cubicBezier: [0.16, 1, 0.3, 1],
            },
            {
              id: 'kf_demo_txt_scale_1',
              property: 'scaleX',
              timeSec: 1.2,
              value: 1,
              interpolation: 'cubic-bezier',
              easingPresetId: 'ease-out-expo',
              cubicBezier: [0.16, 1, 0.3, 1],
            },
          ],
          effects: [],
          masks: [],
        },
        {
          id: 'clip_subtitle',
          trackId: 'track_text_1',
          name: 'Mobile Creative Studio',
          kind: 'text',
          sceneId: 'scene_1',
          startTimeSec: 4.2,
          durationSec: 3.5,
          sourceInSec: 0,
          sourceOutSec: 3.5,
          trimInSec: 0,
          trimOutSec: 3.5,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [dims.width / 2, dims.height * 0.5],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          textData: {
            content: 'Mobile Creative Studio',
            fontFamily: 'Plus Jakarta Sans',
            fontSizePx: 36,
            fontWeight: 600,
            colorHex: '#55B98B',
            alignment: 'center',
            letterSpacingEm: 0.02,
            lineHeightMultiplier: 1.2,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_motion_1',
      name: 'Motion Graphics (M1)',
      kind: 'template',
      order: 2,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_badge_card',
          trackId: 'track_motion_1',
          name: 'Card 01 Glass Badge',
          kind: 'template-instance',
          sceneId: 'scene_1',
          startTimeSec: 1,
          durationSec: 3,
          sourceInSec: 0,
          sourceOutSec: 3,
          trimInSec: 0,
          trimOutSec: 3,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [dims.width / 2, dims.height * 0.72],
            scale: [0.85, 0.85],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_overlay_1',
      name: 'Overlays & FX (O1)',
      kind: 'effect',
      order: 3,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'screen',
      gainDb: 0,
      clips: [
        {
          id: 'clip_light_leak',
          trackId: 'track_overlay_1',
          name: 'Warm Light Leak & Dust',
          kind: 'adjustment-effect',
          sceneId: 'scene_1',
          startTimeSec: 0,
          durationSec: 8,
          sourceInSec: 0,
          sourceOutSec: 8,
          trimInSec: 0,
          trimOutSec: 8,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'screen',
          transform: {
            position: [dims.width / 2, dims.height / 2],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 0.65,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_voice_1',
      name: 'Voice / Narration (A1)',
      kind: 'audio',
      order: 4,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_vo_take_1',
          trackId: 'track_voice_1',
          name: 'AI Voiceover: "Ready to launch..."',
          kind: 'audio',
          sceneId: 'scene_1',
          startTimeSec: 0.2,
          durationSec: 4.8,
          sourceInSec: 0,
          sourceOutSec: 4.8,
          trimInSec: 0,
          trimOutSec: 4.8,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          assetId: 'asset_demo_vo_track',
          transform: {
            position: [0, 0],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_music_1',
      name: 'Music / BGM (A2)',
      kind: 'audio',
      order: 5,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: -6,
      clips: [
        {
          id: 'clip_bgm_track',
          trackId: 'track_music_1',
          name: 'Neon Horizon (Lo-Fi Wave)',
          kind: 'audio',
          sceneId: 'scene_1',
          startTimeSec: 0,
          durationSec: 8,
          sourceInSec: 0,
          sourceOutSec: 8,
          trimInSec: 0,
          trimOutSec: 8,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          assetId: 'asset_demo_bgm_pulse',
          transform: {
            position: [0, 0],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_sfx_1',
      name: 'SFX / Foley (A3)',
      kind: 'audio',
      order: 6,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_sfx_whoosh',
          trackId: 'track_sfx_1',
          name: 'Whoosh Hit 01',
          kind: 'audio',
          sceneId: 'scene_1',
          startTimeSec: 0.45,
          durationSec: 1.2,
          sourceInSec: 0,
          sourceOutSec: 1.2,
          trimInSec: 0,
          trimOutSec: 1.2,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          assetId: 'asset_demo_sfx_whoosh',
          transform: {
            position: [0, 0],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
  ];

  return {
    ...base,
    title,
    canvas: {
      ...base.canvas,
      aspectRatio,
      width: dims.width,
      height: dims.height,
      durationSec: 8,
    },
    tracks,
    assetReferences: [
      {
        assetId: 'asset_demo_grid_bg',
        title: 'Cyberpunk Grid Gradient.mp4',
        role: 'primary-media',
        mimeType: 'video/mp4',
        required: true,
        missing: false,
        licenseType: 'Royalty-Free Commercial',
        attribution: 'Sowveil Built-in Demo',
      },
      {
        assetId: 'asset_demo_vo_track',
        title: 'AI Voiceover Master.wav',
        role: 'audio-sfx',
        mimeType: 'audio/wav',
        required: false,
        missing: false,
        licenseType: 'Royalty-Free Commercial',
        attribution: 'Sowveil Built-in Demo',
      },
      {
        assetId: 'asset_demo_bgm_pulse',
        title: 'Neon Horizon BGM.wav',
        role: 'audio-sfx',
        mimeType: 'audio/wav',
        required: false,
        missing: false,
        licenseType: 'Royalty-Free Commercial',
        attribution: 'Sowveil Built-in Demo',
      },
      {
        assetId: 'asset_demo_sfx_whoosh',
        title: 'Whoosh Hit SFX.wav',
        role: 'audio-sfx',
        mimeType: 'audio/wav',
        required: false,
        missing: false,
        licenseType: 'Royalty-Free Commercial',
        attribution: 'Sowveil Built-in Demo',
      },
    ],
  };
}

export function createNewUserCanonicalProject(options: {
  id?: string;
  ownerUid: string;
  title: string;
  description?: string;
  aspectRatio?: MobileAspectRatio;
  targetEditor?: TargetMobileEditorId;
  durationSec?: number;
}): CanonicalProjectDocument {
  const ratio = options.aspectRatio || '16:9';
  const dims = getDimensionsForAspectRatio(ratio);
  const doc = createMinimalCanonicalProject({
    id: options.id || `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    ownerUid: options.ownerUid,
    title: options.title.trim() || 'Untitled Sowveil Project',
    description:
      options.description?.trim() ||
      'Canonical multi-track project created in Sowveil Creative Studio.',
    targetEditor: options.targetEditor || 'sowveil-project',
    aspectRatio: ratio,
    durationSec: options.durationSec || 8,
  });

  doc.tracks = [
    {
      id: 'track_video_1',
      name: 'Video (V1)',
      kind: 'video',
      order: 0,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [],
    },
    {
      id: 'track_text_1',
      name: 'Text & Titles (T1)',
      kind: 'text',
      order: 1,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [
        {
          id: 'clip_title_starter',
          trackId: 'track_text_1',
          name: options.title.trim() || 'Headline Title',
          kind: 'text',
          sceneId: 'scene_1',
          startTimeSec: 0.5,
          durationSec: 4.0,
          sourceInSec: 0,
          sourceOutSec: 4.0,
          trimInSec: 0,
          trimOutSec: 4.0,
          speedMultiplier: 1,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          transform: {
            position: [dims.width / 2, dims.height / 2],
            scale: [1, 1],
            rotationDeg: 0,
            anchor: [0.5, 0.5],
            opacity: 1,
          },
          textData: {
            content: options.title.trim() || 'Headline Title',
            fontFamily: 'Plus Jakarta Sans',
            fontWeight: 700,
            fontSizePx: 54,
            colorHex: '#F3EEE8',
            letterSpacingEm: 0.02,
            lineHeightMultiplier: 1.15,
            alignment: 'center',
          },
          keyframes: [],
          effects: [],
          masks: [],
        },
      ],
    },
    {
      id: 'track_motion_1',
      name: 'Motion Graphics (M1)',
      kind: 'template',
      order: 2,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [],
    },
    {
      id: 'track_overlay_1',
      name: 'Overlays & FX (O1)',
      kind: 'effect',
      order: 3,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'screen',
      gainDb: 0,
      clips: [],
    },
    {
      id: 'track_voice_1',
      name: 'Voice / Narration (A1)',
      kind: 'audio',
      order: 4,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [],
    },
    {
      id: 'track_music_1',
      name: 'Music / BGM (A2)',
      kind: 'audio',
      order: 5,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: -6,
      clips: [],
    },
    {
      id: 'track_sfx_1',
      name: 'SFX / Foley (A3)',
      kind: 'audio',
      order: 6,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      gainDb: 0,
      clips: [],
    },
  ];

  doc.assetReferences = [];
  return doc;
}

export class CanonicalEditorSessionManager {
  private store: CanonicalProjectStore | null = null;
  private state: CanonicalEditorSessionState;
  private listeners = new Set<(state: CanonicalEditorSessionState) => void>();

  constructor(initialOwnerUid = 'user-local') {
    this.state = {
      ownerUid: initialOwnerUid,
      mode: 'chooser',
      isDemoMode: false,
      project: null,
      saveState: 'Saved',
      lastSavedRevision: null,
      lastSavedAt: null,
      saveError: null,
      conflictServerRevision: null,
      isLoadingProject: false,
      loadError: null,
      selectedClipId: null,
      multiSelectedClipIds: [],
      selectedTrackId: null,
      selectedSceneId: null,
      selectedKeyframeId: null,
      selectedProperty: 'opacity',
      playheadSec: 0,
      isPlaying: false,
      loopEnabled: true,
      snapEnabled: true,
      timelineZoomPxPerSec: 64,
      canUndo: false,
      canRedo: false,
      lastReceipt: null,
      receiptHistory: [],
    };
  }

  getState(): CanonicalEditorSessionState {
    return this.state;
  }

  getStore(): CanonicalProjectStore | null {
    return this.store;
  }

  subscribe(listener: (state: CanonicalEditorSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(partial?: Partial<CanonicalEditorSessionState>): void {
    if (partial) {
      this.state = {
        ...this.state,
        ...partial,
      };
    }
    if (this.store) {
      const currentDoc = this.store.getProject();
      this.state = {
        ...this.state,
        project: currentDoc,
        canUndo: this.store.canUndo(),
        canRedo: this.store.canRedo(),
      };
    }
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private pickDefaultSelection(doc: CanonicalProjectDocument): {
    selectedSceneId: string | null;
    selectedTrackId: string | null;
    selectedClipId: string | null;
    selectedKeyframeId: string | null;
  } {
    const sceneId = doc.scenes[0]?.id || null;
    for (const trk of doc.tracks) {
      for (const clip of trk.clips) {
        if (clip.id === this.state.selectedClipId) {
          const kfStillExists = clip.keyframes.some(
            (kf) => kf.id === this.state.selectedKeyframeId
          );
          return {
            selectedSceneId: sceneId,
            selectedTrackId: trk.id,
            selectedClipId: clip.id,
            selectedKeyframeId: kfStillExists
              ? this.state.selectedKeyframeId
              : clip.keyframes[0]?.id || null,
          };
        }
      }
    }
    const firstTrackWithClip =
      doc.tracks.find((t) => t.clips.length > 0) || doc.tracks[0];
    const firstClip = firstTrackWithClip?.clips[0] || null;
    return {
      selectedSceneId: sceneId,
      selectedTrackId: firstTrackWithClip?.id || null,
      selectedClipId: firstClip?.id || null,
      selectedKeyframeId: firstClip?.keyframes[0]?.id || null,
    };
  }

  openProjectDocument(
    doc: CanonicalProjectDocument,
    options?: {
      isDemoMode?: boolean;
      savedRevision?: number | null;
      saveState?: CanonicalSaveState;
      forceReplace?: boolean;
    }
  ): CanonicalProjectDocument {
    const check = validateCanonicalProject(doc);
    const validDoc =
      check.valid && check.project
        ? check.project
        : migrateToCanonicalProject(doc, doc.ownerUid || this.state.ownerUid).project;

    // Preserve active in-memory session if same project ID and higher/equal revision
    if (
      !options?.forceReplace &&
      this.store &&
      this.state.project &&
      this.state.project.id === validDoc.id &&
      this.state.project.revision >= validDoc.revision &&
      this.state.mode !== 'chooser'
    ) {
      return this.state.project;
    }

    this.store = new CanonicalProjectStore(validDoc);
    const isDemo = Boolean(options?.isDemoMode);
    const savedRevision =
      options?.savedRevision !== undefined
        ? options.savedRevision
        : isDemo
        ? null
        : validDoc.revision;
    const selection = this.pickDefaultSelection(validDoc);

    this.emit({
      ownerUid: validDoc.ownerUid || this.state.ownerUid,
      mode: isDemo ? 'demo' : 'active-project',
      isDemoMode: isDemo,
      project: validDoc,
      saveState:
        options?.saveState ||
        (isDemo
          ? 'Unsaved Changes'
          : savedRevision === validDoc.revision
          ? 'Saved'
          : 'Unsaved Changes'),
      lastSavedRevision: savedRevision,
      lastSavedAt: savedRevision ? validDoc.updatedAt : null,
      saveError: null,
      conflictServerRevision: null,
      isLoadingProject: false,
      loadError: null,
      ...selection,
      multiSelectedClipIds: selection.selectedClipId ? [selection.selectedClipId] : [],
      playheadSec: Math.min(
        this.state.playheadSec,
        validDoc.canvas.durationSec || 8
      ),
      lastReceipt: null,
      receiptHistory: [],
    });
    return validDoc;
  }

  /**
   * Synchronizes an external CanonicalProjectStore (e.g. from EditingStudioWorkspace)
   * with this shared session manager so both routes share identical state.
   */
  syncExternalStore(
    externalStore: CanonicalProjectStore,
    partial?: Partial<CanonicalEditorSessionState>
  ): void {
    this.store = externalStore;
    const doc = externalStore.getProject();
    this.emit({
      mode: this.state.mode === 'chooser' ? 'active-project' : this.state.mode,
      project: doc,
      ...partial,
    });
  }

  hydrateFromLibraryItem(
    item: ProjectLibraryItem,
    ownerUid?: string
  ): CanonicalProjectDocument {
    const effectiveOwner = item.ownerUid || ownerUid || this.state.ownerUid;
    let rawInput: unknown = item;
    if (item.canonicalProjectJson) {
      try {
        rawInput = JSON.parse(item.canonicalProjectJson);
      } catch {
        rawInput = item;
      }
    } else if (item.sowveilSpecJson) {
      try {
        rawInput = JSON.parse(item.sowveilSpecJson);
      } catch {
        rawInput = item;
      }
    }
    const migrated = migrateToCanonicalProject(rawInput, effectiveOwner);
    migrated.project.id = item.id;
    migrated.project.ownerUid = effectiveOwner;
    migrated.project.title = item.title || migrated.project.title;
    if (typeof item.revision === 'number' && item.revision >= 1) {
      migrated.project.revision = item.revision;
    }
    return this.openProjectDocument(migrated.project, {
      isDemoMode: false,
      savedRevision: migrated.project.revision,
      saveState: 'Saved',
    });
  }

  async loadProjectById(
    projectId: string,
    options: {
      ownerUid: string;
      localProjects?: ProjectLibraryItem[];
      fetchCanonicalFromServer?: (projectId: string) => Promise<{
        project: CanonicalProjectDocument;
        canUndo?: boolean;
        canRedo?: boolean;
      } | null>;
    }
  ): Promise<CanonicalProjectDocument | null> {
    const trimmedId = projectId.trim();
    if (!trimmedId) return null;

    if (
      this.store &&
      this.state.project &&
      this.state.project.id === trimmedId &&
      (this.state.saveState === 'Unsaved Changes' ||
        this.state.saveState === 'Offline Draft' ||
        this.state.saveState === 'Failed' ||
        this.state.saveState === 'Conflict')
    ) {
      this.emit({
        mode: this.state.isDemoMode ? 'demo' : 'active-project',
        isLoadingProject: false,
        loadError: null,
      });
      return this.state.project;
    }

    this.emit({ isLoadingProject: true, loadError: null });

    if (options.fetchCanonicalFromServer) {
      try {
        const remote = await options.fetchCanonicalFromServer(trimmedId);
        if (remote && remote.project) {
          return this.openProjectDocument(remote.project, {
            isDemoMode: false,
            savedRevision: remote.project.revision,
            saveState: 'Saved',
            forceReplace: true,
          });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load project from server.';
        if (message.includes('403') || message.includes('CROSS_USER')) {
          this.emit({
            isLoadingProject: false,
            loadError:
              'Access denied: you do not have permission to open this project.',
          });
          return null;
        }
      }
    }

    const matchedLocal = (options.localProjects || []).find(
      (p) => p.id === trimmedId
    );
    if (matchedLocal) {
      return this.hydrateFromLibraryItem(matchedLocal, options.ownerUid);
    }

    this.emit({
      isLoadingProject: false,
      loadError: `Project "${trimmedId}" was not found in your workspace.`,
    });
    return null;
  }

  createNewProject(options: {
    id?: string;
    ownerUid: string;
    title: string;
    description?: string;
    aspectRatio?: MobileAspectRatio;
    targetEditor?: TargetMobileEditorId;
    durationSec?: number;
  }): CanonicalProjectDocument {
    const newDoc = createNewUserCanonicalProject(options);
    return this.openProjectDocument(newDoc, {
      isDemoMode: false,
      savedRevision: null,
      saveState: 'Unsaved Changes',
      forceReplace: true,
    });
  }

  enterExplicitDemoMode(ownerUid?: string): CanonicalProjectDocument {
    const uid = ownerUid || this.state.ownerUid;
    const demoDoc = createSevenTrackDemoCanonicalProject(uid);
    return this.openProjectDocument(demoDoc, {
      isDemoMode: true,
      savedRevision: null,
      saveState: 'Unsaved Changes',
      forceReplace: true,
    });
  }

  openProjectChooser(): void {
    this.emit({
      mode: 'chooser',
      isPlaying: false,
      loadError: null,
    });
  }

  resumeActiveProjectFromChooser(): void {
    if (this.state.project) {
      this.emit({
        mode: this.state.isDemoMode ? 'demo' : 'active-project',
      });
    }
  }

  setSelection(selection: {
    selectedClipId?: string | null;
    multiSelectedClipIds?: string[];
    selectedTrackId?: string | null;
    selectedSceneId?: string | null;
    selectedKeyframeId?: string | null;
    selectedProperty?: AnimatablePropertyKey;
  }): void {
    const nextClipId =
      selection.selectedClipId !== undefined
        ? selection.selectedClipId
        : this.state.selectedClipId;
    const nextMulti =
      selection.multiSelectedClipIds !== undefined
        ? selection.multiSelectedClipIds
        : nextClipId
        ? [nextClipId]
        : [];
    let nextTrackId =
      selection.selectedTrackId !== undefined
        ? selection.selectedTrackId
        : this.state.selectedTrackId;
    let nextKeyframeId =
      selection.selectedKeyframeId !== undefined
        ? selection.selectedKeyframeId
        : this.state.selectedKeyframeId;

    if (nextClipId && this.state.project) {
      for (const trk of this.state.project.tracks) {
        const foundClip = trk.clips.find((c) => c.id === nextClipId);
        if (foundClip) {
          nextTrackId = trk.id;
          if (
            selection.selectedKeyframeId === undefined &&
            (!nextKeyframeId ||
              !foundClip.keyframes.some((k) => k.id === nextKeyframeId))
          ) {
            nextKeyframeId = foundClip.keyframes[0]?.id || null;
          }
          break;
        }
      }
    }

    this.emit({
      selectedClipId: nextClipId,
      multiSelectedClipIds: nextMulti,
      selectedTrackId: nextTrackId,
      selectedSceneId:
        selection.selectedSceneId !== undefined
          ? selection.selectedSceneId
          : this.state.selectedSceneId,
      selectedKeyframeId: nextKeyframeId,
      selectedProperty:
        selection.selectedProperty || this.state.selectedProperty,
    });
  }

  toggleClipInMultiSelection(clipId: string): void {
    const exists = this.state.multiSelectedClipIds.includes(clipId);
    const nextMulti = exists
      ? this.state.multiSelectedClipIds.filter((id) => id !== clipId)
      : [...this.state.multiSelectedClipIds, clipId];
    const nextPrimary = nextMulti[nextMulti.length - 1] || null;
    this.setSelection({
      selectedClipId: nextPrimary,
      multiSelectedClipIds: nextMulti,
    });
  }

  setTransport(transport: {
    playheadSec?: number;
    isPlaying?: boolean;
    loopEnabled?: boolean;
    snapEnabled?: boolean;
    timelineZoomPxPerSec?: number;
  }): void {
    const duration = this.state.project?.canvas.durationSec || 8;
    const nextPlayhead =
      transport.playheadSec !== undefined
        ? Math.max(
            0,
            Math.min(duration, Number(transport.playheadSec.toFixed(3)))
          )
        : this.state.playheadSec;
    this.emit({
      playheadSec: nextPlayhead,
      isPlaying:
        transport.isPlaying !== undefined
          ? transport.isPlaying
          : this.state.isPlaying,
      loopEnabled:
        transport.loopEnabled !== undefined
          ? transport.loopEnabled
          : this.state.loopEnabled,
      snapEnabled:
        transport.snapEnabled !== undefined
          ? transport.snapEnabled
          : this.state.snapEnabled,
      timelineZoomPxPerSec:
        transport.timelineZoomPxPerSec !== undefined
          ? Math.max(28, Math.min(200, transport.timelineZoomPxPerSec))
          : this.state.timelineZoomPxPerSec,
    });
  }

  dispatchCommand(
    command: CanonicalProjectCommand,
    options?: {
      actorId?: string;
      actorKind?: 'user' | 'ai-director';
      rationale?: string;
    }
  ): ProjectCommandReceipt {
    if (!this.store) {
      throw new Error('No active canonical project in session.');
    }

    const receipt = this.store.dispatch(command, {
      actorId: options?.actorId || this.state.ownerUid,
      actorKind: options?.actorKind || 'user',
      rationale: options?.rationale,
      approvedByUser: true,
    });

    if (!receipt.ok) {
      this.emit({
        lastReceipt: receipt,
        receiptHistory: [receipt, ...this.state.receiptHistory].slice(0, 40),
      });
      return receipt;
    }

    const updatedDoc = this.store.getProject();
    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    const nextSaveState: CanonicalSaveState = isOffline
      ? 'Offline Draft'
      : 'Unsaved Changes';

    let nextSelectedClipId = this.state.selectedClipId;
    let nextMultiSelected = [...this.state.multiSelectedClipIds];
    let nextSelectedTrackId = this.state.selectedTrackId;
    let nextSelectedKeyframeId = this.state.selectedKeyframeId;

    if (
      command.type === 'createClip' ||
      command.type === 'duplicateClip'
    ) {
      const createdId = receipt.changedIds[0];
      if (createdId) {
        nextSelectedClipId = createdId;
        nextMultiSelected = [createdId];
      }
    } else if (command.type === 'splitClip') {
      const rightId = receipt.changedIds[1] || receipt.changedIds[0];
      if (rightId) {
        nextSelectedClipId = rightId;
        nextMultiSelected = [rightId];
      }
    } else if (command.type === 'deleteClip') {
      nextMultiSelected = nextMultiSelected.filter(
        (id) => id !== command.clipId
      );
      if (nextSelectedClipId === command.clipId) {
        const fallbackSelection = this.pickDefaultSelection(updatedDoc);
        nextSelectedClipId =
          nextMultiSelected[0] || fallbackSelection.selectedClipId;
        nextSelectedTrackId = fallbackSelection.selectedTrackId;
      }
    } else if (command.type === 'addKeyframe') {
      const createdKfId = receipt.changedIds.find(
        (id) => id !== command.clipId
      );
      if (createdKfId) {
        nextSelectedKeyframeId = createdKfId;
      }
    } else if (command.type === 'removeKeyframe') {
      if (nextSelectedKeyframeId === command.keyframeId) {
        nextSelectedKeyframeId = null;
      }
    }

    if (typeof window !== 'undefined') {
      try {
        const safeOwner = updatedDoc.ownerUid || this.state.ownerUid;
        window.localStorage.setItem(
          `sowveil.canonical.autosave.${safeOwner}.${updatedDoc.id}`,
          JSON.stringify(updatedDoc)
        );
        window.localStorage.setItem(
          `sowveil.canonical.lastActiveProject.${safeOwner}`,
          JSON.stringify(updatedDoc)
        );
      } catch {
        // ignore storage quota errors
      }
    }

    this.emit({
      saveState: nextSaveState,
      saveError: null,
      lastReceipt: receipt,
      receiptHistory: [receipt, ...this.state.receiptHistory].slice(0, 40),
      selectedClipId: nextSelectedClipId,
      multiSelectedClipIds: nextMultiSelected,
      selectedTrackId: nextSelectedTrackId,
      selectedKeyframeId: nextSelectedKeyframeId,
    });

    return receipt;
  }

  undo(actorId?: string): ProjectCommandReceipt {
    if (!this.store) {
      throw new Error('No active canonical project in session.');
    }
    const receipt = this.store.undo(actorId || this.state.ownerUid);
    if (receipt.ok) {
      const doc = this.store.getProject();
      const selection = this.pickDefaultSelection(doc);
      const nextSaveState: CanonicalSaveState =
        this.state.lastSavedRevision !== null &&
        doc.revision === this.state.lastSavedRevision
          ? 'Saved'
          : 'Unsaved Changes';
      this.emit({
        saveState: nextSaveState,
        lastReceipt: receipt,
        receiptHistory: [receipt, ...this.state.receiptHistory].slice(0, 40),
        ...selection,
      });
    } else {
      this.emit({ lastReceipt: receipt });
    }
    return receipt;
  }

  redo(actorId?: string): ProjectCommandReceipt {
    if (!this.store) {
      throw new Error('No active canonical project in session.');
    }
    const receipt = this.store.redo(actorId || this.state.ownerUid);
    if (receipt.ok) {
      const doc = this.store.getProject();
      const selection = this.pickDefaultSelection(doc);
      const nextSaveState: CanonicalSaveState =
        this.state.lastSavedRevision !== null &&
        doc.revision === this.state.lastSavedRevision
          ? 'Saved'
          : 'Unsaved Changes';
      this.emit({
        saveState: nextSaveState,
        lastReceipt: receipt,
        receiptHistory: [receipt, ...this.state.receiptHistory].slice(0, 40),
        ...selection,
      });
    } else {
      this.emit({ lastReceipt: receipt });
    }
    return receipt;
  }

  /**
   * Captures current property value at playheadSec on the target clip,
   * updates existing keyframe if one already exists at the same time & property,
   * or adds a new keyframe and selects it.
   */
  upsertKeyframeAtPlayhead(params?: {
    clipId?: string;
    property?: AnimatablePropertyKey;
    timeSec?: number;
    value?: number;
    interpolation?: CanonicalKeyframeInterpolation;
    cubicBezier?: [number, number, number, number];
    easingPresetId?: string;
    actorId?: string;
  }): ProjectCommandReceipt | null {
    if (!this.store || !this.state.project) return null;
    const doc = this.state.project;

    const targetClipId = params?.clipId || this.state.selectedClipId;
    if (!targetClipId) return null;

    let targetClip: CanonicalClip | null = null;
    for (const trk of doc.tracks) {
      const found = trk.clips.find((c) => c.id === targetClipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) return null;

    const property: AnimatablePropertyKey =
      params?.property || this.state.selectedProperty || 'opacity';
    const rawTime =
      params?.timeSec !== undefined ? params.timeSec : this.state.playheadSec;
    const clampedTimeSec = Number(
      Math.max(
        targetClip.startTimeSec,
        Math.min(targetClip.startTimeSec + targetClip.durationSec, rawTime)
      ).toFixed(3)
    );

    let resolvedValue: number = params?.value ?? 1;
    if (params?.value === undefined) {
      const evalFrames = evaluateProjectAtTime(doc, clampedTimeSec);
      const activeClipSnap = evalFrames.find(
        (c) => c.clip.id === targetClip!.id
      );
      if (property === 'opacity') {
        resolvedValue =
          activeClipSnap?.transform.opacity ??
          targetClip.transform.opacity;
      } else if (property === 'positionX') {
        resolvedValue =
          activeClipSnap?.transform.position[0] ??
          targetClip.transform.position[0];
      } else if (property === 'positionY') {
        resolvedValue =
          activeClipSnap?.transform.position[1] ??
          targetClip.transform.position[1];
      } else if (property === 'scaleX') {
        resolvedValue =
          activeClipSnap?.transform.scale[0] ??
          targetClip.transform.scale[0];
      } else if (property === 'scaleY') {
        resolvedValue =
          activeClipSnap?.transform.scale[1] ??
          targetClip.transform.scale[1];
      } else if (property === 'rotationDeg') {
        resolvedValue =
          activeClipSnap?.transform.rotationDeg ??
          targetClip.transform.rotationDeg;
      } else if (property === 'audioGainDb') {
        resolvedValue =
          activeClipSnap?.effectiveAudioGainDb ??
          targetClip.audioConfig?.gainDb ??
          0;
      } else {
        resolvedValue = 1;
      }
    }

    const existingKf: CanonicalKeyframe | undefined =
      targetClip.keyframes.find(
        (kf) =>
          kf.property === property &&
          Math.abs(kf.timeSec - clampedTimeSec) <= 0.02
      );

    if (existingKf) {
      const receipt = this.dispatchCommand(
        {
          type: 'updateKeyframe',
          clipId: targetClip.id,
          keyframeId: existingKf.id,
          patch: {
            timeSec: clampedTimeSec,
            value: resolvedValue,
            interpolation: params?.interpolation || existingKf.interpolation,
            cubicBezier: params?.cubicBezier || existingKf.cubicBezier,
            easingPresetId:
              params?.easingPresetId ?? existingKf.easingPresetId,
          },
        },
        {
          actorId: params?.actorId,
          rationale: `Update ${property} keyframe at ${clampedTimeSec.toFixed(
            2
          )}s`,
        }
      );
      if (receipt.ok) {
        this.setSelection({
          selectedClipId: targetClip.id,
          selectedKeyframeId: existingKf.id,
          selectedProperty: property,
        });
      }
      return receipt;
    }

    const receipt = this.dispatchCommand(
      {
        type: 'addKeyframe',
        clipId: targetClip.id,
        keyframe: {
          property,
          timeSec: clampedTimeSec,
          value: resolvedValue,
          interpolation: params?.interpolation || 'ease-out',
          cubicBezier: params?.cubicBezier,
          easingPresetId: params?.easingPresetId,
        },
      },
      {
        actorId: params?.actorId,
        rationale: `Add ${property} keyframe at ${clampedTimeSec.toFixed(2)}s`,
      }
    );
    if (receipt.ok) {
      this.setSelection({
        selectedClipId: targetClip.id,
        selectedProperty: property,
      });
    }
    return receipt;
  }

  /**
   * Wires easing preset cards in the Animation tab to the selected keyframe segment
   * (or creates a keyframe at playhead if the clip has none yet).
   */
  applyEasingPresetToSelection(
    presetId: string,
    actorId?: string
  ): ProjectCommandReceipt | null {
    if (!this.store || !this.state.project) return null;
    const preset = EASING_CURVE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return null;

    const clipId = this.state.selectedClipId;
    if (!clipId) return null;

    let targetClip: CanonicalClip | null = null;
    for (const trk of this.state.project.tracks) {
      const found = trk.clips.find((c) => c.id === clipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) return null;

    const interpolation: CanonicalKeyframeInterpolation =
      preset.id === 'linear' ? 'linear' : 'cubic-bezier';

    const targetKf =
      targetClip.keyframes.find(
        (k) => k.id === this.state.selectedKeyframeId
      ) || targetClip.keyframes[targetClip.keyframes.length - 1];

    if (targetKf) {
      const receipt = this.dispatchCommand(
        {
          type: 'updateKeyframe',
          clipId: targetClip.id,
          keyframeId: targetKf.id,
          patch: {
            interpolation,
            cubicBezier: preset.points,
            easingPresetId: preset.id,
          },
        },
        {
          actorId,
          rationale: `Apply easing preset "${preset.label}" to keyframe`,
        }
      );
      if (receipt.ok) {
        this.setSelection({
          selectedClipId: targetClip.id,
          selectedKeyframeId: targetKf.id,
        });
      }
      return receipt;
    }

    return this.upsertKeyframeAtPlayhead({
      clipId: targetClip.id,
      property: this.state.selectedProperty,
      interpolation,
      cubicBezier: preset.points,
      easingPresetId: preset.id,
      actorId,
    });
  }

  /**
   * Saves the entire canonical document, assetReferences, dependencies, revision,
   * metadata and timestamps through the authoritative repository.
   * Derives ProjectLibraryItem metadata from the saved document (no hardcoded 1 KB).
   */
  async saveProject(
    persister: (
      record: ProjectLibraryItem,
      expectedRevision?: number
    ) => Promise<ProjectLibraryItem | void>
  ): Promise<{
    ok: boolean;
    saveState: CanonicalSaveState;
    record?: ProjectLibraryItem;
    error?: string;
  }> {
    if (!this.store || !this.state.project) {
      return {
        ok: false,
        saveState: 'Failed',
        error: 'No active canonical project to save.',
      };
    }

    const currentDoc = this.store.getProject();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (typeof window !== 'undefined') {
        try {
          const safeOwner = currentDoc.ownerUid || this.state.ownerUid;
          window.localStorage.setItem(
            `sowveil.canonical.autosave.${safeOwner}.${currentDoc.id}`,
            JSON.stringify(currentDoc)
          );
        } catch {
          // ignore quota errors
        }
      }
      this.emit({
        saveState: 'Offline Draft',
        saveError: 'Device is offline. Saved locally as an Offline Draft.',
      });
      return {
        ok: false,
        saveState: 'Offline Draft',
        error: 'Device is offline. Saved locally as an Offline Draft.',
      };
    }

    this.emit({
      saveState: 'Saving',
      saveError: null,
      conflictServerRevision: null,
    });

    const derivedLibraryRecord = canonicalProjectToLibraryRecord(currentDoc);
    const fullRecord: ProjectLibraryItem = {
      ...derivedLibraryRecord,
      id: currentDoc.id,
      ownerUid: currentDoc.ownerUid || this.state.ownerUid,
      createdAt: currentDoc.createdAt,
      updatedAt: new Date().toISOString(),
      revision: currentDoc.revision,
      activeBranch: currentDoc.activeBranch,
    };

    try {
      const result = await persister(
        fullRecord,
        this.state.lastSavedRevision ?? undefined
      );
      const persistedRecord = result || fullRecord;

      const confirmedRevision =
        typeof persistedRecord.revision === 'number'
          ? persistedRecord.revision
          : currentDoc.revision;

      if (confirmedRevision !== currentDoc.revision) {
        currentDoc.revision = confirmedRevision;
      }

      this.emit({
        mode: 'active-project',
        isDemoMode: false,
        saveState: 'Saved',
        lastSavedRevision: confirmedRevision,
        lastSavedAt: persistedRecord.updatedAt || fullRecord.updatedAt,
        saveError: null,
        conflictServerRevision: null,
      });

      return {
        ok: true,
        saveState: 'Saved',
        record: {
          ...fullRecord,
          ...persistedRecord,
          revision: confirmedRevision,
        },
      };
    } catch (err) {
      const rawMessage =
        err instanceof Error
          ? err.message
          : 'Unable to save project to authoritative repository.';
      const isConflict =
        rawMessage.includes('REVISION_CONFLICT') || rawMessage.includes('409');

      if (isConflict) {
        const matchRev = rawMessage.match(/revision\s+(\d+)/i);
        const serverRev = matchRev ? Number(matchRev[1]) : null;
        this.emit({
          saveState: 'Conflict',
          saveError: rawMessage,
          conflictServerRevision: serverRev,
        });
        return {
          ok: false,
          saveState: 'Conflict',
          error: rawMessage,
        };
      }

      this.emit({
        saveState: 'Failed',
        saveError: rawMessage,
      });
      return {
        ok: false,
        saveState: 'Failed',
        error: rawMessage,
      };
    }
  }
}

export const sharedCanonicalEditorSession = new CanonicalEditorSessionManager();

export function useCanonicalEditorSession(
  sessionManager: CanonicalEditorSessionManager = sharedCanonicalEditorSession
): {
  state: CanonicalEditorSessionState;
  session: CanonicalEditorSessionManager;
} {
  const [state, setState] = useState<CanonicalEditorSessionState>(() =>
    sessionManager.getState()
  );

  useEffect(() => {
    setState(sessionManager.getState());
    return sessionManager.subscribe((nextState) => {
      setState({ ...nextState });
    });
  }, [sessionManager]);

  return { state, session: sessionManager };
}
