export type UserRole = 'user' | 'admin' | 'owner';

export type AccountStatus = 'active' | 'suspended' | 'pending';

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

export type AuthErrorState =
  | null
  | {
      code:
        | 'popup-blocked'
        | 'popup-cancelled'
        | 'invalid-session'
        | 'permission-denied'
        | 'unverified-email'
        | 'network-error'
        | 'unknown';
      title: string;
      message: string;
    };

export type CapabilityStatus =
  | 'Available'
  | 'Needs setup'
  | 'Disconnected'
  | 'Unsupported'
  | 'Failed'
  | 'Not yet implemented';

export type ModuleId =
  | 'text-animation'
  | 'expressions'
  | 'easing'
  | 'sfx'
  | 'ready-made'
  | 'ui-saas'
  | 'liquid-glass'
  | 'carousel'
  | 'transitions'
  | '3d-models'
  | 'mockups'
  | 'logo-reveals'
  | 'backgrounds'
  | 'overlays-fx'
  | 'maps'
  | 'saas-effects'
  | 'templates'
  | 'auto-captions'
  | 'downloader'
  | 'project-library';

export type CapabilityType =
  | 'text-preset'
  | 'expression-preset'
  | 'easing-curve'
  | 'sfx-audio'
  | 'comp-template'
  | 'liquid-glass-effect'
  | 'carousel-builder'
  | 'transition-template'
  | 'render-asset'
  | 'mockup-template'
  | 'logo-reveal'
  | 'background-generator'
  | 'overlay-fx'
  | 'map-route'
  | 'saas-effect'
  | 'caption-utility'
  | 'media-downloader'
  | 'project-manager';

export type AssetKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'ae-project'
  | 'ae-template'
  | 'svg'
  | 'model3d'
  | 'scene-spec'
  | 'expression'
  | 'curve';

export type HostOperationName =
  | 'getHostStatus'
  | 'getProjectSummary'
  | 'getActiveCompSummary'
  | 'listSelectedLayers'
  | 'applyTextAnimation'
  | 'applyExpressionPreset'
  | 'applyEasingPreset'
  | 'importAndAddAudio'
  | 'insertTemplateComp'
  | 'openTemplateAsComp'
  | 'buildCarousel'
  | 'addGlassPanel'
  | 'applySaaSEffect'
  | 'importAllowedFootage'
  | 'queueRender'
  | 'getOperationResult';

export interface ModuleDefinition {
  id: ModuleId;
  label: string;
  shortLabel?: string;
  icon: string;
  description: string;
  route: string;
  capabilityType: CapabilityType;
  enabled: boolean;
  requiresDesktop: boolean;
  requiresNetwork: boolean;
  requiresLocalDependency: boolean;
  localDependencies?: string[];
  displayOrder: number;
  permissions: UserRole[];
  referenceReportedCount?: number;
  referenceDiscrepancyNote?: string;
  integrationAvailabilityMessage?: string;
  workspaceKind: 'catalog' | 'auto-captions' | 'downloader' | 'project-library';
}

export interface CategoryFilter {
  id: string;
  moduleId: ModuleId;
  label: string;
  slug: string;
  order: number;
  referenceCount?: number;
}

export type PreviewRenderKind =
  | 'text-rise-up'
  | 'text-soft-focus'
  | 'text-pop'
  | 'text-slide-in'
  | 'text-decode'
  | 'text-shine'
  | 'text-cyber-security'
  | 'text-ge-title'
  | 'text-modern-title'
  | 'expression-wiggle'
  | 'expression-sine-wave'
  | 'expression-bounce'
  | 'expression-loop-out'
  | 'expression-spin'
  | 'easing-curve'
  | 'sfx-waveform'
  | 'ready-made-ai-switcher'
  | 'ready-made-folder-scene'
  | 'ready-made-follower-notif'
  | 'ui-saas-gift'
  | 'ui-saas-notif'
  | 'ui-saas-widget'
  | 'ui-saas-keyboard'
  | 'liquid-glass-panel'
  | 'liquid-glass-social'
  | 'liquid-glass-card'
  | 'carousel-builder'
  | 'carousel-sphere'
  | 'transition-vertical-glow'
  | 'model3d-glossy-shape'
  | 'mockup-laptop-phone'
  | 'logo-camera-reveal'
  | 'logo-retrowave'
  | 'background-gradient-builder'
  | 'background-dynamic-grid'
  | 'overlay-retro-shape'
  | 'overlay-sci-fi-screen'
  | 'overlay-pixel-burst'
  | 'map-location-marker'
  | 'map-route-widget'
  | 'saas-splash-click'
  | 'saas-depth-reveal'
  | 'saas-cursor-click'
  | 'template-motion-card';

export interface EditableTemplateParam {
  key: string;
  label: string;
  type: 'text' | 'number' | 'color' | 'select' | 'boolean';
  defaultValue: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  unit?: string;
}

export type TargetMobileEditorId =
  | 'capcut'
  | 'alight-motion'
  | 'node-video'
  | 'kinemaster'
  | 'sowveil-project'
  | 'universal-bundle';

export type EditorCompatibilityStatus =
  | 'Verified'
  | 'Tested subset'
  | 'Experimental'
  | 'Media handoff only'
  | 'Needs target-app validation'
  | 'Unsupported';

export type MobileAspectRatio = '9:16' | '1:1' | '16:9';

export type ExportArtifactFormat =
  | 'sowveil-json'
  | 'alight-xml'
  | 'zip-bundle'
  | 'svg-frame'
  | 'png-still'
  | 'wav-audio'
  | 'srt-captions'
  | 'vtt-captions'
  | 'json-captions'
  | 'webm-video';

export interface CatalogItem {
  id: string;
  moduleId: ModuleId;
  name: string;
  slug: string;
  summary: string;
  description: string;
  tags: string[];
  categoryId: string;
  packLabel: string;
  assetKind: AssetKind;
  capabilityType: CapabilityType;
  previewKind: PreviewRenderKind;
  metadata: {
    width?: number;
    height?: number;
    durationSec?: number;
    durationLabel?: string;
    fps?: number;
    version: string;
    fileSizeBytes?: number;
    signature?: string;
    curvePoints?: [number, number, number, number];
    audioAssetAvailable?: boolean;
    localFolderHint?: string;
  };
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  supportedOperations: HostOperationName[];
  supportedExportFormats?: ExportArtifactFormat[];
  editorCompatibilityMap?: Partial<Record<TargetMobileEditorId, EditorCompatibilityStatus>>;
  favoritesCompatible?: boolean;
  requiredHostCapabilities: string[];
  requiredDependencies: string[];
  selectionRequirement: string;
  status: CapabilityStatus;
  statusReason: string;
  licenseType: 'Original Demo Specification' | 'Reference Metadata Only' | 'User Owned';
  licenseNote: string;
  sourceType: 'original-svg-css' | 'procedural-canvas' | 'reference-seed';
  visibility: 'published' | 'draft' | 'archived';
  supportsTemplateComparison: boolean;
  editableParams?: EditableTemplateParam[];
  createdAt: string;
  updatedAt: string;
}

export type ProjectFileStatus =
  | 'sowveil-native'
  | 'alight-motion-xml'
  | 'media-bundle'
  | 'metadata-only'
  | 'uploaded'
  | 'linked-local'
  | 'packaged';

export interface MobileEditorAdapterDescriptor {
  id: TargetMobileEditorId;
  name: string;
  shortName: string;
  platform: 'Android & iOS' | 'Android' | 'Universal Mobile Web';
  compatibilityStatus: EditorCompatibilityStatus;
  secondaryValidationBadge?: EditorCompatibilityStatus;
  defaultExportFormat: ExportArtifactFormat;
  supportedFormats: ExportArtifactFormat[];
  verifiedFormats?: ExportArtifactFormat[];
  testedVersions?: string;
  docsUrl?: string;
  lastValidationDate?: string;
  verificationNote?: string;
  approvedByUid?: string;
  supportedModules: ModuleId[];
  honestCapabilitySummary: string;
  limitationsNote: string;
  importSteps: string[];
}

export interface AssetMetadataRecord {
  id: string;
  title: string;
  moduleId: ModuleId;
  catalogItemId?: string;
  assetKind: AssetKind;
  ownerUid: string;
  licenseType: 'Original Demo Specification' | 'Reference Metadata Only' | 'User Owned';
  licenseNote: string;
  sourceNote: string;
  storageProvider: 'none-configured' | 'cloud-storage';
  storageObjectKey: string | null;
  mimeType: string;
  sizeBytes: number | null;
  status: 'metadata-only' | 'stored' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface PlatformSettingsConfig {
  exportMaxSizeMb: number;
  userDailyExportQuota: number;
  jobRetentionDays: number;
  archivedCatalogRetentionDays: number;
  allowPublicCatalogBrowsing: boolean;
  enableAlightMotionXmlExport: boolean;
  enableUniversalZipBundles: boolean;
  enableWebShareHandoff: boolean;
  maintenanceBannerText: string;
  integrationStatusHeadline: string;
  analyticsProviderStatus: 'Not configured' | 'Configured';
  updatedAt: string;
  updatedByUid: string;
}

export interface ProjectCheckpointRecord {
  id: string;
  label: string;
  createdAt: string;
  sowveilSpecJson: string;
  targetEditor?: TargetMobileEditorId;
  aspectRatio?: MobileAspectRatio;
}

export interface ProjectLibraryItem {
  id: string;
  ownerUid?: string;
  title: string;
  description: string;
  compCount: number | null;
  projectFileStatus: ProjectFileStatus;
  fileSizeBytes: number | null;
  fileSizeLabel: string;
  resolution?: string;
  durationLabel?: string;
  fps?: number;
  aeVersion?: string;
  targetEditor?: TargetMobileEditorId;
  aspectRatio?: MobileAspectRatio;
  sowveilSpecJson?: string;
  checkpoints?: ProjectCheckpointRecord[];
  hasExternalFootageWarning: boolean;
  archived?: boolean;
  createdAt?: string;
  updatedAt: string;
  lastOpenedAt?: string;
  tags: string[];
}

export interface CompanionState {
  status: 'Disconnected' | 'Connected' | 'Needs setup';
  pairedDeviceName: string | null;
  aeActiveComp: string | null;
  selectedLayersCount: number;
  selectedLayerType: 'none' | 'text' | 'av' | 'shape' | 'camera';
  connectorVersion: string | null;
  hostVersion: string | null;
  lastSeenAt: string | null;
  autoRunEnabled: boolean;
  dependencies: {
    python: { installed: boolean; version: string | null };
    whisper: { installed: boolean; model: string | null };
    ffmpeg: { installed: boolean; version: string | null };
    ytDlp: { installed: boolean; version: string | null };
    depthAnythingV2: { installed: boolean; modelSizeMb: number; verified: boolean };
  };
}

export type JobStatus =
  | 'draft'
  | 'queued'
  | 'uploading'
  | 'claimed'
  | 'running'
  | 'finalizing'
  | 'ready'
  | 'downloaded'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'needs-setup'
  | 'quota-reached'
  | 'expired';

export interface JobRecord {
  id: string;
  ownerUid?: string;
  type: 'mobile-export' | 'ae-operation' | 'caption' | 'download' | 'asset-process';
  title: string;
  moduleId: ModuleId;
  itemId?: string;
  operation?: HostOperationName;
  targetEditor?: TargetMobileEditorId;
  exportFormat?: ExportArtifactFormat;
  aspectRatio?: MobileAspectRatio;
  outputFileName?: string;
  outputMimeType?: string;
  outputSizeBytes?: number;
  processedBytes?: number;
  totalBytes?: number;
  completedStageIndex?: number;
  totalStages?: number;
  stageLabel?: string;
  progressPercent?: number;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attemptCount: number;
  idempotencyKey: string;
  deviceId: string | null;
  errorCode?: string;
  redactedMessage: string;
  requestId: string;
}

export interface DeviceRecord {
  id: string;
  ownerUid: string;
  deviceName: string;
  platform: 'Android' | 'iOS' | 'macOS' | 'Windows' | 'Linux';
  status: 'active' | 'revoked';
  connectorVersion?: string;
  hostVersion?: string;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AuditTargetType =
  | 'catalog'
  | 'module'
  | 'asset'
  | 'user'
  | 'role'
  | 'editor-adapter'
  | 'settings'
  | 'job'
  | 'auth'
  | 'system';

export type AuditOutcome = 'success' | 'denied' | 'error';

export interface AuditEventRecord {
  id: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  targetType?: AuditTargetType;
  targetId: string;
  outcome?: AuditOutcome;
  detailsRedacted: string;
  requestId: string;
  createdAt: string;
}

export interface UserPreferences {
  reducedMotion: boolean;
  defaultSortOrder: 'name' | 'newest' | 'favorites';
  preserveSearchOnModuleSwitch: boolean;
}

export interface ApiSuccessEnvelope<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export type ApiResponseEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;
