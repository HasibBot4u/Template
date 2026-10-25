import { z } from 'zod';
import {
  EditorCompatibilityStatusEnum,
  ExportArtifactFormatEnum,
  ModuleIdEnum,
  TargetMobileEditorIdEnum,
} from '../../schemas/sowveilSchemas';

export const BackgroundAlphaModeSchema = z.enum([
  'solid',
  'transparent',
  'chroma-key-green',
]);

export const QualityBitratePolicySchema = z.enum([
  'high-quality',
  'balanced',
  'compact-mobile',
]);

export const MobileAspectRatioSchema = z.enum(['9:16', '1:1', '16:9']);

export const EditorCapabilitySchema = z
  .object({
    editorId: TargetMobileEditorIdEnum,
    supportedFileTypes: z.array(ExportArtifactFormatEnum).min(1),
    verifiedFileTypes: z.array(ExportArtifactFormatEnum).min(1),
    nativeProjectWriting: z.object({
      supported: z.boolean(),
      status: EditorCompatibilityStatusEnum,
      formatExtension: z.string().nullable(),
      explanation: z.string().min(5),
    }),
    assetHandoffSupported: z.boolean(),
    shareOpenMethods: z
      .array(
        z.enum([
          'web-share-files',
          'direct-download',
          'clipboard-steps',
          'in-app-preview',
        ])
      )
      .min(1),
    documentedVersionRequirements: z.string().min(2),
    regionalOrPlatformNotes: z.string().min(2),
    limitations: z.array(z.string().min(3)).min(1),
    whyNotDirectTimelineInsertion: z.string().min(10),
    evidence: z.object({
      lastValidationDate: z.string().min(4),
      testedTargetVersions: z.string().min(2),
      verificationSummary: z.string().min(5),
    }),
  })
  .strict();

export const ExportPresetSchema = z
  .object({
    aspectRatio: MobileAspectRatioSchema,
    width: z.number().int().min(240).max(3840),
    height: z.number().int().min(240).max(3840),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
    durationSec: z.number().min(0.5).max(300),
    qualityPolicy: QualityBitratePolicySchema,
    backgroundMode: BackgroundAlphaModeSchema,
    backgroundColorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    outputFormat: ExportArtifactFormatEnum,
    estimatedSizeBytes: z.number().int().min(0).nullable(),
    performanceHints: z.object({
      lowPowerDeviceFriendly: z.boolean(),
      staticPreviewFallbackAvailable: z.boolean(),
      alphaSupportedInFormat: z.boolean(),
      chromaKeyRecommendedForAlpha: z.boolean(),
      recommendationNote: z.string(),
    }),
  })
  .strict();

export const MotionDocumentLayerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum([
      'text',
      'shape',
      'vector',
      'audio',
      'caption',
      'camera-25d',
      'effect-plate',
    ]),
    inPointSec: z.number().min(0),
    outPointSec: z.number().min(0),
    transform: z.object({
      position: z.tuple([z.number(), z.number()]),
      scale: z.tuple([z.number(), z.number()]),
      rotationDeg: z.number(),
      anchor: z.tuple([z.number(), z.number()]),
    }),
    opacity: z.number().min(0).max(1),
    colorHex: z.string(),
    textContent: z.string().optional(),
    easingCurve: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    effects: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        supportedInAlightXml: z.boolean(),
        parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      })
    ),
    audioRefId: z.string().optional(),
  })
  .passthrough();

export const MotionDocumentSchema = z
  .object({
    schemaVersion: z.literal('2.0.0'),
    generator: z.literal('Sowveil Studio Mobile Motion Engine'),
    documentId: z.string().min(1),
    createdAt: z.string().min(1),
    targetEditor: TargetMobileEditorIdEnum,
    composition: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      moduleId: ModuleIdEnum,
      aspectRatio: MobileAspectRatioSchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().int().positive(),
      durationSec: z.number().positive(),
      backgroundMode: BackgroundAlphaModeSchema,
      backgroundColorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    }),
    parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    easing: z.object({
      cubicBezier: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    }),
    layers: z.array(MotionDocumentLayerSchema).min(1),
    assets: z.array(
      z.object({
        id: z.string(),
        role: z.enum([
          'primary-vector',
          'still-graphic',
          'audio-sfx',
          'caption-sidecar',
          'curve-sheet',
        ]),
        fileName: z.string(),
        mimeType: z.string(),
        origin: z.enum(['sowveil-procedural', 'user-local-device']),
        license: z.string(),
      })
    ),
    audioReferences: z.array(
      z.object({
        id: z.string(),
        fileName: z.string(),
        durationSec: z.number().nonnegative(),
        sampleRateHz: z.number().int().positive(),
        channels: z.number().int().positive(),
      })
    ),
    unknownFields: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const AssetBundleEntryMetadataSchema = z
  .object({
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    role: z.enum([
      'motion-document',
      'editor-native-xml',
      'vector-graphic',
      'still-png',
      'audio-wav',
      'caption-srt',
      'caption-vtt',
      'caption-json',
      'curve-sheet',
      'import-guide',
    ]),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/i),
    crc32Hex: z.string().regex(/^[0-9a-f]{8}$/i),
    license: z.string().min(1),
    origin: z.enum(['sowveil-procedural', 'user-local-device']),
  })
  .strict();

export const AssetBundleManifestSchema = z
  .object({
    bundleVersion: z.literal('2.0.0'),
    bundleLabel: z.string().min(3),
    createdAt: z.string().min(4),
    creationAppVersion: z.string().min(1),
    sourceDocument: z.object({
      documentId: z.string().min(1),
      itemId: z.string().min(1),
      itemName: z.string().min(1),
      moduleId: ModuleIdEnum,
      schemaVersion: z.string().min(1),
    }),
    targetEditor: TargetMobileEditorIdEnum,
    supportedDestinations: z.array(TargetMobileEditorIdEnum).min(1),
    compatibilityLevel: EditorCompatibilityStatusEnum,
    preset: z.object({
      aspectRatio: MobileAspectRatioSchema,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().int().positive(),
      durationSec: z.number().positive(),
      backgroundMode: BackgroundAlphaModeSchema,
    }),
    assets: z.array(AssetBundleEntryMetadataSchema).min(1),
    generatedOutputs: z.array(z.string().min(1)).min(1),
    warnings: z.array(z.string()),
    importGuideReference: z.string().min(1),
    importSteps: z.array(z.string().min(3)).min(1),
  })
  .strict();

export const ExportJobSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    documentId: z.string().min(1),
    documentVersion: z.string().min(1),
    itemId: z.string().min(1),
    itemName: z.string().min(1),
    moduleId: ModuleIdEnum,
    destinationEditor: TargetMobileEditorIdEnum,
    requestedPreset: ExportPresetSchema,
    capabilityStatus: EditorCompatibilityStatusEnum,
    queueState: z.enum([
      'queued',
      'claimed',
      'running',
      'ready',
      'downloaded',
      'succeeded',
      'failed',
      'cancelled',
      'needs-setup',
      'expired',
    ]),
    resultFiles: z.array(
      z.object({
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        sizeBytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/i),
        format: ExportArtifactFormatEnum,
        textPreview: z.string().optional(),
      })
    ),
    progressEvents: z.array(
      z.object({
        step: z.enum([
          'validating',
          'building-document',
          'encoding-assets',
          'packaging',
          'verifying',
          'ready',
          'failed',
        ]),
        percent: z.number().min(0).max(100),
        message: z.string(),
        timestamp: z.string(),
      })
    ),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    retentionExpiresAt: z.string().min(1),
    failureCode: z.string().optional(),
    failureMessageRedacted: z.string().optional(),
    retryPolicy: z.object({
      attemptCount: z.number().int().min(1),
      maxAttempts: z.number().int().min(1),
      canRetry: z.boolean(),
    }),
  })
  .strict();

/**
 * Parses and validates a portable MotionDocument while preserving unknown top-level
 * or layer fields inside `unknownFields` so forward-compatible documents never crash.
 */
export function parsePortableMotionDocument(input: unknown): {
  valid: boolean;
  document?: z.infer<typeof MotionDocumentSchema>;
  unknownTopLevelKeys: string[];
  error?: string;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      unknownTopLevelKeys: [],
      error: 'MotionDocument must be a JSON object.',
    };
  }

  const knownKeys = new Set([
    'schemaVersion',
    'generator',
    'documentId',
    'createdAt',
    'targetEditor',
    'composition',
    'parameters',
    'easing',
    'layers',
    'assets',
    'audioReferences',
    'unknownFields',
  ]);

  const rawRecord = input as Record<string, unknown>;
  const unknownTopLevelKeys = Object.keys(rawRecord).filter((k) => !knownKeys.has(k));
  const unknownFieldsObj: Record<string, unknown> = {
    ...(typeof rawRecord.unknownFields === 'object' && rawRecord.unknownFields !== null
      ? (rawRecord.unknownFields as Record<string, unknown>)
      : {}),
  };
  for (const key of unknownTopLevelKeys) {
    unknownFieldsObj[key] = rawRecord[key];
  }

  const normalized = {
    ...rawRecord,
    ...(Object.keys(unknownFieldsObj).length > 0 ? { unknownFields: unknownFieldsObj } : {}),
  };

  const parsed = MotionDocumentSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      valid: false,
      unknownTopLevelKeys,
      error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  return {
    valid: true,
    document: parsed.data,
    unknownTopLevelKeys,
  };
}

/**
 * Sanitizes SVG markup against XSS, script execution, inline event handlers,
 * javascript:/data:text/html URIs, and external network references.
 */
export function sanitizeSvgContent(rawSvg: string): {
  sanitizedSvg: string;
  removedThreats: string[];
  safe: boolean;
} {
  const removedThreats: string[] = [];
  let svg = rawSvg;

  if (/<script\b[^>]*>[\s\S]*?<\/script>/gi.test(svg) || /<script\b[^>]*\/?>/gi.test(svg)) {
    removedThreats.push('Removed <script> element');
    svg = svg
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\/?>/gi, '');
  }

  if (/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi.test(svg)) {
    removedThreats.push('Removed <foreignObject> element');
    svg = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '');
  }

  if (/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi.test(svg)) {
    removedThreats.push('Removed inline on* event handler attribute');
    svg = svg.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }

  if (/(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi.test(svg)) {
    removedThreats.push('Removed javascript: URI in href/xlink:href');
    svg = svg.replace(
      /(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi,
      ''
    );
  }

  if (/(?:href|xlink:href)\s*=\s*(?:"\s*https?:\/\/[^"]*"|'\s*https?:\/\/[^']*')/gi.test(svg)) {
    removedThreats.push('Removed external http(s) reference in href/xlink:href');
    svg = svg.replace(
      /(?:href|xlink:href)\s*=\s*(?:"\s*https?:\/\/[^"]*"|'\s*https?:\/\/[^']*')/gi,
      ''
    );
  }

  return {
    sanitizedSvg: svg,
    removedThreats,
    safe: removedThreats.length === 0,
  };
}

export interface ZipSafetyOptions {
  maxEntries?: number;
  maxSingleFileBytes?: number;
  maxTotalUncompressedBytes?: number;
  maxCompressionRatio?: number;
}

/**
 * Inspects a ZIP byte buffer for ZIP-bomb limits and path traversal vulnerabilities.
 */
export function validateZipSafety(
  zipBytes: Uint8Array,
  options: ZipSafetyOptions = {}
): {
  valid: boolean;
  entryCount: number;
  totalUncompressedBytes: number;
  fileNames: string[];
  reason: string;
} {
  const maxEntries = options.maxEntries ?? 64;
  const maxSingleFileBytes = options.maxSingleFileBytes ?? 25 * 1024 * 1024;
  const maxTotalUncompressedBytes = options.maxTotalUncompressedBytes ?? 50 * 1024 * 1024;
  const maxCompressionRatio = options.maxCompressionRatio ?? 100;

  if (zipBytes.byteLength < 22) {
    return {
      valid: false,
      entryCount: 0,
      totalUncompressedBytes: 0,
      fileNames: [],
      reason: 'Archive is smaller than minimum 22-byte ZIP header.',
    };
  }

  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50) {
    return {
      valid: false,
      entryCount: 0,
      totalUncompressedBytes: 0,
      fileNames: [],
      reason: 'Missing PK\\x03\\x04 local file header magic bytes.',
    };
  }

  // Locate End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, zipBytes.byteLength - 65557);
  for (let i = zipBytes.byteLength - 22; i >= minEocdSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) {
    return {
      valid: false,
      entryCount: 0,
      totalUncompressedBytes: 0,
      fileNames: [],
      reason: 'Missing PK\\x05\\x06 End of Central Directory record.',
    };
  }

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  if (entryCount > maxEntries) {
    return {
      valid: false,
      entryCount,
      totalUncompressedBytes: 0,
      fileNames: [],
      reason: `ZIP entry count (${entryCount}) exceeds safe maximum of ${maxEntries} files.`,
    };
  }

  const decoder = new TextDecoder();
  const fileNames: string[] = [];
  let totalUncompressedBytes = 0;
  let ptr = centralDirOffset;

  for (let idx = 0; idx < entryCount; idx++) {
    if (ptr + 46 > zipBytes.byteLength || view.getUint32(ptr, true) !== 0x02014b50) {
      return {
        valid: false,
        entryCount,
        totalUncompressedBytes,
        fileNames,
        reason: `Corrupt Central Directory header at entry ${idx}.`,
      };
    }

    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);

    if (ptr + 46 + nameLen > zipBytes.byteLength) {
      return {
        valid: false,
        entryCount,
        totalUncompressedBytes,
        fileNames,
        reason: 'Truncated file name in Central Directory.',
      };
    }

    const name = decoder.decode(zipBytes.subarray(ptr + 46, ptr + 46 + nameLen));
    fileNames.push(name);

    // Path traversal protection
    if (
      name.startsWith('/') ||
      name.startsWith('\\') ||
      name.includes('../') ||
      name.includes('..\\') ||
      name.includes('..') ||
      /^[A-Za-z]:/.test(name) ||
      name.includes('\0')
    ) {
      return {
        valid: false,
        entryCount,
        totalUncompressedBytes,
        fileNames,
        reason: `Unsafe path traversal or absolute path rejected in ZIP entry: "${name}".`,
      };
    }

    if (uncompressedSize > maxSingleFileBytes) {
      return {
        valid: false,
        entryCount,
        totalUncompressedBytes,
        fileNames,
        reason: `Entry "${name}" uncompressed size (${uncompressedSize} bytes) exceeds per-file limit (${maxSingleFileBytes} bytes).`,
      };
    }

    if (compressedSize > 0 && uncompressedSize / compressedSize > maxCompressionRatio) {
      return {
        valid: false,
        entryCount,
        totalUncompressedBytes,
        fileNames,
        reason: `Entry "${name}" compression ratio (${(uncompressedSize / compressedSize).toFixed(1)}x) exceeds ZIP-bomb ratio limit (${maxCompressionRatio}x).`,
      };
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > maxTotalUncompressedBytes) {
      return {
        valid: false,
        entryCount,
        totalUncompressedBytes,
        fileNames,
        reason: `Total uncompressed size (${totalUncompressedBytes} bytes) exceeds safe limit (${maxTotalUncompressedBytes} bytes).`,
      };
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return {
    valid: true,
    entryCount,
    totalUncompressedBytes,
    fileNames,
    reason: `Verified ZIP archive (${entryCount} files, ${totalUncompressedBytes} bytes uncompressed).`,
  };
}

export interface LocalMediaFileValidationInput {
  name: string;
  size: number;
  type: string;
  headerBytes?: Uint8Array;
  maxSizeMb?: number;
}

/**
 * Validates user-selected mobile files by extension, MIME type, size limit, and magic bytes.
 */
export function validateLocalMediaFile(input: LocalMediaFileValidationInput): {
  valid: boolean;
  detectedKind: 'video' | 'audio' | 'image' | 'subtitle' | 'svg' | 'unknown';
  reason: string;
} {
  const maxBytes = (input.maxSizeMb ?? 50) * 1024 * 1024;
  if (input.size <= 0) {
    return { valid: false, detectedKind: 'unknown', reason: 'Selected file is empty (0 bytes).' };
  }
  if (input.size > maxBytes) {
    return {
      valid: false,
      detectedKind: 'unknown',
      reason: `File "${input.name}" (${(input.size / 1024 / 1024).toFixed(1)} MB) exceeds the ${input.maxSizeMb ?? 50} MB mobile limit.`,
    };
  }

  const lower = input.name.toLowerCase().trim();
  const extMatch = lower.match(/\.([a-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : '';

  const allowedMap: Record<string, 'video' | 'audio' | 'image' | 'subtitle' | 'svg'> = {
    mp4: 'video',
    webm: 'video',
    mov: 'video',
    wav: 'audio',
    mp3: 'audio',
    m4a: 'audio',
    ogg: 'audio',
    png: 'image',
    jpg: 'image',
    jpeg: 'image',
    webp: 'image',
    svg: 'svg',
    srt: 'subtitle',
    vtt: 'subtitle',
    txt: 'subtitle',
    json: 'subtitle',
  };

  const kind = allowedMap[ext];
  if (!kind) {
    return {
      valid: false,
      detectedKind: 'unknown',
      reason: `Unsupported file extension ".${ext || 'none'}". Allowed mobile formats: MP4, WebM, MOV, WAV, MP3, M4A, PNG, JPG, WebP, SVG, SRT, VTT.`,
    };
  }

  // Optional magic-byte verification when header bytes are provided
  if (input.headerBytes && input.headerBytes.byteLength >= 4) {
    const b = input.headerBytes;
    if (ext === 'png') {
      const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
      if (!isPng) {
        return {
          valid: false,
          detectedKind: 'image',
          reason: 'File has .png extension but lacks PNG (89 50 4E 47) magic bytes.',
        };
      }
    } else if (ext === 'wav') {
      const isRiff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
      if (!isRiff) {
        return {
          valid: false,
          detectedKind: 'audio',
          reason: 'File has .wav extension but lacks RIFF header magic bytes.',
        };
      }
    }
  }

  return {
    valid: true,
    detectedKind: kind,
    reason: `Verified ${kind} file (${(input.size / 1024).toFixed(1)} KB).`,
  };
}
