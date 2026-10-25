import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp } from '../server/apiApp';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import {
  AUTHORIZED_MOBILE_FONTS,
  buildCaptionSidecarZipBundle,
  CaptionCueSegment,
  computeDeterministicJobProgress,
  createProjectCheckpoint,
  deleteCaptionCue,
  estimateMediaOutputSize,
  evaluateExpressionPresetMath,
  evaluateMediaJobWorkerGate,
  extractWavWaveformPeaks,
  getFontFallbackNotice,
  mergeCaptionCues,
  parseSrtContent,
  parseSrtTimestampToSec,
  parseVttContent,
  retimeCaptionCue,
  sanitizeMediaFileName,
  serializeCaptionSegmentsToSrt,
  serializeCaptionSegmentsToVtt,
  splitCaptionCue,
  updateCaptionCueText,
  validateCaptionTimeline,
  validateGltfOrGlbHeaderBytes,
  validateMediaUrlForSsrf,
  verifyMediaMagicBytes,
} from '../features/media-workflows';
import { generateProceduralSfxWavBytes } from '../services/editorGateway';
import { transitionJobRecord } from '../services/jobStateMachine';
import { JobRecord } from '../types/sowveil';

function startTestServer() {
  const app = createApiApp({
    tokenVerifier: async (token: string) => {
      if (token === 'token-user-a') {
        return {
          uid: 'uid-user-a',
          email: 'usera@example.com',
          emailVerified: true,
          displayName: 'User A',
        };
      }
      if (token === 'token-user-b') {
        return {
          uid: 'uid-user-b',
          email: 'userb@example.com',
          emailVerified: true,
          displayName: 'User B',
        };
      }
      throw new Error('INVALID_TOKEN');
    },
    ownerBootstrapEmail: 'owner@sowveil.studio',
    ownerBootstrapSecret: 'phase6-owner-secret-key',
  });

  const server = http.createServer(app);
  return new Promise<{
    baseUrl: string;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

test('Phase 6A — Media job lifecycle, deterministic progress & worker gate', () => {
  // Byte-based progress calculation (never arbitrary timers)
  const byteProgress = computeDeterministicJobProgress({
    status: 'uploading',
    processedBytes: 256_000,
    totalBytes: 1_024_000,
  });
  assert.equal(byteProgress.percent, 25);
  assert.equal(byteProgress.basis, 'bytes');
  assert.ok(byteProgress.detailLabel.includes('25%'));

  // Stage-based progress calculation
  const stageProgress = computeDeterministicJobProgress({
    status: 'running',
    completedStageIndex: 3,
    totalStages: 4,
  });
  assert.equal(stageProgress.percent, 75);
  assert.equal(stageProgress.basis, 'stages');
  assert.equal(stageProgress.detailLabel, 'Stage 3 of 4 (75%)');

  // Honest worker gate evaluation
  const browserGate = evaluateMediaJobWorkerGate({
    executionTier: 'browser-verified',
    fileSizeBytes: 1024 * 1024,
    durationSec: 15,
    dailyUserJobsCount: 2,
  });
  assert.equal(browserGate.allowed, true);
  assert.equal(browserGate.resultingStatus, 'queued');

  const unconfiguredHeavyGate = evaluateMediaJobWorkerGate({
    executionTier: 'server-worker-required',
    fileSizeBytes: 10 * 1024 * 1024,
    limits: {
      workerConfigured: false,
    },
  });
  assert.equal(unconfiguredHeavyGate.allowed, false);
  assert.equal(unconfiguredHeavyGate.resultingStatus, 'needs-setup');
  assert.equal(unconfiguredHeavyGate.errorCode, 'WORKER_NOT_CONFIGURED');
  assert.ok(unconfiguredHeavyGate.costWarning.includes('Cloud Run'));

  const quotaExceededGate = evaluateMediaJobWorkerGate({
    executionTier: 'browser-verified',
    fileSizeBytes: 80 * 1024 * 1024,
    limits: {
      maxUploadSizeMb: 50,
    },
  });
  assert.equal(quotaExceededGate.allowed, false);
  assert.equal(quotaExceededGate.resultingStatus, 'quota-reached');
  assert.equal(quotaExceededGate.errorCode, 'FILE_SIZE_LIMIT_EXCEEDED');

  // State machine transitions across Phase 6 states:
  // draft -> queued -> uploading -> running -> finalizing -> ready -> downloaded
  let job: JobRecord = {
    id: 'job_phase6_1',
    ownerUid: 'uid-user-a',
    type: 'caption',
    moduleId: 'auto-captions',
    title: 'Auto Captions Sidecar',
    status: 'draft',
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    attemptCount: 0,
    idempotencyKey: 'idem_phase6_1',
    deviceId: null,
    redactedMessage: 'Draft caption timeline created.',
    requestId: 'req_phase6_1',
  };
  assert.equal(job.status, 'draft');

  job = transitionJobRecord(job, 'queued', {
    nowIso: '2026-10-25T10:00:01.000Z',
    redactedMessage: 'Queued for processing.',
  });
  assert.equal(job.status, 'queued');

  job = transitionJobRecord(job, 'uploading', {
    nowIso: '2026-10-25T10:00:02.000Z',
    processedBytes: 512_000,
    totalBytes: 1_024_000,
    stageLabel: 'Uploading source audio',
  });
  assert.equal(job.status, 'uploading');
  assert.equal(job.progressPercent, 50);

  job = transitionJobRecord(job, 'running', {
    nowIso: '2026-10-25T10:00:03.000Z',
    completedStageIndex: 2,
    totalStages: 4,
    stageLabel: 'Segmenting transcript cues',
  });
  assert.equal(job.status, 'running');

  job = transitionJobRecord(job, 'finalizing', {
    nowIso: '2026-10-25T10:00:04.000Z',
    completedStageIndex: 3,
    totalStages: 4,
    stageLabel: 'Packaging .zip sidecar',
  });
  assert.equal(job.status, 'finalizing');

  job = transitionJobRecord(job, 'ready', {
    nowIso: '2026-10-25T10:00:05.000Z',
    completedStageIndex: 4,
    totalStages: 4,
    progressPercent: 100,
  });
  assert.equal(job.status, 'ready');

  // Verify quota-reached can be retried back to queued
  let quotaJob: JobRecord = {
    id: 'job_quota_1',
    ownerUid: 'uid-user-a',
    type: 'download',
    moduleId: 'downloader',
    title: 'Large Media Fetch',
    status: 'queued',
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    attemptCount: 1,
    idempotencyKey: 'idem_quota_1',
    deviceId: null,
    redactedMessage: 'Queued media fetch.',
    requestId: 'req_quota_1',
  };
  quotaJob = transitionJobRecord(quotaJob, 'quota-reached', {
    errorCode: 'QUOTA_REACHED',
    redactedMessage: 'Workspace quota reached.',
  });
  assert.equal(quotaJob.status, 'quota-reached');
  quotaJob = transitionJobRecord(quotaJob, 'queued', {
    redactedMessage: 'Retried after freeing quota.',
  });
  assert.equal(quotaJob.status, 'queued');
  assert.equal(quotaJob.attemptCount, 2);
});

test('Phase 6B — Auto Captions timestamp parsing, overlap & line validation, split/merge/retime, and SRT/VTT/ZIP round-trip', () => {
  assert.equal(parseSrtTimestampToSec('00:00:02,500'), 2.5);
  assert.equal(parseSrtTimestampToSec('01:02:03.250'), 3723.25);
  assert.throws(() => parseSrtTimestampToSec('invalid'), /Invalid SRT\/VTT timestamp/);

  let cues: CaptionCueSegment[] = [
    {
      index: 1,
      startSec: 0,
      endSec: 2.4,
      text: 'Sowveil Studio mobile motion engine.',
      speaker: 'Host',
    },
    {
      index: 2,
      startSec: 2.5,
      endSec: 5.1,
      text: 'Exporting verified captions to CapCut and Alight Motion.',
      speaker: 'Host',
    },
  ];

  // Clean timeline validation
  const validReport = validateCaptionTimeline(cues, {
    maxCharsPerLine: 80,
    minDurationSec: 0.3,
    maxDurationSec: 8,
  });
  assert.equal(validReport.valid, true);
  assert.equal(validReport.issues.length, 0);

  // Split segment 1 into two word-proportional halves (3/5 words -> 1.44s)
  cues = splitCaptionCue(cues, 1);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].startSec, 0);
  assert.equal(cues[0].endSec, 1.44);
  assert.equal(cues[1].startSec, 1.44);
  assert.equal(cues[1].endSec, 2.4);

  // Merge segments 1 and 2 back together
  cues = mergeCaptionCues(cues, 1);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startSec, 0);
  assert.equal(cues[0].endSec, 2.4);

  // Retime segment 1 to overlap with segment 2 and detect overlap error
  const overlappingCues = retimeCaptionCue(cues, 1, 0, 3.0);
  const overlapReport = validateCaptionTimeline(overlappingCues);
  assert.equal(overlapReport.valid, false);
  assert.ok(overlapReport.issues.some((i) => i.code === 'TIMESTAMP_OVERLAP'));

  // Detect line-length warning when maxCharsPerLine is tight
  const lineLengthReport = validateCaptionTimeline(cues, { maxCharsPerLine: 20 });
  assert.ok(lineLengthReport.issues.some((i) => i.code === 'LINE_TOO_LONG'));

  // Update text and speaker
  cues = updateCaptionCueText(cues, 2, 'Updated mobile caption cue.', 'Narrator');
  assert.equal(cues[1].text, 'Updated mobile caption cue.');
  assert.equal(cues[1].speaker, 'Narrator');

  // Round-trip SRT & VTT serialization and parsing
  const srtText = serializeCaptionSegmentsToSrt(cues);
  const parsedFromSrt = parseSrtContent(srtText);
  assert.equal(parsedFromSrt.length, 2);
  assert.equal(parsedFromSrt[0].startSec, 0);
  assert.equal(parsedFromSrt[0].endSec, 2.4);
  assert.ok(parsedFromSrt[1].text.includes('Updated mobile caption cue.'));

  const vttText = serializeCaptionSegmentsToVtt(cues);
  assert.ok(vttText.startsWith('WEBVTT'));
  const parsedFromVtt = parseVttContent(vttText);
  assert.equal(parsedFromVtt.length, 2);
  assert.equal(parsedFromVtt[1].startSec, 2.5);

  // Delete cue (while preserving at least 1 cue)
  const afterDelete = deleteCaptionCue(cues, 2);
  assert.equal(afterDelete.length, 1);

  // Build downloadable sidecar ZIP bundle
  const bundle = buildCaptionSidecarZipBundle({
    baseName: 'Mobile Promo Captions',
    targetEditor: 'capcut',
    language: 'en',
    wordsPerCaption: 3,
    cues,
  });
  assert.ok(bundle.fileName.endsWith('-capcut-captions-sidecar.zip'));
  assert.equal(bundle.mimeType, 'application/zip');
  assert.equal(bundle.bytes[0], 0x50); // 'P'
  assert.equal(bundle.bytes[1], 0x4b); // 'K'
  assert.equal(bundle.bytes[2], 0x03);
  assert.equal(bundle.bytes[3], 0x04);
  assert.ok(bundle.sizeBytes > 100);
});

test('Phase 6C & 6D — Expressions math (12 presets), real WAV waveform peaks, font fallback registry, glTF validator & Project checkpoints', () => {
  // Verify all 12 Expressions presets produce deterministic finite coordinates and code snippets
  const expressionPresets = SEED_CATALOG_ITEMS.filter((i) => i.moduleId === 'expressions');
  assert.equal(expressionPresets.length, 12);
  for (const preset of expressionPresets) {
    const t0 = evaluateExpressionPresetMath(preset.id, 0, {
      frequency: 2.2,
      amplitude: 36,
      decay: 2.8,
    });
    const tMid = evaluateExpressionPresetMath(preset.id, 0.75, {
      frequency: 2.2,
      amplitude: 36,
      decay: 2.8,
    });
    assert.ok(Number.isFinite(t0.dx));
    assert.ok(Number.isFinite(t0.dy));
    assert.ok(Number.isFinite(tMid.dx));
    assert.ok(Number.isFinite(tMid.dy));
    assert.ok(Number.isFinite(tMid.scaleX));
    assert.ok(Number.isFinite(tMid.rotationDeg));
    assert.ok(tMid.formulaSummary.length > 3);
    assert.ok(tMid.fallbackExportStrategy.includes('Mobile editors'));
  }

  // Real WAV synthesis + real PCM sample peak extraction
  const sfxPreset = SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'sfx')!;
  const wavBytes = generateProceduralSfxWavBytes(sfxPreset);
  const peaks = extractWavWaveformPeaks(wavBytes, 32);
  assert.equal(peaks.length, 32);
  assert.ok(peaks.some((p: number) => p >= 50));

  // Font fallback registry for Text Animation
  assert.ok(AUTHORIZED_MOBILE_FONTS.length >= 4);
  const groteskNotice = getFontFallbackNotice('Space Grotesk');
  assert.equal(groteskNotice.guaranteedInTargetMobileEditors, false);
  assert.ok(groteskNotice.fallbackNotice.includes('CapCut'));

  const systemSansNotice = getFontFallbackNotice('System Sans (Roboto / Android Default)');
  assert.equal(systemSansNotice.guaranteedInTargetMobileEditors, true);

  // glTF 2.0 / .glb binary header validation
  const glbHeader = new Uint8Array(20);
  const view = new DataView(glbHeader.buffer);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true); // version 2
  view.setUint32(8, 20, true); // length
  const glbCheck = validateGltfOrGlbHeaderBytes(glbHeader, 'scene.glb');
  assert.equal(glbCheck.valid, true);
  assert.equal(glbCheck.format, 'glb-binary');

  const gltfJsonBytes = new TextEncoder().encode(
    JSON.stringify({ asset: { version: '2.0', generator: 'Sowveil Studio' }, scenes: [] })
  );
  const gltfCheck = validateGltfOrGlbHeaderBytes(gltfJsonBytes, 'scene.gltf');
  assert.equal(gltfCheck.valid, true);
  assert.equal(gltfCheck.format, 'gltf-json');

  // Project Library checkpoint creation
  const cp = createProjectCheckpoint(
    {
      id: 'proj_test_1',
      title: 'Kinetic Title',
      description: 'Vertical mobile composition',
      compCount: 1,
      projectFileStatus: 'sowveil-native',
      fileSizeBytes: 1024,
      fileSizeLabel: '1.0 KB',
      aspectRatio: '9:16',
      targetEditor: 'sowveil-project',
      hasExternalFootageWarning: false,
      updatedAt: '2026-10-25T10:00:00.000Z',
      tags: ['mobile', 'kinetic'],
    },
    'Before mobile export'
  );
  assert.ok(cp.id.startsWith('chk_'));
  assert.equal(cp.label, 'Before mobile export');
  assert.ok(cp.sowveilSpecJson.includes('Kinetic Title'));
});

test('Phase 6E & 6F — SSRF URL guard, magic-byte inspection, filename sanitization & output size estimation', () => {
  // Block non-HTTPS, credentials, localhost, RFC1918, link-local, metadata, CGNAT, and IPv6 loopback/mapped
  const blockedUrls = [
    'http://cdn.sowveil.studio/clip.mp4',
    'file:///etc/passwd',
    'https://user:pass@cdn.sowveil.studio/clip.mp4',
    'https://localhost/clip.mp4',
    'https://127.0.0.1/clip.mp4',
    'https://10.0.0.42/clip.mp4',
    'https://172.16.0.10/clip.mp4',
    'https://172.31.255.1/clip.mp4',
    'https://192.168.1.100/clip.mp4',
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://100.64.1.1/internal.mp4',
    'https://[::1]/clip.mp4',
    'https://[::ffff:127.0.0.1]/clip.mp4',
    'https://[::ffff:10.0.0.1]/clip.mp4',
    'https://internal.cluster.local/clip.mp4',
  ];

  for (const url of blockedUrls) {
    const res = validateMediaUrlForSsrf(url);
    assert.equal(res.allowed, false, `Expected URL to be blocked by SSRF guard: ${url}`);
  }

  // Flag social extractor platforms honestly as requiring a configured remote worker
  const socialUrl = validateMediaUrlForSsrf('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(socialUrl.allowed, false);
  assert.equal(socialUrl.sourceStatus, 'Needs server worker setup');
  assert.equal(socialUrl.errorCode, 'SERVER_EXTRACTOR_WORKER_REQUIRED');

  // Allow direct HTTPS media URLs
  const directMp4 = validateMediaUrlForSsrf('https://cdn.example.com/assets/intro-reel.mp4');
  assert.equal(directMp4.allowed, true);
  assert.equal(directMp4.sourceStatus, 'Available (Direct HTTPS Media)');
  assert.equal(directMp4.detectedExtension, '.mp4');

  // Magic-byte verification for MP4, WebM, WAV, MP3, PNG, GLB and rejection of disguised scripts
  const mp4Bytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ]);
  const mp4Result = verifyMediaMagicBytes(mp4Bytes, 'clip.mp4');
  assert.equal(mp4Result.valid, true);
  assert.equal(mp4Result.detectedContainer, 'mp4');

  const webmBytes = new Uint8Array([
    0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x77, 0x65, 0x62, 0x6d,
  ]);
  const webmResult = verifyMediaMagicBytes(webmBytes, 'clip.webm');
  assert.equal(webmResult.valid, true);
  assert.equal(webmResult.detectedContainer, 'webm');

  const mp3Id3Bytes = new Uint8Array([
    0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x21,
  ]);
  const mp3Result = verifyMediaMagicBytes(mp3Id3Bytes, 'track.mp3');
  assert.equal(mp3Result.valid, true);
  assert.equal(mp3Result.detectedContainer, 'mp3');

  const disguisedHtml = new TextEncoder().encode('<!DOCTYPE html><script>alert(1)</script>');
  const disguisedResult = verifyMediaMagicBytes(disguisedHtml, 'video.mp4');
  assert.equal(disguisedResult.valid, false);
  assert.equal(disguisedResult.detectedContainer, 'unknown');
  assert.equal(disguisedResult.errorCode, 'DISGUISED_EXECUTABLE_OR_SCRIPT');

  // Filename sanitization
  assert.equal(sanitizeMediaFileName('../../etc/passwd<script>.mp4'), 'passwd_script_.mp4');

  // Honest output size estimation
  const wavEstimate = estimateMediaOutputSize({
    format: 'wav-audio',
    durationSec: 2,
    sampleRateHz: 44100,
  });
  assert.equal(wavEstimate.calculable, true);
  assert.equal(wavEstimate.estimatedBytes, 44 + 2 * 44100 * 2);

  const nonDeterministicVideo = estimateMediaOutputSize({
    format: 'mp4-video',
    durationSec: 10,
  });
  assert.equal(nonDeterministicVideo.calculable, false);
  assert.equal(nonDeterministicVideo.estimatedBytes, null);
  assert.equal(nonDeterministicVideo.label, 'Size not available until rendered');
});

test('Phase 6G — Backend API endpoints for SSRF validation, magic-byte inspection, caption sidecar ZIP, and owner-scoped job transitions', async () => {
  const srv = await startTestServer();
  try {
    // 1. POST /api/v1/media/validate-url blocks private IP / cloud metadata SSRF
    const ssrfRes = await fetch(`${srv.baseUrl}/api/v1/media/validate-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        url: 'https://169.254.169.254/latest/meta-data/',
        mode: 'video',
        rightsConfirmed: true,
      }),
    });
    assert.equal(ssrfRes.status, 403);
    const ssrfJson = await ssrfRes.json();
    assert.equal(ssrfJson.ok, false);
    assert.equal(ssrfJson.error.code, 'SSRF_LINK_LOCAL_OR_METADATA_BLOCKED');

    // 2. POST /api/v1/media/validate-url marks social platform URL as needs-setup when no extractor worker is configured
    const ytRes = await fetch(`${srv.baseUrl}/api/v1/media/validate-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        mode: 'video',
        rightsConfirmed: true,
      }),
    });
    assert.equal(ytRes.status, 200);
    const ytJson = await ytRes.json();
    assert.equal(ytJson.ok, true);
    assert.equal(ytJson.data.jobStatus, 'needs-setup');
    assert.equal(ytJson.data.sourceStatus, 'Needs server worker setup');

    // 3. POST /api/v1/media/inspect-bytes verifies real MP4 magic bytes and rejects disguised executables
    const mp4Bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ]);
    const inspectGoodRes = await fetch(`${srv.baseUrl}/api/v1/media/inspect-bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        fileName: '../my clip!.mp4',
        fileSizeBytes: 4096,
        base64Head: Buffer.from(mp4Bytes).toString('base64'),
      }),
    });
    assert.equal(inspectGoodRes.status, 200);
    const inspectGoodJson = await inspectGoodRes.json();
    assert.equal(inspectGoodJson.ok, true);
    assert.equal(inspectGoodJson.data.detectedContainer, 'mp4');
    assert.equal(inspectGoodJson.data.sanitizedFileName, 'my_clip_.mp4');

    const inspectBadRes = await fetch(`${srv.baseUrl}/api/v1/media/inspect-bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        fileName: 'exploit.mp4',
        fileSizeBytes: 1024,
        base64Head: Buffer.from('MZ-executable-header-fake').toString('base64'),
      }),
    });
    assert.equal(inspectBadRes.status, 415);

    // 4. POST /api/v1/captions/validate-and-bundle generates a real ZIP sidecar bundle
    const bundleRes = await fetch(`${srv.baseUrl}/api/v1/captions/validate-and-bundle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        baseName: 'Android Reels Subtitles',
        targetEditor: 'capcut',
        language: 'en',
        wordsPerCaption: 3,
        generateSidecarZip: true,
        cues: [
          {
            index: 1,
            startSec: 0,
            endSec: 1.8,
            text: 'Welcome to Sowveil Studio',
            speaker: 'Host',
          },
          {
            index: 2,
            startSec: 1.9,
            endSec: 3.6,
            text: 'Mobile-first subtitle bundle',
            speaker: 'Host',
          },
        ],
      }),
    });
    assert.equal(bundleRes.status, 200);
    const bundleJson = await bundleRes.json();
    assert.equal(bundleJson.ok, true);
    assert.equal(bundleJson.data.validation.valid, true);
    assert.ok(bundleJson.data.sidecarBundle);
    const zipBuffer = Buffer.from(bundleJson.data.sidecarBundle.base64Content, 'base64');
    assert.equal(zipBuffer[0], 0x50);
    assert.equal(zipBuffer[1], 0x4b);

    // 5. Create and transition an owner-scoped media job via POST /api/v1/jobs and PATCH /api/v1/jobs/:id
    const createJobRes = await fetch(`${srv.baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-a',
      },
      body: JSON.stringify({
        type: 'caption',
        moduleId: 'auto-captions',
        title: 'Auto Captions Job',
        status: 'uploading',
        redactedMessage: 'Uploading local audio...',
        idempotencyKey: 'idem_media_lifecycle_1',
        processedBytes: 128_000,
        totalBytes: 256_000,
        stageLabel: 'Uploading audio bytes',
      }),
    });
    assert.equal(createJobRes.status, 201);
    const createdJobJson = await createJobRes.json();
    assert.equal(createdJobJson.data.status, 'uploading');
    const createdJobId = createdJobJson.data.id as string;
    assert.ok(createdJobId.startsWith('job_'));

    // Cross-user isolation: User B cannot transition User A's job
    const crossUserPatch = await fetch(`${srv.baseUrl}/api/v1/jobs/${createdJobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token-user-b',
      },
      body: JSON.stringify({
        status: 'cancelled',
      }),
    });
    assert.equal(crossUserPatch.status, 403);

    // Owner User A transitions uploading -> running -> finalizing -> ready
    for (const nextStatus of ['running', 'finalizing', 'ready'] as const) {
      const patchRes = await fetch(`${srv.baseUrl}/api/v1/jobs/${createdJobId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token-user-a',
        },
        body: JSON.stringify({
          status: nextStatus,
          completedStageIndex: nextStatus === 'ready' ? 4 : 2,
          totalStages: 4,
          stageLabel: `Stage ${nextStatus}`,
        }),
      });
      assert.equal(patchRes.status, 200);
      const patchJson = await patchRes.json();
      assert.equal(patchJson.data.job.status, nextStatus);
    }
  } finally {
    await srv.close();
  }
});
