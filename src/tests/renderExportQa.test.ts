import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApiApp } from '../server/apiApp';
import {
  cancelRenderExportJob,
  computeAdapterFeatureLossReport,
  createAndExecuteCanonicalRenderJob,
  createKnownGoodSampleCanonicalProject,
  DurableRenderExportJobRecord,
  generateValidJpegFrameBytes,
  getMobileAdapterCapabilityManifests,
  recoverInterruptedRenderJobsOnStartup,
  RenderOutputFormat,
  validateJpegBytes,
} from '../services/renderExportQaEngine';
import {
  computeSha256Hex,
  validateAndInspectAlightMotionXml,
  validatePngBytes,
  validateSrtContent,
  validateVttContent,
  validateWavBytes,
  validateZipSafety,
} from '../features/editor-gateway/strategies';

async function withTestServer(
  persistenceFilePath: string | null,
  fn: (baseUrl: string) => Promise<void>
) {
  const app = createApiApp({
    persistenceFilePath,
    tokenVerifier: async (token: string) => {
      if (token === 'valid-user-token') {
        return {
          uid: 'user-render-qa-1',
          email: 'creator@sowveil.studio',
          emailVerified: true,
          displayName: 'Render QA Creator',
        };
      }
      if (token === 'other-user-token') {
        return {
          uid: 'user-render-qa-2',
          email: 'other@sowveil.studio',
          emailVerified: true,
          displayName: 'Other User',
        };
      }
      throw new Error('Invalid token');
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('Failed to bind test server');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('Phase 13.1 — Known-good canonical project renders & validates across universal formats (.sowveil.zip, .json, .png, .jpg, .svg, .wav, .stems.zip, .srt, .vtt, .xml)', () => {
  const project = createKnownGoodSampleCanonicalProject('user-render-qa-1');

  const formatsToVerify: RenderOutputFormat[] = [
    'sowveil-bundle-zip',
    'sowveil-json',
    'png-frame',
    'jpeg-frame',
    'svg-vector',
    'wav-audio',
    'audio-stems-zip',
    'srt-captions',
    'vtt-captions',
    'alight-motion-xml',
    'capcut-handoff-zip',
    'node-video-handoff-zip',
    'kinemaster-handoff-zip',
  ];

  for (const fmt of formatsToVerify) {
    const job = createAndExecuteCanonicalRenderJob({
      ownerUid: 'user-render-qa-1',
      projectDoc: project,
      executionTier: 'final-render',
      outputFormat: fmt,
    });

    assert.equal(
      job.stage,
      'ready',
      `Expected format ${fmt} to reach stage "ready", got "${job.stage}"`
    );
    assert.ok(job.artifactMetadata, `Expected artifactMetadata for ${fmt}`);
    assert.ok(job.artifactBytesBase64, `Expected artifactBytesBase64 for ${fmt}`);
    assert.ok(job.qaReport, `Expected 11-point qaReport for ${fmt}`);
    assert.equal(
      job.qaReport.overallPassed,
      true,
      `Expected 11-point QA to pass for ${fmt}`
    );
    assert.equal(job.qaReport.checksPassedCount, 11);

    // Verify real work-unit progress accounting
    assert.equal(job.completedWorkUnits, job.totalWorkUnits);
    assert.equal(job.progressPercent, 100);
    assert.ok(job.stageHistory.length >= 6);

    // Verify exported metadata matches actual generated file bytes
    const rawBytes = new Uint8Array(
      Buffer.from(job.artifactBytesBase64, 'base64')
    );
    assert.equal(rawBytes.byteLength, job.artifactMetadata.sizeBytes);
    assert.equal(computeSha256Hex(rawBytes), job.artifactMetadata.sha256);
    assert.equal(job.artifactMetadata.width, 1080);
    assert.equal(job.artifactMetadata.height, 1920);
    assert.equal(job.artifactMetadata.fps, 30);
    assert.equal(job.artifactMetadata.durationSec, 6);
    assert.equal(job.artifactMetadata.projectRevision, 3);

    // Format-specific binary/structural decode checks
    if (fmt === 'png-frame') {
      const pngCheck = validatePngBytes(rawBytes);
      assert.equal(pngCheck.valid, true);
      assert.equal(pngCheck.width, 1080);
      assert.equal(pngCheck.height, 1920);
    } else if (fmt === 'jpeg-frame') {
      const jpgCheck = validateJpegBytes(rawBytes);
      assert.equal(jpgCheck.valid, true);
      assert.equal(jpgCheck.width, 1080);
      assert.equal(jpgCheck.height, 1920);
    } else if (fmt === 'wav-audio') {
      const wavCheck = validateWavBytes(rawBytes);
      assert.equal(wavCheck.valid, true);
    } else if (fmt === 'srt-captions') {
      const srtCheck = validateSrtContent(Buffer.from(rawBytes).toString('utf8'));
      assert.equal(srtCheck.valid, true);
      assert.equal(srtCheck.cueCount, 2);
    } else if (fmt === 'vtt-captions') {
      const vttCheck = validateVttContent(Buffer.from(rawBytes).toString('utf8'));
      assert.equal(vttCheck.valid, true);
      assert.equal(vttCheck.cueCount, 2);
    } else if (fmt === 'alight-motion-xml') {
      const xmlCheck = validateAndInspectAlightMotionXml(
        Buffer.from(rawBytes).toString('utf8')
      );
      assert.equal(xmlCheck.valid, true);
    } else if (fmt.endsWith('-zip')) {
      const zipCheck = validateZipSafety(rawBytes);
      assert.equal(zipCheck.valid, true);
      // Ensure KineMaster handoff is never disguised as a fake .kine file
      if (fmt === 'kinemaster-handoff-zip') {
        assert.ok(job.artifactMetadata.fileName.endsWith('.kinemaster-handoff.zip'));
        assert.ok(!job.artifactMetadata.fileName.endsWith('.kine'));
      }
    }
  }
});

test('Phase 13.2 — Proxy render vs Final render separation & JPEG binary validator edge cases', () => {
  const project = createKnownGoodSampleCanonicalProject('user-render-qa-1');

  const proxyJob = createAndExecuteCanonicalRenderJob({
    ownerUid: 'user-render-qa-1',
    projectDoc: project,
    executionTier: 'proxy-render',
    outputFormat: 'jpeg-frame',
  });

  assert.equal(proxyJob.stage, 'ready');
  assert.equal(proxyJob.executionTier, 'proxy-render');
  assert.equal(proxyJob.downscaleAssetsForProxy, true);
  assert.equal(proxyJob.requestedWidth, 540);
  assert.equal(proxyJob.requestedHeight, 960);
  assert.equal(proxyJob.requestedFps, 24);
  assert.ok(proxyJob.artifactMetadata?.fileName.includes('-proxy-540x960.jpg'));

  const proxyBytes = new Uint8Array(
    Buffer.from(proxyJob.artifactBytesBase64!, 'base64')
  );
  const jpgCheck = validateJpegBytes(proxyBytes);
  assert.equal(jpgCheck.valid, true);
  assert.equal(jpgCheck.width, 540);
  assert.equal(jpgCheck.height, 960);

  // Tamper with EOI marker and confirm validator rejects corrupted JPEG
  const corrupted = new Uint8Array(proxyBytes);
  corrupted[corrupted.byteLength - 1] = 0x00;
  const badCheck = validateJpegBytes(corrupted);
  assert.equal(badCheck.valid, false);

  // Also test standalone JPEG generator
  const customJpeg = generateValidJpegFrameBytes({
    width: 320,
    height: 180,
    accentHex: '#f97316',
  });
  const customCheck = validateJpegBytes(customJpeg);
  assert.equal(customCheck.valid, true);
  assert.equal(customCheck.width, 320);
  assert.equal(customCheck.height, 180);
});

test('Phase 13.3 — Process-restart recovery transitions in-flight jobs to interrupted-recovered and never invents success', () => {
  const project = createKnownGoodSampleCanonicalProject('user-render-qa-1');
  const finishedJob = createAndExecuteCanonicalRenderJob({
    ownerUid: 'user-render-qa-1',
    projectDoc: project,
    outputFormat: 'png-frame',
  });

  // Simulate an in-flight job that was in 'rendering-frames' at the moment the process exited
  const inFlightJob: DurableRenderExportJobRecord = {
    ...finishedJob,
    id: 'rjob_interrupted_sim_1',
    stage: 'rendering-frames',
    cancellable: true,
    completedWorkUnits: 5,
    totalWorkUnits: 20,
    progressPercent: 25,
    artifactMetadata: null,
    artifactBytesBase64: null,
    qaReport: null,
    completedAt: null,
  };

  const { recoveredJobs, interruptedCount } =
    recoverInterruptedRenderJobsOnStartup([finishedJob, inFlightJob]);

  assert.equal(interruptedCount, 1);
  assert.equal(recoveredJobs[0].stage, 'ready'); // Already finished job stays ready
  assert.equal(recoveredJobs[1].stage, 'interrupted-recovered');
  assert.equal(recoveredJobs[1].errorCode, 'PROCESS_RESTART_INTERRUPTED');
  assert.equal(recoveredJobs[1].artifactMetadata, null);
  assert.equal(recoveredJobs[1].artifactBytesBase64, null);
  assert.ok(
    recoveredJobs[1].stageHistory.some(
      (s) => s.stage === 'interrupted-recovered'
    )
  );
});

test('Phase 13.4 — Cancel, Retry policy, Server Worker gate for MP4/WebM, and Adapter Feature-Loss Reports', () => {
  const project = createKnownGoodSampleCanonicalProject('user-render-qa-1');

  // 1. Unconfigured MP4 video fails closed with 'needs-worker-setup' instead of faking an MP4
  const mp4Job = createAndExecuteCanonicalRenderJob({
    ownerUid: 'user-render-qa-1',
    projectDoc: project,
    outputFormat: 'mp4-video',
  });
  assert.equal(mp4Job.stage, 'needs-worker-setup');
  assert.equal(mp4Job.errorCode, 'RENDER_WORKER_NOT_CONFIGURED');
  assert.equal(mp4Job.artifactBytesBase64, null);

  // 2. Cancel & Retry state machine
  const cancelledJob = cancelRenderExportJob(
    mp4Job,
    'User cancelled waiting for worker setup'
  );
  assert.equal(cancelledJob.stage, 'cancelled');
  assert.equal(cancelledJob.errorCode, 'USER_CANCELLED');

  const retriedAsPng = createAndExecuteCanonicalRenderJob({
    ownerUid: 'user-render-qa-1',
    projectDoc: project,
    outputFormat: 'png-frame',
    existingJobToRetry: cancelledJob,
  });
  assert.equal(retriedAsPng.id, cancelledJob.id);
  assert.equal(retriedAsPng.stage, 'ready');
  assert.equal(retriedAsPng.retryPolicy.attemptCount, 2);

  // 3. Adapter Capability Manifests & Feature-Loss Report for unsupported 3D/shader effects
  const manifests = getMobileAdapterCapabilityManifests();
  assert.equal(manifests.length, 6);

  const projectWith3dAndSpring = {
    ...project,
    tracks: project.tracks.map((t, idx) =>
      idx === 0
        ? {
            ...t,
            clips: [
              ...t.clips,
              {
                ...t.clips[0],
                id: 'clip-3d-shader',
                name: '3D Liquid Shader Mesh',
                keyframes: [
                  {
                    id: 'kf-spring-1',
                    property: 'scaleX',
                    timeSec: 0,
                    value: 80,
                    interpolation: 'ease-out' as const,
                    easingPresetId: 'spring-snappy',
                  },
                ],
                effects: [
                  {
                    id: 'fx-3d-liquid',
                    effectType: 'liquid-glass-3d-shader',
                    name: 'Liquid Glass 3D Refraction',
                    enabled: true,
                    rendererSupport: 'unsupported' as const,
                    supportedInAlightXml: false,
                    parameters: { ior: 1.45 },
                  },
                ],
              },
            ],
          }
        : t
    ),
  };

  const alightLoss = computeAdapterFeatureLossReport(
    projectWith3dAndSpring,
    'alight-motion'
  );
  assert.equal(alightLoss.verificationStatus, 'Tested subset');
  assert.ok(alightLoss.droppedCount >= 1);
  assert.ok(alightLoss.approximatedCount >= 1);
  assert.ok(
    alightLoss.items.some(
      (i) =>
        i.handling === 'dropped' &&
        i.featureName.includes('Liquid Glass 3D Refraction')
    )
  );
});

test('Phase 13.5 — 11-Point Final QA Gate catches missing assets, audio clipping, and blank scene midpoints', () => {
  const baseProject = createKnownGoodSampleCanonicalProject('user-render-qa-1');

  // Inject a missing asset, extreme audio clipping (+12 dB), and an empty scene with no visual clips
  const flawedProject = {
    ...baseProject,
    assetReferences: [
      {
        assetId: 'missing-external-footage-99',
        title: 'Unlinked Camera Roll Clip',
        role: 'primary-media' as const,
        mimeType: 'video/mp4',
        required: true,
        missing: true,
        licenseType: 'User Owned' as const,
      },
    ],
    scenes: [
      ...baseProject.scenes,
      {
        id: 'scene-3-empty-black-gap',
        title: 'Scene 3 — Accidental Empty Gap',
        order: 2,
        startTimeSec: 6,
        durationSec: 3,
        scriptSegmentIds: [],
        status: 'approved' as const,
      },
    ],
    tracks: baseProject.tracks.map((t) =>
      t.kind === 'audio'
        ? {
            ...t,
            clips: t.clips.map((c) =>
              c.audioConfig
                ? {
                    ...c,
                    audioConfig: {
                      ...c.audioConfig,
                      gainDb: 12.0, // Intentional digital clipping trigger
                    },
                  }
                : c
            ),
          }
        : t
    ),
  };

  const job = createAndExecuteCanonicalRenderJob({
    ownerUid: 'user-render-qa-1',
    projectDoc: flawedProject,
    outputFormat: 'sowveil-bundle-zip',
  });

  assert.ok(job.qaReport);
  assert.equal(job.qaReport.overallPassed, false);
  assert.equal(job.qaReport.checks.allSourceAssetsResolve.passed, false);
  assert.equal(
    job.qaReport.checks.audioFreeOfUnintentionalClipping.passed,
    false
  );
  assert.equal(job.qaReport.checks.noAccidentalBlankFrames.passed, false);
});

test('Phase 13.6 — End-to-End API routes (/api/v1/render-export/*), authorized binary download, cross-user isolation, and durable restart recovery', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowveil-phase13-'));
  const stateFile = path.join(tmpDir, 'server-state.json');

  let createdJobId = '';

  await withTestServer(stateFile, async (baseUrl) => {
    const headers = {
      Authorization: 'Bearer valid-user-token',
      'Content-Type': 'application/json',
    };

    // 1. Capabilities endpoint
    const capRes = await fetch(`${baseUrl}/api/v1/render-export/capabilities`, {
      headers,
    });
    assert.equal(capRes.status, 200);
    const capJson = await capRes.json();
    assert.equal(capJson.ok, true);
    assert.equal(capJson.data.adapterManifests.length, 6);

    // 2. Feature-loss preview endpoint
    const flRes = await fetch(
      `${baseUrl}/api/v1/render-export/feature-loss-preview`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetAdapter: 'capcut',
          outputFormat: 'capcut-handoff-zip',
        }),
      }
    );
    assert.equal(flRes.status, 200);
    const flJson = await flRes.json();
    assert.equal(
      flJson.data.featureLossReport.verificationStatus,
      'Media handoff only'
    );

    // 3. Create & execute a real canonical render job (.sowveil.zip)
    const createRes = await fetch(`${baseUrl}/api/v1/render-export/jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        executionTier: 'final-render',
        outputFormat: 'sowveil-bundle-zip',
        targetAdapter: 'sowveil-project',
      }),
    });
    assert.equal(createRes.status, 201);
    const createJson = await createRes.json();
    assert.equal(createJson.ok, true);
    assert.equal(createJson.data.job.stage, 'ready');
    assert.equal(createJson.data.job.qaReport.overallPassed, true);
    createdJobId = createJson.data.job.id;

    // 4. Download binary artifact and verify SHA-256 header matches downloaded bytes
    const dlRes = await fetch(
      `${baseUrl}/api/v1/render-export/jobs/${createdJobId}/download`,
      { headers }
    );
    assert.equal(dlRes.status, 200);
    const shaHeader = dlRes.headers.get('x-sowveil-sha256');
    const dlBytes = new Uint8Array(await dlRes.arrayBuffer());
    assert.equal(computeSha256Hex(dlBytes), shaHeader);
    assert.equal(validateZipSafety(dlBytes).valid, true);

    // 5. Cross-user IDOR isolation check
    const idorRes = await fetch(
      `${baseUrl}/api/v1/render-export/jobs/${createdJobId}/download`,
      {
        headers: { Authorization: 'Bearer other-user-token' },
      }
    );
    assert.equal(idorRes.status, 404);
  });

  // Simulate an interrupted in-flight job in the persisted snapshot before restarting the server
  const savedSnapshot = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(Array.isArray(savedSnapshot.renderExportJobs));
  savedSnapshot.renderExportJobs.push({
    ...savedSnapshot.renderExportJobs[0],
    id: 'rjob_mid_render_crash',
    stage: 'packaging-container',
    completedWorkUnits: 14,
    totalWorkUnits: 20,
    progressPercent: 70,
    artifactMetadata: null,
    artifactBytesBase64: null,
    qaReport: null,
  });
  fs.writeFileSync(stateFile, JSON.stringify(savedSnapshot, null, 2), 'utf8');

  // Boot a fresh server instance against the same stateFile and verify recovery
  await withTestServer(stateFile, async (baseUrl) => {
    const listRes = await fetch(`${baseUrl}/api/v1/render-export/jobs`, {
      headers: { Authorization: 'Bearer valid-user-token' },
    });
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    const crashedJob = listJson.data.jobs.find(
      (j: DurableRenderExportJobRecord) => j.id === 'rjob_mid_render_crash'
    );
    assert.ok(crashedJob);
    assert.equal(crashedJob.stage, 'interrupted-recovered');
    assert.equal(crashedJob.hasDownloadableBytes, false);

    // Retry the interrupted job and confirm it completes cleanly
    const retryRes = await fetch(
      `${baseUrl}/api/v1/render-export/jobs/rjob_mid_render_crash/retry`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-user-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      }
    );
    assert.equal(retryRes.status, 200);
    const retryJson = await retryRes.json();
    assert.equal(retryJson.data.job.stage, 'ready');
    assert.equal(retryJson.data.job.retryPolicy.attemptCount, 2);
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
