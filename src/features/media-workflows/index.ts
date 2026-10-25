import {
  CatalogItem,
  MobileAspectRatio,
  ProjectLibraryItem,
  TargetMobileEditorId,
} from '../../types/sowveil';
import {
  buildZipArchiveBytes,
  CaptionCue,
  formatSrtTimestamp,
  formatVttTimestamp,
  serializeCaptionsToJson,
  serializeCaptionsToSrt,
  serializeCaptionsToVtt,
} from '../../services/editorGateway';

// ============================================================================
// A. MEDIA WORKSPACE & JOB ARCHITECTURE
// ============================================================================

export type MediaJobStateLabel =
  | 'Draft'
  | 'Queued'
  | 'Uploading'
  | 'Running'
  | 'Finalizing'
  | 'Ready'
  | 'Cancelled'
  | 'Failed'
  | 'Needs setup'
  | 'Quota reached';

export type MediaJobStatusCode =
  | 'draft'
  | 'queued'
  | 'uploading'
  | 'running'
  | 'finalizing'
  | 'ready'
  | 'cancelled'
  | 'failed'
  | 'needs-setup'
  | 'quota-reached';

export const MEDIA_JOB_STATE_LABELS: Record<MediaJobStatusCode, MediaJobStateLabel> = {
  draft: 'Draft',
  queued: 'Queued',
  uploading: 'Uploading',
  running: 'Running',
  finalizing: 'Finalizing',
  ready: 'Ready',
  cancelled: 'Cancelled',
  failed: 'Failed',
  'needs-setup': 'Needs setup',
  'quota-reached': 'Quota reached',
};

export const VALID_MEDIA_JOB_TRANSITIONS: Record<MediaJobStatusCode, MediaJobStatusCode[]> = {
  draft: ['queued', 'uploading', 'needs-setup', 'quota-reached', 'cancelled'],
  queued: [
    'uploading',
    'running',
    'finalizing',
    'ready',
    'needs-setup',
    'quota-reached',
    'cancelled',
    'failed',
  ],
  uploading: ['running', 'finalizing', 'failed', 'cancelled', 'quota-reached'],
  running: ['finalizing', 'ready', 'failed', 'cancelled', 'needs-setup'],
  finalizing: ['ready', 'failed', 'cancelled'],
  ready: ['cancelled'],
  cancelled: ['queued', 'draft'],
  failed: ['queued', 'draft'],
  'needs-setup': ['queued', 'draft', 'cancelled'],
  'quota-reached': ['queued', 'draft', 'cancelled'],
};

export function canTransitionMediaJob(
  from: MediaJobStatusCode,
  to: MediaJobStatusCode
): boolean {
  return VALID_MEDIA_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface DeterministicProgressInput {
  status: MediaJobStatusCode;
  processedBytes?: number;
  totalBytes?: number;
  completedStageIndex?: number;
  totalStages?: number;
}

/**
 * Derives job progress strictly from actual byte counts or deterministic processing stages.
 * Never uses arbitrary timers or random increments.
 */
export function computeDeterministicJobProgress(input: DeterministicProgressInput): {
  percent: number;
  basis: 'bytes' | 'stages' | 'terminal-state';
  detailLabel: string;
} {
  if (input.status === 'ready') {
    return {
      percent: 100,
      basis: 'terminal-state',
      detailLabel:
        typeof input.totalBytes === 'number' && input.totalBytes > 0
          ? `${input.totalBytes.toLocaleString()} / ${input.totalBytes.toLocaleString()} B verified`
          : 'Output verified & ready',
    };
  }
  if (
    input.status === 'draft' ||
    input.status === 'needs-setup' ||
    input.status === 'quota-reached' ||
    input.status === 'cancelled' ||
    input.status === 'failed'
  ) {
    return {
      percent: 0,
      basis: 'terminal-state',
      detailLabel: `State: ${MEDIA_JOB_STATE_LABELS[input.status]}`,
    };
  }

  if (
    typeof input.processedBytes === 'number' &&
    typeof input.totalBytes === 'number' &&
    input.totalBytes > 0
  ) {
    const clamped = Math.max(0, Math.min(input.totalBytes, input.processedBytes));
    const pct = Math.round((clamped / input.totalBytes) * 100);
    return {
      percent: pct,
      basis: 'bytes',
      detailLabel: `${clamped.toLocaleString()} / ${input.totalBytes.toLocaleString()} bytes (${pct}%)`,
    };
  }

  if (
    typeof input.completedStageIndex === 'number' &&
    typeof input.totalStages === 'number' &&
    input.totalStages > 0
  ) {
    const clamped = Math.max(0, Math.min(input.totalStages, input.completedStageIndex));
    const pct = Math.round((clamped / input.totalStages) * 100);
    return {
      percent: pct,
      basis: 'stages',
      detailLabel: `Stage ${clamped} of ${input.totalStages} (${pct}%)`,
    };
  }

  return {
    percent: 0,
    basis: 'stages',
    detailLabel: `State: ${MEDIA_JOB_STATE_LABELS[input.status]}`,
  };
}

export interface MobileResourceLimitsConfig {
  maxUploadSizeMb: number;
  maxMediaDurationSec: number;
  maxConcurrentJobsPerUser: number;
  dailyJobQuotaPerUser: number;
  largeFilePrivacyNoticeThresholdMb: number;
  workerConfigured: boolean;
  cloudStorageConfigured: boolean;
  ownerCostGateApproved: boolean;
}

export const DEFAULT_MOBILE_RESOURCE_LIMITS: MobileResourceLimitsConfig = {
  maxUploadSizeMb: 50,
  maxMediaDurationSec: 300,
  maxConcurrentJobsPerUser: 3,
  dailyJobQuotaPerUser: 200,
  largeFilePrivacyNoticeThresholdMb: 10,
  workerConfigured: false,
  cloudStorageConfigured: false,
  ownerCostGateApproved: false,
};

export interface MediaWorkerGateDecision {
  allowed: boolean;
  resultingStatus: MediaJobStatusCode;
  statusLabel: string;
  errorCode?: string;
  reason: string;
  costWarning: string;
}

export function evaluateMediaJobWorkerGate(params: {
  executionTier: 'browser-verified' | 'server-worker-required';
  fileSizeBytes?: number;
  durationSec?: number;
  activeUserJobsCount?: number;
  dailyUserJobsCount?: number;
  limits?: Partial<MobileResourceLimitsConfig>;
}): MediaWorkerGateDecision {
  const cfg: MobileResourceLimitsConfig = {
    ...DEFAULT_MOBILE_RESOURCE_LIMITS,
    ...(params.limits || {}),
  };

  const costWarning =
    'Cloud Run workers, Cloud Storage buckets, AI speech-to-text APIs, and server video rendering may incur GCP charges. No paid service is invoked without owner approval and quota enforcement.';

  // 1. Check daily quota
  if (
    typeof params.dailyUserJobsCount === 'number' &&
    params.dailyUserJobsCount >= cfg.dailyJobQuotaPerUser
  ) {
    return {
      allowed: false,
      resultingStatus: 'quota-reached',
      statusLabel: 'Quota reached',
      errorCode: 'DAILY_QUOTA_REACHED',
      reason: `Daily media job quota (${cfg.dailyJobQuotaPerUser} jobs/day) reached for this account.`,
      costWarning,
    };
  }

  // 2. Check concurrency limit
  if (
    typeof params.activeUserJobsCount === 'number' &&
    params.activeUserJobsCount >= cfg.maxConcurrentJobsPerUser
  ) {
    return {
      allowed: false,
      resultingStatus: 'quota-reached',
      statusLabel: 'Quota reached',
      errorCode: 'CONCURRENCY_LIMIT_REACHED',
      reason: `Maximum concurrent media jobs (${cfg.maxConcurrentJobsPerUser}) reached. Wait for active jobs to finish or cancel a job.`,
      costWarning,
    };
  }

  // 3. Check upload size limit
  const maxBytes = cfg.maxUploadSizeMb * 1024 * 1024;
  if (typeof params.fileSizeBytes === 'number' && params.fileSizeBytes > maxBytes) {
    return {
      allowed: false,
      resultingStatus: 'quota-reached',
      statusLabel: 'Quota reached',
      errorCode: 'FILE_SIZE_LIMIT_EXCEEDED',
      reason: `Media file size (${(params.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB) exceeds mobile upload cap of ${cfg.maxUploadSizeMb} MB.`,
      costWarning,
    };
  }

  // 4. Check duration limit
  if (typeof params.durationSec === 'number' && params.durationSec > cfg.maxMediaDurationSec) {
    return {
      allowed: false,
      resultingStatus: 'quota-reached',
      statusLabel: 'Quota reached',
      errorCode: 'DURATION_LIMIT_EXCEEDED',
      reason: `Media duration (${params.durationSec.toFixed(1)}s) exceeds mobile limit of ${cfg.maxMediaDurationSec}s.`,
      costWarning,
    };
  }

  // 5. Check server worker requirement
  if (params.executionTier === 'server-worker-required') {
    if (!cfg.workerConfigured) {
      return {
        allowed: false,
        resultingStatus: 'needs-setup',
        statusLabel: 'Needs server worker setup',
        errorCode: 'WORKER_NOT_CONFIGURED',
        reason:
          'Needs server worker setup: Heavy server-side ASR/FFmpeg/stream extraction worker is not configured in this environment. Use the verified mobile browser workflow or configure a backend worker.',
        costWarning,
      };
    }
    if (!cfg.ownerCostGateApproved) {
      return {
        allowed: false,
        resultingStatus: 'needs-setup',
        statusLabel: 'Needs setup',
        errorCode: 'COST_GATE_NOT_APPROVED',
        reason:
          'Paid server worker execution requires explicit owner cost-gate approval in Admin Settings.',
        costWarning,
      };
    }
  }

  return {
    allowed: true,
    resultingStatus: 'queued',
    statusLabel: 'Queued',
    reason: 'Validated within mobile resource and quota limits.',
    costWarning,
  };
}

// ============================================================================
// B. AUTO CAPTIONS — PARSING, OVERLAP VALIDATION, SEGMENT EDITING & SIDECAR ZIP
// ============================================================================

export interface CaptionCueSegment extends CaptionCue {
  speaker?: string;
}

export interface CaptionValidationConfig {
  maxCharsPerLine: number;
  maxLinesPerCue: number;
  minDurationSec: number;
  maxDurationSec: number;
  maxCharsPerSecond: number;
}

export const DEFAULT_CAPTION_VALIDATION_CONFIG: CaptionValidationConfig = {
  maxCharsPerLine: 38,
  maxLinesPerCue: 2,
  minDurationSec: 0.5,
  maxDurationSec: 7.0,
  maxCharsPerSecond: 24,
};

export type CaptionValidationIssueCode =
  | 'EMPTY_TEXT'
  | 'NEGATIVE_OR_ZERO_DURATION'
  | 'TIMESTAMP_OVERLAP'
  | 'LINE_TOO_LONG'
  | 'TOO_MANY_LINES'
  | 'DURATION_TOO_SHORT'
  | 'DURATION_TOO_LONG'
  | 'READING_SPEED_HIGH';

export interface CaptionValidationIssue {
  cueIndex: number;
  code: CaptionValidationIssueCode;
  severity: 'error' | 'warning';
  message: string;
}

export function validateCaptionTimeline(
  cues: CaptionCueSegment[],
  config?: Partial<CaptionValidationConfig>
): {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: CaptionValidationIssue[];
} {
  const cfg: CaptionValidationConfig = {
    ...DEFAULT_CAPTION_VALIDATION_CONFIG,
    ...(config || {}),
  };
  const issues: CaptionValidationIssue[] = [];

  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const duration = Number((cue.endSec - cue.startSec).toFixed(3));
    const trimmedText = (cue.text || '').trim();

    if (!trimmedText) {
      issues.push({
        cueIndex: cue.index,
        code: 'EMPTY_TEXT',
        severity: 'error',
        message: `Segment #${cue.index} has empty caption text.`,
      });
    }

    if (cue.startSec < 0 || duration <= 0 || Number.isNaN(duration)) {
      issues.push({
        cueIndex: cue.index,
        code: 'NEGATIVE_OR_ZERO_DURATION',
        severity: 'error',
        message: `Segment #${cue.index} has invalid timing (${cue.startSec.toFixed(2)}s → ${cue.endSec.toFixed(2)}s). End time must be greater than start time.`,
      });
    } else {
      if (duration < cfg.minDurationSec) {
        issues.push({
          cueIndex: cue.index,
          code: 'DURATION_TOO_SHORT',
          severity: 'warning',
          message: `Segment #${cue.index} duration (${duration.toFixed(2)}s) is shorter than recommended minimum (${cfg.minDurationSec}s).`,
        });
      }
      if (duration > cfg.maxDurationSec) {
        issues.push({
          cueIndex: cue.index,
          code: 'DURATION_TOO_LONG',
          severity: 'warning',
          message: `Segment #${cue.index} duration (${duration.toFixed(2)}s) exceeds recommended maximum (${cfg.maxDurationSec}s).`,
        });
      }
    }

    if (i > 0) {
      const prev = cues[i - 1];
      if (cue.startSec < prev.endSec - 0.001) {
        issues.push({
          cueIndex: cue.index,
          code: 'TIMESTAMP_OVERLAP',
          severity: 'error',
          message: `Segment #${cue.index} starts at ${cue.startSec.toFixed(2)}s before Segment #${prev.index} ends at ${prev.endSec.toFixed(2)}s.`,
        });
      }
    }

    const lines = trimmedText.split(/\r?\n/);
    if (lines.length > cfg.maxLinesPerCue) {
      issues.push({
        cueIndex: cue.index,
        code: 'TOO_MANY_LINES',
        severity: 'warning',
        message: `Segment #${cue.index} has ${lines.length} lines (max recommended for mobile is ${cfg.maxLinesPerCue}).`,
      });
    }

    for (const line of lines) {
      if (line.length > cfg.maxCharsPerLine) {
        issues.push({
          cueIndex: cue.index,
          code: 'LINE_TOO_LONG',
          severity: 'warning',
          message: `Segment #${cue.index} line length (${line.length} chars) exceeds mobile limit of ${cfg.maxCharsPerLine} chars.`,
        });
        break;
      }
    }

    if (duration > 0 && trimmedText.length > 0) {
      const cps = trimmedText.length / duration;
      if (cps > cfg.maxCharsPerSecond) {
        issues.push({
          cueIndex: cue.index,
          code: 'READING_SPEED_HIGH',
          severity: 'warning',
          message: `Segment #${cue.index} reading speed (${cps.toFixed(1)} chars/s) exceeds ${cfg.maxCharsPerSecond} chars/s.`,
        });
      }
    }
  }

  const errorCount = issues.filter((iss) => iss.severity === 'error').length;
  const warningCount = issues.filter((iss) => iss.severity === 'warning').length;

  return {
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}

function reindexCues(cues: CaptionCueSegment[]): CaptionCueSegment[] {
  return cues.map((cue, idx) => ({
    ...cue,
    index: idx + 1,
    startSec: Number(Math.max(0, cue.startSec).toFixed(3)),
    endSec: Number(Math.max(0, cue.endSec).toFixed(3)),
  }));
}

export function updateCaptionCueText(
  cues: CaptionCueSegment[],
  cueIndex: number,
  newText: string,
  speaker?: string
): CaptionCueSegment[] {
  return reindexCues(
    cues.map((c) =>
      c.index === cueIndex
        ? {
            ...c,
            text: newText,
            ...(speaker !== undefined ? { speaker: speaker.trim() || undefined } : {}),
          }
        : c
    )
  );
}

export function retimeCaptionCue(
  cues: CaptionCueSegment[],
  cueIndex: number,
  newStartSec: number,
  newEndSec: number
): CaptionCueSegment[] {
  return reindexCues(
    cues.map((c) =>
      c.index === cueIndex
        ? {
            ...c,
            startSec: Number(newStartSec.toFixed(3)),
            endSec: Number(newEndSec.toFixed(3)),
          }
        : c
    )
  );
}

export function splitCaptionCue(
  cues: CaptionCueSegment[],
  cueIndex: number,
  splitWordOffset?: number
): CaptionCueSegment[] {
  const pos = cues.findIndex((c) => c.index === cueIndex);
  if (pos === -1) return cues;

  const target = cues[pos];
  const words = target.text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    // Even if single word, split timing in half if duration >= 0.4s
    const mid = Number(((target.startSec + target.endSec) / 2).toFixed(3));
    if (mid <= target.startSec + 0.05) return cues;
    const firstHalf: CaptionCueSegment = {
      ...target,
      endSec: mid,
    };
    const secondHalf: CaptionCueSegment = {
      ...target,
      startSec: mid,
    };
    const next = [...cues.slice(0, pos), firstHalf, secondHalf, ...cues.slice(pos + 1)];
    return reindexCues(next);
  }

  const splitIdx =
    typeof splitWordOffset === 'number' &&
    splitWordOffset >= 1 &&
    splitWordOffset < words.length
      ? splitWordOffset
      : Math.ceil(words.length / 2);

  const firstWords = words.slice(0, splitIdx).join(' ');
  const secondWords = words.slice(splitIdx).join(' ');
  const ratio = splitIdx / words.length;
  const totalDur = Math.max(0.2, target.endSec - target.startSec);
  const splitTime = Number((target.startSec + totalDur * ratio).toFixed(3));

  const firstCue: CaptionCueSegment = {
    index: target.index,
    startSec: target.startSec,
    endSec: splitTime,
    text: firstWords,
    ...(target.speaker ? { speaker: target.speaker } : {}),
  };
  const secondCue: CaptionCueSegment = {
    index: target.index + 1,
    startSec: splitTime,
    endSec: Number(Math.max(splitTime + 0.1, target.endSec).toFixed(3)),
    text: secondWords,
    ...(target.speaker ? { speaker: target.speaker } : {}),
  };

  const next = [...cues.slice(0, pos), firstCue, secondCue, ...cues.slice(pos + 1)];
  return reindexCues(next);
}

export function mergeCaptionCues(
  cues: CaptionCueSegment[],
  firstCueIndex: number,
  secondCueIndex?: number
): CaptionCueSegment[] {
  const posA = cues.findIndex((c) => c.index === firstCueIndex);
  if (posA === -1) return cues;
  const posB =
    secondCueIndex !== undefined
      ? cues.findIndex((c) => c.index === secondCueIndex)
      : posA + 1;
  if (posB === -1 || posB <= posA || posB >= cues.length) return cues;

  const cueA = cues[posA];
  const cueB = cues[posB];
  const merged: CaptionCueSegment = {
    index: cueA.index,
    startSec: Math.min(cueA.startSec, cueB.startSec),
    endSec: Math.max(cueA.endSec, cueB.endSec),
    text: `${cueA.text.trim()} ${cueB.text.trim()}`.trim(),
    ...(cueA.speaker || cueB.speaker ? { speaker: cueA.speaker || cueB.speaker } : {}),
  };

  const next = [
    ...cues.slice(0, posA),
    merged,
    ...cues.slice(posA + 1, posB),
    ...cues.slice(posB + 1),
  ];
  return reindexCues(next);
}

export function deleteCaptionCue(
  cues: CaptionCueSegment[],
  cueIndex: number
): CaptionCueSegment[] {
  return reindexCues(cues.filter((c) => c.index !== cueIndex));
}

export function parseSrtTimestampToSec(raw: string): number {
  const match = raw
    .trim()
    .match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) {
    throw new Error(`Invalid SRT/VTT timestamp "${raw}"`);
  }
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  const ss = Number(match[3]);
  const ms = Number(match[4].padEnd(3, '0'));
  if (mm >= 60 || ss >= 60) {
    throw new Error(`Out-of-range minutes/seconds in timestamp "${raw}"`);
  }
  return Number((hh * 3600 + mm * 60 + ss + ms / 1000).toFixed(3));
}

export function parseSrtContent(rawSrt: string): CaptionCueSegment[] {
  const normalized = rawSrt.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/);
  const cues: CaptionCueSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;

    const timingLineIdx = lines[0].includes('-->') ? 0 : 1;
    const timingLine = lines[timingLineIdx];
    if (!timingLine || !timingLine.includes('-->')) continue;

    const [startRaw, endRaw] = timingLine.split('-->').map((s) => s.trim().split(' ')[0]);
    const startSec = parseSrtTimestampToSec(startRaw);
    const endSec = parseSrtTimestampToSec(endRaw);
    const textLines = lines.slice(timingLineIdx + 1);
    let text = textLines.join('\n').trim();
    let speaker: string | undefined;

    const speakerMatch = text.match(/^\[([^\]]+)\]:\s*(.+)$/s);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      text = speakerMatch[2].trim();
    }

    cues.push({
      index: cues.length + 1,
      startSec,
      endSec,
      text,
      ...(speaker ? { speaker } : {}),
    });
  }

  return reindexCues(cues);
}

export function parseVttContent(rawVtt: string): CaptionCueSegment[] {
  const normalized = rawVtt.replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith('WEBVTT')) {
    throw new Error('Invalid WebVTT header: file must begin with WEBVTT');
  }
  const withoutHeader = normalized.replace(/^WEBVTT[^\n]*\n?/, '').trim();
  return parseSrtContent(withoutHeader);
}

export function serializeCaptionSegmentsToSrt(cues: CaptionCueSegment[]): string {
  return serializeCaptionsToSrt(
    cues.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      text: c.speaker ? `[${c.speaker}]: ${c.text}` : c.text,
    }))
  );
}

export function serializeCaptionSegmentsToVtt(cues: CaptionCueSegment[]): string {
  return serializeCaptionsToVtt(
    cues.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      text: c.speaker ? `[${c.speaker}]: ${c.text}` : c.text,
    }))
  );
}

export function buildCaptionSidecarZipBundle(params: {
  baseName: string;
  targetEditor: TargetMobileEditorId;
  language: string;
  wordsPerCaption: number;
  cues: CaptionCueSegment[];
}): {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  sizeBytes: number;
} {
  const safeSlug =
    params.baseName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-]+/g, '-')
      .replace(/^-|-$/g, '') || 'sowveil-captions';

  const srtText = serializeCaptionSegmentsToSrt(params.cues);
  const vttText = serializeCaptionSegmentsToVtt(params.cues);
  const jsonText = serializeCaptionsToJson(
    params.cues.map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      text: c.speaker ? `[${c.speaker}]: ${c.text}` : c.text,
    })),
    {
      language: params.language,
      wordsPerCaption: params.wordsPerCaption,
    }
  );

  const guideLines = [
    `SOWVEIL STUDIO — MOBILE CAPTION SIDECAR BUNDLE`,
    `Target Editor: ${params.targetEditor}`,
    `Cue Count: ${params.cues.length}`,
    `Language: ${params.language}`,
    `Words Per Caption: ${params.wordsPerCaption}`,
    ``,
    `INCLUDED FILES:`,
    `1. ${safeSlug}.srt — SubRip subtitle file for CapCut, KineMaster & desktop NLEs`,
    `2. ${safeSlug}.vtt — WebVTT subtitle track for HTML5 & mobile web players`,
    `3. ${safeSlug}.captions.json — Portable Sowveil timed caption schema`,
    ``,
    `HOW TO IMPORT ON ANDROID:`,
    params.targetEditor === 'capcut'
      ? `- Open CapCut -> Text -> Local Captions -> select ${safeSlug}.srt from Downloads.`
      : params.targetEditor === 'alight-motion'
      ? `- Alight Motion does not natively import .srt files directly as timeline text layers; use the included timing sheet or import ${safeSlug}.srt in CapCut after compositing.`
      : `- Import ${safeSlug}.srt into your mobile editor's subtitle track or inspect ${safeSlug}.captions.json.`,
  ].join('\n');

  const encoder = new TextEncoder();
  const zipBytes = buildZipArchiveBytes([
    { name: `${safeSlug}.srt`, data: encoder.encode(srtText) },
    { name: `${safeSlug}.vtt`, data: encoder.encode(vttText) },
    { name: `${safeSlug}.captions.json`, data: encoder.encode(jsonText) },
    { name: `CAPTION_IMPORT_GUIDE.txt`, data: encoder.encode(guideLines) },
  ]);

  return {
    fileName: `${safeSlug}-${params.targetEditor}-captions-sidecar.zip`,
    mimeType: 'application/zip',
    bytes: zipBytes,
    sizeBytes: zipBytes.byteLength,
  };
}

// ============================================================================
// C & D. MODULE-SPECIFIC GENERATION: FONTS, 12 EXPRESSIONS, SFX WAVEFORM, 3D
// ============================================================================

export interface AuthorizedFontDescriptor {
  family: string;
  category: 'sans-serif' | 'monospace' | 'display' | 'serif';
  license: string;
  bundledInWebPreview: boolean;
  guaranteedInTargetMobileEditors: boolean;
  fallbackNotice: string;
}

export const AUTHORIZED_MOBILE_FONTS: AuthorizedFontDescriptor[] = [
  {
    family: 'Space Grotesk',
    category: 'sans-serif',
    license: 'OFL-1.1 (Google Fonts)',
    bundledInWebPreview: true,
    guaranteedInTargetMobileEditors: false,
    fallbackNotice:
      'Target mobile editors (CapCut, Alight Motion, Node Video, KineMaster) may not have Space Grotesk installed by default. Import the .ttf font in the target app or export a rasterized PNG/video overlay.',
  },
  {
    family: 'Inter',
    category: 'sans-serif',
    license: 'OFL-1.1 (Google Fonts)',
    bundledInWebPreview: true,
    guaranteedInTargetMobileEditors: false,
    fallbackNotice:
      'If Inter is not installed in your destination editor, it will substitute Roboto/System Sans unless you import Inter.ttf or use PNG/video handoff.',
  },
  {
    family: 'JetBrains Mono',
    category: 'monospace',
    license: 'OFL-1.1 (JetBrains)',
    bundledInWebPreview: true,
    guaranteedInTargetMobileEditors: false,
    fallbackNotice:
      'Monospace cipher/code presets use JetBrains Mono in Sowveil preview. Destination editors may fall back to Courier/Roboto Mono unless you import the font or export rendered media.',
  },
  {
    family: 'System Sans (Roboto / Android Default)',
    category: 'sans-serif',
    license: 'Android System Built-in',
    bundledInWebPreview: true,
    guaranteedInTargetMobileEditors: true,
    fallbackNotice:
      'System Sans maps to Roboto on Android devices and is available across mobile editors.',
  },
];

export function getFontFallbackNotice(fontFamily: string): AuthorizedFontDescriptor {
  return (
    AUTHORIZED_MOBILE_FONTS.find(
      (f) => f.family.toLowerCase() === fontFamily.trim().toLowerCase()
    ) || {
      family: fontFamily || 'Space Grotesk',
      category: 'sans-serif',
      license: 'User / Custom Font',
      bundledInWebPreview: false,
      guaranteedInTargetMobileEditors: false,
      fallbackNotice: `Custom font "${fontFamily}" is not guaranteed to be installed in CapCut, Alight Motion, Node Video, or KineMaster. Export a PNG/video overlay or manually import the font file into your target editor.`,
    }
  );
}

export interface ExpressionEvaluationResult {
  presetId: string;
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  opacity: number;
  formulaSummary: string;
  nativeExportSupportedEditors: TargetMobileEditorId[];
  fallbackExportStrategy: string;
}

/**
 * Deterministic mathematical evaluator for all 12 Sowveil Expressions presets.
 * Runs at 60fps in the mobile preview engine and bakes keyframe samples when
 * exporting to editors that do not parse After Effects JavaScript expressions.
 */
export function evaluateExpressionPresetMath(
  slugOrId: string,
  timeSec: number,
  params?: { frequency?: number; amplitude?: number; decay?: number }
): ExpressionEvaluationResult {
  const key = slugOrId.toLowerCase();
  const freq = params?.frequency ?? 2.0;
  const amp = params?.amplitude ?? 32;
  const decayRate = params?.decay ?? 3.5;
  const t = Math.max(0, timeSec);
  const omega = t * Math.PI * 2 * freq;

  let dx = 0;
  let dy = 0;
  let scaleX = 1;
  let scaleY = 1;
  let rotationDeg = 0;
  let opacity = 1;
  let formulaSummary = 'value';

  if (key.includes('wiggle')) {
    dx = Number((Math.sin(omega * 1.37) * Math.cos(omega * 0.73) * amp).toFixed(2));
    dy = Number((Math.cos(omega * 1.91) * Math.sin(omega * 1.13) * amp).toFixed(2));
    formulaSummary = `wiggle(${freq.toFixed(1)}, ${amp.toFixed(0)}) -> deterministic dual-harmonic pseudo-noise`;
  } else if (key.includes('bounce')) {
    const env = Math.exp(-decayRate * (t % 2.5));
    dy = Number((-Math.abs(Math.cos(omega * 1.5)) * amp * 1.2 * env).toFixed(2));
    scaleY = Number((1 - Math.max(0, (1 - env) * 0.08 * Math.sin(omega))).toFixed(3));
    formulaSummary = `abs(cos(ωt)) * ${amp} * exp(-${decayRate}t)`;
  } else if (key.includes('loop-out') || key.includes('loop')) {
    const cycle = (t * freq * 0.5) % 1;
    dx = Number(((cycle * 2 - 1) * amp).toFixed(2));
    formulaSummary = `loopOut("cycle") -> sawtooth phase ((t * ${freq}) mod 1)`;
  } else if (key.includes('sine')) {
    dy = Number((Math.sin(omega) * amp).toFixed(2));
    formulaSummary = `Math.sin(2π * ${freq} * t) * ${amp}`;
  } else if (key.includes('breathe')) {
    const s = 1 + Math.sin(omega * 0.6) * (amp / 200);
    scaleX = Number(s.toFixed(3));
    scaleY = Number(s.toFixed(3));
    formulaSummary = `1 + Math.sin(ωt) * ${(amp / 200).toFixed(2)}`;
  } else if (key.includes('spin')) {
    rotationDeg = Number(((t * freq * 90) % 360).toFixed(1));
    formulaSummary = `(time * ${(freq * 90).toFixed(0)}) % 360`;
  } else if (key.includes('elastic')) {
    const localT = t % 2.0;
    const env = Math.exp(-localT * 4.5);
    dx = Number((Math.sin(localT * Math.PI * 6 * freq) * amp * env).toFixed(2));
    formulaSummary = `sin(6πft) * ${amp} * exp(-4.5t)`;
  } else if (key.includes('pendulum')) {
    rotationDeg = Number((Math.sin(omega * 0.75) * (amp * 0.9)).toFixed(2));
    formulaSummary = `Math.sin(ωt) * ${(amp * 0.9).toFixed(1)}°`;
  } else if (key.includes('snap') || key.includes('scale')) {
    const step = Math.floor((t * freq) % 2) === 0 ? 1.18 : 0.92;
    scaleX = step;
    scaleY = step;
    formulaSummary = `stepQuantize(time * ${freq}) -> [${scaleX}, ${scaleY}]`;
  } else if (key.includes('jitter')) {
    dx = Number((Math.sin(t * 43.7) * (amp * 0.35)).toFixed(2));
    dy = Number((Math.cos(t * 59.3) * (amp * 0.35)).toFixed(2));
    rotationDeg = Number((Math.sin(t * 31.1) * 4).toFixed(2));
    formulaSummary = `highFreqDeterministicJitter(t, ${(amp * 0.35).toFixed(1)}px)`;
  } else if (key.includes('heartbeat')) {
    const phase = (t * freq * 0.8) % 1;
    const pulse =
      phase < 0.15
        ? Math.sin((phase / 0.15) * Math.PI) * 0.22
        : phase < 0.35
        ? Math.sin(((phase - 0.15) / 0.2) * Math.PI) * 0.12
        : 0;
    scaleX = Number((1 + pulse).toFixed(3));
    scaleY = Number((1 + pulse).toFixed(3));
    formulaSummary = `doubleSystolicPulse(t, ${freq}Hz)`;
  } else {
    // Drift / default
    dx = Number((Math.sin(omega * 0.5) * (amp * 0.6)).toFixed(2));
    dy = Number((Math.cos(omega * 0.35) * (amp * 0.4)).toFixed(2));
    formulaSummary = `orbitalDrift(t, ${freq}Hz, ${amp}px)`;
  }

  return {
    presetId: slugOrId,
    dx,
    dy,
    scaleX,
    scaleY,
    rotationDeg,
    opacity,
    formulaSummary,
    nativeExportSupportedEditors: ['sowveil-project'],
    fallbackExportStrategy:
      'Mobile editors (CapCut, Alight Motion, Node Video, KineMaster) do not execute After Effects JavaScript expressions natively. Sowveil exports portable .sowveil.json parameters, baked Alight Motion XML keyframe curves, or rendered overlay media.',
  };
}

/**
 * Extracts normalized waveform peak bars (10..100) from actual 16-bit PCM WAV bytes.
 */
export function extractWavWaveformPeaks(
  wavBytes: Uint8Array,
  barCount = 28
): number[] {
  const safeBars = Math.max(4, Math.min(64, Math.floor(barCount)));
  if (!wavBytes || wavBytes.byteLength <= 44) {
    return Array.from({ length: safeBars }, () => 15);
  }

  const dataBytes = wavBytes.byteLength - 44;
  const totalSamples = Math.floor(dataBytes / 2);
  if (totalSamples < safeBars) {
    return Array.from({ length: safeBars }, () => 20);
  }

  const view = new DataView(
    wavBytes.buffer,
    wavBytes.byteOffset + 44,
    totalSamples * 2
  );
  const samplesPerBar = Math.max(1, Math.floor(totalSamples / safeBars));
  const rawPeaks: number[] = [];
  let maxPeak = 1;

  for (let b = 0; b < safeBars; b++) {
    const startSample = b * samplesPerBar;
    const endSample = Math.min(totalSamples, startSample + samplesPerBar);
    let peak = 0;
    for (let s = startSample; s < endSample; s++) {
      const sampleVal = Math.abs(view.getInt16(s * 2, true));
      if (sampleVal > peak) peak = sampleVal;
    }
    if (peak > maxPeak) maxPeak = peak;
    rawPeaks.push(peak);
  }

  return rawPeaks.map((p) => Math.max(10, Math.min(100, Math.round((p / maxPeak) * 100))));
}

export interface GltfHeaderValidationResult {
  valid: boolean;
  format: 'glb-binary' | 'gltf-json' | 'unsupported';
  version?: string;
  reason: string;
}

export function validateGltfOrGlbHeaderBytes(
  bytes: Uint8Array,
  fileName = 'model.glb'
): GltfHeaderValidationResult {
  if (!bytes || bytes.byteLength < 12) {
    return {
      valid: false,
      format: 'unsupported',
      reason: 'File is too small to be a valid glTF 2.0 (.gltf or .glb) 3D asset.',
    };
  }

  // Check GLB magic 0x46546C67 ("glTF" in ASCII)
  if (
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
    const version = view.getUint32(4, true);
    if (version !== 2) {
      return {
        valid: false,
        format: 'glb-binary',
        version: String(version),
        reason: `Unsupported binary GLB version ${version}; glTF 2.0 is required for mobile WebGL rendering.`,
      };
    }
    return {
      valid: true,
      format: 'glb-binary',
      version: '2.0',
      reason: 'Verified binary glTF 2.0 (.glb) header.',
    };
  }

  // Check JSON .gltf
  if (fileName.toLowerCase().endsWith('.gltf') || bytes[0] === 0x7b) {
    try {
      const text = new TextDecoder().decode(bytes.slice(0, 4096));
      const parsed = JSON.parse(text) as { asset?: { version?: string } };
      if (parsed?.asset?.version && String(parsed.asset.version).startsWith('2')) {
        return {
          valid: true,
          format: 'gltf-json',
          version: String(parsed.asset.version),
          reason: `Verified JSON glTF ${parsed.asset.version} asset header.`,
        };
      }
    } catch {
      // fall through
    }
  }

  return {
    valid: false,
    format: 'unsupported',
    reason:
      'Unsupported 3D format. Only glTF 2.0 (.glb / .gltf) is supported on mobile browsers; heavy Cinema4D/OBJ/FBX assets use static fallback.',
  };
}

// ============================================================================
// D.6 PROJECT LIBRARY CHECKPOINTS & VERSION HISTORY
// ============================================================================

export interface ProjectCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  sowveilSpecJson: string;
  targetEditor?: TargetMobileEditorId;
  aspectRatio?: MobileAspectRatio;
}

export function createProjectCheckpoint(
  project: ProjectLibraryItem,
  label?: string,
  nowIso?: string
): ProjectCheckpoint {
  const now = nowIso || new Date().toISOString();
  const defaultSpec = JSON.stringify(
    {
      schemaVersion: '2.4.0-mobile',
      format: 'sowveil-mobile-project',
      exportedAt: now,
      targetEditor: project.targetEditor || 'sowveil-project',
      composition: {
        id: project.id,
        title: project.title,
        aspectRatio: project.aspectRatio || '9:16',
        resolution: project.resolution || '1080 × 1920',
        fps: project.fps || 60,
      },
      description: project.description,
      tags: project.tags,
    },
    null,
    2
  );

  return {
    id: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    label: (label || `Checkpoint · ${now.slice(11, 19)} UTC`).trim().slice(0, 80),
    createdAt: now,
    sowveilSpecJson: project.sowveilSpecJson || defaultSpec,
    targetEditor: project.targetEditor,
    aspectRatio: project.aspectRatio,
  };
}

// ============================================================================
// E & F. DOWNLOADER SSRF PROTECTION, MAGIC-BYTE SNIFFING & SIZE ESTIMATION
// ============================================================================

export type DownloaderSourceStatus =
  | 'Available (Direct HTTPS Media)'
  | 'Needs server worker setup'
  | 'Blocked (SSRF / Private Network)'
  | 'Unsupported Scheme';

export interface SsrfValidationResult {
  allowed: boolean;
  sourceStatus: DownloaderSourceStatus;
  errorCode?:
    | 'INVALID_URL_FORMAT'
    | 'UNSUPPORTED_SCHEME'
    | 'CREDENTIALS_IN_URL_FORBIDDEN'
    | 'SSRF_LOOPBACK_BLOCKED'
    | 'SSRF_PRIVATE_IP_BLOCKED'
    | 'SSRF_LINK_LOCAL_OR_METADATA_BLOCKED'
    | 'SSRF_INTERNAL_HOST_BLOCKED'
    | 'SERVER_EXTRACTOR_WORKER_REQUIRED';
  normalizedUrl?: string;
  hostname?: string;
  detectedExtension?: string;
  maxRedirects: number;
  timeoutMs: number;
  maxResponseBytes: number;
  reason: string;
}

const SOCIAL_EXTRACTOR_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'instagram.com',
  'vimeo.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'twitch.tv',
];

const DIRECT_MEDIA_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.mov',
  '.wav',
  '.mp3',
  '.ogg',
  '.m4a',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
];

function classifyIpv4Address(host: string): {
  isIp: boolean;
  blockedCode?: SsrfValidationResult['errorCode'];
  reason?: string;
} {
  // Block hex/octal/integer IP encodings like 0x7f000001 or 2130706433
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    return {
      isIp: true,
      blockedCode: 'SSRF_LOOPBACK_BLOCKED',
      reason: 'Numeric or hexadecimal IP literals are blocked to prevent SSRF bypass.',
    };
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) {
    // Also check octal dotted-quad like 0177.0.0.1
    if (/^[0-9.]+$/.test(host)) {
      return {
        isIp: true,
        blockedCode: 'SSRF_PRIVATE_IP_BLOCKED',
        reason: 'Non-standard dotted numeric host is blocked for SSRF safety.',
      };
    }
    return { isIp: false };
  }

  const octets = [
    Number(ipv4Match[1]),
    Number(ipv4Match[2]),
    Number(ipv4Match[3]),
    Number(ipv4Match[4]),
  ];
  if (
    octets.some((o) => o < 0 || o > 255) ||
    ipv4Match.slice(1).some((part) => part.length > 1 && part.startsWith('0'))
  ) {
    return {
      isIp: true,
      blockedCode: 'SSRF_PRIVATE_IP_BLOCKED',
      reason: 'Octal or out-of-range IPv4 address is blocked for SSRF protection.',
    };
  }

  const [a, b] = octets;

  // 127.0.0.0/8 Loopback or 0.0.0.0/8 Unspecified
  if (a === 127 || a === 0) {
    return {
      isIp: true,
      blockedCode: 'SSRF_LOOPBACK_BLOCKED',
      reason: `IPv4 loopback/unspecified range (${host}) is blocked by SSRF guard.`,
    };
  }

  // 169.254.0.0/16 Link-local & Cloud Metadata (169.254.169.254)
  if (a === 169 && b === 254) {
    return {
      isIp: true,
      blockedCode: 'SSRF_LINK_LOCAL_OR_METADATA_BLOCKED',
      reason: `Cloud metadata and link-local range (${host}) is strictly blocked.`,
    };
  }

  // RFC1918 Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  // Plus CGNAT 100.64.0.0/10, Benchmark 198.18.0.0/15, Multicast/Reserved >= 224
  if (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  ) {
    return {
      isIp: true,
      blockedCode: 'SSRF_PRIVATE_IP_BLOCKED',
      reason: `Private, CGNAT, or reserved IPv4 range (${host}) is blocked by SSRF policy.`,
    };
  }

  return { isIp: true };
}

function classifyIpv6Address(rawHost: string): {
  isIpv6: boolean;
  blockedCode?: SsrfValidationResult['errorCode'];
  reason?: string;
} {
  const cleaned = rawHost.replace(/^\[|\]$/g, '').toLowerCase();
  if (!cleaned.includes(':')) return { isIpv6: false };

  if (
    cleaned === '::1' ||
    cleaned === '::' ||
    cleaned === '0:0:0:0:0:0:0:1' ||
    cleaned === '0:0:0:0:0:0:0:0'
  ) {
    return {
      isIpv6: true,
      blockedCode: 'SSRF_LOOPBACK_BLOCKED',
      reason: `IPv6 loopback/unspecified address (${rawHost}) is blocked.`,
    };
  }

  if (cleaned.startsWith('fe8') || cleaned.startsWith('fe9') || cleaned.startsWith('fea') || cleaned.startsWith('feb')) {
    return {
      isIpv6: true,
      blockedCode: 'SSRF_LINK_LOCAL_OR_METADATA_BLOCKED',
      reason: `IPv6 link-local address (${rawHost}) is blocked.`,
    };
  }

  if (cleaned.startsWith('fc') || cleaned.startsWith('fd') || cleaned.startsWith('ff')) {
    return {
      isIpv6: true,
      blockedCode: 'SSRF_PRIVATE_IP_BLOCKED',
      reason: `IPv6 unique-local or multicast address (${rawHost}) is blocked.`,
    };
  }

  // IPv4-mapped IPv6 e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1 or ::ffff:169.254.169.254
  if (cleaned.includes('ffff:')) {
    const tail = cleaned.split('ffff:')[1] || '';
    if (tail.includes('.')) {
      const v4Check = classifyIpv4Address(tail);
      if (v4Check.blockedCode) {
        return {
          isIpv6: true,
          blockedCode: v4Check.blockedCode,
          reason: `IPv4-mapped IPv6 address (${rawHost}) resolves to a blocked IPv4 range.`,
        };
      }
    }
    return {
      isIpv6: true,
      blockedCode: 'SSRF_PRIVATE_IP_BLOCKED',
      reason: `IPv4-mapped IPv6 literal (${rawHost}) is blocked to prevent SSRF filter bypass.`,
    };
  }

  return { isIpv6: true };
}

/**
 * Validates a remote media URL against strict SSRF, scheme, credential, private IP,
 * link-local, cloud metadata, and extractor capability rules.
 * Never passes URLs to shell commands.
 */
export function validateMediaUrlForSsrf(
  rawUrl: string,
  options?: { workerConfigured?: boolean; maxResponseMb?: number }
): SsrfValidationResult {
  const maxResponseBytes = (options?.maxResponseMb ?? 50) * 1024 * 1024;
  const basePolicy = {
    maxRedirects: 2,
    timeoutMs: 8000,
    maxResponseBytes,
  };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      allowed: false,
      sourceStatus: 'Unsupported Scheme',
      errorCode: 'INVALID_URL_FORMAT',
      reason: 'Enter a valid full URL starting with https://',
      ...basePolicy,
    };
  }

  // 1. Only https: is allowed
  if (parsed.protocol !== 'https:') {
    return {
      allowed: false,
      sourceStatus: 'Unsupported Scheme',
      errorCode: 'UNSUPPORTED_SCHEME',
      reason: `Unsupported URL scheme "${parsed.protocol}". Only https:// URLs are permitted.`,
      ...basePolicy,
    };
  }

  // 2. Forbid embedded credentials
  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      sourceStatus: 'Blocked (SSRF / Private Network)',
      errorCode: 'CREDENTIALS_IN_URL_FORBIDDEN',
      reason: 'URLs containing embedded username/password credentials are forbidden.',
      ...basePolicy,
    };
  }

  const host = parsed.hostname.toLowerCase();

  // 3. Block localhost, internal, and cloud metadata hostnames
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa') ||
    host === 'metadata.google.internal' ||
    host === 'metadata' ||
    host === 'instance-data' ||
    host.includes('169.254.169.254')
  ) {
    const isMeta =
      host === 'metadata.google.internal' ||
      host === 'metadata' ||
      host === 'instance-data' ||
      host.includes('169.254.169.254');
    return {
      allowed: false,
      sourceStatus: 'Blocked (SSRF / Private Network)',
      errorCode: isMeta
        ? 'SSRF_LINK_LOCAL_OR_METADATA_BLOCKED'
        : host.includes('localhost')
        ? 'SSRF_LOOPBACK_BLOCKED'
        : 'SSRF_INTERNAL_HOST_BLOCKED',
      hostname: host,
      reason: `Host "${host}" is blocked by SSRF security policy (loopback, internal, or cloud metadata endpoint).`,
      ...basePolicy,
    };
  }

  // 4. Check IPv6 literals
  const v6 = classifyIpv6Address(host);
  if (v6.isIpv6 && v6.blockedCode) {
    return {
      allowed: false,
      sourceStatus: 'Blocked (SSRF / Private Network)',
      errorCode: v6.blockedCode,
      hostname: host,
      reason: v6.reason || 'Blocked IPv6 address.',
      ...basePolicy,
    };
  }

  // 5. Check IPv4 literals
  const v4 = classifyIpv4Address(host);
  if (v4.isIp && v4.blockedCode) {
    return {
      allowed: false,
      sourceStatus: 'Blocked (SSRF / Private Network)',
      errorCode: v4.blockedCode,
      hostname: host,
      reason: v4.reason || 'Blocked IPv4 address.',
      ...basePolicy,
    };
  }

  // 6. Check if domain requires a server-side social stream extractor worker
  const requiresSocialExtractor = SOCIAL_EXTRACTOR_DOMAINS.some(
    (dom) => host === dom || host.endsWith(`.${dom}`)
  );
  if (requiresSocialExtractor && !options?.workerConfigured) {
    return {
      allowed: false,
      sourceStatus: 'Needs server worker setup',
      errorCode: 'SERVER_EXTRACTOR_WORKER_REQUIRED',
      normalizedUrl: parsed.toString(),
      hostname: host,
      reason: `Host "${host}" requires a configured server-side media extraction worker with rate-limiting and owner cost approval. Direct browser downloading from third-party streaming sites is not supported without a backend worker.`,
      ...basePolicy,
    };
  }

  const lowerPath = parsed.pathname.toLowerCase();
  const detectedExt = DIRECT_MEDIA_EXTENSIONS.find((ext) => lowerPath.endsWith(ext));

  return {
    allowed: true,
    sourceStatus: 'Available (Direct HTTPS Media)',
    normalizedUrl: parsed.toString(),
    hostname: host,
    detectedExtension: detectedExt,
    reason: detectedExt
      ? `Verified public HTTPS media URL (${detectedExt}).`
      : `Verified public HTTPS host (${host}). Response MIME type and byte signature will be inspected before import.`,
    ...basePolicy,
  };
}

export function sanitizeMediaFileName(rawName: string): string {
  const base = rawName
    .replace(/\\/g, '/')
    .split('/')
    .pop() || 'media-asset';
  const cleaned = base
    .replace(/\.\.+/g, '.')
    .replace(/[^a-zA-Z0-9._\-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return cleaned || 'media-asset.bin';
}

export interface MediaSignatureVerificationResult {
  valid: boolean;
  detectedContainer:
    | 'mp4'
    | 'webm'
    | 'wav'
    | 'mp3'
    | 'ogg'
    | 'png'
    | 'jpeg'
    | 'glb'
    | 'srt'
    | 'vtt'
    | 'unknown';
  detectedMimeType: string;
  errorCode?: 'EMPTY_FILE' | 'DISGUISED_EXECUTABLE_OR_SCRIPT' | 'UNSUPPORTED_CODEC_OR_CONTAINER';
  reason: string;
}

/**
 * Verifies actual magic bytes of an uploaded or downloaded media buffer.
 * Rejects executables, HTML/JS scripts disguised as media, or unsupported containers.
 */
export function verifyMediaMagicBytes(
  bytes: Uint8Array,
  fileName = ''
): MediaSignatureVerificationResult {
  if (!bytes || bytes.byteLength < 4) {
    return {
      valid: false,
      detectedContainer: 'unknown',
      detectedMimeType: 'application/octet-stream',
      errorCode: 'EMPTY_FILE',
      reason: 'File is empty or truncated (< 4 bytes).',
    };
  }

  // Reject Windows PE ("MZ"), ELF ("\x7FELF"), Shebang ("#!"), or HTML/script tags
  if (
    (bytes[0] === 0x4d && bytes[1] === 0x5a) ||
    (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) ||
    (bytes[0] === 0x23 && bytes[1] === 0x21)
  ) {
    return {
      valid: false,
      detectedContainer: 'unknown',
      detectedMimeType: 'application/octet-stream',
      errorCode: 'DISGUISED_EXECUTABLE_OR_SCRIPT',
      reason: 'Blocked executable binary signature (PE/ELF/Script).',
    };
  }

  const headAscii = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, Math.min(256, bytes.byteLength)))
    .trimStart();

  if (/^<(?:!doctype\s+html|html|script|iframe|body)/i.test(headAscii)) {
    return {
      valid: false,
      detectedContainer: 'unknown',
      detectedMimeType: 'text/html',
      errorCode: 'DISGUISED_EXECUTABLE_OR_SCRIPT',
      reason: 'Blocked HTML/script payload disguised as a media file.',
    };
  }

  // 1. MP4 / MOV: bytes 4..7 == "ftyp" (0x66 0x74 0x79 0x70)
  if (
    bytes.byteLength >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return {
      valid: true,
      detectedContainer: 'mp4',
      detectedMimeType: 'video/mp4',
      reason: 'Verified ISO BMFF / MP4 container signature (ftyp).',
    };
  }

  // 2. WebM / Matroska: 0x1A 0x45 0xDF 0xA3
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return {
      valid: true,
      detectedContainer: 'webm',
      detectedMimeType: 'video/webm',
      reason: 'Verified EBML / WebM container signature.',
    };
  }

  // 3. WAV: "RIFF" (0..3) and "WAVE" (8..11)
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return {
      valid: true,
      detectedContainer: 'wav',
      detectedMimeType: 'audio/wav',
      reason: 'Verified RIFF WAVE audio signature.',
    };
  }

  // 4. MP3: "ID3" or frame sync 0xFF 0xFB / 0xFF 0xF3 / 0xFF 0xF2
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
    (bytes[0] === 0xff && (bytes[1] === 0xfb || bytes[1] === 0xf3 || bytes[1] === 0xf2))
  ) {
    return {
      valid: true,
      detectedContainer: 'mp3',
      detectedMimeType: 'audio/mpeg',
      reason: 'Verified MP3 audio signature.',
    };
  }

  // 5. OGG: "OggS"
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return {
      valid: true,
      detectedContainer: 'ogg',
      detectedMimeType: 'audio/ogg',
      reason: 'Verified Ogg container signature.',
    };
  }

  // 6. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return {
      valid: true,
      detectedContainer: 'png',
      detectedMimeType: 'image/png',
      reason: 'Verified PNG image signature.',
    };
  }

  // 7. JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return {
      valid: true,
      detectedContainer: 'jpeg',
      detectedMimeType: 'image/jpeg',
      reason: 'Verified JPEG image signature.',
    };
  }

  // 8. GLB: "glTF"
  if (
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  ) {
    return {
      valid: true,
      detectedContainer: 'glb',
      detectedMimeType: 'model/gltf-binary',
      reason: 'Verified glTF 2.0 binary (.glb) signature.',
    };
  }

  // 9. WebVTT or SRT subtitle text
  if (headAscii.startsWith('WEBVTT')) {
    return {
      valid: true,
      detectedContainer: 'vtt',
      detectedMimeType: 'text/vtt',
      reason: 'Verified WebVTT subtitle signature.',
    };
  }
  if (
    fileName.toLowerCase().endsWith('.srt') &&
    headAscii.includes('-->')
  ) {
    return {
      valid: true,
      detectedContainer: 'srt',
      detectedMimeType: 'application/x-subrip',
      reason: 'Verified SubRip (.srt) subtitle timing signature.',
    };
  }

  return {
    valid: false,
    detectedContainer: 'unknown',
    detectedMimeType: 'application/octet-stream',
    errorCode: 'UNSUPPORTED_CODEC_OR_CONTAINER',
    reason:
      'Unsupported media container or unrecognized magic-byte signature. Supported mobile formats: MP4, WebM, WAV, MP3, OGG, PNG, JPEG, GLB, SRT, VTT.',
  };
}

export function estimateMediaOutputSize(params: {
  format:
    | 'wav-audio'
    | 'srt-captions'
    | 'vtt-captions'
    | 'json-captions'
    | 'sowveil-json'
    | 'alight-xml'
    | 'png-still'
    | 'webm-video'
    | 'mp4-video';
  durationSec?: number;
  sampleRateHz?: number;
  exactPayloadBytes?: number;
}): {
  calculable: boolean;
  estimatedBytes: number | null;
  label: string;
} {
  if (typeof params.exactPayloadBytes === 'number' && params.exactPayloadBytes >= 0) {
    return {
      calculable: true,
      estimatedBytes: params.exactPayloadBytes,
      label: `${(params.exactPayloadBytes / 1024).toFixed(1)} KB (verified payload)`,
    };
  }

  if (params.format === 'wav-audio' && typeof params.durationSec === 'number') {
    const sr = params.sampleRateHz || 22050;
    const pcmBytes = 44 + Math.max(1, Math.floor(sr * params.durationSec)) * 2;
    return {
      calculable: true,
      estimatedBytes: pcmBytes,
      label: `${(pcmBytes / 1024).toFixed(1)} KB (16-bit PCM @ ${sr} Hz)`,
    };
  }

  // Variable bitrate video/compressed image size cannot be known deterministically before encoding
  return {
    calculable: false,
    estimatedBytes: null,
    label: 'Size not available until rendered',
  };
}
