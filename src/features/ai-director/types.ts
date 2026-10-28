import { MobileAspectRatio, ModuleId, TargetMobileEditorId } from '../../types/sowveil';

/**
 * AI Provider Protocols supported by the Provider-Agnostic Gateway
 */
export type AiProviderProtocol =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-gemini'
  | 'custom-openai-compatible'
  | 'custom-anthropic-compatible';

export interface AiProviderCapabilities {
  textGeneration: boolean;
  structuredJson: boolean;
  toolCalls: boolean;
  imageInput: boolean;
  audioInput: boolean;
  audioGeneration: boolean;
  videoInput: boolean;
  maxContextTokens?: number;
}

export interface AiProviderConfig {
  id: string;
  name: string;
  protocol: AiProviderProtocol;
  baseUrl: string;
  apiPath: string;
  modelId: string;
  authHeaderMethod: 'Bearer' | 'x-api-key' | 'query-param' | 'custom-header';
  customHeaderName?: string;
  customHeaders?: Record<string, string>;
  isDefault: boolean;
  capabilities: AiProviderCapabilities;
  timeoutMs: number;
  maxOutputTokens: number;
  estimatedCostPer1kTokensUsd?: number;
}

export type KeyStorageMode = 'device-local-encrypted' | 'server-vault';

export interface AiProviderCredentialRecord {
  id: string;
  ownerUid: string;
  providerId: string;
  maskedKey: string;
  isConfigured: boolean;
  storageMode: KeyStorageMode;
  lastTestedAt: string | null;
  testStatus: 'healthy' | 'error' | 'untested';
  lastErrorRedacted: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Script Intake & 100% Coverage Tracker
 */
export type ScriptUnitKind = 'narration' | 'dialogue' | 'heading' | 'direction';
export type ScriptUnitStatus = 'uncovered' | 'covered-in-scene' | 'cut-by-user-consent';

export interface ScriptUnit {
  unitId: string;
  index: number;
  text: string;
  characterCount: number;
  estimatedDurationSec: number;
  kind: ScriptUnitKind;
  status: ScriptUnitStatus;
  assignedSceneId?: string;
  cutReason?: string;
  approvedByUid?: string;
}

export interface ScriptSourceDocument {
  id: string;
  ownerUid: string;
  title: string;
  rawContent: string;
  format: 'plain-text' | 'srt-subtitles' | 'vtt-subtitles' | 'markdown-script';
  units: ScriptUnit[];
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptCoverageReport {
  scriptId: string;
  totalUnits: number;
  coveredUnits: number;
  cutUnits: number;
  uncoveredUnits: number;
  percentCovered: number;
  uncoveredUnitIds: string[];
  isReadyForProduction: boolean;
  summaryNote: string;
}

/**
 * Director Brief & Scene-by-Scene Planning
 */
export interface DirectorBrief {
  audience: string;
  targetDurationSec: number;
  tone: 'energetic' | 'corporate' | 'dramatic' | 'playful' | 'minimal' | 'educational';
  visualPacing: 'fast-paced' | 'balanced' | 'cinematic-slow';
  styleReference: string;
  language: string;
  aspectRatio: MobileAspectRatio;
  fps: 24 | 30 | 60;
  destinationEditor: TargetMobileEditorId;
}

export interface ScenePlanItem {
  sceneId: string;
  sceneNumber: number;
  scriptUnitIds: string[];
  title: string;
  narrationText: string;
  visualPrompt: string;
  shotFraming: 'close-up' | 'medium-shot' | 'wide' | 'isometric-mockup' | 'screen-recording' | 'graphic-burst';
  cameraMotion: 'static' | 'pan-left' | 'pan-right' | 'zoom-in' | 'zoom-out' | 'dynamic-whip';
  motionTemplateMatch?: {
    moduleId: ModuleId;
    catalogPresetId?: string;
    rationale: string;
    compatibility: string;
  };
  soundDesignPrompt: string;
  durationSec: number;
  startSec: number;
}

export type ProposalApprovalState = 'pending-approval' | 'approved' | 'rejected' | 'modified';

export interface AiEditProposal {
  id: string;
  projectId: string;
  planVersion: number;
  status: ProposalApprovalState;
  summary: string;
  scenes: ScenePlanItem[];
  generatedCommandCount: number;
  tokenUsageEstimate: number;
  estimatedCostUsd: number;
  createdAt: string;
  approvedAt?: string;
  approvedByUid?: string;
  userModificationNotes?: string;
}

/**
 * Canonical Versioned Sowveil Timeline Schema (v3.0.0-timeline)
 */
export type TimelineTrackKind =
  | 'video'
  | 'audio'
  | 'text'
  | 'motion-graphic'
  | 'adjustment'
  | 'captions';

export interface TimelineTrack {
  id: string;
  name: string;
  kind: TimelineTrackKind;
  order: number;
  muted: boolean;
  locked: boolean;
  solo: boolean;
  opacity: number;
  blendMode: 'normal' | 'screen' | 'multiply' | 'add' | 'overlay';
}

export interface ClipTransform {
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
}

export interface TimelineKeyframe {
  timeSec: number;
  value: number | string | boolean;
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'cubic-bezier';
  curve?: [number, number, number, number];
}

export interface KeyframeTrack {
  id: string;
  clipId: string;
  propertyPath: string;
  keys: TimelineKeyframe[];
}

export interface TimelineClip {
  id: string;
  trackId: string;
  name: string;
  sourceAssetId?: string;
  catalogPresetId?: string;
  startSec: number;
  durationSec: number;
  trimInSec: number;
  trimOutSec: number;
  speed: number;
  transform: ClipTransform;
  volume: number;
  isMuted: boolean;
  customParameters: Record<string, string | number | boolean>;
}

export interface TimelineCaptionCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  speaker?: string;
  style?: {
    fontSize: number;
    colorHex: string;
    backgroundColorHex?: string;
    alignment: 'left' | 'center' | 'right';
  };
}

export interface SowveilTimelineProject {
  schemaVersion: '3.0.0-timeline';
  id: string;
  title: string;
  aspectRatio: MobileAspectRatio;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  durationSec: number;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  keyframes: KeyframeTrack[];
  captions: TimelineCaptionCue[];
  masterVolume: number;
  undoStackSize: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Reversible Command API Layer
 */
export type TimelineCommandType =
  | 'AddTrack'
  | 'RemoveTrack'
  | 'AddClip'
  | 'TrimClip'
  | 'MoveClip'
  | 'SplitClip'
  | 'SetTransform'
  | 'AddKeyframe'
  | 'SetAudioGain'
  | 'AddCaption'
  | 'RemoveCaption'
  | 'UpdateCustomParameters';

export interface BaseTimelineCommand {
  type: TimelineCommandType;
  commandId: string;
  timestamp: string;
  actorUid: string;
  reason?: string;
}

export interface AddTrackCommand extends BaseTimelineCommand {
  type: 'AddTrack';
  track: TimelineTrack;
}

export interface AddClipCommand extends BaseTimelineCommand {
  type: 'AddClip';
  clip: TimelineClip;
}

export interface TrimClipCommand extends BaseTimelineCommand {
  type: 'TrimClip';
  clipId: string;
  newStartSec: number;
  newDurationSec: number;
  newTrimInSec: number;
  newTrimOutSec: number;
}

export interface MoveClipCommand extends BaseTimelineCommand {
  type: 'MoveClip';
  clipId: string;
  targetTrackId: string;
  newStartSec: number;
}

export interface SetTransformCommand extends BaseTimelineCommand {
  type: 'SetTransform';
  clipId: string;
  transform: Partial<ClipTransform>;
}

export interface AddKeyframeCommand extends BaseTimelineCommand {
  type: 'AddKeyframe';
  clipId: string;
  propertyPath: string;
  keyframe: TimelineKeyframe;
}

export interface AddCaptionCommand extends BaseTimelineCommand {
  type: 'AddCaption';
  cue: TimelineCaptionCue;
}

export type TimelineCommand =
  | AddTrackCommand
  | AddClipCommand
  | TrimClipCommand
  | MoveClipCommand
  | SetTransformCommand
  | AddKeyframeCommand
  | AddCaptionCommand;

export interface CommandExecutionResult {
  success: boolean;
  commandId: string;
  appliedAt: string;
  undoable: boolean;
  projectSnapshot: SowveilTimelineProject;
  error?: string;
}

/**
 * Untrusted Source & Skill Manifest Contracts
 */
export interface ExternalRepoSource {
  repoUrl: string;
  commitHash: string;
  branch: string;
  license: string;
  scannedFileCount: number;
  secretPatternMatches: number;
  securityStatus: 'safe-to-index' | 'quarantined' | 'unverified';
  indexedAt: string;
}

export interface WebsiteSourceDocument {
  url: string;
  domain: string;
  fetchedAt: string;
  cleanContentText: string;
  licenseAttribution: string;
  hasPromptInjectionIndicators: boolean;
  riskScore: number;
}

export interface SkillPackageManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  allowedTools: string[];
  requiredCapabilities: string[];
  license: string;
  checksumSha256: string;
  isSandboxed: boolean;
}
