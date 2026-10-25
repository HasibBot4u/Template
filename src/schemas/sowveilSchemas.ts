import { z } from 'zod';

export const ModuleIdEnum = z.enum([
  'text-animation',
  'expressions',
  'easing',
  'sfx',
  'ready-made',
  'ui-saas',
  'liquid-glass',
  'carousel',
  'transitions',
  '3d-models',
  'mockups',
  'logo-reveals',
  'backgrounds',
  'overlays-fx',
  'maps',
  'saas-effects',
  'templates',
  'auto-captions',
  'downloader',
  'project-library',
]);

export const TargetMobileEditorIdEnum = z.enum([
  'capcut',
  'alight-motion',
  'node-video',
  'kinemaster',
  'sowveil-project',
  'universal-bundle',
]);

export const EditorCompatibilityStatusEnum = z.enum([
  'Verified',
  'Tested subset',
  'Experimental',
  'Media handoff only',
  'Needs target-app validation',
  'Unsupported',
]);

export const ExportArtifactFormatEnum = z.enum([
  'sowveil-json',
  'alight-xml',
  'zip-bundle',
  'svg-frame',
  'png-still',
  'wav-audio',
  'srt-captions',
  'vtt-captions',
  'json-captions',
  'webm-video',
]);

export const CapabilityStatusEnum = z.enum([
  'Available',
  'Needs setup',
  'Disconnected',
  'Unsupported',
  'Failed',
  'Not yet implemented',
]);

export const AssetKindEnum = z.enum([
  'image',
  'video',
  'audio',
  'ae-project',
  'ae-template',
  'svg',
  'model3d',
  'scene-spec',
  'expression',
  'curve',
]);

export const CapabilityTypeEnum = z.enum([
  'text-preset',
  'expression-preset',
  'easing-curve',
  'sfx-audio',
  'comp-template',
  'liquid-glass-effect',
  'carousel-builder',
  'transition-template',
  'render-asset',
  'mockup-template',
  'logo-reveal',
  'background-generator',
  'overlay-fx',
  'map-route',
  'saas-effect',
  'caption-utility',
  'media-downloader',
  'project-manager',
]);

export const PreviewRenderKindEnum = z.enum([
  'text-rise-up',
  'text-soft-focus',
  'text-pop',
  'text-slide-in',
  'text-decode',
  'text-shine',
  'text-cyber-security',
  'text-ge-title',
  'text-modern-title',
  'expression-wiggle',
  'expression-sine-wave',
  'expression-bounce',
  'expression-loop-out',
  'expression-spin',
  'easing-curve',
  'sfx-waveform',
  'ready-made-ai-switcher',
  'ready-made-folder-scene',
  'ready-made-follower-notif',
  'ui-saas-gift',
  'ui-saas-notif',
  'ui-saas-widget',
  'ui-saas-keyboard',
  'liquid-glass-panel',
  'liquid-glass-social',
  'liquid-glass-card',
  'carousel-builder',
  'carousel-sphere',
  'transition-vertical-glow',
  'model3d-glossy-shape',
  'mockup-laptop-phone',
  'logo-camera-reveal',
  'logo-retrowave',
  'background-gradient-builder',
  'background-dynamic-grid',
  'overlay-retro-shape',
  'overlay-sci-fi-screen',
  'overlay-pixel-burst',
  'map-location-marker',
  'map-route-widget',
  'saas-splash-click',
  'saas-depth-reveal',
  'saas-cursor-click',
  'template-motion-card',
]);

export const EditableTemplateParamSchema = z
  .object({
    key: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/),
    label: z.string().trim().min(1).max(80),
    type: z.enum(['text', 'number', 'color', 'select', 'boolean']),
    defaultValue: z.union([z.string().max(240), z.number(), z.boolean()]),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    options: z.array(z.string().max(80)).max(20).optional(),
    unit: z.string().max(16).optional(),
  })
  .strict();

export const CatalogCreateSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_\-]+$/),
    moduleId: ModuleIdEnum,
    name: z.string().trim().min(1).max(140),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(140)
      .regex(/^[a-z0-9_\-]+$/i),
    summary: z.string().trim().min(1).max(500),
    description: z.string().trim().min(1).max(2000),
    categoryId: z.string().trim().min(1).max(64),
    packLabel: z.string().trim().min(1).max(120),
    tags: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    assetKind: AssetKindEnum.default('scene-spec'),
    capabilityType: CapabilityTypeEnum.default('text-preset'),
    previewKind: PreviewRenderKindEnum.default('text-rise-up'),
    status: CapabilityStatusEnum.default('Available'),
    statusReason: z
      .string()
      .trim()
      .max(300)
      .default('Mobile browser preview & Editor Gateway export ready'),
    licenseType: z
      .enum(['Original Demo Specification', 'Reference Metadata Only', 'User Owned'])
      .default('Original Demo Specification'),
    licenseNote: z
      .string()
      .trim()
      .max(400)
      .default('Original procedural specification created in Sowveil Studio.'),
    sourceType: z
      .enum(['original-svg-css', 'procedural-canvas', 'reference-seed'])
      .default('original-svg-css'),
    visibility: z.enum(['published', 'draft', 'archived']).default('published'),
    supportsTemplateComparison: z.boolean().default(true),
    favoritesCompatible: z.boolean().default(true),
    supportedExportFormats: z
      .array(ExportArtifactFormatEnum)
      .max(6)
      .default(['sowveil-json', 'alight-xml', 'zip-bundle', 'svg-frame']),
    editableParams: z.array(EditableTemplateParamSchema).max(12).optional(),
    version: z.string().trim().min(1).max(32).default('1.0.0'),
  })
  .strict();

export const CatalogPatchSchema = z
  .object({
    moduleId: ModuleIdEnum.optional(),
    name: z.string().trim().min(1).max(140).optional(),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(140)
      .regex(/^[a-z0-9_\-]+$/i)
      .optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().min(1).max(2000).optional(),
    categoryId: z.string().trim().min(1).max(64).optional(),
    packLabel: z.string().trim().min(1).max(120).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
    assetKind: AssetKindEnum.optional(),
    capabilityType: CapabilityTypeEnum.optional(),
    previewKind: PreviewRenderKindEnum.optional(),
    status: CapabilityStatusEnum.optional(),
    statusReason: z.string().trim().max(300).optional(),
    licenseType: z
      .enum(['Original Demo Specification', 'Reference Metadata Only', 'User Owned'])
      .optional(),
    licenseNote: z.string().trim().max(400).optional(),
    sourceType: z
      .enum(['original-svg-css', 'procedural-canvas', 'reference-seed'])
      .optional(),
    visibility: z.enum(['published', 'draft', 'archived']).optional(),
    supportsTemplateComparison: z.boolean().optional(),
    favoritesCompatible: z.boolean().optional(),
    supportedExportFormats: z.array(ExportArtifactFormatEnum).max(6).optional(),
    editableParams: z.array(EditableTemplateParamSchema).max(12).optional(),
    version: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export const ModuleAdminPatchSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    shortLabel: z.string().trim().min(1).max(40).optional(),
    description: z.string().trim().min(1).max(400).optional(),
    displayOrder: z.number().int().min(1).max(20).optional(),
    enabled: z.boolean().optional(),
    icon: z.string().trim().min(1).max(40).optional(),
    integrationAvailabilityMessage: z.string().trim().max(300).optional(),
    confirmationReason: z.string().trim().max(300).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (
      val.enabled === false &&
      (!val.confirmationReason || val.confirmationReason.trim().length < 5)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmationReason'],
        message:
          'Disabling a module requires an explicit confirmation reason (at least 5 characters) for the audit log.',
      });
    }
  });

export const EditorAdapterAdminPatchSchema = z
  .object({
    compatibilityStatus: EditorCompatibilityStatusEnum.optional(),
    secondaryValidationBadge: EditorCompatibilityStatusEnum.nullable().optional(),
    defaultExportFormat: ExportArtifactFormatEnum.optional(),
    supportedFormats: z.array(ExportArtifactFormatEnum).min(1).max(6).optional(),
    verifiedFormats: z.array(ExportArtifactFormatEnum).max(6).optional(),
    testedVersions: z.string().trim().max(120).optional(),
    honestCapabilitySummary: z.string().trim().min(5).max(500).optional(),
    limitationsNote: z.string().trim().min(5).max(500).optional(),
    docsUrl: z.string().trim().url().max(300).optional(),
    lastValidationDate: z.string().trim().max(40).optional(),
    verificationNote: z.string().trim().max(600).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.compatibilityStatus === 'Verified') {
      if (!val.verificationNote || val.verificationNote.trim().length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['verificationNote'],
          message:
            'Cannot mark an editor adapter as "Verified" without a verification note / test record (min 10 characters).',
        });
      }
      if (!val.testedVersions || val.testedVersions.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['testedVersions'],
          message:
            'Cannot mark an editor adapter as "Verified" without specifying tested target-app versions.',
        });
      }
    }
  });

export const AssetMetadataCreateSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9_\-]+$/)
      .optional(),
    title: z.string().trim().min(1).max(160),
    moduleId: ModuleIdEnum,
    catalogItemId: z.string().trim().max(128).optional(),
    assetKind: AssetKindEnum,
    licenseType: z.enum([
      'Original Demo Specification',
      'Reference Metadata Only',
      'User Owned',
    ]),
    licenseNote: z.string().trim().min(1).max(500),
    sourceNote: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(80).default('application/json'),
    sizeBytes: z.number().int().min(0).nullable().default(null),
    status: z.enum(['metadata-only', 'stored', 'archived']).default('metadata-only'),
  })
  .strict();

export const AssetMetadataPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    licenseType: z
      .enum(['Original Demo Specification', 'Reference Metadata Only', 'User Owned'])
      .optional(),
    licenseNote: z.string().trim().min(1).max(500).optional(),
    sourceNote: z.string().trim().min(1).max(500).optional(),
    status: z.enum(['metadata-only', 'stored', 'archived']).optional(),
  })
  .strict();

export const PlatformSettingsPatchSchema = z
  .object({
    exportMaxSizeMb: z.number().int().min(1).max(500).optional(),
    userDailyExportQuota: z.number().int().min(1).max(10000).optional(),
    jobRetentionDays: z.number().int().min(1).max(365).optional(),
    archivedCatalogRetentionDays: z.number().int().min(1).max(730).optional(),
    allowPublicCatalogBrowsing: z.boolean().optional(),
    enableAlightMotionXmlExport: z.boolean().optional(),
    enableUniversalZipBundles: z.boolean().optional(),
    enableWebShareHandoff: z.boolean().optional(),
    maintenanceBannerText: z.string().trim().max(240).optional(),
    integrationStatusHeadline: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const UserRoleAssignmentSchema = z
  .object({
    role: z.enum(['user', 'admin', 'owner']),
    reason: z.string().trim().min(3).max(300).default('Administrative role update'),
  })
  .strict();

export const UserStatusUpdateSchema = z
  .object({
    status: z.enum(['active', 'suspended', 'pending']),
    reason: z.string().trim().min(3).max(300).default('Administrative account status change'),
  })
  .strict();

/**
 * Redacts tokens, API keys, local file paths, and signed URLs from diagnostic or audit strings.
 */
export function redactSensitiveDiagnosticString(input: string): string {
  if (!input) return '';
  return input
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/AIza[0-9A-Za-z\-_]{25,}/g, '[REDACTED_API_KEY]')
    .replace(/(?:eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})/g, '[REDACTED_JWT]')
    .replace(/(?:\/Users\/|\/home\/|C:\\Users\\)[^\s"']+/g, '[REDACTED_LOCAL_PATH]')
    .replace(/https?:\/\/[^\s"']*(?:X-Goog-Signature|token|signature|sig)=[^\s"']+/gi, '[REDACTED_SIGNED_URL]')
    .slice(0, 800);
}
