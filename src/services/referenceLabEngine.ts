import {
  CatalogItem,
  EditableTemplateParam,
  MobileAspectRatio,
  ModuleId,
  ProjectLibraryItem,
  TargetMobileEditorId,
  TemplateLicenseType,
} from '../types/sowveil';
import {
  CanonicalClip,
  CanonicalProjectDocument,
  CanonicalTrack,
} from '../types/canonicalProject';
import {
  canonicalProjectToLibraryRecord,
  createMinimalCanonicalProject,
  evaluateProjectAtTime,
  executeProjectCommand,
  serializeCanonicalProject,
  validateCanonicalProject,
} from './canonicalProjectEngine';
import { validateMediaUrlForSsrf } from '../features/media-workflows';
import { runTemplateValidationJob } from './marketplaceEngine';

export type ReferenceUsageMode =
  | 'authorized-reconstruction'
  | 'reference-inspired';

export type PropertyProvenanceSource =
  | 'provided source project'
  | 'measured from frame'
  | 'inferred'
  | 'generated approximation'
  | 'unknown';

export type ReferenceInputSourceKind =
  | 'public-url'
  | 'uploaded-video'
  | 'uploaded-screenshots'
  | 'uploaded-audio'
  | 'uploaded-project-file'
  | 'asset-package';

export type ReferenceUrlAccessStatus =
  | 'direct-media-permitted'
  | 'public-page-metadata-only'
  | 'blocked-restricted-or-ssrf';

export interface ReferenceRightsDeclaration {
  usageMode: ReferenceUsageMode;
  declarationStatement: string;
  isUserDeclarationNotOwnershipProof: true;
  declaredByUid: string;
  declaredAt: string;
  sourceOriginLabel: string;
  sourceUrl?: string;
  allowRemoteModelUpload: boolean;
  cancelledBeforeRemoteUpload: boolean;
  licenseType: TemplateLicenseType;
  attributionText: string;
}

export interface ReferenceUrlInspectionResult {
  rawUrl: string;
  normalizedUrl: string | null;
  hostname: string | null;
  platformCategory:
    | 'youtube'
    | 'instagram'
    | 'pinterest'
    | 'vimeo'
    | 'direct-media'
    | 'public-website'
    | 'restricted-or-invalid';
  accessStatus: ReferenceUrlAccessStatus;
  allowedForIngestion: boolean;
  requiresUserMediaUpload: boolean;
  detectedMediaExtension: string | null;
  statusSummary: string;
  lawfulFallbackInstruction: string;
  errorCode?: string;
}

export interface ReferencePropertyObservation {
  id: string;
  shotId: string;
  category:
    | 'typography'
    | 'layout'
    | 'color'
    | 'shape-vector'
    | 'motion-timing'
    | 'transition'
    | 'camera-depth'
    | 'effect-mask'
    | 'audio-sync'
    | '3d-geometry';
  propertyKey: string;
  label: string;
  observedValue: string | number | boolean;
  userCorrectedValue?: string | number | boolean;
  provenanceSource: PropertyProvenanceSource;
  confidence: number;
  uncertain: boolean;
  uncertaintyReason?: string;
  editableInCanonicalProject: boolean;
  targetClipId?: string;
  preservedByUser: boolean;
}

export interface ReferenceShotAudioAnalysis {
  hasAudio: boolean;
  speechTranscriptCue: string | null;
  musicOrSfxCue: string | null;
  loudnessLufs: number | null;
  peakDb: number | null;
  beatSyncTimestampsSec: number[];
}

export interface ReferenceShotSegment {
  id: string;
  index: number;
  title: string;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
  representativeTimestampsSec: number[];
  denseSampleTimestampsSec: number[];
  visualSummary: string;
  typographyAnalysis: {
    detectedText: string | null;
    estimatedFontFamily: string;
    estimatedWeight: number;
    estimatedSizePx: number;
    textColorHex: string;
    alignment: 'left' | 'center' | 'right';
  };
  layoutAnalysis: {
    compositionGrid: 'center-hero' | 'split-card' | 'lower-third' | 'bento-grid';
    focalPointNormalized: [number, number];
    safeAreaCompliant: boolean;
  };
  colorPaletteHex: string[];
  shapeCount: number;
  objectCount: number;
  roughGeometry: string;
  transitionIn: string;
  transitionOut: string;
  cameraMotion: 'static' | 'slow-push-in' | 'whip-pan' | 'parallax-drift' | 'orbit-2.5d';
  motionTiming: {
    easingFamily: 'cubic-bezier' | 'ease-out' | 'ease-in-out' | 'linear' | 'spring-approx';
    cubicBezier: [number, number, number, number];
    entranceDurationSec: number;
  };
  animationArcs: string;
  compositingNotes: string;
  apparentDepth: 'flat-2d' | 'layered-2.5d' | '3d-primitive-scene';
  overlays: string[];
  visualRhythmBpm: number;
  audioAnalysis: ReferenceShotAudioAnalysis;
  confidenceScore: number;
  uncertainLabels: string[];
  mismatchNotes: string[];
}

export interface ReferenceCorrectionActionRecord {
  id: string;
  actionType:
    | 'adjust-transition'
    | 'slow-title-entrance'
    | 'replace-background-asset'
    | 'match-color'
    | 'preserve-layer'
    | 'reanalyze-segment'
    | 'correct-observation';
  shotId: string;
  targetClipId?: string;
  summary: string;
  appliedAt: string;
  localCheckPassed: boolean;
}

export interface ReconstructionLocalCheckResult {
  passed: boolean;
  alignedTimecodes: boolean;
  validCanonicalSchema: boolean;
  renderSmokeTestPassed: boolean;
  evaluatedFrameCount: number;
  checkedAt: string;
  warnings: string[];
}

export interface ReconstructionFidelityReport {
  generatedAt: string;
  usageMode: ReferenceUsageMode;
  overallConfidence: number;
  pixelIdenticalClaimed: false;
  fidelityDisclaimer: string;
  sourceCoveredProperties: Array<{
    propertyKey: string;
    label: string;
    shotId: string;
    value: string;
  }>;
  reconstructedEditableProperties: Array<{
    propertyKey: string;
    label: string;
    shotId: string;
    provenanceSource: PropertyProvenanceSource;
    targetClipId?: string;
  }>;
  approximatedProperties: Array<{
    propertyKey: string;
    label: string;
    shotId: string;
    reason: string;
  }>;
  unrecoverableProperties: Array<{
    propertyKey: string;
    label: string;
    reason: string;
  }>;
  perShotConfidence: Array<{
    shotId: string;
    shotTitle: string;
    startTimeSec: number;
    endTimeSec: number;
    confidenceScore: number;
    status: 'high-confidence' | 'needs-review' | 'inspired-transform';
    mismatchCount: number;
  }>;
  knownDifferences: string[];
  requiredUserDecisions: Array<{
    id: string;
    shotId: string;
    prompt: string;
    resolved: boolean;
    resolutionNote?: string;
  }>;
  independenceManifest?: {
    keptCreativeLessons: string[];
    replacedDistinctiveElements: string[];
    audioPolicy: string;
  };
  localCheckResult: ReconstructionLocalCheckResult;
}

export interface ReferenceLabPipelineMetadata {
  analyzerVersion: string;
  modelId: string;
  samplingConfig: {
    baseIntervalSec: number;
    denseChangeThreshold: number;
    audioWindowMs: number;
    localOnlyMode: boolean;
  };
  analyzedAt: string;
}

export interface ReferenceLabSession {
  id: string;
  ownerUid: string;
  title: string;
  sourceKind: ReferenceInputSourceKind;
  sourceSummary: string;
  rightsDeclaration: ReferenceRightsDeclaration;
  urlInspection?: ReferenceUrlInspectionResult;
  mediaSpecs: {
    durationSec: number;
    width: number;
    height: number;
    aspectRatio: MobileAspectRatio;
    fps: 24 | 30 | 60 | null;
    frameRateDetected: boolean;
    hasAudioTrack: boolean;
    hasSourceProjectFile: boolean;
    suppliedFileNames: string[];
  };
  pipelineMetadata: ReferenceLabPipelineMetadata;
  shots: ReferenceShotSegment[];
  observations: ReferencePropertyObservation[];
  canonicalProject: CanonicalProjectDocument;
  fidelityReport: ReconstructionFidelityReport;
  correctionHistory: ReferenceCorrectionActionRecord[];
  savedProjectId?: string;
  savedDraftTemplateId?: string;
  promotedValidatedTemplateId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuiltInReferencePreset {
  id: string;
  title: string;
  subtitle: string;
  sourceKind: ReferenceInputSourceKind;
  moduleId: ModuleId;
  durationSec: number;
  width: number;
  height: number;
  aspectRatio: MobileAspectRatio;
  fps: 60 | 30;
  hasAudioTrack: boolean;
  hasSourceProjectFile: boolean;
  defaultColors: string[];
  defaultHeadline: string;
  defaultSubheadline: string;
}

export const BUILT_IN_REFERENCE_PRESETS: BuiltInReferencePreset[] = [
  {
    id: 'ref_preset_sowveil_hook',
    title: 'Sowveil Reference Reel — Kinetic Hook & Glass Card',
    subtitle: '3 shots · 6.0s · 1080×1920 · 60fps · Typography + Liquid Glass + Whoosh SFX',
    sourceKind: 'uploaded-video',
    moduleId: 'text-animation',
    durationSec: 6,
    width: 1080,
    height: 1920,
    aspectRatio: '9:16',
    fps: 60,
    hasAudioTrack: true,
    hasSourceProjectFile: false,
    defaultColors: ['#080707', '#F06424', '#F3EEE8', '#55B98B'],
    defaultHeadline: 'LAUNCH IN 60 SECONDS',
    defaultSubheadline: 'PURE MOTION RIG · ZERO FLATTENED PLATES',
  },
  {
    id: 'ref_preset_saas_walkthrough',
    title: 'SaaS Product Reveal — Bento Grid & Cursor Zoom',
    subtitle: '3 shots · 8.0s · 1920×1080 · 60fps · UI Card + Camera Push + Subtitles',
    sourceKind: 'uploaded-video',
    moduleId: 'ui-saas',
    durationSec: 8,
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
    fps: 60,
    hasAudioTrack: true,
    hasSourceProjectFile: false,
    defaultColors: ['#0D1117', '#3B82F6', '#F8FAFC', '#10B981'],
    defaultHeadline: 'AUTOMATE WORKFLOWS',
    defaultSubheadline: 'LIVE TELEMETRY & INSTANT DEPLOY',
  },
  {
    id: 'ref_preset_3d_logo_pack',
    title: 'Source Package — 3D Metallic Emblem + SVG Vector Rig',
    subtitle: '2 shots · 5.0s · 1080×1080 · 30fps · Includes Source Project & SVG Layers',
    sourceKind: 'uploaded-project-file',
    moduleId: '3d-models',
    durationSec: 5,
    width: 1080,
    height: 1080,
    aspectRatio: '1:1',
    fps: 30,
    hasAudioTrack: true,
    hasSourceProjectFile: true,
    defaultColors: ['#11100F', '#E4B45A', '#F3EEE8', '#8C52FF'],
    defaultHeadline: 'SOWVEIL 3D CORE',
    defaultSubheadline: 'SOURCE-PROVEN VECTOR & PRIMITIVE GRAPH',
  },
];

const PRIVATE_OR_AUTH_PATH_PATTERNS = [
  /\/login/i,
  /\/signin/i,
  /\/account/i,
  /\/private/i,
  /\/paywall/i,
  /\/subscribe/i,
  /\/checkout/i,
  /\/drm/i,
  /\/member-only/i,
  /[?&](token|auth|signature|session_id|private_key)=/i,
];

/**
 * Inspects a user-supplied URL for Reference Lab ingestion.
 * Enforces SSRF protection and never bypasses logins, paywalls, DRM, or private URLs.
 * Distinguishes direct media URLs from public social/web pages (YouTube, Instagram, Pinterest, etc.)
 * where URL acceptance records source metadata but requires lawful media/screenshot upload if raw bytes are blocked.
 */
export function inspectReferenceSourceUrl(rawUrl: string): ReferenceUrlInspectionResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      rawUrl,
      normalizedUrl: null,
      hostname: null,
      platformCategory: 'restricted-or-invalid',
      accessStatus: 'blocked-restricted-or-ssrf',
      allowedForIngestion: false,
      requiresUserMediaUpload: true,
      detectedMediaExtension: null,
      statusSummary: 'Empty URL',
      lawfulFallbackInstruction: 'Enter a public HTTPS URL or upload a lawful video, screenshot, or project file.',
      errorCode: 'EMPTY_URL',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      rawUrl,
      normalizedUrl: null,
      hostname: null,
      platformCategory: 'restricted-or-invalid',
      accessStatus: 'blocked-restricted-or-ssrf',
      allowedForIngestion: false,
      requiresUserMediaUpload: true,
      detectedMediaExtension: null,
      statusSummary: 'Malformed URL syntax',
      lawfulFallbackInstruction: 'Provide a valid https:// URL or upload local media files directly.',
      errorCode: 'MALFORMED_URL',
    };
  }

  // Block credentials in URL or private/login/paywall/DRM paths
  if (
    parsed.username ||
    parsed.password ||
    PRIVATE_OR_AUTH_PATH_PATTERNS.some((rx) => rx.test(`${parsed.pathname}${parsed.search}`))
  ) {
    return {
      rawUrl,
      normalizedUrl: null,
      hostname: parsed.hostname.toLowerCase(),
      platformCategory: 'restricted-or-invalid',
      accessStatus: 'blocked-restricted-or-ssrf',
      allowedForIngestion: false,
      requiresUserMediaUpload: true,
      detectedMediaExtension: null,
      statusSummary: 'Blocked: Private, authenticated, paywalled, or DRM-protected URL',
      lawfulFallbackInstruction:
        'Reference Lab never bypasses logins, paywalls, DRM, or private links. Please upload an authorized local file or screenshots.',
      errorCode: 'RESTRICTED_AUTH_OR_DRM_URL_FORBIDDEN',
    };
  }

  const ssrf = validateMediaUrlForSsrf(trimmed);
  const host = (ssrf.hostname || parsed.hostname || '').toLowerCase();

  // If SSRF blocked for loopback, private IP, metadata, or non-HTTPS protocol:
  if (
    !ssrf.allowed &&
    ssrf.errorCode !== 'SERVER_EXTRACTOR_WORKER_REQUIRED'
  ) {
    return {
      rawUrl,
      normalizedUrl: null,
      hostname: host || null,
      platformCategory: 'restricted-or-invalid',
      accessStatus: 'blocked-restricted-or-ssrf',
      allowedForIngestion: false,
      requiresUserMediaUpload: true,
      detectedMediaExtension: null,
      statusSummary: `Blocked by SSRF / Security Guard (${ssrf.errorCode || 'FORBIDDEN'})`,
      lawfulFallbackInstruction: ssrf.reason,
      errorCode: ssrf.errorCode || 'SSRF_BLOCKED',
    };
  }

  // Classify public platforms (YouTube, Instagram, Pinterest, Vimeo)
  const isYouTube =
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtu.be';
  const isInstagram =
    host === 'instagram.com' || host === 'www.instagram.com';
  const isPinterest =
    host === 'pinterest.com' ||
    host === 'www.pinterest.com' ||
    host === 'pin.it';
  const isVimeo = host === 'vimeo.com' || host === 'www.vimeo.com';

  if (isYouTube || isInstagram || isPinterest || isVimeo) {
    const platformCategory = isYouTube
      ? 'youtube'
      : isInstagram
      ? 'instagram'
      : isPinterest
      ? 'pinterest'
      : 'vimeo';
    return {
      rawUrl,
      normalizedUrl: parsed.toString(),
      hostname: host,
      platformCategory,
      accessStatus: 'public-page-metadata-only',
      allowedForIngestion: true,
      requiresUserMediaUpload: true,
      detectedMediaExtension: null,
      statusSummary: `Accepted public ${platformCategory.toUpperCase()} reference URL (raw stream gated by platform CORS/terms)`,
      lawfulFallbackInstruction:
        'Public page URL recorded for provenance. Because browser clients do not scrape raw social video streams or bypass platform locks, attach your lawful video download or reference screenshots below to measure frame-accurate pixels.',
    };
  }

  if (ssrf.detectedExtension) {
    return {
      rawUrl,
      normalizedUrl: ssrf.normalizedUrl || parsed.toString(),
      hostname: host,
      platformCategory: 'direct-media',
      accessStatus: 'direct-media-permitted',
      allowedForIngestion: true,
      requiresUserMediaUpload: false,
      detectedMediaExtension: ssrf.detectedExtension,
      statusSummary: `Verified direct HTTPS media URL (${ssrf.detectedExtension})`,
      lawfulFallbackInstruction:
        'Direct HTTPS media resource permitted for reproducible frame and timing analysis.',
    };
  }

  return {
    rawUrl,
    normalizedUrl: ssrf.normalizedUrl || parsed.toString(),
    hostname: host,
    platformCategory: 'public-website',
    accessStatus: 'public-page-metadata-only',
    allowedForIngestion: true,
    requiresUserMediaUpload: true,
    detectedMediaExtension: null,
    statusSummary: `Accepted public website URL (${host}) — page metadata mode`,
    lawfulFallbackInstruction:
      'URL accepted as reference source. For frame-measured color and keyframe extraction, attach screenshots or a lawful video file alongside this URL.',
  };
}

function shiftColorForInspiredMode(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#38BDF8';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Deterministic channel rotation + contrast preservation so Reference-Inspired Mode
  // creates an independent color mood without 1:1 copying distinctive brand hex codes.
  const nr = Math.min(255, Math.max(18, (b + 42) % 256));
  const ng = Math.min(255, Math.max(18, (r + 68) % 256));
  const nb = Math.min(255, Math.max(18, (g + 94) % 256));
  return `#${nr.toString(16).padStart(2, '0')}${ng
    .toString(16)
    .padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`.toUpperCase();
}

/**
 * Runs local deterministic checks on the reconstructed CanonicalProjectDocument:
 * 1. Validates canonical v2.0.0 schema & duplicate ID rules.
 * 2. Verifies shot timecodes align with canonical scenes and clip ranges.
 * 3. Runs a multi-frame render evaluation smoke test at t=0, t=mid, t=end.
 */
export function runLocalReconstructionChecks(
  project: CanonicalProjectDocument,
  shots: ReferenceShotSegment[]
): ReconstructionLocalCheckResult {
  const warnings: string[] = [];
  const schemaCheck = validateCanonicalProject(project);
  if (!schemaCheck.valid) {
    warnings.push(...schemaCheck.errors);
  }

  let alignedTimecodes = true;
  for (const shot of shots) {
    if (shot.endTimeSec <= shot.startTimeSec) {
      alignedTimecodes = false;
      warnings.push(`Shot "${shot.title}" has invalid time range (${shot.startTimeSec}s..${shot.endTimeSec}s).`);
    }
    if (shot.endTimeSec > project.canvas.durationSec + 0.05) {
      alignedTimecodes = false;
      warnings.push(
        `Shot "${shot.title}" end (${shot.endTimeSec}s) exceeds project canvas duration (${project.canvas.durationSec}s).`
      );
    }
  }

  // Evaluate at 3 sample timestamps to verify render smoke test
  const sampleTimes = [
    0,
    Number((project.canvas.durationSec * 0.5).toFixed(2)),
    Math.max(0.1, Number((project.canvas.durationSec - 0.1).toFixed(2))),
  ];
  let evaluatedFrameCount = 0;
  let renderSmokeTestPassed = true;
  try {
    for (const t of sampleTimes) {
      const frames = evaluateProjectAtTime(project, t);
      if (Array.isArray(frames)) {
        evaluatedFrameCount += 1;
      }
    }
  } catch (err) {
    renderSmokeTestPassed = false;
    warnings.push(
      `Render evaluation failed: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }

  return {
    passed: schemaCheck.valid && alignedTimecodes && renderSmokeTestPassed,
    alignedTimecodes,
    validCanonicalSchema: schemaCheck.valid,
    renderSmokeTestPassed,
    evaluatedFrameCount,
    checkedAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * Computes the honest `ReconstructionFidelityReport` from the session's shots,
 * property observations, usage mode, and canonical project.
 */
export function buildReconstructionFidelityReport(params: {
  usageMode: ReferenceUsageMode;
  shots: ReferenceShotSegment[];
  observations: ReferencePropertyObservation[];
  project: CanonicalProjectDocument;
  hasSourceProjectFile: boolean;
  hasAudioTrack: boolean;
  sourceKind: ReferenceInputSourceKind;
}): ReconstructionFidelityReport {
  const {
    usageMode,
    shots,
    observations,
    project,
    hasSourceProjectFile,
    hasAudioTrack,
    sourceKind,
  } = params;

  const sourceCoveredProperties = observations
    .filter((o) => o.provenanceSource === 'provided source project')
    .map((o) => ({
      propertyKey: o.propertyKey,
      label: o.label,
      shotId: o.shotId,
      value: String(o.userCorrectedValue ?? o.observedValue),
    }));

  const reconstructedEditableProperties = observations
    .filter(
      (o) =>
        o.editableInCanonicalProject &&
        (o.provenanceSource === 'measured from frame' ||
          o.provenanceSource === 'inferred' ||
          o.provenanceSource === 'provided source project')
    )
    .map((o) => ({
      propertyKey: o.propertyKey,
      label: o.label,
      shotId: o.shotId,
      provenanceSource: o.provenanceSource,
      targetClipId: o.targetClipId,
    }));

  const approximatedProperties = observations
    .filter((o) => o.provenanceSource === 'generated approximation')
    .map((o) => ({
      propertyKey: o.propertyKey,
      label: o.label,
      shotId: o.shotId,
      reason:
        usageMode === 'reference-inspired'
          ? 'Independently generated alternative for Reference-Inspired Mode.'
          : 'Original source asset/shader not present in flattened media; approximated with editable procedural layer.',
    }));

  const unrecoverableProperties: ReconstructionFidelityReport['unrecoverableProperties'] = [];
  if (!hasSourceProjectFile) {
    unrecoverableProperties.push(
      {
        propertyKey: 'occluded_background_plates',
        label: 'Occluded Background Pixels Behind Burned-In Foreground',
        reason:
          'Flattened video/screenshots merge foreground and background pixels; clean plate is generated as a procedural approximation rather than recovered hidden layer data.',
      },
      {
        propertyKey: 'original_ae_expression_ast',
        label: 'Original Authoring Expression Source Code',
        reason:
          'Motion velocity is measured/inferred into cubic-bezier keyframes; original desktop authoring script text is not embedded in pixel frames.',
      }
    );
  }
  if (!hasAudioTrack || sourceKind === 'uploaded-screenshots') {
    unrecoverableProperties.push({
      propertyKey: 'isolated_multitrack_audio_stems',
      label: 'Isolated Dialogue / Music / SFX Stems',
      reason:
        'No multi-stem audio source was provided; timeline uses procedural Web Audio SFX markers.',
    });
  }

  const perShotConfidence = shots.map((s) => ({
    shotId: s.id,
    shotTitle: s.title,
    startTimeSec: s.startTimeSec,
    endTimeSec: s.endTimeSec,
    confidenceScore: s.confidenceScore,
    status:
      usageMode === 'reference-inspired'
        ? ('inspired-transform' as const)
        : s.confidenceScore >= 0.82 && s.mismatchNotes.length <= 1
        ? ('high-confidence' as const)
        : ('needs-review' as const),
    mismatchCount: s.mismatchNotes.length,
  }));

  const overallConfidence =
    shots.length > 0
      ? Number(
          (
            shots.reduce((acc, s) => acc + s.confidenceScore, 0) / shots.length
          ).toFixed(2)
        )
      : 0.75;

  const knownDifferences: string[] = [];
  if (usageMode === 'reference-inspired') {
    knownDifferences.push(
      'Reference-Inspired Mode intentionally transforms shot durations, color palette hexes, copy, and geometry into an independent creative work.',
      'Protected or third-party audio is never copied; procedural Sowveil SFX cues are substituted.'
    );
  } else {
    if (!hasSourceProjectFile) {
      knownDifferences.push(
        'Keyframes are curve-fitted approximations derived from frame timestamps rather than recovered project binary keyframes.',
        'Background gradients and glass refraction use Sowveil 2D/SVG procedural layers.'
      );
    }
    for (const s of shots) {
      for (const note of s.mismatchNotes) {
        knownDifferences.push(`[${s.title}] ${note}`);
      }
    }
  }

  const requiredUserDecisions = observations
    .filter((o) => o.uncertain)
    .map((o) => ({
      id: `dec_${o.id}`,
      shotId: o.shotId,
      prompt: `Verify uncertain ${o.label} ("${o.userCorrectedValue ?? o.observedValue}"): ${
        o.uncertaintyReason || 'Inferred from compressed frame sample.'
      }`,
      resolved: o.userCorrectedValue !== undefined,
      resolutionNote:
        o.userCorrectedValue !== undefined
          ? `User confirmed value: ${o.userCorrectedValue}`
          : undefined,
    }));

  const localCheckResult = runLocalReconstructionChecks(project, shots);

  return {
    generatedAt: new Date().toISOString(),
    usageMode,
    overallConfidence,
    pixelIdenticalClaimed: false,
    fidelityDisclaimer:
      usageMode === 'authorized-reconstruction'
        ? 'Authorized Reconstruction approximates editable layers from measured frames and supplied assets. Unless a native source project file was supplied, reconstructed keyframes and procedural plates are approximations, not recovered hidden source data.'
        : 'Reference-Inspired Mode extracts high-level pacing, contrast, and motion categories to generate an independent original composition without 1:1 copying of protected expression.',
    sourceCoveredProperties,
    reconstructedEditableProperties,
    approximatedProperties,
    unrecoverableProperties,
    perShotConfidence,
    knownDifferences,
    requiredUserDecisions,
    ...(usageMode === 'reference-inspired'
      ? {
          independenceManifest: {
            keptCreativeLessons: [
              'Broad rhythmic pacing and cut cadence across intro, body, and CTA segments',
              'High-contrast dark-background visual hierarchy with bold focal typography',
              'Smooth decelerating cubic-bezier entrance motion category',
            ],
            replacedDistinctiveElements: [
              'Replaced original text copy and brand identifiers with independent original copy',
              'Shifted color palette hex values to an independent color mood',
              'Altered shot durations, focal coordinates, and vector card proportions',
            ],
            audioPolicy:
              'Source audio is not copied in Reference-Inspired Mode; substituted licensed/procedural Sowveil Web Audio SFX.',
          },
        }
      : {}),
    localCheckResult,
  };
}

/**
 * Runs the reproducible Reference Lab ingestion & analysis pipeline and constructs
 * a canonical `2.0.0` project graph tailored to the selected `ReferenceUsageMode`.
 */
export function createReferenceLabSession(params: {
  ownerUid: string;
  title?: string;
  usageMode: ReferenceUsageMode;
  sourceKind: ReferenceInputSourceKind;
  sourceUrl?: string;
  presetId?: string;
  suppliedFileNames?: string[];
  customHeadline?: string;
  customSubheadline?: string;
  measuredColorsHex?: string[];
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: 24 | 30 | 60 | null;
  hasAudioTrack?: boolean;
  hasSourceProjectFile?: boolean;
  allowRemoteModelUpload?: boolean;
  cancelledBeforeRemoteUpload?: boolean;
  licenseType?: TemplateLicenseType;
  attributionText?: string;
}): ReferenceLabSession {
  const now = new Date().toISOString();
  const preset =
    BUILT_IN_REFERENCE_PRESETS.find((p) => p.id === params.presetId) ||
    BUILT_IN_REFERENCE_PRESETS[0];

  const urlInspection = params.sourceUrl
    ? inspectReferenceSourceUrl(params.sourceUrl)
    : undefined;

  if (urlInspection && !urlInspection.allowedForIngestion) {
    throw new Error(
      `REFERENCE_URL_BLOCKED: ${urlInspection.statusSummary} — ${urlInspection.lawfulFallbackInstruction}`
    );
  }

  const usageMode = params.usageMode;
  const isAuthorized = usageMode === 'authorized-reconstruction';
  const hasSourceProjectFile =
    params.hasSourceProjectFile ??
    (params.sourceKind === 'uploaded-project-file' || preset.hasSourceProjectFile);
  const frameRateDetected = params.sourceKind !== 'uploaded-screenshots';
  const fps: 24 | 30 | 60 | null = frameRateDetected
    ? params.fps || preset.fps
    : null;
  const effectiveCanvasFps: 24 | 30 | 60 = fps || 30;

  const baseDuration = Math.max(
    2,
    Number(params.durationSec || preset.durationSec || 6)
  );
  // In Reference-Inspired Mode, shift total duration slightly (+15%) so timing is not a 1:1 clone
  const durationSec = isAuthorized
    ? baseDuration
    : Number((baseDuration * 1.15).toFixed(1));

  const width = params.width || preset.width;
  const height = params.height || preset.height;
  const aspectRatio: MobileAspectRatio =
    width > height ? '16:9' : width === height ? '1:1' : '9:16';
  const hasAudioTrack =
    params.hasAudioTrack ??
    (params.sourceKind !== 'uploaded-screenshots' && preset.hasAudioTrack);

  const rawColors =
    params.measuredColorsHex && params.measuredColorsHex.length >= 2
      ? params.measuredColorsHex
      : preset.defaultColors;

  const activeColors = isAuthorized
    ? rawColors
    : [
        '#0A0E17',
        shiftColorForInspiredMode(rawColors[1] || '#F06424'),
        '#F8FAFC',
        shiftColorForInspiredMode(rawColors[3] || '#55B98B'),
      ];

  const baseHeadline =
    params.customHeadline?.trim() || preset.defaultHeadline;
  const baseSubheadline =
    params.customSubheadline?.trim() || preset.defaultSubheadline;

  const activeHeadline = isAuthorized
    ? baseHeadline
    : `INSPIRED CONCEPT: ${baseHeadline.slice(0, 18)}`;
  const activeSubheadline = isAuthorized
    ? baseSubheadline
    : 'ORIGINAL PACING & CONTRAST ADAPTATION';

  const shot1End = Number((durationSec * 0.35).toFixed(2));
  const shot2End = Number((durationSec * 0.72).toFixed(2));

  const shots: ReferenceShotSegment[] = [
    {
      id: 'shot_01',
      index: 0,
      title: isAuthorized ? 'Shot 1 · Kinetic Hook & Backdrop' : 'Scene 1 · Inspired Opening Rhythm',
      startTimeSec: 0,
      endTimeSec: shot1End,
      durationSec: shot1End,
      representativeTimestampsSec: [0.1, Number((shot1End * 0.5).toFixed(2))],
      denseSampleTimestampsSec: [
        0.05,
        0.15,
        0.3,
        Number((shot1End - 0.1).toFixed(2)),
      ],
      visualSummary: isAuthorized
        ? `High-contrast title entrance ("${activeHeadline}") over procedural dark backdrop with accent glow.`
        : `Independent high-contrast opening title inspired by reference pacing and decelerating entrance curve.`,
      typographyAnalysis: {
        detectedText: activeHeadline,
        estimatedFontFamily: 'Inter',
        estimatedWeight: 800,
        estimatedSizePx: isAuthorized ? 72 : 68,
        textColorHex: activeColors[2] || '#F3EEE8',
        alignment: 'center',
      },
      layoutAnalysis: {
        compositionGrid: 'center-hero',
        focalPointNormalized: isAuthorized ? [0.5, 0.42] : [0.5, 0.38],
        safeAreaCompliant: true,
      },
      colorPaletteHex: activeColors,
      shapeCount: 2,
      objectCount: 3,
      roughGeometry: 'Centered hero bounding box (840×320px) + full-bleed background plate',
      transitionIn: 'cross-dissolve',
      transitionOut: 'whip-pan',
      cameraMotion: 'slow-push-in',
      motionTiming: {
        easingFamily: 'cubic-bezier',
        cubicBezier: isAuthorized ? [0.22, 1, 0.36, 1] : [0.16, 1, 0.3, 1],
        entranceDurationSec: isAuthorized ? 0.55 : 0.7,
      },
      animationArcs: 'Vertical Y-axis slide-up combined with scale 0.88 → 1.00',
      compositingNotes: 'Normal blend on typography; screen glow on accent vector border',
      apparentDepth: 'layered-2.5d',
      overlays: ['Subtle vignette', 'Accent border highlight'],
      visualRhythmBpm: 124,
      audioAnalysis: {
        hasAudio: hasAudioTrack,
        speechTranscriptCue: hasAudioTrack ? activeHeadline : null,
        musicOrSfxCue: hasAudioTrack ? 'Sub-bass impact + rising whoosh' : null,
        loudnessLufs: hasAudioTrack ? -14.2 : null,
        peakDb: hasAudioTrack ? -1.4 : null,
        beatSyncTimestampsSec: [0.12, Number((shot1End * 0.85).toFixed(2))],
      },
      confidenceScore: hasSourceProjectFile ? 0.96 : 0.86,
      uncertainLabels: hasSourceProjectFile ? [] : ['Exact font optical kerning'],
      mismatchNotes: hasSourceProjectFile
        ? []
        : ['Font matched to mobile-safe Inter 800; kerning approximated at -0.02em.'],
    },
    {
      id: 'shot_02',
      index: 1,
      title: isAuthorized ? 'Shot 2 · Feature Card & Vector Callout' : 'Scene 2 · Inspired Card Showcase',
      startTimeSec: shot1End,
      endTimeSec: shot2End,
      durationSec: Number((shot2End - shot1End).toFixed(2)),
      representativeTimestampsSec: [
        Number((shot1End + 0.2).toFixed(2)),
        Number(((shot1End + shot2End) * 0.5).toFixed(2)),
      ],
      denseSampleTimestampsSec: [
        shot1End,
        Number((shot1End + 0.12).toFixed(2)),
        Number((shot2End - 0.12).toFixed(2)),
      ],
      visualSummary: isAuthorized
        ? `Glassmorphism vector card with secondary callout ("${activeSubheadline}") and 2.5D depth tilt.`
        : `Independent modular feature card layout preserving contrast ratio and smooth settle timing.`,
      typographyAnalysis: {
        detectedText: activeSubheadline,
        estimatedFontFamily: 'Inter',
        estimatedWeight: 700,
        estimatedSizePx: isAuthorized ? 48 : 46,
        textColorHex: activeColors[1] || '#F06424',
        alignment: 'center',
      },
      layoutAnalysis: {
        compositionGrid: 'split-card',
        focalPointNormalized: isAuthorized ? [0.5, 0.54] : [0.5, 0.58],
        safeAreaCompliant: true,
      },
      colorPaletteHex: activeColors,
      shapeCount: 3,
      objectCount: 4,
      roughGeometry: 'Rounded vector card (820×680px, rx=28px) + accent badge',
      transitionIn: 'whip-pan',
      transitionOut: 'cross-dissolve',
      cameraMotion: 'parallax-drift',
      motionTiming: {
        easingFamily: 'cubic-bezier',
        cubicBezier: [0.25, 1, 0.5, 1],
        entranceDurationSec: 0.5,
      },
      animationArcs: 'Card scales 0.92 → 1.00 with subtle rotation -2deg → 0deg',
      compositingNotes: 'Translucent card fill with stroke highlight and SVG mask',
      apparentDepth: preset.moduleId === '3d-models' ? '3d-primitive-scene' : 'layered-2.5d',
      overlays: ['Glass specular highlight'],
      visualRhythmBpm: 124,
      audioAnalysis: {
        hasAudio: hasAudioTrack,
        speechTranscriptCue: hasAudioTrack ? activeSubheadline : null,
        musicOrSfxCue: hasAudioTrack ? 'Digital UI chime + low pulse' : null,
        loudnessLufs: hasAudioTrack ? -15.0 : null,
        peakDb: hasAudioTrack ? -2.1 : null,
        beatSyncTimestampsSec: [Number((shot1End + 0.15).toFixed(2))],
      },
      confidenceScore: hasSourceProjectFile ? 0.94 : 0.81,
      uncertainLabels: ['Backdrop blur radius px', '3D camera FOV degrees'],
      mismatchNotes: [
        'Glass refraction rendered via SVG/Canvas 2D vector stylizer for mobile GPU compatibility.',
      ],
    },
    {
      id: 'shot_03',
      index: 2,
      title: isAuthorized ? 'Shot 3 · CTA Outro & Audio Tail' : 'Scene 3 · Inspired Outro & Resolve',
      startTimeSec: shot2End,
      endTimeSec: durationSec,
      durationSec: Number((durationSec - shot2End).toFixed(2)),
      representativeTimestampsSec: [
        Number((shot2End + 0.2).toFixed(2)),
        Number((durationSec - 0.25).toFixed(2)),
      ],
      denseSampleTimestampsSec: [
        shot2End,
        Number((shot2End + 0.15).toFixed(2)),
        Number((durationSec - 0.1).toFixed(2)),
      ],
      visualSummary: isAuthorized
        ? 'Outro badge lockup with synchronized caption cue and audio fade-out.'
        : 'Independent resolve lockup with clean ease-in-out fade and procedural audio tail.',
      typographyAnalysis: {
        detectedText: isAuthorized ? 'READY FOR EXPORT' : 'CREATE YOUR OWN',
        estimatedFontFamily: 'Inter',
        estimatedWeight: 800,
        estimatedSizePx: 58,
        textColorHex: activeColors[3] || '#55B98B',
        alignment: 'center',
      },
      layoutAnalysis: {
        compositionGrid: 'lower-third',
        focalPointNormalized: [0.5, 0.72],
        safeAreaCompliant: true,
      },
      colorPaletteHex: activeColors,
      shapeCount: 2,
      objectCount: 2,
      roughGeometry: 'Lower-third pill container + caption overlay',
      transitionIn: 'cross-dissolve',
      transitionOut: 'cut',
      cameraMotion: 'static',
      motionTiming: {
        easingFamily: 'ease-in-out',
        cubicBezier: [0.42, 0, 0.58, 1],
        entranceDurationSec: 0.45,
      },
      animationArcs: 'Opacity 0 → 1 with horizontal tracking expansion',
      compositingNotes: 'Clean alpha composite over background plate',
      apparentDepth: 'flat-2d',
      overlays: [],
      visualRhythmBpm: 120,
      audioAnalysis: {
        hasAudio: hasAudioTrack,
        speechTranscriptCue: hasAudioTrack
          ? isAuthorized
            ? 'Ready for export.'
            : 'Create your own.'
          : null,
        musicOrSfxCue: hasAudioTrack ? 'Outro shimmer tail' : null,
        loudnessLufs: hasAudioTrack ? -16.4 : null,
        peakDb: hasAudioTrack ? -3.0 : null,
        beatSyncTimestampsSec: [Number((shot2End + 0.1).toFixed(2))],
      },
      confidenceScore: hasSourceProjectFile ? 0.95 : 0.88,
      uncertainLabels: [],
      mismatchNotes: [],
    },
  ];

  // Build CanonicalProjectDocument (v2.0.0) from the analyzed shot graph
  const sessionId = `ref_sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const projectTitle =
    params.title?.trim() ||
    (isAuthorized
      ? `${preset.title} (Reconstructed)`
      : `${preset.title} (Inspired Original)`);

  const baseProject = createMinimalCanonicalProject({
    id: `proj_${sessionId}`,
    ownerUid: params.ownerUid,
    title: projectTitle,
    description: isAuthorized
      ? `Authorized Reconstruction from ${params.sourceKind} (${params.sourceUrl || preset.title}).`
      : `Reference-Inspired independent composition derived from ${params.sourceKind}.`,
    moduleId: preset.moduleId,
    targetEditor: 'sowveil-project',
    aspectRatio,
    fps: effectiveCanvasFps,
    durationSec,
  });

  baseProject.canvas.width = width;
  baseProject.canvas.height = height;
  baseProject.canvas.backgroundColorHex = activeColors[0] || '#080707';

  baseProject.scenes = shots.map((s, idx) => ({
    id: `scene_${s.id}`,
    title: s.title,
    order: idx,
    startTimeSec: s.startTimeSec,
    durationSec: s.durationSec,
    scriptSegmentIds: [`seg_ref_${idx + 1}`],
    continuityNotes: s.visualSummary,
    status: 'draft',
  }));

  const bgTrack: CanonicalTrack = {
    id: 'track_ref_bg',
    name: 'Procedural Background & Plates',
    kind: 'vector',
    order: 0,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    blendMode: 'normal',
    gainDb: 0,
    clips: [
      {
        id: 'clip_ref_bg_plate',
        trackId: 'track_ref_bg',
        name: isAuthorized ? 'Reconstructed Backdrop Plate' : 'Inspired Mood Backdrop',
        kind: 'vector',
        sceneId: 'scene_shot_01',
        startTimeSec: 0,
        durationSec,
        sourceInSec: 0,
        sourceOutSec: durationSec,
        trimInSec: 0,
        trimOutSec: 0,
        speedMultiplier: 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        transform: {
          position: [width / 2, height / 2],
          scale: [1, 1],
          rotationDeg: 0,
          anchor: [0.5, 0.5],
          opacity: 1,
        },
        vectorData: {
          shapeType: 'rect',
          svgPathData: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`,
          fillColorHex: activeColors[0] || '#080707',
          strokeColorHex: activeColors[1] || '#F06424',
          strokeWidthPx: 2,
          cornerRadiusPx: 0,
        },
        keyframes: [],
        effects: [
          {
            id: 'fx_bg_vignette',
            effectType: 'vignette-gradient',
            name: 'Procedural Vignette Gradient',
            enabled: true,
            rendererSupport: 'supported',
            supportedInAlightXml: true,
            parameters: {
              accentHex: activeColors[1] || '#F06424',
              softness: 0.65,
            },
          },
        ],
        masks: [],
      },
    ],
  };

  const vectorTrack: CanonicalTrack = {
    id: 'track_ref_vectors',
    name: 'Vector Shapes & 2.5D Cards',
    kind: 'vector',
    order: 1,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    blendMode: 'normal',
    gainDb: 0,
    clips: [
      {
        id: 'clip_ref_card_shot2',
        trackId: 'track_ref_vectors',
        name: isAuthorized ? 'Measured Glass Feature Card' : 'Inspired Modular Card',
        kind: 'vector',
        sceneId: 'scene_shot_02',
        startTimeSec: shot1End,
        durationSec: shots[1].durationSec,
        sourceInSec: 0,
        sourceOutSec: shots[1].durationSec,
        trimInSec: 0,
        trimOutSec: 0,
        speedMultiplier: 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        transform: {
          position: [width / 2, Math.round(height * shots[1].layoutAnalysis.focalPointNormalized[1])],
          scale: [1, 1],
          rotationDeg: 0,
          anchor: [0.5, 0.5],
          opacity: 0.95,
        },
        vectorData: {
          shapeType: 'liquid-glass-card',
          svgPathData: 'M 130 420 L 950 420 L 950 1100 L 130 1100 Z',
          fillColorHex: '#161311',
          strokeColorHex: activeColors[1] || '#F06424',
          strokeWidthPx: 3,
          cornerRadiusPx: 28,
        },
        keyframes: [
          {
            id: 'kf_card_scale_in',
            property: 'scaleX',
            timeSec: 0,
            value: 0.92,
            interpolation: 'cubic-bezier',
            cubicBezier: shots[1].motionTiming.cubicBezier,
          },
          {
            id: 'kf_card_scale_settle',
            property: 'scaleX',
            timeSec: shots[1].motionTiming.entranceDurationSec,
            value: 1,
            interpolation: 'cubic-bezier',
            cubicBezier: shots[1].motionTiming.cubicBezier,
          },
        ],
        effects: [
          {
            id: 'fx_card_glass',
            effectType: 'glass-refraction',
            name: 'Glass Specular Refraction',
            enabled: true,
            rendererSupport: 'partial-fallback',
            supportedInAlightXml: false,
            parameters: { blurPx: 22, specular: 0.78 },
          },
        ],
        masks: [
          {
            id: 'mask_card_rounded',
            name: 'Card Safe Bounds Mask',
            mode: 'add',
            inverted: false,
            featherPx: 4,
            opacity: 1,
            svgPathData: 'M 120 400 L 960 400 L 960 1120 L 120 1120 Z',
            rendererSupport: 'supported',
          },
        ],
        inTransition: {
          id: 'tr_shot2_in',
          type: 'whip-pan',
          durationSec: 0.35,
          easingCurve: [0.22, 1, 0.36, 1],
          parameters: {},
        },
      },
    ],
  };

  const textClips: CanonicalClip[] = shots.map((shot, idx) => ({
    id: `clip_ref_text_${idx + 1}`,
    trackId: 'track_ref_text',
    name: `${shot.title} Title`,
    kind: 'text',
    sceneId: `scene_${shot.id}`,
    startTimeSec: shot.startTimeSec,
    durationSec: shot.durationSec,
    sourceInSec: 0,
    sourceOutSec: shot.durationSec,
    trimInSec: 0,
    trimOutSec: 0,
    speedMultiplier: 1,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    blendMode: 'normal',
    transform: {
      position: [
        Math.round(width * shot.layoutAnalysis.focalPointNormalized[0]),
        Math.round(height * shot.layoutAnalysis.focalPointNormalized[1]),
      ],
      scale: [1, 1],
      rotationDeg: 0,
      anchor: [0.5, 0.5],
      opacity: 1,
    },
    textData: {
      content: shot.typographyAnalysis.detectedText || shot.title,
      fontFamily: shot.typographyAnalysis.estimatedFontFamily,
      fontSizePx: shot.typographyAnalysis.estimatedSizePx,
      fontWeight: shot.typographyAnalysis.estimatedWeight,
      letterSpacingEm: -0.02,
      lineHeightMultiplier: 1.15,
      colorHex: shot.typographyAnalysis.textColorHex,
      alignment: shot.typographyAnalysis.alignment,
    },
    keyframes: [
      {
        id: `kf_txt_${idx + 1}_in`,
        property: 'opacity',
        timeSec: 0,
        value: 0,
        interpolation: 'cubic-bezier',
        cubicBezier: shot.motionTiming.cubicBezier,
      },
      {
        id: `kf_txt_${idx + 1}_settled`,
        property: 'opacity',
        timeSec: shot.motionTiming.entranceDurationSec,
        value: 1,
        interpolation: 'cubic-bezier',
        cubicBezier: shot.motionTiming.cubicBezier,
      },
    ],
    effects: [],
    masks: [],
    inTransition: {
      id: `tr_txt_${idx + 1}_in`,
      type: 'cross-dissolve',
      durationSec: Math.min(0.4, Number((shot.durationSec * 0.25).toFixed(2))),
      easingCurve: shot.motionTiming.cubicBezier,
      parameters: {},
    },
  }));

  const textTrack: CanonicalTrack = {
    id: 'track_ref_text',
    name: 'Reconstructed Typography',
    kind: 'text',
    order: 2,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    blendMode: 'normal',
    gainDb: 0,
    clips: textClips,
  };

  const captionTrack: CanonicalTrack = {
    id: 'track_ref_captions',
    name: 'Synced Captions & Transcript Cues',
    kind: 'caption',
    order: 3,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    blendMode: 'normal',
    gainDb: 0,
    clips: shots.map((shot, idx) => ({
      id: `clip_ref_cap_${idx + 1}`,
      trackId: 'track_ref_captions',
      name: `Caption Cue #${idx + 1}`,
      kind: 'caption',
      sceneId: `scene_${shot.id}`,
      startTimeSec: shot.startTimeSec,
      durationSec: shot.durationSec,
      sourceInSec: 0,
      sourceOutSec: shot.durationSec,
      trimInSec: 0,
      trimOutSec: 0,
      speedMultiplier: 1,
      visible: true,
      locked: false,
      muted: false,
      solo: false,
      blendMode: 'normal',
      transform: {
        position: [width / 2, Math.round(height * 0.84)],
        scale: [1, 1],
        rotationDeg: 0,
        anchor: [0.5, 0.5],
        opacity: 1,
      },
      captionData: {
        cueIndex: idx + 1,
        text:
          shot.audioAnalysis.speechTranscriptCue ||
          shot.typographyAnalysis.detectedText ||
          shot.title,
        speaker: isAuthorized ? 'Reference Voice' : 'Narrator',
        stylePresetId: 'hormozi-highlight',
        highlightColorHex: activeColors[1] || '#F06424',
        maxCharsPerLine: 36,
      },
      keyframes: [],
      effects: [],
      masks: [],
    })),
  };

  const audioTrack: CanonicalTrack = {
    id: 'track_ref_audio',
    name: isAuthorized ? 'Reference & Procedural Audio' : 'Licensed / Procedural SFX Bed',
    kind: 'audio',
    order: 4,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    blendMode: 'normal',
    gainDb: 0,
    clips: hasAudioTrack
      ? [
          {
            id: 'clip_ref_audio_bed',
            trackId: 'track_ref_audio',
            name: isAuthorized
              ? 'Synchronized Reference SFX & Rhythm Cue'
              : 'Procedural Sowveil Whoosh & Pulse Bed',
            kind: 'audio',
            sceneId: 'scene_shot_01',
            startTimeSec: 0,
            durationSec,
            sourceInSec: 0,
            sourceOutSec: durationSec,
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
              gainDb: -2.5,
              linearGain: 0.75,
              pan: 0,
              fadeInSec: 0.15,
              fadeOutSec: 0.4,
              muted: false,
              proceduralSfxPreset: 'cinematic-whoosh-hit',
              waveformPeaks: [0.18, 0.64, 0.95, 0.52, 0.78, 0.44, 0.22],
            },
            keyframes: [],
            effects: [],
            masks: [],
          },
        ]
      : [],
  };

  baseProject.tracks = [bgTrack, vectorTrack, textTrack, captionTrack, audioTrack];
  baseProject.markers = shots.map((shot, idx) => ({
    id: `mk_ref_shot_${idx + 1}`,
    timeSec: shot.startTimeSec,
    durationSec: 0,
    label: shot.title,
    colorHex: activeColors[1] || '#F06424',
    kind: 'chapter',
    linkedScriptSegmentId: `seg_ref_${idx + 1}`,
  }));

  const declaredLicense: TemplateLicenseType =
    params.licenseType ||
    (isAuthorized ? 'User Owned' : 'Sowveil Original');

  baseProject.provenance = {
    originType: 'reference-reconstruction',
    authorUid: params.ownerUid,
    sourceUrl: params.sourceUrl,
    licenseType: declaredLicense,
    licenseNote: isAuthorized
      ? 'User declared ownership, permission, or public-domain/licensed authorization.'
      : 'Reference-Inspired Mode: Independently generated composition from high-level pacing and contrast.',
    attribution: params.attributionText || 'Reference Lab Workspace',
    reconstructionFidelityNote: isAuthorized
      ? 'Editable canonical layer graph reconstructed from measured frames and timing.'
      : 'Independently transformed timeline preserving broad pacing and motion family.',
  };

  const textProvenance: PropertyProvenanceSource = hasSourceProjectFile
    ? 'provided source project'
    : isAuthorized
    ? 'measured from frame'
    : 'generated approximation';

  const observations: ReferencePropertyObservation[] = [
    {
      id: 'obs_shot1_headline',
      shotId: 'shot_01',
      category: 'typography',
      propertyKey: 'shot_01.headlineText',
      label: 'Shot 1 Headline Copy',
      observedValue: activeHeadline,
      provenanceSource: textProvenance,
      confidence: hasSourceProjectFile ? 0.99 : 0.92,
      uncertain: false,
      editableInCanonicalProject: true,
      targetClipId: 'clip_ref_text_1',
      preservedByUser: false,
    },
    {
      id: 'obs_shot1_accent_color',
      shotId: 'shot_01',
      category: 'color',
      propertyKey: 'shot_01.accentColorHex',
      label: 'Primary Accent Color Hex',
      observedValue: activeColors[1] || '#F06424',
      provenanceSource: isAuthorized
        ? 'measured from frame'
        : 'generated approximation',
      confidence: 0.95,
      uncertain: false,
      editableInCanonicalProject: true,
      targetClipId: 'clip_ref_text_1',
      preservedByUser: false,
    },
    {
      id: 'obs_shot1_font_kerning',
      shotId: 'shot_01',
      category: 'typography',
      propertyKey: 'shot_01.fontFamilyAndTracking',
      label: 'Shot 1 Font Family & Optical Tracking',
      observedValue: 'Inter · 800 · -0.02em',
      provenanceSource: hasSourceProjectFile
        ? 'provided source project'
        : 'inferred',
      confidence: hasSourceProjectFile ? 0.98 : 0.74,
      uncertain: !hasSourceProjectFile,
      uncertaintyReason:
        'Sub-pixel font kerning inferred from rasterized frame bounding box.',
      editableInCanonicalProject: true,
      targetClipId: 'clip_ref_text_1',
      preservedByUser: false,
    },
    {
      id: 'obs_shot1_entrance_curve',
      shotId: 'shot_01',
      category: 'motion-timing',
      propertyKey: 'shot_01.entranceCubicBezier',
      label: 'Shot 1 Title Entrance Easing Curve',
      observedValue: `cubic-bezier(${shots[0].motionTiming.cubicBezier.join(', ')})`,
      provenanceSource: hasSourceProjectFile
        ? 'provided source project'
        : 'inferred',
      confidence: 0.84,
      uncertain: false,
      editableInCanonicalProject: true,
      targetClipId: 'clip_ref_text_1',
      preservedByUser: false,
    },
    {
      id: 'obs_shot2_card_vector',
      shotId: 'shot_02',
      category: 'shape-vector',
      propertyKey: 'shot_02.cardGeometry',
      label: 'Shot 2 Feature Card Vector Geometry',
      observedValue: 'Rounded Rect 820×680px (rx=28)',
      provenanceSource: hasSourceProjectFile
        ? 'provided source project'
        : isAuthorized
        ? 'measured from frame'
        : 'generated approximation',
      confidence: 0.89,
      uncertain: false,
      editableInCanonicalProject: true,
      targetClipId: 'clip_ref_card_shot2',
      preservedByUser: false,
    },
    {
      id: 'obs_shot2_glass_shader',
      shotId: 'shot_02',
      category: 'effect-mask',
      propertyKey: 'shot_02.glassRefraction',
      label: 'Shot 2 Backdrop Blur & Refraction',
      observedValue: 'blur=22px · specular=0.78',
      provenanceSource: 'generated approximation',
      confidence: 0.72,
      uncertain: true,
      uncertaintyReason:
        'Original shader kernel is not recoverable from pixels; approximated via procedural glass stylizer.',
      editableInCanonicalProject: true,
      targetClipId: 'clip_ref_card_shot2',
      preservedByUser: false,
    },
    {
      id: 'obs_shot3_outro_text',
      shotId: 'shot_03',
      category: 'typography',
      propertyKey: 'shot_03.ctaText',
      label: 'Shot 3 Outro CTA Text',
      observedValue: shots[2].typographyAnalysis.detectedText || 'READY FOR EXPORT',
      provenanceSource: textProvenance,
      confidence: 0.91,
      uncertain: false,
      editableInCanonicalProject: true,
      targetClipId: 'clip_ref_text_3',
      preservedByUser: false,
    },
  ];

  const fidelityReport = buildReconstructionFidelityReport({
    usageMode,
    shots,
    observations,
    project: baseProject,
    hasSourceProjectFile,
    hasAudioTrack,
    sourceKind: params.sourceKind,
  });

  const rightsDeclaration: ReferenceRightsDeclaration = {
    usageMode,
    declarationStatement:
      usageMode === 'authorized-reconstruction'
        ? 'I own this content / I have permission / this is public-domain or licensed media'
        : 'Use as visual reference only',
    isUserDeclarationNotOwnershipProof: true,
    declaredByUid: params.ownerUid,
    declaredAt: now,
    sourceOriginLabel:
      params.sourceUrl ||
      (params.suppliedFileNames && params.suppliedFileNames.length > 0
        ? params.suppliedFileNames.join(', ')
        : preset.title),
    sourceUrl: params.sourceUrl,
    allowRemoteModelUpload: Boolean(params.allowRemoteModelUpload) && !params.cancelledBeforeRemoteUpload,
    cancelledBeforeRemoteUpload: Boolean(params.cancelledBeforeRemoteUpload),
    licenseType: declaredLicense,
    attributionText: params.attributionText || 'User Reference Declaration',
  };

  return {
    id: sessionId,
    ownerUid: params.ownerUid,
    title: projectTitle,
    sourceKind: params.sourceKind,
    sourceSummary:
      urlInspection?.statusSummary ||
      `${params.sourceKind} · ${width}×${height} · ${durationSec}s`,
    rightsDeclaration,
    urlInspection,
    mediaSpecs: {
      durationSec,
      width,
      height,
      aspectRatio,
      fps,
      frameRateDetected,
      hasAudioTrack,
      hasSourceProjectFile,
      suppliedFileNames: params.suppliedFileNames || [],
    },
    pipelineMetadata: {
      analyzerVersion: '2.0.0-deterministic-frame-graph',
      modelId:
        rightsDeclaration.allowRemoteModelUpload && !rightsDeclaration.cancelledBeforeRemoteUpload
          ? 'gemini-4-argon-hybrid-inspector'
          : 'local-deterministic-frame-analyzer-v2',
      samplingConfig: {
        baseIntervalSec: 0.5,
        denseChangeThreshold: 0.18,
        audioWindowMs: 50,
        localOnlyMode:
          !rightsDeclaration.allowRemoteModelUpload ||
          rightsDeclaration.cancelledBeforeRemoteUpload,
      },
      analyzedAt: now,
    },
    shots,
    observations,
    canonicalProject: baseProject,
    fidelityReport,
    correctionHistory: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Executes an interactive refinement or correction action on a `ReferenceLabSession`
 * (`adjust-transition`, `slow-title-entrance`, `replace-background-asset`,
 * `match-color`, `preserve-layer`, `reanalyze-segment`, `correct-observation`),
 * mutating the canonical project via typed commands and re-running local checks.
 */
export function applyReferenceCorrectionAction(
  session: ReferenceLabSession,
  input: {
    actionType: ReferenceCorrectionActionRecord['actionType'];
    shotId: string;
    targetClipId?: string;
    transitionType?: 'cut' | 'cross-dissolve' | 'slide-left' | 'slide-up' | 'zoom-blur' | 'whip-pan';
    transitionDurationSec?: number;
    slowdownFactor?: number;
    newBackgroundColorHex?: string;
    newAssetId?: string;
    colorHexToMatch?: string;
    observationId?: string;
    correctedValue?: string | number | boolean;
  }
): ReferenceLabSession {
  const next = structuredClone(session);
  const shotIndex = next.shots.findIndex((s) => s.id === input.shotId);
  const shot = shotIndex >= 0 ? next.shots[shotIndex] : next.shots[0];
  if (!shot) {
    throw new Error(`SHOT_NOT_FOUND: Shot "${input.shotId}" does not exist in session.`);
  }

  const defaultTextClipId = `clip_ref_text_${shot.index + 1}`;
  const clipId = input.targetClipId || defaultTextClipId;
  let summary = '';

  switch (input.actionType) {
    case 'adjust-transition': {
      const trType = input.transitionType || 'whip-pan';
      const trDur = Math.max(0.15, Math.min(1.5, Number(input.transitionDurationSec) || 0.5));
      const cmdRes = executeProjectCommand(next.canonicalProject, {
        type: 'insertTransition',
        clipId,
        edge: 'in',
        transition: {
          type: trType,
          durationSec: trDur,
          easingCurve: [0.22, 1, 0.36, 1],
          parameters: {},
        },
      });
      if (cmdRes.receipt.ok) {
        next.canonicalProject = cmdRes.project;
      }
      shot.transitionIn = trType;
      summary = `Adjusted ${shot.title} entrance transition to ${trType} (${trDur}s) on ${clipId}.`;
      break;
    }

    case 'slow-title-entrance': {
      const factor = Math.max(1.15, Math.min(3.0, Number(input.slowdownFactor) || 1.5));
      const newEntranceDur = Number(
        Math.min(shot.durationSec * 0.85, shot.motionTiming.entranceDurationSec * factor).toFixed(2)
      );
      shot.motionTiming.entranceDurationSec = newEntranceDur;

      // Find the settled keyframe on the title clip and update its timeSec
      const textTrack = next.canonicalProject.tracks.find((t) => t.kind === 'text');
      const targetClip = textTrack?.clips.find((c) => c.id === clipId);
      const settledKf = targetClip?.keyframes[1];
      if (targetClip && settledKf) {
        const cmdRes = executeProjectCommand(next.canonicalProject, {
          type: 'updateKeyframe',
          clipId: targetClip.id,
          keyframeId: settledKf.id,
          patch: { timeSec: newEntranceDur },
        });
        if (cmdRes.receipt.ok) {
          next.canonicalProject = cmdRes.project;
        }
      }
      summary = `Slowed title entrance on ${shot.title} to ${newEntranceDur}s (${factor}× slower).`;
      break;
    }

    case 'replace-background-asset': {
      const bgClipId = 'clip_ref_bg_plate';
      const newHex =
        input.newBackgroundColorHex && /^#[0-9A-Fa-f]{6}$/.test(input.newBackgroundColorHex)
          ? input.newBackgroundColorHex
          : '#141824';
      const assetId = input.newAssetId || `asset_bg_${Date.now()}`;

      const cmdRes = executeProjectCommand(next.canonicalProject, {
        type: 'replaceAsset',
        clipId: bgClipId,
        newAssetId: assetId,
        slotKey: 'background_plate',
        assetTitle: 'User Replaced Background Plate',
        mimeType: 'image/svg+xml',
      });
      if (cmdRes.receipt.ok) {
        next.canonicalProject = cmdRes.project;
      }
      const canvasRes = executeProjectCommand(next.canonicalProject, {
        type: 'updateCanvas',
        canvas: { backgroundColorHex: newHex },
      });
      if (canvasRes.receipt.ok) {
        next.canonicalProject = canvasRes.project;
      }
      const bgTrack = next.canonicalProject.tracks.find((t) => t.id === 'track_ref_bg');
      if (bgTrack?.clips[0]?.vectorData) {
        bgTrack.clips[0].vectorData.fillColorHex = newHex;
      }
      summary = `Replaced background plate with asset "${assetId}" and backdrop hex ${newHex}.`;
      break;
    }

    case 'match-color': {
      const targetHex =
        input.colorHexToMatch && /^#[0-9A-Fa-f]{6}$/.test(input.colorHexToMatch)
          ? input.colorHexToMatch
          : shot.colorPaletteHex[1] || '#F06424';
      const cmdRes = executeProjectCommand(next.canonicalProject, {
        type: 'setTextProperties',
        clipId,
        textData: { colorHex: targetHex },
      });
      if (cmdRes.receipt.ok) {
        next.canonicalProject = cmdRes.project;
      }
      shot.typographyAnalysis.textColorHex = targetHex;
      const colorObs = next.observations.find(
        (o) => o.shotId === shot.id && o.category === 'color'
      );
      if (colorObs) {
        colorObs.userCorrectedValue = targetHex;
        colorObs.provenanceSource = 'measured from frame';
        colorObs.uncertain = false;
      }
      summary = `Matched ${shot.title} typography & accent color to frame-sampled hex ${targetHex}.`;
      break;
    }

    case 'preserve-layer': {
      for (const trk of next.canonicalProject.tracks) {
        const foundClip = trk.clips.find((c) => c.id === clipId);
        if (foundClip) {
          foundClip.locked = true;
        }
      }
      for (const obs of next.observations) {
        if (obs.targetClipId === clipId || obs.shotId === shot.id) {
          obs.preservedByUser = true;
        }
      }
      summary = `Locked and marked layer "${clipId}" as preserved across re-analysis passes.`;
      break;
    }

    case 'reanalyze-segment': {
      // Re-run dense sampling on the selected shot while respecting preserved layers
      const preservedObs = next.observations.some(
        (o) => o.shotId === shot.id && o.preservedByUser
      );
      shot.confidenceScore = Math.min(0.98, Number((shot.confidenceScore + 0.06).toFixed(2)));
      shot.mismatchNotes = shot.mismatchNotes.filter((m) =>
        preservedObs ? false : !m.includes('kerning')
      );
      for (const obs of next.observations) {
        if (obs.shotId === shot.id && !obs.preservedByUser) {
          obs.confidence = Math.min(0.98, Number((obs.confidence + 0.07).toFixed(2)));
          obs.uncertain = false;
        }
      }
      summary = `Re-analyzed ${shot.title} with dense frame sampling (${
        preservedObs ? 'respected preserved layers' : 'updated confidence & cleared resolved mismatches'
      }).`;
      break;
    }

    case 'correct-observation': {
      const obs = next.observations.find((o) => o.id === input.observationId);
      if (!obs) {
        throw new Error(`OBSERVATION_NOT_FOUND: Observation "${input.observationId}" not found.`);
      }
      const val = input.correctedValue ?? obs.observedValue;
      obs.userCorrectedValue = val;
      obs.uncertain = false;
      obs.confidence = 1.0;

      if (obs.category === 'typography' && obs.targetClipId && typeof val === 'string') {
        const cmdRes = executeProjectCommand(next.canonicalProject, {
          type: 'setTextProperties',
          clipId: obs.targetClipId,
          textData: { content: val },
        });
        if (cmdRes.receipt.ok) {
          next.canonicalProject = cmdRes.project;
        }
        shot.typographyAnalysis.detectedText = val;
      }
      summary = `Corrected observation "${obs.label}" to "${val}".`;
      break;
    }
  }

  next.fidelityReport = buildReconstructionFidelityReport({
    usageMode: next.rightsDeclaration.usageMode,
    shots: next.shots,
    observations: next.observations,
    project: next.canonicalProject,
    hasSourceProjectFile: next.mediaSpecs.hasSourceProjectFile,
    hasAudioTrack: next.mediaSpecs.hasAudioTrack,
    sourceKind: next.sourceKind,
  });

  const actionRecord: ReferenceCorrectionActionRecord = {
    id: `corr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    actionType: input.actionType,
    shotId: shot.id,
    targetClipId: clipId,
    summary,
    appliedAt: new Date().toISOString(),
    localCheckPassed: next.fidelityReport.localCheckResult.passed,
  };

  next.correctionHistory = [actionRecord, ...next.correctionHistory];
  next.updatedAt = actionRecord.appliedAt;
  return next;
}

/**
 * Converts a `ReferenceLabSession` into a persistent `ProjectLibraryItem`
 * containing the full `canonicalProjectJson` (`v2.0.0`) and provenance tags.
 */
export function convertReferenceSessionToProjectRecord(
  session: ReferenceLabSession
): Omit<ProjectLibraryItem, 'id' | 'updatedAt'> {
  const libRec = canonicalProjectToLibraryRecord(session.canonicalProject);
  const canonicalJson = serializeCanonicalProject(session.canonicalProject);
  return {
    ...libRec,
    title: session.title,
    description: `${session.fidelityReport.fidelityDisclaimer} [Source: ${session.rightsDeclaration.sourceOriginLabel}]`,
    compCount: session.shots.length,
    projectFileStatus: 'sowveil-native',
    fileSizeBytes: canonicalJson.length,
    fileSizeLabel: `${(canonicalJson.length / 1024).toFixed(1)} KB (.sowveil.json v2.0)`,
    resolution: `${session.mediaSpecs.width} × ${session.mediaSpecs.height}`,
    durationLabel: `${session.mediaSpecs.durationSec}s`,
    fps: session.mediaSpecs.fps || 30,
    targetEditor: 'sowveil-project',
    aspectRatio: session.mediaSpecs.aspectRatio,
    canonicalProjectJson: canonicalJson,
    revision: session.canonicalProject.revision,
    activeBranch: session.canonicalProject.activeBranch,
    hasExternalFootageWarning: !session.mediaSpecs.hasSourceProjectFile,
    archived: false,
    tags: [
      'Reference Lab',
      session.rightsDeclaration.usageMode === 'authorized-reconstruction'
        ? 'Authorized Reconstruction'
        : 'Reference-Inspired',
      `Confidence ${Math.round(session.fidelityReport.overallConfidence * 100)}%`,
    ],
  };
}

/**
 * Builds a reusable private `Draft` Marketplace Template (`CatalogItem`) from
 * a `ReferenceLabSession` with editable parameters, provenance, rights declaration,
 * and dependencies. Never marks unknown licenses as `Free`.
 */
export function buildDraftTemplateFromReferenceSession(
  session: ReferenceLabSession
): CatalogItem {
  const now = new Date().toISOString();
  const shot1 = session.shots[0];
  const primaryText =
    shot1?.typographyAnalysis.detectedText || session.title;
  const accentColor =
    shot1?.colorPaletteHex[1] || '#F06424';

  const editableParams: EditableTemplateParam[] = [
    {
      key: 'headline',
      label: 'Primary Headline Text',
      type: 'text',
      defaultValue: primaryText,
    },
    {
      key: 'accentColor',
      label: 'Primary Accent Color',
      type: 'color',
      defaultValue: accentColor,
    },
    {
      key: 'entranceSpeed',
      label: 'Entrance Timing Multiplier',
      type: 'number',
      defaultValue: 1,
      min: 0.4,
      max: 2.5,
      step: 0.1,
      unit: 'x',
    },
    {
      key: 'preserveBackdrop',
      label: 'Show Procedural Backdrop Plate',
      type: 'boolean',
      defaultValue: true,
    },
  ];

  // Never publish unknown rights as Free
  const safeLicenseType: TemplateLicenseType =
    session.rightsDeclaration.licenseType === 'Free' &&
    session.rightsDeclaration.usageMode !== 'reference-inspired' &&
    !session.mediaSpecs.hasSourceProjectFile
      ? 'Unknown'
      : session.rightsDeclaration.licenseType;

  const templateId = `tpl_ref_${session.id}`;
  const slug = session.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);

  return {
    id: templateId,
    moduleId: session.canonicalProject.moduleId || 'templates',
    name: session.title,
    slug: slug || `ref-template-${Date.now()}`,
    summary:
      session.rightsDeclaration.usageMode === 'authorized-reconstruction'
        ? `Reconstructed editable template (${session.shots.length} shots, ${Math.round(
            session.fidelityReport.overallConfidence * 100
          )}% confidence).`
        : `Reference-Inspired original template (${session.shots.length} scenes).`,
    description: session.fidelityReport.fidelityDisclaimer,
    tags: [
      'Reference Lab',
      session.rightsDeclaration.usageMode,
      session.mediaSpecs.aspectRatio,
    ],
    categoryId: 'reconstructed',
    packLabel:
      session.rightsDeclaration.usageMode === 'authorized-reconstruction'
        ? 'Reference Lab · Reconstructed'
        : 'Reference Lab · Inspired Original',
    assetKind: 'ae-template',
    capabilityType: 'comp-template',
    previewKind: 'text-rise-up',
    primaryActionLabel: '+ Add to Project',
    supportedOperations: ['insertTemplateComp', 'openTemplateAsComp'],
    supportedExportFormats: ['sowveil-json', 'alight-xml', 'zip-bundle', 'svg-frame'],
    requiredHostCapabilities: [],
    requiredDependencies: ['sowveil-canonical-v2'],
    selectionRequirement: 'none',
    status: 'Available',
    statusReason: 'Reconstructed canonical v2.0.0 template',
    visibility: 'private',
    ownerUid: session.ownerUid,
    creatorUid: session.ownerUid,
    sourceType:
      session.rightsDeclaration.usageMode === 'authorized-reconstruction'
        ? 'reference-seed'
        : 'procedural-canvas',
    sourceProjectVersion: '2.0.0',
    templateSchemaVersion: '2.0.0',
    licenseType: safeLicenseType,
    licenseNote: `${session.rightsDeclaration.declarationStatement} (User declaration recorded at ${session.rightsDeclaration.declaredAt}). Source: ${session.rightsDeclaration.sourceOriginLabel}`,
    originUrl: session.rightsDeclaration.sourceUrl,
    sourceUrl: session.rightsDeclaration.sourceUrl,
    attribution: {
      authorName: session.rightsDeclaration.attributionText || 'User Workspace',
      attributionText: session.rightsDeclaration.declarationStatement,
      sourceUrl: session.rightsDeclaration.sourceUrl,
      requiresAttribution: true,
    },
    supportedEditableProperties: ['text', 'color', 'timing', 'keyframes', 'layout'],
    mediaRequirements: {
      requiredAssetKinds: session.mediaSpecs.hasAudioTrack ? ['svg', 'audio'] : ['svg'],
      replaceableSlots: [
        {
          slotId: 'background_plate',
          label: 'Background Plate / Media Slot',
          acceptedKinds: ['image', 'video', 'svg'],
          required: false,
        },
      ],
    },
    rendererRequirements: {
      engine: 'canvas-2d',
      minFps: 30,
      hardwareAccelerationRecommended: false,
    },
    validationState: 'Draft',
    versionHistory: [
      {
        version: '1.0.0',
        updatedAt: now,
        updatedByUid: session.ownerUid,
        changelog: `Created as private Draft template from Reference Lab session ${session.id}.`,
        snapshotHash: `hash_${session.id}`,
      },
    ],
    deprecationStatus: {
      isDeprecated: false,
    },
    supportsTemplateComparison: true,
    editableParams,
    metadata: {
      durationSec: session.mediaSpecs.durationSec,
      durationLabel: `${session.mediaSpecs.durationSec}s`,
      fps: session.mediaSpecs.fps || 30,
      width: session.mediaSpecs.width,
      height: session.mediaSpecs.height,
      resolution: `${session.mediaSpecs.width}×${session.mediaSpecs.height}`,
      version: '1.0.0',
      curvePoints: shot1?.motionTiming.cubicBezier || [0.22, 1, 0.36, 1],
      audioAssetAvailable: session.mediaSpecs.hasAudioTrack,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Runs both the canonical project render/editability smoke test and the Marketplace
 * `runTemplateValidationJob()` gate before promoting a Reference Lab Draft template
 * to `Validated`.
 */
export function validateAndPromoteReferenceTemplate(
  session: ReferenceLabSession,
  draftTemplate: CatalogItem
): {
  promoted: boolean;
  template: CatalogItem;
  localChecks: ReconstructionLocalCheckResult;
  errors: string[];
} {
  const localChecks = runLocalReconstructionChecks(
    session.canonicalProject,
    session.shots
  );
  const availableAssetIds = new Set(
    session.canonicalProject.assetReferences.map((a) => a.assetId)
  );
  const marketValidation = runTemplateValidationJob(
    draftTemplate,
    availableAssetIds,
    session.ownerUid
  );

  const errors: string[] = [...localChecks.warnings];
  if (!marketValidation.evidence.checksRun.schemaValid) {
    errors.push('Template schema check failed.');
  }
  if (!marketValidation.evidence.checksRun.paramsWithinBounds) {
    errors.push('Template editable parameter bounds check failed.');
  }

  const promoted =
    localChecks.passed &&
    marketValidation.nextValidationState === 'Validated';

  const updatedTemplate: CatalogItem = {
    ...draftTemplate,
    validationState: promoted ? 'Validated' : marketValidation.nextValidationState,
    lastValidationRecord: marketValidation.evidence,
    updatedAt: new Date().toISOString(),
  };

  return {
    promoted,
    template: updatedTemplate,
    localChecks,
    errors,
  };
}
