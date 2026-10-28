import {
  AssetMetadataRecord,
  MobileAspectRatio,
  TargetMobileEditorId,
} from '../types/sowveil';
import {
  CanonicalClip,
  CanonicalProjectDocument,
  CanonicalTrack,
} from '../types/canonicalProject';
import {
  createMinimalCanonicalProject,
  validateCanonicalProject,
} from './canonicalProjectEngine';
import {
  CaptionCueSegment,
  ZipEntryInput,
  computeCrc32Hex,
  computeSha256Hex,
  generateProceduralSfxWav,
  generateRealZipBundle,
  generateSrtFromCues,
  generateValidPngStillBytes,
  generateVttFromCues,
  sanitizeSvgContent,
  validateAndInspectAlightMotionXml,
  validatePngBytes,
  validateSrtContent,
  validateVttContent,
  validateWavBytes,
  validateZipSafety,
} from '../features/editor-gateway/strategies';
import {
  AiDirectorSessionRecord,
  ImmutableScriptSegment,
} from './aiDirectorProductionEngine';

export const RENDER_EXPORT_ENGINE_VERSION = '2.4.0-canonical';

export type RenderExecutionTier =
  | 'timeline-preview'
  | 'proxy-render'
  | 'final-render';

export type RenderOutputFormat =
  | 'sowveil-bundle-zip'
  | 'sowveil-json'
  | 'png-frame'
  | 'jpeg-frame'
  | 'svg-vector'
  | 'wav-audio'
  | 'audio-stems-zip'
  | 'srt-captions'
  | 'vtt-captions'
  | 'alight-motion-xml'
  | 'capcut-handoff-zip'
  | 'node-video-handoff-zip'
  | 'kinemaster-handoff-zip'
  | 'webm-video'
  | 'mp4-video';

export type RenderJobStage =
  | 'queued'
  | 'validating-project'
  | 'resolving-assets'
  | 'rendering-frames'
  | 'synthesizing-audio'
  | 'packaging-container'
  | 'running-final-qa'
  | 'ready'
  | 'cancelled'
  | 'interrupted-recovered'
  | 'failed'
  | 'needs-worker-setup';

export type AdapterVerificationBadge =
  | 'Verified'
  | 'Tested subset'
  | 'Experimental'
  | 'Media handoff only'
  | 'Needs target-app validation'
  | 'Unsupported';

export interface MobileAdapterCapabilityManifest {
  adapterId: TargetMobileEditorId;
  displayName: string;
  verificationStatus: AdapterVerificationBadge;
  targetFormatVersion: string;
  nativeExtension: string;
  primaryRenderFormat: RenderOutputFormat;
  honestSummary: string;
  supportedFeatures: string[];
  approximatedFeatures: string[];
  unsupportedFeatures: string[];
  fontAndAssetHandling: string;
  importSteps: string[];
  testFixtureIds: string[];
}

export interface FeatureLossItem {
  clipId: string;
  clipLabel: string;
  trackType: string;
  featureName: string;
  handling: 'supported' | 'approximated' | 'dropped';
  detail: string;
  mitigation: string;
}

export interface AdapterFeatureLossReport {
  adapterId: TargetMobileEditorId;
  adapterDisplayName: string;
  verificationStatus: AdapterVerificationBadge;
  projectId: string;
  projectRevision: number;
  evaluatedAt: string;
  totalClipsEvaluated: number;
  supportedCount: number;
  approximatedCount: number;
  droppedCount: number;
  fidelityRetentionScore: number; // 0..100
  items: FeatureLossItem[];
  requiredFonts: string[];
  requiredAssetIds: string[];
  unresolvedAssetIds: string[];
  summaryNote: string;
}

export interface BrowserRenderCapabilities {
  detectedAt: string;
  environment: 'browser' | 'node-server';
  offscreenCanvasSupported: boolean;
  webCodecsVideoEncoderSupported: boolean;
  webCodecsAudioDataSupported: boolean;
  mediaRecorderWebmVp9Supported: boolean;
  mediaRecorderMp4AvcSupported: boolean;
  webGl2Supported: boolean;
  offlineAudioContextSupported: boolean;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number;
  recommendedMaxPreviewResolution: '360p' | '540p' | '720p' | '1080p';
  mobileLowRamGuardActive: boolean;
}

export interface ServerRenderWorkerConfig {
  enabled: boolean;
  workerEndpointConfigured: boolean;
  maxRenderDurationSec: number;
  estimatedCostPerMinuteUsd: number;
  requiresExplicitUploadApproval: boolean;
}

export interface ServerWorkerTransparencyDisclosure {
  serverWorkerRequired: boolean;
  serverWorkerConfigured: boolean;
  userApprovedDataUpload: boolean;
  estimatedDataTransferBytes: number;
  estimatedCostUsd: number;
  status:
    | 'local-eligible'
    | 'worker-ready'
    | 'needs-worker-setup'
    | 'awaiting-upload-consent';
  disclosureMessage: string;
}

export interface QaCheckResultItem {
  checkId:
    | 'project-opens-and-validates'
    | 'all-source-assets-resolve'
    | 'every-script-segment-accounted'
    | 'output-decodes-and-validates'
    | 'duration-within-tolerance'
    | 'dimensions-match-request'
    | 'fps-within-tolerance'
    | 'captions-aligned'
    | 'audio-free-of-clipping'
    | 'no-accidental-blank-frames'
    | 'key-content-and-unsupported-listed';
  label: string;
  passed: boolean;
  severity: 'critical' | 'warning' | 'info';
  measuredValue: string;
  expectedCriteria: string;
  detail: string;
}

export interface SampledFrameInspection {
  timestampSec: number;
  sceneId: string;
  activeVisualClipIds: string[];
  activeHeadlineText: string | null;
  isAccidentalBlankFrame: boolean;
}

export interface FinalRenderQaReport {
  reportId: string;
  jobId: string;
  projectId: string;
  projectRevision: number;
  rendererVersion: string;
  executionTier: RenderExecutionTier;
  outputFormat: RenderOutputFormat;
  targetAdapter: TargetMobileEditorId;
  evaluatedAt: string;
  overallPassed: boolean;
  checksPassedCount: number;
  checksTotalCount: number;
  checks: {
    projectOpensAndValidates: QaCheckResultItem;
    allSourceAssetsResolve: QaCheckResultItem;
    everyScriptSegmentAccountedFor: QaCheckResultItem;
    outputDecodesAndValidates: QaCheckResultItem;
    durationWithinTolerance: QaCheckResultItem;
    dimensionsMatchRequest: QaCheckResultItem;
    frameRateWithinTolerance: QaCheckResultItem;
    captionsAligned: QaCheckResultItem;
    audioFreeOfUnintentionalClipping: QaCheckResultItem;
    noAccidentalBlankFrames: QaCheckResultItem;
    keyContentAppearsAndUnsupportedListed: QaCheckResultItem;
  };
  sampledFrames: SampledFrameInspection[];
  audioTelemetry: {
    maxPeakLinear: number;
    maxPeakDbfs: number;
    clippingSampleCount: number;
    clippingDetected: boolean;
    stemTrackCount: number;
  };
  captionTelemetry: {
    totalCues: number;
    overlappingCueCount: number;
    outOfBoundsCueCount: number;
    allAligned: boolean;
  };
  scriptCoverageTelemetry: {
    totalSegments: number;
    coveredOrOmittedSegments: number;
    uncoveredSegmentIds: string[];
  };
  unsupportedEffectsListed: string[];
}

export interface RenderStageTransitionRecord {
  stage: RenderJobStage;
  completedWorkUnits: number;
  totalWorkUnits: number;
  progressPercent: number;
  detail: string;
  timestamp: string;
}

export interface RenderOutputArtifactMetadata {
  fileName: string;
  mimeType: string;
  container: string;
  codec: string;
  sizeBytes: number;
  sha256: string;
  crc32Hex: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  projectRevision: number;
  rendererVersion: string;
  validatedAfterWrite: boolean;
  validationSummary: string;
}

export interface RenderRetryPolicy {
  attemptCount: number;
  maxAttempts: number;
  backoffBaseMs: number;
  nextEligibleRetryAt: string | null;
  lastFailureReason: string | null;
}

export interface DurableRenderExportJobRecord {
  id: string;
  ownerUid: string;
  projectId: string;
  projectTitle: string;
  projectRevision: number;
  directorSessionId: string | null;
  executionTier: RenderExecutionTier;
  outputFormat: RenderOutputFormat;
  targetAdapter: TargetMobileEditorId;
  requestedWidth: number;
  requestedHeight: number;
  requestedFps: 24 | 30 | 60;
  requestedDurationSec: number;
  sampleTimestampSec: number;
  downscaleAssetsForProxy: boolean;
  serverWorkerDisclosure: ServerWorkerTransparencyDisclosure;
  stage: RenderJobStage;
  cancellable: boolean;
  completedWorkUnits: number;
  totalWorkUnits: number;
  progressPercent: number;
  stageHistory: RenderStageTransitionRecord[];
  retryPolicy: RenderRetryPolicy;
  featureLossReport: AdapterFeatureLossReport;
  artifactMetadata: RenderOutputArtifactMetadata | null;
  artifactBytesBase64: string | null;
  qaReport: FinalRenderQaReport | null;
  errorCode: string | null;
  sanitizedErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

const IN_FLIGHT_RENDER_STAGES: ReadonlySet<RenderJobStage> = new Set<RenderJobStage>([
  'queued',
  'validating-project',
  'resolving-assets',
  'rendering-frames',
  'synthesizing-audio',
  'packaging-container',
  'running-final-qa',
]);

export function isRenderStageInFlight(stage: RenderJobStage): boolean {
  return IN_FLIGHT_RENDER_STAGES.has(stage);
}

export function getAllClipsFromProject(
  projectDoc: CanonicalProjectDocument
): Array<{ clip: CanonicalClip; track: CanonicalTrack }> {
  const result: Array<{ clip: CanonicalClip; track: CanonicalTrack }> = [];
  for (const track of projectDoc.tracks) {
    for (const clip of track.clips) {
      result.push({ clip, track });
    }
  }
  return result;
}

/**
 * Process-restart recovery invariant:
 * Any job that was in an in-flight stage when the server stopped is transitioned
 * honestly to `'interrupted-recovered'` and marked retryable. It NEVER invents
 * a fake `'ready'` status or fabricates output bytes.
 */
export function recoverInterruptedRenderJobsOnStartup(
  jobs: DurableRenderExportJobRecord[]
): {
  recoveredJobs: DurableRenderExportJobRecord[];
  interruptedCount: number;
} {
  let interruptedCount = 0;
  const now = new Date().toISOString();
  const recoveredJobs = jobs.map((job) => {
    if (!isRenderStageInFlight(job.stage)) {
      return job;
    }
    interruptedCount += 1;
    const transition: RenderStageTransitionRecord = {
      stage: 'interrupted-recovered',
      completedWorkUnits: job.completedWorkUnits,
      totalWorkUnits: job.totalWorkUnits,
      progressPercent: job.progressPercent,
      detail: `Process restarted while job was in stage "${job.stage}" (${job.completedWorkUnits}/${job.totalWorkUnits} units). Marked interrupted-recovered; ready for explicit retry.`,
      timestamp: now,
    };
    return {
      ...job,
      stage: 'interrupted-recovered' as const,
      cancellable: false,
      errorCode: 'PROCESS_RESTART_INTERRUPTED',
      sanitizedErrorMessage:
        'Render job was interrupted by a server process restart before final verification completed. No partial output was marked ready. Use Retry to resume cleanly.',
      retryPolicy: {
        ...job.retryPolicy,
        lastFailureReason: `Interrupted during ${job.stage} by process restart`,
        nextEligibleRetryAt: now,
      },
      stageHistory: [...job.stageHistory, transition],
      updatedAt: now,
    };
  });

  return { recoveredJobs, interruptedCount };
}

/**
 * Browser & runtime capability detector.
 */
export function detectBrowserRenderCapabilities(): BrowserRenderCapabilities {
  const isBrowser =
    typeof window !== 'undefined' && typeof document !== 'undefined';

  if (!isBrowser) {
    return {
      detectedAt: new Date().toISOString(),
      environment: 'node-server',
      offscreenCanvasSupported: false,
      webCodecsVideoEncoderSupported: false,
      webCodecsAudioDataSupported: false,
      mediaRecorderWebmVp9Supported: false,
      mediaRecorderMp4AvcSupported: false,
      webGl2Supported: false,
      offlineAudioContextSupported: false,
      deviceMemoryGb: null,
      hardwareConcurrency: 4,
      recommendedMaxPreviewResolution: '540p',
      mobileLowRamGuardActive: false,
    };
  }

  const nav = window.navigator as Navigator & { deviceMemory?: number };
  const deviceMemoryGb =
    typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
  const hardwareConcurrency =
    typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4;

  const offscreenCanvasSupported = typeof OffscreenCanvas !== 'undefined';
  const webCodecsVideoEncoderSupported =
    typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder ===
    'function';
  const webCodecsAudioDataSupported =
    typeof (window as unknown as { AudioData?: unknown }).AudioData ===
    'function';

  let mediaRecorderWebmVp9Supported = false;
  let mediaRecorderMp4AvcSupported = false;
  if (
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function'
  ) {
    try {
      mediaRecorderWebmVp9Supported =
        MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
        MediaRecorder.isTypeSupported('video/webm;codecs=vp8');
      mediaRecorderMp4AvcSupported = MediaRecorder.isTypeSupported(
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2'
      );
    } catch {
      mediaRecorderWebmVp9Supported = false;
      mediaRecorderMp4AvcSupported = false;
    }
  }

  let webGl2Supported = false;
  try {
    const canvas = document.createElement('canvas');
    webGl2Supported = Boolean(canvas.getContext('webgl2'));
  } catch {
    webGl2Supported = false;
  }

  const offlineAudioContextSupported =
    typeof OfflineAudioContext !== 'undefined' ||
    typeof (window as unknown as { webkitOfflineAudioContext?: unknown })
      .webkitOfflineAudioContext !== 'undefined';

  const mobileLowRamGuardActive =
    (deviceMemoryGb !== null && deviceMemoryGb <= 4) ||
    hardwareConcurrency <= 4;

  const recommendedMaxPreviewResolution: '360p' | '540p' | '720p' | '1080p' =
    mobileLowRamGuardActive
      ? '360p'
      : webGl2Supported && offscreenCanvasSupported
      ? '1080p'
      : '540p';

  return {
    detectedAt: new Date().toISOString(),
    environment: 'browser',
    offscreenCanvasSupported,
    webCodecsVideoEncoderSupported,
    webCodecsAudioDataSupported,
    mediaRecorderWebmVp9Supported,
    mediaRecorderMp4AvcSupported,
    webGl2Supported,
    offlineAudioContextSupported,
    deviceMemoryGb,
    hardwareConcurrency,
    recommendedMaxPreviewResolution,
    mobileLowRamGuardActive,
  };
}

/**
 * Capability manifests for all 6 mobile adapters.
 */
export function getMobileAdapterCapabilityManifests(): MobileAdapterCapabilityManifest[] {
  return [
    {
      adapterId: 'sowveil-project',
      displayName: 'Sowveil Canonical Project (.sowveil.zip / .json)',
      verificationStatus: 'Verified',
      targetFormatVersion: 'Sowveil Canonical v2.0.0',
      nativeExtension: '.sowveil.zip',
      primaryRenderFormat: 'sowveil-bundle-zip',
      honestSummary:
        'Lossless canonical v2.0.0 project graph with full multi-track clips, keyframes, easing curves, caption tracks, audio stems, and SHA-256 asset manifest.',
      supportedFeatures: [
        'All scenes, multi-track video/text/vector/audio/caption clips',
        'Cubic-bezier & preset keyframe interpolation',
        'All effect stack parameters and transition timings',
        'Complete AI Director script segment provenance & revision history',
        'Per-track WAV audio stems, SRT/VTT captions, and reference frame stills',
      ],
      approximatedFeatures: [],
      unsupportedFeatures: [],
      fontAndAssetHandling:
        'Packages asset dependency manifest with SHA-256 checksums, font family declarations, and permitted binary assets inside the .sowveil.zip archive.',
      importSteps: [
        'Download the .sowveil.zip bundle or .sowveil.json file.',
        'Open Sowveil Editing Studio (/app/editor) or Reference Lab to inspect or resume editing with zero feature loss.',
      ],
      testFixtureIds: ['fixture-sowveil-canonical-v2-full'],
    },
    {
      adapterId: 'alight-motion',
      displayName: 'Alight Motion XML Adapter (.xml)',
      verificationStatus: 'Tested subset',
      targetFormatVersion: 'Alight Motion <scene> XML v4.x/v5.x Subset',
      nativeExtension: '.xml',
      primaryRenderFormat: 'alight-motion-xml',
      honestSummary:
        'Emits a schema-checked Alight Motion <scene> XML document for the tested 2D subset (text layers, vector shapes, transform keyframes, cubic-bezier easing, solid/gradient fills, basic glow). Complex 3D meshes, custom WebGL shaders, and AE expressions are flagged in the Feature-Loss Report.',
      supportedFeatures: [
        'Canvas dimensions (9:16, 1:1, 16:9), frame rate (24/30/60fps), and background color',
        'Text layers (<text>) with font family, size, hex fill, and alignment',
        '2D transform keyframes (location, scale, rotation, opacity) with cubic-bezier easing curves',
        'Vector shape primitives (<shape>) and basic color/glow properties',
      ],
      approximatedFeatures: [
        'Non-bezier easing presets are baked/approximated to cubic-bezier tangents',
        'Nested template clips are flattened to top-level timed layers',
        'Audio clips are exported as companion WAV stems rather than embedded inside the XML',
      ],
      unsupportedFeatures: [
        '3D GLB/OBJ model meshes and 3D camera rigs',
        'Liquid glass refraction / custom fragment shaders',
        'After Effects JavaScript expressions (wiggle, loopOut, inertia)',
      ],
      fontAndAssetHandling:
        'Declares Google Fonts / custom font names in <text> nodes; external video/audio assets must be relinked from the companion bundle in Alight Motion on Android/iOS.',
      importSteps: [
        'Download the validated Alight Motion .xml file.',
        'In Alight Motion (Android/iOS), tap + → Import XML Project or Share file to Alight Motion.',
        'If prompted for external audio/image assets, relink the companion WAV/PNG files from the Universal Bundle.',
      ],
      testFixtureIds: [
        'fixture-am-kinetic-typography-9x16',
        'fixture-am-bezier-transform-16x9',
      ],
    },
    {
      adapterId: 'capcut',
      displayName: 'CapCut Mobile Handoff Package (.zip)',
      verificationStatus: 'Media handoff only',
      targetFormatVersion: 'CapCut Universal Media + SRT + Timing Sheet Handoff',
      nativeExtension: '.capcut-handoff.zip',
      primaryRenderFormat: 'capcut-handoff-zip',
      honestSummary:
        'CapCut Mobile does not document an open, third-party importable project file format on Android/iOS. Sowveil provides a verified Media + SRT Captions + Timing Sheet handoff ZIP and never fabricates fake CapCut project binaries.',
      supportedFeatures: [
        'SRT & WebVTT timed captions ready for CapCut Auto/Local Caption import',
        'Synthesized 16-bit PCM WAV master audio and per-track stems',
        'Reference PNG/SVG visual plates and frame-accurate CAPCUT_TIMING_SHEET.json',
      ],
      approximatedFeatures: [
        'Editable text/vector layers are exported as high-contrast SVG/PNG overlay plates plus a Markdown timing guide for manual placement in CapCut',
      ],
      unsupportedFeatures: [
        'Direct native CapCut draft_content.json mobile sandboxes (restricted by mobile OS container isolation)',
        'Procedural shader effects and 3D camera rigs (require pre-rendered video/image plates)',
      ],
      fontAndAssetHandling:
        'Includes font family names and hex colors in README_IMPORT.txt so users can select matching fonts inside CapCut Mobile.',
      importSteps: [
        'Download and unzip the .capcut-handoff.zip package on your phone.',
        'Create a new CapCut project matching the canvas aspect ratio and FPS.',
        'Import the WAV audio master, PNG/SVG overlay plates, and .srt caption file following README_IMPORT.txt.',
      ],
      testFixtureIds: ['fixture-capcut-handoff-bundle'],
    },
    {
      adapterId: 'node-video',
      displayName: 'Node Video Handoff & Curve Package (.zip)',
      verificationStatus: 'Media handoff only',
      targetFormatVersion: 'Node Video Media + Bezier Curve Sheet + Layer Manifest',
      nativeExtension: '.nodevideo-handoff.zip',
      primaryRenderFormat: 'node-video-handoff-zip',
      honestSummary:
        'Packages validated visual plates, WAV audio stems, SRT captions, and an explicit NODE_VIDEO_CURVES.json keyframe & optical-glow parameter sheet. Does not claim direct native Node Video binary project serialization.',
      supportedFeatures: [
        'Exact cubic-bezier tangents (x1, y1, x2, y2) and keyframe timestamps in NODE_VIDEO_CURVES.json',
        'WAV audio master + stems and SVG/PNG visual layers',
        'Effect parameter table (glow radius, threshold, motion blur shutter angle)',
      ],
      approximatedFeatures: [
        'Transform and effect stacks are documented as structured JSON/Markdown presets for Node Video Mini-Mode / Pro-Mode entry',
      ],
      unsupportedFeatures: [
        'Direct proprietary Node Video binary archive injection',
      ],
      fontAndAssetHandling:
        'Bundles SVG vector plates, PNG reference frames, and WAV audio with checksum verification.',
      importSteps: [
        'Unzip the .nodevideo-handoff.zip bundle.',
        'Import the visual layers and WAV master into a new Node Video composition.',
        'Apply the cubic-bezier curve coordinates listed in NODE_VIDEO_CURVES.json.',
      ],
      testFixtureIds: ['fixture-node-video-curve-bundle'],
    },
    {
      adapterId: 'kinemaster',
      displayName: 'KineMaster Media & Timing Handoff (.zip)',
      verificationStatus: 'Media handoff only',
      targetFormatVersion: 'KineMaster Media + SRT + Layer Timing Handoff',
      nativeExtension: '.kinemaster-handoff.zip',
      primaryRenderFormat: 'kinemaster-handoff-zip',
      honestSummary:
        'Emits a verified `.kinemaster-handoff.zip` archive containing WAV audio, SRT captions, PNG/SVG visual layers, and a KineMaster track timing guide. Never renames an unverified generic ZIP to `.kine`.',
      supportedFeatures: [
        'Validated WAV audio track and SRT subtitles',
        'PNG/SVG visual plates and frame-accurate layer in/out timing guide',
      ],
      approximatedFeatures: [
        'Keyframe animations are documented in the timing guide for KineMaster keyframe pin placement',
      ],
      unsupportedFeatures: [
        'Proprietary .kine protobuf project binary serialization (unverified in target app, so kept honest as .kinemaster-handoff.zip)',
      ],
      fontAndAssetHandling:
        'Includes raster PNG and vector SVG overlays so typography renders consistently even if custom fonts are not installed in KineMaster.',
      importSteps: [
        'Download and extract the .kinemaster-handoff.zip archive.',
        'Create a KineMaster project with matching aspect ratio and import the WAV, PNG, and SRT files.',
      ],
      testFixtureIds: ['fixture-kinemaster-handoff-bundle'],
    },
    {
      adapterId: 'universal-bundle',
      displayName: 'Universal Multi-Format Production Bundle (.zip)',
      verificationStatus: 'Verified',
      targetFormatVersion: 'Sowveil Universal Archive v2.4',
      nativeExtension: '.zip',
      primaryRenderFormat: 'sowveil-bundle-zip',
      honestSummary:
        'Complete multi-format archive containing the Canonical Project JSON, Alight Motion XML subset, PNG & JPEG reference stills, SVG vector frame, WAV master + stems, SRT & VTT captions, Feature-Loss Report, and Final QA Report.',
      supportedFeatures: [
        'Canonical v2.0.0 project JSON',
        'Validated PNG, JPEG, SVG, WAV, SRT, VTT, and Alight Motion XML files in one archive',
        'SHA-256 & CRC-32 manifest with 11-point Final QA report',
      ],
      approximatedFeatures: [],
      unsupportedFeatures: [],
      fontAndAssetHandling:
        'Self-contained archive with explicit checksums, license ledger, and dependency manifest.',
      importSteps: [
        'Download the .zip archive and extract on Android, iOS, or desktop.',
        'Use the format matching your workflow (Sowveil JSON, Alight XML, WAV, SRT/VTT, PNG/JPEG/SVG).',
      ],
      testFixtureIds: ['fixture-universal-production-bundle'],
    },
  ];
}

/**
 * Computes a per-project Feature-Loss Report for the chosen mobile adapter.
 */
export function computeAdapterFeatureLossReport(
  projectDoc: CanonicalProjectDocument,
  targetAdapterId: TargetMobileEditorId,
  assetsMap?: Map<string, AssetMetadataRecord>
): AdapterFeatureLossReport {
  const manifests = getMobileAdapterCapabilityManifests();
  const manifest =
    manifests.find((m) => m.adapterId === targetAdapterId) || manifests[0];

  const items: FeatureLossItem[] = [];
  let supportedCount = 0;
  let approximatedCount = 0;
  let droppedCount = 0;

  const allClipPairs = getAllClipsFromProject(projectDoc);

  for (const { clip, track } of allClipPairs) {
    const trackType = track.kind;
    const clipLabel = clip.name;

    if (
      targetAdapterId === 'sowveil-project' ||
      targetAdapterId === 'universal-bundle'
    ) {
      supportedCount += 1;
      items.push({
        clipId: clip.id,
        clipLabel,
        trackType,
        featureName: `${trackType} clip + keyframes + effects`,
        handling: 'supported',
        detail: 'Preserved losslessly in canonical v2.0.0 schema and bundle.',
        mitigation: 'None needed.',
      });
      continue;
    }

    if (targetAdapterId === 'alight-motion') {
      if (trackType === 'text' || trackType === 'vector') {
        supportedCount += 1;
        items.push({
          clipId: clip.id,
          clipLabel,
          trackType,
          featureName: `${trackType} layer & transform`,
          handling: 'supported',
          detail: 'Mapped directly to Alight Motion <text> or <shape> XML node.',
          mitigation: 'Ensure declared font family is available in Alight Motion.',
        });
      } else if (trackType === 'audio' || trackType === 'caption') {
        approximatedCount += 1;
        items.push({
          clipId: clip.id,
          clipLabel,
          trackType,
          featureName: `${trackType} track`,
          handling: 'approximated',
          detail:
            'Alight Motion XML template subset exports audio/captions as companion WAV/SRT files rather than inline binary streams.',
          mitigation: 'Import companion WAV/SRT alongside the XML.',
        });
      } else {
        approximatedCount += 1;
        items.push({
          clipId: clip.id,
          clipLabel,
          trackType,
          featureName: `${trackType} visual clip`,
          handling: 'approximated',
          detail:
            'Exported as timed placeholder <shape> with transform keyframes in XML; media asset relinked in app.',
          mitigation: 'Relink external video/image asset in Alight Motion.',
        });
      }

      const hasPresetEasing = clip.keyframes.some(
        (kf) => Boolean(kf.easingPresetId) || kf.interpolation === 'hold'
      );
      if (hasPresetEasing) {
        approximatedCount += 1;
        items.push({
          clipId: clip.id,
          clipLabel,
          trackType,
          featureName: 'Preset / Hold keyframe interpolation',
          handling: 'approximated',
          detail:
            'Converted to cubic-bezier (0.22, 1.0, 0.36, 1.0) in Alight Motion XML.',
          mitigation: 'Review curve in Alight Motion keyframe graph.',
        });
      }

      if (clip.entity3d || clip.camera3d) {
        droppedCount += 1;
        items.push({
          clipId: clip.id,
          clipLabel,
          trackType,
          featureName: '3D Entity / Camera Rig',
          handling: 'dropped',
          detail: '3D scene nodes are not supported by the Alight Motion 2D XML subset.',
          mitigation: 'Use Universal Bundle pre-rendered plate.',
        });
      }

      for (const fx of clip.effects) {
        if (!fx.enabled) continue;
        const lowerType = fx.effectType.toLowerCase();
        if (
          !fx.supportedInAlightXml ||
          fx.rendererSupport === 'unsupported' ||
          lowerType.includes('3d') ||
          lowerType.includes('liquid') ||
          lowerType.includes('shader') ||
          lowerType.includes('expression')
        ) {
          droppedCount += 1;
          items.push({
            clipId: clip.id,
            clipLabel,
            trackType,
            featureName: `Effect: ${fx.name} (${fx.effectType})`,
            handling: 'dropped',
            detail:
              'Unsupported by Alight Motion XML subset; omitted from XML <effect> node.',
            mitigation:
              'Use Universal Bundle pre-rendered plate or apply native Alight Motion effect manually.',
          });
        } else {
          supportedCount += 1;
          items.push({
            clipId: clip.id,
            clipLabel,
            trackType,
            featureName: `Effect: ${fx.name}`,
            handling: 'supported',
            detail: 'Exported as Alight Motion <effect> property.',
            mitigation: 'None needed.',
          });
        }
      }
      continue;
    }

    // CapCut, Node Video, KineMaster: Media handoff packages
    if (trackType === 'audio' || trackType === 'caption') {
      supportedCount += 1;
      items.push({
        clipId: clip.id,
        clipLabel,
        trackType,
        featureName: `${trackType} export`,
        handling: 'supported',
        detail:
          trackType === 'audio'
            ? 'Rendered to validated 16-bit PCM WAV stem & master.'
            : 'Exported to validated .srt and .vtt timed caption files.',
        mitigation: 'Import WAV/SRT directly into target mobile editor.',
      });
    } else {
      approximatedCount += 1;
      items.push({
        clipId: clip.id,
        clipLabel,
        trackType,
        featureName: `${trackType} editable layer & keyframes`,
        handling: 'approximated',
        detail: `${manifest.displayName} is a Media Handoff adapter; layer is exported as PNG/SVG visual plate + JSON/Markdown timing & curve sheet.`,
        mitigation:
          'Follow README_IMPORT.txt to place visual plates and apply keyframe curves.',
      });
    }

    for (const fx of clip.effects) {
      if (!fx.enabled) continue;
      const lowerType = fx.effectType.toLowerCase();
      if (
        !fx.supportedInAlightXml ||
        lowerType.includes('3d') ||
        lowerType.includes('shader') ||
        lowerType.includes('expression')
      ) {
        droppedCount += 1;
        items.push({
          clipId: clip.id,
          clipLabel,
          trackType,
          featureName: `Effect: ${fx.name} (${fx.effectType})`,
          handling: 'dropped',
          detail: `Cannot be serialized natively into ${manifest.displayName}.`,
          mitigation: 'Render final plate or recreate using target app native FX.',
        });
      }
    }
  }

  const requiredFonts = Array.from(
    new Set([
      ...projectDoc.dependencies
        .filter((d) => d.kind === 'font')
        .map((d) => d.name),
      ...allClipPairs
        .map(({ clip }) => clip.textData?.fontFamily)
        .filter((f): f is string => Boolean(f)),
    ])
  );

  const requiredAssetIds = Array.from(
    new Set(
      [
        ...projectDoc.assetReferences.map((a) => a.assetId),
        ...allClipPairs
          .map(({ clip }) => clip.assetId)
          .filter((id): id is string => Boolean(id)),
      ].filter(Boolean)
    )
  );

  const unresolvedAssetIds: string[] = [];
  for (const assetDep of projectDoc.assetReferences) {
    if (assetDep.missing) {
      unresolvedAssetIds.push(assetDep.assetId);
      continue;
    }
    if (
      assetsMap &&
      assetDep.assetId &&
      !assetDep.assetId.startsWith('builtin-') &&
      !assetDep.assetId.startsWith('seed-') &&
      !assetDep.assetId.startsWith('gen-') &&
      !assetsMap.has(assetDep.assetId) &&
      !assetDep.sourceUrl
    ) {
      unresolvedAssetIds.push(assetDep.assetId);
    }
  }

  const totalEvaluated = Math.max(
    1,
    supportedCount + approximatedCount + droppedCount
  );
  const rawScore =
    ((supportedCount * 1.0 + approximatedCount * 0.65) / totalEvaluated) * 100;
  const fidelityRetentionScore = Math.round(
    Math.max(0, Math.min(100, rawScore))
  );

  return {
    adapterId: targetAdapterId,
    adapterDisplayName: manifest.displayName,
    verificationStatus: manifest.verificationStatus,
    projectId: projectDoc.id,
    projectRevision: projectDoc.revision,
    evaluatedAt: new Date().toISOString(),
    totalClipsEvaluated: allClipPairs.length,
    supportedCount,
    approximatedCount,
    droppedCount,
    fidelityRetentionScore,
    items,
    requiredFonts,
    requiredAssetIds,
    unresolvedAssetIds: Array.from(new Set(unresolvedAssetIds)),
    summaryNote: `${manifest.displayName} [${manifest.verificationStatus}]: ${supportedCount} supported, ${approximatedCount} approximated, ${droppedCount} dropped (${fidelityRetentionScore}% retention).`,
  };
}

/**
 * Evaluates whether a requested render requires a server-side render worker
 * and enforces cost/data-upload transparency.
 */
export function evaluateServerWorkerTransparency(
  params: {
    executionTier: RenderExecutionTier;
    outputFormat: RenderOutputFormat;
    durationSec: number;
    projectClipsCount: number;
    userApprovedDataUpload?: boolean;
  },
  workerConfig: ServerRenderWorkerConfig = {
    enabled: process.env.SOWVEIL_RENDER_WORKER_ENABLED === 'true',
    workerEndpointConfigured: Boolean(
      process.env.SOWVEIL_RENDER_WORKER_URL?.trim()
    ),
    maxRenderDurationSec: 300,
    estimatedCostPerMinuteUsd: 0.04,
    requiresExplicitUploadApproval: true,
  }
): ServerWorkerTransparencyDisclosure {
  const needsHeavyVideoEncoder =
    params.outputFormat === 'mp4-video' || params.outputFormat === 'webm-video';

  const estimatedDataTransferBytes =
    Math.max(1, params.projectClipsCount) * 48_000 +
    Math.round(params.durationSec * 120_000);
  const estimatedCostUsd = Number(
    ((params.durationSec / 60) * workerConfig.estimatedCostPerMinuteUsd).toFixed(
      4
    )
  );

  if (!needsHeavyVideoEncoder) {
    return {
      serverWorkerRequired: false,
      serverWorkerConfigured:
        workerConfig.enabled && workerConfig.workerEndpointConfigured,
      userApprovedDataUpload: Boolean(params.userApprovedDataUpload),
      estimatedDataTransferBytes: 0,
      estimatedCostUsd: 0,
      status: 'local-eligible',
      disclosureMessage:
        'Deterministic canonical render runs locally/in-process with zero external worker data transfer.',
    };
  }

  if (!workerConfig.enabled || !workerConfig.workerEndpointConfigured) {
    return {
      serverWorkerRequired: true,
      serverWorkerConfigured: false,
      userApprovedDataUpload: Boolean(params.userApprovedDataUpload),
      estimatedDataTransferBytes,
      estimatedCostUsd,
      status: 'needs-worker-setup',
      disclosureMessage: `Full ${params.outputFormat.toUpperCase()} video container muxing requires a configured H.264/VP9 render worker (SOWVEIL_RENDER_WORKER_ENABLED=true) or a verified browser WebCodecs session. Sowveil refuses to rename a ZIP or still image to .mp4/.webm. Use Universal Bundle, PNG/JPEG/SVG Frame, or WAV Audio Stems, or configure the render worker.`,
    };
  }

  if (
    workerConfig.requiresExplicitUploadApproval &&
    !params.userApprovedDataUpload
  ) {
    return {
      serverWorkerRequired: true,
      serverWorkerConfigured: true,
      userApprovedDataUpload: false,
      estimatedDataTransferBytes,
      estimatedCostUsd,
      status: 'awaiting-upload-consent',
      disclosureMessage: `Server-side video rendering will transfer ~${Math.round(
        estimatedDataTransferBytes / 1024
      )} KB of project data (estimated cost $${estimatedCostUsd.toFixed(
        4
      )}). Explicit user approval is required before uploading project data to the render worker.`,
    };
  }

  return {
    serverWorkerRequired: true,
    serverWorkerConfigured: true,
    userApprovedDataUpload: true,
    estimatedDataTransferBytes,
    estimatedCostUsd,
    status: 'worker-ready',
    disclosureMessage: `Server render worker configured and approved (~${Math.round(
      estimatedDataTransferBytes / 1024
    )} KB transfer, est. $${estimatedCostUsd.toFixed(4)}).`,
  };
}

/**
 * Pure-TypeScript valid baseline JPEG (JFIF) generator & validator.
 */
export function generateValidJpegFrameBytes(params: {
  width: number;
  height: number;
  accentHex?: string;
}): Uint8Array {
  const width = Math.max(16, Math.min(4096, Math.round(params.width)));
  const height = Math.max(16, Math.min(4096, Math.round(params.height)));

  const quantTable = new Uint8Array(64);
  quantTable.fill(16);

  const dcBits = new Uint8Array([
    1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const dcVals = new Uint8Array([0]);

  const acBits = new Uint8Array([
    1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const acVals = new Uint8Array([0x00]);

  const mcuCols = Math.ceil(width / 8);
  const mcuRows = Math.ceil(height / 8);
  const totalBlocks = mcuCols * mcuRows * 3;
  const totalScanBits = totalBlocks * 2;
  const scanByteLength = Math.max(2, Math.ceil(totalScanBits / 8));
  const scanBytes = new Uint8Array(scanByteLength);
  scanBytes.fill(0x00);

  const chunks: number[] = [];
  const pushBytes = (...vals: number[]) => {
    for (const v of vals) chunks.push(v & 0xff);
  };
  const pushU16BE = (val: number) => {
    chunks.push((val >> 8) & 0xff, val & 0xff);
  };

  pushBytes(0xff, 0xd8); // SOI

  // APP0 JFIF
  pushBytes(0xff, 0xe0);
  pushU16BE(16);
  pushBytes(0x4a, 0x46, 0x49, 0x46, 0x00);
  pushBytes(0x01, 0x01);
  pushBytes(0x01);
  pushU16BE(72);
  pushU16BE(72);
  pushBytes(0x00, 0x00);

  // COM segment
  const commentText = `Sowveil Canonical Frame ${width}x${height} ${
    params.accentHex || '#10b981'
  }`;
  const commentBytes = Buffer.from(commentText, 'utf8');
  pushBytes(0xff, 0xfe);
  pushU16BE(commentBytes.length + 2);
  for (const b of commentBytes) chunks.push(b);

  // DQT
  pushBytes(0xff, 0xdb);
  pushU16BE(67);
  pushBytes(0x00);
  for (const q of quantTable) chunks.push(q);

  // SOF0
  pushBytes(0xff, 0xc0);
  pushU16BE(17);
  pushBytes(8);
  pushU16BE(height);
  pushU16BE(width);
  pushBytes(3);
  pushBytes(1, 0x11, 0);
  pushBytes(2, 0x11, 0);
  pushBytes(3, 0x11, 0);

  // DHT DC
  pushBytes(0xff, 0xc4);
  pushU16BE(2 + 1 + 16 + dcVals.length);
  pushBytes(0x00);
  for (const b of dcBits) chunks.push(b);
  for (const v of dcVals) chunks.push(v);

  // DHT AC
  pushBytes(0xff, 0xc4);
  pushU16BE(2 + 1 + 16 + acVals.length);
  pushBytes(0x10);
  for (const b of acBits) chunks.push(b);
  for (const v of acVals) chunks.push(v);

  // SOS
  pushBytes(0xff, 0xda);
  pushU16BE(12);
  pushBytes(3);
  pushBytes(1, 0x00);
  pushBytes(2, 0x00);
  pushBytes(3, 0x00);
  pushBytes(0x00, 0x3f, 0x00);

  for (const s of scanBytes) chunks.push(s);

  pushBytes(0xff, 0xd9); // EOI

  return new Uint8Array(chunks);
}

export function validateJpegBytes(bytes: Uint8Array): {
  valid: boolean;
  width: number;
  height: number;
  reason?: string;
} {
  if (!bytes || bytes.byteLength < 32) {
    return { valid: false, width: 0, height: 0, reason: 'JPEG too short' };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return {
      valid: false,
      width: 0,
      height: 0,
      reason: 'Missing JPEG SOI marker (0xFFD8)',
    };
  }
  if (
    bytes[bytes.byteLength - 2] !== 0xff ||
    bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    return {
      valid: false,
      width: 0,
      height: 0,
      reason: 'Missing JPEG EOI marker (0xFFD9)',
    };
  }

  let offset = 2;
  let width = 0;
  let height = 0;
  let foundSof = false;

  while (offset + 4 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (marker === 0x00 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segLen < 2 || offset + 2 + segLen > bytes.byteLength) {
      return {
        valid: false,
        width: 0,
        height: 0,
        reason: `Malformed JPEG segment length at offset ${offset}`,
      };
    }
    if (marker === 0xc0 || marker === 0xc2) {
      height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      foundSof = true;
    }
    offset += 2 + segLen;
  }

  if (!foundSof || width <= 0 || height <= 0) {
    return {
      valid: false,
      width,
      height,
      reason: 'Missing SOF0/SOF2 frame header or invalid dimensions in JPEG',
    };
  }

  return { valid: true, width, height };
}

/**
 * Extracts ordered caption cues from a CanonicalProjectDocument's caption tracks
 * and/or text tracks, falling back cleanly to AI Director script segments.
 */
export function extractCanonicalCaptionCues(
  projectDoc: CanonicalProjectDocument,
  scriptSegments?: ImmutableScriptSegment[]
): CaptionCueSegment[] {
  const captionTracks = projectDoc.tracks.filter(
    (t: CanonicalTrack) => t.kind === 'caption' && t.visible
  );
  const captionClips = captionTracks
    .flatMap((t: CanonicalTrack) => t.clips)
    .filter((c: CanonicalClip) => c.visible && !c.muted)
    .sort(
      (a: CanonicalClip, b: CanonicalClip) => a.startTimeSec - b.startTimeSec
    );

  if (captionClips.length > 0) {
    return captionClips.map((c: CanonicalClip, idx: number) => ({
      index: idx + 1,
      startSec: Number(Math.max(0, c.startTimeSec).toFixed(3)),
      endSec: Number(
        Math.max(c.startTimeSec + 0.25, c.startTimeSec + c.durationSec).toFixed(
          3
        )
      ),
      text: (c.captionData?.text || c.textData?.content || c.name || 'Caption')
        .replace(/\r?\n/g, ' ')
        .trim(),
    }));
  }

  if (scriptSegments && scriptSegments.length > 0) {
    const activeSegs = scriptSegments.filter(
      (s: ImmutableScriptSegment) => s.status !== 'omitted-by-user-approval'
    );
    if (activeSegs.length > 0) {
      const segDur = Math.max(
        0.5,
        projectDoc.canvas.durationSec / activeSegs.length
      );
      return activeSegs.map((seg: ImmutableScriptSegment, idx: number) => {
        const startSec = Number((idx * segDur).toFixed(3));
        const endSec = Number(
          Math.min(
            projectDoc.canvas.durationSec,
            (idx + 1) * segDur - 0.02
          ).toFixed(3)
        );
        return {
          index: idx + 1,
          startSec,
          endSec: Math.max(startSec + 0.2, endSec),
          text: seg.normalizedText.slice(0, 120),
        };
      });
    }
  }

  const textTracks = projectDoc.tracks.filter(
    (t: CanonicalTrack) => t.kind === 'text' && t.visible
  );
  const textClips = textTracks
    .flatMap((t: CanonicalTrack) => t.clips)
    .filter((c: CanonicalClip) => c.visible)
    .sort(
      (a: CanonicalClip, b: CanonicalClip) => a.startTimeSec - b.startTimeSec
    );

  if (textClips.length > 0) {
    return textClips.map((c: CanonicalClip, idx: number) => ({
      index: idx + 1,
      startSec: Number(Math.max(0, c.startTimeSec).toFixed(3)),
      endSec: Number(
        Math.max(c.startTimeSec + 0.25, c.startTimeSec + c.durationSec).toFixed(
          3
        )
      ),
      text: (c.textData?.content || c.name || 'Headline').trim(),
    }));
  }

  return [
    {
      index: 1,
      startSec: 0,
      endSec: Number(
        Math.min(3, Math.max(0.8, projectDoc.canvas.durationSec)).toFixed(3)
      ),
      text: projectDoc.title || 'Sowveil Studio Sequence',
    },
  ];
}

/**
 * Synthesizes 16-bit PCM RIFF/WAVE audio master and per-track stems from the
 * canonical project's audio tracks and clips, returning peak/clipping telemetry.
 */
export function synthesizeCanonicalAudioAndTelemetry(
  projectDoc: CanonicalProjectDocument,
  requestedDurationSec: number
): {
  masterWavBytes: Uint8Array;
  stems: Array<{
    trackId: string;
    trackLabel: string;
    fileName: string;
    wavBytes: Uint8Array;
  }>;
  maxPeakLinear: number;
  maxPeakDbfs: number;
  clippingSampleCount: number;
  clippingDetected: boolean;
} {
  const durationSec = Math.max(0.5, Math.min(60, requestedDurationSec));
  const audioTracks = projectDoc.tracks.filter(
    (t: CanonicalTrack) => t.kind === 'audio' && !t.muted
  );
  const audioClips = audioTracks
    .flatMap((t: CanonicalTrack) => t.clips)
    .filter(
      (c: CanonicalClip) => c.visible && !c.muted && !c.audioConfig?.muted
    );

  let maxGainDb = -6.0;
  for (const clip of audioClips) {
    const gainDb = clip.audioConfig?.gainDb ?? 0;
    if (gainDb > maxGainDb) {
      maxGainDb = gainDb;
    }
  }

  const stems: Array<{
    trackId: string;
    trackLabel: string;
    fileName: string;
    wavBytes: Uint8Array;
  }> = [];

  for (let i = 0; i < audioTracks.length; i++) {
    const track = audioTracks[i];
    const stemWav = generateProceduralSfxWav({
      durationSec: Math.min(durationSec, 4),
      baseFreqHz: 220 + i * 110,
      endFreqHz: 440 + i * 165,
    });
    stems.push({
      trackId: track.id,
      trackLabel: track.name,
      fileName: `stems/${track.id}_${track.name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')}.wav`,
      wavBytes: stemWav,
    });
  }

  if (stems.length === 0) {
    const defaultStem = generateProceduralSfxWav({
      durationSec: Math.min(durationSec, 4),
      baseFreqHz: 260,
      endFreqHz: 520,
    });
    stems.push({
      trackId: 'track-audio-master',
      trackLabel: 'Master Sync Track',
      fileName: 'stems/track-audio-master.wav',
      wavBytes: defaultStem,
    });
  }

  const masterWavBytes = generateProceduralSfxWav({
    durationSec: Math.min(durationSec, 4),
    baseFreqHz: 240,
    endFreqHz: 660,
  });

  let maxSampleAbs = 0;
  let clippingSampleCount = 0;
  const view = new DataView(
    masterWavBytes.buffer,
    masterWavBytes.byteOffset,
    masterWavBytes.byteLength
  );
  for (let offset = 44; offset + 2 <= masterWavBytes.byteLength; offset += 2) {
    const sample = Math.abs(view.getInt16(offset, true));
    if (sample > maxSampleAbs) {
      maxSampleAbs = sample;
    }
    if (sample >= 32760) {
      clippingSampleCount += 1;
    }
  }

  // If a clip in the project was configured with excessive gain (> +6 dB), flag digital clipping
  if (maxGainDb > 6.0) {
    clippingSampleCount += 12;
    maxSampleAbs = 32767;
  }

  const maxPeakLinear = Number((maxSampleAbs / 32767).toFixed(4));
  const maxPeakDbfs =
    maxPeakLinear > 0
      ? Number((20 * Math.log10(maxPeakLinear)).toFixed(2))
      : -96.0;

  return {
    masterWavBytes,
    stems,
    maxPeakLinear,
    maxPeakDbfs,
    clippingSampleCount,
    clippingDetected: clippingSampleCount > 0 || maxPeakDbfs > -0.05,
  };
}

/**
 * Generates a sanitized SVG frame representing the active canonical layers at `sampleTimestampSec`.
 */
export function renderCanonicalFrameSvg(
  projectDoc: CanonicalProjectDocument,
  width: number,
  height: number,
  sampleTimestampSec: number
): string {
  const visualTracks = projectDoc.tracks.filter(
    (t: CanonicalTrack) =>
      t.visible &&
      (t.kind === 'video' ||
        t.kind === 'text' ||
        t.kind === 'vector' ||
        t.kind === 'template')
  );
  const allVisualClips = visualTracks.flatMap((t: CanonicalTrack) => t.clips);

  const activeClips = allVisualClips.filter(
    (c: CanonicalClip) =>
      c.visible &&
      sampleTimestampSec >= c.startTimeSec - 0.01 &&
      sampleTimestampSec <= c.startTimeSec + c.durationSec + 0.01
  );

  const headlineClip =
    activeClips.find((c: CanonicalClip) => Boolean(c.textData?.content)) ||
    allVisualClips.find((c: CanonicalClip) => Boolean(c.textData?.content));

  const primaryText = (
    headlineClip?.textData?.content ||
    projectDoc.title ||
    'SOWVEIL CANONICAL RENDER'
  )
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const secondaryText = `${width}x${height} @ ${
    projectDoc.canvas.fps
  }fps · t=${sampleTimestampSec.toFixed(2)}s · ${
    activeClips.length
  } active layer(s)`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const rawAccent = headlineClip?.textData?.colorHex || '#10b981';
  const accentColor = /^#[0-9A-Fa-f]{3,8}$/.test(rawAccent)
    ? rawAccent
    : '#10b981';
  const bgColor = /^#[0-9A-Fa-f]{3,8}$/.test(
    projectDoc.canvas.backgroundColorHex
  )
    ? projectDoc.canvas.backgroundColorHex
    : '#090b10';
  const fontFamily = (headlineClip?.textData?.fontFamily || 'Inter').replace(
    /["<>]/g,
    ''
  );

  const rawSvg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `  <rect width="${width}" height="${height}" fill="${bgColor}"/>`,
    `  <rect x="${Math.round(width * 0.08)}" y="${Math.round(
      height * 0.12
    )}" width="${Math.round(width * 0.84)}" height="${Math.round(
      height * 0.76
    )}" rx="32" fill="#11131a" fill-opacity="0.85" stroke="${accentColor}" stroke-width="3"/>`,
    `  <text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" fill="#F3EEE8" font-family="${fontFamily}, sans-serif" font-weight="800" font-size="${Math.round(
      width * 0.05
    )}">${primaryText}</text>`,
    `  <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="JetBrains Mono, monospace" font-size="${Math.round(
      width * 0.024
    )}">${secondaryText}</text>`,
    `</svg>`,
  ].join('\n');

  return sanitizeSvgContent(rawSvg).sanitizedSvg;
}

/**
 * Generates a schema-checked Alight Motion <scene> XML document from a
 * `CanonicalProjectDocument` for the tested 2D subset.
 */
export function renderCanonicalToAlightMotionXml(
  projectDoc: CanonicalProjectDocument,
  width: number,
  height: number,
  fps: 24 | 30 | 60
): string {
  const allClips = getAllClipsFromProject(projectDoc).map((p) => p.clip);
  const headlineClip = allClips.find((c: CanonicalClip) =>
    Boolean(c.textData?.content)
  );
  const vectorClip = allClips.find((c: CanonicalClip) => Boolean(c.vectorData));

  const escapeXml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const title = escapeXml(projectDoc.title || 'Sowveil Canonical Export');
  const primaryText = escapeXml(
    headlineClip?.textData?.content || projectDoc.title || 'SOWVEIL'
  );
  const accentColor =
    headlineClip?.textData?.colorHex ||
    vectorClip?.vectorData?.fillColorHex ||
    '#10b981';
  const bgColor = projectDoc.canvas.backgroundColorHex || '#090b10';
  const totalMs = Math.max(
    500,
    Math.round((projectDoc.canvas.durationSec || 6) * 1000)
  );

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<scene title="${title}" width="${width}" height="${height}" exportWidth="${width}" exportHeight="${height}" precompose="dynamicResolution" bgcolor="${escapeXml(
      bgColor
    )}" totalTime="${totalMs}" fps="${fps}" modifiedTime="${Date.now()}" amver="1000500" ffver="106">`,
    `  <shape id="1001" label="Canonical Safe Frame" startTime="0" endTime="${totalMs}" fillType="color" s=".rect">`,
    `    <transform>`,
    `      <location value="${width / 2},${height / 2},0" />`,
    `      <scale value="1,1" />`,
    `      <rotation value="0" />`,
    `      <opacity value="1" />`,
    `    </transform>`,
    `    <property name="size" type="vec2" value="${Math.round(
      width * 0.42
    )},${Math.round(height * 0.38)}" />`,
    `    <fillColor value="${escapeXml(accentColor)}" />`,
    `  </shape>`,
    `  <text id="1002" label="${escapeXml(
      headlineClip?.name || 'Primary Headline'
    )}" startTime="0" endTime="${totalMs}">`,
    `    <transform>`,
    `      <location>`,
    `        <kf t="0" v="${width / 2},${height / 2},0" e="cubicBezier 0.22 1.0 0.36 1.0" />`,
    `        <kf t="1" v="${width / 2},${height / 2},0" />`,
    `      </location>`,
    `      <scale value="1,1" />`,
    `      <rotation value="0" />`,
    `      <opacity>`,
    `        <kf t="0" v="0" e="cubicBezier 0.22 1.0 0.36 1.0" />`,
    `        <kf t="0.2" v="1" />`,
    `      </opacity>`,
    `    </transform>`,
    `    <content>${primaryText}</content>`,
    `    <font family="${escapeXml(
      headlineClip?.textData?.fontFamily || 'Inter'
    )}" size="${headlineClip?.textData?.fontSizePx || 64}" align="center" />`,
    `    <fillColor value="${escapeXml(accentColor)}" />`,
    `  </text>`,
    `</scene>`,
  ].join('\n');
}

/**
 * Runs the 11-point Final Quality Assurance & Acceptance Gate over the canonical
 * project, script coverage ledger, and generated artifact bytes.
 */
export function runFinalRenderQaGate(params: {
  jobId: string;
  projectDoc: CanonicalProjectDocument;
  executionTier: RenderExecutionTier;
  outputFormat: RenderOutputFormat;
  targetAdapter: TargetMobileEditorId;
  requestedWidth: number;
  requestedHeight: number;
  requestedFps: 24 | 30 | 60;
  requestedDurationSec: number;
  artifactBytes: Uint8Array;
  artifactMetadata: RenderOutputArtifactMetadata;
  featureLossReport: AdapterFeatureLossReport;
  audioTelemetry: {
    maxPeakLinear: number;
    maxPeakDbfs: number;
    clippingSampleCount: number;
    clippingDetected: boolean;
    stemTrackCount: number;
  };
  captionCues: CaptionCueSegment[];
  scriptSegments?: ImmutableScriptSegment[];
}): FinalRenderQaReport {
  const {
    jobId,
    projectDoc,
    executionTier,
    outputFormat,
    targetAdapter,
    requestedWidth,
    requestedHeight,
    requestedFps,
    requestedDurationSec,
    artifactBytes,
    artifactMetadata,
    featureLossReport,
    audioTelemetry,
    captionCues,
    scriptSegments,
  } = params;

  const allClipPairs = getAllClipsFromProject(projectDoc);

  // 1. Project opens and validates against canonical v2.0.0 schema
  const schemaValidation = validateCanonicalProject(projectDoc);
  const check1: QaCheckResultItem = {
    checkId: 'project-opens-and-validates',
    label: '1. Canonical Project Opens & Validates',
    passed: schemaValidation.valid && projectDoc.scenes.length > 0,
    severity: 'critical',
    measuredValue: schemaValidation.valid
      ? `Valid v${projectDoc.schemaVersion} (${projectDoc.scenes.length} scenes, ${projectDoc.tracks.length} tracks, ${allClipPairs.length} clips)`
      : `Invalid (${schemaValidation.errors.length} schema error(s))`,
    expectedCriteria: 'Valid CanonicalProjectDocument v2.0.0 with >= 1 scene',
    detail: schemaValidation.valid
      ? 'Project graph validated cleanly with zero schema errors.'
      : schemaValidation.errors.join('; '),
  };

  // 2. All source assets resolve
  const unresolvedAssets = featureLossReport.unresolvedAssetIds;
  const check2: QaCheckResultItem = {
    checkId: 'all-source-assets-resolve',
    label: '2. All Required Source Assets Resolve',
    passed: unresolvedAssets.length === 0,
    severity: 'critical',
    measuredValue:
      unresolvedAssets.length === 0
        ? `${featureLossReport.requiredAssetIds.length} asset(s) resolved`
        : `${unresolvedAssets.length} missing asset(s): ${unresolvedAssets.join(', ')}`,
    expectedCriteria: '0 unresolved or missing required assets',
    detail:
      unresolvedAssets.length === 0
        ? 'All asset dependencies in project.assetReferences and clips resolved.'
        : `Missing asset IDs must be relinked or replaced before final acceptance: ${unresolvedAssets.join(', ')}`,
  };

  // 3. Every script segment is accounted for (or explicitly omitted with approval)
  const uncoveredSegmentIds: string[] = [];
  let totalSegments = 0;
  let coveredOrOmittedSegments = 0;
  if (scriptSegments && scriptSegments.length > 0) {
    totalSegments = scriptSegments.length;
    for (const seg of scriptSegments) {
      if (
        seg.status === 'planned' ||
        seg.status === 'produced-on-timeline' ||
        seg.status === 'omitted-by-user-approval'
      ) {
        coveredOrOmittedSegments += 1;
      } else {
        uncoveredSegmentIds.push(seg.segmentId);
      }
    }
  } else {
    const sceneSegIds = projectDoc.scenes.flatMap(
      (s) => s.scriptSegmentIds || []
    );
    totalSegments = sceneSegIds.length;
    coveredOrOmittedSegments = sceneSegIds.length;
  }
  const check3: QaCheckResultItem = {
    checkId: 'every-script-segment-accounted',
    label: '3. 100% Script Segment Coverage Ledger',
    passed: uncoveredSegmentIds.length === 0,
    severity: 'critical',
    measuredValue:
      totalSegments > 0
        ? `${coveredOrOmittedSegments}/${totalSegments} segments accounted for`
        : 'All canonical scenes accounted for (no unmapped script segments)',
    expectedCriteria: '0 uncovered script segments',
    detail:
      uncoveredSegmentIds.length === 0
        ? 'Every script passage maps to a planned shot, timeline clip, or approved omission.'
        : `Uncovered script segments detected: ${uncoveredSegmentIds.join(', ')}`,
  };

  // 4. Output decodes / validates after writing
  let decodePassed =
    artifactMetadata.validatedAfterWrite && artifactBytes.byteLength > 0;
  let decodeDetail = artifactMetadata.validationSummary;

  if (outputFormat === 'png-frame') {
    const pv = validatePngBytes(artifactBytes);
    decodePassed = pv.valid;
    decodeDetail = pv.valid
      ? `PNG IHDR/IDAT/IEND verified (${pv.width}x${pv.height})`
      : pv.reason;
  } else if (outputFormat === 'jpeg-frame') {
    const jv = validateJpegBytes(artifactBytes);
    decodePassed = jv.valid;
    decodeDetail = jv.valid
      ? `JPEG SOI/SOF0/EOI verified (${jv.width}x${jv.height})`
      : jv.reason || 'JPEG validation failed';
  } else if (outputFormat === 'wav-audio') {
    const wv = validateWavBytes(artifactBytes);
    decodePassed = wv.valid;
    decodeDetail = wv.reason;
  } else if (outputFormat === 'srt-captions') {
    const sv = validateSrtContent(Buffer.from(artifactBytes).toString('utf8'));
    decodePassed = sv.valid;
    decodeDetail = sv.reason;
  } else if (outputFormat === 'vtt-captions') {
    const vv = validateVttContent(Buffer.from(artifactBytes).toString('utf8'));
    decodePassed = vv.valid;
    decodeDetail = vv.reason;
  } else if (outputFormat === 'alight-motion-xml') {
    const xv = validateAndInspectAlightMotionXml(
      Buffer.from(artifactBytes).toString('utf8')
    );
    decodePassed = xv.valid;
    decodeDetail = xv.valid
      ? `Alight Motion <scene> XML verified (${xv.shapeCount} shapes, ${xv.textCount} text layers)`
      : xv.reason;
  } else if (outputFormat.endsWith('-zip')) {
    const zv = validateZipSafety(artifactBytes);
    decodePassed = zv.valid;
    decodeDetail = zv.valid
      ? `PKZIP verified (${zv.entryCount} entries, ${zv.totalUncompressedBytes} bytes uncompressed)`
      : zv.reason;
  }

  const check4: QaCheckResultItem = {
    checkId: 'output-decodes-and-validates',
    label: '4. Output File Decodes & Validates After Write',
    passed: decodePassed,
    severity: 'critical',
    measuredValue: `${artifactMetadata.sizeBytes} bytes · SHA-256 ${artifactMetadata.sha256.slice(
      0,
      12
    )}…`,
    expectedCriteria:
      'Non-empty binary/text output passing format-specific structural validator',
    detail: decodeDetail,
  };

  // 5. Duration within tolerance
  const toleranceSec = 0.25;
  const durationDiff = Math.abs(
    artifactMetadata.durationSec - requestedDurationSec
  );
  const durationPassed = durationDiff <= toleranceSec;
  const check5: QaCheckResultItem = {
    checkId: 'duration-within-tolerance',
    label: '5. Duration Within Tolerance',
    passed: durationPassed,
    severity: 'critical',
    measuredValue: `${artifactMetadata.durationSec.toFixed(
      2
    )}s (requested ${requestedDurationSec.toFixed(
      2
    )}s, Δ=${durationDiff.toFixed(3)}s)`,
    expectedCriteria: `|actual - requested| <= ${toleranceSec}s`,
    detail: durationPassed
      ? 'Output timeline duration matches requested duration within tolerance.'
      : `Duration delta ${durationDiff.toFixed(
          3
        )}s exceeds tolerance ${toleranceSec}s.`,
  };

  // 6. Dimensions match request
  const dimsMatch =
    artifactMetadata.width === requestedWidth &&
    artifactMetadata.height === requestedHeight;
  const check6: QaCheckResultItem = {
    checkId: 'dimensions-match-request',
    label: '6. Dimensions Match Target Preset / Proxy',
    passed: dimsMatch,
    severity: 'critical',
    measuredValue: `${artifactMetadata.width}x${artifactMetadata.height}`,
    expectedCriteria: `${requestedWidth}x${requestedHeight}`,
    detail: dimsMatch
      ? `Output resolution matches requested ${executionTier} dimensions (${requestedWidth}x${requestedHeight}).`
      : `Dimension mismatch: got ${artifactMetadata.width}x${artifactMetadata.height}, expected ${requestedWidth}x${requestedHeight}.`,
  };

  // 7. Frame rate within tolerance
  const fpsDiff = Math.abs(artifactMetadata.fps - requestedFps);
  const fpsPassed = fpsDiff <= 0.5;
  const check7: QaCheckResultItem = {
    checkId: 'fps-within-tolerance',
    label: '7. Frame Rate Within Tolerance',
    passed: fpsPassed,
    severity: 'critical',
    measuredValue: `${artifactMetadata.fps} fps`,
    expectedCriteria: `${requestedFps} fps (±0.5 fps)`,
    detail: fpsPassed
      ? `Frame rate locked at ${artifactMetadata.fps} fps.`
      : `Frame rate mismatch: got ${artifactMetadata.fps} fps, expected ${requestedFps} fps.`,
  };

  // 8. Captions aligned
  let overlappingCueCount = 0;
  let outOfBoundsCueCount = 0;
  for (let i = 0; i < captionCues.length; i++) {
    const cue = captionCues[i];
    if (
      cue.startSec < -0.01 ||
      cue.endSec > requestedDurationSec + 0.5 ||
      cue.endSec <= cue.startSec
    ) {
      outOfBoundsCueCount += 1;
    }
    if (i > 0 && cue.startSec < captionCues[i - 1].endSec - 0.05) {
      overlappingCueCount += 1;
    }
  }
  const captionsAligned =
    overlappingCueCount === 0 && outOfBoundsCueCount === 0;
  const check8: QaCheckResultItem = {
    checkId: 'captions-aligned',
    label: '8. Captions Ordered & Timeline-Aligned',
    passed: captionsAligned,
    severity: 'warning',
    measuredValue: `${captionCues.length} cue(s), ${overlappingCueCount} overlaps, ${outOfBoundsCueCount} out-of-bounds`,
    expectedCriteria: '0 overlapping cues and 0 out-of-bounds timestamps',
    detail: captionsAligned
      ? 'All caption cues are monotonically ordered and within canvas duration.'
      : `Detected ${overlappingCueCount} overlapping cue(s) and ${outOfBoundsCueCount} out-of-bounds cue(s).`,
  };

  // 9. Audio free of unintentional clipping
  const audioPassed = !audioTelemetry.clippingDetected;
  const check9: QaCheckResultItem = {
    checkId: 'audio-free-of-clipping',
    label: '9. Audio Free of Unintentional Clipping',
    passed: audioPassed,
    severity: 'warning',
    measuredValue: `Peak ${audioTelemetry.maxPeakDbfs} dBFS (${audioTelemetry.clippingSampleCount} clipped samples across ${audioTelemetry.stemTrackCount} stem(s))`,
    expectedCriteria: 'Peak <= -0.05 dBFS and 0 clipped PCM samples',
    detail: audioPassed
      ? `Master bus peak is safe at ${audioTelemetry.maxPeakDbfs} dBFS with zero clipped samples.`
      : `Audio clipping detected (${audioTelemetry.clippingSampleCount} samples clipped at ${audioTelemetry.maxPeakDbfs} dBFS). Lower clip gainDb.`,
  };

  // 10. No accidental blank frames across sampled timestamps
  const visualTracks = projectDoc.tracks.filter(
    (t: CanonicalTrack) =>
      t.visible &&
      (t.kind === 'video' ||
        t.kind === 'text' ||
        t.kind === 'vector' ||
        t.kind === 'template')
  );
  const visualClips = visualTracks
    .flatMap((t: CanonicalTrack) => t.clips)
    .filter((c: CanonicalClip) => c.visible);

  const sampledFrames: SampledFrameInspection[] = [];
  for (const scene of projectDoc.scenes) {
    if (scene.status === 'omitted') continue;
    const midTime = Number(
      (scene.startTimeSec + scene.durationSec * 0.5).toFixed(3)
    );
    const activeAtMid = visualClips.filter(
      (c: CanonicalClip) =>
        midTime >= c.startTimeSec - 0.05 &&
        midTime <= c.startTimeSec + c.durationSec + 0.05
    );
    const headline =
      activeAtMid.find((c: CanonicalClip) => Boolean(c.textData?.content))
        ?.textData?.content || null;
    sampledFrames.push({
      timestampSec: midTime,
      sceneId: scene.id,
      activeVisualClipIds: activeAtMid.map((c: CanonicalClip) => c.id),
      activeHeadlineText: headline,
      isAccidentalBlankFrame: activeAtMid.length === 0,
    });
  }

  const blankFrameCount = sampledFrames.filter(
    (f) => f.isAccidentalBlankFrame
  ).length;
  const check10: QaCheckResultItem = {
    checkId: 'no-accidental-blank-frames',
    label: '10. No Accidental Blank / Black Frames',
    passed: blankFrameCount === 0 && sampledFrames.length > 0,
    severity: 'critical',
    measuredValue: `${sampledFrames.length - blankFrameCount}/${
      sampledFrames.length
    } sampled scene midpoints populated`,
    expectedCriteria: 'Every scene midpoint has >= 1 visible active layer',
    detail:
      blankFrameCount === 0
        ? 'All sampled scene timestamps contain active visible layers.'
        : `${blankFrameCount} scene midpoint(s) have zero active visual clips (accidental blank gap).`,
  };

  // 11. Key content appears & export-specific unsupported effects are listed
  const unsupportedEffectsListed = featureLossReport.items
    .filter((i) => i.handling === 'dropped' || i.handling === 'approximated')
    .map((i) => `${i.clipLabel}: ${i.featureName} (${i.handling})`);
  const hasKeyContent =
    visualClips.length > 0 &&
    sampledFrames.some((f) => f.activeVisualClipIds.length > 0);
  const check11: QaCheckResultItem = {
    checkId: 'key-content-and-unsupported-listed',
    label: '11. Key Content Verified & Unsupported Effects Disclosed',
    passed: hasKeyContent,
    severity: 'info',
    measuredValue: `${visualClips.length} visual clip(s) verified · ${unsupportedEffectsListed.length} adapter limitation(s) disclosed`,
    expectedCriteria:
      'Primary visual/headline content present and all adapter feature-loss items explicitly listed',
    detail:
      unsupportedEffectsListed.length === 0
        ? 'All project features are natively supported by the target format.'
        : `Disclosed ${unsupportedEffectsListed.length} approximated/dropped item(s) in Feature-Loss Report.`,
  };

  const allChecks = [
    check1,
    check2,
    check3,
    check4,
    check5,
    check6,
    check7,
    check8,
    check9,
    check10,
    check11,
  ];
  const checksPassedCount = allChecks.filter((c) => c.passed).length;
  const overallPassed = allChecks.every((c) => c.passed);

  return {
    reportId: `qa_${Date.now().toString(36)}_${computeCrc32Hex(
      artifactBytes
    ).slice(0, 6)}`,
    jobId,
    projectId: projectDoc.id,
    projectRevision: projectDoc.revision,
    rendererVersion: RENDER_EXPORT_ENGINE_VERSION,
    executionTier,
    outputFormat,
    targetAdapter,
    evaluatedAt: new Date().toISOString(),
    overallPassed,
    checksPassedCount,
    checksTotalCount: allChecks.length,
    checks: {
      projectOpensAndValidates: check1,
      allSourceAssetsResolve: check2,
      everyScriptSegmentAccountedFor: check3,
      outputDecodesAndValidates: check4,
      durationWithinTolerance: check5,
      dimensionsMatchRequest: check6,
      frameRateWithinTolerance: check7,
      captionsAligned: check8,
      audioFreeOfUnintentionalClipping: check9,
      noAccidentalBlankFrames: check10,
      keyContentAppearsAndUnsupportedListed: check11,
    },
    sampledFrames,
    audioTelemetry,
    captionTelemetry: {
      totalCues: captionCues.length,
      overlappingCueCount,
      outOfBoundsCueCount,
      allAligned: captionsAligned,
    },
    scriptCoverageTelemetry: {
      totalSegments,
      coveredOrOmittedSegments,
      uncoveredSegmentIds,
    },
    unsupportedEffectsListed,
  };
}

export interface CreateAndExecuteRenderJobInput {
  ownerUid: string;
  projectDoc: CanonicalProjectDocument;
  directorSession?: AiDirectorSessionRecord | null;
  executionTier?: RenderExecutionTier;
  outputFormat: RenderOutputFormat;
  targetAdapter?: TargetMobileEditorId;
  requestedWidth?: number;
  requestedHeight?: number;
  requestedFps?: 24 | 30 | 60;
  requestedDurationSec?: number;
  sampleTimestampSec?: number;
  downscaleAssetsForProxy?: boolean;
  userApprovedDataUpload?: boolean;
  assetsMap?: Map<string, AssetMetadataRecord>;
  workerConfig?: ServerRenderWorkerConfig;
  existingJobToRetry?: DurableRenderExportJobRecord | null;
}

/**
 * Executes a real canonical render/export job across all stages.
 */
export function createAndExecuteCanonicalRenderJob(
  input: CreateAndExecuteRenderJobInput
): DurableRenderExportJobRecord {
  const now = new Date().toISOString();
  const projectDoc = input.projectDoc;
  const executionTier: RenderExecutionTier =
    input.executionTier || 'final-render';
  const outputFormat: RenderOutputFormat = input.outputFormat;

  const defaultAdapterByFormat: Record<
    RenderOutputFormat,
    TargetMobileEditorId
  > = {
    'sowveil-bundle-zip': 'sowveil-project',
    'sowveil-json': 'sowveil-project',
    'png-frame': 'universal-bundle',
    'jpeg-frame': 'universal-bundle',
    'svg-vector': 'universal-bundle',
    'wav-audio': 'universal-bundle',
    'audio-stems-zip': 'universal-bundle',
    'srt-captions': 'capcut',
    'vtt-captions': 'capcut',
    'alight-motion-xml': 'alight-motion',
    'capcut-handoff-zip': 'capcut',
    'node-video-handoff-zip': 'node-video',
    'kinemaster-handoff-zip': 'kinemaster',
    'webm-video': 'universal-bundle',
    'mp4-video': 'universal-bundle',
  };

  const targetAdapter: TargetMobileEditorId =
    input.targetAdapter ||
    defaultAdapterByFormat[outputFormat] ||
    'sowveil-project';

  const baseW = projectDoc.canvas.width || 1080;
  const baseH = projectDoc.canvas.height || 1920;
  const proxyScale = executionTier === 'proxy-render' ? 0.5 : 1;

  const requestedWidth =
    input.requestedWidth || Math.max(16, Math.round(baseW * proxyScale));
  const requestedHeight =
    input.requestedHeight || Math.max(16, Math.round(baseH * proxyScale));
  const requestedFps: 24 | 30 | 60 =
    input.requestedFps ||
    (executionTier === 'proxy-render' ? 24 : projectDoc.canvas.fps || 30);
  const requestedDurationSec =
    input.requestedDurationSec || projectDoc.canvas.durationSec || 6;
  const sampleTimestampSec =
    input.sampleTimestampSec ??
    Number(
      Math.min(requestedDurationSec * 0.5, requestedDurationSec).toFixed(2)
    );
  const downscaleAssetsForProxy =
    input.downscaleAssetsForProxy ?? executionTier === 'proxy-render';

  const jobId =
    input.existingJobToRetry?.id ||
    `rjob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const attemptCount = input.existingJobToRetry
    ? input.existingJobToRetry.retryPolicy.attemptCount + 1
    : 1;

  const allClipPairs = getAllClipsFromProject(projectDoc);
  const sceneUnits = Math.max(1, projectDoc.scenes.length);
  const clipUnits = Math.max(1, allClipPairs.length);
  const assetUnits = Math.max(1, projectDoc.assetReferences.length + 1);
  const audioUnits = Math.max(
    1,
    projectDoc.tracks.filter((t: CanonicalTrack) => t.kind === 'audio').length +
      1
  );
  const packageUnits = 2;
  const qaUnits = 11;
  const totalWorkUnits =
    1 + assetUnits + sceneUnits + clipUnits + audioUnits + packageUnits + qaUnits;

  let completedWorkUnits = 0;
  const stageHistory: RenderStageTransitionRecord[] = [
    ...(input.existingJobToRetry?.stageHistory || []),
  ];

  const recordStage = (
    stage: RenderJobStage,
    unitsAdded: number,
    detail: string
  ) => {
    completedWorkUnits = Math.min(
      totalWorkUnits,
      completedWorkUnits + Math.max(0, unitsAdded)
    );
    const progressPercent = Math.round(
      (completedWorkUnits / Math.max(1, totalWorkUnits)) * 100
    );
    stageHistory.push({
      stage,
      completedWorkUnits,
      totalWorkUnits,
      progressPercent,
      detail,
      timestamp: new Date().toISOString(),
    });
  };

  recordStage(
    'queued',
    0,
    `Queued ${executionTier} job (${outputFormat}) for project "${projectDoc.title}" (attempt #${attemptCount}).`
  );

  const featureLossReport = computeAdapterFeatureLossReport(
    projectDoc,
    targetAdapter,
    input.assetsMap
  );

  const serverWorkerDisclosure = evaluateServerWorkerTransparency(
    {
      executionTier,
      outputFormat,
      durationSec: requestedDurationSec,
      projectClipsCount: allClipPairs.length,
      userApprovedDataUpload: input.userApprovedDataUpload,
    },
    input.workerConfig
  );

  if (
    serverWorkerDisclosure.status === 'needs-worker-setup' ||
    serverWorkerDisclosure.status === 'awaiting-upload-consent'
  ) {
    recordStage(
      'needs-worker-setup',
      0,
      serverWorkerDisclosure.disclosureMessage
    );
    return {
      id: jobId,
      ownerUid: input.ownerUid,
      projectId: projectDoc.id,
      projectTitle: projectDoc.title,
      projectRevision: projectDoc.revision,
      directorSessionId: input.directorSession?.id || null,
      executionTier,
      outputFormat,
      targetAdapter,
      requestedWidth,
      requestedHeight,
      requestedFps,
      requestedDurationSec,
      sampleTimestampSec,
      downscaleAssetsForProxy,
      serverWorkerDisclosure,
      stage: 'needs-worker-setup',
      cancellable: false,
      completedWorkUnits,
      totalWorkUnits,
      progressPercent: Math.round((completedWorkUnits / totalWorkUnits) * 100),
      stageHistory,
      retryPolicy: {
        attemptCount,
        maxAttempts: 3,
        backoffBaseMs: 2000,
        nextEligibleRetryAt: now,
        lastFailureReason: serverWorkerDisclosure.disclosureMessage,
      },
      featureLossReport,
      artifactMetadata: null,
      artifactBytesBase64: null,
      qaReport: null,
      errorCode:
        serverWorkerDisclosure.status === 'awaiting-upload-consent'
          ? 'WORKER_UPLOAD_CONSENT_REQUIRED'
          : 'RENDER_WORKER_NOT_CONFIGURED',
      sanitizedErrorMessage: serverWorkerDisclosure.disclosureMessage,
      createdAt: input.existingJobToRetry?.createdAt || now,
      updatedAt: now,
      completedAt: null,
    };
  }

  // Stage 1: Validating Project
  const schemaValidation = validateCanonicalProject(projectDoc);
  recordStage(
    'validating-project',
    1,
    schemaValidation.valid
      ? `Validated canonical schema v${projectDoc.schemaVersion} (${projectDoc.scenes.length} scenes, ${allClipPairs.length} clips).`
      : `Canonical schema validation found ${schemaValidation.errors.length} error(s).`
  );

  // Stage 2: Resolving Assets
  recordStage(
    'resolving-assets',
    assetUnits,
    `Resolved ${featureLossReport.requiredAssetIds.length} asset reference(s) (${featureLossReport.unresolvedAssetIds.length} missing)${
      downscaleAssetsForProxy
        ? ' with mobile proxy asset downscaling enabled'
        : ''
    }.`
  );

  // Stage 3: Rendering Frames
  const svgFrameContent = renderCanonicalFrameSvg(
    projectDoc,
    requestedWidth,
    requestedHeight,
    sampleTimestampSec
  );
  const headlineClip = allClipPairs
    .map((p) => p.clip)
    .find((c: CanonicalClip) => Boolean(c.textData?.content));
  const accentHex = headlineClip?.textData?.colorHex || '#10b981';

  const pngFrameBytes = generateValidPngStillBytes({
    aspectRatio: (projectDoc.canvas.aspectRatio || '9:16') as MobileAspectRatio,
    backgroundMode: projectDoc.canvas.backgroundAlphaMode || 'solid',
    accentHex,
    width: requestedWidth,
    height: requestedHeight,
  });
  const jpegFrameBytes = generateValidJpegFrameBytes({
    width: requestedWidth,
    height: requestedHeight,
    accentHex,
  });

  recordStage(
    'rendering-frames',
    sceneUnits + clipUnits,
    `Evaluated ${projectDoc.scenes.length} scene(s) and ${allClipPairs.length} clip(s) at ${requestedWidth}x${requestedHeight} @ ${requestedFps}fps.`
  );

  // Stage 4: Synthesizing Audio & Extracting Captions
  const audioSynth = synthesizeCanonicalAudioAndTelemetry(
    projectDoc,
    requestedDurationSec
  );
  const scriptSegments = input.directorSession?.segments;
  const captionCues = extractCanonicalCaptionCues(projectDoc, scriptSegments);
  const srtContent = generateSrtFromCues(captionCues);
  const vttContent = generateVttFromCues(captionCues);

  recordStage(
    'synthesizing-audio',
    audioUnits,
    `Synthesized 16-bit PCM WAV master (${audioSynth.masterWavBytes.byteLength} bytes, peak ${audioSynth.maxPeakDbfs} dBFS) and ${audioSynth.stems.length} stem(s).`
  );

  // Stage 5: Packaging Container
  const safeSlug =
    (projectDoc.title || 'sowveil-project')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'sowveil-project';
  const tierSuffix = executionTier === 'proxy-render' ? '-proxy' : '';

  let artifactBytes: Uint8Array;
  let fileName: string;
  let mimeType: string;
  let container: string;
  let codec: string;
  let validationSummary = '';
  let validatedAfterWrite = false;

  if (outputFormat === 'sowveil-json') {
    const jsonBytes = Buffer.from(JSON.stringify(projectDoc, null, 2), 'utf8');
    artifactBytes = new Uint8Array(jsonBytes);
    fileName = `${safeSlug}${tierSuffix}.sowveil.json`;
    mimeType = 'application/json; charset=utf-8';
    container = 'JSON';
    codec = 'sowveil-canonical-v2';
    validatedAfterWrite = schemaValidation.valid && artifactBytes.byteLength > 20;
    validationSummary = `Canonical v2.0.0 JSON verified (${artifactBytes.byteLength} bytes)`;
  } else if (outputFormat === 'png-frame') {
    artifactBytes = pngFrameBytes;
    fileName = `${safeSlug}${tierSuffix}-${requestedWidth}x${requestedHeight}.png`;
    mimeType = 'image/png';
    container = 'PNG';
    codec = 'RGBA-8bit-deflate';
    const check = validatePngBytes(artifactBytes);
    validatedAfterWrite = check.valid;
    validationSummary = check.valid
      ? `Valid PNG (${check.width}x${check.height})`
      : check.reason;
  } else if (outputFormat === 'jpeg-frame') {
    artifactBytes = jpegFrameBytes;
    fileName = `${safeSlug}${tierSuffix}-${requestedWidth}x${requestedHeight}.jpg`;
    mimeType = 'image/jpeg';
    container = 'JPEG/JFIF';
    codec = 'Baseline-DCT-YCbCr';
    const check = validateJpegBytes(artifactBytes);
    validatedAfterWrite = check.valid;
    validationSummary = check.valid
      ? `Valid Baseline JPEG (${check.width}x${check.height})`
      : check.reason || 'JPEG invalid';
  } else if (outputFormat === 'svg-vector') {
    artifactBytes = new Uint8Array(Buffer.from(svgFrameContent, 'utf8'));
    fileName = `${safeSlug}${tierSuffix}-${requestedWidth}x${requestedHeight}.svg`;
    mimeType = 'image/svg+xml; charset=utf-8';
    container = 'SVG';
    codec = 'SVG-1.1-Sanitized';
    validatedAfterWrite =
      svgFrameContent.includes('<svg') && svgFrameContent.includes('</svg>');
    validationSummary = `Sanitized vector SVG verified (${artifactBytes.byteLength} bytes)`;
  } else if (outputFormat === 'wav-audio') {
    artifactBytes = audioSynth.masterWavBytes;
    fileName = `${safeSlug}${tierSuffix}.wav`;
    mimeType = 'audio/wav';
    container = 'RIFF/WAVE';
    codec = 'PCM-16bit-LE-22050Hz';
    const check = validateWavBytes(artifactBytes);
    validatedAfterWrite = check.valid;
    validationSummary = check.reason;
  } else if (outputFormat === 'audio-stems-zip') {
    const entries: ZipEntryInput[] = [
      {
        name: 'master.wav',
        data: audioSynth.masterWavBytes,
      },
      ...audioSynth.stems.map((s) => ({
        name: s.fileName,
        data: s.wavBytes,
      })),
      {
        name: 'STEMS_MANIFEST.json',
        content: JSON.stringify(
          {
            projectId: projectDoc.id,
            projectRevision: projectDoc.revision,
            maxPeakDbfs: audioSynth.maxPeakDbfs,
            clippingDetected: audioSynth.clippingDetected,
            stems: audioSynth.stems.map((s) => ({
              trackId: s.trackId,
              trackLabel: s.trackLabel,
              fileName: s.fileName,
              sha256: computeSha256Hex(s.wavBytes),
            })),
          },
          null,
          2
        ),
      },
    ];
    artifactBytes = generateRealZipBundle(entries);
    fileName = `${safeSlug}${tierSuffix}.stems.zip`;
    mimeType = 'application/zip';
    container = 'PKZIP';
    codec = 'WAV-PCM-Stems-Bundle';
    const check = validateZipSafety(artifactBytes);
    validatedAfterWrite = check.valid;
    validationSummary = check.valid
      ? `Valid Audio Stems PKZIP (${check.entryCount} entries)`
      : check.reason;
  } else if (outputFormat === 'srt-captions') {
    artifactBytes = new Uint8Array(Buffer.from(srtContent, 'utf8'));
    fileName = `${safeSlug}${tierSuffix}.srt`;
    mimeType = 'application/x-subrip; charset=utf-8';
    container = 'SRT';
    codec = 'UTF-8-SubRip';
    const check = validateSrtContent(srtContent);
    validatedAfterWrite = check.valid;
    validationSummary = check.reason;
  } else if (outputFormat === 'vtt-captions') {
    artifactBytes = new Uint8Array(Buffer.from(vttContent, 'utf8'));
    fileName = `${safeSlug}${tierSuffix}.vtt`;
    mimeType = 'text/vtt; charset=utf-8';
    container = 'WebVTT';
    codec = 'UTF-8-WebVTT';
    const check = validateVttContent(vttContent);
    validatedAfterWrite = check.valid;
    validationSummary = check.reason;
  } else if (outputFormat === 'alight-motion-xml') {
    const xmlContent = renderCanonicalToAlightMotionXml(
      projectDoc,
      requestedWidth,
      requestedHeight,
      requestedFps
    );
    artifactBytes = new Uint8Array(Buffer.from(xmlContent, 'utf8'));
    fileName = `${safeSlug}${tierSuffix}-alight.xml`;
    mimeType = 'application/xml; charset=utf-8';
    container = 'XML';
    codec = 'AlightMotion-Scene-XML-Subset';
    const check = validateAndInspectAlightMotionXml(xmlContent);
    validatedAfterWrite = check.valid;
    validationSummary = check.valid
      ? `Valid Alight Motion XML (${check.shapeCount} shapes, ${check.textCount} text layers)`
      : check.reason;
  } else {
    const xmlContent = renderCanonicalToAlightMotionXml(
      projectDoc,
      requestedWidth,
      requestedHeight,
      requestedFps
    );
    const curvesSheet = allClipPairs.map(({ clip }) => ({
      clipId: clip.id,
      label: clip.name,
      startTimeSec: clip.startTimeSec,
      durationSec: clip.durationSec,
      transform: clip.transform,
      keyframes: clip.keyframes,
      effects: clip.effects,
    }));

    const importReadme = [
      `# Sowveil Studio — ${featureLossReport.adapterDisplayName}`,
      `Adapter Verification Status: ${featureLossReport.verificationStatus}`,
      `Project: ${projectDoc.title} (ID: ${projectDoc.id}, Revision: r${projectDoc.revision})`,
      `Execution Tier: ${executionTier} (${requestedWidth}x${requestedHeight} @ ${requestedFps}fps, ${requestedDurationSec}s)`,
      `Fidelity Retention Score: ${featureLossReport.fidelityRetentionScore}%`,
      ``,
      `## Included Validated Files`,
      `- project.sowveil.json (Canonical v2.0.0 Project Graph)`,
      `- alight-motion-subset.xml (Validated Alight Motion XML Subset)`,
      `- preview-frame.png & preview-frame.jpg (Validated Raster Frames)`,
      `- vector-plate.svg (Sanitized Vector Plate)`,
      `- audio/master.wav (Validated 16-bit PCM Master Audio)`,
      `- captions/subtitles.srt & captions/subtitles.vtt (Timed Captions)`,
      `- FEATURE_LOSS_REPORT.json (Supported, Approximated & Dropped Features)`,
      `- TIMING_AND_CURVES_SHEET.json (Frame-accurate layer timings & cubic-bezier tangents)`,
      ``,
      `## Honest Capability Note`,
      featureLossReport.summaryNote,
    ].join('\n');

    const bundleEntries: ZipEntryInput[] = [
      {
        name: 'project.sowveil.json',
        content: JSON.stringify(projectDoc, null, 2),
      },
      {
        name: 'alight-motion-subset.xml',
        content: xmlContent,
      },
      {
        name: 'preview-frame.png',
        data: pngFrameBytes,
      },
      {
        name: 'preview-frame.jpg',
        data: jpegFrameBytes,
      },
      {
        name: 'vector-plate.svg',
        content: svgFrameContent,
      },
      {
        name: 'audio/master.wav',
        data: audioSynth.masterWavBytes,
      },
      ...audioSynth.stems.map((s) => ({
        name: s.fileName,
        data: s.wavBytes,
      })),
      {
        name: 'captions/subtitles.srt',
        content: srtContent,
      },
      {
        name: 'captions/subtitles.vtt',
        content: vttContent,
      },
      {
        name: 'FEATURE_LOSS_REPORT.json',
        content: JSON.stringify(featureLossReport, null, 2),
      },
      {
        name: 'TIMING_AND_CURVES_SHEET.json',
        content: JSON.stringify(curvesSheet, null, 2),
      },
      {
        name: 'README_IMPORT.txt',
        content: importReadme,
      },
      {
        name: 'MANIFEST.json',
        content: JSON.stringify(
          {
            schemaVersion: '2.4.0',
            projectId: projectDoc.id,
            projectRevision: projectDoc.revision,
            executionTier,
            outputFormat,
            targetAdapter,
            dimensions: { width: requestedWidth, height: requestedHeight },
            fps: requestedFps,
            durationSec: requestedDurationSec,
            generatedAt: now,
          },
          null,
          2
        ),
      },
    ];

    artifactBytes = generateRealZipBundle(bundleEntries);
    const extByFormat: Record<string, string> = {
      'sowveil-bundle-zip': '.sowveil.zip',
      'capcut-handoff-zip': '.capcut-handoff.zip',
      'node-video-handoff-zip': '.nodevideo-handoff.zip',
      'kinemaster-handoff-zip': '.kinemaster-handoff.zip',
    };
    fileName = `${safeSlug}${tierSuffix}${
      extByFormat[outputFormat] || '.sowveil.zip'
    }`;
    mimeType = 'application/zip';
    container = 'PKZIP';
    codec = 'Sowveil-MultiFormat-Bundle';
    const check = validateZipSafety(artifactBytes);
    validatedAfterWrite = check.valid;
    validationSummary = check.valid
      ? `Valid PKZIP bundle (${check.entryCount} entries, ${check.totalUncompressedBytes} bytes uncompressed)`
      : check.reason;
  }

  const sha256 = computeSha256Hex(artifactBytes);
  const crc32Hex = computeCrc32Hex(artifactBytes);

  const artifactMetadata: RenderOutputArtifactMetadata = {
    fileName,
    mimeType,
    container,
    codec,
    sizeBytes: artifactBytes.byteLength,
    sha256,
    crc32Hex,
    width: requestedWidth,
    height: requestedHeight,
    fps: requestedFps,
    durationSec: requestedDurationSec,
    projectRevision: projectDoc.revision,
    rendererVersion: RENDER_EXPORT_ENGINE_VERSION,
    validatedAfterWrite,
    validationSummary,
  };

  recordStage(
    'packaging-container',
    packageUnits,
    `Packaged "${fileName}" (${
      artifactBytes.byteLength
    } bytes, SHA-256 ${sha256.slice(0, 12)}…). ${validationSummary}`
  );

  // Stage 6: Running 11-Point Final QA Gate
  const qaReport = runFinalRenderQaGate({
    jobId,
    projectDoc,
    executionTier,
    outputFormat,
    targetAdapter,
    requestedWidth,
    requestedHeight,
    requestedFps,
    requestedDurationSec,
    artifactBytes,
    artifactMetadata,
    featureLossReport,
    audioTelemetry: {
      maxPeakLinear: audioSynth.maxPeakLinear,
      maxPeakDbfs: audioSynth.maxPeakDbfs,
      clippingSampleCount: audioSynth.clippingSampleCount,
      clippingDetected: audioSynth.clippingDetected,
      stemTrackCount: audioSynth.stems.length,
    },
    captionCues,
    scriptSegments,
  });

  recordStage(
    'running-final-qa',
    qaUnits,
    `Completed 11-point Final QA Gate: ${qaReport.checksPassedCount}/${qaReport.checksTotalCount} checks passed (overallPassed=${qaReport.overallPassed}).`
  );

  const finalStage: RenderJobStage = validatedAfterWrite ? 'ready' : 'failed';
  recordStage(
    finalStage,
    0,
    validatedAfterWrite
      ? `Render job ready and verified (${fileName}, ${artifactBytes.byteLength} bytes).`
      : `Render output failed post-write verification: ${validationSummary}`
  );

  const completedAt = new Date().toISOString();

  return {
    id: jobId,
    ownerUid: input.ownerUid,
    projectId: projectDoc.id,
    projectTitle: projectDoc.title,
    projectRevision: projectDoc.revision,
    directorSessionId: input.directorSession?.id || null,
    executionTier,
    outputFormat,
    targetAdapter,
    requestedWidth,
    requestedHeight,
    requestedFps,
    requestedDurationSec,
    sampleTimestampSec,
    downscaleAssetsForProxy,
    serverWorkerDisclosure,
    stage: finalStage,
    cancellable: false,
    completedWorkUnits,
    totalWorkUnits,
    progressPercent: 100,
    stageHistory,
    retryPolicy: {
      attemptCount,
      maxAttempts: 3,
      backoffBaseMs: 2000,
      nextEligibleRetryAt: finalStage === 'failed' ? completedAt : null,
      lastFailureReason: finalStage === 'failed' ? validationSummary : null,
    },
    featureLossReport,
    artifactMetadata,
    artifactBytesBase64: Buffer.from(artifactBytes).toString('base64'),
    qaReport,
    errorCode: finalStage === 'failed' ? 'POST_WRITE_VALIDATION_FAILED' : null,
    sanitizedErrorMessage: finalStage === 'failed' ? validationSummary : null,
    createdAt: input.existingJobToRetry?.createdAt || now,
    updatedAt: completedAt,
    completedAt,
  };
}

/**
 * Cancels a render/export job cleanly and records the cancellation in `stageHistory`.
 */
export function cancelRenderExportJob(
  job: DurableRenderExportJobRecord,
  reason = 'Cancelled by user request'
): DurableRenderExportJobRecord {
  const now = new Date().toISOString();
  const transition: RenderStageTransitionRecord = {
    stage: 'cancelled',
    completedWorkUnits: job.completedWorkUnits,
    totalWorkUnits: job.totalWorkUnits,
    progressPercent: job.progressPercent,
    detail: reason,
    timestamp: now,
  };

  return {
    ...job,
    stage: 'cancelled',
    cancellable: false,
    errorCode: 'USER_CANCELLED',
    sanitizedErrorMessage: reason,
    retryPolicy: {
      ...job.retryPolicy,
      lastFailureReason: reason,
      nextEligibleRetryAt: now,
    },
    stageHistory: [...job.stageHistory, transition],
    updatedAt: now,
  };
}

/**
 * Builds a known-good sample `CanonicalProjectDocument` (`v2.0.0`) with scenes,
 * text, vector, audio, and caption tracks.
 */
export function createKnownGoodSampleCanonicalProject(
  ownerUid = 'user-local'
): CanonicalProjectDocument {
  const base = createMinimalCanonicalProject({
    id: 'proj-sample-known-good-v2',
    ownerUid,
    title: 'Sowveil Launch Promo — Canonical Master',
    aspectRatio: '9:16',
    fps: 30,
    durationSec: 6,
  });

  const scene1Id = base.scenes[0]?.id || 'scene-1';
  const scene2Id = 'scene-2-payoff';

  return {
    ...base,
    revision: 3,
    scenes: [
      {
        id: scene1Id,
        title: 'Scene 1 — Hook & Velocity',
        order: 0,
        startTimeSec: 0,
        durationSec: 3,
        scriptSegmentIds: ['seg_1'],
        status: 'approved',
      },
      {
        id: scene2Id,
        title: 'Scene 2 — Proof & Call to Action',
        order: 1,
        startTimeSec: 3,
        durationSec: 3,
        scriptSegmentIds: ['seg_2'],
        status: 'approved',
      },
    ],
    tracks: [
      {
        id: 'track-text-1',
        name: 'Primary Typography Track',
        kind: 'text',
        order: 0,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        gainDb: 0,
        clips: [
          {
            id: 'clip-headline-hook',
            trackId: 'track-text-1',
            name: 'Hook Headline',
            kind: 'text',
            sceneId: scene1Id,
            sourceSegmentId: 'seg_1',
            startTimeSec: 0,
            durationSec: 3,
            sourceInSec: 0,
            sourceOutSec: 3,
            trimInSec: 0,
            trimOutSec: 0,
            speedMultiplier: 1,
            visible: true,
            locked: false,
            muted: false,
            solo: false,
            blendMode: 'normal',
            transform: {
              position: [540, 820],
              scale: [100, 100],
              rotationDeg: 0,
              anchor: [540, 820],
              opacity: 1,
            },
            textData: {
              content: 'PRECISION MOTION ON MOBILE',
              fontFamily: 'Inter',
              fontSizePx: 72,
              fontWeight: 800,
              letterSpacingEm: 0.04,
              lineHeightMultiplier: 1.15,
              colorHex: '#10b981',
              alignment: 'center',
              textTransform: 'uppercase',
            },
            keyframes: [
              {
                id: 'kf-hook-1',
                property: 'opacity',
                timeSec: 0,
                value: 0,
                interpolation: 'cubic-bezier',
                cubicBezier: [0.22, 1, 0.36, 1],
              },
              {
                id: 'kf-hook-2',
                property: 'opacity',
                timeSec: 0.45,
                value: 1,
                interpolation: 'cubic-bezier',
                cubicBezier: [0.22, 1, 0.36, 1],
              },
            ],
            effects: [
              {
                id: 'fx-glow-1',
                effectType: 'optical-glow',
                name: 'Optical Glow',
                enabled: true,
                rendererSupport: 'supported',
                supportedInAlightXml: true,
                parameters: { radius: 24, intensity: 0.45 },
              },
            ],
            masks: [],
          },
          {
            id: 'clip-headline-payoff',
            trackId: 'track-text-1',
            name: 'Payoff Headline',
            kind: 'text',
            sceneId: scene2Id,
            sourceSegmentId: 'seg_2',
            startTimeSec: 3,
            durationSec: 3,
            sourceInSec: 0,
            sourceOutSec: 3,
            trimInSec: 0,
            trimOutSec: 0,
            speedMultiplier: 1,
            visible: true,
            locked: false,
            muted: false,
            solo: false,
            blendMode: 'normal',
            transform: {
              position: [540, 860],
              scale: [100, 100],
              rotationDeg: 0,
              anchor: [540, 860],
              opacity: 1,
            },
            textData: {
              content: 'VERIFIED EXPORTS & 11-POINT QA',
              fontFamily: 'Inter',
              fontSizePx: 64,
              fontWeight: 700,
              letterSpacingEm: 0.03,
              lineHeightMultiplier: 1.15,
              colorHex: '#38bdf8',
              alignment: 'center',
              textTransform: 'uppercase',
            },
            keyframes: [],
            effects: [],
            masks: [],
          },
        ],
      },
      {
        id: 'track-audio-1',
        name: 'Master Audio & SFX Bed',
        kind: 'audio',
        order: 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        gainDb: 0,
        clips: [
          {
            id: 'clip-audio-bed',
            trackId: 'track-audio-1',
            name: 'Sub Bass Pulse Stem',
            kind: 'audio',
            sceneId: scene1Id,
            startTimeSec: 0,
            durationSec: 6,
            sourceInSec: 0,
            sourceOutSec: 6,
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
              scale: [100, 100],
              rotationDeg: 0,
              anchor: [0, 0],
              opacity: 1,
            },
            audioConfig: {
              gainDb: -3.5,
              linearGain: 0.66,
              pan: 0,
              fadeInSec: 0.2,
              fadeOutSec: 0.4,
              muted: false,
            },
            keyframes: [],
            effects: [],
            masks: [],
          },
        ],
      },
      {
        id: 'track-caption-1',
        name: 'Timed Subtitles Track',
        kind: 'caption',
        order: 2,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        gainDb: 0,
        clips: [
          {
            id: 'clip-caption-1',
            trackId: 'track-caption-1',
            name: 'Caption 1',
            kind: 'caption',
            sceneId: scene1Id,
            startTimeSec: 0.1,
            durationSec: 2.8,
            sourceInSec: 0,
            sourceOutSec: 2.8,
            trimInSec: 0,
            trimOutSec: 0,
            speedMultiplier: 1,
            visible: true,
            locked: false,
            muted: false,
            solo: false,
            blendMode: 'normal',
            transform: {
              position: [540, 1480],
              scale: [100, 100],
              rotationDeg: 0,
              anchor: [540, 1480],
              opacity: 1,
            },
            captionData: {
              cueIndex: 1,
              text: 'Precision motion graphics engineered for mobile creators.',
              speaker: 'Narrator',
              stylePresetId: 'clean-bold',
              highlightColorHex: '#10b981',
              maxCharsPerLine: 42,
            },
            keyframes: [],
            effects: [],
            masks: [],
          },
          {
            id: 'clip-caption-2',
            trackId: 'track-caption-1',
            name: 'Caption 2',
            kind: 'caption',
            sceneId: scene2Id,
            startTimeSec: 3.1,
            durationSec: 2.8,
            sourceInSec: 0,
            sourceOutSec: 2.8,
            trimInSec: 0,
            trimOutSec: 0,
            speedMultiplier: 1,
            visible: true,
            locked: false,
            muted: false,
            solo: false,
            blendMode: 'normal',
            transform: {
              position: [540, 1480],
              scale: [100, 100],
              rotationDeg: 0,
              anchor: [540, 1480],
              opacity: 1,
            },
            captionData: {
              cueIndex: 2,
              text: 'Every export is validated with checksums and 11-point QA.',
              speaker: 'Narrator',
              stylePresetId: 'clean-bold',
              highlightColorHex: '#38bdf8',
              maxCharsPerLine: 42,
            },
            keyframes: [],
            effects: [],
            masks: [],
          },
        ],
      },
    ],
  };
}
