import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildReferenceFixtureAVertical60FpsMp4,
  buildReferenceFixtureBLandscape24FpsMp4,
  buildReferenceFixtureCPngImage,
  buildReferenceFixtureDWavAudio,
  computeSha256HexFromBytes,
  DOCUMENTED_REFERENCE_MEDIA_FORMATS,
  ingestAndReconstructReferenceMedia,
  inspectReferenceSourceUrl,
  parseActualReferenceMediaBytes,
  validateUploadedMediaFormatAndSize,
} from '../services/referenceLabEngine';
import { validateCanonicalProject } from '../services/canonicalProjectEngine';
import { createApiApp } from '../server/apiApp';

const TEST_MASTER_VAULT_KEY = 'sowveil-test-master-vault-key-32bytes-secure-2026!';
process.env.SOWVEIL_MASTER_VAULT_KEY = TEST_MASTER_VAULT_KEY;
delete process.env.SOWVEIL_VAULT_KEY;

test('Reference Lab Media Ingestion 1: Documented format, size limit, and magic-byte validation', () => {
  assert.ok(DOCUMENTED_REFERENCE_MEDIA_FORMATS.length >= 10);

  // 1. Valid MP4 binary fixture passes format, size, and magic-byte validation
  const fixtureA = buildReferenceFixtureAVertical60FpsMp4();
  const validMp4 = validateUploadedMediaFormatAndSize({
    fileName: fixtureA.fileName,
    mimeType: fixtureA.mimeType,
    sizeBytes: fixtureA.bytes.byteLength,
    bytes: fixtureA.bytes,
  });
  assert.equal(validMp4.valid, true);
  assert.equal(validMp4.spec?.mimeTypes[0], 'video/mp4');

  // 2. Empty file is rejected
  const emptyCheck = validateUploadedMediaFormatAndSize({
    fileName: 'clip.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 0,
  });
  assert.equal(emptyCheck.valid, false);
  assert.equal(emptyCheck.errorCode, 'EMPTY_MEDIA_BYTES');

  // 3. Unsupported format is rejected
  const exeCheck = validateUploadedMediaFormatAndSize({
    fileName: 'installer.exe',
    mimeType: 'application/x-msdownload',
    sizeBytes: 4096,
  });
  assert.equal(exeCheck.valid, false);
  assert.equal(exeCheck.errorCode, 'UNSUPPORTED_MEDIA_FORMAT');

  // 4. Oversized file exceeding documented format limit (MP4 > 50MB) is rejected
  const oversizedMp4 = validateUploadedMediaFormatAndSize({
    fileName: 'huge-4k.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 55 * 1024 * 1024,
  });
  assert.equal(oversizedMp4.valid, false);
  assert.equal(oversizedMp4.errorCode, 'MEDIA_SIZE_LIMIT_EXCEEDED');

  // 5. Magic-byte mismatch (text bytes disguised as .mp4) is rejected
  const fakeMp4Bytes = new TextEncoder().encode('NOT_AN_ISO_BMFF_MP4_CONTAINER_HEADER');
  const mismatchCheck = validateUploadedMediaFormatAndSize({
    fileName: 'disguised.mp4',
    mimeType: 'video/mp4',
    sizeBytes: fakeMp4Bytes.byteLength,
    bytes: fakeMp4Bytes,
  });
  assert.equal(mismatchCheck.valid, false);
  assert.equal(mismatchCheck.errorCode, 'MAGIC_BYTE_MIME_MISMATCH');
});

test('Reference Lab Media Ingestion 2: URL honesty (never claims YouTube/Instagram/Pinterest bytes were fetched) and default false rights gate', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.instagram.com/reel/C8abc123/',
    'https://www.pinterest.com/pin/123456789/',
    'https://vimeo.com/123456789',
  ]) {
    const res = inspectReferenceSourceUrl(url);
    assert.equal(res.allowedForIngestion, true);
    assert.equal(
      res.mediaBytesFetched,
      false,
      `Must never claim media bytes were fetched for ${url}`
    );
    assert.equal(res.robotsAndPlatformTermsRespected, true);
    assert.equal(res.requiresUserMediaUpload, true);
  }

  // Attempting to ingest media with rightsConfirmedByUser = false is rejected
  const fixtureA = buildReferenceFixtureAVertical60FpsMp4();
  assert.throws(
    () =>
      ingestAndReconstructReferenceMedia({
        ownerUid: 'user_rights_check',
        fileName: fixtureA.fileName,
        mimeType: fixtureA.mimeType,
        bytes: fixtureA.bytes,
        usageMode: 'authorized-reconstruction',
        rightsConfirmedByUser: false,
      }),
    (err: any) => err?.code === 'RIGHTS_CONFIRMATION_REQUIRED'
  );
});

test('Reference Lab Media Ingestion 3: Two different-source binary MP4 fixtures produce distinct measurements, shots, palettes, and timelines from actual binary content', () => {
  const fixtureA = buildReferenceFixtureAVertical60FpsMp4();
  const fixtureB = buildReferenceFixtureBLandscape24FpsMp4();

  // Verify binary buffers and SHA-256 checksums are distinct
  const shaA = computeSha256HexFromBytes(fixtureA.bytes);
  const shaB = computeSha256HexFromBytes(fixtureB.bytes);
  assert.notEqual(shaA, shaB);
  assert.notEqual(fixtureA.bytes.byteLength, fixtureB.bytes.byteLength);

  const sessionA = ingestAndReconstructReferenceMedia({
    ownerUid: 'uid_fixture_tester',
    fileName: fixtureA.fileName,
    mimeType: fixtureA.mimeType,
    bytes: fixtureA.bytes,
    usageMode: 'authorized-reconstruction',
    rightsConfirmedByUser: true,
    attributionText: 'Owned Fixture A vertical kinetic reel',
    retentionMode: 'session-bound-7d',
    allowRemoteModelUpload: false,
  });

  const sessionB = ingestAndReconstructReferenceMedia({
    ownerUid: 'uid_fixture_tester',
    fileName: fixtureB.fileName,
    mimeType: fixtureB.mimeType,
    bytes: fixtureB.bytes,
    usageMode: 'authorized-reconstruction',
    rightsConfirmedByUser: true,
    attributionText: 'Owned Fixture B landscape bento showcase',
    retentionMode: 'workspace-durable-30d',
    allowRemoteModelUpload: false,
  });

  // 1. Dimensions, duration, FPS, and aspect ratio come from each file's binary mvhd/tkhd/stts boxes
  assert.equal(sessionA.mediaSpecs.width, 720);
  assert.equal(sessionA.mediaSpecs.height, 1280);
  assert.equal(sessionA.mediaSpecs.aspectRatio, '9:16');
  assert.equal(sessionA.mediaSpecs.durationSec, 4.5);
  assert.equal(sessionA.mediaSpecs.fps, 60);
  assert.equal(sessionA.mediaSpecs.hasAudioTrack, true);

  assert.equal(sessionB.mediaSpecs.width, 1920);
  assert.equal(sessionB.mediaSpecs.height, 1080);
  assert.equal(sessionB.mediaSpecs.aspectRatio, '16:9');
  assert.equal(sessionB.mediaSpecs.durationSec, 9.5);
  assert.equal(sessionB.mediaSpecs.fps, 24);
  assert.equal(sessionB.mediaSpecs.hasAudioTrack, false);

  // 2. Shot counts and boundaries come from each file's binary stss sync-sample table
  assert.equal(sessionA.shots.length, 2);
  assert.equal(sessionA.shots[0].startTimeSec, 0);
  assert.equal(sessionA.shots[0].endTimeSec, 2.25);
  assert.equal(sessionA.shots[1].startTimeSec, 2.25);
  assert.equal(sessionA.shots[1].endTimeSec, 4.5);

  assert.equal(sessionB.shots.length, 4);
  assert.equal(sessionB.shots[0].startTimeSec, 0);
  assert.equal(sessionB.shots[0].endTimeSec, 2.5);
  assert.equal(sessionB.shots[1].startTimeSec, 2.5);
  assert.equal(sessionB.shots[1].endTimeSec, 5.5);
  assert.equal(sessionB.shots[2].startTimeSec, 5.5);
  assert.equal(sessionB.shots[2].endTimeSec, 7.5);
  assert.equal(sessionB.shots[3].startTimeSec, 7.5);
  assert.equal(sessionB.shots[3].endTimeSec, 9.5);

  // 3. Extracted streams and sampled frames reflect each file's binary content
  const reportA = sessionA.sourceAnalysisReport!;
  const reportB = sessionB.sourceAnalysisReport!;
  assert.ok(reportA);
  assert.ok(reportB);
  assert.equal(reportA.streams.length, 2); // video + audio
  assert.equal(reportB.streams.length, 1); // video only
  assert.equal(reportA.sampledFrames.length, 2);
  assert.equal(reportB.sampledFrames.length, 4);
  assert.notDeepEqual(
    reportA.sampledFrames[0].dominantColorsHex,
    reportB.sampledFrames[0].dominantColorsHex
  );

  // 4. Both produce valid editable CanonicalProjectDocument v2.0.0 timelines with different scenes & clips
  assert.equal(validateCanonicalProject(sessionA.canonicalProject).valid, true);
  assert.equal(validateCanonicalProject(sessionB.canonicalProject).valid, true);
  assert.equal(sessionA.canonicalProject.scenes.length, 2);
  assert.equal(sessionB.canonicalProject.scenes.length, 4);

  const textClipsA = sessionA.canonicalProject.tracks
    .find((t) => t.kind === 'text')!
    .clips.map((c) => c.textData?.content);
  const textClipsB = sessionB.canonicalProject.tracks
    .find((t) => t.kind === 'text')!
    .clips.map((c) => c.textData?.content);
  assert.deepEqual(textClipsA, ['ZERO LATENCY SYNC', '60FPS KINETIC REEL']);
  assert.deepEqual(textClipsB, [
    'ARCHITECTURAL SCALE',
    'BENTO DATA GRID',
    'REALTIME TELEMETRY',
    'DEPLOY EVERYWHERE',
  ]);

  // 5. Epistemic labels and source timestamps are preserved on observations and reports
  const labelsA = Object.values(reportA.epistemicFieldLabels);
  assert.ok(labelsA.filter((v) => v === 'measured').length >= 3);
  assert.ok(labelsA.filter((v) => v === 'inferred').length >= 1);
  const obsLabelsA = sessionA.observations.map((o) => o.epistemicLabel);
  assert.ok(obsLabelsA.filter((v) => v === 'measured').length >= 2);
  assert.ok(obsLabelsA.filter((v) => v === 'inferred').length >= 2);
  assert.ok(obsLabelsA.filter((v) => v === 'unknown').length >= 1);
  assert.equal(reportA.exactHiddenKeyframeRecoveryClaimed, false);
  assert.equal(sessionA.fidelityReport.pixelIdenticalClaimed, false);
  assert.equal(reportA.sceneBreakdown.length, 2);
  assert.equal(reportB.sceneBreakdown.length, 4);

  for (const obs of sessionA.observations) {
    assert.ok(
      ['measured', 'inferred', 'AI-estimated', 'unknown'].includes(
        obs.epistemicLabel as string
      )
    );
    assert.equal(typeof obs.sourceTimestampSec, 'number');
    assert.ok(Array.isArray(obs.sourceTimestampRangeSec));
    assert.ok(typeof obs.extractionEvidence === 'string' && obs.extractionEvidence.length > 0);
  }
});

test('Reference Lab Media Ingestion 4: PNG image and WAV PCM audio binary parsers extract real dimensions, palettes, and audio waveform metrics', () => {
  // 1. PNG binary fixture (1080x1080 with PLTE palette & tEXt title)
  const pngFix = buildReferenceFixtureCPngImage();
  const parsedPng = parseActualReferenceMediaBytes({
    fileName: pngFix.fileName,
    mimeType: pngFix.mimeType,
    bytes: pngFix.bytes,
  });
  assert.equal(parsedPng.width, 1080);
  assert.equal(parsedPng.height, 1080);
  assert.equal(parsedPng.fps, null);
  assert.equal(parsedPng.hasAudioTrack, false);
  assert.ok(parsedPng.sampledColorsHex?.includes('#00F5D4'));
  assert.equal(parsedPng.extractedTextCues?.[0], 'CYBER CARD SQUARE 1080');

  // 2. WAV PCM binary fixture (8000 Hz mono 16-bit PCM, 2.0s with 4 rhythmic beat bursts)
  const wavFix = buildReferenceFixtureDWavAudio();
  const parsedWav = parseActualReferenceMediaBytes({
    fileName: wavFix.fileName,
    mimeType: wavFix.mimeType,
    bytes: wavFix.bytes,
  });
  assert.equal(parsedWav.hasAudioTrack, true);
  assert.equal(parsedWav.durationSec, 2);
  assert.ok(parsedWav.audioAnalysis);
  assert.equal(parsedWav.audioAnalysis?.sampleRateHz, 8000);
  assert.equal(parsedWav.audioAnalysis?.channels, 1);
  assert.equal(parsedWav.audioAnalysis?.codec, 'pcm_s16le');
  assert.equal(typeof parsedWav.audioAnalysis?.rmsLoudnessLufs, 'number');
  assert.equal(typeof parsedWav.audioAnalysis?.peakDb, 'number');
  assert.ok((parsedWav.audioAnalysis?.beatTimestampsSec.length || 0) >= 1);
  assert.ok((parsedWav.audioAnalysis?.waveformPeaks.length || 0) >= 8);
});

test('Reference Lab Media Ingestion 5: Server-side authenticated ingest-media, signed upload tickets, disk checksum persistence, and live Vision/ASR provider telemetry', async () => {
  let upstreamVisionCalls = 0;
  const app = createApiApp({
    tokenVerifier: async (token) => {
      if (token === 'token_creator_a') {
        return {
          uid: 'uid_creator_a',
          email: 'creator_a@example.com',
          emailVerified: true,
          displayName: 'Creator A',
        };
      }
      return {
        uid: 'uid_creator_b',
        email: 'creator_b@example.com',
        emailVerified: true,
        displayName: 'Creator B',
      };
    },
    providerProbeFetchImpl: async () => {
      upstreamVisionCalls += 1;
      const bodyObj = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    visionSummary:
                      'Vision model inspected 2 keyframes: high-contrast neon orange kinetic typography over dark slate backdrop.',
                    shotNotes: [
                      'Shot 1: Bold centered headline with fast scale pop-in.',
                      'Shot 2: Secondary callout card with cyan accent bar.',
                    ],
                    transcriptEstimate: 'Voiceover cue: Launch in sixty seconds with zero desktop.',
                  }),
                },
              ],
            },
          },
        ],
      };
      return new Response(JSON.stringify(bodyObj), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const fixtureA = buildReferenceFixtureAVertical60FpsMp4();
    const fixtureB = buildReferenceFixtureBLandscape24FpsMp4();

    // 1. Ingesting without rightsConfirmedByUser=true is rejected with 400 RIGHTS_CONFIRMATION_REQUIRED
    const unconfirmedRes = await fetch(`${baseUrl}/api/v1/reference-lab/ingest-media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_creator_a',
      },
      body: JSON.stringify({
        fileName: fixtureA.fileName,
        mimeType: fixtureA.mimeType,
        bytesBase64: Buffer.from(fixtureA.bytes).toString('base64'),
        usageMode: 'authorized-reconstruction',
        rightsConfirmedByUser: false,
      }),
    });
    assert.equal(unconfirmedRes.status, 400);
    const unconfirmedJson = await unconfirmedRes.json();
    assert.equal(unconfirmedJson.error.code, 'RIGHTS_CONFIRMATION_REQUIRED');

    // 2. Register a Gemini connection in Provider Hub for Creator A so we can test live Vision/ASR telemetry
    const createConnRes = await fetch(`${baseUrl}/api/v1/provider-hub/connections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_creator_a',
      },
      body: JSON.stringify({
        label: 'Reference Lab Vision Gemini',
        providerBrand: 'Google Gemini',
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-2.5-flash',
        authMode: 'x-api-key',
        credential: 'AIzaSyTestReferenceLabVisionKey123456',
      }),
    });
    assert.equal(createConnRes.status, 201);
    const connId = (await createConnRes.json()).data.connection.id;

    // 3. Authenticated upload of Fixture A with allowRemoteModelUpload=true invokes Vision/ASR and stores original file + SHA-256
    const ingestARes = await fetch(`${baseUrl}/api/v1/reference-lab/ingest-media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_creator_a',
      },
      body: JSON.stringify({
        fileName: fixtureA.fileName,
        mimeType: fixtureA.mimeType,
        bytesBase64: Buffer.from(fixtureA.bytes).toString('base64'),
        usageMode: 'authorized-reconstruction',
        rightsConfirmedByUser: true,
        attributionText: 'Creator A owned vertical reel',
        retentionMode: 'session-bound-7d',
        allowRemoteModelUpload: true,
        connectionId: connId,
      }),
    });
    assert.equal(ingestARes.status, 201);
    const ingestABody = await ingestARes.json();
    const sessionA = ingestABody.data.session;
    const reportA = ingestABody.data.sourceAnalysisReport;
    const assetA = ingestABody.data.mediaAsset;

    assert.equal(sessionA.mediaSpecs.width, 720);
    assert.equal(sessionA.mediaSpecs.height, 1280);
    assert.equal(sessionA.mediaSpecs.fps, 60);
    assert.equal(sessionA.shots.length, 2);

    const visionTelemetry = reportA.providerTelemetry.find(
      (t: any) => t.taskKind === 'vision-frame-analysis'
    );
    assert.ok(visionTelemetry);
    assert.equal(visionTelemetry.status, 'succeeded');
    assert.equal(visionTelemetry.actualContactedModelId, 'gemini-2.5-flash');
    assert.equal(reportA.epistemicFieldLabels.audioTranscript, 'AI-estimated');
    assert.ok(upstreamVisionCalls >= 1);

    // Verify the original binary file was persisted on disk and matches SHA-256 checksum
    const verifyAssetRes = await fetch(
      `${baseUrl}/api/v1/reference-lab/media-assets/${assetA.id}`,
      {
        headers: { Authorization: 'Bearer token_creator_a' },
      }
    );
    assert.equal(verifyAssetRes.status, 200);
    const verifyAssetJson = await verifyAssetRes.json();
    assert.equal(verifyAssetJson.data.existsOnDisk, true);
    assert.equal(verifyAssetJson.data.checksumMatches, true);
    assert.equal(
      verifyAssetJson.data.verifiedDiskSha256,
      computeSha256HexFromBytes(fixtureA.bytes)
    );

    // Cross-user access check: Creator B cannot read Creator A's uploaded media asset
    const forbiddenAssetRes = await fetch(
      `${baseUrl}/api/v1/reference-lab/media-assets/${assetA.id}`,
      {
        headers: { Authorization: 'Bearer token_creator_b' },
      }
    );
    assert.equal(forbiddenAssetRes.status, 403);

    // 4. Signed Upload Flow for Fixture B (1920x1080 24fps 4-shot silent MP4)
    const ticketRes = await fetch(`${baseUrl}/api/v1/reference-lab/signed-upload-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token_creator_a',
      },
      body: JSON.stringify({
        fileName: fixtureB.fileName,
        mimeType: fixtureB.mimeType,
        sizeBytes: fixtureB.bytes.byteLength,
        usageMode: 'authorized-reconstruction',
        rightsConfirmedByUser: true,
        retentionMode: 'workspace-durable-30d',
        allowRemoteModelUpload: false,
      }),
    });
    assert.equal(ticketRes.status, 201);
    const ticketData = (await ticketRes.json()).data.ticket;
    assert.ok(ticketData.ticketId);
    assert.ok(ticketData.signature);

    // Complete signed upload using raw binary body + X-Upload-Signature header
    const putSignedRes = await fetch(`${baseUrl}${ticketData.uploadUrl}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        Authorization: 'Bearer token_creator_a',
        'X-Upload-Signature': ticketData.signature,
      },
      body: Buffer.from(fixtureB.bytes),
    });
    assert.equal(putSignedRes.status, 201);
    const putSignedBody = await putSignedRes.json();
    const sessionB = putSignedBody.data.session;
    assert.equal(sessionB.mediaSpecs.width, 1920);
    assert.equal(sessionB.mediaSpecs.height, 1080);
    assert.equal(sessionB.mediaSpecs.fps, 24);
    assert.equal(sessionB.mediaSpecs.durationSec, 9.5);
    assert.equal(sessionB.shots.length, 4);
    assert.notEqual(sessionB.mediaSpecs.checksumSha256, sessionA.mediaSpecs.checksumSha256);

    // Clean up test disk files
    for (const storedAsset of [assetA, putSignedBody.data.mediaAsset]) {
      if (storedAsset?.storagePath) {
        const abs = path.resolve(process.cwd(), storedAsset.storagePath);
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
        }
      }
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
