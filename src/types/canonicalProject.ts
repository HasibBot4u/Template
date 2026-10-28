import {
  EditorCompatibilityStatus,
  MobileAspectRatio,
  ModuleId,
  TargetMobileEditorId,
  TemplateLicenseType,
} from './sowveil';
import { BackgroundAlphaMode } from '../features/editor-gateway';

export type CanonicalSchemaVersion = '2.0.0';
export type LegacyProjectSchemaVersion = '1.0.0' | '2.4.0-mobile';

export type CanonicalTrackKind =
  | 'video'
  | 'vector'
  | 'text'
  | 'audio'
  | 'caption'
  | 'template'
  | 'effect'
  | 'camera3d';

export type CanonicalClipKind =
  | 'video'
  | 'image'
  | 'vector'
  | 'text'
  | 'audio'
  | 'caption'
  | 'template-instance'
  | 'adjustment-effect'
  | 'entity-3d'
  | 'camera-3d';

export type CanonicalBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'add';

export type CanonicalKeyframeInterpolation =
  | 'linear'
  | 'hold'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'cubic-bezier';

export type RendererSupportLevel =
  | 'supported'
  | 'partial-fallback'
  | 'unsupported';

export interface CanonicalCanvasConfig {
  width: number;
  height: number;
  aspectRatio: MobileAspectRatio;
  fps: 24 | 30 | 60;
  timebaseTicksPerSec: number;
  durationSec: number;
  backgroundColorHex: string;
  backgroundAlphaMode: BackgroundAlphaMode;
}

export interface CanonicalSceneReference {
  id: string;
  title: string;
  order: number;
  startTimeSec: number;
  durationSec: number;
  scriptSegmentIds: string[];
  continuityNotes?: string;
  status: 'planned' | 'draft' | 'approved' | 'locked' | 'omitted';
}

export interface CanonicalTransform2D {
  position: [number, number];
  scale: [number, number];
  rotationDeg: number;
  anchor: [number, number];
  opacity: number;
}

export interface CanonicalKeyframe {
  id: string;
  property:
    | 'positionX'
    | 'positionY'
    | 'scaleX'
    | 'scaleY'
    | 'rotationDeg'
    | 'opacity'
    | 'audioGainDb'
    | string;
  timeSec: number;
  value: number | string | boolean;
  interpolation: CanonicalKeyframeInterpolation;
  cubicBezier?: [number, number, number, number];
  easingPresetId?: string;
}

export interface CanonicalEffectInstance {
  id: string;
  effectType: string;
  name: string;
  enabled: boolean;
  rendererSupport: RendererSupportLevel;
  supportedInAlightXml: boolean;
  parameters: Record<string, string | number | boolean>;
}

export interface CanonicalMaskSpec {
  id: string;
  name: string;
  mode: 'add' | 'subtract' | 'intersect';
  inverted: boolean;
  featherPx: number;
  opacity: number;
  svgPathData: string;
  rendererSupport: RendererSupportLevel;
}

export interface CanonicalTransitionSpec {
  id: string;
  type:
    | 'cut'
    | 'cross-dissolve'
    | 'slide-left'
    | 'slide-up'
    | 'zoom-blur'
    | 'vertical-glow'
    | 'whip-pan';
  durationSec: number;
  easingCurve: [number, number, number, number];
  parameters: Record<string, string | number | boolean>;
  targetClipId?: string;
}

export interface CanonicalTextTypography {
  content: string;
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  letterSpacingEm: number;
  lineHeightMultiplier: number;
  colorHex: string;
  strokeColorHex?: string;
  strokeWidthPx?: number;
  backgroundHighlightHex?: string;
  alignment: 'left' | 'center' | 'right';
  textTransform?: 'none' | 'uppercase' | 'lowercase';
}

export interface CanonicalVectorShape {
  shapeType: 'rect' | 'ellipse' | 'polygon' | 'path' | 'liquid-glass-card';
  svgPathData: string;
  fillColorHex: string;
  strokeColorHex: string;
  strokeWidthPx: number;
  cornerRadiusPx: number;
}

export interface CanonicalEntity3DSpec {
  primitiveType: 'cube' | 'sphere' | 'torus' | 'plane' | 'glb-asset';
  modelAssetId?: string;
  position3d: [number, number, number];
  rotation3dDeg: [number, number, number];
  scale3d: [number, number, number];
  materialPreset: 'matte' | 'glossy' | 'metallic' | 'liquid-glass';
  rendererSupport: RendererSupportLevel;
}

export interface CanonicalCamera3DSpec {
  projection: 'perspective' | 'orthographic';
  fovDeg: number;
  nearClip: number;
  farClip: number;
  position3d: [number, number, number];
  target3d: [number, number, number];
  depthOfFieldEnabled: boolean;
  rendererSupport: RendererSupportLevel;
}

export interface CanonicalAudioConfig {
  gainDb: number;
  linearGain: number;
  pan: number;
  fadeInSec: number;
  fadeOutSec: number;
  muted: boolean;
  proceduralSfxPreset?: string;
  waveformPeaks?: number[];
}

export interface CanonicalCaptionWordTiming {
  word: string;
  startSec: number;
  endSec: number;
}

export interface CanonicalCaptionData {
  cueIndex: number;
  text: string;
  speaker?: string;
  stylePresetId: string;
  highlightColorHex: string;
  maxCharsPerLine: number;
  wordTimings?: CanonicalCaptionWordTiming[];
}

export interface CanonicalNestedTemplateBinding {
  baseTemplateId: string;
  baseTemplateVersion: string;
  variantId?: string;
  moduleId: ModuleId;
  parameterOverrides: Record<string, string | number | boolean>;
  assetSlotBindings: Record<string, string>;
  editabilityLevel:
    | 'source-proven'
    | 'parameter-rig'
    | 'reconstructed-approximation'
    | 'flattened-media';
}

export interface CanonicalClip {
  id: string;
  trackId: string;
  name: string;
  kind: CanonicalClipKind;
  sceneId?: string;
  sourceSegmentId?: string;
  groupId?: string;
  startTimeSec: number;
  durationSec: number;
  sourceInSec: number;
  sourceOutSec: number;
  trimInSec: number;
  trimOutSec: number;
  speedMultiplier: number;
  visible: boolean;
  locked: boolean;
  muted: boolean;
  solo: boolean;
  blendMode: CanonicalBlendMode;
  transform: CanonicalTransform2D;
  assetId?: string;
  assetSlotBindings?: Record<string, string>;
  textData?: CanonicalTextTypography;
  vectorData?: CanonicalVectorShape;
  audioConfig?: CanonicalAudioConfig;
  captionData?: CanonicalCaptionData;
  templateBinding?: CanonicalNestedTemplateBinding;
  entity3d?: CanonicalEntity3DSpec;
  camera3d?: CanonicalCamera3DSpec;
  keyframes: CanonicalKeyframe[];
  effects: CanonicalEffectInstance[];
  masks: CanonicalMaskSpec[];
  inTransition?: CanonicalTransitionSpec;
  outTransition?: CanonicalTransitionSpec;
  unknownProperties?: Record<string, unknown>;
}

export interface CanonicalTrack {
  id: string;
  name: string;
  kind: CanonicalTrackKind;
  order: number;
  visible: boolean;
  locked: boolean;
  muted: boolean;
  solo: boolean;
  blendMode: CanonicalBlendMode;
  gainDb: number;
  clips: CanonicalClip[];
  unknownProperties?: Record<string, unknown>;
}

export interface CanonicalTimelineMarker {
  id: string;
  timeSec: number;
  durationSec?: number;
  label: string;
  colorHex: string;
  kind: 'chapter' | 'beat' | 'script-cue' | 'comment' | 'qa-warning';
  linkedScriptSegmentId?: string;
}

export interface CanonicalAssetDependency {
  assetId: string;
  title: string;
  role:
    | 'primary-media'
    | 'vector-graphic'
    | 'audio-sfx'
    | 'font'
    | 'caption-sidecar'
    | '3d-model'
    | 'template-slot';
  mimeType: string;
  required: boolean;
  missing: boolean;
  licenseType: TemplateLicenseType;
  attribution?: string;
  sourceUrl?: string;
}

export interface CanonicalDependencyRecord {
  id: string;
  kind: 'module' | 'font' | 'shader' | 'audio-engine' | 'adapter';
  name: string;
  versionConstraint: string;
  required: boolean;
  status: 'satisfied' | 'optional-fallback' | 'missing';
}

export interface CanonicalProvenanceRecord {
  originType:
    | 'manual-editor'
    | 'template-instantiation'
    | 'ai-director'
    | 'imported-sowveil-json'
    | 'migrated-legacy-v1'
    | 'reference-reconstruction';
  authorUid: string;
  createdFromTemplateId?: string;
  createdFromVariantId?: string;
  sourceUrl?: string;
  licenseType: TemplateLicenseType;
  licenseNote: string;
  attribution: string;
  reconstructionFidelityNote?: string;
}

export interface CanonicalAiEditRecord {
  id: string;
  timestamp: string;
  actorId: string;
  actorKind: 'user' | 'ai-director';
  commandType: CanonicalCommandType;
  rationale: string;
  changedIds: string[];
  beforeRevision: number;
  afterRevision: number;
  approvedByUser: boolean;
}

export interface CanonicalProjectSnapshot {
  id: string;
  label: string;
  branchName: string;
  revision: number;
  createdAt: string;
  createdByUid: string;
  serializedStateJson: string;
}

export interface CanonicalProjectBranch {
  name: string;
  headRevision: number;
  createdFromRevision: number;
  createdAt: string;
  description?: string;
}

export interface CanonicalUnsupportedFeatureRecord {
  id: string;
  featureKey: string;
  sourceFormat: string;
  severity: 'info' | 'warning' | 'blocking';
  fallbackBehavior: 'preserved-metadata' | 'approximated-2d' | 'omitted-on-export';
  message: string;
  rawPayload?: Record<string, unknown>;
}

export interface CanonicalRendererRequirements {
  minCanvasTier: 'canvas-2d' | 'svg-vector' | 'webgl-2d' | 'webgl-3d-experimental';
  requiresWebAudio: boolean;
  requiresWebGL: boolean;
  requires3dPreview: boolean;
  targetMobileEditors: Partial<Record<TargetMobileEditorId, EditorCompatibilityStatus>>;
  degradationNotes: string[];
}

export interface CanonicalProjectDocument {
  format: 'sowveil-canonical-project';
  schemaVersion: CanonicalSchemaVersion;
  migratedFromVersion?: LegacyProjectSchemaVersion;
  id: string;
  ownerUid: string;
  title: string;
  description: string;
  moduleId: ModuleId;
  targetEditor: TargetMobileEditorId;
  revision: number;
  activeBranch: string;
  createdAt: string;
  updatedAt: string;
  canvas: CanonicalCanvasConfig;
  scenes: CanonicalSceneReference[];
  tracks: CanonicalTrack[];
  markers: CanonicalTimelineMarker[];
  assetReferences: CanonicalAssetDependency[];
  dependencies: CanonicalDependencyRecord[];
  provenance: CanonicalProvenanceRecord;
  aiEditHistory: CanonicalAiEditRecord[];
  snapshots: CanonicalProjectSnapshot[];
  branches: CanonicalProjectBranch[];
  unsupportedFeatures: CanonicalUnsupportedFeatureRecord[];
  rendererRequirements: CanonicalRendererRequirements;
  tags: string[];
  unknownProperties?: Record<string, unknown>;
}

export type CanonicalCommandType =
  | 'createTrack'
  | 'setTrackState'
  | 'createClip'
  | 'trimClip'
  | 'splitClip'
  | 'moveClip'
  | 'reorderClip'
  | 'deleteClip'
  | 'setTransform'
  | 'setTextProperties'
  | 'addKeyframe'
  | 'updateKeyframe'
  | 'removeKeyframe'
  | 'addEffect'
  | 'setEffectParameter'
  | 'removeEffect'
  | 'replaceAsset'
  | 'insertTransition'
  | 'setGain'
  | 'alterCaption'
  | 'instantiateTemplate'
  | 'addMarker'
  | 'removeMarker'
  | 'renameProject'
  | 'updateCanvas'
  | 'createSnapshot'
  | 'restoreSnapshot'
  | 'createBranch'
  | 'duplicateClip'
  | 'setClipState'
  | 'groupClips'
  | 'ungroupClips'
  | 'setSceneState'
  | 'duplicateScene'
  | 'resolveMissingAsset'
  | 'resolveUnsupportedFeature';

export type CanonicalProjectCommand =
  | {
      type: 'createTrack';
      trackId?: string;
      name: string;
      kind: CanonicalTrackKind;
      order?: number;
    }
  | {
      type: 'setTrackState';
      trackId: string;
      name?: string;
      visible?: boolean;
      locked?: boolean;
      muted?: boolean;
      solo?: boolean;
      gainDb?: number;
      blendMode?: CanonicalBlendMode;
      order?: number;
    }
  | {
      type: 'createClip';
      trackId: string;
      clip: Partial<CanonicalClip> & {
        id?: string;
        name: string;
        kind: CanonicalClipKind;
        startTimeSec: number;
        durationSec: number;
      };
    }
  | {
      type: 'trimClip';
      clipId: string;
      startTimeSec?: number;
      durationSec?: number;
      trimInSec?: number;
      trimOutSec?: number;
      speedMultiplier?: number;
    }
  | {
      type: 'splitClip';
      clipId: string;
      splitTimeSec: number;
      secondClipId?: string;
    }
  | {
      type: 'moveClip';
      clipId: string;
      targetTrackId?: string;
      startTimeSec: number;
      moveGroup?: boolean;
    }
  | {
      type: 'reorderClip';
      clipId: string;
      targetTrackId: string;
      newIndex: number;
    }
  | {
      type: 'deleteClip';
      clipId: string;
    }
  | {
      type: 'duplicateClip';
      clipId: string;
      newClipId?: string;
      startTimeSec?: number;
      targetTrackId?: string;
      retainSourceMapping?: boolean;
    }
  | {
      type: 'setClipState';
      clipId: string;
      name?: string;
      visible?: boolean;
      locked?: boolean;
      muted?: boolean;
      solo?: boolean;
      blendMode?: CanonicalBlendMode;
      groupId?: string | null;
      sceneId?: string;
    }
  | {
      type: 'groupClips';
      clipIds: string[];
      groupId?: string;
    }
  | {
      type: 'ungroupClips';
      groupId?: string;
      clipIds?: string[];
    }
  | {
      type: 'setSceneState';
      sceneId: string;
      title?: string;
      status?: 'planned' | 'draft' | 'approved' | 'locked' | 'omitted';
      continuityNotes?: string;
      lockSceneClips?: boolean;
    }
  | {
      type: 'duplicateScene';
      sceneId: string;
      newSceneId?: string;
      retainSourceMapping?: boolean;
      insertAtTimeSec?: number;
    }
  | {
      type: 'resolveMissingAsset';
      assetId: string;
      replacementAssetId?: string;
      replacementTitle?: string;
      sourceUrl?: string;
      mimeType?: string;
      licenseType?: TemplateLicenseType;
    }
  | {
      type: 'resolveUnsupportedFeature';
      featureId: string;
      resolutionStrategy:
        | 'convert-to-2d-approximation'
        | 'preserve-metadata'
        | 'omit-from-export';
    }
  | {
      type: 'setTransform';
      clipId: string;
      transform: Partial<CanonicalTransform2D>;
    }
  | {
      type: 'setTextProperties';
      clipId: string;
      textData: Partial<CanonicalTextTypography>;
    }
  | {
      type: 'addKeyframe';
      clipId: string;
      keyframe: Omit<CanonicalKeyframe, 'id'> & { id?: string };
    }
  | {
      type: 'updateKeyframe';
      clipId: string;
      keyframeId: string;
      patch: Partial<Omit<CanonicalKeyframe, 'id'>>;
    }
  | {
      type: 'removeKeyframe';
      clipId: string;
      keyframeId: string;
    }
  | {
      type: 'addEffect';
      clipId: string;
      effect: Omit<CanonicalEffectInstance, 'id'> & { id?: string };
    }
  | {
      type: 'setEffectParameter';
      clipId: string;
      effectId: string;
      parameterKey: string;
      value: string | number | boolean;
      enabled?: boolean;
    }
  | {
      type: 'removeEffect';
      clipId: string;
      effectId: string;
    }
  | {
      type: 'replaceAsset';
      clipId: string;
      newAssetId: string;
      slotKey?: string;
      assetTitle?: string;
      mimeType?: string;
      licenseType?: TemplateLicenseType;
    }
  | {
      type: 'insertTransition';
      clipId: string;
      edge: 'in' | 'out';
      transition: Omit<CanonicalTransitionSpec, 'id'> & { id?: string };
    }
  | {
      type: 'setGain';
      clipId?: string;
      trackId?: string;
      gainDb: number;
      fadeInSec?: number;
      fadeOutSec?: number;
      muted?: boolean;
    }
  | {
      type: 'alterCaption';
      clipId: string;
      text?: string;
      speaker?: string;
      startTimeSec?: number;
      durationSec?: number;
      stylePresetId?: string;
      highlightColorHex?: string;
    }
  | {
      type: 'instantiateTemplate';
      templateId: string;
      templateTitle?: string;
      templateVersion?: string;
      moduleId?: ModuleId;
      variantId?: string;
      trackId?: string;
      clipId?: string;
      startTimeSec?: number;
      durationSec?: number;
      parameterOverrides?: Record<string, string | number | boolean>;
      assetSlotBindings?: Record<string, string>;
      editabilityLevel?:
        | 'source-proven'
        | 'parameter-rig'
        | 'reconstructed-approximation'
        | 'flattened-media';
    }
  | {
      type: 'addMarker';
      marker: Omit<CanonicalTimelineMarker, 'id'> & { id?: string };
    }
  | {
      type: 'removeMarker';
      markerId: string;
    }
  | {
      type: 'renameProject';
      title: string;
      description?: string;
    }
  | {
      type: 'updateCanvas';
      canvas: Partial<CanonicalCanvasConfig>;
    }
  | {
      type: 'createSnapshot';
      label: string;
      snapshotId?: string;
    }
  | {
      type: 'restoreSnapshot';
      snapshotId: string;
    }
  | {
      type: 'createBranch';
      branchName: string;
      description?: string;
    };

export interface CommandActorContext {
  actorId: string;
  actorKind: 'user' | 'ai-director';
  rationale?: string;
  approvedByUser?: boolean;
}

export interface ProjectCommandReceipt {
  ok: boolean;
  commandType: CanonicalCommandType | 'undo' | 'redo';
  projectId: string;
  beforeRevision: number;
  revision: number;
  changedIds: string[];
  warnings: string[];
  errors: string[];
  undoRef: string | null;
  reversible?: boolean;
  irreversibleReason?: string;
  actorKind: 'user' | 'ai-director';
  rationale: string;
  timestamp: string;
}
