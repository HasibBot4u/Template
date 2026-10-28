import {
  CatalogItem,
  ExportArtifactFormat,
  MobileAspectRatio,
  MobileEditorAdapterDescriptor,
  ModuleId,
  TargetMobileEditorId,
} from '../types/sowveil';
import {
  ALIGHT_MOTION_TESTED_XML_MODULES,
  ALIGHT_MOTION_XML_FEATURE_MATRIX,
  AssetBundleManifestSchema,
  buildExportPreset,
  buildPortableMotionDocument,
  buildSafeExportFilename,
  buildVerifiedAssetBundleManifest,
  classifyPresetForAlightMotionXml,
  computeCrc32,
  computeCrc32Hex,
  computeSha256Hex,
  EDITOR_ADAPTER_INSTANCES,
  EditorCapabilitySchema,
  evaluateVideoExportCapability,
  ExportJobSchema,
  ExportPresetSchema,
  GATEWAY_ADAPTER_DESCRIPTORS,
  generateJsonCaptionsFromCues,
  generateProceduralSfxWav,
  generateRealZipBundle,
  generateSanitizedVectorSvg,
  generateSrtFromCues,
  generateValidPngStillBytes,
  generateVttFromCues,
  getDimensionsForAspectRatio,
  getEditorAdapter,
  listEditorAdapters,
  MotionDocumentSchema,
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
} from '../features/editor-gateway';
import type {
  AssetBundleManifest,
  BackgroundAlphaMode,
  CaptionCueSegment,
  EditorAdapter,
  EditorCapability,
  ExportJob,
  ExportPreset,
  ExportProgressEvent,
  MotionDocument,
  QualityBitratePolicy,
} from '../features/editor-gateway';

export {
  ALIGHT_MOTION_TESTED_XML_MODULES,
  ALIGHT_MOTION_XML_FEATURE_MATRIX,
  AssetBundleManifestSchema,
  buildExportPreset,
  buildPortableMotionDocument,
  buildSafeExportFilename,
  buildVerifiedAssetBundleManifest,
  classifyPresetForAlightMotionXml,
  computeCrc32,
  computeCrc32Hex,
  computeSha256Hex,
  EDITOR_ADAPTER_INSTANCES,
  EditorCapabilitySchema,
  evaluateVideoExportCapability,
  ExportJobSchema,
  ExportPresetSchema,
  GATEWAY_ADAPTER_DESCRIPTORS,
  generateJsonCaptionsFromCues,
  generateProceduralSfxWav,
  generateRealZipBundle,
  generateSanitizedVectorSvg,
  generateSrtFromCues,
  generateValidPngStillBytes,
  generateVttFromCues,
  getDimensionsForAspectRatio,
  getEditorAdapter,
  listEditorAdapters,
  MotionDocumentSchema,
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
};

export type {
  AssetBundleManifest,
  BackgroundAlphaMode,
  CaptionCueSegment,
  EditorAdapter,
  EditorCapability,
  ExportJob,
  ExportPreset,
  ExportProgressEvent,
  MotionDocument,
  QualityBitratePolicy,
};

export const ALIGHT_MOTION_TESTED_MODULES: ModuleId[] = ALIGHT_MOTION_TESTED_XML_MODULES;

export const MOBILE_EDITOR_ADAPTERS: MobileEditorAdapterDescriptor[] =
  GATEWAY_ADAPTER_DESCRIPTORS;

export function getMobileEditorAdapter(
  editorId: TargetMobileEditorId
): MobileEditorAdapterDescriptor {
  return (
    MOBILE_EDITOR_ADAPTERS.find((a) => a.id === editorId) ||
    MOBILE_EDITOR_ADAPTERS[0]
  );
}

export interface SowveilProjectDocument {
  format: 'sowveil-mobile-project';
  schemaVersion: '2.4.0-mobile' | '2.0.0' | '1.0.0';
  generator: 'Sowveil Studio Mobile Motion Engine';
  exportedAt: string;
  targetEditor: TargetMobileEditorId;
  composition: {
    id: string;
    title: string;
    moduleId: ModuleId;
    aspectRatio: MobileAspectRatio;
    width: number;
    height: number;
    fps: number;
    durationSec: number;
  };
  parameters: Record<string, string | number | boolean>;
  easing: {
    cubicBezier: [number, number, number, number];
  };
  layers: Array<{
    id: string;
    name: string;
    type: string;
    inPointSec: number;
    outPointSec: number;
    transform: {
      position: [number, number];
      scale: [number, number];
      rotationDeg: number;
      opacity: number;
    };
  }>;
}

export function generateSowveilProjectDocument(
  itemOrParams:
    | CatalogItem
    | {
        item: CatalogItem;
        targetEditor: TargetMobileEditorId;
        aspectRatio: MobileAspectRatio;
        customValues?: Record<string, string | number | boolean>;
      },
  customValuesArg?: Record<string, string | number | boolean>,
  aspectRatioArg: MobileAspectRatio = '9:16',
  targetEditorArg: TargetMobileEditorId = 'sowveil-project'
): SowveilProjectDocument {
  const isParamsObj =
    itemOrParams && typeof itemOrParams === 'object' && 'item' in itemOrParams;
  const item = isParamsObj ? itemOrParams.item : (itemOrParams as CatalogItem);
  const targetEditor = isParamsObj ? itemOrParams.targetEditor : targetEditorArg;
  const aspectRatio = isParamsObj ? itemOrParams.aspectRatio : aspectRatioArg;
  const customValues = isParamsObj ? itemOrParams.customValues : customValuesArg;

  const doc = buildPortableMotionDocument({
    item,
    targetEditor,
    aspectRatio,
    customValues,
  });

  return {
    format: 'sowveil-mobile-project',
    schemaVersion: '2.4.0-mobile',
    generator: doc.generator,
    exportedAt: doc.createdAt,
    targetEditor: doc.targetEditor,
    composition: {
      id: doc.composition.id,
      title: doc.composition.title,
      moduleId: doc.composition.moduleId,
      aspectRatio: doc.composition.aspectRatio,
      width: doc.composition.width,
      height: doc.composition.height,
      fps: doc.composition.fps,
      durationSec: doc.composition.durationSec,
    },
    parameters: doc.parameters,
    easing: doc.easing,
    layers: doc.layers.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      inPointSec: l.inPointSec,
      outPointSec: l.outPointSec,
      transform: {
        position: l.transform.position,
        scale: l.transform.scale,
        rotationDeg: l.transform.rotationDeg,
        opacity: Math.round(l.opacity * 100),
      },
    })),
  };
}

export function validateSowveilProjectJson(rawJson: string): {
  valid: boolean;
  reason: string;
  parsed?: SowveilProjectDocument;
} {
  try {
    const raw = JSON.parse(rawJson);
    if (
      raw.format === 'sowveil-canonical-project' &&
      raw.schemaVersion === '2.0.0' &&
      raw.canvas &&
      raw.canvas.width > 0 &&
      raw.canvas.height > 0 &&
      Array.isArray(raw.tracks)
    ) {
      const clipCount = raw.tracks.reduce(
        (acc: number, t: { clips?: unknown[] }) =>
          acc + (Array.isArray(t.clips) ? t.clips.length : 0),
        0
      );
      return {
        valid: true,
        reason: `Verified Sowveil Canonical v2.0.0 project (${raw.canvas.width}×${raw.canvas.height} @ ${raw.canvas.fps}fps, ${raw.tracks.length} track(s), ${clipCount} clip(s))`,
        parsed: {
          format: 'sowveil-mobile-project',
          schemaVersion: '2.0.0',
          generator: 'Sowveil Studio Mobile Motion Engine',
          exportedAt: raw.updatedAt || new Date().toISOString(),
          targetEditor: raw.targetEditor || 'sowveil-project',
          composition: {
            id: raw.id || 'proj_canonical',
            title: raw.title || 'Canonical Project',
            moduleId: raw.moduleId || 'text-animation',
            aspectRatio: raw.canvas.aspectRatio || '9:16',
            width: raw.canvas.width,
            height: raw.canvas.height,
            fps: raw.canvas.fps || 60,
            durationSec: raw.canvas.durationSec || 4,
          },
          parameters: { revision: raw.revision || 1 },
          easing: { cubicBezier: [0.22, 1, 0.36, 1] },
          layers: [],
        },
      };
    }

    const v2Check = parsePortableMotionDocument(raw);
    if (v2Check.valid && v2Check.document) {
      return {
        valid: true,
        reason: `Verified Sowveil v${v2Check.document.schemaVersion} composition (${v2Check.document.composition.width}×${v2Check.document.composition.height} @ ${v2Check.document.composition.fps}fps, ${v2Check.document.layers.length} layer(s))`,
        parsed: raw as SowveilProjectDocument,
      };
    }

    if (
      (raw.schemaVersion === '1.0.0' ||
        raw.schemaVersion === '2.0.0' ||
        raw.schemaVersion === '2.4.0-mobile') &&
      raw.composition &&
      raw.composition.width > 0 &&
      raw.composition.height > 0 &&
      Array.isArray(raw.layers) &&
      raw.layers.length > 0
    ) {
      return {
        valid: true,
        reason: `Verified Sowveil v${raw.schemaVersion} composition (${raw.composition.width}×${raw.composition.height} @ ${raw.composition.fps}fps, ${raw.layers.length} layer(s))`,
        parsed: raw as SowveilProjectDocument,
      };
    }

    return { valid: false, reason: v2Check.error || 'Invalid Sowveil project JSON.' };
  } catch {
    return { valid: false, reason: 'Malformed JSON syntax' };
  }
}

export function generateAlightMotionXml(
  itemOrParams:
    | CatalogItem
    | {
        item: CatalogItem;
        aspectRatio: MobileAspectRatio;
        customValues?: Record<string, string | number | boolean>;
      },
  customValuesArg?: Record<string, string | number | boolean>,
  aspectRatioArg: MobileAspectRatio = '9:16'
): string {
  const isParamsObj =
    itemOrParams && typeof itemOrParams === 'object' && 'item' in itemOrParams;
  return serializeAlightMotionXml({
    item: isParamsObj ? itemOrParams.item : (itemOrParams as CatalogItem),
    aspectRatio: isParamsObj ? itemOrParams.aspectRatio : aspectRatioArg,
    customValues: isParamsObj ? itemOrParams.customValues : customValuesArg,
  });
}

export function validateAlightMotionXml(xml: string): {
  valid: boolean;
  reason: string;
} {
  const res = validateAndInspectAlightMotionXml(xml);
  return { valid: res.valid, reason: res.reason };
}

export function generateMotionVectorSvg(
  itemOrParams:
    | CatalogItem
    | {
        item: CatalogItem;
        aspectRatio: MobileAspectRatio;
        customValues?: Record<string, string | number | boolean>;
      },
  customValuesArg?: Record<string, string | number | boolean>,
  aspectRatioArg: MobileAspectRatio = '9:16'
): string {
  const isParamsObj =
    itemOrParams && typeof itemOrParams === 'object' && 'item' in itemOrParams;
  return generateSanitizedVectorSvg({
    item: isParamsObj ? itemOrParams.item : (itemOrParams as CatalogItem),
    aspectRatio: isParamsObj ? itemOrParams.aspectRatio : aspectRatioArg,
    customValues: isParamsObj ? itemOrParams.customValues : customValuesArg,
  });
}

export function validateZipBytes(bytes: Uint8Array): {
  valid: boolean;
  reason: string;
} {
  const res = validateZipSafety(bytes);
  return { valid: res.valid, reason: res.reason };
}

export interface GeneratedExportArtifact {
  fileName: string;
  mimeType: string;
  format: ExportArtifactFormat;
  aspectRatio: MobileAspectRatio;
  bytes: Uint8Array;
  sha256: string;
  textPreview?: string;
  adapter: MobileEditorAdapterDescriptor;
  bundleLabel: string;
  validationPassed: boolean;
  validationDetails: string;
  importSteps: string[];
  whyNotDirectNote: string;
  bundleManifest: string[];
  manifestObject: AssetBundleManifest;
  preset: ExportPreset;
  progressEvents: ExportProgressEvent[];
}

export function buildMobileEditorExportArtifact(params: {
  item: CatalogItem;
  targetEditor: TargetMobileEditorId;
  format?: ExportArtifactFormat;
  aspectRatio?: MobileAspectRatio;
  fps?: 24 | 30 | 60;
  durationSec?: number;
  qualityPolicy?: QualityBitratePolicy;
  backgroundMode?: BackgroundAlphaMode;
  customValues?: Record<string, string | number | boolean>;
}): GeneratedExportArtifact {
  const descriptor = getMobileEditorAdapter(params.targetEditor);
  const adapterInstance = getEditorAdapter(params.targetEditor);

  const gatewayResult = adapterInstance.generateExport({
    item: params.item,
    preset: {
      aspectRatio: params.aspectRatio ?? '9:16',
      fps: params.fps,
      durationSec: params.durationSec,
      qualityPolicy: params.qualityPolicy,
      backgroundMode: params.backgroundMode,
      outputFormat: params.format,
    },
    customValues: params.customValues,
  });

  return {
    fileName: gatewayResult.primaryFile.fileName,
    mimeType: gatewayResult.primaryFile.mimeType,
    format: gatewayResult.primaryFile.format,
    aspectRatio: gatewayResult.preset.aspectRatio,
    bytes: gatewayResult.primaryFile.bytes,
    sha256: gatewayResult.primaryFile.sha256,
    textPreview: gatewayResult.primaryFile.textPreview,
    adapter: descriptor,
    bundleLabel: gatewayResult.bundleLabel,
    validationPassed: gatewayResult.validationPassed,
    validationDetails: gatewayResult.validationDetails,
    importSteps: gatewayResult.importSteps,
    whyNotDirectNote: gatewayResult.whyNotDirectNote,
    bundleManifest: [
      'manifest.json',
      ...gatewayResult.manifest.generatedOutputs,
    ],
    manifestObject: gatewayResult.manifest,
    preset: gatewayResult.preset,
    progressEvents: gatewayResult.progressEvents,
  };
}

export type CaptionCue = CaptionCueSegment;

export {
  generateRealZipBundle as buildZipArchiveBytes,
  generateProceduralSfxWav as generateProceduralSfxWavBytes,
  generateSrtFromCues as serializeCaptionsToSrt,
  generateVttFromCues as serializeCaptionsToVtt,
};

export function serializeCaptionsToJson(
  cues: CaptionCueSegment[],
  aspectRatioOrMeta?: MobileAspectRatio | { language?: string; wordsPerCaption?: number }
): string {
  const aspectRatio: MobileAspectRatio =
    typeof aspectRatioOrMeta === 'string' ? aspectRatioOrMeta : '9:16';
  const baseJson = generateJsonCaptionsFromCues(cues, aspectRatio);
  if (aspectRatioOrMeta && typeof aspectRatioOrMeta === 'object') {
    const parsed = JSON.parse(baseJson);
    return JSON.stringify(
      {
        ...parsed,
        language: aspectRatioOrMeta.language ?? 'en',
        wordsPerCaption: aspectRatioOrMeta.wordsPerCaption ?? 3,
      },
      null,
      2
    );
  }
  return baseJson;
}

export function formatSrtTimestamp(sec: number): string {
  const clamped = Math.max(0, sec);
  const totalMs = Math.round(clamped * 1000);
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatVttTimestamp(sec: number): string {
  return formatSrtTimestamp(sec).replace(',', '.');
}

export function buildCaptionCuesFromTranscript(
  transcript: string,
  wordsPerCaption = 3,
  durationSec = 10
): CaptionCueSegment[] {
  const words = transcript
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) {
    return [
      {
        index: 1,
        startSec: 0,
        endSec: 2,
        text: 'Sowveil Studio mobile captions.',
      },
    ];
  }
  const chunkSize = Math.max(1, Math.min(12, Math.round(wordsPerCaption)));
  const groups: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    groups.push(words.slice(i, i + chunkSize).join(' '));
  }
  const totalDur = Math.max(groups.length * 0.8, durationSec);
  const stepSec = totalDur / groups.length;
  return groups.map((text, idx) => ({
    index: idx + 1,
    startSec: Number((idx * stepSec).toFixed(2)),
    endSec: Number(Math.max(idx * stepSec + 0.5, (idx + 1) * stepSec - 0.05).toFixed(2)),
    text,
  }));
}

export function buildMotionDocumentFromCatalogItem(
  item: CatalogItem,
  customValues: Record<string, string | number | boolean> = {},
  options?: {
    aspectRatio?: MobileAspectRatio;
    durationSec?: number;
    fps?: 24 | 30 | 60;
    targetEditor?: TargetMobileEditorId;
  }
): Omit<MotionDocument, 'layers'> & {
  width: number;
  height: number;
  fps: number;
  aspectRatio: MobileAspectRatio;
  backgroundColor: string;
  layers: Array<
    MotionDocument['layers'][number] & {
      kind: string;
      keyframes: Array<{ timeSec: number; value: number }>;
      blendMode: string;
    }
  >;
} {
  const doc = buildPortableMotionDocument({
    item,
    targetEditor: options?.targetEditor ?? 'sowveil-project',
    aspectRatio: options?.aspectRatio ?? '9:16',
    fps: options?.fps,
    durationSec: options?.durationSec,
    customValues,
  });

  return {
    ...doc,
    width: doc.composition.width,
    height: doc.composition.height,
    fps: doc.composition.fps,
    aspectRatio: doc.composition.aspectRatio,
    backgroundColor: doc.composition.backgroundColorHex,
    layers: doc.layers.map((layer) => ({
      ...layer,
      kind: layer.type,
      keyframes: [
        { timeSec: layer.inPointSec, value: 0 },
        { timeSec: layer.outPointSec, value: 1 },
      ],
      blendMode: 'normal',
    })),
  };
}


