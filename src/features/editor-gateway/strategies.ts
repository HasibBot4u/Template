import {
  CatalogItem,
  EditorCompatibilityStatus,
  ExportArtifactFormat,
  MobileAspectRatio,
  TargetMobileEditorId,
} from '../../types/sowveil';
import {
  AssetBundleEntryMetadata,
  AssetBundleManifest,
  BackgroundAlphaMode,
  ExportPreset,
  MotionDocument,
  QualityBitratePolicy,
} from './types';
import {
  AssetBundleManifestSchema,
  MotionDocumentSchema,
  parsePortableMotionDocument,
  sanitizeSvgContent,
  validateZipSafety,
} from './schemas';
import {
  classifyPresetForAlightMotionXml,
  serializeAlightMotionXml,
  validateAndInspectAlightMotionXml,
} from './alightMotionXml';

export interface CaptionCueSegment {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function computeCrc32Hex(bytes: Uint8Array): string {
  return computeCrc32(bytes).toString(16).padStart(8, '0');
}

/**
 * Pure TypeScript SHA-256 implementation so both browser and Node.js runtimes
 * produce identical 64-character hex digests synchronously without external dependencies.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function computeSha256Hex(bytes: Uint8Array): string {
  const bitLenHi = Math.floor((bytes.length * 8) / 0x100000000);
  const bitLenLo = (bytes.length * 8) >>> 0;
  const paddedLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi, false);
  view.setUint32(paddedLen - 4, bitLenLo, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, '0'))
    .join('');
}

export function getDimensionsForAspectRatio(aspectRatio: MobileAspectRatio): {
  width: number;
  height: number;
  label: string;
} {
  switch (aspectRatio) {
    case '9:16':
      return { width: 1080, height: 1920, label: 'Vertical Mobile (9:16 · 1080×1920)' };
    case '1:1':
      return { width: 1080, height: 1080, label: 'Square Social (1:1 · 1080×1080)' };
    case '16:9':
      return { width: 1920, height: 1080, label: 'Landscape Widescreen (16:9 · 1920×1080)' };
  }
}

export function buildSafeExportFilename(params: {
  slugOrName: string;
  targetEditor: TargetMobileEditorId;
  aspectRatio: MobileAspectRatio;
  extensionWithDot: string;
}): string {
  const cleanSlug = params.slugOrName
    .toLowerCase()
    .replace(/[^a-z0-9\-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'sowveil-preset';
  const ratioTag = params.aspectRatio.replace(':', 'x');
  const ext = params.extensionWithDot.startsWith('.')
    ? params.extensionWithDot
    : `.${params.extensionWithDot}`;
  return `sowveil-${cleanSlug}-${params.targetEditor}-${ratioTag}${ext}`;
}

export function buildExportPreset(params: {
  item: CatalogItem;
  aspectRatio?: MobileAspectRatio;
  fps?: 24 | 30 | 60;
  durationSec?: number;
  qualityPolicy?: QualityBitratePolicy;
  backgroundMode?: BackgroundAlphaMode;
  outputFormat: ExportArtifactFormat;
}): ExportPreset {
  const aspectRatio = params.aspectRatio ?? '9:16';
  const dims = getDimensionsForAspectRatio(aspectRatio);
  const rawFps = params.fps ?? (params.item.metadata.fps as 24 | 30 | 60 | undefined) ?? 60;
  const fps: 24 | 30 | 60 = rawFps === 24 || rawFps === 30 || rawFps === 60 ? rawFps : 60;
  const durationSec = Math.max(0.5, Math.min(300, params.durationSec ?? params.item.metadata.durationSec ?? 3));
  const qualityPolicy = params.qualityPolicy ?? 'balanced';
  const backgroundMode = params.backgroundMode ?? 'solid';
  const backgroundColorHex =
    backgroundMode === 'chroma-key-green' ? '#00FF00' : '#080707';

  const alphaSupportedInFormat =
    params.outputFormat === 'svg-frame' ||
    params.outputFormat === 'png-still' ||
    params.outputFormat === 'alight-xml' ||
    params.outputFormat === 'sowveil-json' ||
    params.outputFormat === 'zip-bundle';

  return {
    aspectRatio,
    width: dims.width,
    height: dims.height,
    fps,
    durationSec,
    qualityPolicy,
    backgroundMode,
    backgroundColorHex,
    outputFormat: params.outputFormat,
    estimatedSizeBytes:
      params.outputFormat === 'wav-audio'
        ? Math.round(durationSec * 22050 * 2 + 44)
        : params.outputFormat === 'zip-bundle'
        ? 64 * 1024
        : 8 * 1024,
    performanceHints: {
      lowPowerDeviceFriendly: fps <= 30 || params.outputFormat !== 'webm-video',
      staticPreviewFallbackAvailable: true,
      alphaSupportedInFormat,
      chromaKeyRecommendedForAlpha: !alphaSupportedInFormat && backgroundMode === 'transparent',
      recommendationNote:
        !alphaSupportedInFormat && backgroundMode === 'transparent'
          ? 'Standard mobile video streams do not guarantee alpha transparency; use Chroma-Key Green (#00FF00) or export a transparent SVG/PNG plate.'
          : 'Optimized for Android mobile memory and thermal budgets.',
    },
  };
}

/**
 * 1. Portable Sowveil MotionDocument (.sowveil.json)
 */
export function buildPortableMotionDocument(params: {
  item: CatalogItem;
  targetEditor: TargetMobileEditorId;
  aspectRatio: MobileAspectRatio;
  fps?: number;
  durationSec?: number;
  backgroundMode?: BackgroundAlphaMode;
  customValues?: Record<string, string | number | boolean>;
}): MotionDocument {
  const { item, targetEditor, aspectRatio, customValues = {} } = params;
  const dims = getDimensionsForAspectRatio(aspectRatio);
  const fps = params.fps ?? item.metadata.fps ?? 60;
  const durationSec = params.durationSec ?? item.metadata.durationSec ?? 3;
  const backgroundMode = params.backgroundMode ?? 'solid';
  const backgroundColorHex =
    backgroundMode === 'chroma-key-green' ? '#00FF00' : '#080707';
  const curve = item.metadata.curvePoints || [0.22, 1, 0.36, 1];

  const resolvedParams: Record<string, string | number | boolean> = {};
  for (const p of item.editableParams || []) {
    resolvedParams[p.key] =
      customValues[p.key] !== undefined ? customValues[p.key] : p.defaultValue;
  }
  for (const [k, v] of Object.entries(customValues)) {
    resolvedParams[k] = v;
  }

  const primaryText = String(
    resolvedParams.headline ??
      resolvedParams.title ??
      resolvedParams.badgeText ??
      item.name
  );
  const accentColor = String(
    resolvedParams.accentColor ?? resolvedParams.primaryColor ?? '#F06424'
  );

  const classification = classifyPresetForAlightMotionXml(item);

  const doc: MotionDocument = {
    schemaVersion: '2.0.0',
    generator: 'Sowveil Studio Mobile Motion Engine',
    documentId: `doc_${item.id}_${aspectRatio.replace(':', 'x')}`,
    createdAt: new Date().toISOString(),
    targetEditor,
    composition: {
      id: item.id,
      title: item.name,
      moduleId: item.moduleId,
      aspectRatio,
      width: dims.width,
      height: dims.height,
      fps,
      durationSec,
      backgroundMode,
      backgroundColorHex,
    },
    parameters: resolvedParams,
    easing: {
      cubicBezier: curve,
    },
    layers: [
      {
        id: `${item.id}-bg-guide`,
        name: `${item.name} Safe-Zone Frame`,
        type: 'shape',
        inPointSec: 0,
        outPointSec: durationSec,
        transform: {
          position: [dims.width / 2, dims.height / 2],
          scale: [100, 100],
          rotationDeg: 0,
          anchor: [dims.width / 2, dims.height / 2],
        },
        opacity: 1,
        colorHex: accentColor.startsWith('#') ? accentColor : `#${accentColor}`,
        easingCurve: curve,
        effects: [
          {
            id: `${item.id}-fx-1`,
            type: item.previewKind,
            supportedInAlightXml: classification.canExportXml,
            parameters: resolvedParams,
          },
        ],
      },
      {
        id: `${item.id}-primary-layer`,
        name: `${item.name} Primary Motion Layer`,
        type: item.moduleId === 'sfx' ? 'audio' : item.moduleId === 'auto-captions' ? 'caption' : 'text',
        inPointSec: 0,
        outPointSec: durationSec,
        transform: {
          position: [dims.width / 2, dims.height / 2],
          scale: [100, 100],
          rotationDeg: 0,
          anchor: [dims.width / 2, dims.height / 2],
        },
        opacity: 1,
        colorHex: '#F3EEE8',
        textContent: primaryText,
        easingCurve: curve,
        effects: [],
        ...(item.moduleId === 'sfx' ? { audioRefId: `${item.id}-audio-1` } : {}),
      },
    ],
    assets: [
      {
        id: `${item.id}-svg-asset`,
        role: 'primary-vector',
        fileName: `${item.slug}-${aspectRatio.replace(':', 'x')}.svg`,
        mimeType: 'image/svg+xml',
        origin: 'sowveil-procedural',
        license: item.licenseType,
      },
      {
        id: `${item.id}-png-asset`,
        role: 'still-graphic',
        fileName: `${item.slug}-${aspectRatio.replace(':', 'x')}.png`,
        mimeType: 'image/png',
        origin: 'sowveil-procedural',
        license: item.licenseType,
      },
    ],
    audioReferences:
      item.moduleId === 'sfx'
        ? [
            {
              id: `${item.id}-audio-1`,
              fileName: `${item.slug}.wav`,
              durationSec: Math.min(durationSec, 4),
              sampleRateHz: 22050,
              channels: 1,
            },
          ]
        : [],
  };

  return doc;
}

/**
 * 2. Sanitized SVG Vector Plate (.svg)
 */
export function generateSanitizedVectorSvg(params: {
  item: CatalogItem;
  aspectRatio: MobileAspectRatio;
  backgroundMode?: BackgroundAlphaMode;
  customValues?: Record<string, string | number | boolean>;
}): string {
  const { item, aspectRatio, customValues = {} } = params;
  const dims = getDimensionsForAspectRatio(aspectRatio);
  const titleText = String(
    customValues.headline ?? customValues.title ?? customValues.badgeText ?? item.name
  )
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const rawAccent = String(
    customValues.accentColor ?? customValues.primaryColor ?? '#F06424'
  );
  const accent = /^#[0-9A-Fa-f]{3,8}$/.test(rawAccent) ? rawAccent : '#F06424';
  const curve = item.metadata.curvePoints || [0.22, 1, 0.36, 1];

  const bgElement =
    params.backgroundMode === 'transparent'
      ? `<!-- Transparent alpha background enabled -->`
      : params.backgroundMode === 'chroma-key-green'
      ? `<rect width="${dims.width}" height="${dims.height}" fill="#00FF00"/>`
      : `<rect width="${dims.width}" height="${dims.height}" fill="url(#sowveil-bg)"/>`;

  const rawSvg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.width} ${dims.height}" width="${dims.width}" height="${dims.height}">`,
    `  <defs>`,
    `    <linearGradient id="sowveil-bg" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `      <stop offset="0%" stop-color="#080707"/>`,
    `      <stop offset="55%" stop-color="#14110F"/>`,
    `      <stop offset="100%" stop-color="${accent}" stop-opacity="0.32"/>`,
    `    </linearGradient>`,
    `  </defs>`,
    `  ${bgElement}`,
    `  <rect x="${Math.round(dims.width * 0.08)}" y="${Math.round(dims.height * 0.12)}" width="${Math.round(dims.width * 0.84)}" height="${Math.round(dims.height * 0.76)}" rx="36" fill="#11100F" fill-opacity="0.78" stroke="${accent}" stroke-width="3"/>`,
    `  <text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" fill="#F3EEE8" font-family="Plus Jakarta Sans, sans-serif" font-weight="800" font-size="${Math.round(dims.width * 0.052)}">${titleText}</text>`,
    `  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#B8AAA0" font-family="JetBrains Mono, monospace" font-size="${Math.round(dims.width * 0.024)}">SOWVEIL · ${item.moduleId.toUpperCase()} · ${aspectRatio} · cubic-bezier(${curve.join(', ')})</text>`,
    `</svg>`,
  ].join('\n');

  return sanitizeSvgContent(rawSvg).sanitizedSvg;
}

/**
 * Encodes arbitrary binary raw scanline data into an RFC 1950/1951 compliant zlib stored stream
 * supporting any dimension (from 64x64 up to 1080x1920) across multi-block DEFLATE chunks.
 */
export function encodeZlibStoredStream(data: Uint8Array): Uint8Array {
  const BLOCK_SIZE = 32768;
  const numBlocks = Math.ceil(data.length / BLOCK_SIZE) || 1;
  const totalLength = 2 + numBlocks * 5 + data.length + 4;
  const zlibData = new Uint8Array(totalLength);

  zlibData[0] = 0x78; // CMF
  zlibData[1] = 0x01; // FLG
  let outPtr = 2;
  let inPtr = 0;

  for (let b = 0; b < numBlocks; b++) {
    const isLast = b === numBlocks - 1;
    const remaining = data.length - inPtr;
    const blockSize = Math.min(BLOCK_SIZE, remaining);
    const nlen = ~blockSize & 0xffff;

    zlibData[outPtr++] = isLast ? 0x01 : 0x00; // BFINAL, BTYPE=00 (stored)
    zlibData[outPtr++] = blockSize & 0xff;
    zlibData[outPtr++] = (blockSize >>> 8) & 0xff;
    zlibData[outPtr++] = nlen & 0xff;
    zlibData[outPtr++] = (nlen >>> 8) & 0xff;

    zlibData.set(data.subarray(inPtr, inPtr + blockSize), outPtr);
    outPtr += blockSize;
    inPtr += blockSize;
  }

  // Adler-32 checksum
  let s1 = 1;
  let s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  const adler32 = ((s2 << 16) | s1) >>> 0;
  const dv = new DataView(zlibData.buffer, outPtr, 4);
  dv.setUint32(0, adler32, false);

  return zlibData;
}

function makePngChunk(typeAscii: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = typeAscii.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crc = computeCrc32(chunk.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc, false);
  return chunk;
}

/**
 * Generates a compact, 100% standards-compliant 64x64 RGBA PNG preview thumbnail.
 */
export function generatePngPreviewThumbnail(params: {
  backgroundMode?: BackgroundAlphaMode;
  accentHex?: string;
}): Uint8Array {
  return renderPngStillPlate({
    aspectRatio: '1:1',
    width: 64,
    height: 64,
    backgroundMode: params.backgroundMode,
    accentHex: params.accentHex,
  });
}

/**
 * 3. Valid Full-Size PNG Still Graphic (.png) with IHDR, IDAT, and IEND chunks.
 * Accurately honors the selected composition aspect ratio (9:16, 1:1, 16:9).
 */
export function renderPngStillPlate(params: {
  aspectRatio: MobileAspectRatio;
  backgroundMode?: BackgroundAlphaMode;
  accentHex?: string;
  width?: number;
  height?: number;
  customValues?: Record<string, string | number | boolean>;
}): Uint8Array {
  const dims = getDimensionsForAspectRatio(params.aspectRatio);
  const width = params.width ?? dims.width;
  const height = params.height ?? dims.height;
  const mode = params.backgroundMode ?? 'solid';
  const hex = (params.accentHex || '#F06424').replace('#', '');
  const ar = parseInt(hex.slice(0, 2) || 'f0', 16) || 240;
  const ag = parseInt(hex.slice(2, 4) || '64', 16) || 100;
  const ab = parseInt(hex.slice(4, 6) || '24', 16) || 36;

  // Each scanline has 1 filter byte (0) + width * 4 RGBA bytes
  const rawScanlines = new Uint8Array(height * (1 + width * 4));
  let ptr = 0;

  const borderWidth = Math.max(2, Math.round(width * 0.02));
  const borderYMin = Math.round(height * 0.08);
  const borderYMax = Math.round(height * 0.92);
  const borderXMin = Math.round(width * 0.08);
  const borderXMax = Math.round(width * 0.92);

  for (let y = 0; y < height; y++) {
    rawScanlines[ptr++] = 0; // Filter type 0 (None)
    const isYBorder = (y >= borderYMin && y <= borderYMin + borderWidth) || (y >= borderYMax - borderWidth && y <= borderYMax);

    for (let x = 0; x < width; x++) {
      const isXBorder = (x >= borderXMin && x <= borderXMin + borderWidth) || (x >= borderXMax - borderWidth && x <= borderXMax);
      const isBorder = (isYBorder && x >= borderXMin && x <= borderXMax) || (isXBorder && y >= borderYMin && y <= borderYMax);

      if (isBorder) {
        rawScanlines[ptr++] = ar;
        rawScanlines[ptr++] = ag;
        rawScanlines[ptr++] = ab;
        rawScanlines[ptr++] = 255;
      } else if (mode === 'transparent') {
        rawScanlines[ptr++] = 0;
        rawScanlines[ptr++] = 0;
        rawScanlines[ptr++] = 0;
        rawScanlines[ptr++] = 0;
      } else if (mode === 'chroma-key-green') {
        rawScanlines[ptr++] = 0;
        rawScanlines[ptr++] = 255;
        rawScanlines[ptr++] = 0;
        rawScanlines[ptr++] = 255;
      } else {
        rawScanlines[ptr++] = 17;
        rawScanlines[ptr++] = 16;
        rawScanlines[ptr++] = 15;
        rawScanlines[ptr++] = 255;
      }
    }
  }

  const zlibData = encodeZlibStoredStream(rawScanlines);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // Bit depth 8
  ihdrData[9] = 6; // Color type 6 (RGBA)
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = makePngChunk('IHDR', ihdrData);
  const idatChunk = makePngChunk('IDAT', zlibData);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let offset = 0;
  out.set(signature, offset);
  offset += signature.length;
  out.set(ihdrChunk, offset);
  offset += ihdrChunk.length;
  out.set(idatChunk, offset);
  offset += idatChunk.length;
  out.set(iendChunk, offset);

  return out;
}

export function generateValidPngStillBytes(params: {
  aspectRatio: MobileAspectRatio;
  backgroundMode?: BackgroundAlphaMode;
  accentHex?: string;
  width?: number;
  height?: number;
}): Uint8Array {
  return renderPngStillPlate(params);
}

export function validatePngBytes(bytes: Uint8Array): {
  valid: boolean;
  width?: number;
  height?: number;
  reason: string;
} {
  if (bytes.byteLength < 33) {
    return { valid: false, reason: 'PNG buffer is smaller than minimum header length.' };
  }
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== sig[i]) {
      return { valid: false, reason: 'Invalid PNG magic bytes signature.' };
    }
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getUint32(16, false);
  const height = dv.getUint32(20, false);
  return {
    valid: width > 0 && height > 0,
    width,
    height,
    reason: `Verified RGBA PNG image (${width}×${height}, ${bytes.byteLength} bytes).`,
  };
}

/**
 * 4. 16-Bit PCM WAV Audio Generator & Validator (.wav)
 */
export function generateProceduralSfxWav(
  params?:
    | CatalogItem
    | {
        durationSec?: number;
        baseFreqHz?: number;
        endFreqHz?: number;
      }
): Uint8Array {
  const isCatalogItem =
    params && typeof params === 'object' && 'moduleId' in params && 'metadata' in params;
  const rawDuration = isCatalogItem
    ? (params as CatalogItem).metadata.durationSec
    : (params as { durationSec?: number } | undefined)?.durationSec;
  const baseFreqHz = isCatalogItem
    ? 180
    : (params as { baseFreqHz?: number } | undefined)?.baseFreqHz;
  const endFreqHz = isCatalogItem
    ? 620
    : (params as { endFreqHz?: number } | undefined)?.endFreqHz;

  const sampleRate = 22050;
  const durationSec = Math.max(0.25, Math.min(4.0, rawDuration ?? 0.65));
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  const f0 = baseFreqHz ?? 180;
  const f1 = endFreqHz ?? 620;
  let phase = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    const env = Math.sin(Math.PI * t) * Math.pow(1 - t * 0.5, 1.4);
    const freq = f0 + (f1 - f0) * Math.pow(t, 1.5);
    phase += (2 * Math.PI * freq) / sampleRate;
    const sample = Math.max(-1, Math.min(1, Math.sin(phase) * env * 0.8));
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }

  return new Uint8Array(buffer);
}

export function validateWavBytes(bytes: Uint8Array): { valid: boolean; reason: string } {
  if (bytes.byteLength < 44) {
    return { valid: false, reason: 'WAV file is smaller than 44-byte RIFF header.' };
  }
  const dec = new TextDecoder();
  const riff = dec.decode(bytes.subarray(0, 4));
  const wave = dec.decode(bytes.subarray(8, 12));
  const dataTag = dec.decode(bytes.subarray(36, 40));
  if (riff !== 'RIFF' || wave !== 'WAVE' || dataTag !== 'data') {
    return { valid: false, reason: 'Missing RIFF/WAVE/data header markers.' };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredChunkSize = view.getUint32(4, true);
  if (declaredChunkSize + 8 !== bytes.byteLength) {
    return { valid: false, reason: 'WAV RIFF chunk size does not match file length.' };
  }
  return {
    valid: true,
    reason: `Verified 16-bit PCM WAV (${bytes.byteLength} bytes, 22.05 kHz mono).`,
  };
}

/**
 * 5. Subtitles & Captions (.srt, .vtt, .json)
 */
function formatSrtTimestamp(sec: number): string {
  const clamped = Math.max(0, sec);
  const totalMs = Math.round(clamped * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function formatVttTimestamp(sec: number): string {
  return formatSrtTimestamp(sec).replace(',', '.');
}

export function generateSrtFromCues(cues: CaptionCueSegment[]): string {
  return cues
    .map(
      (cue, idx) =>
        `${idx + 1}\n${formatSrtTimestamp(cue.startSec)} --> ${formatSrtTimestamp(
          cue.endSec
        )}\n${cue.text.trim()}\n`
    )
    .join('\n');
}

export function generateVttFromCues(cues: CaptionCueSegment[]): string {
  const body = cues
    .map(
      (cue, idx) =>
        `${idx + 1}\n${formatVttTimestamp(cue.startSec)} --> ${formatVttTimestamp(
          cue.endSec
        )}\n${cue.text.trim()}`
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function generateJsonCaptionsFromCues(
  cues: CaptionCueSegment[],
  aspectRatio: MobileAspectRatio = '9:16'
): string {
  return JSON.stringify(
    {
      schemaVersion: '2.0.0',
      format: 'sowveil-caption-track',
      aspectRatio,
      cueCount: cues.length,
      cues: cues.map((c, idx) => ({
        index: idx + 1,
        startSec: Number(c.startSec.toFixed(3)),
        endSec: Number(c.endSec.toFixed(3)),
        text: c.text.trim(),
      })),
    },
    null,
    2
  );
}

export function parseSrtOrVttToCues(rawContent: string): {
  valid: boolean;
  cues: CaptionCueSegment[];
  reason: string;
} {
  const normalized = rawContent.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { valid: false, cues: [], reason: 'Caption content is empty.' };
  }

  const withoutHeader = normalized.replace(/^WEBVTT[^\n]*\n+/i, '').trim();
  const blocks = withoutHeader.split(/\n{2,}/);
  const cues: CaptionCueSegment[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    const timingLineIdx = lines[0].includes('-->') ? 0 : 1;
    const timingLine = lines[timingLineIdx];
    if (!timingLine) continue;

    const match = timingLine.match(
      /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!match) {
      return {
        valid: false,
        cues: [],
        reason: `Invalid timestamp format in block ${i + 1}: "${timingLine}".`,
      };
    }

    const startSec =
      Number(match[1]) * 3600 +
      Number(match[2]) * 60 +
      Number(match[3]) +
      Number(match[4]) / 1000;
    const endSec =
      Number(match[5]) * 3600 +
      Number(match[6]) * 60 +
      Number(match[7]) +
      Number(match[8]) / 1000;

    if (endSec <= startSec) {
      return {
        valid: false,
        cues: [],
        reason: `Cue ${i + 1} end time (${endSec}s) must be greater than start time (${startSec}s).`,
      };
    }

    const text = lines.slice(timingLineIdx + 1).join(' ').trim();
    if (!text) {
      return {
        valid: false,
        cues: [],
        reason: `Cue ${i + 1} has empty caption text.`,
      };
    }

    cues.push({
      index: cues.length + 1,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      text,
    });
  }

  if (cues.length === 0) {
    return { valid: false, cues: [], reason: 'No valid timed caption cues found.' };
  }

  return {
    valid: true,
    cues,
    reason: `Verified ${cues.length} timed caption cue(s).`,
  };
}

export function validateSrtContent(srt: string): {
  valid: boolean;
  cueCount: number;
  reason: string;
} {
  const parsed = parseSrtOrVttToCues(srt);
  return {
    valid: parsed.valid,
    cueCount: parsed.cues.length,
    reason: parsed.valid
      ? `Verified SubRip (.srt) subtitle file (${parsed.cues.length} timed cues).`
      : parsed.reason,
  };
}

export function validateVttContent(vtt: string): {
  valid: boolean;
  cueCount: number;
  reason: string;
} {
  if (!vtt.trim().startsWith('WEBVTT')) {
    return { valid: false, cueCount: 0, reason: 'Missing WEBVTT header on first line.' };
  }
  const parsed = parseSrtOrVttToCues(vtt);
  return {
    valid: parsed.valid,
    cueCount: parsed.cues.length,
    reason: parsed.valid
      ? `Verified WebVTT (.vtt) subtitle file (${parsed.cues.length} timed cues).`
      : parsed.reason,
  };
}

/**
 * 6. Standard PKZIP Archive Builder (.zip)
 */
export interface ZipEntryInput {
  name?: string;
  fileName?: string;
  data?: Uint8Array;
  content?: string | Uint8Array;
}

export function generateRealZipBundle(entries: ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const prepared = entries.map((e) => {
    const rawName = e.name || e.fileName || 'entry.bin';
    const safeName = rawName.replace(/^[/\\]+/, '').replace(/\.\.(\/|\\)/g, '');
    const nameBytes = encoder.encode(safeName);
    const dataBytes =
      e.data instanceof Uint8Array
        ? e.data
        : e.content instanceof Uint8Array
        ? e.content
        : encoder.encode(typeof e.content === 'string' ? e.content : '');
    const crc = computeCrc32(dataBytes);
    return {
      name: safeName,
      nameBytes,
      data: dataBytes,
      crc,
      localHeaderOffset: 0,
    };
  });

  let localTotalSize = 0;
  for (const item of prepared) {
    item.localHeaderOffset = localTotalSize;
    localTotalSize += 30 + item.nameBytes.length + item.data.length;
  }

  let centralDirSize = 0;
  for (const item of prepared) {
    centralDirSize += 46 + item.nameBytes.length;
  }

  const totalSize = localTotalSize + centralDirSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let offset = 0;
  for (const item of prepared) {
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint32(offset + 14, item.crc, true);
    view.setUint32(offset + 18, item.data.length, true);
    view.setUint32(offset + 22, item.data.length, true);
    view.setUint16(offset + 26, item.nameBytes.length, true);
    view.setUint16(offset + 28, 0, true);
    out.set(item.nameBytes, offset + 30);
    out.set(item.data, offset + 30 + item.nameBytes.length);
    offset += 30 + item.nameBytes.length + item.data.length;
  }

  const centralDirStart = offset;
  for (const item of prepared) {
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0, true);
    view.setUint32(offset + 16, item.crc, true);
    view.setUint32(offset + 20, item.data.length, true);
    view.setUint32(offset + 24, item.data.length, true);
    view.setUint16(offset + 28, item.nameBytes.length, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, item.localHeaderOffset, true);
    out.set(item.nameBytes, offset + 46);
    offset += 46 + item.nameBytes.length;
  }

  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, centralDirSize, true);
  view.setUint32(offset + 16, centralDirStart, true);
  view.setUint16(offset + 20, 0, true);

  return out;
}

/**
 * 7. Honest Video Export Strategy Guard
 * Never writes WebM bytes into an .mp4 filename and never promises alpha in MP4.
 */
export function evaluateVideoExportCapability(params: {
  requestedContainer: 'mp4' | 'webm';
  requiresAlpha: boolean;
  browserMediaRecorderSupported?: boolean;
  supportedMimeType?: string | null;
}): {
  canEncodeDirectly: boolean;
  resolvedExtension: '.webm' | '.mp4' | null;
  resolvedMimeType: string | null;
  honestWarning: string;
  recommendedAlternative: 'chroma-key-green' | 'svg-frame' | 'zip-bundle';
} {
  if (params.requestedContainer === 'mp4' && params.requiresAlpha) {
    return {
      canEncodeDirectly: false,
      resolvedExtension: null,
      resolvedMimeType: null,
      honestWarning:
        'H.264 MP4 does not support an alpha transparency channel on mobile editors. Choose Chroma-Key Green (#00FF00) background or export a transparent SVG/PNG visual plate.',
      recommendedAlternative: 'chroma-key-green',
    };
  }

  if (!params.browserMediaRecorderSupported || !params.supportedMimeType) {
    return {
      canEncodeDirectly: false,
      resolvedExtension: null,
      resolvedMimeType: null,
      honestWarning:
        'Real-time video stream encoder is not active in this runtime; exporting verified Universal Media Bundle (.zip) with vector/PNG plates instead of a fabricated video container.',
      recommendedAlternative: 'zip-bundle',
    };
  }

  const mimeLower = params.supportedMimeType.toLowerCase();
  if (params.requestedContainer === 'mp4' && mimeLower.includes('webm')) {
    return {
      canEncodeDirectly: false,
      resolvedExtension: '.webm',
      resolvedMimeType: 'video/webm',
      honestWarning:
        'Browser MediaRecorder only supports WebM in this environment. Sowveil refuses to write WebM bytes into a fake .mp4 filename.',
      recommendedAlternative: 'zip-bundle',
    };
  }

  return {
    canEncodeDirectly: true,
    resolvedExtension: mimeLower.includes('mp4') ? '.mp4' : '.webm',
    resolvedMimeType: mimeLower.includes('mp4') ? 'video/mp4' : 'video/webm',
    honestWarning: 'Verified browser MediaRecorder stream.',
    recommendedAlternative: 'zip-bundle',
  };
}

export function buildVerifiedAssetBundleManifest(params: {
  item: CatalogItem;
  targetEditor: TargetMobileEditorId;
  compatibilityLevel: EditorCompatibilityStatus;
  preset: ExportPreset;
  documentId: string;
  files: Array<{
    fileName: string;
    mimeType: string;
    role: AssetBundleEntryMetadata['role'];
    bytes: Uint8Array;
    license?: string;
    origin?: 'sowveil-procedural' | 'user-local-device';
  }>;
  warnings: string[];
  importSteps: string[];
}): AssetBundleManifest {
  const bundleLabel =
    params.targetEditor === 'node-video'
      ? 'Sowveil media bundle for Node Video'
      : params.targetEditor === 'capcut'
      ? 'Sowveil media bundle for CapCut'
      : params.targetEditor === 'kinemaster'
      ? 'Sowveil media & SRT bundle for KineMaster'
      : params.targetEditor === 'alight-motion'
      ? 'Sowveil Alight Motion XML & media bundle'
      : 'Sowveil Universal Mobile Media Bundle';

  const manifest: AssetBundleManifest = {
    bundleVersion: '2.0.0',
    bundleLabel,
    createdAt: new Date().toISOString(),
    creationAppVersion: '0.5.0-mobile-gateway',
    sourceDocument: {
      documentId: params.documentId,
      itemId: params.item.id,
      itemName: params.item.name,
      moduleId: params.item.moduleId,
      schemaVersion: '2.0.0',
    },
    targetEditor: params.targetEditor,
    supportedDestinations: [
      'capcut',
      'alight-motion',
      'node-video',
      'kinemaster',
      'sowveil-project',
      'universal-bundle',
    ],
    compatibilityLevel: params.compatibilityLevel,
    preset: {
      aspectRatio: params.preset.aspectRatio,
      width: params.preset.width,
      height: params.preset.height,
      fps: params.preset.fps,
      durationSec: params.preset.durationSec,
      backgroundMode: params.preset.backgroundMode,
    },
    assets: params.files.map((f) => ({
      fileName: f.fileName,
      mimeType: f.mimeType,
      role: f.role,
      sizeBytes: f.bytes.byteLength,
      sha256: computeSha256Hex(f.bytes),
      crc32Hex: computeCrc32Hex(f.bytes),
      license: f.license ?? params.item.licenseType,
      origin: f.origin ?? 'sowveil-procedural',
    })),
    generatedOutputs: params.files.map((f) => f.fileName),
    warnings: params.warnings,
    importGuideReference: 'IMPORT_STEPS.txt',
    importSteps: params.importSteps,
  };

  AssetBundleManifestSchema.parse(manifest);
  return manifest;
}

export {
  MotionDocumentSchema,
  AssetBundleManifestSchema,
  parsePortableMotionDocument,
  sanitizeSvgContent,
  validateZipSafety,
  serializeAlightMotionXml,
  validateAndInspectAlightMotionXml,
  classifyPresetForAlightMotionXml,
};
