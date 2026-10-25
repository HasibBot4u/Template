import {
  CatalogItem,
  EditorCompatibilityStatus,
  ExportArtifactFormat,
  JobStatus,
  MobileAspectRatio,
  ModuleId,
  TargetMobileEditorId,
} from '../../types/sowveil';

export type BackgroundAlphaMode = 'solid' | 'transparent' | 'chroma-key-green';

export type QualityBitratePolicy = 'high-quality' | 'balanced' | 'compact-mobile';

export type AlightMotionPresetXmlStatus =
  | 'Alight Motion XML — tested subset'
  | 'Generic media pack'
  | 'Unsupported for XML export';

export interface EditorCapability {
  editorId: TargetMobileEditorId;
  supportedFileTypes: ExportArtifactFormat[];
  verifiedFileTypes: ExportArtifactFormat[];
  nativeProjectWriting: {
    supported: boolean;
    status: EditorCompatibilityStatus;
    formatExtension: string | null;
    explanation: string;
  };
  assetHandoffSupported: boolean;
  shareOpenMethods: Array<'web-share-files' | 'direct-download' | 'clipboard-steps' | 'in-app-preview'>;
  documentedVersionRequirements: string;
  regionalOrPlatformNotes: string;
  limitations: string[];
  whyNotDirectTimelineInsertion: string;
  evidence: {
    lastValidationDate: string;
    testedTargetVersions: string;
    verificationSummary: string;
  };
}

export interface ExportPreset {
  aspectRatio: MobileAspectRatio;
  width: number;
  height: number;
  fps: 24 | 30 | 60;
  durationSec: number;
  qualityPolicy: QualityBitratePolicy;
  backgroundMode: BackgroundAlphaMode;
  backgroundColorHex: string;
  outputFormat: ExportArtifactFormat;
  estimatedSizeBytes: number | null;
  performanceHints: {
    lowPowerDeviceFriendly: boolean;
    staticPreviewFallbackAvailable: boolean;
    alphaSupportedInFormat: boolean;
    chromaKeyRecommendedForAlpha: boolean;
    recommendationNote: string;
  };
}

export interface MotionDocumentLayer {
  id: string;
  name: string;
  type: 'text' | 'shape' | 'vector' | 'audio' | 'caption' | 'camera-25d' | 'effect-plate';
  inPointSec: number;
  outPointSec: number;
  transform: {
    position: [number, number];
    scale: [number, number];
    rotationDeg: number;
    anchor: [number, number];
  };
  opacity: number;
  colorHex: string;
  textContent?: string;
  easingCurve: [number, number, number, number];
  effects: Array<{
    id: string;
    type: string;
    supportedInAlightXml: boolean;
    parameters: Record<string, string | number | boolean>;
  }>;
  audioRefId?: string;
}

export interface MotionDocument {
  schemaVersion: '2.0.0';
  generator: 'Sowveil Studio Mobile Motion Engine';
  documentId: string;
  createdAt: string;
  targetEditor: TargetMobileEditorId;
  composition: {
    id: string;
    title: string;
    moduleId: ModuleId;
    aspectRatio: MobileAspectRatio;
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    backgroundMode: BackgroundAlphaMode;
    backgroundColorHex: string;
  };
  parameters: Record<string, string | number | boolean>;
  easing: {
    cubicBezier: [number, number, number, number];
  };
  layers: MotionDocumentLayer[];
  assets: Array<{
    id: string;
    role: 'primary-vector' | 'still-graphic' | 'audio-sfx' | 'caption-sidecar' | 'curve-sheet';
    fileName: string;
    mimeType: string;
    origin: 'sowveil-procedural' | 'user-local-device';
    license: string;
  }>;
  audioReferences: Array<{
    id: string;
    fileName: string;
    durationSec: number;
    sampleRateHz: number;
    channels: number;
  }>;
  unknownFields?: Record<string, unknown>;
}

export interface AssetBundleEntryMetadata {
  fileName: string;
  mimeType: string;
  role:
    | 'motion-document'
    | 'editor-native-xml'
    | 'vector-graphic'
    | 'still-png'
    | 'audio-wav'
    | 'caption-srt'
    | 'caption-vtt'
    | 'caption-json'
    | 'curve-sheet'
    | 'import-guide';
  sizeBytes: number;
  sha256: string;
  crc32Hex: string;
  license: string;
  origin: 'sowveil-procedural' | 'user-local-device';
}

export interface AssetBundleManifest {
  bundleVersion: '2.0.0';
  bundleLabel: string;
  createdAt: string;
  creationAppVersion: string;
  sourceDocument: {
    documentId: string;
    itemId: string;
    itemName: string;
    moduleId: ModuleId;
    schemaVersion: string;
  };
  targetEditor: TargetMobileEditorId;
  supportedDestinations: TargetMobileEditorId[];
  compatibilityLevel: EditorCompatibilityStatus;
  preset: {
    aspectRatio: MobileAspectRatio;
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    backgroundMode: BackgroundAlphaMode;
  };
  assets: AssetBundleEntryMetadata[];
  generatedOutputs: string[];
  warnings: string[];
  importGuideReference: string;
  importSteps: string[];
}

export interface ExportProgressEvent {
  step: 'validating' | 'building-document' | 'encoding-assets' | 'packaging' | 'verifying' | 'ready' | 'failed';
  percent: number;
  message: string;
  timestamp: string;
}

export interface ExportResultFile {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  format: ExportArtifactFormat;
  bytes: Uint8Array;
  textPreview?: string;
}

export interface ExportJob {
  id: string;
  userId: string;
  documentId: string;
  documentVersion: string;
  itemId: string;
  itemName: string;
  moduleId: ModuleId;
  destinationEditor: TargetMobileEditorId;
  requestedPreset: ExportPreset;
  capabilityStatus: EditorCompatibilityStatus;
  queueState: JobStatus;
  resultFiles: Omit<ExportResultFile, 'bytes'>[];
  progressEvents: ExportProgressEvent[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  retentionExpiresAt: string;
  failureCode?: string;
  failureMessageRedacted?: string;
  retryPolicy: {
    attemptCount: number;
    maxAttempts: number;
    canRetry: boolean;
  };
}

export interface EditorValidationResult {
  valid: boolean;
  resolvedFormat: ExportArtifactFormat;
  compatibilityStatus: EditorCompatibilityStatus;
  warnings: string[];
  errors: string[];
  fallbackFormat?: ExportArtifactFormat;
}

export interface GeneratedGatewayExport {
  adapterId: TargetMobileEditorId;
  adapterName: string;
  shortName: string;
  bundleLabel: string;
  compatibilityStatus: EditorCompatibilityStatus;
  secondaryBadge?: string;
  preset: ExportPreset;
  primaryFile: ExportResultFile;
  additionalFiles: ExportResultFile[];
  manifest: AssetBundleManifest;
  motionDocument: MotionDocument;
  importSteps: string[];
  whyNotDirectNote: string;
  validationPassed: boolean;
  validationDetails: string;
  progressEvents: ExportProgressEvent[];
}

export interface EditorAdapter {
  id: TargetMobileEditorId;
  name: string;
  shortName: string;
  platform: 'Android & iOS' | 'Android' | 'Universal Mobile Web';
  discoverCapabilities(moduleId?: ModuleId): EditorCapability;
  validateConfiguration(
    item: CatalogItem,
    preset: Partial<ExportPreset>
  ): EditorValidationResult;
  chooseExportStrategy(
    item: CatalogItem,
    requestedFormat?: ExportArtifactFormat
  ): ExportArtifactFormat;
  generateExport(params: {
    item: CatalogItem;
    preset?: Partial<ExportPreset>;
    customValues?: Record<string, string | number | boolean>;
  }): GeneratedGatewayExport;
  validateOutput(file: ExportResultFile): { valid: boolean; reason: string };
  getHandoffStrategy(): {
    prefersWebShareFiles: boolean;
    supportsDirectDownload: boolean;
    supportsInAppPreview: boolean;
  };
  getImportGuide(format: ExportArtifactFormat, aspectRatio: MobileAspectRatio): {
    headline: string;
    steps: string[];
    versionAndRegionNotes: string;
    whyNotDirectTimelineInsertion: string;
  };
  mapError(error: unknown): {
    code: string;
    userMessage: string;
    recoverable: boolean;
    suggestedFallbackFormat: ExportArtifactFormat;
  };
}
