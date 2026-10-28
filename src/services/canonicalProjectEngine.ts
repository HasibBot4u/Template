import { z } from 'zod';
import {
  CatalogItem,
  MobileAspectRatio,
  ModuleId,
  ProjectLibraryItem,
  TargetMobileEditorId,
  TemplateVariantInstance,
} from '../types/sowveil';
import {
  CanonicalAssetDependency,
  CanonicalAudioConfig,
  CanonicalBlendMode,
  CanonicalCanvasConfig,
  CanonicalClip,
  CanonicalClipKind,
  CanonicalCommandType,
  CanonicalEffectInstance,
  CanonicalKeyframe,
  CanonicalKeyframeInterpolation,
  CanonicalMaskSpec,
  CanonicalProjectBranch,
  CanonicalProjectCommand,
  CanonicalProjectDocument,
  CanonicalProjectSnapshot,
  CanonicalSceneReference,
  CanonicalTimelineMarker,
  CanonicalTrack,
  CanonicalTrackKind,
  CanonicalTransform2D,
  CanonicalTransitionSpec,
  CanonicalUnsupportedFeatureRecord,
  CommandActorContext,
  LegacyProjectSchemaVersion,
  ProjectCommandReceipt,
} from '../types/canonicalProject';
import {
  getDimensionsForAspectRatio,
  MotionDocument,
  SowveilProjectDocument,
} from './editorGateway';

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'format',
  'schemaVersion',
  'migratedFromVersion',
  'id',
  'ownerUid',
  'title',
  'description',
  'moduleId',
  'targetEditor',
  'revision',
  'activeBranch',
  'createdAt',
  'updatedAt',
  'canvas',
  'scenes',
  'tracks',
  'markers',
  'assetReferences',
  'dependencies',
  'provenance',
  'aiEditHistory',
  'snapshots',
  'branches',
  'unsupportedFeatures',
  'rendererRequirements',
  'tags',
  'unknownProperties',
]);

const KNOWN_TRACK_KEYS = new Set([
  'id',
  'name',
  'kind',
  'order',
  'visible',
  'locked',
  'muted',
  'solo',
  'blendMode',
  'gainDb',
  'clips',
  'unknownProperties',
]);

const KNOWN_CLIP_KEYS = new Set([
  'id',
  'trackId',
  'name',
  'kind',
  'sceneId',
  'sourceSegmentId',
  'groupId',
  'startTimeSec',
  'durationSec',
  'sourceInSec',
  'sourceOutSec',
  'trimInSec',
  'trimOutSec',
  'speedMultiplier',
  'visible',
  'locked',
  'muted',
  'solo',
  'blendMode',
  'transform',
  'assetId',
  'assetSlotBindings',
  'textData',
  'vectorData',
  'audioConfig',
  'captionData',
  'templateBinding',
  'entity3d',
  'camera3d',
  'keyframes',
  'effects',
  'masks',
  'inTransition',
  'outTransition',
  'unknownProperties',
]);

export const CanonicalTransform2DSchema = z.object({
  position: z.tuple([z.number(), z.number()]),
  scale: z.tuple([z.number(), z.number()]),
  rotationDeg: z.number(),
  anchor: z.tuple([z.number(), z.number()]),
  opacity: z.number().min(0).max(1),
});

export const CanonicalKeyframeSchema = z.object({
  id: z.string().min(1),
  property: z.string().min(1),
  timeSec: z.number().min(0),
  value: z.union([z.number(), z.string(), z.boolean()]),
  interpolation: z.enum([
    'linear',
    'hold',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'cubic-bezier',
  ]),
  cubicBezier: z
    .tuple([z.number(), z.number(), z.number(), z.number()])
    .optional(),
  easingPresetId: z.string().optional(),
});

export const CanonicalEffectSchema = z.object({
  id: z.string().min(1),
  effectType: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean(),
  rendererSupport: z.enum(['supported', 'partial-fallback', 'unsupported']),
  supportedInAlightXml: z.boolean(),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export const CanonicalMaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(['add', 'subtract', 'intersect']),
  inverted: z.boolean(),
  featherPx: z.number().min(0),
  opacity: z.number().min(0).max(1),
  svgPathData: z.string(),
  rendererSupport: z.enum(['supported', 'partial-fallback', 'unsupported']),
});

export const CanonicalTransitionSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'cut',
    'cross-dissolve',
    'slide-left',
    'slide-up',
    'zoom-blur',
    'vertical-glow',
    'whip-pan',
  ]),
  durationSec: z.number().positive(),
  easingCurve: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  targetClipId: z.string().optional(),
});

export const CanonicalClipSchema = z
  .object({
    id: z.string().min(1),
    trackId: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum([
      'video',
      'image',
      'vector',
      'text',
      'audio',
      'caption',
      'template-instance',
      'adjustment-effect',
      'entity-3d',
      'camera-3d',
    ]),
    sceneId: z.string().optional(),
    sourceSegmentId: z.string().optional(),
    groupId: z.string().optional(),
    startTimeSec: z.number().min(0),
    durationSec: z.number().positive(),
    sourceInSec: z.number().min(0),
    sourceOutSec: z.number().min(0),
    trimInSec: z.number().min(0),
    trimOutSec: z.number().min(0),
    speedMultiplier: z.number().positive(),
    visible: z.boolean(),
    locked: z.boolean(),
    muted: z.boolean(),
    solo: z.boolean(),
    blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'add']),
    transform: CanonicalTransform2DSchema,
    assetId: z.string().optional(),
    assetSlotBindings: z.record(z.string(), z.string()).optional(),
    textData: z
      .object({
        content: z.string(),
        fontFamily: z.string(),
        fontSizePx: z.number().positive(),
        fontWeight: z.number().int().min(100).max(900),
        letterSpacingEm: z.number(),
        lineHeightMultiplier: z.number().positive(),
        colorHex: z.string(),
        strokeColorHex: z.string().optional(),
        strokeWidthPx: z.number().min(0).optional(),
        backgroundHighlightHex: z.string().optional(),
        alignment: z.enum(['left', 'center', 'right']),
        textTransform: z.enum(['none', 'uppercase', 'lowercase']).optional(),
      })
      .optional(),
    vectorData: z
      .object({
        shapeType: z.enum([
          'rect',
          'ellipse',
          'polygon',
          'path',
          'liquid-glass-card',
        ]),
        svgPathData: z.string(),
        fillColorHex: z.string(),
        strokeColorHex: z.string(),
        strokeWidthPx: z.number().min(0),
        cornerRadiusPx: z.number().min(0),
      })
      .optional(),
    audioConfig: z
      .object({
        gainDb: z.number().min(-60).max(24),
        linearGain: z.number().min(0).max(16),
        pan: z.number().min(-1).max(1),
        fadeInSec: z.number().min(0),
        fadeOutSec: z.number().min(0),
        muted: z.boolean(),
        proceduralSfxPreset: z.string().optional(),
        waveformPeaks: z.array(z.number()).optional(),
      })
      .optional(),
    captionData: z
      .object({
        cueIndex: z.number().int().min(1),
        text: z.string(),
        speaker: z.string().optional(),
        stylePresetId: z.string(),
        highlightColorHex: z.string(),
        maxCharsPerLine: z.number().int().min(8).max(120),
        wordTimings: z
          .array(
            z.object({
              word: z.string(),
              startSec: z.number().min(0),
              endSec: z.number().min(0),
            })
          )
          .optional(),
      })
      .optional(),
    templateBinding: z
      .object({
        baseTemplateId: z.string().min(1),
        baseTemplateVersion: z.string().min(1),
        variantId: z.string().optional(),
        moduleId: z.string().min(1) as z.ZodType<ModuleId>,
        parameterOverrides: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()])
        ),
        assetSlotBindings: z.record(z.string(), z.string()),
        editabilityLevel: z.enum([
          'source-proven',
          'parameter-rig',
          'reconstructed-approximation',
          'flattened-media',
        ]),
      })
      .optional(),
    entity3d: z
      .object({
        primitiveType: z.enum(['cube', 'sphere', 'torus', 'plane', 'glb-asset']),
        modelAssetId: z.string().optional(),
        position3d: z.tuple([z.number(), z.number(), z.number()]),
        rotation3dDeg: z.tuple([z.number(), z.number(), z.number()]),
        scale3d: z.tuple([z.number(), z.number(), z.number()]),
        materialPreset: z.enum(['matte', 'glossy', 'metallic', 'liquid-glass']),
        rendererSupport: z.enum(['supported', 'partial-fallback', 'unsupported']),
      })
      .optional(),
    camera3d: z
      .object({
        projection: z.enum(['perspective', 'orthographic']),
        fovDeg: z.number().min(10).max(170),
        nearClip: z.number().positive(),
        farClip: z.number().positive(),
        position3d: z.tuple([z.number(), z.number(), z.number()]),
        target3d: z.tuple([z.number(), z.number(), z.number()]),
        depthOfFieldEnabled: z.boolean(),
        rendererSupport: z.enum(['supported', 'partial-fallback', 'unsupported']),
      })
      .optional(),
    keyframes: z.array(CanonicalKeyframeSchema),
    effects: z.array(CanonicalEffectSchema),
    masks: z.array(CanonicalMaskSchema),
    inTransition: CanonicalTransitionSchema.optional(),
    outTransition: CanonicalTransitionSchema.optional(),
    unknownProperties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const CanonicalTrackSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum([
      'video',
      'vector',
      'text',
      'audio',
      'caption',
      'template',
      'effect',
      'camera3d',
    ]),
    order: z.number().int().min(0),
    visible: z.boolean(),
    locked: z.boolean(),
    muted: z.boolean(),
    solo: z.boolean(),
    blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'add']),
    gainDb: z.number().min(-60).max(24),
    clips: z.array(CanonicalClipSchema),
    unknownProperties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const CanonicalProjectDocumentSchema = z
  .object({
    format: z.literal('sowveil-canonical-project'),
    schemaVersion: z.literal('2.0.0'),
    migratedFromVersion: z.enum(['1.0.0', '2.4.0-mobile']).optional(),
    id: z.string().min(1),
    ownerUid: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().max(4000),
    moduleId: z.string().min(1) as z.ZodType<ModuleId>,
    targetEditor: z.enum([
      'capcut',
      'alight-motion',
      'node-video',
      'kinemaster',
      'sowveil-project',
      'universal-bundle',
    ]),
    revision: z.number().int().min(1),
    activeBranch: z.string().min(1),
    createdAt: z.string().min(4),
    updatedAt: z.string().min(4),
    canvas: z.object({
      width: z.number().int().min(120).max(7680),
      height: z.number().int().min(120).max(7680),
      aspectRatio: z.enum(['9:16', '1:1', '16:9']),
      fps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
      timebaseTicksPerSec: z.number().int().positive(),
      durationSec: z.number().positive().max(3600),
      backgroundColorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
      backgroundAlphaMode: z.enum(['solid', 'transparent', 'chroma-key-green']),
    }),
    scenes: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        order: z.number().int().min(0),
        startTimeSec: z.number().min(0),
        durationSec: z.number().positive(),
        scriptSegmentIds: z.array(z.string()),
        continuityNotes: z.string().optional(),
        status: z.enum(['planned', 'draft', 'approved', 'locked', 'omitted']),
      })
    ),
    tracks: z.array(CanonicalTrackSchema),
    markers: z.array(
      z.object({
        id: z.string().min(1),
        timeSec: z.number().min(0),
        durationSec: z.number().min(0).optional(),
        label: z.string().min(1),
        colorHex: z.string(),
        kind: z.enum(['chapter', 'beat', 'script-cue', 'comment', 'qa-warning']),
        linkedScriptSegmentId: z.string().optional(),
      })
    ),
    assetReferences: z.array(
      z.object({
        assetId: z.string().min(1),
        title: z.string().min(1),
        role: z.enum([
          'primary-media',
          'vector-graphic',
          'audio-sfx',
          'font',
          'caption-sidecar',
          '3d-model',
          'template-slot',
        ]),
        mimeType: z.string().min(1),
        required: z.boolean(),
        missing: z.boolean(),
        licenseType: z.enum([
          'Unknown',
          'Original Demo Specification',
          'Reference Metadata Only',
          'User Owned',
          'CC-BY-4.0',
          'CC0-Public-Domain',
          'Commercial-Licensed',
          'Sowveil Original',
          'Royalty-Free Commercial',
          'CC0 Public Domain',
          'Free',
          'Attribution Required',
          'Editorial Only',
          'Custom License',
        ]),
        attribution: z.string().optional(),
        sourceUrl: z.string().optional(),
      })
    ),
    dependencies: z.array(
      z.object({
        id: z.string().min(1),
        kind: z.enum(['module', 'font', 'shader', 'audio-engine', 'adapter']),
        name: z.string().min(1),
        versionConstraint: z.string().min(1),
        required: z.boolean(),
        status: z.enum(['satisfied', 'optional-fallback', 'missing']),
      })
    ),
    provenance: z.object({
      originType: z.enum([
        'manual-editor',
        'template-instantiation',
        'ai-director',
        'imported-sowveil-json',
        'migrated-legacy-v1',
        'reference-reconstruction',
      ]),
      authorUid: z.string().min(1),
      createdFromTemplateId: z.string().optional(),
      createdFromVariantId: z.string().optional(),
      sourceUrl: z.string().optional(),
      licenseType: z.enum([
        'Unknown',
        'Original Demo Specification',
        'Reference Metadata Only',
        'User Owned',
        'CC-BY-4.0',
        'CC0-Public-Domain',
        'Commercial-Licensed',
        'Sowveil Original',
        'Royalty-Free Commercial',
        'CC0 Public Domain',
        'Free',
        'Attribution Required',
        'Editorial Only',
        'Custom License',
      ]),
      licenseNote: z.string(),
      attribution: z.string(),
      reconstructionFidelityNote: z.string().optional(),
    }),
    aiEditHistory: z.array(
      z.object({
        id: z.string().min(1),
        timestamp: z.string().min(1),
        actorId: z.string().min(1),
        actorKind: z.enum(['user', 'ai-director']),
        commandType: z.string() as z.ZodType<CanonicalCommandType>,
        rationale: z.string(),
        changedIds: z.array(z.string()),
        beforeRevision: z.number().int().min(1),
        afterRevision: z.number().int().min(1),
        approvedByUser: z.boolean(),
      })
    ),
    snapshots: z.array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        branchName: z.string().min(1),
        revision: z.number().int().min(1),
        createdAt: z.string().min(1),
        createdByUid: z.string().min(1),
        serializedStateJson: z.string(),
      })
    ),
    branches: z.array(
      z.object({
        name: z.string().min(1),
        headRevision: z.number().int().min(1),
        createdFromRevision: z.number().int().min(1),
        createdAt: z.string().min(1),
        description: z.string().optional(),
      })
    ),
    unsupportedFeatures: z.array(
      z.object({
        id: z.string().min(1),
        featureKey: z.string().min(1),
        sourceFormat: z.string().min(1),
        severity: z.enum(['info', 'warning', 'blocking']),
        fallbackBehavior: z.enum([
          'preserved-metadata',
          'approximated-2d',
          'omitted-on-export',
        ]),
        message: z.string().min(1),
        rawPayload: z.record(z.string(), z.unknown()).optional(),
      })
    ),
    rendererRequirements: z.object({
      minCanvasTier: z.enum([
        'canvas-2d',
        'svg-vector',
        'webgl-2d',
        'webgl-3d-experimental',
      ]),
      requiresWebAudio: z.boolean(),
      requiresWebGL: z.boolean(),
      requires3dPreview: z.boolean(),
      targetMobileEditors: z.record(z.string(), z.string()),
      degradationNotes: z.array(z.string()),
    }),
    tags: z.array(z.string()),
    unknownProperties: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export function dbToLinearGain(db: number): number {
  if (db <= -60) return 0;
  return Number(Math.pow(10, db / 20).toFixed(4));
}

export function extractUnknownFields(
  raw: Record<string, unknown>,
  knownKeys: Set<string>
): Record<string, unknown> | undefined {
  const existingUnknown =
    raw.unknownProperties &&
    typeof raw.unknownProperties === 'object' &&
    !Array.isArray(raw.unknownProperties)
      ? { ...(raw.unknownProperties as Record<string, unknown>) }
      : {};

  for (const [k, v] of Object.entries(raw)) {
    if (!knownKeys.has(k)) {
      existingUnknown[k] = v;
    }
  }
  return Object.keys(existingUnknown).length > 0 ? existingUnknown : undefined;
}

/**
 * Validates a CanonicalProjectDocument, checking schema types, range invariants,
 * duplicate IDs across tracks/clips/keyframes/effects/markers, and preserving
 * unknown properties safely.
 */
export function validateCanonicalProject(input: unknown): {
  valid: boolean;
  project?: CanonicalProjectDocument;
  errors: string[];
  warnings: string[];
  unknownKeysPreserved: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const unknownKeysPreserved: string[] = [];

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: ['Project document must be a non-null JSON object.'],
      warnings,
      unknownKeysPreserved,
    };
  }

  const raw = input as Record<string, unknown>;
  const topUnknown = extractUnknownFields(raw, KNOWN_TOP_LEVEL_KEYS);
  if (topUnknown) {
    unknownKeysPreserved.push(...Object.keys(topUnknown));
  }

  const normalizedTracks = Array.isArray(raw.tracks)
    ? raw.tracks.map((tRaw) => {
        if (!tRaw || typeof tRaw !== 'object') return tRaw;
        const tObj = tRaw as Record<string, unknown>;
        const trackUnknown = extractUnknownFields(tObj, KNOWN_TRACK_KEYS);
        if (trackUnknown) {
          for (const k of Object.keys(trackUnknown)) {
            unknownKeysPreserved.push(`track.${String(tObj.id || '?')}.${k}`);
          }
        }
        const normalizedClips = Array.isArray(tObj.clips)
          ? tObj.clips.map((cRaw) => {
              if (!cRaw || typeof cRaw !== 'object') return cRaw;
              const cObj = cRaw as Record<string, unknown>;
              const clipUnknown = extractUnknownFields(cObj, KNOWN_CLIP_KEYS);
              if (clipUnknown) {
                for (const k of Object.keys(clipUnknown)) {
                  unknownKeysPreserved.push(`clip.${String(cObj.id || '?')}.${k}`);
                }
              }
              return {
                ...cObj,
                ...(clipUnknown ? { unknownProperties: clipUnknown } : {}),
              };
            })
          : tObj.clips;

        return {
          ...tObj,
          clips: normalizedClips,
          ...(trackUnknown ? { unknownProperties: trackUnknown } : {}),
        };
      })
    : raw.tracks;

  const candidate = {
    ...raw,
    tracks: normalizedTracks,
    ...(topUnknown ? { unknownProperties: topUnknown } : {}),
  };

  const parsed = CanonicalProjectDocumentSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map(
        (iss) => `${iss.path.join('.') || 'root'}: ${iss.message}`
      ),
      warnings,
      unknownKeysPreserved,
    };
  }

  const doc = parsed.data as unknown as CanonicalProjectDocument;

  // Enforce unique IDs across tracks, clips, keyframes, effects, masks, scenes, markers
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();
  const sceneIds = new Set<string>();
  const markerIds = new Set<string>();

  for (const scene of doc.scenes) {
    if (sceneIds.has(scene.id)) {
      errors.push(`DUPLICATE_ID: Duplicate scene ID "${scene.id}".`);
    }
    sceneIds.add(scene.id);
  }

  for (const marker of doc.markers) {
    if (markerIds.has(marker.id)) {
      errors.push(`DUPLICATE_ID: Duplicate marker ID "${marker.id}".`);
    }
    markerIds.add(marker.id);
  }

  for (const track of doc.tracks) {
    if (trackIds.has(track.id)) {
      errors.push(`DUPLICATE_ID: Duplicate track ID "${track.id}".`);
    }
    trackIds.add(track.id);

    for (const clip of track.clips) {
      if (clipIds.has(clip.id)) {
        errors.push(`DUPLICATE_ID: Duplicate clip ID "${clip.id}".`);
      }
      clipIds.add(clip.id);

      if (clip.sourceOutSec < clip.sourceInSec) {
        errors.push(
          `INVALID_RANGE: Clip "${clip.id}" has sourceOutSec (${clip.sourceOutSec}) < sourceInSec (${clip.sourceInSec}).`
        );
      }

      const kfIds = new Set<string>();
      for (const kf of clip.keyframes) {
        if (kfIds.has(kf.id)) {
          errors.push(
            `DUPLICATE_ID: Duplicate keyframe ID "${kf.id}" on clip "${clip.id}".`
          );
        }
        kfIds.add(kf.id);
      }

      const effectIds = new Set<string>();
      for (const eff of clip.effects) {
        if (effectIds.has(eff.id)) {
          errors.push(
            `DUPLICATE_ID: Duplicate effect ID "${eff.id}" on clip "${clip.id}".`
          );
        }
        effectIds.add(eff.id);
        if (eff.rendererSupport !== 'supported') {
          warnings.push(
            `Effect "${eff.name}" (${eff.effectType}) on clip "${clip.name}" has renderer support "${eff.rendererSupport}".`
          );
        }
      }

      if (clip.masks.length > 0) {
        for (const mask of clip.masks) {
          if (mask.rendererSupport !== 'supported') {
            warnings.push(
              `Mask "${mask.name}" on clip "${clip.name}" has renderer support "${mask.rendererSupport}".`
            );
          }
        }
      }
    }
  }

  if (doc.unsupportedFeatures.length > 0) {
    for (const uf of doc.unsupportedFeatures) {
      warnings.push(
        `Unsupported feature [${uf.featureKey}]: ${uf.message} (${uf.fallbackBehavior})`
      );
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      unknownKeysPreserved,
    };
  }

  return {
    valid: true,
    project: doc,
    errors: [],
    warnings,
    unknownKeysPreserved,
  };
}

/**
 * Serializes a CanonicalProjectDocument while restoring any preserved `unknownProperties`
 * back onto the serialized JSON object so round-trip import/export never loses future fields.
 */
export function serializeCanonicalProject(doc: CanonicalProjectDocument): string {
  const clone: Record<string, unknown> = {
    ...(doc.unknownProperties || {}),
    ...doc,
    tracks: doc.tracks.map((track) => ({
      ...(track.unknownProperties || {}),
      ...track,
      clips: track.clips.map((clip) => ({
        ...(clip.unknownProperties || {}),
        ...clip,
      })),
    })),
  };
  return JSON.stringify(clone, null, 2);
}

/**
 * Creates a clean minimal CanonicalProjectDocument (`schemaVersion: '2.0.0'`).
 */
export function createMinimalCanonicalProject(params?: {
  id?: string;
  ownerUid?: string;
  title?: string;
  description?: string;
  moduleId?: ModuleId;
  targetEditor?: TargetMobileEditorId;
  aspectRatio?: MobileAspectRatio;
  fps?: 24 | 30 | 60;
  durationSec?: number;
}): CanonicalProjectDocument {
  const now = new Date().toISOString();
  const aspectRatio = params?.aspectRatio || '9:16';
  const dims = getDimensionsForAspectRatio(aspectRatio);
  const fps = params?.fps || 60;
  const durationSec = params?.durationSec || 5;
  const projectId = params?.id || `proj_canon_${Date.now()}`;
  const ownerUid = params?.ownerUid || 'user-local';
  const title = params?.title || 'Untitled Sowveil Project';

  return {
    format: 'sowveil-canonical-project',
    schemaVersion: '2.0.0',
    id: projectId,
    ownerUid,
    title,
    description:
      params?.description ||
      'Canonical versioned Sowveil editable project shared by templates, manual Pro editor, AI Director, and export gateway.',
    moduleId: params?.moduleId || 'text-animation',
    targetEditor: params?.targetEditor || 'sowveil-project',
    revision: 1,
    activeBranch: 'main',
    createdAt: now,
    updatedAt: now,
    canvas: {
      width: dims.width,
      height: dims.height,
      aspectRatio,
      fps,
      timebaseTicksPerSec: fps * 1000,
      durationSec,
      backgroundColorHex: '#0B0A09',
      backgroundAlphaMode: 'solid',
    },
    scenes: [
      {
        id: 'scene_1',
        title: 'Scene 1 · Hook',
        order: 0,
        startTimeSec: 0,
        durationSec,
        scriptSegmentIds: ['seg_hook_01'],
        continuityNotes: 'Primary opening composition',
        status: 'draft',
      },
    ],
    tracks: [
      {
        id: 'track_text_1',
        name: 'Text & Titles',
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
            id: 'clip_headline_1',
            trackId: 'track_text_1',
            name: title,
            kind: 'text',
            sceneId: 'scene_1',
            sourceSegmentId: 'seg_hook_01',
            startTimeSec: 0,
            durationSec: Math.min(3.5, durationSec),
            sourceInSec: 0,
            sourceOutSec: Math.min(3.5, durationSec),
            trimInSec: 0,
            trimOutSec: 0,
            speedMultiplier: 1,
            visible: true,
            locked: false,
            muted: false,
            solo: false,
            blendMode: 'normal',
            transform: {
              position: [dims.width / 2, dims.height / 2],
              scale: [1, 1],
              rotationDeg: 0,
              anchor: [0.5, 0.5],
              opacity: 1,
            },
            textData: {
              content: title,
              fontFamily: 'Inter',
              fontSizePx: 68,
              fontWeight: 800,
              letterSpacingEm: -0.02,
              lineHeightMultiplier: 1.15,
              colorHex: '#F3EEE8',
              strokeColorHex: '#F06424',
              strokeWidthPx: 0,
              alignment: 'center',
              textTransform: 'none',
            },
            keyframes: [
              {
                id: 'kf_opacity_in',
                property: 'opacity',
                timeSec: 0,
                value: 0,
                interpolation: 'cubic-bezier',
                cubicBezier: [0.22, 1, 0.36, 1],
              },
              {
                id: 'kf_opacity_hold',
                property: 'opacity',
                timeSec: 0.45,
                value: 1,
                interpolation: 'cubic-bezier',
                cubicBezier: [0.22, 1, 0.36, 1],
              },
            ],
            effects: [],
            masks: [],
          },
        ],
      },
      {
        id: 'track_vector_1',
        name: 'Vector & Motion Plates',
        kind: 'vector',
        order: 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        gainDb: 0,
        clips: [],
      },
      {
        id: 'track_caption_1',
        name: 'Captions & Subtitles',
        kind: 'caption',
        order: 2,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        gainDb: 0,
        clips: [],
      },
      {
        id: 'track_audio_1',
        name: 'Audio & SFX',
        kind: 'audio',
        order: 3,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        gainDb: 0,
        clips: [],
      },
    ],
    markers: [
      {
        id: 'marker_start',
        timeSec: 0,
        label: 'In Point',
        colorHex: '#F06424',
        kind: 'chapter',
        linkedScriptSegmentId: 'seg_hook_01',
      },
    ],
    assetReferences: [],
    dependencies: [
      {
        id: 'dep_canvas2d',
        kind: 'module',
        name: 'Sowveil 2D/Vector Motion Renderer',
        versionConstraint: '>=2.0.0',
        required: true,
        status: 'satisfied',
      },
    ],
    provenance: {
      originType: 'manual-editor',
      authorUid: ownerUid,
      licenseType: 'User Owned',
      licenseNote: 'Created in Sowveil Studio Pro Editor',
      attribution: 'User Workspace',
    },
    aiEditHistory: [],
    snapshots: [],
    branches: [
      {
        name: 'main',
        headRevision: 1,
        createdFromRevision: 1,
        createdAt: now,
        description: 'Primary editable timeline branch',
      },
    ],
    unsupportedFeatures: [],
    rendererRequirements: {
      minCanvasTier: 'canvas-2d',
      requiresWebAudio: false,
      requiresWebGL: false,
      requires3dPreview: false,
      targetMobileEditors: {
        'sowveil-project': 'Verified',
        'alight-motion': 'Tested subset',
        capcut: 'Media handoff only',
        'node-video': 'Experimental',
        kinemaster: 'Media handoff only',
        'universal-bundle': 'Verified',
      },
      degradationNotes: [],
    },
    tags: ['Canonical v2.0', aspectRatio],
  };
}

/**
 * Instantiates a CatalogItem (and optional TemplateVariantInstance) into a full
 * CanonicalProjectDocument (`schemaVersion: '2.0.0'`).
 */
export function createCanonicalProjectFromTemplate(params: {
  template: CatalogItem;
  variant?: TemplateVariantInstance | null;
  ownerUid?: string;
  aspectRatio?: MobileAspectRatio;
  targetEditor?: TargetMobileEditorId;
}): CanonicalProjectDocument {
  const { template, variant } = params;
  const ownerUid = params.ownerUid || variant?.ownerUid || 'user-local';
  const aspectRatio = params.aspectRatio || '9:16';
  const dims = getDimensionsForAspectRatio(aspectRatio);
  const fps: 24 | 30 | 60 =
    template.metadata.fps === 24 || template.metadata.fps === 30
      ? template.metadata.fps
      : 60;
  const durationSec =
    variant?.timingOverrides?.durationSec || template.metadata.durationSec || 4;

  const baseParams: Record<string, string | number | boolean> = {};
  for (const p of template.editableParams || []) {
    baseParams[p.key] = p.defaultValue;
  }
  const mergedParams: Record<string, string | number | boolean> = {
    ...baseParams,
    ...(variant?.parameterOverrides || {}),
  };

  const primaryText = String(
    mergedParams.headline ||
      mergedParams.title ||
      mergedParams.label ||
      mergedParams.badgeText ||
      template.name
  );
  const accentColor =
    typeof mergedParams.accentColor === 'string' &&
    /^#[0-9A-Fa-f]{6}$/.test(mergedParams.accentColor)
      ? mergedParams.accentColor
      : '#F06424';

  const curve: [number, number, number, number] =
    variant?.timingOverrides?.easingCurve ||
    template.metadata.curvePoints || [0.22, 1, 0.36, 1];

  const baseDoc = createMinimalCanonicalProject({
    id: `proj_${template.id}_${Date.now()}`,
    ownerUid,
    title: variant?.title || variant?.name || `${template.name} Project`,
    description: variant?.description || template.summary,
    moduleId: template.moduleId,
    targetEditor: params.targetEditor || 'sowveil-project',
    aspectRatio,
    fps,
    durationSec,
  });

  const templateTrack: CanonicalTrack = {
    id: 'track_template_1',
    name: `${template.packLabel} Template Track`,
    kind: 'template',
    order: 0,
    visible: true,
    locked: false,
    muted: false,
    solo: false,
    blendMode: 'normal',
    gainDb: 0,
    clips: [
      {
        id: `clip_tpl_${template.id}`,
        trackId: 'track_template_1',
        name: template.name,
        kind: 'template-instance',
        sceneId: 'scene_1',
        sourceSegmentId: 'seg_hook_01',
        startTimeSec: variant?.timingOverrides?.startOffsetSec || 0,
        durationSec,
        sourceInSec: 0,
        sourceOutSec: durationSec,
        trimInSec: 0,
        trimOutSec: 0,
        speedMultiplier: variant?.timingOverrides?.speedMultiplier || 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        transform: {
          position: [dims.width / 2, dims.height / 2],
          scale: [1, 1],
          rotationDeg: 0,
          anchor: [0.5, 0.5],
          opacity: 1,
        },
        textData: {
          content: primaryText,
          fontFamily: 'Inter',
          fontSizePx: Number(mergedParams.fontSize) || 64,
          fontWeight: 800,
          letterSpacingEm: -0.02,
          lineHeightMultiplier: 1.15,
          colorHex: accentColor,
          alignment: 'center',
        },
        vectorData: {
          shapeType:
            template.moduleId === 'liquid-glass' ? 'liquid-glass-card' : 'rect',
          svgPathData: 'M 120 420 L 960 420 L 960 1500 L 120 1500 Z',
          fillColorHex: '#181412',
          strokeColorHex: accentColor,
          strokeWidthPx: 2,
          cornerRadiusPx: 28,
        },
        templateBinding: {
          baseTemplateId: template.id,
          baseTemplateVersion: template.metadata.version,
          variantId: variant?.id,
          moduleId: template.moduleId,
          parameterOverrides: mergedParams,
          assetSlotBindings: { ...(variant?.assetSlotBindings || variant?.assetOverrides || {}) },
          editabilityLevel:
            template.sourceType === 'original-svg-css' ||
            template.sourceType === 'procedural-canvas'
              ? 'source-proven'
              : 'parameter-rig',
        },
        keyframes: [
          {
            id: 'kf_tpl_scale_in',
            property: 'scaleX',
            timeSec: 0,
            value: 0.86,
            interpolation: 'cubic-bezier',
            cubicBezier: curve,
          },
          {
            id: 'kf_tpl_scale_settled',
            property: 'scaleX',
            timeSec: Math.min(0.6, durationSec * 0.35),
            value: 1,
            interpolation: 'cubic-bezier',
            cubicBezier: curve,
          },
          ...(variant?.keyframeOverrides || []).map((kfo, idx) => ({
            id: `kf_var_ovr_${idx + 1}`,
            property: kfo.property,
            timeSec: kfo.timeSec,
            value: kfo.value,
            interpolation: 'cubic-bezier' as CanonicalKeyframeInterpolation,
            cubicBezier: curve,
          })),
        ],
        effects: [
          {
            id: `eff_${template.moduleId}_1`,
            effectType: `${template.moduleId}-stylizer`,
            name: `${template.packLabel} Stylizer`,
            enabled: true,
            rendererSupport:
              template.moduleId === '3d-models' || template.moduleId === 'liquid-glass'
                ? 'partial-fallback'
                : 'supported',
            supportedInAlightXml:
              template.moduleId !== '3d-models' && template.moduleId !== 'liquid-glass',
            parameters: mergedParams,
          },
        ],
        masks: [],
      },
    ],
  };

  const tracks: CanonicalTrack[] = [
    templateTrack,
    ...baseDoc.tracks.map((t, i) => ({ ...t, order: i + 1 })),
  ];

  if (template.moduleId === 'sfx' || template.metadata.audioAssetAvailable) {
    const audioTrack = tracks.find((t) => t.kind === 'audio');
    if (audioTrack) {
      audioTrack.clips.push({
        id: `clip_sfx_${template.id}`,
        trackId: audioTrack.id,
        name: `${template.name} Audio Cue`,
        kind: 'audio',
        sceneId: 'scene_1',
        startTimeSec: 0,
        durationSec,
        sourceInSec: 0,
        sourceOutSec: durationSec,
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
          scale: [1, 1],
          rotationDeg: 0,
          anchor: [0.5, 0.5],
          opacity: 1,
        },
        audioConfig: {
          gainDb: 0,
          linearGain: 1,
          pan: 0,
          fadeInSec: 0.08,
          fadeOutSec: 0.15,
          muted: false,
          proceduralSfxPreset: template.slug,
          waveformPeaks: [0.15, 0.52, 0.92, 0.74, 0.48, 0.25, 0.1],
        },
        keyframes: [],
        effects: [],
        masks: [],
      });
    }
  }

  return {
    ...baseDoc,
    tracks,
    provenance: {
      originType: 'template-instantiation',
      authorUid: ownerUid,
      createdFromTemplateId: template.id,
      createdFromVariantId: variant?.id,
      licenseType: template.licenseType,
      licenseNote: template.licenseNote,
      attribution:
        typeof template.attribution === 'object'
          ? template.attribution.authorName
          : 'Sowveil Studio',
    },
    rendererRequirements: {
      minCanvasTier:
        template.moduleId === '3d-models'
          ? 'webgl-3d-experimental'
          : template.moduleId === 'liquid-glass'
          ? 'webgl-2d'
          : 'canvas-2d',
      requiresWebAudio:
        template.moduleId === 'sfx' || Boolean(template.metadata.audioAssetAvailable),
      requiresWebGL:
        template.moduleId === '3d-models' || template.moduleId === 'liquid-glass',
      requires3dPreview: template.moduleId === '3d-models',
      targetMobileEditors:
        template.editorCompatibilityMap ||
        baseDoc.rendererRequirements.targetMobileEditors,
      degradationNotes:
        template.moduleId === '3d-models'
          ? [
              '3D model primitives render as 2.5D perspective wireframe/shaded projection on mobile 2D canvas.',
            ]
          : [],
    },
    tags: [...new Set([template.packLabel, ...template.tags, aspectRatio])],
  };
}

/**
 * Migrates any legacy v1.0.0 / v2.4.0-mobile `SowveilProjectDocument`, `MotionDocument`,
 * or `ProjectLibraryItem` into a validated `CanonicalProjectDocument` (`schemaVersion: '2.0.0'`).
 * Preserves unknown top-level and layer fields in `unknownProperties`.
 */
export function migrateToCanonicalProject(
  rawInput: unknown,
  ownerUidFallback = 'user-local'
): {
  migrated: boolean;
  fromVersion: LegacyProjectSchemaVersion | '2.0.0';
  project: CanonicalProjectDocument;
  warnings: string[];
} {
  const warnings: string[] = [];
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('MIGRATION_ERROR: Input project payload must be a JSON object.');
  }

  const raw = rawInput as Record<string, unknown>;

  // Case 1: Already a CanonicalProjectDocument ('sowveil-canonical-project' v2.0.0)
  if (
    raw.format === 'sowveil-canonical-project' &&
    raw.schemaVersion === '2.0.0'
  ) {
    const check = validateCanonicalProject(raw);
    if (!check.valid || !check.project) {
      throw new Error(
        `MIGRATION_VALIDATION_FAILED: ${check.errors.join('; ')}`
      );
    }
    return {
      migrated: false,
      fromVersion: '2.0.0',
      project: check.project,
      warnings: check.warnings,
    };
  }

  // Case 2: Legacy `SowveilProjectDocument` or `MotionDocument` (`1.0.0`, `2.0.0`, or `2.4.0-mobile` with `composition` + `layers`)
  if (raw.composition && typeof raw.composition === 'object') {
    const comp = raw.composition as Record<string, unknown>;
    const rawVersion = String(raw.schemaVersion || '1.0.0');
    const fromVersion: LegacyProjectSchemaVersion =
      rawVersion === '2.4.0-mobile' ? '2.4.0-mobile' : '1.0.0';

    const aspectRatio: MobileAspectRatio =
      comp.aspectRatio === '1:1' || comp.aspectRatio === '16:9'
        ? comp.aspectRatio
        : '9:16';
    const dims = getDimensionsForAspectRatio(aspectRatio);
    const width = Number(comp.width) > 0 ? Number(comp.width) : dims.width;
    const height = Number(comp.height) > 0 ? Number(comp.height) : dims.height;
    const rawFps = Number(comp.fps) || 60;
    const fps: 24 | 30 | 60 = rawFps === 24 ? 24 : rawFps === 30 ? 30 : 60;
    const durationSec = Math.max(0.5, Number(comp.durationSec) || 4);
    const now = new Date().toISOString();

    const cubicBezier: [number, number, number, number] =
      raw.easing &&
      typeof raw.easing === 'object' &&
      Array.isArray((raw.easing as Record<string, unknown>).cubicBezier) &&
      ((raw.easing as Record<string, unknown>).cubicBezier as unknown[]).length === 4
        ? ((raw.easing as Record<string, unknown>).cubicBezier as [
            number,
            number,
            number,
            number,
          ])
        : [0.22, 1, 0.36, 1];

    const legacyLayers = Array.isArray(raw.layers) ? raw.layers : [];
    const unsupportedFeatures: CanonicalUnsupportedFeatureRecord[] = [];
    const tracksByKind = new Map<CanonicalTrackKind, CanonicalTrack>();

    const getOrCreateTrack = (
      kind: CanonicalTrackKind,
      label: string
    ): CanonicalTrack => {
      const existing = tracksByKind.get(kind);
      if (existing) return existing;
      const track: CanonicalTrack = {
        id: `track_${kind}_${tracksByKind.size + 1}`,
        name: label,
        kind,
        order: tracksByKind.size,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        gainDb: 0,
        clips: [],
      };
      tracksByKind.set(kind, track);
      return track;
    };

    legacyLayers.forEach((lRaw, idx) => {
      if (!lRaw || typeof lRaw !== 'object') return;
      const l = lRaw as Record<string, unknown>;
      const layerType = String(l.type || 'vector');
      const inSec = Math.max(0, Number(l.inPointSec) || 0);
      const outSec = Math.max(inSec + 0.25, Number(l.outPointSec) || durationSec);
      const clipDur = Number((outSec - inSec).toFixed(3));

      let trackKind: CanonicalTrackKind = 'vector';
      let clipKind: CanonicalClipKind = 'vector';
      if (layerType === 'text') {
        trackKind = 'text';
        clipKind = 'text';
      } else if (layerType === 'audio') {
        trackKind = 'audio';
        clipKind = 'audio';
      } else if (layerType === 'caption') {
        trackKind = 'caption';
        clipKind = 'caption';
      } else if (layerType === 'camera-25d') {
        trackKind = 'camera3d';
        clipKind = 'camera-3d';
        unsupportedFeatures.push({
          id: `uf_cam_${idx + 1}`,
          featureKey: 'camera-25d',
          sourceFormat: `sowveil-${fromVersion}`,
          severity: 'info',
          fallbackBehavior: 'approximated-2d',
          message:
            '2.5D camera layer migrated to camera3d track; 2D mobile preview approximates parallax.',
        });
      }

      const targetTrack = getOrCreateTrack(
        trackKind,
        `${trackKind.toUpperCase()} Track`
      );

      const rawTransform =
        l.transform && typeof l.transform === 'object'
          ? (l.transform as Record<string, unknown>)
          : {};
      const pos: [number, number] = Array.isArray(rawTransform.position)
        ? [
            Number(rawTransform.position[0]) || width / 2,
            Number(rawTransform.position[1]) || height / 2,
          ]
        : [width / 2, height / 2];
      const rawScale: [number, number] = Array.isArray(rawTransform.scale)
        ? [
            Number(rawTransform.scale[0]) || 1,
            Number(rawTransform.scale[1]) || 1,
          ]
        : [1, 1];
      // Normalize legacy 0..100 scale or opacity into 0..1 when needed
      const normalizedScale: [number, number] =
        rawScale[0] > 10 && rawScale[1] > 10
          ? [Number((rawScale[0] / 100).toFixed(3)), Number((rawScale[1] / 100).toFixed(3))]
          : rawScale;

      const rawOpacity =
        typeof l.opacity === 'number'
          ? l.opacity
          : typeof rawTransform.opacity === 'number'
          ? rawTransform.opacity
          : 1;
      const normalizedOpacity =
        rawOpacity > 1
          ? Math.min(1, Math.max(0, Number((rawOpacity / 100).toFixed(3))))
          : Math.min(1, Math.max(0, rawOpacity));

      const clipId = String(l.id || `clip_migrated_${idx + 1}`);
      const clipName = String(l.name || `Layer ${idx + 1}`);

      const effects: CanonicalEffectInstance[] = Array.isArray(l.effects)
        ? l.effects.map((effRaw, eIdx) => {
            const eff =
              effRaw && typeof effRaw === 'object'
                ? (effRaw as Record<string, unknown>)
                : {};
            return {
              id: String(eff.id || `eff_${clipId}_${eIdx + 1}`),
              effectType: String(eff.type || 'custom-effect'),
              name: String(eff.type || 'Effect'),
              enabled: true,
              rendererSupport:
                eff.supportedInAlightXml === false ? 'partial-fallback' : 'supported',
              supportedInAlightXml: Boolean(eff.supportedInAlightXml ?? true),
              parameters:
                eff.parameters && typeof eff.parameters === 'object'
                  ? (eff.parameters as Record<string, string | number | boolean>)
                  : {},
            };
          })
        : [];

      const clip: CanonicalClip = {
        id: clipId,
        trackId: targetTrack.id,
        name: clipName,
        kind: clipKind,
        sceneId: 'scene_1',
        startTimeSec: inSec,
        durationSec: clipDur,
        sourceInSec: 0,
        sourceOutSec: clipDur,
        trimInSec: 0,
        trimOutSec: 0,
        speedMultiplier: 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        transform: {
          position: pos,
          scale: normalizedScale,
          rotationDeg: Number(rawTransform.rotationDeg) || 0,
          anchor: [0.5, 0.5],
          opacity: normalizedOpacity,
        },
        ...(clipKind === 'text'
          ? {
              textData: {
                content: String(l.textContent || comp.title || clipName),
                fontFamily: 'Inter',
                fontSizePx: 64,
                fontWeight: 800,
                letterSpacingEm: -0.02,
                lineHeightMultiplier: 1.15,
                colorHex: String(l.colorHex || '#F3EEE8'),
                alignment: 'center',
              },
            }
          : {}),
        ...(clipKind === 'vector'
          ? {
              vectorData: {
                shapeType: 'rect',
                svgPathData: 'M 100 100 L 980 100 L 980 1820 L 100 1820 Z',
                fillColorHex: String(l.colorHex || '#F06424'),
                strokeColorHex: '#F3EEE8',
                strokeWidthPx: 2,
                cornerRadiusPx: 24,
              },
            }
          : {}),
        ...(clipKind === 'audio'
          ? {
              audioConfig: {
                gainDb: 0,
                linearGain: 1,
                pan: 0,
                fadeInSec: 0.05,
                fadeOutSec: 0.1,
                muted: false,
              },
            }
          : {}),
        keyframes: [
          {
            id: `kf_${clipId}_in`,
            property: 'opacity',
            timeSec: inSec,
            value: normalizedOpacity,
            interpolation: 'cubic-bezier',
            cubicBezier,
          },
        ],
        effects,
        masks: [],
      };

      targetTrack.clips.push(clip);
    });

    if (tracksByKind.size === 0) {
      const fallbackTrack = getOrCreateTrack('text', 'Primary Title Track');
      fallbackTrack.clips.push({
        id: 'clip_migrated_default',
        trackId: fallbackTrack.id,
        name: String(comp.title || 'Migrated Layer'),
        kind: 'text',
        sceneId: 'scene_1',
        startTimeSec: 0,
        durationSec,
        sourceInSec: 0,
        sourceOutSec: durationSec,
        trimInSec: 0,
        trimOutSec: 0,
        speedMultiplier: 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        transform: {
          position: [width / 2, height / 2],
          scale: [1, 1],
          rotationDeg: 0,
          anchor: [0.5, 0.5],
          opacity: 1,
        },
        textData: {
          content: String(
            (raw.parameters &&
            typeof raw.parameters === 'object' &&
            !Array.isArray(raw.parameters) &&
            (raw.parameters as Record<string, unknown>).headline
              ? (raw.parameters as Record<string, unknown>).headline
              : null) ||
              comp.title ||
              'Migrated Title'
          ),
          fontFamily: 'Inter',
          fontSizePx: 64,
          fontWeight: 800,
          letterSpacingEm: -0.02,
          lineHeightMultiplier: 1.15,
          colorHex: '#F3EEE8',
          alignment: 'center',
        },
        keyframes: [],
        effects: [],
        masks: [],
      });
    }

    const legacyKnown = new Set([
      'format',
      'schemaVersion',
      'generator',
      'documentId',
      'createdAt',
      'exportedAt',
      'targetEditor',
      'composition',
      'parameters',
      'easing',
      'layers',
      'assets',
      'audioReferences',
      'unknownFields',
    ]);
    const preservedUnknown: Record<string, unknown> = {
      ...(raw.unknownFields && typeof raw.unknownFields === 'object'
        ? (raw.unknownFields as Record<string, unknown>)
        : {}),
    };
    for (const [k, v] of Object.entries(raw)) {
      if (!legacyKnown.has(k)) {
        preservedUnknown[k] = v;
      }
    }

    const migratedDoc: CanonicalProjectDocument = {
      format: 'sowveil-canonical-project',
      schemaVersion: '2.0.0',
      migratedFromVersion: fromVersion,
      id: String(raw.documentId || comp.id || `proj_migrated_${Date.now()}`),
      ownerUid: String(raw.ownerUid || ownerUidFallback),
      title: String(comp.title || 'Migrated Sowveil Project'),
      description: String(
        raw.description ||
          `Migrated from legacy ${fromVersion} Sowveil project document.`
      ),
      moduleId: (comp.moduleId as ModuleId) || 'text-animation',
      targetEditor:
        (raw.targetEditor as TargetMobileEditorId) || 'sowveil-project',
      revision: 1,
      activeBranch: 'main',
      createdAt: String(raw.createdAt || raw.exportedAt || now),
      updatedAt: now,
      canvas: {
        width,
        height,
        aspectRatio,
        fps,
        timebaseTicksPerSec: fps * 1000,
        durationSec,
        backgroundColorHex:
          typeof comp.backgroundColorHex === 'string' &&
          /^#[0-9A-Fa-f]{6}$/.test(comp.backgroundColorHex)
            ? comp.backgroundColorHex
            : '#0B0A09',
        backgroundAlphaMode:
          comp.backgroundMode === 'transparent' ||
          comp.backgroundMode === 'chroma-key-green'
            ? comp.backgroundMode
            : 'solid',
      },
      scenes: [
        {
          id: 'scene_1',
          title: String(comp.title || 'Scene 1'),
          order: 0,
          startTimeSec: 0,
          durationSec,
          scriptSegmentIds: ['seg_migrated_01'],
          status: 'draft',
        },
      ],
      tracks: Array.from(tracksByKind.values()),
      markers: [],
      assetReferences: Array.isArray(raw.assets)
        ? raw.assets.map((aRaw, aIdx) => {
            const a =
              aRaw && typeof aRaw === 'object'
                ? (aRaw as Record<string, unknown>)
                : {};
            return {
              assetId: String(a.id || `asset_mig_${aIdx + 1}`),
              title: String(a.fileName || `Asset ${aIdx + 1}`),
              role: 'primary-media' as const,
              mimeType: String(a.mimeType || 'application/octet-stream'),
              required: true,
              missing: false,
              licenseType: 'Sowveil Original' as const,
            };
          })
        : [],
      dependencies: [],
      provenance: {
        originType: 'migrated-legacy-v1',
        authorUid: String(raw.ownerUid || ownerUidFallback),
        licenseType: 'User Owned',
        licenseNote: `Migrated from schemaVersion ${fromVersion}`,
        attribution: 'Sowveil Studio Migration Engine',
      },
      aiEditHistory: [],
      snapshots: [],
      branches: [
        {
          name: 'main',
          headRevision: 1,
          createdFromRevision: 1,
          createdAt: now,
        },
      ],
      unsupportedFeatures,
      rendererRequirements: {
        minCanvasTier: 'canvas-2d',
        requiresWebAudio: tracksByKind.has('audio'),
        requiresWebGL: false,
        requires3dPreview: tracksByKind.has('camera3d'),
        targetMobileEditors: {
          'sowveil-project': 'Verified',
          'alight-motion': 'Tested subset',
        },
        degradationNotes: [],
      },
      tags: ['Migrated', `from-${fromVersion}`],
      ...(Object.keys(preservedUnknown).length > 0
        ? { unknownProperties: preservedUnknown }
        : {}),
    };

    const validated = validateCanonicalProject(migratedDoc);
    if (!validated.valid || !validated.project) {
      throw new Error(
        `MIGRATION_OUTPUT_INVALID: ${validated.errors.join('; ')}`
      );
    }

    return {
      migrated: true,
      fromVersion,
      project: validated.project,
      warnings: [...warnings, ...validated.warnings],
    };
  }

  // Case 3: A `ProjectLibraryItem` wrapper with `canonicalProjectJson` or `sowveilSpecJson`
  if (typeof raw.canonicalProjectJson === 'string' && raw.canonicalProjectJson.trim()) {
    const parsedInner = JSON.parse(raw.canonicalProjectJson);
    return migrateToCanonicalProject(parsedInner, String(raw.ownerUid || ownerUidFallback));
  }
  if (typeof raw.sowveilSpecJson === 'string' && raw.sowveilSpecJson.trim()) {
    const parsedInner = JSON.parse(raw.sowveilSpecJson);
    return migrateToCanonicalProject(parsedInner, String(raw.ownerUid || ownerUidFallback));
  }

  // Case 4: Legacy AI Director v1.0.0 TimelineProject (`timeline.tracks`, `canvas`, `captionCues`, `markers`)
  if (raw.timeline && typeof raw.timeline === 'object') {
    const rawCanvas =
      raw.canvas && typeof raw.canvas === 'object'
        ? (raw.canvas as Record<string, unknown>)
        : {};
    const aspectRatio: MobileAspectRatio =
      rawCanvas.aspectRatio === '1:1' || rawCanvas.aspectRatio === '16:9'
        ? rawCanvas.aspectRatio
        : '9:16';
    const dims = getDimensionsForAspectRatio(aspectRatio);
    const width = Number(rawCanvas.width) > 0 ? Number(rawCanvas.width) : dims.width;
    const height = Number(rawCanvas.height) > 0 ? Number(rawCanvas.height) : dims.height;
    const rawFps = Number(rawCanvas.fps) || 60;
    const fps: 24 | 30 | 60 = rawFps === 24 ? 24 : rawFps === 30 ? 30 : 60;
    const durationSec = Math.max(0.5, Number(rawCanvas.durationSec) || 4);

    const minimal = createMinimalCanonicalProject({
      id: String(raw.id || `proj_${Date.now()}`),
      ownerUid: String(raw.ownerUid || raw.ownerId || ownerUidFallback),
      title: String(raw.title || 'Migrated Timeline Project'),
      description: String(raw.description || ''),
      targetEditor: (raw.targetEditor as TargetMobileEditorId) || 'sowveil-project',
      aspectRatio,
      fps,
      durationSec,
    });
    minimal.canvas.width = width;
    minimal.canvas.height = height;
    minimal.migratedFromVersion = '1.0.0';

    if (Array.isArray(raw.markers)) {
      minimal.markers = raw.markers
        .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
        .map((m, idx) => ({
          id: String(m.id || `mk_mig_${idx + 1}`),
          timeSec: Math.max(0, Number(m.timeSec) || 0),
          label: String(m.label || `Marker ${idx + 1}`),
          colorHex: String(m.colorHex || '#F06424'),
          kind: 'beat' as const,
        }));
    }

    if (Array.isArray(raw.captionCues) && raw.captionCues.length > 0) {
      const capTrack = minimal.tracks.find((t) => t.kind === 'caption');
      if (capTrack) {
        capTrack.clips = raw.captionCues
          .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
          .map((c, idx) => {
            const start = Math.max(0, Number(c.startSec) || 0);
            const end = Math.max(start + 0.25, Number(c.endSec) || start + 2);
            const dur = Number((end - start).toFixed(3));
            return {
              id: String(c.id || `clip_cap_mig_${idx + 1}`),
              trackId: capTrack.id,
              name: `Cue #${idx + 1}`,
              kind: 'caption' as const,
              startTimeSec: start,
              durationSec: dur,
              sourceInSec: 0,
              sourceOutSec: dur,
              trimInSec: 0,
              trimOutSec: 0,
              speedMultiplier: 1,
              visible: true,
              locked: false,
              muted: false,
              solo: false,
              blendMode: 'normal' as const,
              transform: {
                position: [width / 2, height * 0.82],
                scale: [1, 1],
                rotationDeg: 0,
                anchor: [0.5, 0.5],
                opacity: 1,
              },
              captionData: {
                cueIndex: idx + 1,
                text: String(c.text || ''),
                speaker: c.speaker ? String(c.speaker) : undefined,
                stylePresetId: 'hormozi-highlight',
                highlightColorHex: '#F06424',
                maxCharsPerLine: 36,
              },
              keyframes: [],
              effects: [],
              masks: [],
            };
          });
      }
    }

    return {
      migrated: true,
      fromVersion: '1.0.0',
      project: minimal,
      warnings: ['Migrated legacy v1.0.0 TimelineProject into canonical v2.0.0 project.'],
    };
  }

  // Fallback for metadata-only `ProjectLibraryItem`
  const minimal = createMinimalCanonicalProject({
    id: String(raw.id || `proj_${Date.now()}`),
    ownerUid: String(raw.ownerUid || ownerUidFallback),
    title: String(raw.title || 'Migrated Project Record'),
    description: String(raw.description || ''),
    targetEditor:
      (raw.targetEditor as TargetMobileEditorId) || 'sowveil-project',
    aspectRatio:
      raw.aspectRatio === '1:1' || raw.aspectRatio === '16:9'
        ? raw.aspectRatio
        : '9:16',
  });
  minimal.migratedFromVersion = '1.0.0';
  return {
    migrated: true,
    fromVersion: '1.0.0',
    project: minimal,
    warnings: ['Upgraded metadata-only project record into canonical v2.0.0 project.'],
  };
}

/**
 * Bridges a CanonicalProjectDocument to the Mobile Editor Gateway's `MotionDocument`
 * and legacy `SowveilProjectDocument` so all export adapters use the canonical schema.
 */
export function canonicalProjectToPortableMotionDocument(
  project: CanonicalProjectDocument
): MotionDocument {
  const orderedTracks = [...project.tracks].sort((a, b) => a.order - b.order);
  const layers: MotionDocument['layers'] = [];

  for (const track of orderedTracks) {
    if (!track.visible || track.muted) continue;
    for (const clip of track.clips) {
      if (!clip.visible || clip.muted) continue;
      const firstBezier =
        clip.keyframes.find((k) => k.cubicBezier)?.cubicBezier || [
          0.22, 1, 0.36, 1,
        ];
      layers.push({
        id: clip.id,
        name: clip.name,
        type:
          clip.kind === 'text'
            ? 'text'
            : clip.kind === 'audio'
            ? 'audio'
            : clip.kind === 'caption'
            ? 'caption'
            : clip.kind === 'camera-3d'
            ? 'camera-25d'
            : 'vector',
        inPointSec: clip.startTimeSec,
        outPointSec: Number((clip.startTimeSec + clip.durationSec).toFixed(3)),
        transform: {
          position: clip.transform.position,
          scale: clip.transform.scale,
          rotationDeg: clip.transform.rotationDeg,
          anchor: clip.transform.anchor,
        },
        opacity: clip.transform.opacity,
        colorHex:
          clip.textData?.colorHex ||
          clip.vectorData?.fillColorHex ||
          '#F06424',
        textContent:
          clip.textData?.content || clip.captionData?.text || undefined,
        easingCurve: firstBezier,
        effects: clip.effects
          .filter((e) => e.enabled)
          .map((e) => ({
            id: e.id,
            type: e.effectType,
            supportedInAlightXml: e.supportedInAlightXml,
            parameters: e.parameters,
          })),
      });
    }
  }

  if (layers.length === 0) {
    layers.push({
      id: 'layer_empty_fallback',
      name: project.title,
      type: 'text',
      inPointSec: 0,
      outPointSec: project.canvas.durationSec,
      transform: {
        position: [project.canvas.width / 2, project.canvas.height / 2],
        scale: [1, 1],
        rotationDeg: 0,
        anchor: [0.5, 0.5],
      },
      opacity: 1,
      colorHex: '#F3EEE8',
      textContent: project.title,
      easingCurve: [0.22, 1, 0.36, 1],
      effects: [],
    });
  }

  return {
    schemaVersion: '2.0.0',
    generator: 'Sowveil Studio Mobile Motion Engine',
    documentId: project.id,
    createdAt: project.updatedAt,
    targetEditor: project.targetEditor,
    composition: {
      id: project.id,
      title: project.title,
      moduleId: project.moduleId,
      aspectRatio: project.canvas.aspectRatio,
      width: project.canvas.width,
      height: project.canvas.height,
      fps: project.canvas.fps,
      durationSec: project.canvas.durationSec,
      backgroundMode: project.canvas.backgroundAlphaMode,
      backgroundColorHex: project.canvas.backgroundColorHex,
    },
    parameters: {
      revision: project.revision,
      activeBranch: project.activeBranch,
    },
    easing: {
      cubicBezier: [0.22, 1, 0.36, 1],
    },
    layers,
    assets: project.assetReferences.map((a) => ({
      id: a.assetId,
      role:
        a.role === 'audio-sfx'
          ? 'audio-sfx'
          : a.role === 'caption-sidecar'
          ? 'caption-sidecar'
          : 'primary-vector',
      fileName: a.title,
      mimeType: a.mimeType,
      origin: 'sowveil-procedural',
      license: a.licenseType,
    })),
    audioReferences: [],
    ...(project.unknownProperties
      ? { unknownFields: project.unknownProperties }
      : {}),
  };
}

export function canonicalProjectToLegacySowveilDocument(
  project: CanonicalProjectDocument
): SowveilProjectDocument {
  const portable = canonicalProjectToPortableMotionDocument(project);
  return {
    format: 'sowveil-mobile-project',
    schemaVersion: '2.0.0',
    generator: portable.generator,
    exportedAt: project.updatedAt,
    targetEditor: project.targetEditor,
    composition: {
      id: portable.composition.id,
      title: portable.composition.title,
      moduleId: portable.composition.moduleId,
      aspectRatio: portable.composition.aspectRatio,
      width: portable.composition.width,
      height: portable.composition.height,
      fps: portable.composition.fps,
      durationSec: portable.composition.durationSec,
    },
    parameters: portable.parameters,
    easing: portable.easing,
    layers: portable.layers.map((l) => ({
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

// ============================================================================
// KEYFRAME INTERPOLATION & TIMELINE EVALUATOR
// ============================================================================

export function evaluateCubicBezier(
  t: number,
  curve: [number, number, number, number]
): number {
  const clamped = Math.max(0, Math.min(1, t));
  const [, y1, , y2] = curve;
  const u = 1 - clamped;
  // Cubic Bezier approximation for y(t)
  return (
    3 * u * u * clamped * y1 +
    3 * u * clamped * clamped * y2 +
    clamped * clamped * clamped
  );
}

export function interpolateKeyframeProperty(
  keyframes: CanonicalKeyframe[],
  property: string,
  localTimeSec: number,
  defaultValue: number
): number {
  const numericKfs = keyframes
    .filter((k) => k.property === property && typeof k.value === 'number')
    .sort((a, b) => a.timeSec - b.timeSec);

  if (numericKfs.length === 0) return defaultValue;
  if (localTimeSec <= numericKfs[0].timeSec) {
    return Number(numericKfs[0].value);
  }
  const last = numericKfs[numericKfs.length - 1];
  if (localTimeSec >= last.timeSec) {
    return Number(last.value);
  }

  for (let i = 0; i < numericKfs.length - 1; i++) {
    const left = numericKfs[i];
    const right = numericKfs[i + 1];
    if (localTimeSec >= left.timeSec && localTimeSec <= right.timeSec) {
      if (left.interpolation === 'hold' || right.timeSec === left.timeSec) {
        return Number(left.value);
      }
      const span = right.timeSec - left.timeSec;
      const rawProgress = (localTimeSec - left.timeSec) / span;
      let eased = rawProgress;
      if (left.interpolation === 'ease-in') {
        eased = rawProgress * rawProgress;
      } else if (left.interpolation === 'ease-out') {
        eased = 1 - (1 - rawProgress) * (1 - rawProgress);
      } else if (left.interpolation === 'ease-in-out') {
        eased =
          rawProgress < 0.5
            ? 2 * rawProgress * rawProgress
            : 1 - Math.pow(-2 * rawProgress + 2, 2) / 2;
      } else if (left.interpolation === 'cubic-bezier') {
        eased = evaluateCubicBezier(
          rawProgress,
          left.cubicBezier || [0.22, 1, 0.36, 1]
        );
      }
      const v0 = Number(left.value);
      const v1 = Number(right.value);
      return Number((v0 + (v1 - v0) * eased).toFixed(4));
    }
  }
  return defaultValue;
}

export interface EvaluatedClipFrame {
  clip: CanonicalClip;
  track: CanonicalTrack;
  localTimeSec: number;
  transform: CanonicalTransform2D;
  effectiveAudioGainDb: number;
}

export function evaluateProjectAtTime(
  project: CanonicalProjectDocument,
  playheadSec: number
): EvaluatedClipFrame[] {
  const anyTrackSolo = project.tracks.some((t) => t.solo);
  const orderedTracks = [...project.tracks].sort((a, b) => b.order - a.order);
  const results: EvaluatedClipFrame[] = [];

  for (const track of orderedTracks) {
    if (!track.visible) continue;
    if (anyTrackSolo && !track.solo) continue;
    if (track.muted && track.kind === 'audio') continue;

    const anyClipSolo = track.clips.some((c) => c.solo);
    for (const clip of track.clips) {
      if (!clip.visible) continue;
      if (anyClipSolo && !clip.solo) continue;
      if (clip.muted && clip.kind === 'audio') continue;

      const clipEnd = clip.startTimeSec + clip.durationSec;
      if (playheadSec < clip.startTimeSec || playheadSec > clipEnd) {
        continue;
      }

      const localTimeSec = Math.max(0, playheadSec - clip.startTimeSec);
      const posX = interpolateKeyframeProperty(
        clip.keyframes,
        'positionX',
        playheadSec,
        clip.transform.position[0]
      );
      const posY = interpolateKeyframeProperty(
        clip.keyframes,
        'positionY',
        playheadSec,
        clip.transform.position[1]
      );
      const scaleX = interpolateKeyframeProperty(
        clip.keyframes,
        'scaleX',
        playheadSec,
        clip.transform.scale[0]
      );
      const scaleY = interpolateKeyframeProperty(
        clip.keyframes,
        'scaleY',
        playheadSec,
        clip.transform.scale[1]
      );
      const rotationDeg = interpolateKeyframeProperty(
        clip.keyframes,
        'rotationDeg',
        playheadSec,
        clip.transform.rotationDeg
      );
      let opacity = interpolateKeyframeProperty(
        clip.keyframes,
        'opacity',
        playheadSec,
        clip.transform.opacity
      );

      // Apply transition envelopes if present
      if (
        clip.inTransition &&
        clip.inTransition.durationSec > 0 &&
        localTimeSec < clip.inTransition.durationSec
      ) {
        const tProg = localTimeSec / clip.inTransition.durationSec;
        opacity *= Math.max(0, Math.min(1, tProg));
      }
      const remSec = clip.durationSec - localTimeSec;
      if (
        clip.outTransition &&
        clip.outTransition.durationSec > 0 &&
        remSec < clip.outTransition.durationSec
      ) {
        const tProg = remSec / clip.outTransition.durationSec;
        opacity *= Math.max(0, Math.min(1, tProg));
      }

      const baseGainDb =
        (clip.audioConfig?.gainDb ?? 0) + (track.gainDb ?? 0);
      const effectiveAudioGainDb = interpolateKeyframeProperty(
        clip.keyframes,
        'audioGainDb',
        playheadSec,
        baseGainDb
      );

      results.push({
        clip,
        track,
        localTimeSec,
        transform: {
          position: [posX, posY],
          scale: [scaleX, scaleY],
          rotationDeg,
          anchor: clip.transform.anchor,
          opacity: Math.max(0, Math.min(1, Number(opacity.toFixed(4)))),
        },
        effectiveAudioGainDb,
      });
    }
  }

  return results;
}

// ============================================================================
// TYPED COMMAND ENGINE (SHARED BY MANUAL PRO EDITOR & AI DIRECTOR)
// ============================================================================

function collectAllEntityIds(project: CanonicalProjectDocument): Set<string> {
  const ids = new Set<string>();
  for (const s of project.scenes) ids.add(s.id);
  for (const m of project.markers) ids.add(m.id);
  for (const t of project.tracks) {
    ids.add(t.id);
    for (const c of t.clips) {
      ids.add(c.id);
      for (const kf of c.keyframes) ids.add(kf.id);
      for (const eff of c.effects) ids.add(eff.id);
      for (const mask of c.masks) ids.add(mask.id);
    }
  }
  return ids;
}

function findClipAndTrack(
  project: CanonicalProjectDocument,
  clipId: string
): { track: CanonicalTrack; clip: CanonicalClip; clipIndex: number } | null {
  for (const track of project.tracks) {
    const idx = track.clips.findIndex((c) => c.id === clipId);
    if (idx >= 0) {
      return { track, clip: track.clips[idx], clipIndex: idx };
    }
  }
  return null;
}

function recomputeCanvasDurationIfNeeded(project: CanonicalProjectDocument): void {
  let maxEnd = project.canvas.durationSec;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const end = Number((clip.startTimeSec + clip.durationSec).toFixed(3));
      if (end > maxEnd) maxEnd = end;
    }
  }
  project.canvas.durationSec = maxEnd;
}

function checkClipSceneLock(
  project: CanonicalProjectDocument,
  clip: CanonicalClip
): string | null {
  if (!clip.sceneId) return null;
  const scene = project.scenes.find((s) => s.id === clip.sceneId);
  if (scene && scene.status === 'locked') {
    return `LOCKED_SCENE: Scene "${scene.title}" (${scene.id}) is locked.`;
  }
  return null;
}

/**
 * Executes a single typed CanonicalProjectCommand against a CanonicalProjectDocument.
 * Returns the updated immutable document and a structured `ProjectCommandReceipt`.
 */
export function executeProjectCommand(
  currentProject: CanonicalProjectDocument,
  command: CanonicalProjectCommand,
  actorContext?: Partial<CommandActorContext>
): {
  project: CanonicalProjectDocument;
  receipt: ProjectCommandReceipt;
} {
  const now = new Date().toISOString();
  const actorId = actorContext?.actorId || currentProject.ownerUid || 'user-local';
  const actorKind = actorContext?.actorKind || 'user';
  const rationale =
    actorContext?.rationale || `Executed ${command.type} via ${actorKind}`;
  const beforeRevision = currentProject.revision;

  const failReceipt = (errorMsg: string): {
    project: CanonicalProjectDocument;
    receipt: ProjectCommandReceipt;
  } => ({
    project: currentProject,
    receipt: {
      ok: false,
      commandType: command.type,
      projectId: currentProject.id,
      beforeRevision,
      revision: beforeRevision,
      changedIds: [],
      warnings: [],
      errors: [errorMsg],
      undoRef: null,
      reversible: false,
      irreversibleReason: `Command rejected before state change: ${errorMsg}`,
      actorKind,
      rationale,
      timestamp: now,
    },
  });

  // Deep clone so failed commands or caller references never mutate in place
  const next: CanonicalProjectDocument = JSON.parse(
    JSON.stringify(currentProject)
  );
  const existingIds = collectAllEntityIds(next);
  const changedIds: string[] = [];
  const warnings: string[] = [];

  // Enforce scene lock on any clip-targeting command
  if ('clipId' in command && typeof command.clipId === 'string') {
    const targetFound = findClipAndTrack(next, command.clipId);
    if (targetFound) {
      const sceneLockErr = checkClipSceneLock(next, targetFound.clip);
      if (sceneLockErr) {
        return failReceipt(sceneLockErr);
      }
    }
  }

  switch (command.type) {
    case 'createTrack': {
      const trackId =
        command.trackId || `track_${command.kind}_${Date.now()}_${next.tracks.length + 1}`;
      if (existingIds.has(trackId)) {
        return failReceipt(`DUPLICATE_ID: Track ID "${trackId}" already exists.`);
      }
      if (!command.name || !command.name.trim()) {
        return failReceipt('INVALID_INPUT: Track name cannot be empty.');
      }
      const order =
        command.order !== undefined ? Math.max(0, command.order) : next.tracks.length;
      const newTrack: CanonicalTrack = {
        id: trackId,
        name: command.name.trim(),
        kind: command.kind,
        order,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        gainDb: 0,
        clips: [],
      };
      next.tracks.push(newTrack);
      next.tracks.sort((a, b) => a.order - b.order);
      changedIds.push(trackId);
      break;
    }

    case 'setTrackState': {
      const track = next.tracks.find((t) => t.id === command.trackId);
      if (!track) {
        return failReceipt(`TARGET_NOT_FOUND: Track "${command.trackId}" not found.`);
      }
      if (command.name !== undefined) track.name = command.name.trim() || track.name;
      if (command.visible !== undefined) track.visible = command.visible;
      if (command.locked !== undefined) track.locked = command.locked;
      if (command.muted !== undefined) track.muted = command.muted;
      if (command.solo !== undefined) track.solo = command.solo;
      if (command.blendMode !== undefined) track.blendMode = command.blendMode;
      if (command.gainDb !== undefined) {
        if (command.gainDb < -60 || command.gainDb > 24) {
          return failReceipt('INVALID_RANGE: Track gainDb must be between -60 and +24 dB.');
        }
        track.gainDb = command.gainDb;
      }
      if (command.order !== undefined) {
        track.order = Math.max(0, command.order);
        next.tracks.sort((a, b) => a.order - b.order);
      }
      changedIds.push(track.id);
      break;
    }

    case 'createClip': {
      const track = next.tracks.find((t) => t.id === command.trackId);
      if (!track) {
        return failReceipt(`TARGET_NOT_FOUND: Track "${command.trackId}" not found.`);
      }
      if (track.locked) {
        return failReceipt(`LOCKED_TARGET: Track "${track.name}" is locked.`);
      }
      const clipId =
        command.clip.id ||
        `clip_${command.clip.kind}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      if (existingIds.has(clipId)) {
        return failReceipt(`DUPLICATE_ID: Entity ID "${clipId}" already exists in project.`);
      }
      if (command.clip.startTimeSec < 0 || command.clip.durationSec <= 0) {
        return failReceipt(
          'INVALID_RANGE: Clip startTimeSec must be >= 0 and durationSec must be > 0.'
        );
      }
      const dur = Number(command.clip.durationSec.toFixed(3));
      const newClip: CanonicalClip = {
        id: clipId,
        trackId: track.id,
        name: command.clip.name.trim() || 'Untitled Clip',
        kind: command.clip.kind,
        sceneId: command.clip.sceneId || next.scenes[0]?.id,
        sourceSegmentId: command.clip.sourceSegmentId,
        startTimeSec: Number(command.clip.startTimeSec.toFixed(3)),
        durationSec: dur,
        sourceInSec: command.clip.sourceInSec ?? 0,
        sourceOutSec: command.clip.sourceOutSec ?? dur,
        trimInSec: command.clip.trimInSec ?? 0,
        trimOutSec: command.clip.trimOutSec ?? 0,
        speedMultiplier: command.clip.speedMultiplier ?? 1,
        visible: command.clip.visible ?? true,
        locked: command.clip.locked ?? false,
        muted: command.clip.muted ?? false,
        solo: command.clip.solo ?? false,
        blendMode: command.clip.blendMode ?? 'normal',
        transform: command.clip.transform || {
          position: [next.canvas.width / 2, next.canvas.height / 2],
          scale: [1, 1],
          rotationDeg: 0,
          anchor: [0.5, 0.5],
          opacity: 1,
        },
        assetId: command.clip.assetId,
        assetSlotBindings: command.clip.assetSlotBindings,
        textData:
          command.clip.textData ||
          (command.clip.kind === 'text'
            ? {
                content: command.clip.name,
                fontFamily: 'Inter',
                fontSizePx: 60,
                fontWeight: 700,
                letterSpacingEm: 0,
                lineHeightMultiplier: 1.2,
                colorHex: '#F3EEE8',
                alignment: 'center',
              }
            : undefined),
        vectorData:
          command.clip.vectorData ||
          (command.clip.kind === 'vector'
            ? {
                shapeType: 'rect',
                svgPathData: 'M 100 100 L 500 100 L 500 500 L 100 500 Z',
                fillColorHex: '#F06424',
                strokeColorHex: '#F3EEE8',
                strokeWidthPx: 2,
                cornerRadiusPx: 16,
              }
            : undefined),
        audioConfig:
          command.clip.audioConfig ||
          (command.clip.kind === 'audio'
            ? {
                gainDb: 0,
                linearGain: 1,
                pan: 0,
                fadeInSec: 0.05,
                fadeOutSec: 0.1,
                muted: false,
              }
            : undefined),
        captionData:
          command.clip.captionData ||
          (command.clip.kind === 'caption'
            ? {
                cueIndex: track.clips.length + 1,
                text: command.clip.name,
                stylePresetId: 'hormozi-highlight',
                highlightColorHex: '#F06424',
                maxCharsPerLine: 38,
              }
            : undefined),
        templateBinding: command.clip.templateBinding,
        entity3d: command.clip.entity3d,
        camera3d: command.clip.camera3d,
        keyframes: command.clip.keyframes || [],
        effects: command.clip.effects || [],
        masks: command.clip.masks || [],
        inTransition: command.clip.inTransition,
        outTransition: command.clip.outTransition,
      };
      track.clips.push(newClip);
      recomputeCanvasDurationIfNeeded(next);
      changedIds.push(clipId, track.id);
      break;
    }

    case 'trimClip': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked || found.clip.locked) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" or its track is locked.`);
      }
      const nextStart =
        command.startTimeSec !== undefined
          ? command.startTimeSec
          : found.clip.startTimeSec;
      const nextDur =
        command.durationSec !== undefined
          ? command.durationSec
          : found.clip.durationSec;
      const nextSpeed =
        command.speedMultiplier !== undefined
          ? command.speedMultiplier
          : found.clip.speedMultiplier;

      if (nextStart < 0 || nextDur <= 0.05 || nextSpeed <= 0 || nextSpeed > 16) {
        return failReceipt(
          'INVALID_RANGE: Trim requires startTimeSec >= 0, durationSec > 0.05s, and speedMultiplier in (0, 16].'
        );
      }

      found.clip.startTimeSec = Number(nextStart.toFixed(3));
      found.clip.durationSec = Number(nextDur.toFixed(3));
      found.clip.speedMultiplier = Number(nextSpeed.toFixed(3));
      if (command.trimInSec !== undefined) {
        if (command.trimInSec < 0) {
          return failReceipt('INVALID_RANGE: trimInSec cannot be negative.');
        }
        found.clip.trimInSec = Number(command.trimInSec.toFixed(3));
        found.clip.sourceInSec = found.clip.trimInSec;
      }
      if (command.trimOutSec !== undefined) {
        if (command.trimOutSec < 0) {
          return failReceipt('INVALID_RANGE: trimOutSec cannot be negative.');
        }
        found.clip.trimOutSec = Number(command.trimOutSec.toFixed(3));
      }
      found.clip.sourceOutSec = Number(
        (found.clip.sourceInSec + found.clip.durationSec * found.clip.speedMultiplier).toFixed(3)
      );
      recomputeCanvasDurationIfNeeded(next);
      changedIds.push(found.clip.id);
      break;
    }

    case 'splitClip': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked || found.clip.locked) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" or its track is locked.`);
      }
      const { clip, track, clipIndex } = found;
      const clipEnd = clip.startTimeSec + clip.durationSec;
      const minSplitMargin = 0.08;
      if (
        command.splitTimeSec <= clip.startTimeSec + minSplitMargin ||
        command.splitTimeSec >= clipEnd - minSplitMargin
      ) {
        return failReceipt(
          `INVALID_SPLIT_TIME: splitTimeSec (${command.splitTimeSec}s) must lie strictly inside clip bounds (${clip.startTimeSec}s .. ${clipEnd}s).`
        );
      }

      const secondId =
        command.secondClipId || `${clip.id}_part2_${Date.now().toString(36)}`;
      if (existingIds.has(secondId)) {
        return failReceipt(`DUPLICATE_ID: Split clip ID "${secondId}" already exists.`);
      }

      const firstDur = Number((command.splitTimeSec - clip.startTimeSec).toFixed(3));
      const secondDur = Number((clipEnd - command.splitTimeSec).toFixed(3));

      const secondClip: CanonicalClip = JSON.parse(JSON.stringify(clip));
      secondClip.id = secondId;
      secondClip.name = `${clip.name} (Part 2)`;
      secondClip.startTimeSec = Number(command.splitTimeSec.toFixed(3));
      secondClip.durationSec = secondDur;
      secondClip.sourceInSec = Number(
        (clip.sourceInSec + firstDur * clip.speedMultiplier).toFixed(3)
      );
      secondClip.sourceOutSec = Number(
        (secondClip.sourceInSec + secondDur * clip.speedMultiplier).toFixed(3)
      );
      secondClip.keyframes = clip.keyframes
        .filter((k) => k.timeSec >= command.splitTimeSec)
        .map((k, idx) => ({
          ...k,
          id: `${k.id}_split_${idx + 1}`,
        }));

      clip.durationSec = firstDur;
      clip.sourceOutSec = Number(
        (clip.sourceInSec + firstDur * clip.speedMultiplier).toFixed(3)
      );
      clip.keyframes = clip.keyframes.filter((k) => k.timeSec <= command.splitTimeSec);

      track.clips.splice(clipIndex + 1, 0, secondClip);
      changedIds.push(clip.id, secondClip.id);
      break;
    }

    case 'moveClip': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked || found.clip.locked) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" or its track is locked.`);
      }
      if (command.startTimeSec < 0) {
        return failReceipt('INVALID_RANGE: startTimeSec cannot be negative.');
      }

      const deltaSec = command.startTimeSec - found.clip.startTimeSec;
      found.clip.startTimeSec = Number(command.startTimeSec.toFixed(3));
      // Shift clip keyframes along with the clip
      found.clip.keyframes = found.clip.keyframes.map((kf) => ({
        ...kf,
        timeSec: Math.max(0, Number((kf.timeSec + deltaSec).toFixed(3))),
      }));

      // If clip belongs to a group and moveGroup !== false, move peer clips in the same group
      if (command.moveGroup && found.clip.groupId && Math.abs(deltaSec) > 0.0001) {
        const grpId = found.clip.groupId;
        for (const t of next.tracks) {
          if (t.locked) continue;
          for (const peer of t.clips) {
            if (peer.id === found.clip.id || peer.groupId !== grpId || peer.locked) continue;
            if (checkClipSceneLock(next, peer)) continue;
            peer.startTimeSec = Math.max(0, Number((peer.startTimeSec + deltaSec).toFixed(3)));
            peer.keyframes = peer.keyframes.map((kf) => ({
              ...kf,
              timeSec: Math.max(0, Number((kf.timeSec + deltaSec).toFixed(3))),
            }));
            changedIds.push(peer.id);
          }
        }
      }

      if (command.targetTrackId && command.targetTrackId !== found.track.id) {
        const destTrack = next.tracks.find((t) => t.id === command.targetTrackId);
        if (!destTrack) {
          return failReceipt(
            `TARGET_NOT_FOUND: Destination track "${command.targetTrackId}" not found.`
          );
        }
        if (destTrack.locked) {
          return failReceipt(
            `LOCKED_TARGET: Destination track "${destTrack.name}" is locked.`
          );
        }
        found.track.clips.splice(found.clipIndex, 1);
        found.clip.trackId = destTrack.id;
        destTrack.clips.push(found.clip);
        changedIds.push(found.track.id, destTrack.id);
      }

      recomputeCanvasDurationIfNeeded(next);
      changedIds.push(found.clip.id);
      break;
    }

    case 'reorderClip': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      const destTrack = next.tracks.find((t) => t.id === command.targetTrackId);
      if (!destTrack) {
        return failReceipt(
          `TARGET_NOT_FOUND: Destination track "${command.targetTrackId}" not found.`
        );
      }
      if (found.track.locked || destTrack.locked || found.clip.locked) {
        return failReceipt('LOCKED_TARGET: Cannot reorder locked clip or track.');
      }
      found.track.clips.splice(found.clipIndex, 1);
      found.clip.trackId = destTrack.id;
      const boundedIdx = Math.max(0, Math.min(destTrack.clips.length, command.newIndex));
      destTrack.clips.splice(boundedIdx, 0, found.clip);
      changedIds.push(found.clip.id, destTrack.id);
      break;
    }

    case 'deleteClip': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked || found.clip.locked) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" is locked.`);
      }
      found.track.clips.splice(found.clipIndex, 1);
      changedIds.push(command.clipId, found.track.id);
      break;
    }

    case 'duplicateClip': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      const destTrack = command.targetTrackId
        ? next.tracks.find((t) => t.id === command.targetTrackId)
        : found.track;
      if (!destTrack) {
        return failReceipt(
          `TARGET_NOT_FOUND: Destination track "${command.targetTrackId}" not found.`
        );
      }
      if (destTrack.locked) {
        return failReceipt(`LOCKED_TARGET: Destination track "${destTrack.name}" is locked.`);
      }

      const newClipId =
        command.newClipId ||
        `${found.clip.id}_copy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      if (existingIds.has(newClipId)) {
        return failReceipt(`DUPLICATE_ID: Clip ID "${newClipId}" already exists.`);
      }

      const nextStartSec =
        command.startTimeSec !== undefined
          ? Math.max(0, Number(command.startTimeSec.toFixed(3)))
          : Number((found.clip.startTimeSec + found.clip.durationSec).toFixed(3));
      const deltaSec = nextStartSec - found.clip.startTimeSec;

      const cloned: CanonicalClip = JSON.parse(JSON.stringify(found.clip));
      cloned.id = newClipId;
      cloned.trackId = destTrack.id;
      cloned.name = `${found.clip.name} (Copy)`;
      cloned.startTimeSec = nextStartSec;
      cloned.locked = false;
      if (command.retainSourceMapping === false) {
        delete cloned.sourceSegmentId;
      }
      cloned.keyframes = cloned.keyframes.map((kf, idx) => ({
        ...kf,
        id: `kf_${newClipId}_${idx + 1}`,
        timeSec: Math.max(0, Number((kf.timeSec + deltaSec).toFixed(3))),
      }));
      cloned.effects = cloned.effects.map((eff, idx) => ({
        ...eff,
        id: `eff_${newClipId}_${idx + 1}`,
      }));
      cloned.masks = cloned.masks.map((m, idx) => ({
        ...m,
        id: `mask_${newClipId}_${idx + 1}`,
      }));
      if (cloned.inTransition) {
        cloned.inTransition = {
          ...cloned.inTransition,
          id: `trans_in_${newClipId}`,
        };
      }
      if (cloned.outTransition) {
        cloned.outTransition = {
          ...cloned.outTransition,
          id: `trans_out_${newClipId}`,
        };
      }

      destTrack.clips.push(cloned);
      recomputeCanvasDurationIfNeeded(next);
      changedIds.push(newClipId, destTrack.id);
      break;
    }

    case 'setClipState': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked) {
        return failReceipt(`LOCKED_TARGET: Track "${found.track.name}" is locked.`);
      }
      // Allow unlocking a locked clip, but block other changes while locked
      if (found.clip.locked && command.locked !== false) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" is locked.`);
      }
      if (command.name !== undefined && command.name.trim()) {
        found.clip.name = command.name.trim();
      }
      if (command.visible !== undefined) found.clip.visible = command.visible;
      if (command.locked !== undefined) found.clip.locked = command.locked;
      if (command.muted !== undefined) {
        found.clip.muted = command.muted;
        if (found.clip.audioConfig) {
          found.clip.audioConfig.muted = command.muted;
        }
      }
      if (command.solo !== undefined) found.clip.solo = command.solo;
      if (command.blendMode !== undefined) found.clip.blendMode = command.blendMode;
      if (command.groupId !== undefined) {
        if (command.groupId === null || command.groupId === '') {
          delete found.clip.groupId;
        } else {
          found.clip.groupId = command.groupId;
        }
      }
      if (command.sceneId !== undefined) {
        found.clip.sceneId = command.sceneId;
      }
      changedIds.push(found.clip.id);
      break;
    }

    case 'groupClips': {
      if (!Array.isArray(command.clipIds) || command.clipIds.length < 2) {
        return failReceipt('INVALID_INPUT: groupClips requires at least 2 clipIds.');
      }
      const groupId = command.groupId || `grp_${Date.now().toString(36)}`;
      for (const cid of command.clipIds) {
        const found = findClipAndTrack(next, cid);
        if (!found) {
          return failReceipt(`TARGET_NOT_FOUND: Clip "${cid}" not found for grouping.`);
        }
        if (found.track.locked || found.clip.locked) {
          return failReceipt(`LOCKED_TARGET: Cannot group locked clip "${found.clip.name}".`);
        }
        const sceneErr = checkClipSceneLock(next, found.clip);
        if (sceneErr) return failReceipt(sceneErr);
        found.clip.groupId = groupId;
        changedIds.push(found.clip.id);
      }
      break;
    }

    case 'ungroupClips': {
      let ungroupedCount = 0;
      for (const t of next.tracks) {
        for (const c of t.clips) {
          const matchByGroup = command.groupId && c.groupId === command.groupId;
          const matchByClip =
            Array.isArray(command.clipIds) && command.clipIds.includes(c.id);
          if (matchByGroup || matchByClip) {
            delete c.groupId;
            changedIds.push(c.id);
            ungroupedCount += 1;
          }
        }
      }
      if (ungroupedCount === 0) {
        return failReceipt('TARGET_NOT_FOUND: No grouped clips matched ungroupClips criteria.');
      }
      break;
    }

    case 'setSceneState': {
      const scene = next.scenes.find((s) => s.id === command.sceneId);
      if (!scene) {
        return failReceipt(`TARGET_NOT_FOUND: Scene "${command.sceneId}" not found.`);
      }
      if (command.title !== undefined && command.title.trim()) {
        scene.title = command.title.trim();
      }
      if (command.status !== undefined) {
        scene.status = command.status;
      }
      if (command.continuityNotes !== undefined) {
        scene.continuityNotes = command.continuityNotes;
      }
      if (command.lockSceneClips !== undefined || command.status === 'locked') {
        const shouldLock =
          command.lockSceneClips !== undefined
            ? command.lockSceneClips
            : command.status === 'locked';
        for (const t of next.tracks) {
          for (const c of t.clips) {
            if (c.sceneId === scene.id) {
              c.locked = shouldLock;
              changedIds.push(c.id);
            }
          }
        }
      }
      changedIds.push(scene.id);
      break;
    }

    case 'duplicateScene': {
      const sceneIdx = next.scenes.findIndex((s) => s.id === command.sceneId);
      if (sceneIdx < 0) {
        return failReceipt(`TARGET_NOT_FOUND: Scene "${command.sceneId}" not found.`);
      }
      const sourceScene = next.scenes[sceneIdx];
      const newSceneId =
        command.newSceneId ||
        `${sourceScene.id}_copy_${Date.now().toString(36)}`;
      if (existingIds.has(newSceneId)) {
        return failReceipt(`DUPLICATE_ID: Scene ID "${newSceneId}" already exists.`);
      }

      const maxSceneEnd = next.scenes.reduce(
        (max, s) => Math.max(max, s.startTimeSec + s.durationSec),
        next.canvas.durationSec
      );
      const insertStartSec =
        command.insertAtTimeSec !== undefined
          ? Math.max(0, Number(command.insertAtTimeSec.toFixed(3)))
          : Number(maxSceneEnd.toFixed(3));
      const timeOffset = insertStartSec - sourceScene.startTimeSec;
      const retainMapping = command.retainSourceMapping !== false;

      const duplicatedScene: CanonicalSceneReference = {
        id: newSceneId,
        title: `${sourceScene.title} (Copy)`,
        order: next.scenes.length,
        startTimeSec: insertStartSec,
        durationSec: sourceScene.durationSec,
        scriptSegmentIds: retainMapping ? [...sourceScene.scriptSegmentIds] : [],
        continuityNotes: sourceScene.continuityNotes,
        status: 'draft',
      };
      next.scenes.push(duplicatedScene);
      changedIds.push(newSceneId);

      // Duplicate all clips belonging to sourceScene across tracks
      let clipCounter = 0;
      for (const track of next.tracks) {
        if (track.locked) continue;
        const sceneClips = track.clips.filter(
          (c) =>
            c.sceneId === sourceScene.id ||
            (retainMapping &&
              c.sourceSegmentId &&
              sourceScene.scriptSegmentIds.includes(c.sourceSegmentId))
        );
        for (const origClip of sceneClips) {
          clipCounter += 1;
          const dupClipId = `${origClip.id}_${newSceneId}_${clipCounter}`;
          const newClipStart = Math.max(
            0,
            Number((origClip.startTimeSec + timeOffset).toFixed(3))
          );
          const clipDelta = newClipStart - origClip.startTimeSec;
          const dupClip: CanonicalClip = JSON.parse(JSON.stringify(origClip));
          dupClip.id = dupClipId;
          dupClip.name = `${origClip.name} (Scene Copy)`;
          dupClip.sceneId = newSceneId;
          dupClip.locked = false;
          if (!retainMapping) {
            delete dupClip.sourceSegmentId;
          }
          dupClip.startTimeSec = newClipStart;
          dupClip.keyframes = dupClip.keyframes.map((kf, kIdx) => ({
            ...kf,
            id: `kf_${dupClipId}_${kIdx + 1}`,
            timeSec: Math.max(0, Number((kf.timeSec + clipDelta).toFixed(3))),
          }));
          dupClip.effects = dupClip.effects.map((eff, eIdx) => ({
            ...eff,
            id: `eff_${dupClipId}_${eIdx + 1}`,
          }));
          dupClip.masks = dupClip.masks.map((m, mIdx) => ({
            ...m,
            id: `mask_${dupClipId}_${mIdx + 1}`,
          }));
          if (dupClip.inTransition) {
            dupClip.inTransition = {
              ...dupClip.inTransition,
              id: `trans_in_${dupClipId}`,
            };
          }
          if (dupClip.outTransition) {
            dupClip.outTransition = {
              ...dupClip.outTransition,
              id: `trans_out_${dupClipId}`,
            };
          }
          track.clips.push(dupClip);
          changedIds.push(dupClipId);
        }
      }
      recomputeCanvasDurationIfNeeded(next);
      break;
    }

    case 'resolveMissingAsset': {
      const targetDep = next.assetReferences.find((a) => a.assetId === command.assetId);
      if (!targetDep) {
        return failReceipt(
          `TARGET_NOT_FOUND: Asset reference "${command.assetId}" not found.`
        );
      }
      const resolvedId = (command.replacementAssetId || command.assetId).trim();
      if (resolvedId.startsWith('blob:')) {
        return failReceipt(
          'LOCAL_BLOB_URL_FORBIDDEN: Cannot resolve missing asset with transient blob: URL.'
        );
      }
      targetDep.assetId = resolvedId;
      if (command.replacementTitle) targetDep.title = command.replacementTitle.trim();
      if (command.sourceUrl) targetDep.sourceUrl = command.sourceUrl.trim();
      if (command.mimeType) targetDep.mimeType = command.mimeType.trim();
      if (command.licenseType) targetDep.licenseType = command.licenseType;
      targetDep.missing = false;
      changedIds.push(resolvedId);

      // Rebind clips referencing the old assetId
      for (const t of next.tracks) {
        for (const c of t.clips) {
          if (c.assetId === command.assetId) {
            c.assetId = resolvedId;
            changedIds.push(c.id);
          }
          if (c.assetSlotBindings) {
            for (const [slot, val] of Object.entries(c.assetSlotBindings)) {
              if (val === command.assetId) {
                c.assetSlotBindings[slot] = resolvedId;
                changedIds.push(c.id);
              }
            }
          }
        }
      }
      break;
    }

    case 'resolveUnsupportedFeature': {
      const ufIdx = next.unsupportedFeatures.findIndex(
        (u) => u.id === command.featureId || u.featureKey === command.featureId
      );
      if (ufIdx < 0) {
        return failReceipt(
          `TARGET_NOT_FOUND: Unsupported feature "${command.featureId}" not found.`
        );
      }
      const uf = next.unsupportedFeatures[ufIdx];
      if (command.resolutionStrategy === 'convert-to-2d-approximation') {
        uf.fallbackBehavior = 'approximated-2d';
        uf.severity = 'info';
        uf.message = `${uf.message} [Resolved: Converted to 2D mobile approximation]`;
      } else if (command.resolutionStrategy === 'preserve-metadata') {
        uf.fallbackBehavior = 'preserved-metadata';
        uf.severity = 'info';
      } else {
        uf.fallbackBehavior = 'omitted-on-export';
        uf.severity = 'info';
      }
      changedIds.push(uf.id);
      break;
    }

    case 'setTransform': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked || found.clip.locked) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" is locked.`);
      }
      if (
        command.transform.opacity !== undefined &&
        (command.transform.opacity < 0 || command.transform.opacity > 1)
      ) {
        return failReceipt('INVALID_RANGE: Transform opacity must be between 0 and 1.');
      }
      found.clip.transform = {
        ...found.clip.transform,
        ...command.transform,
      };
      changedIds.push(found.clip.id);
      break;
    }

    case 'setTextProperties': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked || found.clip.locked) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" is locked.`);
      }
      const currentText = found.clip.textData || {
        content: found.clip.name,
        fontFamily: 'Inter',
        fontSizePx: 64,
        fontWeight: 800,
        letterSpacingEm: -0.02,
        lineHeightMultiplier: 1.15,
        colorHex: '#F3EEE8',
        alignment: 'center' as const,
      };
      if (
        command.textData.fontSizePx !== undefined &&
        (command.textData.fontSizePx < 8 || command.textData.fontSizePx > 600)
      ) {
        return failReceipt('INVALID_RANGE: fontSizePx must be between 8 and 600.');
      }
      found.clip.textData = {
        ...currentText,
        ...command.textData,
      };
      changedIds.push(found.clip.id);
      break;
    }

    case 'addKeyframe': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked || found.clip.locked) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" is locked.`);
      }
      if (command.keyframe.timeSec < 0) {
        return failReceipt('INVALID_RANGE: Keyframe timeSec must be >= 0.');
      }
      const kfId =
        command.keyframe.id ||
        `kf_${found.clip.id}_${command.keyframe.property}_${Date.now()}`;
      if (existingIds.has(kfId)) {
        return failReceipt(`DUPLICATE_ID: Keyframe ID "${kfId}" already exists.`);
      }
      const newKf: CanonicalKeyframe = {
        id: kfId,
        property: command.keyframe.property,
        timeSec: Number(command.keyframe.timeSec.toFixed(3)),
        value: command.keyframe.value,
        interpolation: command.keyframe.interpolation,
        cubicBezier: command.keyframe.cubicBezier,
        easingPresetId: command.keyframe.easingPresetId,
      };
      found.clip.keyframes.push(newKf);
      found.clip.keyframes.sort((a, b) => a.timeSec - b.timeSec);
      changedIds.push(found.clip.id, kfId);
      break;
    }

    case 'updateKeyframe': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      const kf = found.clip.keyframes.find((k) => k.id === command.keyframeId);
      if (!kf) {
        return failReceipt(
          `TARGET_NOT_FOUND: Keyframe "${command.keyframeId}" not found on clip "${command.clipId}".`
        );
      }
      if (command.patch.timeSec !== undefined && command.patch.timeSec < 0) {
        return failReceipt('INVALID_RANGE: Keyframe timeSec cannot be negative.');
      }
      Object.assign(kf, command.patch);
      found.clip.keyframes.sort((a, b) => a.timeSec - b.timeSec);
      changedIds.push(found.clip.id, kf.id);
      break;
    }

    case 'removeKeyframe': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      const idx = found.clip.keyframes.findIndex((k) => k.id === command.keyframeId);
      if (idx < 0) {
        return failReceipt(
          `TARGET_NOT_FOUND: Keyframe "${command.keyframeId}" not found.`
        );
      }
      found.clip.keyframes.splice(idx, 1);
      changedIds.push(found.clip.id, command.keyframeId);
      break;
    }

    case 'addEffect': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      const effId =
        command.effect.id || `eff_${found.clip.id}_${Date.now().toString(36)}`;
      if (existingIds.has(effId)) {
        return failReceipt(`DUPLICATE_ID: Effect ID "${effId}" already exists.`);
      }
      const eff: CanonicalEffectInstance = {
        id: effId,
        effectType: command.effect.effectType,
        name: command.effect.name,
        enabled: command.effect.enabled,
        rendererSupport: command.effect.rendererSupport,
        supportedInAlightXml: command.effect.supportedInAlightXml,
        parameters: { ...command.effect.parameters },
      };
      found.clip.effects.push(eff);
      if (eff.rendererSupport !== 'supported') {
        warnings.push(
          `Effect "${eff.name}" has renderer support "${eff.rendererSupport}".`
        );
      }
      changedIds.push(found.clip.id, effId);
      break;
    }

    case 'setEffectParameter': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (found.track.locked || found.clip.locked) {
        return failReceipt(`LOCKED_TARGET: Clip "${found.clip.name}" is locked.`);
      }
      const eff = found.clip.effects.find((e) => e.id === command.effectId);
      if (!eff) {
        return failReceipt(
          `TARGET_NOT_FOUND: Effect "${command.effectId}" not found on clip "${command.clipId}".`
        );
      }
      eff.parameters[command.parameterKey] = command.value;
      if (command.enabled !== undefined) {
        eff.enabled = command.enabled;
      }
      if (
        found.clip.templateBinding &&
        command.parameterKey in found.clip.templateBinding.parameterOverrides
      ) {
        found.clip.templateBinding.parameterOverrides[command.parameterKey] =
          command.value;
      }
      changedIds.push(found.clip.id, eff.id);
      break;
    }

    case 'removeEffect': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      const idx = found.clip.effects.findIndex((e) => e.id === command.effectId);
      if (idx < 0) {
        return failReceipt(`TARGET_NOT_FOUND: Effect "${command.effectId}" not found.`);
      }
      found.clip.effects.splice(idx, 1);
      changedIds.push(found.clip.id, command.effectId);
      break;
    }

    case 'replaceAsset': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (!command.newAssetId || !command.newAssetId.trim()) {
        return failReceipt('INVALID_INPUT: newAssetId cannot be empty.');
      }
      if (command.newAssetId.startsWith('blob:')) {
        return failReceipt(
          'LOCAL_BLOB_URL_FORBIDDEN: Cannot bind a transient blob: URL as a persistent asset reference.'
        );
      }
      const cleanAssetId = command.newAssetId.trim();
      found.clip.assetId = cleanAssetId;
      if (command.slotKey) {
        found.clip.assetSlotBindings = {
          ...(found.clip.assetSlotBindings || {}),
          [command.slotKey]: cleanAssetId,
        };
        if (found.clip.templateBinding) {
          found.clip.templateBinding.assetSlotBindings[command.slotKey] = cleanAssetId;
        }
      }
      const existingDep = next.assetReferences.find((a) => a.assetId === cleanAssetId);
      if (!existingDep) {
        next.assetReferences.push({
          assetId: cleanAssetId,
          title: command.assetTitle || cleanAssetId,
          role: command.slotKey ? 'template-slot' : 'primary-media',
          mimeType: command.mimeType || 'image/svg+xml',
          required: true,
          missing: false,
          licenseType: command.licenseType || 'User Owned',
        });
      }
      changedIds.push(found.clip.id, cleanAssetId);
      break;
    }

    case 'insertTransition': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
      }
      if (
        command.transition.durationSec <= 0 ||
        command.transition.durationSec > found.clip.durationSec
      ) {
        return failReceipt(
          `INVALID_RANGE: Transition durationSec (${command.transition.durationSec}s) must be > 0 and <= clip duration (${found.clip.durationSec}s).`
        );
      }
      const transId =
        command.transition.id || `trans_${found.clip.id}_${command.edge}_${Date.now()}`;
      const spec: CanonicalTransitionSpec = {
        id: transId,
        type: command.transition.type,
        durationSec: Number(command.transition.durationSec.toFixed(3)),
        easingCurve: command.transition.easingCurve,
        parameters: { ...command.transition.parameters },
        targetClipId: command.transition.targetClipId,
      };
      if (command.edge === 'in') {
        found.clip.inTransition = spec;
      } else {
        found.clip.outTransition = spec;
      }
      changedIds.push(found.clip.id, transId);
      break;
    }

    case 'setGain': {
      if (command.gainDb < -60 || command.gainDb > 24) {
        return failReceipt('INVALID_RANGE: Audio gainDb must be between -60 and +24 dB.');
      }
      if (command.clipId) {
        const found = findClipAndTrack(next, command.clipId);
        if (!found) {
          return failReceipt(`TARGET_NOT_FOUND: Clip "${command.clipId}" not found.`);
        }
        const currentAudio: CanonicalAudioConfig = found.clip.audioConfig || {
          gainDb: 0,
          linearGain: 1,
          pan: 0,
          fadeInSec: 0,
          fadeOutSec: 0,
          muted: false,
        };
        if (
          (command.fadeInSec !== undefined && command.fadeInSec < 0) ||
          (command.fadeOutSec !== undefined && command.fadeOutSec < 0)
        ) {
          return failReceipt('INVALID_RANGE: Audio fade durations cannot be negative.');
        }
        found.clip.audioConfig = {
          ...currentAudio,
          gainDb: command.gainDb,
          linearGain: dbToLinearGain(command.gainDb),
          fadeInSec: command.fadeInSec ?? currentAudio.fadeInSec,
          fadeOutSec: command.fadeOutSec ?? currentAudio.fadeOutSec,
          muted: command.muted ?? currentAudio.muted,
        };
        if (command.muted !== undefined) {
          found.clip.muted = command.muted;
        }
        changedIds.push(found.clip.id);
      } else if (command.trackId) {
        const track = next.tracks.find((t) => t.id === command.trackId);
        if (!track) {
          return failReceipt(`TARGET_NOT_FOUND: Track "${command.trackId}" not found.`);
        }
        track.gainDb = command.gainDb;
        if (command.muted !== undefined) track.muted = command.muted;
        changedIds.push(track.id);
      } else {
        return failReceipt('INVALID_INPUT: setGain requires either clipId or trackId.');
      }
      break;
    }

    case 'alterCaption': {
      const found = findClipAndTrack(next, command.clipId);
      if (!found) {
        return failReceipt(`TARGET_NOT_FOUND: Caption clip "${command.clipId}" not found.`);
      }
      if (found.clip.locked || found.track.locked) {
        return failReceipt(`LOCKED_TARGET: Caption clip "${found.clip.name}" is locked.`);
      }
      if (command.startTimeSec !== undefined) {
        if (command.startTimeSec < 0) {
          return failReceipt('INVALID_RANGE: Caption startTimeSec cannot be negative.');
        }
        found.clip.startTimeSec = Number(command.startTimeSec.toFixed(3));
      }
      if (command.durationSec !== undefined) {
        if (command.durationSec <= 0.1) {
          return failReceipt('INVALID_RANGE: Caption durationSec must be > 0.1s.');
        }
        found.clip.durationSec = Number(command.durationSec.toFixed(3));
      }
      const existingCaption = found.clip.captionData || {
        cueIndex: 1,
        text: found.clip.name,
        stylePresetId: 'hormozi-highlight',
        highlightColorHex: '#F06424',
        maxCharsPerLine: 38,
      };
      const nextText =
        command.text !== undefined ? command.text.trim() : existingCaption.text;
      if (!nextText) {
        return failReceipt('INVALID_INPUT: Caption text cannot be empty.');
      }
      found.clip.captionData = {
        ...existingCaption,
        text: nextText,
        speaker: command.speaker ?? existingCaption.speaker,
        stylePresetId: command.stylePresetId ?? existingCaption.stylePresetId,
        highlightColorHex:
          command.highlightColorHex ?? existingCaption.highlightColorHex,
      };
      found.clip.name = nextText.slice(0, 48);
      if (nextText.length > existingCaption.maxCharsPerLine) {
        warnings.push(
          `Caption text length (${nextText.length} chars) exceeds maxCharsPerLine (${existingCaption.maxCharsPerLine}).`
        );
      }
      recomputeCanvasDurationIfNeeded(next);
      changedIds.push(found.clip.id);
      break;
    }

    case 'instantiateTemplate': {
      const clipId =
        command.clipId || `clip_tpl_${command.templateId}_${Date.now().toString(36)}`;
      if (existingIds.has(clipId)) {
        return failReceipt(`DUPLICATE_ID: Clip ID "${clipId}" already exists.`);
      }
      let targetTrack = command.trackId
        ? next.tracks.find((t) => t.id === command.trackId)
        : next.tracks.find((t) => t.kind === 'template');

      if (!targetTrack) {
        targetTrack = {
          id: command.trackId || `track_template_${next.tracks.length + 1}`,
          name: 'Templates & Rigs',
          kind: 'template',
          order: 0,
          visible: true,
          locked: false,
          muted: false,
          solo: false,
          blendMode: 'normal',
          gainDb: 0,
          clips: [],
        };
        next.tracks.unshift(targetTrack);
        next.tracks.forEach((t, i) => {
          t.order = i;
        });
        changedIds.push(targetTrack.id);
      }

      const startSec = command.startTimeSec ?? 0;
      const durSec = command.durationSec ?? 4;
      if (startSec < 0 || durSec <= 0) {
        return failReceipt('INVALID_RANGE: Template instance requires valid timing.');
      }

      const overrides = { ...(command.parameterOverrides || {}) };
      const titleText = String(
        overrides.headline ||
          overrides.title ||
          command.templateTitle ||
          command.templateId
      );

      const tplClip: CanonicalClip = {
        id: clipId,
        trackId: targetTrack.id,
        name: command.templateTitle || `Template: ${command.templateId}`,
        kind: 'template-instance',
        sceneId: next.scenes[0]?.id,
        startTimeSec: startSec,
        durationSec: durSec,
        sourceInSec: 0,
        sourceOutSec: durSec,
        trimInSec: 0,
        trimOutSec: 0,
        speedMultiplier: 1,
        visible: true,
        locked: false,
        muted: false,
        solo: false,
        blendMode: 'normal',
        transform: {
          position: [next.canvas.width / 2, next.canvas.height / 2],
          scale: [1, 1],
          rotationDeg: 0,
          anchor: [0.5, 0.5],
          opacity: 1,
        },
        textData: {
          content: titleText,
          fontFamily: 'Inter',
          fontSizePx: Number(overrides.fontSize) || 64,
          fontWeight: 800,
          letterSpacingEm: -0.02,
          lineHeightMultiplier: 1.15,
          colorHex:
            typeof overrides.accentColor === 'string'
              ? overrides.accentColor
              : '#F06424',
          alignment: 'center',
        },
        templateBinding: {
          baseTemplateId: command.templateId,
          baseTemplateVersion: command.templateVersion || '1.0.0',
          variantId: command.variantId,
          moduleId: command.moduleId || next.moduleId,
          parameterOverrides: overrides,
          assetSlotBindings: { ...(command.assetSlotBindings || {}) },
          editabilityLevel: command.editabilityLevel || 'source-proven',
        },
        keyframes: [
          {
            id: `kf_${clipId}_in`,
            property: 'opacity',
            timeSec: startSec,
            value: 0,
            interpolation: 'cubic-bezier',
            cubicBezier: [0.22, 1, 0.36, 1],
          },
          {
            id: `kf_${clipId}_settled`,
            property: 'opacity',
            timeSec: Number((startSec + Math.min(0.5, durSec * 0.3)).toFixed(3)),
            value: 1,
            interpolation: 'cubic-bezier',
            cubicBezier: [0.22, 1, 0.36, 1],
          },
        ],
        effects: [
          {
            id: `eff_${clipId}_rig`,
            effectType: 'template-parameter-rig',
            name: 'Template Parameter Rig',
            enabled: true,
            rendererSupport: 'supported',
            supportedInAlightXml: true,
            parameters: overrides,
          },
        ],
        masks: [],
      };

      targetTrack.clips.push(tplClip);
      recomputeCanvasDurationIfNeeded(next);
      changedIds.push(clipId);
      break;
    }

    case 'addMarker': {
      if (command.marker.timeSec < 0) {
        return failReceipt('INVALID_RANGE: Marker timeSec cannot be negative.');
      }
      const mId = command.marker.id || `marker_${Date.now()}_${next.markers.length + 1}`;
      if (existingIds.has(mId)) {
        return failReceipt(`DUPLICATE_ID: Marker ID "${mId}" already exists.`);
      }
      next.markers.push({
        id: mId,
        timeSec: Number(command.marker.timeSec.toFixed(3)),
        durationSec: command.marker.durationSec,
        label: command.marker.label.trim() || 'Marker',
        colorHex: command.marker.colorHex || '#F06424',
        kind: command.marker.kind,
        linkedScriptSegmentId: command.marker.linkedScriptSegmentId,
      });
      next.markers.sort((a, b) => a.timeSec - b.timeSec);
      changedIds.push(mId);
      break;
    }

    case 'removeMarker': {
      const idx = next.markers.findIndex((m) => m.id === command.markerId);
      if (idx < 0) {
        return failReceipt(`TARGET_NOT_FOUND: Marker "${command.markerId}" not found.`);
      }
      next.markers.splice(idx, 1);
      changedIds.push(command.markerId);
      break;
    }

    case 'renameProject': {
      const cleanTitle = command.title.trim();
      if (!cleanTitle) {
        return failReceipt('INVALID_INPUT: Project title cannot be empty.');
      }
      next.title = cleanTitle.slice(0, 200);
      if (command.description !== undefined) {
        next.description = command.description.trim().slice(0, 4000);
      }
      changedIds.push(next.id);
      break;
    }

    case 'updateCanvas': {
      if (command.canvas.aspectRatio) {
        const dims = getDimensionsForAspectRatio(command.canvas.aspectRatio);
        next.canvas.aspectRatio = command.canvas.aspectRatio;
        next.canvas.width = command.canvas.width || dims.width;
        next.canvas.height = command.canvas.height || dims.height;
      }
      if (command.canvas.width !== undefined) next.canvas.width = command.canvas.width;
      if (command.canvas.height !== undefined) next.canvas.height = command.canvas.height;
      if (command.canvas.fps !== undefined) {
        next.canvas.fps = command.canvas.fps;
        next.canvas.timebaseTicksPerSec = command.canvas.fps * 1000;
      }
      if (command.canvas.durationSec !== undefined) {
        if (command.canvas.durationSec <= 0) {
          return failReceipt('INVALID_RANGE: Canvas durationSec must be > 0.');
        }
        next.canvas.durationSec = command.canvas.durationSec;
      }
      if (command.canvas.backgroundColorHex !== undefined) {
        next.canvas.backgroundColorHex = command.canvas.backgroundColorHex;
      }
      if (command.canvas.backgroundAlphaMode !== undefined) {
        next.canvas.backgroundAlphaMode = command.canvas.backgroundAlphaMode;
      }
      changedIds.push(next.id);
      break;
    }

    case 'createSnapshot': {
      const snapId =
        command.snapshotId || `snap_r${next.revision}_${Date.now().toString(36)}`;
      if (next.snapshots.some((s) => s.id === snapId)) {
        return failReceipt(`DUPLICATE_ID: Snapshot ID "${snapId}" already exists.`);
      }
      // Strip recursive snapshots inside the snapshot payload to keep size bounded
      const stateToSerialize: CanonicalProjectDocument = {
        ...next,
        snapshots: [],
      };
      const snap: CanonicalProjectSnapshot = {
        id: snapId,
        label: command.label.trim() || `Checkpoint r${next.revision}`,
        branchName: next.activeBranch,
        revision: next.revision,
        createdAt: now,
        createdByUid: actorId,
        serializedStateJson: JSON.stringify(stateToSerialize),
      };
      next.snapshots.unshift(snap);
      changedIds.push(snapId);
      break;
    }

    case 'restoreSnapshot': {
      const snap = next.snapshots.find((s) => s.id === command.snapshotId);
      if (!snap) {
        return failReceipt(
          `TARGET_NOT_FOUND: Snapshot "${command.snapshotId}" not found.`
        );
      }
      const restoredState = JSON.parse(
        snap.serializedStateJson
      ) as CanonicalProjectDocument;
      next.title = restoredState.title;
      next.description = restoredState.description;
      next.canvas = restoredState.canvas;
      next.scenes = restoredState.scenes;
      next.tracks = restoredState.tracks;
      next.markers = restoredState.markers;
      next.assetReferences = restoredState.assetReferences;
      changedIds.push(next.id, snap.id);
      break;
    }

    case 'createBranch': {
      const cleanName = command.branchName.trim();
      if (!cleanName) {
        return failReceipt('INVALID_INPUT: branchName cannot be empty.');
      }
      if (next.branches.some((b) => b.name === cleanName)) {
        return failReceipt(`DUPLICATE_ID: Branch "${cleanName}" already exists.`);
      }
      const branch: CanonicalProjectBranch = {
        name: cleanName,
        headRevision: next.revision + 1,
        createdFromRevision: next.revision,
        createdAt: now,
        description: command.description,
      };
      next.branches.push(branch);
      next.activeBranch = cleanName;
      changedIds.push(cleanName);
      break;
    }
  }

  next.revision = beforeRevision + 1;
  next.updatedAt = now;

  // Update active branch headRevision
  const activeBranchObj = next.branches.find((b) => b.name === next.activeBranch);
  if (activeBranchObj) {
    activeBranchObj.headRevision = next.revision;
  }

  const editRecordId = `edit_r${next.revision}_${Date.now().toString(36)}`;
  next.aiEditHistory.push({
    id: editRecordId,
    timestamp: now,
    actorId,
    actorKind,
    commandType: command.type,
    rationale,
    changedIds,
    beforeRevision,
    afterRevision: next.revision,
    approvedByUser: actorContext?.approvedByUser ?? actorKind === 'user',
  });

  // Final post-command validation guard
  const postValidation = validateCanonicalProject(next);
  if (!postValidation.valid || !postValidation.project) {
    return failReceipt(
      `POST_COMMAND_VALIDATION_FAILED: ${postValidation.errors.join('; ')}`
    );
  }

  return {
    project: postValidation.project,
    receipt: {
      ok: true,
      commandType: command.type,
      projectId: next.id,
      beforeRevision,
      revision: next.revision,
      changedIds,
      warnings: [...warnings, ...postValidation.warnings],
      errors: [],
      undoRef: `undo_r${beforeRevision}_to_r${next.revision}`,
      reversible: true,
      actorKind,
      rationale,
      timestamp: now,
    },
  };
}

/**
 * Stateful CanonicalProjectStore with Undo/Redo stacks and command receipts.
 * Used identically by the Mobile Pro Editor UI (`actorKind: 'user'`) and AI Director (`actorKind: 'ai-director'`).
 */
export class CanonicalProjectStore {
  private current: CanonicalProjectDocument;
  private undoStack: Array<{
    undoRef: string;
    snapshotJson: string;
    commandType: CanonicalCommandType;
  }> = [];
  private redoStack: Array<{
    undoRef: string;
    snapshotJson: string;
    commandType: CanonicalCommandType;
  }> = [];
  private listeners = new Set<(doc: CanonicalProjectDocument) => void>();

  constructor(initialProject: CanonicalProjectDocument) {
    const check = validateCanonicalProject(initialProject);
    if (!check.valid || !check.project) {
      throw new Error(
        `Cannot initialize CanonicalProjectStore with invalid document: ${check.errors.join('; ')}`
      );
    }
    this.current = check.project;
  }

  public getProject(): CanonicalProjectDocument {
    return this.current;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public subscribe(listener: (doc: CanonicalProjectDocument) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) {
      fn(this.current);
    }
  }

  public dispatch(
    command: CanonicalProjectCommand,
    actorContext?: Partial<CommandActorContext>
  ): ProjectCommandReceipt {
    const preStateJson = serializeCanonicalProject(this.current);
    const { project, receipt } = executeProjectCommand(
      this.current,
      command,
      actorContext
    );

    if (receipt.ok && receipt.undoRef) {
      this.undoStack.push({
        undoRef: receipt.undoRef,
        snapshotJson: preStateJson,
        commandType: command.type,
      });
      if (this.undoStack.length > 50) {
        this.undoStack.shift();
      }
      this.redoStack = [];
      this.current = project;
      this.emit();
    }

    return receipt;
  }

  public undo(actorId = 'user-local'): ProjectCommandReceipt {
    const now = new Date().toISOString();
    const beforeRev = this.current.revision;
    const entry = this.undoStack.pop();
    if (!entry) {
      return {
        ok: false,
        commandType: 'undo',
        projectId: this.current.id,
        beforeRevision: beforeRev,
        revision: beforeRev,
        changedIds: [],
        warnings: [],
        errors: ['UNDO_STACK_EMPTY: No prior command available to undo.'],
        undoRef: null,
        actorKind: 'user',
        rationale: 'Undo requested on empty stack',
        timestamp: now,
      };
    }

    const currentJson = serializeCanonicalProject(this.current);
    this.redoStack.push({
      undoRef: entry.undoRef,
      snapshotJson: currentJson,
      commandType: entry.commandType,
    });

    const restored = JSON.parse(entry.snapshotJson) as CanonicalProjectDocument;
    this.current = restored;
    this.emit();

    return {
      ok: true,
      commandType: 'undo',
      projectId: this.current.id,
      beforeRevision: beforeRev,
      revision: this.current.revision,
      changedIds: [this.current.id],
      warnings: [],
      errors: [],
      undoRef: entry.undoRef,
      actorKind: 'user',
      rationale: `Reverted ${entry.commandType} (${entry.undoRef}) by ${actorId}`,
      timestamp: now,
    };
  }

  public redo(actorId = 'user-local'): ProjectCommandReceipt {
    const now = new Date().toISOString();
    const beforeRev = this.current.revision;
    const entry = this.redoStack.pop();
    if (!entry) {
      return {
        ok: false,
        commandType: 'redo',
        projectId: this.current.id,
        beforeRevision: beforeRev,
        revision: beforeRev,
        changedIds: [],
        warnings: [],
        errors: ['REDO_STACK_EMPTY: No undone command available to redo.'],
        undoRef: null,
        actorKind: 'user',
        rationale: 'Redo requested on empty stack',
        timestamp: now,
      };
    }

    const currentJson = serializeCanonicalProject(this.current);
    this.undoStack.push({
      undoRef: entry.undoRef,
      snapshotJson: currentJson,
      commandType: entry.commandType,
    });

    const reapplied = JSON.parse(entry.snapshotJson) as CanonicalProjectDocument;
    this.current = reapplied;
    this.emit();

    return {
      ok: true,
      commandType: 'redo',
      projectId: this.current.id,
      beforeRevision: beforeRev,
      revision: this.current.revision,
      changedIds: [this.current.id],
      warnings: [],
      errors: [],
      undoRef: entry.undoRef,
      reversible: true,
      actorKind: 'user',
      rationale: `Re-applied ${entry.commandType} (${entry.undoRef}) by ${actorId}`,
      timestamp: now,
    };
  }

  public commitValidatedProjectState(
    nextProject: CanonicalProjectDocument,
    commandType: CanonicalCommandType = 'createSnapshot'
  ): void {
    const check = validateCanonicalProject(nextProject);
    if (!check.valid || !check.project) {
      throw new Error(
        `Cannot commit invalid project state: ${check.errors.join('; ')}`
      );
    }
    const preStateJson = serializeCanonicalProject(this.current);
    this.undoStack.push({
      undoRef: `undo_tx_r${this.current.revision}_to_r${check.project.revision}`,
      snapshotJson: preStateJson,
      commandType,
    });
    if (this.undoStack.length > 50) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.current = check.project;
    this.emit();
  }
}

/**
 * Converts a CanonicalProjectDocument into a `ProjectLibraryItem` ready to persist
 * in Cloud Firestore / Server Durable Store.
 */
export function canonicalProjectToLibraryRecord(
  project: CanonicalProjectDocument
): Omit<ProjectLibraryItem, 'id' | 'updatedAt'> & { id: string; updatedAt: string } {
  const canonicalJson = serializeCanonicalProject(project);
  const legacySpec = JSON.stringify(
    canonicalProjectToLegacySowveilDocument(project),
    null,
    2
  );
  const totalClips = project.tracks.reduce((acc, t) => acc + t.clips.length, 0);

  return {
    id: project.id,
    ownerUid: project.ownerUid,
    title: project.title,
    description: project.description,
    compCount: Math.max(1, project.scenes.length),
    projectFileStatus: 'sowveil-native',
    fileSizeBytes: canonicalJson.length,
    fileSizeLabel: `${(canonicalJson.length / 1024).toFixed(1)} KB (v2.0 · ${totalClips} clips)`,
    resolution: `${project.canvas.width} × ${project.canvas.height}`,
    durationLabel: `${project.canvas.durationSec.toFixed(1)}s`,
    fps: project.canvas.fps,
    targetEditor: project.targetEditor,
    aspectRatio: project.canvas.aspectRatio,
    sowveilSpecJson: legacySpec.slice(0, 14500),
    canonicalProjectJson: canonicalJson,
    revision: project.revision,
    activeBranch: project.activeBranch,
    hasExternalFootageWarning: project.assetReferences.some((a) => a.missing),
    archived: false,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    tags: project.tags,
  };
}

// ============================================================================
// CANONICAL PROJECT TEST FIXTURES (7 ARCHETYPES REQUIRED BY SPEC)
// ============================================================================

export function buildCanonicalProjectFixtures(): {
  minimalProject: CanonicalProjectDocument;
  multiTrackProject: CanonicalProjectDocument;
  templateInstanceProject: CanonicalProjectDocument;
  keyframeAnimationProject: CanonicalProjectDocument;
  effectStackProject: CanonicalProjectDocument;
  captionProject: CanonicalProjectDocument;
  audioClipProject: CanonicalProjectDocument;
} {
  // 1. Minimal Project
  const minimalProject = createMinimalCanonicalProject({
    id: 'fixture_minimal_project',
    ownerUid: 'fixture-owner',
    title: 'Minimal Vertical Starter',
    aspectRatio: '9:16',
    fps: 60,
    durationSec: 4,
  });

  // 2. Multi-Track Project (Text + Vector + Caption + Audio + 3D Camera)
  const multiTrackStore = new CanonicalProjectStore(
    createMinimalCanonicalProject({
      id: 'fixture_multitrack_project',
      ownerUid: 'fixture-owner',
      title: 'Multi-Track Product Launch',
      aspectRatio: '9:16',
      fps: 60,
      durationSec: 6,
    })
  );
  multiTrackStore.dispatch({
    type: 'createClip',
    trackId: 'track_vector_1',
    clip: {
      id: 'clip_glass_backdrop',
      name: 'Liquid Glass Hero Plate',
      kind: 'vector',
      startTimeSec: 0,
      durationSec: 6,
      vectorData: {
        shapeType: 'liquid-glass-card',
        svgPathData: 'M 90 360 L 990 360 L 990 1560 L 90 1560 Z',
        fillColorHex: '#181412',
        strokeColorHex: '#F06424',
        strokeWidthPx: 2,
        cornerRadiusPx: 32,
      },
    },
  });
  multiTrackStore.dispatch({
    type: 'createClip',
    trackId: 'track_caption_1',
    clip: {
      id: 'clip_sub_01',
      name: 'Ship mobile motion faster',
      kind: 'caption',
      startTimeSec: 0.4,
      durationSec: 2.6,
      captionData: {
        cueIndex: 1,
        text: 'Ship mobile motion faster',
        speaker: 'Narrator',
        stylePresetId: 'hormozi-highlight',
        highlightColorHex: '#F06424',
        maxCharsPerLine: 36,
      },
    },
  });
  multiTrackStore.dispatch({
    type: 'createClip',
    trackId: 'track_audio_1',
    clip: {
      id: 'clip_whoosh_01',
      name: 'Cinematic Whoosh Hit',
      kind: 'audio',
      startTimeSec: 0,
      durationSec: 1.8,
      audioConfig: {
        gainDb: -1.5,
        linearGain: dbToLinearGain(-1.5),
        pan: 0,
        fadeInSec: 0.05,
        fadeOutSec: 0.25,
        muted: false,
        proceduralSfxPreset: 'cinematic-whoosh-hit',
        waveformPeaks: [0.1, 0.45, 0.95, 0.72, 0.35, 0.12],
      },
    },
  });

  // 3. Template Instance with Overrides
  const templateInstanceStore = new CanonicalProjectStore(
    createMinimalCanonicalProject({
      id: 'fixture_template_instance',
      ownerUid: 'fixture-owner',
      title: 'SaaS Notification Rig Instance',
      moduleId: 'ui-saas',
    })
  );
  templateInstanceStore.dispatch({
    type: 'instantiateTemplate',
    templateId: 'ui-saas-stripe-payout-card',
    templateTitle: 'Stripe Payout Notification',
    templateVersion: '1.2.0',
    moduleId: 'ui-saas',
    variantId: 'var_custom_brand_01',
    clipId: 'clip_tpl_stripe_instance',
    startTimeSec: 0,
    durationSec: 4.5,
    parameterOverrides: {
      headline: '+$14,800 ARR Unlocked',
      accentColor: '#55B98B',
      fontSize: 64,
      glowIntensity: 0.85,
    },
    assetSlotBindings: {
      logo_slot: 'asset_brand_mark_svg',
    },
    editabilityLevel: 'source-proven',
  });

  // 4. Keyframe Animation Project
  const kfStore = new CanonicalProjectStore(
    createMinimalCanonicalProject({
      id: 'fixture_keyframe_animation',
      ownerUid: 'fixture-owner',
      title: 'Cubic-Bezier Keyframe Kinetic Title',
    })
  );
  kfStore.dispatch({
    type: 'addKeyframe',
    clipId: 'clip_headline_1',
    keyframe: {
      id: 'kf_pos_y_start',
      property: 'positionY',
      timeSec: 0,
      value: 1180,
      interpolation: 'cubic-bezier',
      cubicBezier: [0.16, 1, 0.3, 1],
      easingPresetId: 'expo-out',
    },
  });
  kfStore.dispatch({
    type: 'addKeyframe',
    clipId: 'clip_headline_1',
    keyframe: {
      id: 'kf_pos_y_end',
      property: 'positionY',
      timeSec: 0.8,
      value: 960,
      interpolation: 'cubic-bezier',
      cubicBezier: [0.16, 1, 0.3, 1],
      easingPresetId: 'expo-out',
    },
  });
  kfStore.dispatch({
    type: 'addKeyframe',
    clipId: 'clip_headline_1',
    keyframe: {
      id: 'kf_scale_x_pop',
      property: 'scaleX',
      timeSec: 0.8,
      value: 1.08,
      interpolation: 'ease-out',
    },
  });

  // 5. Effect Stack Project
  const effectStore = new CanonicalProjectStore(
    createMinimalCanonicalProject({
      id: 'fixture_effect_stack',
      ownerUid: 'fixture-owner',
      title: 'Layered Glow & Chromatic Aberration Stack',
      moduleId: 'saas-effects',
    })
  );
  effectStore.dispatch({
    type: 'addEffect',
    clipId: 'clip_headline_1',
    effect: {
      id: 'eff_optical_glow',
      effectType: 'optical-glow',
      name: 'Optical Neon Glow',
      enabled: true,
      rendererSupport: 'supported',
      supportedInAlightXml: true,
      parameters: {
        radiusPx: 28,
        intensity: 0.9,
        tintColor: '#F06424',
      },
    },
  });
  effectStore.dispatch({
    type: 'addEffect',
    clipId: 'clip_headline_1',
    effect: {
      id: 'eff_gaussian_blur_in',
      effectType: 'directional-blur',
      name: 'Motion Blur',
      enabled: true,
      rendererSupport: 'supported',
      supportedInAlightXml: true,
      parameters: {
        angleDeg: 90,
        blurLengthPx: 14,
      },
    },
  });

  // 6. Caption Project
  const captionStore = new CanonicalProjectStore(
    createMinimalCanonicalProject({
      id: 'fixture_caption_project',
      ownerUid: 'fixture-owner',
      title: 'Timed Word-Level Auto Captions',
      moduleId: 'auto-captions',
      durationSec: 4,
    })
  );
  captionStore.dispatch({
    type: 'createClip',
    trackId: 'track_caption_1',
    clip: {
      id: 'clip_caption_cue_1',
      name: 'Every creator needs speed',
      kind: 'caption',
      startTimeSec: 0,
      durationSec: 1.9,
      captionData: {
        cueIndex: 1,
        text: 'Every creator needs speed',
        speaker: 'Host',
        stylePresetId: 'hormozi-highlight',
        highlightColorHex: '#F06424',
        maxCharsPerLine: 36,
        wordTimings: [
          { word: 'Every', startSec: 0, endSec: 0.4 },
          { word: 'creator', startSec: 0.4, endSec: 0.95 },
          { word: 'needs', startSec: 0.95, endSec: 1.35 },
          { word: 'speed', startSec: 1.35, endSec: 1.9 },
        ],
      },
    },
  });
  captionStore.dispatch({
    type: 'createClip',
    trackId: 'track_caption_1',
    clip: {
      id: 'clip_caption_cue_2',
      name: 'right on their phone.',
      kind: 'caption',
      startTimeSec: 1.95,
      durationSec: 2.0,
      captionData: {
        cueIndex: 2,
        text: 'right on their phone.',
        speaker: 'Host',
        stylePresetId: 'hormozi-highlight',
        highlightColorHex: '#55B98B',
        maxCharsPerLine: 36,
      },
    },
  });

  // 7. Audio Clip Project
  const audioStore = new CanonicalProjectStore(
    createMinimalCanonicalProject({
      id: 'fixture_audio_clip_project',
      ownerUid: 'fixture-owner',
      title: 'SFX Risers & Bass Sub Drop',
      moduleId: 'sfx',
      durationSec: 4,
    })
  );
  audioStore.dispatch({
    type: 'createClip',
    trackId: 'track_audio_1',
    clip: {
      id: 'clip_sfx_riser_main',
      name: 'Cybernetic Tension Riser',
      kind: 'audio',
      startTimeSec: 0,
      durationSec: 3.2,
      audioConfig: {
        gainDb: 1.5,
        linearGain: dbToLinearGain(1.5),
        pan: 0,
        fadeInSec: 0.3,
        fadeOutSec: 0.4,
        muted: false,
        proceduralSfxPreset: 'cyber-riser-01',
        waveformPeaks: [0.08, 0.18, 0.34, 0.56, 0.78, 0.96, 0.42],
      },
    },
  });

  return {
    minimalProject,
    multiTrackProject: multiTrackStore.getProject(),
    templateInstanceProject: templateInstanceStore.getProject(),
    keyframeAnimationProject: kfStore.getProject(),
    effectStackProject: effectStore.getProject(),
    captionProject: captionStore.getProject(),
    audioClipProject: audioStore.getProject(),
  };
}
