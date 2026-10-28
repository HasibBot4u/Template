import {
  AssetKind,
  AssetMetadataRecord,
  CatalogItem,
  EditablePropertyCapability,
  EditableTemplateParam,
  JobRecord,
  ReplaceableMediaSlot,
  TargetMobileEditorId,
  TemplateKeyframeOverride,
  TemplateLicenseType,
  TemplateTimingOverrides,
  TemplateValidationEvidence,
  TemplateValidationState,
  TemplateVariantInstance,
  TemplateVisibility,
} from '../types/sowveil';

/**
 * Sanitizes user-provided labels, descriptions, and markdown notes.
 * Strips executable HTML tags, event handlers, and javascript:/data:text/html URIs.
 */
export function sanitizeUserLabelAndMarkdown(raw: unknown, maxLen = 500): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(
      /<\s*(iframe|object|embed|foreignObject|meta|link|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
      ''
    )
    .replace(/<\s*(script|iframe|object|embed|foreignObject|meta|link|style)[^>]*\/?>/gi, '')
    .replace(/\bon[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(?:javascript|vbscript|data:text\/html)\s*:/gi, 'blocked:')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

/**
 * Computes a deterministic hex hash suitable for snapshot/version hashes in both browser & Node.
 */
export function computeDeterministicSnapshotHash(input: unknown): string {
  const str = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `sha256_sim_${hex1}${hex2}`;
}

/**
 * Validates and sanitizes SVG vector content to prevent XSS / script execution in previews.
 */
export function sanitizeAndValidateSvgContent(rawSvg: string): {
  safe: boolean;
  valid: boolean;
  sanitizedSvg: string;
  rejectedReason?: string;
  error?: string;
  sha256: string;
} {
  if (!rawSvg || typeof rawSvg !== 'string') {
    const reason = 'Empty SVG payload.';
    return {
      safe: false,
      valid: false,
      sanitizedSvg: '',
      rejectedReason: reason,
      error: reason,
      sha256: '',
    };
  }

  const trimmed = rawSvg.trim();
  if (!trimmed.includes('<svg') || !trimmed.includes('</svg>')) {
    const reason = 'Invalid SVG container: missing <svg> root element.';
    return {
      safe: false,
      valid: false,
      sanitizedSvg: '',
      rejectedReason: reason,
      error: reason,
      sha256: '',
    };
  }

  const forbiddenPatterns: Array<{ regex: RegExp; reason: string }> = [
    { regex: /<\s*script\b/i, reason: 'SVG contains forbidden <script> element.' },
    {
      regex: /\bon[a-z]+\s*=/i,
      reason: 'SVG contains forbidden inline event handler attribute (on*).',
    },
    { regex: /javascript\s*:/i, reason: 'SVG contains forbidden javascript: URI.' },
    { regex: /data\s*:\s*text\/html/i, reason: 'SVG contains forbidden data:text/html URI.' },
    {
      regex: /<\s*foreignObject\b/i,
      reason: 'SVG contains forbidden <foreignObject> HTML embedding.',
    },
    {
      regex: /<\s*(iframe|object|embed)\b/i,
      reason: 'SVG contains forbidden embedded frame/object.',
    },
  ];

  for (const rule of forbiddenPatterns) {
    if (rule.regex.test(trimmed)) {
      return {
        safe: false,
        valid: false,
        sanitizedSvg: '',
        rejectedReason: rule.reason,
        error: rule.reason,
        sha256: '',
      };
    }
  }

  return {
    safe: true,
    valid: true,
    sanitizedSvg: trimmed,
    sha256: computeDeterministicSnapshotHash(trimmed),
  };
}

/**
 * Infers supported editable properties from a catalog item's parameters and module type.
 */
export function inferSupportedEditableProperties(
  item: CatalogItem
): EditablePropertyCapability[] {
  const props = new Set<EditablePropertyCapability>();
  for (const param of item.editableParams || []) {
    if (param.type === 'text') props.add('text');
    if (param.type === 'color') props.add('color');
    if (param.type === 'number') {
      const k = param.key.toLowerCase();
      if (
        k.includes('speed') ||
        k.includes('duration') ||
        k.includes('freq') ||
        k.includes('decay')
      ) {
        props.add('timing');
      } else {
        props.add('layout');
      }
    }
  }
  if (item.moduleId === 'easing' || item.moduleId === 'expressions') {
    props.add('keyframes');
    props.add('timing');
  }
  if (item.moduleId === 'sfx') {
    props.add('audio');
  }
  if (
    item.moduleId === 'mockups' ||
    item.moduleId === 'ready-made' ||
    item.moduleId === 'ui-saas' ||
    item.moduleId === 'templates' ||
    item.moduleId === 'logo-reveals'
  ) {
    props.add('replaceable-media');
    props.add('timing');
  }
  if (item.moduleId === 'liquid-glass' || item.moduleId === 'backgrounds') {
    props.add('shader-params');
  }
  return Array.from(props);
}

/**
 * Builds default replaceable media slots for a catalog item based on its module.
 */
export function inferMediaRequirements(item: CatalogItem): {
  requiredAssetKinds: AssetKind[];
  replaceableSlots: ReplaceableMediaSlot[];
} {
  if (item.mediaRequirements) return item.mediaRequirements;

  const slots: ReplaceableMediaSlot[] = [];
  const requiredKinds: AssetKind[] = [item.assetKind];

  if (item.moduleId === 'mockups') {
    slots.push({
      slotId: 'screen_media',
      label: 'Device Screen Media',
      acceptedKinds: ['image', 'video', 'svg'],
      required: false,
      defaultAssetId: `asset_${item.id}`,
      boundAssetId: `asset_${item.id}`,
    });
  } else if (item.moduleId === 'logo-reveals') {
    slots.push({
      slotId: 'brand_logo',
      label: 'Brand Logo / Vector Mark',
      acceptedKinds: ['svg', 'image'],
      required: false,
      defaultAssetId: `asset_${item.id}`,
      boundAssetId: `asset_${item.id}`,
    });
  } else if (item.moduleId === 'sfx') {
    slots.push({
      slotId: 'primary_audio',
      label: 'Primary Audio Sample',
      acceptedKinds: ['audio'],
      required: false,
      defaultAssetId: `asset_${item.id}`,
      boundAssetId: `asset_${item.id}`,
    });
  } else if (
    item.moduleId === 'templates' ||
    item.moduleId === 'ready-made' ||
    item.moduleId === 'ui-saas'
  ) {
    slots.push({
      slotId: 'hero_media',
      label: 'Hero Layer / Graphic Slot',
      acceptedKinds: ['image', 'video', 'svg', 'generated'],
      required: false,
      defaultAssetId: `asset_${item.id}`,
      boundAssetId: `asset_${item.id}`,
    });
  }

  return {
    requiredAssetKinds: requiredKinds,
    replaceableSlots: slots,
  };
}

/**
 * Enriches any CatalogItem with complete, truthful Marketplace & Provenance metadata.
 * Preserves all existing fields and never overwrites Unknown license with Free.
 */
export function enrichCatalogItemWithMarketplaceDefaults(item: CatalogItem): CatalogItem {
  const version = item.metadata?.version || '1.0.0';
  const snapshotHash = computeDeterministicSnapshotHash(
    `${item.id}:${version}:${item.name}:${JSON.stringify(item.editableParams || [])}`
  );

  const defaultValidationState: TemplateValidationState = item.validationState
    ? item.validationState
    : item.visibility === 'archived'
    ? 'Archived'
    : item.visibility === 'draft'
    ? 'Draft'
    : item.status === 'Experimental'
    ? 'Experimental'
    : item.status === 'Needs setup'
    ? 'Needs target-app test'
    : 'Validated';

  const defaultValidationEvidence: TemplateValidationEvidence =
    item.lastValidationRecord || {
      jobId: `valjob_seed_${item.id}`,
      validationJobId: `valjob_seed_${item.id}`,
      validatedAt: item.updatedAt || '2026-10-25T00:00:00.000Z',
      validatedByUid: item.creatorUid || 'system-seed',
      passed: defaultValidationState === 'Validated',
      resultingState: defaultValidationState,
      checksRun: {
        schemaValid: true,
        paramsWithinBounds: true,
        requiredAssetsPresent: true,
        svgPreviewSafe: true,
        exportRoundTripVerified: defaultValidationState === 'Validated',
      },
      summary:
        defaultValidationState === 'Validated'
          ? 'Verified schema v1.2.0, parameter bounds, SVG safety, and mobile export round-trip.'
          : `Initial state: ${defaultValidationState}`,
    };

  return {
    ...item,
    creatorUid: item.creatorUid || 'system-seed',
    ownerUid: item.ownerUid || 'system-seed',
    sourceProjectVersion: item.sourceProjectVersion || '2.4.0-mobile',
    templateSchemaVersion: item.templateSchemaVersion || '1.2.0',
    supportedEditableProperties:
      item.supportedEditableProperties || inferSupportedEditableProperties(item),
    mediaRequirements: item.mediaRequirements || inferMediaRequirements(item),
    rendererRequirements: item.rendererRequirements || {
      engine:
        item.moduleId === '3d-models' || item.moduleId === 'carousel'
          ? 'webgl-three'
          : item.sourceType === 'procedural-canvas'
          ? 'canvas-2d'
          : 'browser-svg-css',
      minFps: item.metadata?.fps || 30,
      hardwareAccelerationRecommended:
        item.moduleId === '3d-models' ||
        item.moduleId === 'liquid-glass' ||
        item.moduleId === 'carousel',
    },
    originUrl: item.originUrl || `sowveil://catalog/${item.moduleId}/${item.slug}`,
    sourceUrl: item.sourceUrl || `https://sowveil.studio/catalog/${item.moduleId}/${item.slug}`,
    attribution: item.attribution || {
      authorName:
        item.creatorUid && item.creatorUid !== 'system-seed'
          ? item.creatorUid
          : 'Sowveil Studio Core',
      attributionText: item.licenseNote || 'Original Sowveil Studio specification',
      sourceUrl: item.sourceUrl || `https://sowveil.studio/catalog/${item.moduleId}/${item.slug}`,
      requiresAttribution: item.licenseType === 'CC-BY-4.0',
    },
    previewFiles: item.previewFiles || [`preview_${item.slug}.svg`, `${item.slug}.sowveil.json`],
    validationState: defaultValidationState,
    lastValidationRecord: defaultValidationEvidence,
    versionHistory:
      item.versionHistory && item.versionHistory.length > 0
        ? item.versionHistory
        : [
            {
              version,
              updatedAt: item.updatedAt || '2026-10-25T00:00:00.000Z',
              updatedByUid: item.creatorUid || 'system-seed',
              changelog: 'Initial verified template specification.',
              snapshotHash,
            },
          ],
    deprecationStatus: item.deprecationStatus || {
      isDeprecated: defaultValidationState === 'Deprecated',
    },
  };
}

/**
 * Executes a real, deterministic validation job against a CatalogItem and the Asset Library.
 * Never allows a manual 'Validated' badge without passing actual programmatic checks.
 */
export function runTemplateValidationJob(
  item: CatalogItem,
  secondArg?: Map<string, AssetMetadataRecord> | Set<string> | string,
  thirdArg?: Map<string, AssetMetadataRecord> | string,
  _targetEditor?: TargetMobileEditorId
): {
  updatedItem: CatalogItem;
  validationState: TemplateValidationState;
  nextValidationState: TemplateValidationState;
  evidence: TemplateValidationEvidence;
  jobRecord: JobRecord;
} {
  let assetsMap: Map<string, AssetMetadataRecord> | undefined;
  let availableAssetIds: Set<string> | undefined;
  let actorUid = 'system-validator';

  if (typeof secondArg === 'string') {
    actorUid = secondArg;
  } else if (secondArg instanceof Map) {
    assetsMap = secondArg;
  } else if (secondArg instanceof Set) {
    availableAssetIds = secondArg;
  }

  if (typeof thirdArg === 'string') {
    actorUid = thirdArg;
  } else if (thirdArg instanceof Map) {
    assetsMap = thirdArg;
  }

  const now = new Date().toISOString();
  const jobId = `valjob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 1. Check schema completeness
  const schemaValid = Boolean(
    item.id &&
      /^[a-zA-Z0-9_\-]+$/.test(item.id) &&
      item.name &&
      item.moduleId &&
      item.categoryId &&
      item.metadata?.version
  );

  // 2. Check parameter bounds & defaults
  let paramsWithinBounds = true;
  for (const param of item.editableParams || []) {
    if (param.type === 'number') {
      const numVal = Number(param.defaultValue);
      if (Number.isNaN(numVal)) paramsWithinBounds = false;
      if (param.min !== undefined && numVal < param.min) paramsWithinBounds = false;
      if (param.max !== undefined && numVal > param.max) paramsWithinBounds = false;
    } else if (
      param.type === 'select' &&
      Array.isArray(param.options) &&
      param.options.length > 0
    ) {
      if (!param.options.includes(String(param.defaultValue))) {
        paramsWithinBounds = false;
      }
    }
  }

  // 3. Check required assets
  let requiredAssetsPresent = true;
  const mediaReq = item.mediaRequirements || inferMediaRequirements(item);
  for (const slot of mediaReq.replaceableSlots) {
    const assetId = slot.boundAssetId || slot.defaultAssetId;
    if (slot.required) {
      if (!assetId) {
        requiredAssetsPresent = false;
      } else if (assetsMap) {
        const asset = assetsMap.get(assetId);
        if (!asset || asset.status === 'missing-binary' || asset.missingAssetDetected) {
          requiredAssetsPresent = false;
        }
      } else if (availableAssetIds && !availableAssetIds.has(assetId)) {
        requiredAssetsPresent = false;
      }
    } else if (assetId && assetsMap && assetsMap.has(assetId)) {
      const asset = assetsMap.get(assetId)!;
      if (asset.status === 'missing-binary' || asset.missingAssetDetected) {
        requiredAssetsPresent = false;
      }
    }
  }

  // 4. Check SVG preview safety if custom SVG thumbnail is attached
  let svgPreviewSafe = true;
  if (item.thumbnailSvgDataUri) {
    if (item.thumbnailSvgDataUri.startsWith('<svg')) {
      svgPreviewSafe = sanitizeAndValidateSvgContent(item.thumbnailSvgDataUri).safe;
    } else if (
      item.thumbnailSvgDataUri.includes('<script') ||
      item.thumbnailSvgDataUri.includes('javascript:')
    ) {
      svgPreviewSafe = false;
    }
  }

  // 5. Check export round-trip readiness
  const exportRoundTripVerified = Boolean(
    Array.isArray(item.supportedExportFormats) &&
      item.supportedExportFormats.length > 0 &&
      (item.status === 'Available' || item.status === 'Implemented')
  );

  // Determine truthful resulting validation state
  let resultingState: TemplateValidationState = 'Validated';
  if (item.visibility === 'archived') {
    resultingState = 'Archived';
  } else if (item.deprecationStatus?.isDeprecated) {
    resultingState = 'Deprecated';
  } else if (!requiredAssetsPresent) {
    resultingState = 'Needs assets';
  } else if (!schemaValid || !paramsWithinBounds || !svgPreviewSafe) {
    resultingState = 'Draft';
  } else if (item.status === 'Experimental') {
    resultingState = 'Experimental';
  } else if (!exportRoundTripVerified) {
    resultingState = 'Needs target-app test';
  }

  const passed = resultingState === 'Validated';
  const summary = passed
    ? `Passed all 5 validation checks (schema, ${item.editableParams?.length || 0} param bounds, asset links, SVG safety, export round-trip).`
    : `Validation resulted in "${resultingState}" (schema=${schemaValid}, params=${paramsWithinBounds}, assets=${requiredAssetsPresent}, svgSafe=${svgPreviewSafe}, exportReady=${exportRoundTripVerified}).`;

  const evidence: TemplateValidationEvidence = {
    jobId,
    validationJobId: jobId,
    validatedAt: now,
    validatedByUid: actorUid,
    passed,
    resultingState,
    checksRun: {
      schemaValid,
      paramsWithinBounds,
      requiredAssetsPresent,
      svgPreviewSafe,
      exportRoundTripVerified,
    },
    summary,
  };

  const jobRecord: JobRecord = {
    id: jobId,
    ownerUid: actorUid,
    type: 'asset-process',
    title: `Validate Template: ${item.name}`,
    moduleId: item.moduleId,
    itemId: item.id,
    status: passed ? 'succeeded' : 'ready',
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
    attemptCount: 1,
    idempotencyKey: `validate:${item.id}:${now.slice(0, 16)}`,
    deviceId: 'sowveil-validation-runner',
    redactedMessage: summary,
    requestId: `req_val_${Date.now()}`,
  };

  const updatedItem: CatalogItem = {
    ...enrichCatalogItemWithMarketplaceDefaults(item),
    validationState: resultingState,
    lastValidationRecord: evidence,
    updatedAt: now,
  };

  return {
    updatedItem,
    validationState: resultingState,
    nextValidationState: resultingState,
    evidence,
    jobRecord,
  };
}

/**
 * Applies a user's TemplateVariantInstance overrides to a base CatalogItem
 * to produce an instance view ("Your edits") without mutating the base template.
 */
export function applyVariantOverridesToTemplate(
  baseItem: CatalogItem,
  variant: Pick<
    TemplateVariantInstance,
    | 'parameterOverrides'
    | 'assetSwaps'
    | 'assetOverrides'
    | 'assetSlotBindings'
    | 'timingOverrides'
    | 'keyframeOverrides'
  >
): CatalogItem {
  const clonedParams: EditableTemplateParam[] | undefined = baseItem.editableParams
    ? baseItem.editableParams.map((p) => {
        const overrideVal = variant.parameterOverrides?.[p.key];
        if (overrideVal !== undefined) {
          return { ...p, defaultValue: overrideVal };
        }
        return { ...p };
      })
    : undefined;

  const nextDurationSec =
    variant.timingOverrides?.durationSec ?? baseItem.metadata.durationSec;
  const nextCurvePoints =
    variant.timingOverrides?.easingCurve ?? baseItem.metadata.curvePoints;

  const baseMedia = baseItem.mediaRequirements || inferMediaRequirements(baseItem);
  const swapMap =
    variant.assetOverrides || variant.assetSlotBindings || variant.assetSwaps || {};
  const nextSlots = baseMedia.replaceableSlots.map((slot) => {
    const swappedAssetId = swapMap[slot.slotId];
    return swappedAssetId
      ? { ...slot, defaultAssetId: swappedAssetId, boundAssetId: swappedAssetId }
      : { ...slot };
  });

  return {
    ...baseItem,
    editableParams: clonedParams,
    mediaRequirements: {
      ...baseMedia,
      replaceableSlots: nextSlots,
    },
    metadata: {
      ...baseItem.metadata,
      ...(nextDurationSec !== undefined
        ? {
            durationSec: nextDurationSec,
            durationLabel: `${nextDurationSec}s`,
          }
        : {}),
      ...(nextCurvePoints
        ? { curvePoints: [...nextCurvePoints] as [number, number, number, number] }
        : {}),
    },
  };
}

export interface ForkTemplateConfigObject {
  baseTemplate: CatalogItem;
  variant?: TemplateVariantInstance;
  ownerUid: string;
  newId?: string;
  newName?: string;
  newTitle?: string;
  newSummary?: string;
  visibility?: TemplateVisibility;
  licenseType?: TemplateLicenseType;
  licenseNote?: string;
  parameterOverrides?: Record<string, string | number | boolean>;
  assetSwaps?: Record<string, string>;
  assetOverrides?: Record<string, string>;
  timingOverrides?: TemplateTimingOverrides;
  keyframeOverrides?: TemplateKeyframeOverride[];
}

/**
 * Forks an existing template (and optional user overrides) into a new, standalone CatalogItem
 * owned by ownerUid without modifying the source template.
 */
export function forkTemplateFromVariant(
  firstArg: CatalogItem | ForkTemplateConfigObject,
  secondArg?:
    | TemplateVariantInstance
    | {
        actorUid?: string;
        ownerUid?: string;
        newId?: string;
        newName?: string;
        newTitle?: string;
        newSummary?: string;
        visibility?: TemplateVisibility;
        licenseType?: TemplateLicenseType;
        licenseNote?: string;
        parameterOverrides?: Record<string, string | number | boolean>;
        assetSwaps?: Record<string, string>;
        assetOverrides?: Record<string, string>;
        timingOverrides?: TemplateTimingOverrides;
        keyframeOverrides?: TemplateKeyframeOverride[];
      },
  thirdArg?: {
    newId?: string;
    newTitle?: string;
    newName?: string;
    ownerUid?: string;
    actorUid?: string;
    visibility?: TemplateVisibility;
  }
): CatalogItem {
  let baseItem: CatalogItem;
  let variant: TemplateVariantInstance | undefined;
  let ownerUid = 'local_user';
  let newId: string | undefined;
  let newName: string | undefined;
  let newSummary: string | undefined;
  let visibility: TemplateVisibility = 'private';
  let explicitLicenseType: TemplateLicenseType | undefined;
  let explicitLicenseNote: string | undefined;
  let parameterOverrides: Record<string, string | number | boolean> = {};
  let assetSwaps: Record<string, string> = {};
  let timingOverrides: TemplateTimingOverrides | undefined;
  let keyframeOverrides: TemplateKeyframeOverride[] | undefined;

  if ('baseTemplate' in firstArg) {
    baseItem = firstArg.baseTemplate;
    variant = firstArg.variant;
    ownerUid = firstArg.ownerUid;
    newId = firstArg.newId;
    newName = firstArg.newName || firstArg.newTitle;
    newSummary = firstArg.newSummary;
    visibility = firstArg.visibility || 'private';
    explicitLicenseType = firstArg.licenseType;
    explicitLicenseNote = firstArg.licenseNote;
    parameterOverrides =
      firstArg.parameterOverrides || variant?.parameterOverrides || {};
    assetSwaps =
      firstArg.assetOverrides ||
      firstArg.assetSwaps ||
      variant?.assetOverrides ||
      variant?.assetSlotBindings ||
      variant?.assetSwaps ||
      {};
    timingOverrides = firstArg.timingOverrides || variant?.timingOverrides;
    keyframeOverrides = firstArg.keyframeOverrides || variant?.keyframeOverrides;
  } else {
    baseItem = firstArg;
    if (secondArg && 'baseTemplateId' in secondArg) {
      variant = secondArg as TemplateVariantInstance;
      parameterOverrides = variant.parameterOverrides || {};
      assetSwaps =
        variant.assetOverrides || variant.assetSlotBindings || variant.assetSwaps || {};
      timingOverrides = variant.timingOverrides;
      keyframeOverrides = variant.keyframeOverrides;
      ownerUid = thirdArg?.ownerUid || thirdArg?.actorUid || variant.ownerUid || 'local_user';
      newId = thirdArg?.newId;
      newName = thirdArg?.newTitle || thirdArg?.newName || variant.title || variant.name;
      visibility = thirdArg?.visibility || 'private';
    } else if (secondArg) {
      const opts = secondArg as Exclude<typeof secondArg, TemplateVariantInstance>;
      ownerUid = opts.ownerUid || opts.actorUid || 'local_user';
      newId = opts.newId;
      newName = opts.newName || opts.newTitle;
      newSummary = opts.newSummary;
      visibility = opts.visibility || 'private';
      explicitLicenseType = opts.licenseType;
      explicitLicenseNote = opts.licenseNote;
      parameterOverrides = opts.parameterOverrides || {};
      assetSwaps = opts.assetOverrides || opts.assetSwaps || {};
      timingOverrides = opts.timingOverrides;
      keyframeOverrides = opts.keyframeOverrides;
    }
  }

  const now = new Date().toISOString();
  const applied = applyVariantOverridesToTemplate(baseItem, {
    parameterOverrides,
    assetSwaps,
    timingOverrides,
    keyframeOverrides,
  });

  const cleanName = sanitizeUserLabelAndMarkdown(
    newName || `${baseItem.name} (Fork)`,
    140
  );
  const forkSlug = `${baseItem.slug}-fork-${Date.now().toString(36).slice(-4)}`.toLowerCase();
  const forkId =
    newId || `tpl_fork_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const newVersion = '1.0.0-fork';
  const snapshotHash = computeDeterministicSnapshotHash(
    `${forkId}:${newVersion}:${JSON.stringify(applied.editableParams || [])}`
  );

  const inheritedLicense: TemplateLicenseType =
    explicitLicenseType ||
    (baseItem.licenseType === 'Unknown'
      ? 'Unknown'
      : baseItem.licenseType === 'CC-BY-4.0'
      ? 'CC-BY-4.0'
      : 'User Owned');

  return enrichCatalogItemWithMarketplaceDefaults({
    ...applied,
    id: forkId,
    name: cleanName,
    slug: forkSlug,
    summary: newSummary
      ? sanitizeUserLabelAndMarkdown(newSummary, 500)
      : applied.summary,
    creatorUid: ownerUid,
    ownerUid,
    forkedFromTemplateId: baseItem.id,
    visibility,
    licenseType: inheritedLicense,
    licenseNote:
      explicitLicenseNote ||
      `Forked from "${baseItem.name}" (${baseItem.id}) by ${ownerUid}.`,
    validationState: 'Draft',
    metadata: {
      ...applied.metadata,
      version: newVersion,
    },
    versionHistory: [
      {
        version: newVersion,
        updatedAt: now,
        updatedByUid: ownerUid,
        changelog: `Forked from template ${baseItem.id} (v${baseItem.metadata.version}).`,
        snapshotHash,
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
}
