import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiApp } from '../server/apiApp';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import {
  ALIGHT_MOTION_XML_FEATURE_MATRIX,
  AssetBundleManifestSchema,
  buildMobileEditorExportArtifact,
  buildPortableMotionDocument,
  classifyPresetForAlightMotionXml,
  EditorCapabilitySchema,
  evaluateVideoExportCapability,
  ExportPresetSchema,
  generateJsonCaptionsFromCues,
  generateProceduralSfxWav,
  generateRealZipBundle,
  generateSrtFromCues,
  generateValidPngStillBytes,
  generateVttFromCues,
  getEditorAdapter,
  listEditorAdapters,
  parsePortableMotionDocument,
  parseSrtOrVttToCues,
  sanitizeSvgContent,
  serializeAlightMotionXml,
  validateAndInspectAlightMotionXml,
  validateLocalMediaFile,
  validatePngBytes,
  validateSrtContent,
  validateVttContent,
  validateWavBytes,
  validateZipSafety,
} from '../services/editorGateway';

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
      if (token === 'token-owner') {
        return {
          uid: 'uid-owner',
          email: 'owner@sowveil.studio',
          emailVerified: true,
          displayName: 'Studio Owner',
        };
      }
      throw new Error('INVALID_TOKEN');
    },
    ownerBootstrapEmail: 'owner@sowveil.studio',
    ownerBootstrapSecret: 'phase5-owner-secret-key',
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
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

test('Phase 5.1: EditorAdapter capability discovery & honest non-fabricated contracts across all 6 adapters', () => {
  const adapters = listEditorAdapters();
  assert.equal(adapters.length, 6);

  for (const adapter of adapters) {
    const cap = adapter.discoverCapabilities('text-animation');
    const parsedCap = EditorCapabilitySchema.safeParse(cap);
    assert.equal(
      parsedCap.success,
      true,
      `Adapter ${adapter.id} capability failed schema validation`
    );
    assert.ok(cap.whyNotDirectTimelineInsertion.length > 20);
  }

  // CapCut must be Media handoff only and never claim .capcut project generation
  const capcutCap = getEditorAdapter('capcut').discoverCapabilities();
  assert.equal(capcutCap.nativeProjectWriting.supported, false);
  assert.equal(capcutCap.nativeProjectWriting.formatExtension, null);

  // KineMaster native .kine project writing must be disabled ("Needs target-app validation")
  const kineCap = getEditorAdapter('kinemaster').discoverCapabilities();
  assert.equal(kineCap.nativeProjectWriting.supported, false);
  assert.equal(kineCap.nativeProjectWriting.status, 'Needs target-app validation');
  assert.equal(kineCap.nativeProjectWriting.formatExtension, null);

  // Node Video export bundle must be labeled "Sowveil media bundle for Node Video", never "Node Video Project"
  const textItem = SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'text-animation')!;
  const nodeExport = getEditorAdapter('node-video').generateExport({
    item: textItem,
    preset: { aspectRatio: '9:16' },
  });
  assert.equal(nodeExport.bundleLabel, 'Sowveil media bundle for Node Video');
  assert.ok(!nodeExport.bundleLabel.includes('Node Video Project'));
});

test('Phase 5.2: Strategy selection for supported vs. unsupported features & Alight Motion XML subset classification', () => {
  const textItem = SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'text-animation')!;
  const sfxItem = SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'sfx')!;
  const exprItem = SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'expressions')!;

  const textClass = classifyPresetForAlightMotionXml(textItem);
  assert.equal(textClass.status, 'Alight Motion XML — tested subset');
  assert.equal(textClass.canExportXml, true);

  const sfxClass = classifyPresetForAlightMotionXml(sfxItem);
  assert.equal(sfxClass.status, 'Generic media pack');
  assert.equal(sfxClass.canExportXml, false);

  const exprClass = classifyPresetForAlightMotionXml(exprItem);
  assert.equal(exprClass.status, 'Generic media pack');
  assert.equal(exprClass.canExportXml, false);

  // Requesting alight-xml on an expression preset must gracefully fall back to zip-bundle with a warning
  const alightAdapter = getEditorAdapter('alight-motion');
  const validation = alightAdapter.validateConfiguration(exprItem, {
    outputFormat: 'alight-xml',
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.resolvedFormat, 'zip-bundle');
  assert.equal(validation.fallbackFormat, 'zip-bundle');
  assert.ok(validation.warnings.length > 0);

  // Feature matrix must list both supported and unsupported XML constructs
  assert.ok(
    ALIGHT_MOTION_XML_FEATURE_MATRIX.some((f) =>
      f.status.startsWith('Supported')
    )
  );
  assert.ok(
    ALIGHT_MOTION_XML_FEATURE_MATRIX.some((f) =>
      f.status.startsWith('Unsupported')
    )
  );
});

test('Phase 5.3: Portable MotionDocument v2.0 serialization, deserialization & forward-compatible unknown field passthrough', () => {
  const item = SEED_CATALOG_ITEMS[0];
  const doc = buildPortableMotionDocument({
    item,
    targetEditor: 'sowveil-project',
    aspectRatio: '9:16',
    fps: 60,
    durationSec: 4,
    backgroundMode: 'chroma-key-green',
    customValues: { headline: 'Forward Compatible Title' },
  });

  const rawWithFutureFields = {
    ...doc,
    futureEngineFlag: 'quantum-spline-v3',
    experimentalCameraRig: { fov: 55, dof: true },
  };

  const parsed = parsePortableMotionDocument(rawWithFutureFields);
  assert.equal(parsed.valid, true, parsed.error);
  assert.ok(parsed.unknownTopLevelKeys.includes('futureEngineFlag'));
  assert.ok(parsed.unknownTopLevelKeys.includes('experimentalCameraRig'));
  assert.equal(
    parsed.document?.unknownFields?.futureEngineFlag,
    'quantum-spline-v3'
  );
  assert.equal(parsed.document?.composition.backgroundColorHex, '#00FF00');
});

test('Phase 5.4: Alight Motion XML serializer, fixture inspection & XXE/script rejection', () => {
  const item = SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'text-animation')!;
  const xml = serializeAlightMotionXml({
    item,
    aspectRatio: '9:16',
    fps: 60,
    durationSec: 3.5,
    backgroundMode: 'solid',
    customValues: { headline: 'Alight <Scene> & "Quotes"' },
  });

  const summary = validateAndInspectAlightMotionXml(xml);
  assert.equal(summary.valid, true, summary.reason);
  assert.equal(summary.width, 1080);
  assert.equal(summary.height, 1920);
  assert.equal(summary.fps, 60);
  assert.equal(summary.totalTimeMs, 3500);
  assert.ok(summary.shapeCount >= 1);
  assert.ok(summary.textCount >= 1);
  assert.ok(summary.keyframeCount >= 4);
  assert.equal(summary.hasCubicBezier, true);
  assert.ok(xml.includes('Alight &lt;Scene&gt; &amp; &quot;Quotes&quot;'));

  // Reject XML with <!DOCTYPE / <!ENTITY XXE attempt
  const xxeAttempt = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><scene width="1080" height="1920" fps="60" totalTime="3000"></scene>`;
  const xxeCheck = validateAndInspectAlightMotionXml(xxeAttempt);
  assert.equal(xxeCheck.valid, false);
});

test('Phase 5.5: SRT, WebVTT, and JSON caption generation, round-trip parsing & validation', () => {
  const cues = [
    { index: 1, startSec: 0, endSec: 1.25, text: 'First mobile caption cue' },
    { index: 2, startSec: 1.25, endSec: 2.9, text: 'Second vertical 9:16 subtitle' },
  ];

  const srt = generateSrtFromCues(cues);
  const srtCheck = validateSrtContent(srt);
  assert.equal(srtCheck.valid, true);
  assert.equal(srtCheck.cueCount, 2);

  const vtt = generateVttFromCues(cues);
  const vttCheck = validateVttContent(vtt);
  assert.equal(vttCheck.valid, true);
  assert.equal(vttCheck.cueCount, 2);

  const roundTripFromVtt = parseSrtOrVttToCues(vtt);
  assert.equal(roundTripFromVtt.valid, true);
  assert.equal(roundTripFromVtt.cues.length, 2);
  assert.equal(roundTripFromVtt.cues[0].text, 'First mobile caption cue');

  const jsonTrack = generateJsonCaptionsFromCues(cues, '9:16');
  const parsedJson = JSON.parse(jsonTrack);
  assert.equal(parsedJson.format, 'sowveil-caption-track');
  assert.equal(parsedJson.cueCount, 2);
});

test('Phase 5.6: ZIP bundle creation, AssetBundleManifest validation, anti-ZIP-bomb & path traversal protection', () => {
  const item = SEED_CATALOG_ITEMS[0];
  const artifact = buildMobileEditorExportArtifact({
    item,
    targetEditor: 'capcut',
    format: 'zip-bundle',
    aspectRatio: '9:16',
    fps: 30,
    durationSec: 3,
    backgroundMode: 'chroma-key-green',
  });

  assert.equal(artifact.validationPassed, true);
  assert.equal(AssetBundleManifestSchema.safeParse(artifact.manifestObject).success, true);
  assert.equal( ExportPresetSchema.safeParse(artifact.preset).success, true);
  assert.equal(artifact.sha256.length, 64);

  const zipSafety = validateZipSafety(artifact.bytes);
  assert.equal(zipSafety.valid, true);
  assert.ok(zipSafety.fileNames.includes('manifest.json'));
  assert.ok(zipSafety.fileNames.includes('IMPORT_STEPS.txt'));

  // Test ZIP entry count limit (anti-ZIP-bomb)
  const tooManyCheck = validateZipSafety(artifact.bytes, { maxEntries: 2 });
  assert.equal(tooManyCheck.valid, false);
  assert.match(tooManyCheck.reason, /exceeds safe maximum/);

  // Test SVG sanitizer against <script>, onload, and external href
  const dirtySvg = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>evil()</script><image xlink:href="https://evil.example/track.png"/><rect width="10" height="10"/></svg>`;
  const sanitized = sanitizeSvgContent(dirtySvg);
  assert.equal(sanitized.safe, false);
  assert.ok(!sanitized.sanitizedSvg.includes('<script'));
  assert.ok(!sanitized.sanitizedSvg.includes('onload='));
  assert.ok(!sanitized.sanitizedSvg.includes('https://evil.example'));

  // Test PNG & WAV binary validators
  const pngBytes = generateValidPngStillBytes({
    aspectRatio: '9:16',
    backgroundMode: 'transparent',
  });
  assert.equal(validatePngBytes(pngBytes).valid, true);

  const wavBytes = generateProceduralSfxWav({ durationSec: 0.5 });
  assert.equal(validateWavBytes(wavBytes).valid, true);

  // Test honest video capability guard (never write WebM to .mp4; never claim alpha in MP4)
  const mp4AlphaCheck = evaluateVideoExportCapability({
    requestedContainer: 'mp4',
    requiresAlpha: true,
    browserMediaRecorderSupported: true,
    supportedMimeType: 'video/mp4',
  });
  assert.equal(mp4AlphaCheck.canEncodeDirectly, false);
  assert.equal(mp4AlphaCheck.recommendedAlternative, 'chroma-key-green');

  const webmToMp4Mismatch = evaluateVideoExportCapability({
    requestedContainer: 'mp4',
    requiresAlpha: false,
    browserMediaRecorderSupported: true,
    supportedMimeType: 'video/webm;codecs=vp9',
  });
  assert.equal(webmToMp4Mismatch.canEncodeDirectly, false);
  assert.match(webmToMp4Mismatch.honestWarning, /refuses to write WebM bytes into a fake \.mp4/);

  // Test local mobile file validator
  const validLocal = validateLocalMediaFile({
    name: 'clip.mp4',
    size: 1024 * 500,
    type: 'video/mp4',
  });
  assert.equal(validLocal.valid, true);

  const invalidExt = validateLocalMediaFile({
    name: 'malware.apk',
    size: 2048,
    type: 'application/vnd.android.package-archive',
  });
  assert.equal(invalidExt.valid, false);
});

test('Phase 5.7: API integration for capability discovery, export job lifecycle, cross-user isolation & quota enforcement', async () => {
  const srv = await startTestServer();
  try {
    // 1. Discover Alight Motion capabilities & preset XML classification
    const capRes = await fetch(
      `${srv.baseUrl}/api/v1/editors/alight-motion/capabilities?itemId=${SEED_CATALOG_ITEMS[0].id}`
    );
    assert.equal(capRes.status, 200);
    const capJson = await capRes.json();
    assert.equal(capJson.ok, true);
    assert.equal(capJson.data.capability.editorId, 'alight-motion');
    assert.ok(Array.isArray(capJson.data.alightMotionFeatureMatrix));
    assert.equal(
      capJson.data.alightXmlClassification.status,
      'Alight Motion XML — tested subset'
    );

    // 2. User A generates a mobile export job
    const genRes = await fetch(`${srv.baseUrl}/api/v1/exports/generate`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token-user-a',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        itemId: SEED_CATALOG_ITEMS[0].id,
        targetEditor: 'node-video',
        format: 'zip-bundle',
        aspectRatio: '9:16',
        fps: 60,
        durationSec: 3,
        qualityPolicy: 'high-quality',
        backgroundMode: 'chroma-key-green',
      }),
    });
    assert.equal(genRes.status, 201);
    const genJson = await genRes.json();
    assert.equal(genJson.ok, true);
    assert.equal(
      genJson.data.artifact.bundleLabel,
      'Sowveil media bundle for Node Video'
    );
    assert.equal(genJson.data.artifact.sha256.length, 64);
    const jobId = genJson.data.exportJob.id;

    // 3. User A downloads their own export artifact
    const dlResA = await fetch(
      `${srv.baseUrl}/api/v1/exports/jobs/${jobId}/download`,
      {
        headers: { Authorization: 'Bearer token-user-a' },
      }
    );
    assert.equal(dlResA.status, 200);
    const dlJsonA = await dlResA.json();
    assert.equal(dlJsonA.data.sha256, genJson.data.artifact.sha256);

    // 4. User B is strictly blocked from reading, downloading, retrying, or deleting User A's export job
    const dlResB = await fetch(
      `${srv.baseUrl}/api/v1/exports/jobs/${jobId}/download`,
      {
        headers: { Authorization: 'Bearer token-user-b' },
      }
    );
    assert.equal(dlResB.status, 403);
    const dlJsonB = await dlResB.json();
    assert.equal(dlJsonB.error.code, 'CROSS_USER_ACCESS_FORBIDDEN');

    const retryResB = await fetch(
      `${srv.baseUrl}/api/v1/exports/jobs/${jobId}/retry`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token-user-b' },
      }
    );
    assert.equal(retryResB.status, 403);

    const delResB = await fetch(
      `${srv.baseUrl}/api/v1/exports/jobs/${jobId}`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token-user-b' },
      }
    );
    assert.equal(delResB.status, 403);

    // 5. User A can retry and then delete their own export job
    const retryResA = await fetch(
      `${srv.baseUrl}/api/v1/exports/jobs/${jobId}/retry`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer token-user-a' },
      }
    );
    assert.equal(retryResA.status, 200);
    const retryJsonA = await retryResA.json();
    assert.equal(retryJsonA.data.exportJob.retryPolicy.attemptCount, 2);

    const delResA = await fetch(
      `${srv.baseUrl}/api/v1/exports/jobs/${jobId}`,
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer token-user-a' },
      }
    );
    assert.equal(delResA.status, 200);
  } finally {
    await srv.close();
  }
});
