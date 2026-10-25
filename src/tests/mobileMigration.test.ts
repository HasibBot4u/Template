import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  MOBILE_EDITOR_ADAPTERS,
  getMobileEditorAdapter,
  generateSowveilProjectDocument,
  validateSowveilProjectJson,
  generateAlightMotionXml,
  validateAlightMotionXml,
  generateMotionVectorSvg,
  generateProceduralSfxWav,
  generateSrtFromCues,
  validateSrtContent,
  generateRealZipBundle,
  buildMobileEditorExportArtifact,
} from '../services/editorGateway';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import { SOWVEIL_MODULES } from '../data/modules';
import { canTransitionJob, transitionJobRecord } from '../services/jobStateMachine';
import { createApiApp } from '../server/apiApp';
import { JobRecord } from '../types/sowveil';

const sampleTextItem =
  SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'text-animation') || SEED_CATALOG_ITEMS[0];
const sampleSfxItem =
  SEED_CATALOG_ITEMS.find((i) => i.moduleId === 'sfx') || SEED_CATALOG_ITEMS[0];

test('Mobile-First Architecture: all 20 original modules are mobile-ready with zero mandatory desktop dependency', () => {
  assert.equal(SOWVEIL_MODULES.length, 20);
  for (const mod of SOWVEIL_MODULES) {
    assert.equal(mod.requiresDesktop, false);
  }
});

test('Mobile Editor Integration Gateway: registers 6 adapters with honest statuses and no fake extensions', () => {
  assert.ok(MOBILE_EDITOR_ADAPTERS.length >= 6);
  const capcut = getMobileEditorAdapter('capcut');
  const alight = getMobileEditorAdapter('alight-motion');
  const kinemaster = getMobileEditorAdapter('kinemaster');
  const sowveil = getMobileEditorAdapter('sowveil-project');

  assert.equal(capcut.compatibilityStatus, 'Media handoff only');
  assert.equal(alight.compatibilityStatus, 'Tested subset');
  assert.equal(kinemaster.compatibilityStatus, 'Media handoff only');
  assert.equal(sowveil.compatibilityStatus, 'Verified');

  const allowedFormats = [
    'sowveil-json',
    'alight-xml',
    'svg-frame',
    'png-still',
    'wav-audio',
    'srt-captions',
    'vtt-captions',
    'json-captions',
    'webm-video',
    'zip-bundle',
  ];
  for (const adapter of MOBILE_EDITOR_ADAPTERS) {
    for (const fmt of adapter.supportedFormats) {
      assert.ok(allowedFormats.includes(fmt));
    }
  }
});

test('Mobile Editor Integration Gateway: generates and validates .sowveil.json project document', () => {
  const doc = generateSowveilProjectDocument(
    sampleTextItem,
    { headline: 'MOBILE STUDIO', durationMs: 2400 },
    '9:16',
    'capcut'
  );
  assert.equal(doc.format, 'sowveil-mobile-project');
  assert.equal(doc.schemaVersion, '2.4.0-mobile');
  assert.equal(doc.composition.width, 1080);
  assert.equal(doc.composition.height, 1920);
  assert.equal(doc.parameters.headline, 'MOBILE STUDIO');

  const raw = JSON.stringify(doc, null, 2);
  const validation = validateSowveilProjectJson(raw);
  assert.equal(validation.valid, true);
});

test('Mobile Editor Integration Gateway: generates and validates Alight Motion XML (.xml) template', () => {
  const xml = generateAlightMotionXml(
    sampleTextItem,
    { headline: 'ALIGHT XML TEST', accentColor: '#F06424' },
    '9:16'
  );
  const validation = validateAlightMotionXml(xml);
  assert.equal(validation.valid, true);
  assert.ok(xml.includes('<scene '));
  assert.ok(xml.includes('width="1080" height="1920"'));
  assert.ok(xml.includes('ALIGHT XML TEST'));
});

test('Mobile Editor Integration Gateway: generates SVG vector frame and 16-bit PCM WAV audio', () => {
  const svg = generateMotionVectorSvg(
    sampleTextItem,
    { headline: 'SVG VECTOR' },
    '1:1'
  );
  assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('viewBox="0 0 1080 1080"'));

  const wav = generateProceduralSfxWav(sampleSfxItem);
  assert.ok(wav.byteLength > 44);
  assert.equal(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]), 'RIFF');
  assert.equal(String.fromCharCode(wav[8], wav[9], wav[10], wav[11]), 'WAVE');
});

test('Mobile Editor Integration Gateway: generates and validates SubRip (.srt) captions', () => {
  const srt = generateSrtFromCues([
    { index: 1, startSec: 0, endSec: 1.8, text: 'Built for Android mobile editors' },
    { index: 2, startSec: 1.8, endSec: 3.6, text: 'Export directly to CapCut and Alight Motion' },
  ]);
  const validation = validateSrtContent(srt);
  assert.equal(validation.valid, true);
  assert.ok(srt.includes('00:00:00,000 --> 00:00:01,800'));
});

test('Mobile Editor Integration Gateway: generates RFC-compliant PKZIP (.zip) bundle without fake .kine/.capcut extensions', () => {
  const zipBytes = generateRealZipBundle([
    { fileName: 'project.sowveil.json', content: '{"format":"sowveil-mobile-project"}' },
    { fileName: 'README.txt', content: 'Mobile Editor Handoff' },
  ]);
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
  assert.equal(zipBytes[2], 0x03);
  assert.equal(zipBytes[3], 0x04);

  const artifact = buildMobileEditorExportArtifact({
    item: sampleTextItem,
    targetEditor: 'kinemaster',
    aspectRatio: '9:16',
    format: 'zip-bundle',
    customValues: { headline: 'NO FAKE EXT' },
  });
  assert.equal(artifact.fileName.endsWith('.zip'), true);
  assert.equal(artifact.fileName.endsWith('.kine'), false);
  assert.equal(artifact.validationPassed, true);
});

test('Mobile Job State Machine: supports queued -> running -> ready -> downloaded transitions', () => {
  assert.equal(canTransitionJob('queued', 'ready'), true);
  assert.equal(canTransitionJob('running', 'ready'), true);
  assert.equal(canTransitionJob('ready', 'downloaded'), true);
  assert.equal(canTransitionJob('downloaded', 'running'), false);

  const baseJob: JobRecord = {
    id: 'job_mobile_1',
    type: 'mobile-export',
    title: 'Export CapCut Pack',
    moduleId: 'text-animation',
    itemId: sampleTextItem.id,
    targetEditor: 'capcut',
    exportFormat: 'zip-bundle',
    aspectRatio: '9:16',
    status: 'ready',
    deviceId: 'android-mobile-pwa',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attemptCount: 1,
    idempotencyKey: 'idem_mobile_1',
    requestId: 'req_mobile_1',
    redactedMessage: 'Artifact validated and ready for mobile handoff.',
  };

  const downloadedJob = transitionJobRecord(baseJob, 'downloaded', {
    redactedMessage: 'Downloaded to Android device.',
  });
  assert.equal(downloadedJob.status, 'downloaded');
});

test('Mobile API Endpoints: /api/v1/editors and /api/v1/exports/generate return validated artifacts', async () => {
  const app = createApiApp({
    ownerBootstrapEmail: 'mdhasibul4u@gmail.com',
    ownerBootstrapSecret: 'TEST_SECRET',
    storageEnabled: false,
    tokenVerifier: async (token: string) => {
      if (token === 'valid_mobile_user') {
        return {
          uid: 'user_mobile_1',
          email: 'creator@example.com',
          emailVerified: true,
          displayName: 'Mobile Creator',
        };
      }
      throw new Error('Invalid token');
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const editorsRes = await fetch(`${baseUrl}/api/v1/editors`);
    assert.equal(editorsRes.status, 200);
    const editorsJson = await editorsRes.json();
    assert.equal(editorsJson.ok, true);
    assert.ok(editorsJson.data.items.length >= 6);

    const exportRes = await fetch(`${baseUrl}/api/v1/exports/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid_mobile_user',
      },
      body: JSON.stringify({
        itemId: sampleTextItem.id,
        targetEditor: 'alight-motion',
        aspectRatio: '9:16',
        format: 'alight-xml',
        customValues: { headline: 'API XML EXPORT' },
      }),
    });
    assert.equal(exportRes.status, 201);
    const exportJson = await exportRes.json();
    assert.equal(exportJson.ok, true);
    assert.equal(exportJson.data.artifact.validationPassed, true);
    assert.ok(exportJson.data.artifact.fileName.endsWith('.xml'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
