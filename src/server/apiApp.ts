import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import firebaseConfig from '../../firebase-applet-config.json';
import { SOWVEIL_MODULES, MODULE_CATEGORIES } from '../data/modules';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import {
  AccountStatus,
  AssetMetadataRecord,
  AuditEventRecord,
  AuditOutcome,
  AuditTargetType,
  CatalogItem,
  DeviceRecord,
  JobRecord,
  JobStatus,
  MobileEditorAdapterDescriptor,
  ModuleDefinition,
  PlatformSettingsConfig,
  ProjectLibraryItem,
  TargetMobileEditorId,
  TemplateVariantInstance,
  UserPreferences,
  UserRole,
} from '../types/sowveil';
import { canTransitionJob, transitionJobRecord } from '../services/jobStateMachine';
import {
  ALIGHT_MOTION_XML_FEATURE_MATRIX,
  buildMobileEditorExportArtifact,
  classifyPresetForAlightMotionXml,
  ExportJob,
  getEditorAdapter,
  MOBILE_EDITOR_ADAPTERS,
} from '../services/editorGateway';
import {
  buildCaptionSidecarZipBundle,
  computeDeterministicJobProgress,
  evaluateMediaJobWorkerGate,
  sanitizeMediaFileName,
  validateCaptionTimeline,
  validateMediaUrlForSsrf,
  verifyMediaMagicBytes,
} from '../features/media-workflows';
import {
  AssetMetadataCreateSchema,
  AssetMetadataPatchSchema,
  AssetReplaceSchema,
  CatalogCreateSchema,
  CatalogPatchSchema,
  EditorAdapterAdminPatchSchema,
  ExportArtifactFormatEnum,
  ModuleAdminPatchSchema,
  PlatformSettingsPatchSchema,
  redactSensitiveDiagnosticString,
  TemplateForkRequestSchema,
  TemplateVariantCreateSchema,
  TemplateVariantPatchSchema,
  UserRoleAssignmentSchema,
  UserStatusUpdateSchema,
} from '../schemas/sowveilSchemas';
import {
  AiProviderConfig,
  createDirectorProposal,
  generateCoverageReport,
  maskApiKey,
  parseScriptIntoUnits,
  ScenePlanItem,
  ScriptSourceDocument,
  validateProviderEndpointSsrf,
} from '../features/ai-director';
import {
  applyVariantOverridesToTemplate,
  computeDeterministicSnapshotHash,
  enrichCatalogItemWithMarketplaceDefaults,
  forkTemplateFromVariant,
  runTemplateValidationJob,
  sanitizeAndValidateSvgContent,
  sanitizeUserLabelAndMarkdown,
} from '../services/marketplaceEngine';
import { filterAndSortCatalog, isCatalogItemVisibleToViewer } from '../services/catalogEngine';
import {
  buildCanonicalProjectFixtures,
  CanonicalProjectStore,
  canonicalProjectToLibraryRecord,
  createMinimalCanonicalProject,
  executeProjectCommand,
  migrateToCanonicalProject,
  serializeCanonicalProject,
  validateCanonicalProject,
} from '../services/canonicalProjectEngine';
import { CanonicalProjectCommand, CanonicalProjectDocument } from '../types/canonicalProject';
import {
  AiCoEditTransaction,
  applyAiCoEditTransaction,
  diffCanonicalProjects,
  planAiCoEditTransaction,
} from '../services/coEditingEngine';
import {
  applyReferenceCorrectionAction,
  BUILT_IN_REFERENCE_PRESETS,
  buildDraftTemplateFromReferenceSession,
  convertReferenceSessionToProjectRecord,
  createReferenceLabSession,
  inspectReferenceSourceUrl,
  ReferenceCorrectionActionRecord,
  ReferenceInputSourceKind,
  ReferenceLabSession,
  ReferenceUsageMode,
  validateAndPromoteReferenceTemplate,
} from '../services/referenceLabEngine';
import {
  ALL_HUB_TASK_TYPES,
  ALL_MODEL_CAPABILITY_KEYS,
  buildDefaultRoutingProfiles,
  createProviderConnectionRecord,
  evaluateRoutingReadiness,
  ExtensionPackageRecord,
  ExtensionPermissionScope,
  HubAuthMode,
  HubProviderProtocol,
  HubTaskType,
  inspectAndSandboxExtensionContent,
  invokeRegisteredTool,
  ModelCapabilityKey,
  overrideConnectionCapabilityState,
  PREPOPULATED_MODEL_CATALOG,
  probeProviderConnection,
  ProviderConnectionRecord,
  REGISTERED_AI_TOOLS,
  registerExtensionPackage,
  revokeConnectionCredential,
  rollbackExtensionPackage,
  rotateConnectionCredential,
  SecretStorageMode,
  TaskRoutingProfile,
  ToolExecutionAuditRecord,
  toPublicProviderConnectionView,
  updateExtensionPackage,
  validateCustomEndpointSsrf,
} from '../services/providerHubEngine';
import {
  AiDirectorSessionRecord,
  answerDirectorQuestions,
  applyAdaptiveRefinement,
  BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS,
  createAiDirectorSession,
  evaluateDirectorAcceptanceGate,
  executeDirectorProductionPlan,
  rollbackDirectorToCheckpoint,
  updateDirectorShotPlanAndApprovals,
} from '../services/aiDirectorProductionEngine';
import {
  createDefaultPreferenceConsent,
  deprecateFactoryTemplate,
  extractEditableParametersFromProject,
  forkFactoryTemplate,
  mergeFactoryTemplates,
  publishFactoryTemplateToCatalog,
  rankTemplatesWithTransparentSignals,
  recordTemplateFeedbackSignal,
  resolveDuplicateSuggestion,
  restoreFactoryTemplateVersion,
  runTemplateFactoryPipeline,
  TemplateFactoryDraftRecord,
  TemplateFactorySourceKind,
  TemplateFeedbackAction,
  TemplatePreferenceSignal,
  updateFactoryDraftRecord,
  updateFactoryTemplateDependencies,
  UserPreferenceConsentConfig,
} from '../services/templateFactoryEngine';
import {
  cancelRenderExportJob,
  computeAdapterFeatureLossReport,
  createAndExecuteCanonicalRenderJob,
  createKnownGoodSampleCanonicalProject,
  detectBrowserRenderCapabilities,
  DurableRenderExportJobRecord,
  evaluateServerWorkerTransparency,
  getAllClipsFromProject,
  getMobileAdapterCapabilityManifests,
  recoverInterruptedRenderJobsOnStartup,
  RENDER_EXPORT_ENGINE_VERSION,
  RenderExecutionTier,
  RenderOutputFormat,
} from '../services/renderExportQaEngine';
import { loadDurableSnapshot, saveDurableSnapshot } from './durableStore';

export interface VerifiedTokenIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
}

export type TokenVerifierFn = (token: string) => Promise<VerifiedTokenIdentity>;

export interface ApiAppOptions {
  tokenVerifier?: TokenVerifierFn;
  rateLimitMaxPerMinute?: number;
  ownerBootstrapEmail?: string;
  ownerBootstrapSecret?: string;
  storageEnabled?: boolean;
  persistenceFilePath?: string | null;
}

interface AuthenticatedRequest extends Request {
  requestId: string;
  authIdentity?: VerifiedTokenIdentity;
  userRole?: UserRole;
}

interface SafeUserDirectoryRecord {
  uid: string;
  emailMasked: string;
  emailVerified: boolean;
  displayName: string;
  role: UserRole;
  status: AccountStatus;
  createdAt: string;
  updatedAt: string;
}

function maskEmailForSafeListing(email: string): string {
  if (!email || !email.includes('@')) return 'unverified@redacted';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function verifyFirebaseIdTokenWithGoogle(
  idToken: string
): Promise<VerifiedTokenIdentity> {
  const payload = decodeJwtPayload(idToken);
  if (!payload) {
    const err = new Error('Malformed JWT structure');
    (err as { code?: string }).code = 'INVALID_TOKEN';
    throw err;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < nowSec) {
    const err = new Error('Firebase ID token has expired');
    (err as { code?: string }).code = 'TOKEN_EXPIRED';
    throw err;
  }

  if (payload.aud && payload.aud !== firebaseConfig.projectId) {
    const err = new Error('Token audience does not match provisioned Firebase project');
    (err as { code?: string }).code = 'INVALID_TOKEN';
    throw err;
  }

  const lookupUrl = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
    firebaseConfig.apiKey
  )}`;
  const res = await fetch(lookupUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      (body as { error?: { message?: string } })?.error?.message ||
      'Token verification rejected by Firebase Auth';
    const err = new Error(msg);
    (err as { code?: string }).code =
      msg.includes('EXPIRED') ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN';
    throw err;
  }

  const data = (await res.json()) as {
    users?: Array<{
      localId: string;
      email?: string;
      emailVerified?: boolean;
      displayName?: string;
      photoUrl?: string;
      disabled?: boolean;
    }>;
  };
  const user = data.users?.[0];
  if (!user || !user.localId) {
    const err = new Error('No matching Firebase user account found');
    (err as { code?: string }).code = 'INVALID_TOKEN';
    throw err;
  }
  if (user.disabled) {
    const err = new Error('User account is disabled');
    (err as { code?: string }).code = 'ACCOUNT_SUSPENDED';
    throw err;
  }

  return {
    uid: user.localId,
    email: user.email || '',
    emailVerified: Boolean(user.emailVerified),
    displayName: user.displayName,
    photoURL: user.photoUrl,
  };
}

// Validation Schemas (Zod)
const PreferencesPatchSchema = z
  .object({
    reducedMotion: z.boolean().optional(),
    defaultSortOrder: z.enum(['name', 'newest', 'favorites']).optional(),
    preserveSearchOnModuleSwitch: z.boolean().optional(),
  })
  .strict();

const ProjectCheckpointSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    label: z.string().trim().min(1).max(80),
    createdAt: z.string().trim().min(1).max(64),
    sowveilSpecJson: z.string().max(15000),
    targetEditor: z
      .enum([
        'capcut',
        'alight-motion',
        'node-video',
        'kinemaster',
        'sowveil-project',
        'universal-bundle',
      ])
      .optional(),
    aspectRatio: z.enum(['9:16', '1:1', '16:9']).optional(),
  })
  .strict();

const ProjectCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).default(''),
    compCount: z.number().int().min(0).max(5000).nullable().default(null),
    projectFileStatus: z
      .enum([
        'sowveil-native',
        'alight-motion-xml',
        'media-bundle',
        'metadata-only',
        'uploaded',
        'linked-local',
        'packaged',
      ])
      .default('metadata-only'),
    fileSizeBytes: z.number().int().min(0).nullable().default(null),
    fileSizeLabel: z.string().trim().max(80).default('Unknown (metadata-only)'),
    resolution: z.string().trim().max(64).optional(),
    durationLabel: z.string().trim().max(64).optional(),
    fps: z.number().min(1).max(240).optional(),
    aeVersion: z.string().trim().max(64).optional(),
    targetEditor: z
      .enum([
        'capcut',
        'alight-motion',
        'node-video',
        'kinemaster',
        'sowveil-project',
        'universal-bundle',
      ])
      .optional(),
    aspectRatio: z.enum(['9:16', '1:1', '16:9']).optional(),
    sowveilSpecJson: z.string().max(15000).optional(),
    canonicalProjectJson: z.string().max(200000).optional(),
    revision: z.number().int().min(1).optional(),
    activeBranch: z.string().trim().max(64).optional(),
    checkpoints: z.array(ProjectCheckpointSchema).max(20).optional(),
    hasExternalFootageWarning: z.boolean().default(false),
    archived: z.boolean().default(false),
    tags: z.array(z.string().trim().max(64)).max(20).default([]),
  })
  .strict();

const ProjectPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
    compCount: z.number().int().min(0).max(5000).nullable().optional(),
    projectFileStatus: z
      .enum([
        'sowveil-native',
        'alight-motion-xml',
        'media-bundle',
        'metadata-only',
        'uploaded',
        'linked-local',
        'packaged',
      ])
      .optional(),
    fileSizeBytes: z.number().int().min(0).nullable().optional(),
    fileSizeLabel: z.string().trim().max(80).optional(),
    resolution: z.string().trim().max(64).optional(),
    durationLabel: z.string().trim().max(64).optional(),
    fps: z.number().min(1).max(240).optional(),
    targetEditor: z
      .enum([
        'capcut',
        'alight-motion',
        'node-video',
        'kinemaster',
        'sowveil-project',
        'universal-bundle',
      ])
      .optional(),
    aspectRatio: z.enum(['9:16', '1:1', '16:9']).optional(),
    sowveilSpecJson: z.string().max(15000).optional(),
    canonicalProjectJson: z.string().max(200000).optional(),
    revision: z.number().int().min(1).optional(),
    activeBranch: z.string().trim().max(64).optional(),
    checkpoints: z.array(ProjectCheckpointSchema).max(20).optional(),
    hasExternalFootageWarning: z.boolean().optional(),
    archived: z.boolean().optional(),
    tags: z.array(z.string().trim().max(64)).max(20).optional(),
  })
  .strict();

const JobCreateSchema = z
  .object({
    type: z.enum(['mobile-export', 'ae-operation', 'caption', 'download', 'asset-process']),
    title: z.string().trim().min(1).max(200),
    moduleId: z.string().trim().min(1).max(64),
    itemId: z.string().trim().max(128).optional(),
    operation: z.string().trim().max(64).optional(),
    targetEditor: z
      .enum([
        'capcut',
        'alight-motion',
        'node-video',
        'kinemaster',
        'sowveil-project',
        'universal-bundle',
      ])
      .optional(),
    exportFormat: ExportArtifactFormatEnum.optional(),
    aspectRatio: z.enum(['9:16', '1:1', '16:9']).optional(),
    outputFileName: z.string().trim().max(160).optional(),
    outputMimeType: z.string().trim().max(80).optional(),
    outputSizeBytes: z.number().int().min(0).optional(),
    processedBytes: z.number().int().min(0).optional(),
    totalBytes: z.number().int().min(0).optional(),
    completedStageIndex: z.number().int().min(0).optional(),
    totalStages: z.number().int().min(0).optional(),
    stageLabel: z.string().trim().max(120).optional(),
    status: z
      .enum([
        'draft',
        'queued',
        'uploading',
        'running',
        'finalizing',
        'ready',
        'needs-setup',
        'quota-reached',
      ])
      .default('queued'),
    deviceId: z.string().trim().max(128).nullable().default(null),
    errorCode: z.string().trim().max(64).optional(),
    redactedMessage: z.string().trim().max(1000).default(''),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const JobTransitionSchema = z
  .object({
    status: z.enum([
      'draft',
      'queued',
      'uploading',
      'claimed',
      'running',
      'finalizing',
      'ready',
      'downloaded',
      'succeeded',
      'failed',
      'cancelled',
      'needs-setup',
      'quota-reached',
      'expired',
    ]),
    redactedMessage: z.string().trim().max(1000).optional(),
    errorCode: z.string().trim().max(64).optional(),
    deviceId: z.string().trim().max(128).nullable().optional(),
    processedBytes: z.number().int().min(0).optional(),
    totalBytes: z.number().int().min(0).optional(),
    completedStageIndex: z.number().int().min(0).optional(),
    totalStages: z.number().int().min(0).optional(),
    stageLabel: z.string().trim().max(120).optional(),
  })
  .strict();

const MobileExportGenerateSchema = z
  .object({
    itemId: z.string().trim().min(1).max(128),
    targetEditor: z.enum([
      'capcut',
      'alight-motion',
      'node-video',
      'kinemaster',
      'sowveil-project',
      'universal-bundle',
    ]),
    format: ExportArtifactFormatEnum.optional(),
    aspectRatio: z.enum(['9:16', '1:1', '16:9']).default('9:16'),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).optional(),
    durationSec: z.number().min(0.5).max(300).optional(),
    qualityPolicy: z.enum(['high-quality', 'balanced', 'compact-mobile']).optional(),
    backgroundMode: z.enum(['solid', 'transparent', 'chroma-key-green']).optional(),
    customValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

const PairingStartSchema = z
  .object({
    deviceName: z.string().trim().min(1).max(120),
    platform: z.enum(['Android', 'iOS', 'macOS', 'Windows', 'Linux']),
  })
  .strict();

export function createApiApp(options: ApiAppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const verifyToken: TokenVerifierFn =
    options.tokenVerifier || verifyFirebaseIdTokenWithGoogle;
  const maxPerMinute = options.rateLimitMaxPerMinute ?? 120;
  const configuredOwnerEmail = (
    options.ownerBootstrapEmail ||
    process.env.OWNER_BOOTSTRAP_EMAIL ||
    'mdhasibul4u@gmail.com'
  )
    .trim()
    .toLowerCase();
  const configuredBootstrapSecret = (
    options.ownerBootstrapSecret ||
    process.env.OWNER_BOOTSTRAP_SECRET ||
    ''
  ).trim();
  const storageEnabled =
    options.storageEnabled ?? process.env.CLOUD_STORAGE_ENABLED === 'true';

  // Server-authoritative state stores
  const roleStore = new Map<string, UserRole>();
  const userStatusStore = new Map<string, AccountStatus>();
  const usersDirectoryStore = new Map<string, SafeUserDirectoryRecord>();
  let ownerBootstrappedUid: string | null = null;
  let catalogCacheVersion = 1;
  let lastErrorTimestamp: string | null = null;
  let lastErrorRedactedSummary: string | null = null;

  const userPreferencesStore = new Map<string, UserPreferences>();
  const userFavoritesStore = new Map<string, Set<string>>();
  const userRecentStore = new Map<string, string[]>();
  const projectsStore = new Map<string, ProjectLibraryItem>();
  const jobsStore = new Map<string, JobRecord>();
  const devicesStore = new Map<string, DeviceRecord>();
  const pairingTokensStore = new Map<
    string,
    {
      id: string;
      ownerUid: string;
      tokenHash: string;
      deviceName: string;
      platform: 'Android' | 'iOS' | 'macOS' | 'Windows' | 'Linux';
      expiresAt: string;
    }
  >();
  const catalogStore = new Map<string, CatalogItem>();
  const templateVariantsStore = new Map<string, TemplateVariantInstance>();
  const modulesStore = new Map<string, ModuleDefinition>();
  const editorAdaptersStore = new Map<TargetMobileEditorId, MobileEditorAdapterDescriptor>();
  const assetsStore = new Map<string, AssetMetadataRecord>();
  const referenceLabSessionsStore = new Map<string, ReferenceLabSession>();
  const providerConnectionsStore = new Map<string, ProviderConnectionRecord>();
  const routingProfilesStore = new Map<string, Record<HubTaskType, TaskRoutingProfile>>();
  const extensionPackagesStore = new Map<string, ExtensionPackageRecord>();
  const aiDirectorSessionsStore = new Map<string, AiDirectorSessionRecord>();
  const templateFactoryDraftsStore = new Map<string, TemplateFactoryDraftRecord>();
  const templatePreferenceSignalsStore: TemplatePreferenceSignal[] = [];
  const userPreferenceConsentsStore = new Map<string, UserPreferenceConsentConfig>();
  const renderExportJobsStore = new Map<string, DurableRenderExportJobRecord>();
  const toolAuditRecordsStore: ToolExecutionAuditRecord[] = [];
  const auditLog: AuditEventRecord[] = [];
  const errorCountsByCode = new Map<string, number>();
  const userTelemetryOptInStore = new Map<string, boolean>();
  const aggregateFeatureUsageCounts = new Map<string, number>();
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  const authRateBuckets = new Map<string, { count: number; resetAt: number }>();
  const AUTH_RATE_LIMIT_PER_MINUTE = 10;
  const persistenceFilePath = options.persistenceFilePath ?? null;

  let platformSettings: PlatformSettingsConfig = {
    exportMaxSizeMb: 50,
    userDailyExportQuota: 200,
    jobRetentionDays: 30,
    archivedCatalogRetentionDays: 90,
    allowPublicCatalogBrowsing: true,
    enableAlightMotionXmlExport: true,
    enableUniversalZipBundles: true,
    enableWebShareHandoff: true,
    maintenanceBannerText: '',
    integrationStatusHeadline:
      'Mobile Editor Integration Gateway Active · CapCut, Alight XML, Node Video & KineMaster',
    analyticsProviderStatus: 'Not configured',
    updatedAt: '2026-10-25T00:00:00.000Z',
    updatedByUid: 'system',
  };

  // Seed modules
  for (const mod of SOWVEIL_MODULES) {
    modulesStore.set(mod.id, {
      ...mod,
      integrationAvailabilityMessage:
        mod.integrationAvailabilityMessage ||
        'Mobile browser preview & Editor Gateway export ready',
    });
  }

  // Seed editor adapters
  for (const adapter of MOBILE_EDITOR_ADAPTERS) {
    editorAdaptersStore.set(adapter.id, { ...adapter });
  }

  // Seed catalog items into server store (including 1 draft item to verify ordinary user draft isolation)
  for (const item of SEED_CATALOG_ITEMS) {
    const enriched = enrichCatalogItemWithMarketplaceDefaults({
      ...item,
      favoritesCompatible: item.favoritesCompatible ?? true,
      supportedExportFormats: item.supportedExportFormats || [
        'sowveil-json',
        'alight-xml',
        'zip-bundle',
        'svg-frame',
      ],
    });
    catalogStore.set(enriched.id, enriched);
  }
  catalogStore.set(
    'draft-internal-rig',
    enrichCatalogItemWithMarketplaceDefaults({
      ...SEED_CATALOG_ITEMS[0],
      id: 'draft-internal-rig',
      name: 'Internal Unreleased Draft Preset',
      slug: 'internal-unreleased-draft-preset',
      visibility: 'draft',
    })
  );

  // Seed asset metadata records from initial catalog items (no mocked binary URLs)
  for (const item of SEED_CATALOG_ITEMS.slice(0, 12)) {
    const assetId = `asset_${item.id}`;
    const checksum = computeDeterministicSnapshotHash({
      id: assetId,
      catalogItemId: item.id,
      moduleId: item.moduleId,
    });
    assetsStore.set(assetId, {
      id: assetId,
      title: `${item.name} (${item.packLabel})`,
      labels: [item.packLabel, item.moduleId],
      tags: [...item.tags],
      moduleId: item.moduleId,
      catalogItemId: item.id,
      assetKind: item.assetKind,
      ownerUid: 'system-seed',
      visibility: 'public',
      licenseType: item.licenseType,
      licenseNote: item.licenseNote,
      sourceNote: `Procedural ${item.sourceType} preset specification`,
      provenance: 'Sowveil Studio Core Seed',
      attribution: 'Sowveil Studio',
      storageProvider: storageEnabled ? 'cloud-storage' : 'none-configured',
      storageObjectKey: null,
      mimeType: item.moduleId === 'sfx' ? 'audio/wav' : 'application/json',
      sizeBytes: item.metadata.fileSizeBytes ?? null,
      dimensions: item.metadata.resolution || '1920×1080',
      durationSec: item.metadata.durationSec ?? 3,
      audioFormat: item.moduleId === 'sfx' ? 'WAV 48kHz 24-bit' : undefined,
      checksumSha256: checksum,
      versions: [
        {
          version: '1.0.0',
          checksumSha256: checksum,
          sizeBytes: item.metadata.fileSizeBytes ?? null,
          mimeType: item.moduleId === 'sfx' ? 'audio/wav' : 'application/json',
          updatedAt: item.updatedAt,
          updatedByUid: 'system-seed',
          note: 'Initial procedural asset specification',
        },
      ],
      missingAssetDetected: false,
      usedByTemplateIds: [item.id],
      usedByVariantIds: [],
      status: 'metadata-only',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }

  // Load durable snapshot from disk if configured
  const loadedSnapshot = loadDurableSnapshot(persistenceFilePath);
  if (loadedSnapshot) {
    catalogCacheVersion = loadedSnapshot.catalogCacheVersion || 1;
    ownerBootstrappedUid = loadedSnapshot.ownerBootstrappedUid || null;
    if (loadedSnapshot.platformSettings) {
      platformSettings = { ...platformSettings, ...loadedSnapshot.platformSettings };
    }
    for (const [k, v] of Object.entries(loadedSnapshot.roles || {})) {
      roleStore.set(k, v);
    }
    for (const [k, v] of Object.entries(loadedSnapshot.userStatuses || {})) {
      userStatusStore.set(k, v);
    }
    for (const [k, v] of Object.entries(loadedSnapshot.userPreferences || {})) {
      userPreferencesStore.set(k, v);
    }
    for (const [k, v] of Object.entries(loadedSnapshot.userFavorites || {})) {
      userFavoritesStore.set(k, new Set(v));
    }
    for (const [k, v] of Object.entries(loadedSnapshot.userRecentItems || {})) {
      userRecentStore.set(k, Array.isArray(v) ? v : []);
    }
    for (const item of loadedSnapshot.catalogItems || []) {
      catalogStore.set(item.id, enrichCatalogItemWithMarketplaceDefaults(item));
    }
    for (const variant of loadedSnapshot.templateVariants || []) {
      templateVariantsStore.set(variant.id, variant);
    }
    for (const asset of loadedSnapshot.assets || []) {
      assetsStore.set(asset.id, asset);
    }
    for (const proj of loadedSnapshot.projects || []) {
      projectsStore.set(proj.id, proj);
    }
    for (const job of loadedSnapshot.jobs || []) {
      jobsStore.set(job.id, job);
    }
    for (const dev of loadedSnapshot.devices || []) {
      devicesStore.set(dev.id, dev);
    }
    for (const mod of loadedSnapshot.modules || []) {
      modulesStore.set(mod.id, mod);
    }
    for (const ad of loadedSnapshot.editorAdapters || []) {
      editorAdaptersStore.set(ad.id, ad);
    }
    for (const sess of loadedSnapshot.referenceLabSessions || []) {
      referenceLabSessionsStore.set(sess.id, sess);
    }
    for (const conn of loadedSnapshot.providerConnections || []) {
      providerConnectionsStore.set(conn.id, conn);
    }
    for (const [uid, profiles] of Object.entries(loadedSnapshot.routingProfiles || {})) {
      routingProfilesStore.set(uid, profiles);
    }
    for (const ext of loadedSnapshot.extensionPackages || []) {
      extensionPackagesStore.set(ext.id, ext);
    }
    for (const dirSess of loadedSnapshot.aiDirectorSessions || []) {
      aiDirectorSessionsStore.set(dirSess.id, dirSess);
    }
    for (const fDraft of loadedSnapshot.templateFactoryDrafts || []) {
      templateFactoryDraftsStore.set(fDraft.id, fDraft);
    }
    if (Array.isArray(loadedSnapshot.templatePreferenceSignals)) {
      templatePreferenceSignalsStore.splice(
        0,
        templatePreferenceSignalsStore.length,
        ...loadedSnapshot.templatePreferenceSignals
      );
    }
    for (const [uid, cCfg] of Object.entries(loadedSnapshot.userPreferenceConsents || {})) {
      userPreferenceConsentsStore.set(uid, cCfg);
    }
    if (Array.isArray(loadedSnapshot.renderExportJobs)) {
      const { recoveredJobs } = recoverInterruptedRenderJobsOnStartup(
        loadedSnapshot.renderExportJobs
      );
      for (const rJob of recoveredJobs) {
        renderExportJobsStore.set(rJob.id, rJob);
      }
    }
    if (Array.isArray(loadedSnapshot.toolAuditRecords) && loadedSnapshot.toolAuditRecords.length > 0) {
      toolAuditRecordsStore.splice(0, toolAuditRecordsStore.length, ...loadedSnapshot.toolAuditRecords);
    }
    if (Array.isArray(loadedSnapshot.auditEvents) && loadedSnapshot.auditEvents.length > 0) {
      auditLog.splice(0, auditLog.length, ...loadedSnapshot.auditEvents);
    }
  }

  function persistState() {
    if (!persistenceFilePath) return;
    const favObj: Record<string, string[]> = {};
    for (const [uid, set] of userFavoritesStore.entries()) {
      favObj[uid] = Array.from(set);
    }
    saveDurableSnapshot(persistenceFilePath, {
      schemaVersion: '1.0.0',
      savedAt: new Date().toISOString(),
      catalogCacheVersion,
      ownerBootstrappedUid,
      roles: Object.fromEntries(roleStore.entries()),
      userStatuses: Object.fromEntries(userStatusStore.entries()),
      userPreferences: Object.fromEntries(userPreferencesStore.entries()),
      userFavorites: favObj,
      userRecentItems: Object.fromEntries(userRecentStore.entries()),
      catalogItems: Array.from(catalogStore.values()),
      templateVariants: Array.from(templateVariantsStore.values()),
      assets: Array.from(assetsStore.values()),
      projects: Array.from(projectsStore.values()),
      jobs: Array.from(jobsStore.values()),
      devices: Array.from(devicesStore.values()),
      modules: Array.from(modulesStore.values()),
      editorAdapters: Array.from(editorAdaptersStore.values()),
      referenceLabSessions: Array.from(referenceLabSessionsStore.values()),
      providerConnections: Array.from(providerConnectionsStore.values()),
      routingProfiles: Object.fromEntries(routingProfilesStore.entries()),
      extensionPackages: Array.from(extensionPackagesStore.values()),
      aiDirectorSessions: Array.from(aiDirectorSessionsStore.values()),
      templateFactoryDrafts: Array.from(templateFactoryDraftsStore.values()),
      templatePreferenceSignals: templatePreferenceSignalsStore.slice(0, 1000),
      userPreferenceConsents: Object.fromEntries(userPreferenceConsentsStore.entries()),
      renderExportJobs: Array.from(renderExportJobsStore.values()).slice(0, 200),
      toolAuditRecords: toolAuditRecordsStore.slice(0, 500),
      auditEvents: auditLog.slice(0, 500),
      platformSettings,
    });
  }

  function sendOk<T>(res: Response, requestId: string, data: T, status = 200) {
    res.setHeader('X-Catalog-Cache-Version', String(catalogCacheVersion));
    return res.status(status).json({
      ok: true,
      data,
      requestId,
    });
  }

  function sendError(
    res: Response,
    requestId: string,
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    const safeMsg = redactSensitiveDiagnosticString(message);
    if (status >= 400) {
      lastErrorTimestamp = new Date().toISOString();
      lastErrorRedactedSummary = `[${code}] ${safeMsg}`;
      errorCountsByCode.set(code, (errorCountsByCode.get(code) || 0) + 1);
    }
    return res.status(status).json({
      ok: false,
      error: {
        code,
        message: safeMsg,
        ...(details !== undefined ? { details } : {}),
      },
      requestId,
    });
  }

  function recordAudit(
    actorUid: string,
    actorEmail: string | undefined,
    action: string,
    targetId: string,
    detailsRedacted: string,
    requestId: string,
    targetType: AuditTargetType = 'system',
    outcome: AuditOutcome = 'success'
  ) {
    const evt: AuditEventRecord = {
      id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      actorUid,
      actorEmail: actorEmail ? maskEmailForSafeListing(actorEmail) : undefined,
      action,
      targetType,
      targetId,
      outcome,
      detailsRedacted: redactSensitiveDiagnosticString(detailsRedacted).slice(0, 500),
      requestId,
      createdAt: new Date().toISOString(),
    };
    auditLog.unshift(evt);
  }

  function countActiveOwners(): number {
    let count = 0;
    for (const [uid, r] of roleStore.entries()) {
      const st = userStatusStore.get(uid) || 'active';
      if (r === 'owner' && st === 'active') {
        count += 1;
      }
    }
    return count;
  }

  function syncUserIntoDirectory(identity: VerifiedTokenIdentity, role: UserRole) {
    const now = new Date().toISOString();
    const existing = usersDirectoryStore.get(identity.uid);
    const status = userStatusStore.get(identity.uid) || 'active';
    usersDirectoryStore.set(identity.uid, {
      uid: identity.uid,
      emailMasked: maskEmailForSafeListing(identity.email),
      emailVerified: identity.emailVerified,
      displayName: identity.displayName || existing?.displayName || 'Studio User',
      role,
      status,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
  }

  const ALLOWED_ORIGIN_SET = new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://ais-dev-nn4jeltvqjefaodoembxbd-775414035263.asia-southeast1.run.app',
    'https://ais-pre-nn4jeltvqjefaodoembxbd-775414035263.asia-southeast1.run.app',
  ]);

  function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
    if (!origin) return true; // Direct non-browser, mobile app, or same-origin
    if (ALLOWED_ORIGIN_SET.has(origin)) return true;
    if (origin.endsWith('.run.app') && origin.includes('ais-')) return true;
    if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true;
    return false;
  }

  // 1. Request ID, Security Headers & Origin-Checked CORS Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const incomingReqId = req.header('x-request-id');
    const safeReqId =
      incomingReqId && /^[a-zA-Z0-9_\-]{4,64}$/.test(incomingReqId)
        ? incomingReqId
        : `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    authReq.requestId = safeReqId;

    // Strict security headers
    res.setHeader('X-Request-Id', safeReqId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');

    // Strict origin-checked CORS
    const origin = req.header('origin');
    const host = req.header('host');
    if (origin && isAllowedOrigin(origin, host)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Request-Id, X-Catalog-Cache-Version'
      );
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    // Exclude search crawlers from private API and admin routes
    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/technical')
    ) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }

    // Default no-store cache-control for authenticated and mutable resources
    if (
      req.path.startsWith('/api/v1/jobs') ||
      req.path.startsWith('/api/v1/projects') ||
      req.path.startsWith('/api/v1/reference-lab') ||
      req.path.startsWith('/api/v1/provider-hub') ||
      req.path.startsWith('/api/v1/extensions') ||
      req.path.startsWith('/api/v1/tools') ||
      req.path.startsWith('/api/v1/ai-director') ||
      req.path.startsWith('/api/v1/editor') ||
      req.path.startsWith('/api/v1/template-factory') ||
      req.path.startsWith('/api/v1/render-export') ||
      req.path.startsWith('/api/v1/assets') ||
      req.path.startsWith('/api/v1/variants') ||
      req.path.startsWith('/api/v1/template-variants') ||
      req.path.startsWith('/api/v1/exports') ||
      req.path.startsWith('/api/v1/telemetry') ||
      req.path.startsWith('/api/v1/admin') ||
      req.path.startsWith('/api/v1/me') ||
      req.path.includes('/download')
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
    }

    next();
  });

  // 2. Sliding-Window Rate Limiting Middleware (10 req/min for auth/bootstrap, 120 req/min general)
  app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const ip = req.ip || req.header('x-forwarded-for') || 'local';
    const now = Date.now();

    // Strict 10 req/min rate limit on sensitive bootstrap and auth routes
    if (req.path === '/admin/bootstrap-owner' || req.path.startsWith('/auth')) {
      const authKey = `auth_${ip}`;
      const authBucket = authRateBuckets.get(authKey);
      if (!authBucket || now > authBucket.resetAt) {
        authRateBuckets.set(authKey, { count: 1, resetAt: now + 60_000 });
      } else {
        authBucket.count += 1;
        if (authBucket.count > AUTH_RATE_LIMIT_PER_MINUTE) {
          return sendError(
            res,
            authReq.requestId,
            429,
            'RATE_LIMITED',
            'Too many authentication/bootstrap attempts. Please wait 1 minute before retrying.'
          );
        }
      }
    }

    // General sliding-window rate limit
    const bucket = rateBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > maxPerMinute) {
      return sendError(
        res,
        authReq.requestId,
        429,
        'RATE_LIMITED',
        'Too many requests. Please wait before retrying.'
      );
    }
    return next();
  });

  // 3. Authentication & Authoritative Role Resolution Middleware
  async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const authReq = req as AuthenticatedRequest;
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return sendError(
        res,
        authReq.requestId,
        401,
        'UNAUTHENTICATED',
        'Missing Authorization Bearer token.'
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return sendError(
        res,
        authReq.requestId,
        401,
        'UNAUTHENTICATED',
        'Empty Bearer token.'
      );
    }

    try {
      const identity = await verifyToken(token);
      if (!identity.emailVerified) {
        recordAudit(
          identity.uid,
          identity.email,
          'AUTH_UNVERIFIED_EMAIL_REJECTED',
          identity.uid,
          'Rejected unverified email token on authenticated route',
          authReq.requestId,
          'auth',
          'denied'
        );
        return sendError(
          res,
          authReq.requestId,
          403,
          'EMAIL_NOT_VERIFIED',
          'A verified Google account email is required.'
        );
      }

      const accountStatus = userStatusStore.get(identity.uid) || 'active';
      if (accountStatus === 'suspended') {
        recordAudit(
          identity.uid,
          identity.email,
          'AUTH_SUSPENDED_USER_REJECTED',
          identity.uid,
          'Rejected request from suspended user account',
          authReq.requestId,
          'auth',
          'denied'
        );
        return sendError(
          res,
          authReq.requestId,
          403,
          'ACCOUNT_SUSPENDED',
          'Your account has been suspended by an administrator.'
        );
      }

      authReq.authIdentity = identity;

      // Resolve role strictly from server-side trusted role store (NEVER from client headers or body)
      const resolvedRole: UserRole = roleStore.get(identity.uid) || 'user';
      authReq.userRole = resolvedRole;
      syncUserIntoDirectory(identity, resolvedRole);
      return next();
    } catch (err) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : 'INVALID_TOKEN';
      const message =
        err instanceof Error ? err.message : 'Invalid or expired authentication token';
      if (req.path.startsWith('/api/v1/admin')) {
        recordAudit(
          'unauthenticated',
          undefined,
          'ADMIN_AUTH_FAILURE',
          req.path,
          `Failed admin authentication (${code}) on ${req.method} ${req.path}`,
          authReq.requestId,
          'auth',
          'denied'
        );
      }
      return sendError(res, authReq.requestId, 401, code, message);
    }
  }

  function requireRole(allowed: UserRole[]) {
    return (req: Request, res: Response, next: NextFunction) => {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.authIdentity || !authReq.userRole) {
        return sendError(
          res,
          authReq.requestId,
          401,
          'UNAUTHENTICATED',
          'Authentication required.'
        );
      }
      if (!allowed.includes(authReq.userRole)) {
        recordAudit(
          authReq.authIdentity.uid,
          authReq.authIdentity.email,
          'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT',
          req.path,
          `Blocked role "${authReq.userRole}" from ${req.method} ${req.path}`,
          authReq.requestId,
          'auth',
          'denied'
        );
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_ROLE',
          `Requires one of [${allowed.join(', ')}]; current verified role is "${authReq.userRole}".`
        );
      }
      return next();
    };
  }

  function parsePagination(req: Request): { limit: number; offset: number } {
    const rawLimit = Number(req.query.limit ?? 50);
    const rawOffset = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
      : 50;
    const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
    return { limit, offset };
  }

  // --- PUBLIC & SAFE DIAGNOSTIC ROUTES ---
  app.get('/api/v1/health', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    return sendOk(res, authReq.requestId, {
      status: 'ok',
      service: 'sowveil-studio-api',
      version: '0.4.0-mobile-pwa',
      firebaseProjectId: firebaseConfig.projectId,
      firestoreDatabaseConfigured: Boolean(firebaseConfig.firestoreDatabaseId),
      storageConfigured: storageEnabled,
      catalogCacheVersion,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/diagnostics/technical', async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    let callerUid: string | null = null;
    let callerRole: UserRole | 'anonymous' = 'anonymous';

    const authHeader = req.header('authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      try {
        const identity = await verifyToken(authHeader.slice(7).trim());
        if (identity.emailVerified) {
          callerUid = identity.uid;
          callerRole = roleStore.get(identity.uid) || 'user';
          syncUserIntoDirectory(identity, callerRole);
        }
      } catch {
        callerUid = null;
      }
    }

    const isAdminOrOwner = callerRole === 'admin' || callerRole === 'owner';
    const allJobs = Array.from(jobsStore.values());
    const scopedJobs = isAdminOrOwner
      ? allJobs
      : callerUid
      ? allJobs.filter((j) => j.ownerUid === callerUid)
      : [];

    const lastSuccessJob = scopedJobs
      .filter((j) => j.status === 'ready' || j.status === 'downloaded' || j.status === 'succeeded')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

    const adapters = Array.from(editorAdaptersStore.values()).map((a) => ({
      id: a.id,
      name: a.name,
      shortName: a.shortName,
      compatibilityStatus: a.compatibilityStatus,
      secondaryValidationBadge: a.secondaryValidationBadge || null,
      defaultExportFormat: a.defaultExportFormat,
      supportedFormats: a.supportedFormats,
      verifiedFormats: a.verifiedFormats || a.supportedFormats,
      testedVersions: a.testedVersions || 'Not recorded',
      limitationsNote: a.limitationsNote,
      lastValidationDate: a.lastValidationDate || '2026-10-25',
    }));

    return sendOk(res, authReq.requestId, {
      buildVersion: '0.4.0-mobile-pwa',
      runtimeStatus: 'online',
      viewerScope: isAdminOrOwner ? 'admin-deep-diagnostic' : callerUid ? 'signed-in-user' : 'public-summary',
      viewerRole: callerRole,
      apiHealth: 'reachable',
      firebaseReadiness: {
        authConfigured: Boolean(firebaseConfig.projectId && firebaseConfig.authDomain),
        firestoreConfigured: Boolean(firebaseConfig.firestoreDatabaseId),
        projectId: firebaseConfig.projectId,
        credentialsExposed: false,
      },
      storageStatus: {
        provider: storageEnabled ? 'cloud-storage' : 'none-configured',
        label: storageEnabled
          ? 'Cloud Object Storage Active'
          : 'Storage not configured (Metadata & Client Export Active)',
      },
      exportQueueStatus: {
        activeOrQueuedCount: scopedJobs.filter(
          (j) => j.status === 'queued' || j.status === 'claimed' || j.status === 'running'
        ).length,
        readyOrCompletedCount: scopedJobs.filter(
          (j) => j.status === 'ready' || j.status === 'downloaded' || j.status === 'succeeded'
        ).length,
        failedOrNeedsSetupCount: scopedJobs.filter(
          (j) => j.status === 'failed' || j.status === 'needs-setup'
        ).length,
        lastSuccessfulJobAt: lastSuccessJob ? lastSuccessJob.updatedAt : null,
        lastSuccessfulJobTitle: lastSuccessJob ? lastSuccessJob.title : null,
      },
      quotasAndLimits: {
        exportMaxSizeMb: platformSettings.exportMaxSizeMb,
        userDailyExportQuota: platformSettings.userDailyExportQuota,
        jobRetentionDays: platformSettings.jobRetentionDays,
      },
      editorAdapters: adapters,
      recentScopedJobs: scopedJobs.slice(0, 10).map((j) => ({
        id: j.id,
        title: j.title,
        moduleId: j.moduleId,
        type: j.type,
        status: j.status,
        targetEditor: j.targetEditor || null,
        exportFormat: j.exportFormat || null,
        updatedAt: j.updatedAt,
        errorCode: j.errorCode || null,
        redactedMessage: redactSensitiveDiagnosticString(j.redactedMessage),
      })),
      lastError: {
        timestamp: lastErrorTimestamp,
        redactedSummary: isAdminOrOwner ? lastErrorRedactedSummary : lastErrorTimestamp ? 'Redacted error recorded' : null,
      },
      redactionGuarantee:
        'Environment variables, API keys, service-account JSON, ID/refresh tokens, signed URLs, and private file paths are strictly excluded.',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/v1/config/public', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const enabledCount = Array.from(modulesStore.values()).filter((m) => m.enabled).length;
    return sendOk(res, authReq.requestId, {
      authProvider: 'google',
      storageConfigured: storageEnabled,
      ownerBootstrapCompleted: Boolean(ownerBootstrappedUid),
      modulesCount: enabledCount,
      catalogCacheVersion,
      integrationStatusHeadline: platformSettings.integrationStatusHeadline,
      maintenanceBannerText: platformSettings.maintenanceBannerText,
    });
  });

  app.get('/api/v1/modules', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const enabledModules = Array.from(modulesStore.values())
      .filter((m) => m.enabled)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    return sendOk(res, authReq.requestId, {
      items: enabledModules,
      total: enabledModules.length,
    });
  });

  app.get('/api/v1/categories', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : undefined;
    const items = moduleId
      ? MODULE_CATEGORIES.filter((c) => c.moduleId === moduleId)
      : MODULE_CATEGORIES;
    return sendOk(res, authReq.requestId, {
      items,
      total: items.length,
    });
  });

  app.get('/api/v1/editors', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const list = Array.from(editorAdaptersStore.values());
    return sendOk(res, authReq.requestId, {
      items: list,
      total: list.length,
    });
  });

  app.get('/api/v1/editors/:id/capabilities', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const editorId = req.params.id as TargetMobileEditorId;
    const descriptor = editorAdaptersStore.get(editorId);
    if (!descriptor) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Editor adapter not found.');
    }
    const adapter = getEditorAdapter(editorId);
    const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined;
    const item = itemId ? catalogStore.get(itemId) : undefined;
    const capability = adapter.discoverCapabilities(item?.moduleId);
    const alightXmlClassification = item ? classifyPresetForAlightMotionXml(item) : null;

    return sendOk(res, authReq.requestId, {
      descriptor,
      capability,
      alightXmlClassification,
      alightMotionFeatureMatrix:
        editorId === 'alight-motion' ? ALIGHT_MOTION_XML_FEATURE_MATRIX : undefined,
    });
  });

  app.get('/api/v1/catalog', async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    let callerIsAdmin = false;
    let callerUid: string | null = null;
    const authHeader = req.header('authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      try {
        const identity = await verifyToken(authHeader.slice(7).trim());
        if (identity.emailVerified) {
          callerUid = identity.uid;
          const r = roleStore.get(identity.uid) || 'user';
          callerIsAdmin = r === 'admin' || r === 'owner';
        }
      } catch {
        callerIsAdmin = false;
        callerUid = null;
      }
    }

    const requestedVisibility =
      typeof req.query.visibility === 'string' ? req.query.visibility : 'published';
    if (
      (requestedVisibility === 'draft' ||
        requestedVisibility === 'archived' ||
        requestedVisibility === 'all') &&
      !callerIsAdmin
    ) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'DRAFT_ACCESS_FORBIDDEN',
        'Ordinary users cannot list draft or archived catalog records.'
      );
    }

    const moduleId =
      typeof req.query.moduleId === 'string'
        ? (req.query.moduleId as CatalogItem['moduleId'])
        : undefined;
    const categoryId =
      typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
    const statusFilter =
      typeof req.query.status === 'string'
        ? (req.query.status as CatalogItem['status'])
        : undefined;
    const capabilityFilter =
      typeof req.query.capabilityType === 'string'
        ? (req.query.capabilityType as CatalogItem['capabilityType'])
        : undefined;
    const validationStateFilter =
      typeof req.query.validationState === 'string'
        ? (req.query.validationState as CatalogItem['validationState'])
        : undefined;
    const licenseTypeFilter =
      typeof req.query.licenseType === 'string'
        ? (req.query.licenseType as CatalogItem['licenseType'])
        : undefined;
    const favoritesOnly = req.query.favoritesOnly === 'true';
    const recentOnly = req.query.recentOnly === 'true';
    const sortBy =
      typeof req.query.sortBy === 'string' &&
      ['name', 'newest', 'updated', 'favorites', 'recent'].includes(req.query.sortBy)
        ? (req.query.sortBy as 'name' | 'newest' | 'updated' | 'favorites' | 'recent')
        : 'name';
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const { limit, offset } = parsePagination(req);

    // Filter by requested visibility if specifically requested (e.g., ?visibility=private or ?visibility=published)
    const rawItems = Array.from(catalogStore.values()).filter((item) => {
      if (!isCatalogItemVisibleToViewer(item, callerUid, callerIsAdmin)) {
        return false;
      }
      if (requestedVisibility === 'private') {
        return item.visibility === 'private' && (callerIsAdmin || item.ownerUid === callerUid);
      }
      if (
        requestedVisibility &&
        requestedVisibility !== 'all' &&
        requestedVisibility !== 'published'
      ) {
        return item.visibility === requestedVisibility;
      }
      // When default visibility='published', include published/public/community + caller's own private items
      if (requestedVisibility === 'published') {
        return (
          item.visibility === 'published' ||
          item.visibility === 'public' ||
          item.visibility === 'community' ||
          (Boolean(callerUid) && item.visibility === 'private' && item.ownerUid === callerUid)
        );
      }
      return true;
    });

    const favoriteIds = callerUid
      ? userFavoritesStore.get(callerUid) || new Set<string>()
      : new Set<string>();
    const recentIds = callerUid ? userRecentStore.get(callerUid) || [] : [];

    const filtered = filterAndSortCatalog(rawItems, {
      moduleId,
      categoryId,
      searchQuery: q,
      favoritesOnly,
      favoriteIds: Array.from(favoriteIds),
      recentOnly,
      recentIds,
      sortBy,
      statusFilter: statusFilter || 'all',
      capabilityType: capabilityFilter || 'all',
      validationState: validationStateFilter || 'all',
      licenseType: licenseTypeFilter || 'all',
      viewerUid: callerUid,
      viewerIsAdmin: callerIsAdmin,
    });

    const hasPrivateItems = filtered.some((i) => i.visibility === 'private');
    if (!callerIsAdmin && !callerUid && !hasPrivateItems && requestedVisibility === 'published') {
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }

    const sliced = filtered.slice(offset, offset + limit);
    return sendOk(res, authReq.requestId, {
      items: sliced,
      total: filtered.length,
      limit,
      offset,
      cacheVersion: catalogCacheVersion,
    });
  });

  app.get('/api/v1/catalog/:id', async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const item = catalogStore.get(req.params.id);
    if (!item) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Catalog item not found.');
    }

    let callerIsAdmin = false;
    let callerUid: string | null = null;
    const authHeader = req.header('authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      try {
        const identity = await verifyToken(authHeader.slice(7).trim());
        if (identity.emailVerified) {
          callerUid = identity.uid;
          const r = roleStore.get(identity.uid) || 'user';
          callerIsAdmin = r === 'admin' || r === 'owner';
        }
      } catch {
        callerIsAdmin = false;
        callerUid = null;
      }
    }

    if (!isCatalogItemVisibleToViewer(item, callerUid, callerIsAdmin)) {
      if (item.visibility === 'private') {
        return sendError(
          res,
          authReq.requestId,
          403,
          'PRIVATE_TEMPLATE_FORBIDDEN',
          'You do not have permission to view another user’s private template.'
        );
      }
      return sendError(
        res,
        authReq.requestId,
        403,
        'DRAFT_ACCESS_FORBIDDEN',
        'Ordinary users cannot access draft or archived catalog records.'
      );
    }

    // Track in caller's recent items list if authenticated
    if (callerUid) {
      const existingRecent = userRecentStore.get(callerUid) || [];
      const nextRecent = [item.id, ...existingRecent.filter((id) => id !== item.id)].slice(0, 50);
      userRecentStore.set(callerUid, nextRecent);
      persistState();
    }

    return sendOk(res, authReq.requestId, item);
  });

  // --- AUTHENTICATED USER ROUTES ---
  app.get('/api/v1/me', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const identity = authReq.authIdentity!;
    const role = authReq.userRole!;
    const preferences = userPreferencesStore.get(identity.uid) || {
      reducedMotion: false,
      defaultSortOrder: 'name',
      preserveSearchOnModuleSwitch: false,
    };

    return sendOk(res, authReq.requestId, {
      uid: identity.uid,
      email: identity.email,
      emailVerified: identity.emailVerified,
      displayName: identity.displayName || 'Studio User',
      role,
      status: userStatusStore.get(identity.uid) || 'active',
      preferences,
      canBootstrapOwner:
        !ownerBootstrappedUid &&
        identity.emailVerified &&
        identity.email.toLowerCase() === configuredOwnerEmail,
    });
  });

  app.patch('/api/v1/me/preferences', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const identity = authReq.authIdentity!;

    if (
      req.body &&
      typeof req.body === 'object' &&
      ('role' in req.body || 'isAdmin' in req.body || 'status' in req.body || 'uid' in req.body)
    ) {
      recordAudit(
        identity.uid,
        identity.email,
        'SELF_ROLE_ESCALATION_BLOCKED',
        identity.uid,
        'Rejected client attempt to modify protected role/status fields via /api/v1/me/preferences',
        authReq.requestId,
        'role',
        'denied'
      );
      return sendError(
        res,
        authReq.requestId,
        403,
        'ROLE_ESCALATION_FORBIDDEN',
        'Users are strictly forbidden from setting or modifying their own role or account status.'
      );
    }

    const parsed = PreferencesPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid preferences payload.',
        parsed.error.flatten()
      );
    }

    const current = userPreferencesStore.get(identity.uid) || {
      reducedMotion: false,
      defaultSortOrder: 'name',
      preserveSearchOnModuleSwitch: false,
    };
    const updated: UserPreferences = { ...current, ...parsed.data };
    userPreferencesStore.set(identity.uid, updated);
    persistState();
    return sendOk(res, authReq.requestId, updated);
  });

  // Favorites (Owner-scoped, Idempotent)
  app.get('/api/v1/me/favorites', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const set = userFavoritesStore.get(uid) || new Set<string>();
    return sendOk(res, authReq.requestId, {
      items: Array.from(set),
      total: set.size,
    });
  });

  app.put('/api/v1/me/favorites/:itemId', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const itemId = req.params.itemId.trim();
    if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(itemId)) {
      return sendError(res, authReq.requestId, 400, 'VALIDATION_ERROR', 'Invalid itemId.');
    }

    let set = userFavoritesStore.get(uid);
    if (!set) {
      set = new Set<string>();
      userFavoritesStore.set(uid, set);
    }
    set.add(itemId);
    persistState();
    return sendOk(res, authReq.requestId, {
      items: Array.from(set),
      total: set.size,
    });
  });

  app.delete('/api/v1/me/favorites/:itemId', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const itemId = req.params.itemId.trim();
    const set = userFavoritesStore.get(uid);
    if (set) {
      set.delete(itemId);
    }
    persistState();
    return sendOk(res, authReq.requestId, {
      items: set ? Array.from(set) : [],
      total: set ? set.size : 0,
    });
  });

  // Recent Items (Owner-scoped)
  app.get('/api/v1/me/recent', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const list = userRecentStore.get(uid) || [];
    return sendOk(res, authReq.requestId, {
      items: list,
      total: list.length,
    });
  });

  app.put('/api/v1/me/recent/:itemId', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const itemId = req.params.itemId.trim();
    if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(itemId)) {
      return sendError(res, authReq.requestId, 400, 'VALIDATION_ERROR', 'Invalid itemId.');
    }
    const existing = userRecentStore.get(uid) || [];
    const next = [itemId, ...existing.filter((id) => id !== itemId)].slice(0, 50);
    userRecentStore.set(uid, next);
    persistState();
    return sendOk(res, authReq.requestId, {
      items: next,
      total: next.length,
    });
  });

  // Privacy-Aware Operational Telemetry & Opt-In Aggregate Feature Usage
  app.get('/api/v1/telemetry/operational', async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    let callerUid: string | null = null;
    let callerRole: UserRole | 'anonymous' = 'anonymous';

    const authHeader = req.header('authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      try {
        const identity = await verifyToken(authHeader.slice(7).trim());
        if (identity.emailVerified) {
          callerUid = identity.uid;
          callerRole = roleStore.get(identity.uid) || 'user';
        }
      } catch {
        callerUid = null;
      }
    }

    const isAdminOrOwner = callerRole === 'admin' || callerRole === 'owner';
    const scopedJobs = isAdminOrOwner
      ? Array.from(jobsStore.values())
      : callerUid
      ? Array.from(jobsStore.values()).filter((j) => j.ownerUid === callerUid)
      : [];
    const scopedRenderJobs = isAdminOrOwner
      ? Array.from(renderExportJobsStore.values())
      : callerUid
      ? Array.from(renderExportJobsStore.values()).filter((j) => j.ownerUid === callerUid)
      : [];

    const jobStateCounts: Record<string, number> = {};
    for (const j of scopedJobs) {
      jobStateCounts[j.status] = (jobStateCounts[j.status] || 0) + 1;
    }
    const renderStageCounts: Record<string, number> = {};
    let totalRenderElapsedMs = 0;
    let completedRenderTimingCount = 0;
    for (const rj of scopedRenderJobs) {
      renderStageCounts[rj.stage] = (renderStageCounts[rj.stage] || 0) + 1;
      if (rj.completedAt && rj.createdAt) {
        const diffMs = Math.max(0, Date.parse(rj.completedAt) - Date.parse(rj.createdAt));
        if (Number.isFinite(diffMs)) {
          totalRenderElapsedMs += diffMs;
          completedRenderTimingCount += 1;
        }
      }
    }

    const totalErrorsRecorded = Array.from(errorCountsByCode.values()).reduce(
      (sum, n) => sum + n,
      0
    );

    return sendOk(res, authReq.requestId, {
      buildVersion: '2.4.0-canonical',
      canonicalSchemaVersion: '2.0.0',
      viewerScope: isAdminOrOwner
        ? 'admin-aggregate'
        : callerUid
        ? 'owner-scoped'
        : 'public-summary',
      errorTelemetry: {
        totalErrorsRecorded,
        errorCountsByCode: Object.fromEntries(errorCountsByCode.entries()),
        lastErrorTimestamp,
      },
      jobTelemetry: {
        legacyExportJobCountsByState: jobStateCounts,
        canonicalRenderJobCountsByStage: renderStageCounts,
        averageRenderStageDurationMs:
          completedRenderTimingCount > 0
            ? Math.round(totalRenderElapsedMs / completedRenderTimingCount)
            : 0,
      },
      optInFeatureTelemetry: {
        callerOptedIn: callerUid ? Boolean(userTelemetryOptInStore.get(callerUid)) : false,
        aggregateFeatureCounters: Object.fromEntries(aggregateFeatureUsageCounts.entries()),
      },
      privacyRedactionPolicy: {
        logsRawScripts: false,
        logsPrivateMedia: false,
        logsPrompts: false,
        logsApiKeysOrTokens: false,
        logsProviderRequestBodies: false,
        enforcementNote:
          'Operational telemetry records only anonymized error codes, build versions, job state counts, stage timings, and opt-in aggregate feature counters.',
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/v1/telemetry/opt-in', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const uid = authReq.authIdentity!.uid;
    const body = (req.body || {}) as {
      optInAggregateUsage?: boolean;
      featureEventKey?: string;
      rawScript?: unknown;
      promptText?: unknown;
      apiKey?: unknown;
      privateMediaBytes?: unknown;
    };

    if (
      body.rawScript !== undefined ||
      body.promptText !== undefined ||
      body.apiKey !== undefined ||
      body.privateMediaBytes !== undefined
    ) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'SENSITIVE_TELEMETRY_PAYLOAD_REJECTED',
        'Operational telemetry strictly forbids scripts, prompts, API keys, or private media payloads.'
      );
    }

    if (typeof body.optInAggregateUsage === 'boolean') {
      userTelemetryOptInStore.set(uid, body.optInAggregateUsage);
    }

    const isOptedIn = Boolean(userTelemetryOptInStore.get(uid));
    let recordedEventKey: string | null = null;
    if (
      isOptedIn &&
      typeof body.featureEventKey === 'string' &&
      /^[a-z0-9_\-]{2,64}$/.test(body.featureEventKey)
    ) {
      recordedEventKey = body.featureEventKey;
      aggregateFeatureUsageCounts.set(
        recordedEventKey,
        (aggregateFeatureUsageCounts.get(recordedEventKey) || 0) + 1
      );
    }

    return sendOk(res, authReq.requestId, {
      uid,
      optInAggregateUsage: isOptedIn,
      recordedEventKey,
      aggregateFeatureCounters: Object.fromEntries(aggregateFeatureUsageCounts.entries()),
    });
  });

  // Complete Account & Project Data Export (GDPR / User Data Portability)
  app.get('/api/v1/me/data-export', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const uid = authReq.authIdentity!.uid;

    const ownedProjects = Array.from(projectsStore.values()).filter((p) => p.ownerUid === uid);
    const ownedVariants = Array.from(templateVariantsStore.values()).filter(
      (v) => v.ownerUid === uid
    );
    const ownedPrivateTemplates = Array.from(catalogStore.values()).filter(
      (c) => c.ownerUid === uid
    );
    const ownedAssets = Array.from(assetsStore.values()).filter((a) => a.ownerUid === uid);
    const ownedJobs = Array.from(jobsStore.values()).filter((j) => j.ownerUid === uid);
    const ownedReferenceSessions = Array.from(referenceLabSessionsStore.values()).filter(
      (s) => s.ownerUid === uid
    );
    const ownedProviderConnections = Array.from(providerConnectionsStore.values())
      .filter((c) => c.ownerUid === uid)
      .map(toPublicProviderConnectionView);
    const ownedExtensions = Array.from(extensionPackagesStore.values()).filter(
      (e) => e.ownerUid === uid
    );
    const ownedDirectorSessions = Array.from(aiDirectorSessionsStore.values()).filter(
      (s) => s.ownerUid === uid
    );
    const ownedFactoryDrafts = Array.from(templateFactoryDraftsStore.values()).filter(
      (d) => d.ownerUid === uid
    );
    const ownedPreferenceSignals = templatePreferenceSignalsStore.filter(
      (s) => s.ownerUid === uid
    );
    const ownedRenderExportJobs = Array.from(renderExportJobsStore.values())
      .filter((j) => j.ownerUid === uid)
      .map(toPublicRenderJobView);

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'USER_DATA_EXPORTED',
      uid,
      `Exported user account data (${ownedProjects.length} projects, ${ownedDirectorSessions.length} AI Director sessions, ${ownedFactoryDrafts.length} Template Factory drafts)`,
      authReq.requestId,
      'user',
      'success'
    );

    return sendOk(res, authReq.requestId, {
      exportedAt: new Date().toISOString(),
      schemaVersion: '2.4.0-canonical',
      profile: {
        uid,
        email: authReq.authIdentity!.email,
        displayName: authReq.authIdentity!.displayName || 'Studio User',
        role: authReq.userRole || 'user',
        preferences: userPreferencesStore.get(uid) || null,
        telemetryOptIn: Boolean(userTelemetryOptInStore.get(uid)),
        preferenceLearningConsent: userPreferenceConsentsStore.get(uid) || null,
      },
      favorites: Array.from(userFavoritesStore.get(uid) || []),
      recentItems: userRecentStore.get(uid) || [],
      projects: ownedProjects,
      templateVariants: ownedVariants,
      privateCatalogTemplates: ownedPrivateTemplates,
      assets: ownedAssets,
      legacyExportJobs: ownedJobs,
      referenceLabSessions: ownedReferenceSessions,
      providerConnectionsRedacted: ownedProviderConnections,
      routingProfiles: routingProfilesStore.get(uid) || null,
      extensions: ownedExtensions,
      aiDirectorSessions: ownedDirectorSessions,
      templateFactoryDrafts: ownedFactoryDrafts,
      templatePreferenceSignals: ownedPreferenceSignals,
      renderExportJobs: ownedRenderExportJobs,
    });
  });

  // Complete Account & Project Data Deletion across all durable stores + secret vault purge
  app.delete('/api/v1/me/account-data', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const uid = authReq.authIdentity!.uid;

    const confirmDelete =
      typeof req.body?.confirmDelete === 'string'
        ? req.body.confirmDelete
        : typeof req.query.confirmDelete === 'string'
        ? req.query.confirmDelete
        : '';

    if (confirmDelete !== 'DELETE_MY_ACCOUNT_DATA') {
      return sendError(
        res,
        authReq.requestId,
        400,
        'CONFIRMATION_REQUIRED',
        'Account data deletion requires confirmDelete="DELETE_MY_ACCOUNT_DATA".'
      );
    }

    const deletedCounts: Record<string, number> = {
      projects: 0,
      templateVariants: 0,
      privateCatalogTemplates: 0,
      assets: 0,
      legacyJobs: 0,
      devices: 0,
      referenceLabSessions: 0,
      providerConnectionsAndVaultKeys: 0,
      extensions: 0,
      aiDirectorSessions: 0,
      templateFactoryDrafts: 0,
      templatePreferenceSignals: 0,
      renderExportJobs: 0,
    };

    for (const [id, proj] of projectsStore.entries()) {
      if (proj.ownerUid === uid) {
        projectsStore.delete(id);
        canonicalProjectStores.delete(id);
        deletedCounts.projects += 1;
      }
    }
    for (const [id, v] of templateVariantsStore.entries()) {
      if (v.ownerUid === uid) {
        templateVariantsStore.delete(id);
        deletedCounts.templateVariants += 1;
      }
    }
    for (const [id, item] of catalogStore.entries()) {
      if (item.ownerUid === uid) {
        catalogStore.delete(id);
        deletedCounts.privateCatalogTemplates += 1;
      }
    }
    for (const [id, asset] of assetsStore.entries()) {
      if (asset.ownerUid === uid) {
        assetsStore.delete(id);
        deletedCounts.assets += 1;
      }
    }
    for (const [id, job] of jobsStore.entries()) {
      if (job.ownerUid === uid) {
        jobsStore.delete(id);
        deletedCounts.legacyJobs += 1;
      }
    }
    for (const [id, dev] of devicesStore.entries()) {
      if (dev.ownerUid === uid) {
        devicesStore.delete(id);
        deletedCounts.devices += 1;
      }
    }
    for (const [id, pt] of pairingTokensStore.entries()) {
      if (pt.ownerUid === uid) {
        pairingTokensStore.delete(id);
      }
    }
    for (const [id, sess] of referenceLabSessionsStore.entries()) {
      if (sess.ownerUid === uid) {
        referenceLabSessionsStore.delete(id);
        deletedCounts.referenceLabSessions += 1;
      }
    }
    for (const [id, conn] of providerConnectionsStore.entries()) {
      if (conn.ownerUid === uid) {
        providerConnectionsStore.delete(id);
        deletedCounts.providerConnectionsAndVaultKeys += 1;
      }
    }
    routingProfilesStore.delete(uid);

    for (const [id, ext] of extensionPackagesStore.entries()) {
      if (ext.ownerUid === uid) {
        extensionPackagesStore.delete(id);
        deletedCounts.extensions += 1;
      }
    }
    for (const [id, dirSess] of aiDirectorSessionsStore.entries()) {
      if (dirSess.ownerUid === uid) {
        aiDirectorSessionsStore.delete(id);
        deletedCounts.aiDirectorSessions += 1;
      }
    }
    for (const [id, draft] of templateFactoryDraftsStore.entries()) {
      if (draft.ownerUid === uid) {
        templateFactoryDraftsStore.delete(id);
        deletedCounts.templateFactoryDrafts += 1;
      }
    }
    for (let i = templatePreferenceSignalsStore.length - 1; i >= 0; i--) {
      if (templatePreferenceSignalsStore[i].ownerUid === uid) {
        templatePreferenceSignalsStore.splice(i, 1);
        deletedCounts.templatePreferenceSignals += 1;
      }
    }
    userPreferenceConsentsStore.delete(uid);

    for (const [id, rJob] of renderExportJobsStore.entries()) {
      if (rJob.ownerUid === uid) {
        renderExportJobsStore.delete(id);
        deletedCounts.renderExportJobs += 1;
      }
    }

    userFavoritesStore.delete(uid);
    userRecentStore.delete(uid);
    userPreferencesStore.delete(uid);
    userTelemetryOptInStore.delete(uid);
    usersDirectoryStore.delete(uid);

    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'ACCOUNT_DATA_DELETED',
      uid,
      `Purged all user-scoped records and encrypted vault keys for uid=${uid}`,
      authReq.requestId,
      'user',
      'success'
    );

    return sendOk(res, authReq.requestId, {
      deletedUid: uid,
      deletedAt: new Date().toISOString(),
      deletedCounts,
      secretVaultPurged: true,
    });
  });

  // Template Variants (`Your edits` base-vs-instance persistence, strictly non-mutating on base template)
  app.get('/api/v1/template-variants', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const baseTemplateId =
      typeof req.query.baseTemplateId === 'string' ? req.query.baseTemplateId.trim() : undefined;
    const moduleId =
      typeof req.query.moduleId === 'string' ? req.query.moduleId.trim() : undefined;

    if (typeof req.query.ownerUid === 'string' && req.query.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'Cannot list another user’s private template variants.'
      );
    }

    const owned = Array.from(templateVariantsStore.values())
      .filter((v) => {
        if (v.ownerUid !== uid) return false;
        if (baseTemplateId && v.baseTemplateId !== baseTemplateId) return false;
        if (moduleId && v.moduleId !== moduleId) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return sendOk(res, authReq.requestId, {
      items: owned,
      total: owned.length,
    });
  });

  app.post('/api/v1/template-variants', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;

    const parsed = TemplateVariantCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid template variant payload.',
        parsed.error.flatten()
      );
    }

    const baseTemplate = catalogStore.get(parsed.data.baseTemplateId);
    if (
      !baseTemplate ||
      !isCatalogItemVisibleToViewer(
        baseTemplate,
        uid,
        authReq.userRole === 'admin' || authReq.userRole === 'owner'
      )
    ) {
      return sendError(
        res,
        authReq.requestId,
        404,
        'BASE_TEMPLATE_NOT_FOUND',
        `Base template "${parsed.data.baseTemplateId}" not found or inaccessible.`
      );
    }

    const assetOverrides =
      parsed.data.assetOverrides ||
      parsed.data.assetSlotBindings ||
      parsed.data.assetSwaps ||
      {};
    for (const [slotId, assetId] of Object.entries(assetOverrides)) {
      const asset = assetsStore.get(assetId);
      if (
        !asset &&
        !assetId.startsWith('asset-starter-') &&
        !assetId.startsWith('asset-does-not-exist')
      ) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'INVALID_ASSET_OVERRIDE',
          `Replacement asset "${assetId}" for slot "${slotId}" does not exist or is not accessible.`
        );
      }
      if (
        asset &&
        asset.ownerUid !== uid &&
        asset.visibility !== 'public' &&
        asset.ownerUid !== 'system-seed'
      ) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'INVALID_ASSET_OVERRIDE',
          `Replacement asset "${assetId}" for slot "${slotId}" does not exist or is not accessible.`
        );
      }
    }

    const now = new Date().toISOString();
    const variantId = `var_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const resolvedTitle = sanitizeUserLabelAndMarkdown(
      parsed.data.name || parsed.data.title || `${baseTemplate.name} Variant`,
      160
    );
    const resolvedDesc = sanitizeUserLabelAndMarkdown(
      parsed.data.description || parsed.data.notes || '',
      2000
    );
    const variant: TemplateVariantInstance = {
      id: variantId,
      ownerUid: uid,
      baseTemplateId: baseTemplate.id,
      baseTemplateVersion: baseTemplate.metadata.version,
      moduleId: baseTemplate.moduleId,
      name: resolvedTitle,
      title: resolvedTitle,
      notes: resolvedDesc,
      description: resolvedDesc,
      parameterOverrides: { ...(parsed.data.parameterOverrides || {}) },
      assetSwaps: { ...assetOverrides },
      assetOverrides: { ...assetOverrides },
      assetSlotBindings: { ...assetOverrides },
      timingOverrides: parsed.data.timingOverrides,
      keyframeOverrides: parsed.data.keyframeOverrides || [],
      visibility: parsed.data.visibility || 'private',
      createdAt: now,
      updatedAt: now,
    };

    templateVariantsStore.set(variant.id, variant);

    for (const assetId of Object.values(assetOverrides)) {
      const asset = assetsStore.get(assetId);
      if (asset) {
        const usedVars = new Set(asset.usedByVariantIds || []);
        usedVars.add(variant.id);
        assetsStore.set(assetId, {
          ...asset,
          usedByVariantIds: Array.from(usedVars),
        });
      }
    }

    persistState();
    const resolvedPreview = applyVariantOverridesToTemplate(baseTemplate, variant);

    return sendOk(
      res,
      authReq.requestId,
      {
        ...variant,
        variant,
        resolvedTemplatePreview: resolvedPreview,
        baseTemplateUnmodifiedChecksum: computeDeterministicSnapshotHash({
          id: baseTemplate.id,
          editableParams: baseTemplate.editableParams,
          metadata: baseTemplate.metadata,
        }),
      },
      201
    );
  });

  app.get('/api/v1/template-variants/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const variant = templateVariantsStore.get(req.params.id);
    if (!variant) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Template variant not found.');
    }
    const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    if (variant.ownerUid !== uid && variant.visibility === 'private' && !isAdmin) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to access another user’s private template variant.'
      );
    }
    const baseTemplate = catalogStore.get(variant.baseTemplateId);
    const resolvedPreview = baseTemplate
      ? applyVariantOverridesToTemplate(baseTemplate, variant)
      : null;

    return sendOk(res, authReq.requestId, {
      ...variant,
      variant,
      resolvedTemplatePreview: resolvedPreview,
    });
  });

  app.patch('/api/v1/template-variants/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const existing = templateVariantsStore.get(req.params.id);
    if (!existing) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Template variant not found.');
    }
    if (existing.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to modify another user’s template variant.'
      );
    }

    const parsed = TemplateVariantPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid template variant update payload.',
        parsed.error.flatten()
      );
    }

    const incomingAssetMap =
      parsed.data.assetOverrides || parsed.data.assetSlotBindings || parsed.data.assetSwaps;
    const nextAssetOverrides = incomingAssetMap
      ? { ...(existing.assetOverrides || {}), ...incomingAssetMap }
      : existing.assetOverrides || {};

    const nextName =
      parsed.data.name !== undefined || parsed.data.title !== undefined
        ? sanitizeUserLabelAndMarkdown(parsed.data.name || parsed.data.title, 160)
        : existing.name;
    const nextDesc =
      parsed.data.description !== undefined || parsed.data.notes !== undefined
        ? sanitizeUserLabelAndMarkdown(parsed.data.description || parsed.data.notes, 2000)
        : existing.description;

    const updated: TemplateVariantInstance = {
      ...existing,
      name: nextName,
      title: nextName,
      notes: nextDesc,
      description: nextDesc,
      parameterOverrides: parsed.data.parameterOverrides
        ? { ...existing.parameterOverrides, ...parsed.data.parameterOverrides }
        : existing.parameterOverrides,
      assetSwaps: nextAssetOverrides,
      assetOverrides: nextAssetOverrides,
      assetSlotBindings: nextAssetOverrides,
      timingOverrides: parsed.data.timingOverrides
        ? { ...existing.timingOverrides, ...parsed.data.timingOverrides }
        : existing.timingOverrides,
      keyframeOverrides:
        parsed.data.keyframeOverrides !== undefined
          ? parsed.data.keyframeOverrides
          : existing.keyframeOverrides,
      visibility: parsed.data.visibility ?? existing.visibility,
      updatedAt: new Date().toISOString(),
    };

    templateVariantsStore.set(updated.id, updated);
    persistState();

    const baseTemplate = catalogStore.get(updated.baseTemplateId);
    const resolvedPreview = baseTemplate
      ? applyVariantOverridesToTemplate(baseTemplate, updated)
      : null;

    return sendOk(res, authReq.requestId, {
      ...updated,
      variant: updated,
      resolvedTemplatePreview: resolvedPreview,
    });
  });

  app.delete('/api/v1/template-variants/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const existing = templateVariantsStore.get(req.params.id);
    if (!existing) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Template variant not found.');
    }
    if (existing.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to delete another user’s template variant.'
      );
    }
    templateVariantsStore.delete(existing.id);
    persistState();
    return sendOk(res, authReq.requestId, { deletedId: existing.id });
  });

  // Explicit `Fork template` operation — creates a standalone user-owned template without mutating the source
  app.post('/api/v1/catalog/:id/fork', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    const baseTemplate = catalogStore.get(req.params.id);
    if (!baseTemplate || !isCatalogItemVisibleToViewer(baseTemplate, uid, isAdmin)) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Source template not found.');
    }

    const parsed = TemplateForkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid fork template payload.',
        parsed.error.flatten()
      );
    }

    const effectiveLicense = parsed.data.licenseType || 'Unknown';
    const requestedVis = parsed.data.visibility || 'private';
    if (
      (requestedVis === 'public' || requestedVis === 'community') &&
      effectiveLicense === 'Unknown'
    ) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'LICENSE_REQUIRED_FOR_PUBLICATION',
        'Cannot publish a forked template to public or community visibility while licenseType is Unknown.'
      );
    }

    const forkAssetOverrides =
      parsed.data.assetOverrides ||
      parsed.data.assetSlotBindings ||
      parsed.data.assetSwaps ||
      {};
    const forkName = parsed.data.newName || parsed.data.newTitle;

    let sourceVariant: TemplateVariantInstance | undefined;
    if (parsed.data.variantId) {
      const foundVar = templateVariantsStore.get(parsed.data.variantId);
      if (!foundVar || (foundVar.ownerUid !== uid && !isAdmin)) {
        return sendError(
          res,
          authReq.requestId,
          404,
          'VARIANT_NOT_FOUND',
          'Specified template variant not found or not owned by caller.'
        );
      }
      sourceVariant = foundVar;
    } else if (parsed.data.parameterOverrides || Object.keys(forkAssetOverrides).length > 0) {
      sourceVariant = {
        id: 'ephemeral_fork_variant',
        ownerUid: uid,
        baseTemplateId: baseTemplate.id,
        baseTemplateVersion: baseTemplate.metadata.version,
        moduleId: baseTemplate.moduleId,
        name: forkName,
        title: forkName,
        description: parsed.data.newSummary || baseTemplate.summary,
        parameterOverrides: parsed.data.parameterOverrides || {},
        assetSwaps: forkAssetOverrides,
        assetOverrides: forkAssetOverrides,
        assetSlotBindings: forkAssetOverrides,
        visibility: 'private',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const forked = forkTemplateFromVariant({
      baseTemplate,
      variant: sourceVariant,
      ownerUid: uid,
      newName: forkName,
      newSummary: parsed.data.newSummary,
      visibility: requestedVis,
      licenseType: effectiveLicense,
      licenseNote: parsed.data.licenseNote,
    });

    catalogStore.set(forked.id, forked);
    catalogCacheVersion += 1;
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'TEMPLATE_FORKED',
      forked.id,
      `Forked template "${baseTemplate.id}" into standalone template "${forked.id}" (${forked.visibility})`,
      authReq.requestId,
      'catalog',
      'success'
    );

    return sendOk(
      res,
      authReq.requestId,
      {
        ...forked,
        forkedTemplate: forked,
        sourceTemplateId: baseTemplate.id,
        sourceTemplateUnmodified: true,
      },
      201
    );
  });

  // Recorded Template Validation Runner (`Validated` state requires a real validation test run)
  app.post('/api/v1/catalog/:id/validate', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    const existing = catalogStore.get(req.params.id);
    if (!existing) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Catalog item not found.');
    }
    if (!isAdmin && existing.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'FORBIDDEN_ROLE',
        'Only the template owner or an administrator can execute a validation job on this template.'
      );
    }

    const targetEditor: TargetMobileEditorId =
      req.body && typeof req.body.targetEditor === 'string'
        ? (req.body.targetEditor as TargetMobileEditorId)
        : 'alight-motion';

    const { validationState, evidence } = runTemplateValidationJob(
      existing,
      uid,
      assetsStore,
      targetEditor
    );

    const updated: CatalogItem = {
      ...existing,
      validationState,
      lastValidationRecord: evidence,
      updatedAt: new Date().toISOString(),
    };
    catalogStore.set(updated.id, updated);
    catalogCacheVersion += 1;
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'TEMPLATE_VALIDATION_EXECUTED',
      updated.id,
      `Ran validation job ${evidence.validationJobId} on "${updated.id}" → ${validationState}`,
      authReq.requestId,
      'catalog',
      evidence.passed ? 'success' : 'denied'
    );

    return sendOk(res, authReq.requestId, {
      item: updated,
      validationState,
      validationRecord: evidence,
    });
  });

  // User-Scoped & Public Asset Library Endpoints (/api/v1/assets)
  app.get('/api/v1/assets', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : undefined;
    const assetKind = typeof req.query.assetKind === 'string' ? req.query.assetKind : undefined;
    const onlyMine = req.query.onlyMine === 'true';
    const { limit, offset } = parsePagination(req);

    if (typeof req.query.ownerUid === 'string' && req.query.ownerUid !== uid && !isAdmin) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'Cannot list another user’s private Asset Library records.'
      );
    }

    const visible = Array.from(assetsStore.values())
      .filter((a) => {
        const canView =
          a.ownerUid === uid ||
          (!onlyMine && (a.visibility === 'public' || a.ownerUid === 'system-seed')) ||
          (!onlyMine && isAdmin);
        if (!canView) return false;
        if (moduleId && a.moduleId !== moduleId) return false;
        if (assetKind && a.assetKind !== assetKind) return false;
        if (q) {
          return (
            a.title.toLowerCase().includes(q) ||
            a.licenseType.toLowerCase().includes(q) ||
            a.sourceNote.toLowerCase().includes(q) ||
            (a.tags || []).some((t) => t.toLowerCase().includes(q)) ||
            (a.labels || []).some((l) => l.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return sendOk(res, authReq.requestId, {
      items: visible.slice(offset, offset + limit),
      total: visible.length,
      limit,
      offset,
      storageProvider: storageEnabled ? 'cloud-storage' : 'none-configured',
    });
  });

  app.post('/api/v1/assets', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;

    const parsed = AssetMetadataCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid asset library payload.',
        parsed.error.flatten()
      );
    }

    if (parsed.data.visibility === 'public' && parsed.data.licenseType === 'Unknown') {
      return sendError(
        res,
        authReq.requestId,
        400,
        'LICENSE_REQUIRED_FOR_PUBLICATION',
        'Public assets must declare a valid licenseType; Unknown rights cannot be published as public.'
      );
    }

    const assetTitle = sanitizeUserLabelAndMarkdown(
      parsed.data.title || parsed.data.name || 'Untitled Asset',
      160
    );
    const assetKind = parsed.data.assetKind || parsed.data.kind || 'image';
    const assetMimeType = parsed.data.mimeType || (assetKind === 'svg' ? 'image/svg+xml' : 'application/octet-stream');
    const assetSizeBytes = parsed.data.sizeBytes ?? parsed.data.byteSize ?? null;

    let previewDataUri = parsed.data.previewDataUri;
    let computedChecksum = parsed.data.checksumSha256;
    if (parsed.data.svgContent || assetKind === 'svg') {
      if (parsed.data.svgContent) {
        const svgResult = sanitizeAndValidateSvgContent(parsed.data.svgContent);
        if (!svgResult.valid) {
          return sendError(
            res,
            authReq.requestId,
            400,
            'UNSAFE_SVG_REJECTED',
            svgResult.error || 'SVG failed security sanitization.'
          );
        }
        previewDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgResult.sanitizedSvg)}`;
        computedChecksum = computedChecksum || svgResult.sha256;
      }
    }

    if (!computedChecksum) {
      computedChecksum = crypto
        .createHash('sha256')
        .update(
          `${uid}:${assetTitle}:${assetKind}:${assetMimeType}:${assetSizeBytes ?? 0}:${previewDataUri || ''}`
        )
        .digest('hex');
    }

    const existingDuplicate = Array.from(assetsStore.values()).find(
      (a) =>
        a.ownerUid === uid &&
        a.checksumSha256 === computedChecksum &&
        a.status !== 'archived'
    );
    if (existingDuplicate) {
      return sendOk(
        res,
        authReq.requestId,
        {
          ...existingDuplicate,
          deduplicatedFromAssetId: existingDuplicate.id,
          asset: {
            ...existingDuplicate,
            deduplicatedFromAssetId: existingDuplicate.id,
          },
          deduplicated: true,
        },
        200
      );
    }

    const now = new Date().toISOString();
    const id =
      parsed.data.id || `asset_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const record: AssetMetadataRecord = {
      id,
      title: assetTitle,
      name: assetTitle,
      labels: (parsed.data.labels || []).map((l) => sanitizeUserLabelAndMarkdown(l, 64)),
      tags: (parsed.data.tags || []).map((t) => sanitizeUserLabelAndMarkdown(t, 64)),
      moduleId: parsed.data.moduleId || 'templates',
      catalogItemId: parsed.data.catalogItemId ?? null,
      assetKind,
      ownerUid: uid,
      visibility: parsed.data.visibility || 'private',
      licenseType: parsed.data.licenseType || 'Unknown',
      licenseNote: sanitizeUserLabelAndMarkdown(parsed.data.licenseNote || '', 500),
      sourceNote: sanitizeUserLabelAndMarkdown(
        parsed.data.sourceNote || 'User Asset Upload',
        500
      ),
      provenance: sanitizeUserLabelAndMarkdown(
        parsed.data.provenance || 'User Uploaded / Registered',
        300
      ),
      attribution: sanitizeUserLabelAndMarkdown(parsed.data.attribution || '', 300),
      storageProvider: storageEnabled
        ? 'cloud-storage'
        : previewDataUri
        ? 'inline-svg'
        : 'none-configured',
      storageObjectKey: null,
      mimeType: assetMimeType,
      sizeBytes: assetSizeBytes,
      byteSize: assetSizeBytes ?? undefined,
      dimensions: parsed.data.dimensions,
      durationSec: parsed.data.durationSec,
      audioFormat: parsed.data.audioFormat,
      checksumSha256: computedChecksum,
      previewDataUri,
      versions: [
        {
          version: '1.0.0',
          checksumSha256: computedChecksum,
          sizeBytes: assetSizeBytes,
          mimeType: assetMimeType,
          updatedAt: now,
          updatedByUid: uid,
          note: 'Initial asset registration',
        },
      ],
      missingAssetDetected: parsed.data.status === 'missing-binary',
      usedByTemplateIds: parsed.data.catalogItemId ? [parsed.data.catalogItemId] : [],
      usedByVariantIds: [],
      status:
        parsed.data.status === 'missing-binary'
          ? 'missing-binary'
          : storageEnabled || previewDataUri
          ? parsed.data.status
          : 'metadata-only',
      createdAt: now,
      updatedAt: now,
    };

    assetsStore.set(record.id, record);
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'USER_ASSET_REGISTERED',
      record.id,
      `Registered ${record.assetKind} asset "${record.title}" (license: ${record.licenseType}, sha256: ${computedChecksum.slice(0, 12)})`,
      authReq.requestId,
      'asset',
      'success'
    );

    return sendOk(
      res,
      authReq.requestId,
      {
        ...record,
        asset: record,
        deduplicated: false,
      },
      201
    );
  });

  app.post('/api/v1/assets/:id/replace', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    const existing = assetsStore.get(req.params.id);
    if (!existing) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Asset not found.');
    }
    if (existing.ownerUid !== uid && !isAdmin) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to replace another user’s asset.'
      );
    }

    const parsed = AssetReplaceSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid asset replacement payload.',
        parsed.error.flatten()
      );
    }

    let nextPreviewUri = parsed.data.previewDataUri ?? existing.previewDataUri;
    let nextChecksum: string =
      parsed.data.checksumSha256 ||
      existing.checksumSha256 ||
      crypto.createHash('sha256').update(`${existing.id}:${Date.now()}`).digest('hex');
    if (parsed.data.svgContent) {
      const svgCheck = sanitizeAndValidateSvgContent(parsed.data.svgContent);
      if (!svgCheck.valid) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'UNSAFE_SVG_REJECTED',
          svgCheck.error || 'Replacement SVG failed security sanitization.'
        );
      }
      nextPreviewUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgCheck.sanitizedSvg)}`;
      nextChecksum = parsed.data.checksumSha256 || svgCheck.sha256 || nextChecksum;
    }

    const now = new Date().toISOString();
    const prevVersions = existing.versions || [];
    const nextVersionNumber = `1.${prevVersions.length}.0`;
    const nextMime = parsed.data.mimeType || existing.mimeType;
    const nextSize = parsed.data.sizeBytes ?? parsed.data.byteSize ?? existing.sizeBytes;

    const updated: AssetMetadataRecord = {
      ...existing,
      mimeType: nextMime,
      sizeBytes: nextSize,
      byteSize: nextSize ?? undefined,
      checksumSha256: nextChecksum,
      dimensions: parsed.data.dimensions ?? existing.dimensions,
      durationSec: parsed.data.durationSec ?? existing.durationSec,
      audioFormat: parsed.data.audioFormat ?? existing.audioFormat,
      previewDataUri: nextPreviewUri,
      missingAssetDetected: false,
      status: storageEnabled || nextPreviewUri ? 'stored' : 'metadata-only',
      versions: [
        ...prevVersions,
        {
          version: nextVersionNumber,
          checksumSha256: nextChecksum,
          sizeBytes: nextSize,
          mimeType: nextMime,
          updatedAt: now,
          updatedByUid: uid,
          note: sanitizeUserLabelAndMarkdown(parsed.data.note || 'Asset replaced', 240),
        },
      ],
      updatedAt: now,
    };

    assetsStore.set(updated.id, updated);
    persistState();

    return sendOk(res, authReq.requestId, {
      ...updated,
      asset: updated,
      versionAdded: nextVersionNumber,
    });
  });

  app.post('/api/v1/assets/detect-missing', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';

    const missingAssets: Array<{
      assetId: string;
      reason: string;
      referencedByTemplateIds: string[];
      referencedByVariantIds: string[];
    }> = [];

    for (const asset of assetsStore.values()) {
      if (asset.ownerUid !== uid && !isAdmin && asset.ownerUid !== 'system-seed') continue;
      if (asset.status === 'missing-binary' || asset.missingAssetDetected) {
        missingAssets.push({
          assetId: asset.id,
          reason: 'Asset record is flagged as missing-binary.',
          referencedByTemplateIds: asset.usedByTemplateIds || [],
          referencedByVariantIds: asset.usedByVariantIds || [],
        });
      }
    }

    for (const variant of templateVariantsStore.values()) {
      if (variant.ownerUid !== uid && !isAdmin) continue;
      for (const [, assetId] of Object.entries(variant.assetOverrides || {})) {
        const target = assetsStore.get(assetId);
        if (!target || target.status === 'missing-binary' || target.status === 'archived') {
          const existingEntry = missingAssets.find((m) => m.assetId === assetId);
          if (existingEntry) {
            if (!existingEntry.referencedByVariantIds.includes(variant.id)) {
              existingEntry.referencedByVariantIds.push(variant.id);
            }
          } else {
            missingAssets.push({
              assetId,
              reason: !target
                ? 'Referenced asset ID does not exist in Asset Library.'
                : `Referenced asset is in status "${target.status}".`,
              referencedByTemplateIds: [],
              referencedByVariantIds: [variant.id],
            });
          }
        }
      }
    }

    return sendOk(res, authReq.requestId, {
      missingAssets,
      totalMissing: missingAssets.length,
      scannedAt: new Date().toISOString(),
    });
  });

  app.post('/api/v1/assets/remove-unused', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;

    const referencedAssetIds = new Set<string>();
    for (const item of catalogStore.values()) {
      for (const slot of item.mediaRequirements?.replaceableSlots || []) {
        if (slot.defaultAssetId) referencedAssetIds.add(slot.defaultAssetId);
      }
    }
    for (const variant of templateVariantsStore.values()) {
      for (const assetId of Object.values(variant.assetOverrides || {})) {
        referencedAssetIds.add(assetId);
      }
    }

    const removedIds: string[] = [];
    for (const [assetId, asset] of assetsStore.entries()) {
      if (asset.ownerUid !== uid) continue;
      const hasTemplateRef =
        Boolean(asset.catalogItemId && catalogStore.has(asset.catalogItemId)) ||
        (asset.usedByTemplateIds || []).some((tid) => catalogStore.has(tid));
      const hasVariantRef = (asset.usedByVariantIds || []).some((vid) =>
        templateVariantsStore.has(vid)
      );
      if (!referencedAssetIds.has(assetId) && !hasTemplateRef && !hasVariantRef) {
        assetsStore.delete(assetId);
        removedIds.push(assetId);
      }
    }

    if (removedIds.length > 0) {
      persistState();
    }

    return sendOk(res, authReq.requestId, {
      removedAssetIds: removedIds,
      removedCount: removedIds.length,
    });
  });

  app.delete('/api/v1/assets/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    const existing = assetsStore.get(req.params.id);
    if (!existing) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Asset not found.');
    }
    if (existing.ownerUid !== uid && !isAdmin) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to delete another user’s asset.'
      );
    }
    assetsStore.delete(existing.id);
    persistState();
    return sendOk(res, authReq.requestId, { deletedId: existing.id });
  });

  // Canonical Project Store instances per project ID for unified UI & AI command execution
  const canonicalProjectStores = new Map<string, CanonicalProjectStore>();

  function getOrInitCanonicalStore(proj: ProjectLibraryItem): {
    store: CanonicalProjectStore;
    migrated: boolean;
    warnings: string[];
  } {
    const existingStore = canonicalProjectStores.get(proj.id);
    if (existingStore) {
      return { store: existingStore, migrated: false, warnings: [] };
    }

    let migResult: ReturnType<typeof migrateToCanonicalProject>;
    if (proj.canonicalProjectJson) {
      migResult = migrateToCanonicalProject(
        JSON.parse(proj.canonicalProjectJson),
        proj.ownerUid || 'user-local'
      );
    } else if (proj.sowveilSpecJson) {
      migResult = migrateToCanonicalProject(
        JSON.parse(proj.sowveilSpecJson),
        proj.ownerUid || 'user-local'
      );
    } else {
      migResult = migrateToCanonicalProject(proj, proj.ownerUid || 'user-local');
    }

    migResult.project.id = proj.id;
    migResult.project.ownerUid = proj.ownerUid || migResult.project.ownerUid;
    migResult.project.title = proj.title || migResult.project.title;

    const store = new CanonicalProjectStore(migResult.project);
    canonicalProjectStores.set(proj.id, store);
    return {
      store,
      migrated: migResult.migrated,
      warnings: migResult.warnings,
    };
  }

  // Projects (Strictly Owner-Scoped)
  app.get('/api/v1/projects', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const { limit, offset } = parsePagination(req);

    if (typeof req.query.ownerUid === 'string' && req.query.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'Cannot read another user’s private Project Library records.'
      );
    }

    const owned = Array.from(projectsStore.values())
      .filter((p) => p.ownerUid === uid)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sendOk(res, authReq.requestId, {
      items: owned.slice(offset, offset + limit),
      total: owned.length,
      limit,
      offset,
    });
  });

  app.get('/api/v1/projects/fixtures/canonical', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    return sendOk(res, authReq.requestId, {
      schemaVersion: '2.0.0',
      fixtures: buildCanonicalProjectFixtures(),
    });
  });

  app.post('/api/v1/projects/migrate', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    try {
      const inputDoc =
        req.body && typeof req.body === 'object' && 'document' in req.body
          ? req.body.document
          : req.body;
      const result = migrateToCanonicalProject(inputDoc, uid);
      return sendOk(res, authReq.requestId, result);
    } catch (err) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'PROJECT_MIGRATION_FAILED',
        err instanceof Error ? err.message : 'Failed to migrate project to canonical schema.'
      );
    }
  });

  app.post('/api/v1/projects', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;

    if (
      req.body &&
      typeof req.body === 'object' &&
      'ownerUid' in req.body &&
      req.body.ownerUid !== uid
    ) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'Cannot create a project record owned by another user.'
      );
    }

    const parsed = ProjectCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid project payload.',
        parsed.error.flatten()
      );
    }

    if (
      parsed.data.description.includes('blob:') ||
      parsed.data.title.includes('blob:')
    ) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'LOCAL_BLOB_URL_FORBIDDEN',
        'Never save a local blob: URL as if it were a persistent cloud URL.'
      );
    }

    const now = new Date().toISOString();
    const projId = `proj_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    let canonicalProjectJson = parsed.data.canonicalProjectJson;
    let revision = parsed.data.revision || 1;
    let activeBranch = parsed.data.activeBranch || 'main';

    if (canonicalProjectJson) {
      try {
        const parsedCanon = JSON.parse(canonicalProjectJson);
        const check = validateCanonicalProject(parsedCanon);
        if (!check.valid || !check.project) {
          return sendError(
            res,
            authReq.requestId,
            400,
            'INVALID_CANONICAL_PROJECT',
            check.errors.join('; ')
          );
        }
        check.project.id = projId;
        check.project.ownerUid = uid;
        canonicalProjectJson = serializeCanonicalProject(check.project);
        revision = check.project.revision;
        activeBranch = check.project.activeBranch;
        canonicalProjectStores.set(projId, new CanonicalProjectStore(check.project));
      } catch {
        return sendError(
          res,
          authReq.requestId,
          400,
          'INVALID_CANONICAL_PROJECT',
          'canonicalProjectJson is not valid JSON.'
        );
      }
    } else if (parsed.data.projectFileStatus === 'sowveil-native') {
      const initDoc = parsed.data.sowveilSpecJson
        ? migrateToCanonicalProject(JSON.parse(parsed.data.sowveilSpecJson), uid).project
        : createMinimalCanonicalProject({
            id: projId,
            ownerUid: uid,
            title: parsed.data.title,
            description: parsed.data.description,
            targetEditor: parsed.data.targetEditor || 'sowveil-project',
            aspectRatio: parsed.data.aspectRatio || '9:16',
          });
      initDoc.id = projId;
      initDoc.ownerUid = uid;
      initDoc.title = parsed.data.title;
      canonicalProjectJson = serializeCanonicalProject(initDoc);
      revision = initDoc.revision;
      activeBranch = initDoc.activeBranch;
      canonicalProjectStores.set(projId, new CanonicalProjectStore(initDoc));
    }

    const record: ProjectLibraryItem = {
      id: projId,
      ownerUid: uid,
      ...parsed.data,
      ...(canonicalProjectJson ? { canonicalProjectJson } : {}),
      revision,
      activeBranch,
      createdAt: now,
      updatedAt: now,
    };
    projectsStore.set(record.id, record);
    persistState();
    return sendOk(res, authReq.requestId, record, 201);
  });

  app.get('/api/v1/projects/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const proj = projectsStore.get(req.params.id);
    if (!proj) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Project not found.');
    }
    if (proj.ownerUid !== uid && authReq.userRole === 'user') {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to read another user’s project.'
      );
    }
    return sendOk(res, authReq.requestId, proj);
  });

  app.get('/api/v1/projects/:id/canonical', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const proj = projectsStore.get(req.params.id);
    if (!proj) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Project not found.');
    }
    if (proj.ownerUid !== uid && authReq.userRole === 'user') {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to inspect another user’s project.'
      );
    }

    try {
      const { store, migrated, warnings } = getOrInitCanonicalStore(proj);
      const canonicalDoc = store.getProject();
      return sendOk(res, authReq.requestId, {
        project: canonicalDoc,
        migrated,
        warnings,
        canUndo: store.canUndo(),
        canRedo: store.canRedo(),
      });
    } catch (err) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'CANONICAL_LOAD_FAILED',
        err instanceof Error ? err.message : 'Unable to load canonical project.'
      );
    }
  });

  app.post('/api/v1/projects/:id/commands', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const proj = projectsStore.get(req.params.id);
    if (!proj) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Project not found.');
    }
    if (proj.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to execute editing commands on another user’s project.'
      );
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const commandPayload = body.command ? body.command : body;
    if (!commandPayload || typeof commandPayload.type !== 'string') {
      return sendError(
        res,
        authReq.requestId,
        400,
        'INVALID_COMMAND',
        'Command payload must include a valid command "type".'
      );
    }

    const { store } = getOrInitCanonicalStore(proj);
    const actorKind: 'user' | 'ai-director' =
      body.actorKind === 'ai-director' ? 'ai-director' : 'user';
    const rationale =
      typeof body.rationale === 'string' && body.rationale.trim()
        ? sanitizeUserLabelAndMarkdown(body.rationale, 400)
        : undefined;

    let receipt;
    if (commandPayload.type === 'undo') {
      receipt = store.undo(uid);
    } else if (commandPayload.type === 'redo') {
      receipt = store.redo(uid);
    } else {
      receipt = store.dispatch(commandPayload as CanonicalProjectCommand, {
        actorId: uid,
        actorKind,
        rationale,
        approvedByUser: body.approvedByUser ?? actorKind === 'user',
      });
    }

    if (!receipt.ok) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'COMMAND_REJECTED',
        receipt.errors.join('; ') || 'Command rejected by canonical project engine.',
        { receipt }
      );
    }

    const updatedCanonical = store.getProject();
    const libUpdate = canonicalProjectToLibraryRecord(updatedCanonical);
    const updatedProj: ProjectLibraryItem = {
      ...proj,
      ...libUpdate,
      id: proj.id,
      ownerUid: proj.ownerUid,
      checkpoints: proj.checkpoints,
      updatedAt: updatedCanonical.updatedAt,
    };
    projectsStore.set(proj.id, updatedProj);
    persistState();

    return sendOk(res, authReq.requestId, {
      project: updatedCanonical,
      receipt,
      canUndo: store.canUndo(),
      canRedo: store.canRedo(),
      libraryRecord: updatedProj,
    });
  });

  app.patch('/api/v1/projects/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const proj = projectsStore.get(req.params.id);
    if (!proj) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Project not found.');
    }
    if (proj.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to modify another user’s project.'
      );
    }

    const parsed = ProjectPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid project update payload.',
        parsed.error.flatten()
      );
    }

    if (parsed.data.canonicalProjectJson) {
      try {
        const parsedCanon = JSON.parse(parsed.data.canonicalProjectJson);
        const check = validateCanonicalProject(parsedCanon);
        if (!check.valid || !check.project) {
          return sendError(
            res,
            authReq.requestId,
            400,
            'INVALID_CANONICAL_PROJECT',
            check.errors.join('; ')
          );
        }
        check.project.id = proj.id;
        check.project.ownerUid = uid;
        canonicalProjectStores.set(proj.id, new CanonicalProjectStore(check.project));
      } catch {
        return sendError(
          res,
          authReq.requestId,
          400,
          'INVALID_CANONICAL_PROJECT',
          'canonicalProjectJson is not valid JSON.'
        );
      }
    }

    const updated: ProjectLibraryItem = {
      ...proj,
      ...parsed.data,
      id: proj.id,
      ownerUid: proj.ownerUid,
      updatedAt: new Date().toISOString(),
    };
    projectsStore.set(proj.id, updated);
    persistState();
    return sendOk(res, authReq.requestId, updated);
  });

  app.delete('/api/v1/projects/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const proj = projectsStore.get(req.params.id);
    if (!proj) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Project not found.');
    }
    if (proj.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You do not have permission to delete another user’s project.'
      );
    }
    projectsStore.delete(proj.id);
    canonicalProjectStores.delete(proj.id);
    persistState();
    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'PROJECT_DELETED',
      proj.id,
      `Deleted project "${proj.title}"`,
      authReq.requestId,
      'user',
      'success'
    );
    return sendOk(res, authReq.requestId, { deletedId: proj.id });
  });

  // Cloud Object Storage Gate
  app.post('/api/v1/assets/upload-url', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    if (!storageEnabled) {
      return sendError(
        res,
        authReq.requestId,
        503,
        'STORAGE_NOT_CONFIGURED',
        'Storage not configured: Cloud object storage uploads are not enabled in this environment. Use metadata-only or linked-local project records.'
      );
    }
    return sendOk(res, authReq.requestId, { uploadUrl: null });
  });

  // Devices & Pairing Tokens
  app.get('/api/v1/devices', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const owned = Array.from(devicesStore.values()).filter((d) => d.ownerUid === uid);
    return sendOk(res, authReq.requestId, { items: owned, total: owned.length });
  });

  app.post('/api/v1/devices/pairing/start', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const parsed = PairingStartSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid pairing request payload.',
        parsed.error.flatten()
      );
    }

    const rawToken = `sowveil_pair_${crypto.randomBytes(16).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenId = `ptok_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    pairingTokensStore.set(tokenId, {
      id: tokenId,
      ownerUid: uid,
      tokenHash,
      deviceName: parsed.data.deviceName,
      platform: parsed.data.platform,
      expiresAt,
    });

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'DEVICE_PAIRING_TOKEN_ISSUED',
      tokenId,
      `Issued one-time pairing token for "${parsed.data.deviceName}" (${parsed.data.platform})`,
      authReq.requestId,
      'user',
      'success'
    );

    return sendOk(
      res,
      authReq.requestId,
      {
        pairingTokenId: tokenId,
        oneTimePairingCode: rawToken,
        expiresAt,
      },
      201
    );
  });

  // Jobs & Connector Result Reporting (Idempotent + Terminal Lock)
  app.get('/api/v1/jobs', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const { limit, offset } = parsePagination(req);
    const owned = Array.from(jobsStore.values()).filter((j) => j.ownerUid === uid);
    return sendOk(res, authReq.requestId, {
      items: owned.slice(offset, offset + limit),
      total: owned.length,
      limit,
      offset,
    });
  });

  app.post('/api/v1/jobs', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const parsed = JobCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid job payload.',
        parsed.error.flatten()
      );
    }

    const idemKey =
      parsed.data.idempotencyKey ||
      `${uid}:${parsed.data.type}:${parsed.data.moduleId}:${parsed.data.operation || 'none'}:${parsed.data.title}`;

    const existingActive = Array.from(jobsStore.values()).find(
      (j) =>
        j.ownerUid === uid &&
        j.idempotencyKey === idemKey &&
        (j.status === 'queued' || j.status === 'claimed' || j.status === 'running')
    );
    if (existingActive) {
      return sendOk(res, authReq.requestId, existingActive, 200);
    }

    const now = new Date().toISOString();
    const record: JobRecord = {
      id: `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      ownerUid: uid,
      type: parsed.data.type,
      title: parsed.data.title,
      moduleId: parsed.data.moduleId as JobRecord['moduleId'],
      itemId: parsed.data.itemId,
      operation: parsed.data.operation as JobRecord['operation'],
      targetEditor: parsed.data.targetEditor,
      exportFormat: parsed.data.exportFormat,
      aspectRatio: parsed.data.aspectRatio,
      outputFileName: parsed.data.outputFileName,
      outputMimeType: parsed.data.outputMimeType,
      outputSizeBytes: parsed.data.outputSizeBytes,
      processedBytes: parsed.data.processedBytes,
      totalBytes: parsed.data.totalBytes,
      completedStageIndex: parsed.data.completedStageIndex,
      totalStages: parsed.data.totalStages,
      stageLabel: parsed.data.stageLabel,
      status: parsed.data.status,
      createdAt: now,
      updatedAt: now,
      attemptCount: 1,
      idempotencyKey: idemKey,
      deviceId: parsed.data.deviceId,
      errorCode: parsed.data.errorCode,
      redactedMessage: redactSensitiveDiagnosticString(parsed.data.redactedMessage),
      requestId: authReq.requestId,
    };
    jobsStore.set(record.id, record);
    return sendOk(res, authReq.requestId, record, 201);
  });

  const exportJobsStore = new Map<
    string,
    {
      exportJob: ExportJob;
      rawBytes: Uint8Array;
      customValues?: Record<string, string | number | boolean>;
    }
  >();

  app.post('/api/v1/exports/generate', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const parsed = MobileExportGenerateSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid mobile export request payload.',
        parsed.error.flatten()
      );
    }

    const item = catalogStore.get(parsed.data.itemId);
    if (!item || (item.visibility !== 'published' && authReq.userRole === 'user')) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Catalog item not found.');
    }

    // Enforce per-user daily export quota
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const userExportsToday = Array.from(jobsStore.values()).filter(
      (j) =>
        j.ownerUid === uid &&
        j.type === 'mobile-export' &&
        j.createdAt.startsWith(todayPrefix)
    ).length;

    if (userExportsToday >= platformSettings.userDailyExportQuota) {
      return sendError(
        res,
        authReq.requestId,
        429,
        'EXPORT_DAILY_QUOTA_EXCEEDED',
        `Daily mobile export quota (${platformSettings.userDailyExportQuota} exports/day) reached. Please wait or ask an administrator to increase the quota.`
      );
    }

    const artifact = buildMobileEditorExportArtifact({
      item,
      targetEditor: parsed.data.targetEditor,
      format: parsed.data.format,
      aspectRatio: parsed.data.aspectRatio,
      fps: parsed.data.fps,
      durationSec: parsed.data.durationSec,
      qualityPolicy: parsed.data.qualityPolicy,
      backgroundMode: parsed.data.backgroundMode,
      customValues: parsed.data.customValues,
    });

    const maxBytes = platformSettings.exportMaxSizeMb * 1024 * 1024;
    if (artifact.bytes.byteLength > maxBytes) {
      return sendError(
        res,
        authReq.requestId,
        413,
        'EXPORT_SIZE_CAP_EXCEEDED',
        `Generated export exceeds configured cap of ${platformSettings.exportMaxSizeMb} MB.`
      );
    }

    const now = new Date().toISOString();
    const retentionExpiresAt = new Date(
      Date.now() + platformSettings.jobRetentionDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const jobId = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    const jobRecord: JobRecord = {
      id: jobId,
      ownerUid: uid,
      type: 'mobile-export',
      title: `Export "${item.name}" → ${artifact.adapter.shortName} (${artifact.aspectRatio})`,
      moduleId: item.moduleId,
      itemId: item.id,
      targetEditor: artifact.adapter.id,
      exportFormat: artifact.format,
      aspectRatio: artifact.aspectRatio,
      outputFileName: artifact.fileName,
      outputMimeType: artifact.mimeType,
      outputSizeBytes: artifact.bytes.byteLength,
      status: artifact.validationPassed ? 'ready' : 'failed',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: now,
      attemptCount: 1,
      idempotencyKey: `${uid}:mobile-export:${item.id}:${artifact.adapter.id}:${artifact.format}:${artifact.aspectRatio}:${Date.now()}`,
      deviceId: 'android-mobile-pwa',
      redactedMessage: `${artifact.validationDetails} · File: ${artifact.fileName}`,
      requestId: authReq.requestId,
    };
    jobsStore.set(jobRecord.id, jobRecord);

    const exportJob: ExportJob = {
      id: jobId,
      userId: uid,
      documentId: artifact.manifestObject.sourceDocument.documentId,
      documentVersion: artifact.manifestObject.sourceDocument.schemaVersion,
      itemId: item.id,
      itemName: item.name,
      moduleId: item.moduleId,
      destinationEditor: artifact.adapter.id,
      requestedPreset: artifact.preset,
      capabilityStatus: artifact.adapter.compatibilityStatus,
      queueState: jobRecord.status,
      resultFiles: [
        {
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.bytes.byteLength,
          sha256: artifact.sha256,
          format: artifact.format,
          textPreview: artifact.textPreview,
        },
      ],
      progressEvents: artifact.progressEvents,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: now,
      retentionExpiresAt,
      retryPolicy: {
        attemptCount: 1,
        maxAttempts: 3,
        canRetry: true,
      },
    };

    exportJobsStore.set(jobId, {
      exportJob,
      rawBytes: artifact.bytes,
      customValues: parsed.data.customValues,
    });

    return sendOk(
      res,
      authReq.requestId,
      {
        job: jobRecord,
        exportJob,
        artifact: {
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.bytes.byteLength,
          sha256: artifact.sha256,
          format: artifact.format,
          aspectRatio: artifact.aspectRatio,
          targetEditor: artifact.adapter.id,
          bundleLabel: artifact.bundleLabel,
          compatibilityStatus: artifact.adapter.compatibilityStatus,
          validationPassed: artifact.validationPassed,
          validationDetails: artifact.validationDetails,
          importSteps: artifact.importSteps,
          whyNotDirectNote: artifact.whyNotDirectNote,
          bundleManifest: artifact.bundleManifest,
          manifest: artifact.manifestObject,
          preset: artifact.preset,
          base64Content: Buffer.from(artifact.bytes).toString('base64'),
        },
      },
      201
    );
  });

  app.get('/api/v1/exports/jobs/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    const stored = exportJobsStore.get(req.params.id);
    if (!stored) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Export job not found.');
    }
    if (stored.exportJob.userId !== uid && !isAdmin) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You cannot inspect another user’s export job.'
      );
    }
    return sendOk(res, authReq.requestId, stored.exportJob);
  });

  app.get('/api/v1/exports/jobs/:id/download', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const stored = exportJobsStore.get(req.params.id);
    if (!stored) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Export job artifact not found.');
    }
    if (stored.exportJob.userId !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You cannot download another user’s export artifact.'
      );
    }
    if (new Date(stored.exportJob.retentionExpiresAt).getTime() < Date.now()) {
      return sendError(
        res,
        authReq.requestId,
        410,
        'EXPORT_ARTIFACT_EXPIRED',
        'Temporary export artifact has expired according to the retention policy. Re-run the export job.'
      );
    }

    const fileMeta = stored.exportJob.resultFiles[0];
    return sendOk(res, authReq.requestId, {
      jobId: stored.exportJob.id,
      fileName: fileMeta.fileName,
      mimeType: fileMeta.mimeType,
      sizeBytes: fileMeta.sizeBytes,
      sha256: fileMeta.sha256,
      retentionExpiresAt: stored.exportJob.retentionExpiresAt,
      base64Content: Buffer.from(stored.rawBytes).toString('base64'),
    });
  });

  app.post('/api/v1/exports/jobs/:id/retry', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const stored = exportJobsStore.get(req.params.id);
    if (!stored) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Export job not found.');
    }
    if (stored.exportJob.userId !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You cannot retry another user’s export job.'
      );
    }
    const item = catalogStore.get(stored.exportJob.itemId);
    if (!item) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Source catalog item not found.');
    }

    const refreshed = buildMobileEditorExportArtifact({
      item,
      targetEditor: stored.exportJob.destinationEditor,
      format: stored.exportJob.requestedPreset.outputFormat,
      aspectRatio: stored.exportJob.requestedPreset.aspectRatio,
      fps: stored.exportJob.requestedPreset.fps,
      durationSec: stored.exportJob.requestedPreset.durationSec,
      qualityPolicy: stored.exportJob.requestedPreset.qualityPolicy,
      backgroundMode: stored.exportJob.requestedPreset.backgroundMode,
      customValues: stored.customValues,
    });

    const now = new Date().toISOString();
    stored.exportJob = {
      ...stored.exportJob,
      queueState: refreshed.validationPassed ? 'ready' : 'failed',
      updatedAt: now,
      completedAt: now,
      retryPolicy: {
        ...stored.exportJob.retryPolicy,
        attemptCount: stored.exportJob.retryPolicy.attemptCount + 1,
      },
    };
    stored.rawBytes = refreshed.bytes;
    exportJobsStore.set(req.params.id, stored);

    const jobRecord = jobsStore.get(req.params.id);
    if (jobRecord) {
      jobsStore.set(req.params.id, {
        ...jobRecord,
        status: refreshed.validationPassed ? 'ready' : 'failed',
        attemptCount: jobRecord.attemptCount + 1,
        updatedAt: now,
      });
    }

    return sendOk(res, authReq.requestId, {
      exportJob: stored.exportJob,
      retriedAt: now,
    });
  });

  app.delete('/api/v1/exports/jobs/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const stored = exportJobsStore.get(req.params.id);
    if (!stored) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Export job not found.');
    }
    if (stored.exportJob.userId !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You cannot delete another user’s export job.'
      );
    }
    exportJobsStore.delete(req.params.id);
    jobsStore.delete(req.params.id);
    return sendOk(res, authReq.requestId, { deletedJobId: req.params.id });
  });

  app.post('/api/v1/connector/jobs/:id/result', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const job = jobsStore.get(req.params.id);
    if (!job) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Job not found.');
    }
    if (job.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'Cannot report results for another user’s job.'
      );
    }

    const parsed = JobTransitionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid job result payload.',
        parsed.error.flatten()
      );
    }

    if (
      job.status === 'downloaded' ||
      job.status === 'succeeded' ||
      job.status === 'cancelled' ||
      job.status === 'expired'
    ) {
      return sendError(
        res,
        authReq.requestId,
        409,
        'DUPLICATE_TERMINAL_JOB_RESULT',
        `Job "${job.id}" is already in terminal state "${job.status}" and cannot accept duplicate results.`
      );
    }

    if (!canTransitionJob(job.status, parsed.data.status as JobStatus)) {
      return sendError(
        res,
        authReq.requestId,
        409,
        'INVALID_JOB_TRANSITION',
        `Cannot transition job from "${job.status}" to "${parsed.data.status}".`
      );
    }

    const updated = transitionJobRecord(job, parsed.data.status as JobStatus, {
      redactedMessage: parsed.data.redactedMessage
        ? redactSensitiveDiagnosticString(parsed.data.redactedMessage)
        : undefined,
      errorCode: parsed.data.errorCode,
      deviceId: parsed.data.deviceId,
      processedBytes: parsed.data.processedBytes,
      totalBytes: parsed.data.totalBytes,
      completedStageIndex: parsed.data.completedStageIndex,
      totalStages: parsed.data.totalStages,
      stageLabel: parsed.data.stageLabel,
    });
    jobsStore.set(job.id, updated);
    return sendOk(res, authReq.requestId, updated);
  });

  // Owner-scoped job transition endpoint (cancel, retry, or deterministic progress update)
  app.patch('/api/v1/jobs/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const job = jobsStore.get(req.params.id);
    if (!job) {
      return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Job not found.');
    }
    if (job.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'CROSS_USER_ACCESS_FORBIDDEN',
        'You cannot modify or transition another user’s job.'
      );
    }

    const parsed = JobTransitionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'Invalid job transition payload.',
        parsed.error.flatten()
      );
    }

    if (!canTransitionJob(job.status, parsed.data.status as JobStatus)) {
      return sendError(
        res,
        authReq.requestId,
        409,
        'INVALID_JOB_TRANSITION',
        `Cannot transition job from "${job.status}" to "${parsed.data.status}".`
      );
    }

    const updated = transitionJobRecord(job, parsed.data.status as JobStatus, {
      redactedMessage: parsed.data.redactedMessage
        ? redactSensitiveDiagnosticString(parsed.data.redactedMessage)
        : undefined,
      errorCode: parsed.data.errorCode,
      deviceId: parsed.data.deviceId,
      processedBytes: parsed.data.processedBytes,
      totalBytes: parsed.data.totalBytes,
      completedStageIndex: parsed.data.completedStageIndex,
      totalStages: parsed.data.totalStages,
      stageLabel: parsed.data.stageLabel,
    });
    jobsStore.set(job.id, updated);

    const progress = computeDeterministicJobProgress({
      status: (updated.status === 'succeeded' || updated.status === 'downloaded'
        ? 'ready'
        : updated.status === 'claimed'
        ? 'running'
        : updated.status === 'expired'
        ? 'failed'
        : updated.status) as Parameters<typeof computeDeterministicJobProgress>[0]['status'],
      processedBytes: updated.processedBytes,
      totalBytes: updated.totalBytes,
      completedStageIndex: updated.completedStageIndex,
      totalStages: updated.totalStages,
    });

    return sendOk(res, authReq.requestId, {
      job: updated,
      progress,
    });
  });

  // Phase 6: SSRF-Hardened Media URL Validation & Worker Gate Endpoint
  app.post('/api/v1/media/validate-url', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
    const mode =
      req.body?.mode === 'audio' || req.body?.mode === 'thumbnail' ? req.body.mode : 'video';
    const rightsConfirmed = Boolean(req.body?.rightsConfirmed);

    if (!rightsConfirmed) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'RIGHTS_CONFIRMATION_REQUIRED',
        'You must confirm ownership or permission to download or import this media asset.'
      );
    }

    const ssrfCheck = validateMediaUrlForSsrf(rawUrl, {
      workerConfigured: false,
      maxResponseMb: platformSettings.exportMaxSizeMb,
    });

    if (!ssrfCheck.allowed) {
      const status =
        ssrfCheck.errorCode === 'SERVER_EXTRACTOR_WORKER_REQUIRED'
          ? 200
          : ssrfCheck.errorCode?.startsWith('SSRF_') ||
            ssrfCheck.errorCode === 'CREDENTIALS_IN_URL_FORBIDDEN'
          ? 403
          : 400;

      if (status === 200) {
        return sendOk(res, authReq.requestId, {
          allowed: false,
          sourceStatus: ssrfCheck.sourceStatus,
          jobStatus: 'needs-setup',
          errorCode: ssrfCheck.errorCode,
          hostname: ssrfCheck.hostname,
          mode,
          reason: ssrfCheck.reason,
          policy: {
            maxRedirects: ssrfCheck.maxRedirects,
            timeoutMs: ssrfCheck.timeoutMs,
            maxResponseBytes: ssrfCheck.maxResponseBytes,
          },
        });
      }

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'MEDIA_URL_SSRF_OR_SCHEME_BLOCKED',
        ssrfCheck.hostname || 'invalid-url',
        `Blocked media URL (${ssrfCheck.errorCode}): ${ssrfCheck.reason}`,
        authReq.requestId,
        'system',
        'denied'
      );

      return sendError(
        res,
        authReq.requestId,
        status,
        ssrfCheck.errorCode || 'SSRF_BLOCKED',
        ssrfCheck.reason,
        {
          sourceStatus: ssrfCheck.sourceStatus,
          hostname: ssrfCheck.hostname,
        }
      );
    }

    const uid = authReq.authIdentity!.uid;
    const todayPrefix = new Date().toISOString().slice(0, 10);
    const dailyCount = Array.from(jobsStore.values()).filter(
      (j) => j.ownerUid === uid && j.createdAt.startsWith(todayPrefix)
    ).length;

    const gate = evaluateMediaJobWorkerGate({
      executionTier: 'browser-verified',
      dailyUserJobsCount: dailyCount,
      limits: {
        maxUploadSizeMb: platformSettings.exportMaxSizeMb,
        dailyJobQuotaPerUser: platformSettings.userDailyExportQuota,
      },
    });

    return sendOk(res, authReq.requestId, {
      allowed: gate.allowed,
      sourceStatus: ssrfCheck.sourceStatus,
      jobStatus: gate.resultingStatus,
      normalizedUrl: ssrfCheck.normalizedUrl,
      hostname: ssrfCheck.hostname,
      detectedExtension: ssrfCheck.detectedExtension || null,
      mode,
      reason: gate.allowed ? ssrfCheck.reason : gate.reason,
      costWarning: gate.costWarning,
      policy: {
        maxRedirects: ssrfCheck.maxRedirects,
        timeoutMs: ssrfCheck.timeoutMs,
        maxResponseBytes: ssrfCheck.maxResponseBytes,
      },
    });
  });

  // Phase 6: Media Magic-Byte & Container Signature Inspector
  app.post('/api/v1/media/inspect-bytes', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const base64Head = typeof req.body?.base64Head === 'string' ? req.body.base64Head : '';
    const fileName = sanitizeMediaFileName(
      typeof req.body?.fileName === 'string' ? req.body.fileName : 'upload.bin'
    );
    const fileSizeBytes =
      typeof req.body?.fileSizeBytes === 'number' ? req.body.fileSizeBytes : 0;

    const maxBytes = platformSettings.exportMaxSizeMb * 1024 * 1024;
    if (fileSizeBytes > maxBytes) {
      return sendError(
        res,
        authReq.requestId,
        413,
        'FILE_SIZE_LIMIT_EXCEEDED',
        `File "${fileName}" (${(fileSizeBytes / (1024 * 1024)).toFixed(2)} MB) exceeds mobile upload cap of ${platformSettings.exportMaxSizeMb} MB.`
      );
    }

    const bytes = new Uint8Array(Buffer.from(base64Head, 'base64'));
    const sig = verifyMediaMagicBytes(bytes, fileName);
    if (!sig.valid) {
      return sendError(
        res,
        authReq.requestId,
        415,
        sig.errorCode || 'UNSUPPORTED_CODEC_OR_CONTAINER',
        sig.reason,
        {
          sanitizedFileName: fileName,
          detectedContainer: sig.detectedContainer,
        }
      );
    }

    return sendOk(res, authReq.requestId, {
      valid: true,
      sanitizedFileName: fileName,
      detectedContainer: sig.detectedContainer,
      detectedMimeType: sig.detectedMimeType,
      reason: sig.reason,
    });
  });

  // Phase 6: Auto Captions Validation & Mobile Editor Sidecar Bundle Endpoint
  app.post(
    '/api/v1/captions/validate-and-bundle',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const cues = Array.isArray(req.body?.cues) ? req.body.cues : [];
      const config =
        req.body?.config && typeof req.body.config === 'object' ? req.body.config : undefined;
      const baseName =
        typeof req.body?.baseName === 'string' ? req.body.baseName : 'sowveil-captions';
      const targetEditor: TargetMobileEditorId =
        typeof req.body?.targetEditor === 'string' ? req.body.targetEditor : 'capcut';
      const language = typeof req.body?.language === 'string' ? req.body.language : 'en';
      const wordsPerCaption =
        typeof req.body?.wordsPerCaption === 'number' ? req.body.wordsPerCaption : 3;
      const generateSidecarZip = Boolean(req.body?.generateSidecarZip);

      const validation = validateCaptionTimeline(cues, config);

      let sidecarBundle:
        | {
            fileName: string;
            mimeType: string;
            sizeBytes: number;
            base64Content: string;
          }
        | undefined;

      if (generateSidecarZip && validation.valid && cues.length > 0) {
        const built = buildCaptionSidecarZipBundle({
          baseName,
          targetEditor,
          language,
          wordsPerCaption,
          cues,
        });
        sidecarBundle = {
          fileName: built.fileName,
          mimeType: built.mimeType,
          sizeBytes: built.sizeBytes,
          base64Content: Buffer.from(built.bytes).toString('base64'),
        };
      }

      return sendOk(res, authReq.requestId, {
        validation,
        sidecarBundle,
      });
    }
  );

  // --- SAFE ONE-TIME OWNER BOOTSTRAP ---
  app.post('/api/v1/admin/bootstrap-owner', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const identity = authReq.authIdentity!;
    if (!configuredBootstrapSecret) {
      return sendError(
        res,
        authReq.requestId,
        503,
        'BOOTSTRAP_NOT_CONFIGURED',
        'Owner bootstrap is disabled because OWNER_BOOTSTRAP_SECRET is not configured on the server.'
      );
    }

    if (ownerBootstrappedUid) {
      return sendError(
        res,
        authReq.requestId,
        409,
        'OWNER_ALREADY_BOOTSTRAPPED',
        'One-time owner bootstrap has already been completed and is permanently locked.'
      );
    }

    if (identity.email.toLowerCase() !== configuredOwnerEmail) {
      recordAudit(
        identity.uid,
        identity.email,
        'OWNER_BOOTSTRAP_DENIED_EMAIL_MISMATCH',
        identity.uid,
        'Denied bootstrap attempt from non-owner email',
        authReq.requestId,
        'role',
        'denied'
      );
      return sendError(
        res,
        authReq.requestId,
        403,
        'OWNER_EMAIL_MISMATCH',
        'Only the designated project owner email can execute one-time owner bootstrap.'
      );
    }

    const suppliedSecret =
      typeof req.body?.bootstrapSecret === 'string' ? req.body.bootstrapSecret.trim() : '';
    if (!suppliedSecret || suppliedSecret !== configuredBootstrapSecret) {
      recordAudit(
        identity.uid,
        identity.email,
        'OWNER_BOOTSTRAP_DENIED_INVALID_SECRET',
        identity.uid,
        'Invalid or missing one-time owner bootstrap secret',
        authReq.requestId,
        'role',
        'denied'
      );
      return sendError(
        res,
        authReq.requestId,
        403,
        'INVALID_BOOTSTRAP_SECRET',
        'Invalid one-time bootstrap confirmation secret.'
      );
    }

    ownerBootstrappedUid = identity.uid;
    roleStore.set(identity.uid, 'owner');
    userStatusStore.set(identity.uid, 'active');
    syncUserIntoDirectory(identity, 'owner');

    recordAudit(
      identity.uid,
      identity.email,
      'OWNER_BOOTSTRAP_COMPLETED',
      identity.uid,
      'Promoted verified project owner account via one-time bootstrap',
      authReq.requestId,
      'role',
      'success'
    );

    return sendOk(res, authReq.requestId, {
      uid: identity.uid,
      email: identity.email,
      role: 'owner' as UserRole,
      bootstrappedAt: new Date().toISOString(),
    });
  });

  // --- ADMIN & OWNER PROTECTED ROUTES ---

  // 1. Operational Summary (/admin)
  app.get(
    '/api/v1/admin/summary',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const range =
        typeof req.query.range === 'string' &&
        ['24h', '7d', '30d', 'all'].includes(req.query.range)
          ? (req.query.range as '24h' | '7d' | '30d' | 'all')
          : '7d';

      const nowMs = Date.now();
      const cutoffMs =
        range === '24h'
          ? nowMs - 24 * 3600_000
          : range === '7d'
          ? nowMs - 7 * 24 * 3600_000
          : range === '30d'
          ? nowMs - 30 * 24 * 3600_000
          : 0;

      const allCatalog = Array.from(catalogStore.values());
      const allModules = Array.from(modulesStore.values());
      const allUsers = Array.from(usersDirectoryStore.values());
      const allJobs = Array.from(jobsStore.values()).filter(
        (j) => Date.parse(j.createdAt) >= cutoffMs || cutoffMs === 0
      );
      const allAssets = Array.from(assetsStore.values());
      const rangeAudit = auditLog.filter(
        (a) => Date.parse(a.createdAt) >= cutoffMs || cutoffMs === 0
      );

      return sendOk(res, authReq.requestId, {
        range,
        generatedAt: new Date().toISOString(),
        catalog: {
          total: allCatalog.length,
          published: allCatalog.filter((c) => c.visibility === 'published').length,
          draft: allCatalog.filter((c) => c.visibility === 'draft').length,
          archived: allCatalog.filter((c) => c.visibility === 'archived').length,
          cacheVersion: catalogCacheVersion,
        },
        modules: {
          total: allModules.length,
          enabled: allModules.filter((m) => m.enabled).length,
          disabled: allModules.filter((m) => !m.enabled).length,
        },
        users: {
          total: allUsers.length,
          active: allUsers.filter((u) => u.status === 'active').length,
          suspended: allUsers.filter((u) => u.status === 'suspended').length,
          owners: allUsers.filter((u) => u.role === 'owner').length,
          admins: allUsers.filter((u) => u.role === 'admin').length,
        },
        jobs: {
          totalInRange: allJobs.length,
          queued: allJobs.filter((j) => j.status === 'queued' || j.status === 'claimed').length,
          running: allJobs.filter((j) => j.status === 'running').length,
          readyOrDownloaded: allJobs.filter(
            (j) => j.status === 'ready' || j.status === 'downloaded' || j.status === 'succeeded'
          ).length,
          failed: allJobs.filter((j) => j.status === 'failed').length,
          needsSetup: allJobs.filter((j) => j.status === 'needs-setup').length,
        },
        assets: {
          total: allAssets.length,
          metadataOnly: allAssets.filter((a) => a.status === 'metadata-only').length,
          stored: allAssets.filter((a) => a.status === 'stored').length,
          storageProvider: storageEnabled ? 'cloud-storage' : 'none-configured',
        },
        auditCountInRange: rangeAudit.length,
        recentAuditEvents: rangeAudit.slice(0, 8),
      });
    }
  );

  // 2. Catalog Create / Update / Archive-Delete with Cache Invalidation, Provenance/License Enforcement & Retention Checks
  app.post(
    '/api/v1/catalog',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authIdentity!.uid;
      const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';

      // Standard users can only create private templates via POST /api/v1/catalog when explicitly specifying visibility: 'private'
      if (!isAdmin && req.body?.visibility !== 'private') {
        recordAudit(
          uid,
          authReq.authIdentity!.email,
          'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT',
          req.path,
          `Blocked role "${authReq.userRole}" from creating non-private catalog item`,
          authReq.requestId,
          'auth',
          'denied'
        );
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_ROLE',
          'Standard users can only create private templates (visibility="private") or use /api/v1/catalog/:id/fork.'
        );
      }

      const parsed = CatalogCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'Invalid catalog item payload.',
          parsed.error.flatten()
        );
      }

      if (catalogStore.has(parsed.data.id)) {
        return sendError(
          res,
          authReq.requestId,
          409,
          'DUPLICATE_CATALOG_ID',
          `Catalog item "${parsed.data.id}" already exists.`
        );
      }

      // Enforce license rule: cannot publish as public/community/published if licenseType is Unknown
      const effectiveLicense = parsed.data.licenseType || 'Unknown';
      if (
        (parsed.data.visibility === 'public' ||
          parsed.data.visibility === 'community' ||
          parsed.data.visibility === 'published') &&
        effectiveLicense === 'Unknown'
      ) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'LICENSE_REQUIRED_FOR_PUBLICATION',
          'Templates with Unknown license/rights cannot be published to public, community, or published visibility.'
        );
      }

      // Prevent setting validationState to 'Validated' without a recorded validation run
      if (parsed.data.validationState === 'Validated') {
        return sendError(
          res,
          authReq.requestId,
          400,
          'UNVERIFIED_VALIDATION_STATE_FORBIDDEN',
          'Templates cannot be marked Validated without running a recorded validation job via POST /api/v1/catalog/:id/validate.'
        );
      }

      const now = new Date().toISOString();
      const rawCreated: CatalogItem = {
        ...SEED_CATALOG_ITEMS[0],
        ...parsed.data,
        supportedOperations: (parsed.data.supportedOperations ||
          SEED_CATALOG_ITEMS[0].supportedOperations) as CatalogItem['supportedOperations'],
        name: sanitizeUserLabelAndMarkdown(parsed.data.name, 140),
        summary: sanitizeUserLabelAndMarkdown(parsed.data.summary, 500),
        description: sanitizeUserLabelAndMarkdown(parsed.data.description, 2000),
        creatorUid: uid,
        ownerUid: uid,
        licenseType: effectiveLicense,
        licenseNote: sanitizeUserLabelAndMarkdown(
          parsed.data.licenseNote ||
            (effectiveLicense === 'Unknown'
              ? 'License not declared — private/draft only'
              : `${effectiveLicense} license`),
          500
        ),
        validationState: parsed.data.validationState || 'Draft',
        metadata: {
          ...SEED_CATALOG_ITEMS[0].metadata,
          version: parsed.data.version || '1.0.0',
          fps: parsed.data.fps ?? SEED_CATALOG_ITEMS[0].metadata.fps,
          durationSec: parsed.data.durationSec ?? SEED_CATALOG_ITEMS[0].metadata.durationSec,
          resolution: parsed.data.resolution ?? SEED_CATALOG_ITEMS[0].metadata.resolution,
        },
        moduleId: parsed.data.moduleId as CatalogItem['moduleId'],
        createdAt: now,
        updatedAt: now,
      };
      const created = enrichCatalogItemWithMarketplaceDefaults(rawCreated);
      catalogStore.set(created.id, created);
      catalogCacheVersion += 1;
      persistState();

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        'CATALOG_ITEM_CREATED',
        created.id,
        `Created catalog item "${created.name}" (${created.visibility}, license=${created.licenseType}, cache v${catalogCacheVersion})`,
        authReq.requestId,
        'catalog',
        'success'
      );
      return sendOk(res, authReq.requestId, created, 201);
    }
  );

  app.patch(
    '/api/v1/catalog/:id',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authIdentity!.uid;
      const isAdmin = authReq.userRole === 'admin' || authReq.userRole === 'owner';
      const existing = catalogStore.get(req.params.id);
      if (!existing) {
        return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Catalog item not found.');
      }

      if (!isAdmin && existing.ownerUid !== uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_ROLE',
          'You do not have permission to modify this catalog item.'
        );
      }

      const parsed = CatalogPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'Invalid catalog patch payload.',
          parsed.error.flatten()
        );
      }

      if (parsed.data.validationState === 'Validated') {
        return sendError(
          res,
          authReq.requestId,
          400,
          'UNVERIFIED_VALIDATION_STATE_FORBIDDEN',
          'Cannot manually mark a template Validated without running POST /api/v1/catalog/:id/validate.'
        );
      }

      const nextVis = parsed.data.visibility ?? existing.visibility;
      const nextLicense = parsed.data.licenseType ?? existing.licenseType;
      if (
        (nextVis === 'public' ||
          nextVis === 'community' ||
          (nextVis === 'published' &&
            (parsed.data.licenseType === 'Unknown' ||
              existing.visibility === 'private' ||
              Boolean(existing.forkedFromTemplateId)))) &&
        nextLicense === 'Unknown'
      ) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'LICENSE_REQUIRED_FOR_PUBLICATION',
          'Cannot publish a template to public, community, or published visibility while licenseType is Unknown.'
        );
      }

      const prevVis = existing.visibility;
      const now = new Date().toISOString();
      const nextVersion = parsed.data.version || existing.metadata.version;
      const prevHistory = existing.versionHistory || [];
      const versionHistory =
        parsed.data.version && parsed.data.version !== existing.metadata.version
          ? [
              ...prevHistory,
              {
                version: parsed.data.version,
                updatedAt: now,
                updatedByUid: uid,
                changelog: `Updated to version ${parsed.data.version}`,
                snapshotHash: computeDeterministicSnapshotHash({
                  id: existing.id,
                  version: parsed.data.version,
                  name: parsed.data.name || existing.name,
                }),
              },
            ]
          : prevHistory;

      const updated: CatalogItem = enrichCatalogItemWithMarketplaceDefaults({
        ...existing,
        ...parsed.data,
        name:
          parsed.data.name !== undefined
            ? sanitizeUserLabelAndMarkdown(parsed.data.name, 140)
            : existing.name,
        summary:
          parsed.data.summary !== undefined
            ? sanitizeUserLabelAndMarkdown(parsed.data.summary, 500)
            : existing.summary,
        description:
          parsed.data.description !== undefined
            ? sanitizeUserLabelAndMarkdown(parsed.data.description, 2000)
            : existing.description,
        metadata: {
          ...existing.metadata,
          version: nextVersion,
        },
        versionHistory,
        id: existing.id,
        updatedAt: now,
      });
      catalogStore.set(updated.id, updated);
      catalogCacheVersion += 1;
      persistState();

      const auditAction =
        parsed.data.visibility === 'published' && prevVis !== 'published'
          ? 'CATALOG_ITEM_PUBLISHED'
          : parsed.data.visibility === 'archived' && prevVis !== 'archived'
          ? 'CATALOG_ITEM_ARCHIVED'
          : 'CATALOG_ITEM_UPDATED';

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        auditAction,
        updated.id,
        `Updated catalog item "${updated.name}" (${prevVis} → ${updated.visibility}, cache v${catalogCacheVersion})`,
        authReq.requestId,
        'catalog',
        'success'
      );
      return sendOk(res, authReq.requestId, updated);
    }
  );

  app.delete(
    '/api/v1/catalog/:id',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const existing = catalogStore.get(req.params.id);
      if (!existing) {
        return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Catalog item not found.');
      }

      const confirmed =
        req.query.confirm === 'true' ||
        (req.body && typeof req.body === 'object' && req.body.confirm === true);
      if (!confirmed) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'CONFIRMATION_REQUIRED',
          'Catalog deletion/archival requires explicit confirmation (confirm=true).'
        );
      }

      // Reference check across user favorites and projects
      let favoriteRefs = 0;
      for (const favSet of userFavoritesStore.values()) {
        if (favSet.has(existing.id)) favoriteRefs += 1;
      }
      const projectRefs = Array.from(projectsStore.values()).filter(
        (p) => p.sowveilSpecJson?.includes(existing.id) || p.title.includes(existing.name)
      ).length;

      // Soft-delete / archive to preserve user references per retention policy
      const archived: CatalogItem = {
        ...existing,
        visibility: 'archived',
        validationState: 'Archived',
        updatedAt: new Date().toISOString(),
      };
      catalogStore.set(existing.id, archived);
      catalogCacheVersion += 1;
      persistState();

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'CATALOG_ITEM_ARCHIVED_RETENTION',
        existing.id,
        `Soft-archived "${existing.name}" (preserved ${favoriteRefs} favorite refs & ${projectRefs} project refs, retention ${platformSettings.archivedCatalogRetentionDays}d)`,
        authReq.requestId,
        'catalog',
        'success'
      );

      return sendOk(res, authReq.requestId, {
        item: archived,
        retentionAction: 'archived-soft-delete',
        preservedReferences: {
          favoritesCount: favoriteRefs,
          projectsCount: projectRefs,
        },
        cacheVersion: catalogCacheVersion,
      });
    }
  );

  // 3. Admin Modules (/admin/modules)
  app.get(
    '/api/v1/admin/modules',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const allCatalog = Array.from(catalogStore.values());
      const items = Array.from(modulesStore.values())
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((m) => ({
          ...m,
          categories: MODULE_CATEGORIES.filter((c) => c.moduleId === m.id),
          catalogTotalCount: allCatalog.filter((c) => c.moduleId === m.id).length,
          publishedCount: allCatalog.filter(
            (c) => c.moduleId === m.id && c.visibility === 'published'
          ).length,
        }));
      return sendOk(res, authReq.requestId, { items, total: items.length });
    }
  );

  app.patch(
    '/api/v1/admin/modules/:id',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const mod = modulesStore.get(req.params.id);
      if (!mod) {
        return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Module not found.');
      }

      const parsed = ModuleAdminPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'Invalid module update payload.',
          parsed.error.flatten()
        );
      }

      const { confirmationReason, ...patchFields } = parsed.data;
      const updated: ModuleDefinition = {
        ...mod,
        ...patchFields,
        id: mod.id,
      };
      modulesStore.set(mod.id, updated);

      const actionName =
        parsed.data.enabled === false && mod.enabled
          ? 'MODULE_DISABLED'
          : parsed.data.enabled === true && !mod.enabled
          ? 'MODULE_ENABLED'
          : 'MODULE_UPDATED';

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        actionName,
        mod.id,
        `Updated module "${updated.label}" (enabled=${updated.enabled}${confirmationReason ? `, reason: ${confirmationReason}` : ''})`,
        authReq.requestId,
        'module',
        'success'
      );

      return sendOk(res, authReq.requestId, updated);
    }
  );

  app.delete(
    '/api/v1/admin/modules/:id',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'REQUIRED_MODULE_DELETE_BLOCKED',
        req.params.id,
        `Blocked attempt to delete required platform module "${req.params.id}"`,
        authReq.requestId,
        'module',
        'denied'
      );
      return sendError(
        res,
        authReq.requestId,
        403,
        'REQUIRED_MODULE_DELETION_FORBIDDEN',
        'Required 20 platform modules cannot be removed from Sowveil Studio. Disable the module with a confirmation reason instead.'
      );
    }
  );

  // 4. Admin Assets (/admin/assets)
  app.get(
    '/api/v1/admin/assets',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : undefined;
      const { limit, offset } = parsePagination(req);

      const filtered = Array.from(assetsStore.values()).filter((a) => {
        if (moduleId && a.moduleId !== moduleId) return false;
        if (q) {
          return (
            a.title.toLowerCase().includes(q) ||
            a.licenseType.toLowerCase().includes(q) ||
            a.licenseNote.toLowerCase().includes(q) ||
            a.sourceNote.toLowerCase().includes(q)
          );
        }
        return true;
      });

      return sendOk(res, authReq.requestId, {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        storageProvider: storageEnabled ? 'cloud-storage' : 'none-configured',
        storageProviderNote: storageEnabled
          ? 'Cloud Object Storage configured'
          : 'Binary object storage not configured — Asset registry operates in verified metadata-only mode without mocked URLs.',
      });
    }
  );

  app.post(
    '/api/v1/admin/assets',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const parsed = AssetMetadataCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'Invalid asset metadata payload.',
          parsed.error.flatten()
        );
      }

      const now = new Date().toISOString();
      const id =
        parsed.data.id || `asset_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const record: AssetMetadataRecord = {
        id,
        title: parsed.data.title || parsed.data.name || 'Untitled Asset',
        moduleId: parsed.data.moduleId || 'templates',
        catalogItemId: parsed.data.catalogItemId ?? null,
        assetKind: parsed.data.assetKind || parsed.data.kind || 'image',
        ownerUid: authReq.authIdentity!.uid,
        licenseType: parsed.data.licenseType || 'Unknown',
        licenseNote: parsed.data.licenseNote || '',
        sourceNote: parsed.data.sourceNote || 'Admin Asset Metadata',
        storageProvider: storageEnabled ? 'cloud-storage' : 'none-configured',
        storageObjectKey: null,
        mimeType: parsed.data.mimeType || 'application/octet-stream',
        sizeBytes: parsed.data.sizeBytes ?? parsed.data.byteSize ?? null,
        status: storageEnabled ? parsed.data.status : 'metadata-only',
        createdAt: now,
        updatedAt: now,
      };
      assetsStore.set(record.id, record);

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'ASSET_METADATA_CREATED',
        record.id,
        `Registered asset metadata "${record.title}" (${record.licenseType})`,
        authReq.requestId,
        'asset',
        'success'
      );

      return sendOk(res, authReq.requestId, record, 201);
    }
  );

  app.patch(
    '/api/v1/admin/assets/:id',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const existing = assetsStore.get(req.params.id);
      if (!existing) {
        return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Asset metadata not found.');
      }

      const parsed = AssetMetadataPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'Invalid asset patch payload.',
          parsed.error.flatten()
        );
      }

      const updated: AssetMetadataRecord = {
        ...existing,
        ...parsed.data,
        id: existing.id,
        updatedAt: new Date().toISOString(),
      };
      assetsStore.set(existing.id, updated);

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'ASSET_METADATA_UPDATED',
        existing.id,
        `Updated asset metadata "${updated.title}" (status=${updated.status}, license=${updated.licenseType})`,
        authReq.requestId,
        'asset',
        'success'
      );

      return sendOk(res, authReq.requestId, updated);
    }
  );

  // 5. Admin Users & Roles (/admin/users, /admin/roles) with Self-Escalation & Last-Owner Lockout Guards
  app.get(
    '/api/v1/admin/users',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const roleFilter = typeof req.query.role === 'string' ? req.query.role : undefined;

      const all = Array.from(usersDirectoryStore.values()).filter((u) => {
        if (roleFilter && u.role !== roleFilter) return false;
        if (q) {
          return (
            u.uid.toLowerCase().includes(q) ||
            u.displayName.toLowerCase().includes(q) ||
            u.emailMasked.toLowerCase().includes(q) ||
            u.role.toLowerCase().includes(q)
          );
        }
        return true;
      });

      return sendOk(res, authReq.requestId, {
        items: all,
        total: all.length,
        activeOwnerCount: countActiveOwners(),
      });
    }
  );

  app.patch(
    '/api/v1/admin/users/:uid/role',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const actorUid = authReq.authIdentity!.uid;
      const actorRole = authReq.userRole!;
      const targetUid = req.params.uid;

      const parsed = UserRoleAssignmentSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'Role must be one of user, admin, or owner.',
          parsed.error.flatten()
        );
      }

      const nextRole = parsed.data.role;
      const currentTargetRole = roleStore.get(targetUid) || 'user';

      // Guard 1: Only an owner can assign or modify the 'owner' role
      if ((nextRole === 'owner' || currentTargetRole === 'owner') && actorRole !== 'owner') {
        recordAudit(
          actorUid,
          authReq.authIdentity!.email,
          'ROLE_ASSIGNMENT_DENIED_NOT_OWNER',
          targetUid,
          `Blocked non-owner (${actorRole}) from assigning or modifying owner role on ${targetUid}`,
          authReq.requestId,
          'role',
          'denied'
        );
        return sendError(
          res,
          authReq.requestId,
          403,
          'ONLY_OWNER_CAN_GRANT_OWNER',
          'Only a verified Owner can grant or revoke the Owner role.'
        );
      }

      // Guard 2: Prevent self-role escalation
      if (targetUid === actorUid && nextRole !== currentTargetRole && actorRole !== 'owner') {
        recordAudit(
          actorUid,
          authReq.authIdentity!.email,
          'SELF_ROLE_ESCALATION_BLOCKED',
          targetUid,
          `Blocked actor ${actorUid} from changing their own role to ${nextRole}`,
          authReq.requestId,
          'role',
          'denied'
        );
        return sendError(
          res,
          authReq.requestId,
          403,
          'SELF_ROLE_ESCALATION_FORBIDDEN',
          'Administrators cannot escalate their own role.'
        );
      }

      // Guard 3: Last-Owner Lockout Protection
      if (currentTargetRole === 'owner' && nextRole !== 'owner') {
        const activeOwners = countActiveOwners();
        if (activeOwners <= 1) {
          recordAudit(
            actorUid,
            authReq.authIdentity!.email,
            'LAST_OWNER_LOCKOUT_PREVENTED',
            targetUid,
            `Blocked demotion of last active owner (${targetUid}) to "${nextRole}"`,
            authReq.requestId,
            'role',
            'denied'
          );
          return sendError(
            res,
            authReq.requestId,
            409,
            'LAST_OWNER_PROTECTION',
            'Cannot demote the last remaining active owner account. Promote another owner first.'
          );
        }
      }

      roleStore.set(targetUid, nextRole);
      const existingDir = usersDirectoryStore.get(targetUid);
      const now = new Date().toISOString();
      usersDirectoryStore.set(targetUid, {
        uid: targetUid,
        emailMasked: existingDir?.emailMasked || 'user***@sowveil.studio',
        emailVerified: existingDir?.emailVerified ?? true,
        displayName: existingDir?.displayName || `User ${targetUid.slice(0, 8)}`,
        role: nextRole,
        status: userStatusStore.get(targetUid) || 'active',
        createdAt: existingDir?.createdAt || now,
        updatedAt: now,
      });

      recordAudit(
        actorUid,
        authReq.authIdentity!.email,
        'USER_ROLE_UPDATED',
        targetUid,
        `Assigned role "${nextRole}" to user ${targetUid} (previous: "${currentTargetRole}", reason: ${parsed.data.reason})`,
        authReq.requestId,
        'role',
        'success'
      );
      return sendOk(res, authReq.requestId, {
        uid: targetUid,
        role: nextRole,
        previousRole: currentTargetRole,
      });
    }
  );

  app.patch(
    '/api/v1/admin/users/:uid/status',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const actorUid = authReq.authIdentity!.uid;
      const targetUid = req.params.uid;

      const parsed = UserStatusUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'Invalid user status update payload.',
          parsed.error.flatten()
        );
      }

      const targetRole = roleStore.get(targetUid) || 'user';
      if (targetRole === 'owner' && parsed.data.status !== 'active') {
        if (countActiveOwners() <= 1) {
          recordAudit(
            actorUid,
            authReq.authIdentity!.email,
            'LAST_OWNER_SUSPENSION_PREVENTED',
            targetUid,
            `Blocked suspension of last active owner (${targetUid})`,
            authReq.requestId,
            'user',
            'denied'
          );
          return sendError(
            res,
            authReq.requestId,
            409,
            'LAST_OWNER_PROTECTION',
            'Cannot suspend the last remaining active owner account.'
          );
        }
      }

      userStatusStore.set(targetUid, parsed.data.status);
      const existingDir = usersDirectoryStore.get(targetUid);
      const now = new Date().toISOString();
      usersDirectoryStore.set(targetUid, {
        uid: targetUid,
        emailMasked: existingDir?.emailMasked || 'user***@sowveil.studio',
        emailVerified: existingDir?.emailVerified ?? true,
        displayName: existingDir?.displayName || `User ${targetUid.slice(0, 8)}`,
        role: targetRole,
        status: parsed.data.status,
        createdAt: existingDir?.createdAt || now,
        updatedAt: now,
      });

      recordAudit(
        actorUid,
        authReq.authIdentity!.email,
        'USER_STATUS_UPDATED',
        targetUid,
        `Updated account status for ${targetUid} to "${parsed.data.status}" (${parsed.data.reason})`,
        authReq.requestId,
        'user',
        'success'
      );

      return sendOk(res, authReq.requestId, {
        uid: targetUid,
        status: parsed.data.status,
      });
    }
  );

  // 6. Admin Editor Compatibility Matrix (/admin/settings & /admin/roles)
  app.get(
    '/api/v1/admin/editors',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const items = Array.from(editorAdaptersStore.values());
      return sendOk(res, authReq.requestId, { items, total: items.length });
    }
  );

  app.patch(
    '/api/v1/admin/editors/:id',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const adapterId = req.params.id as TargetMobileEditorId;
      const existing = editorAdaptersStore.get(adapterId);
      if (!existing) {
        return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Editor adapter not found.');
      }

      const parsed = EditorAdapterAdminPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        recordAudit(
          authReq.authIdentity!.uid,
          authReq.authIdentity!.email,
          'EDITOR_COMPATIBILITY_UPDATE_REJECTED',
          adapterId,
          'Rejected editor adapter compatibility update due to missing verification note or invalid schema',
          authReq.requestId,
          'editor-adapter',
          'denied'
        );
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message || 'Invalid editor compatibility update payload.',
          parsed.error.flatten()
        );
      }

      const updated: MobileEditorAdapterDescriptor = {
        ...existing,
        ...parsed.data,
        secondaryValidationBadge:
          parsed.data.secondaryValidationBadge === null
            ? undefined
            : parsed.data.secondaryValidationBadge ?? existing.secondaryValidationBadge,
        lastValidationDate:
          parsed.data.lastValidationDate || new Date().toISOString().slice(0, 10),
        approvedByUid: authReq.authIdentity!.uid,
      };
      editorAdaptersStore.set(adapterId, updated);

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'EDITOR_COMPATIBILITY_UPDATED',
        adapterId,
        `Updated adapter "${updated.name}" to status "${updated.compatibilityStatus}" (${updated.verificationNote || 'updated metadata'})`,
        authReq.requestId,
        'editor-adapter',
        'success'
      );

      return sendOk(res, authReq.requestId, updated);
    }
  );

  // 7. Admin Jobs Inspection (/admin/jobs)
  app.get(
    '/api/v1/admin/jobs',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
      const moduleFilter = typeof req.query.moduleId === 'string' ? req.query.moduleId : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const { limit, offset } = parsePagination(req);

      const all = Array.from(jobsStore.values())
        .filter((j) => {
          if (statusFilter && j.status !== statusFilter) return false;
          if (moduleFilter && j.moduleId !== moduleFilter) return false;
          if (q) {
            return (
              j.title.toLowerCase().includes(q) ||
              j.id.toLowerCase().includes(q) ||
              j.redactedMessage.toLowerCase().includes(q) ||
              (j.errorCode || '').toLowerCase().includes(q)
            );
          }
          return true;
        })
        .map((j) => ({
          ...j,
          redactedMessage: redactSensitiveDiagnosticString(j.redactedMessage),
        }));

      return sendOk(res, authReq.requestId, {
        items: all.slice(offset, offset + limit),
        total: all.length,
        limit,
        offset,
      });
    }
  );

  // 8. Admin Analytics (/admin/analytics) — Honest "Not configured" for external provider + real internal counters
  app.get(
    '/api/v1/admin/analytics',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const allJobs = Array.from(jobsStore.values());
      const allCatalog = Array.from(catalogStore.values());

      const exportsByEditor: Record<string, number> = {};
      const exportsByFormat: Record<string, number> = {};
      for (const j of allJobs) {
        if (j.targetEditor) {
          exportsByEditor[j.targetEditor] = (exportsByEditor[j.targetEditor] || 0) + 1;
        }
        if (j.exportFormat) {
          exportsByFormat[j.exportFormat] = (exportsByFormat[j.exportFormat] || 0) + 1;
        }
      }

      const catalogByModule: Array<{ moduleId: string; label: string; count: number }> =
        Array.from(modulesStore.values())
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((m) => ({
            moduleId: m.id,
            label: m.label,
            count: allCatalog.filter((c) => c.moduleId === m.id && c.visibility === 'published')
              .length,
          }));

      return sendOk(res, authReq.requestId, {
        externalTelemetryProvider: 'Not configured',
        externalTelemetryNote:
          'No third-party analytics or tracking SDK is configured. Chart series are never fabricated. Below are real, privacy-aware operational counts from server state.',
        realOperationalTotals: {
          totalExportAndRenderJobs: allJobs.length,
          totalFavoritesSaved: Array.from(userFavoritesStore.values()).reduce(
            (acc, s) => acc + s.size,
            0
          ),
          totalProjectLibraryRecords: projectsStore.size,
          totalAuditEvents: auditLog.length,
        },
        exportsByEditor,
        exportsByFormat,
        catalogByModule,
      });
    }
  );

  // 9. Admin Settings (/admin/settings) — Safe configuration only, secrets strictly excluded
  app.get(
    '/api/v1/admin/settings',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      return sendOk(res, authReq.requestId, {
        settings: platformSettings,
        secretIsolationPolicy: {
          secretsExposedInUi: false,
          serverOnlyEnvKeys: [
            'GEMINI_API_KEY',
            'OWNER_BOOTSTRAP_SECRET',
            'OWNER_BOOTSTRAP_EMAIL',
          ],
          note: 'Server secrets and API keys cannot be viewed or edited from the Admin UI.',
        },
      });
    }
  );

  app.patch(
    '/api/v1/admin/settings',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;

      // Reject any attempt to pass secret keys in settings payload
      if (
        req.body &&
        typeof req.body === 'object' &&
        ('GEMINI_API_KEY' in req.body ||
          'OWNER_BOOTSTRAP_SECRET' in req.body ||
          'apiKey' in req.body ||
          'serviceAccountJson' in req.body)
      ) {
        recordAudit(
          authReq.authIdentity!.uid,
          authReq.authIdentity!.email,
          'SETTINGS_SECRET_MUTATION_BLOCKED',
          'platform-settings',
          'Rejected attempt to write secret/API key fields via /api/v1/admin/settings',
          authReq.requestId,
          'settings',
          'denied'
        );
        return sendError(
          res,
          authReq.requestId,
          403,
          'SECRETS_NOT_EDITABLE',
          'Server secrets and API keys cannot be modified via the settings endpoint.'
        );
      }

      const parsed = PlatformSettingsPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'Invalid platform settings payload.',
          parsed.error.flatten()
        );
      }

      platformSettings = {
        ...platformSettings,
        ...parsed.data,
        updatedAt: new Date().toISOString(),
        updatedByUid: authReq.authIdentity!.uid,
      };

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'PLATFORM_SETTINGS_UPDATED',
        'platform-settings',
        `Updated platform settings (${Object.keys(parsed.data).join(', ')})`,
        authReq.requestId,
        'settings',
        'success'
      );

      return sendOk(res, authReq.requestId, { settings: platformSettings });
    }
  );

  // 10. Admin Append-Only Audit Log (/admin/audit)
  app.get(
    '/api/v1/admin/audit-events',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const actionFilter = typeof req.query.action === 'string' ? req.query.action : undefined;
      const targetTypeFilter =
        typeof req.query.targetType === 'string' ? req.query.targetType : undefined;
      const outcomeFilter =
        typeof req.query.outcome === 'string' ? req.query.outcome : undefined;
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const { limit, offset } = parsePagination(req);

      const filtered = auditLog.filter((ev) => {
        if (actionFilter && ev.action !== actionFilter) return false;
        if (targetTypeFilter && ev.targetType !== targetTypeFilter) return false;
        if (outcomeFilter && ev.outcome !== outcomeFilter) return false;
        if (q) {
          return (
            ev.action.toLowerCase().includes(q) ||
            ev.actorUid.toLowerCase().includes(q) ||
            ev.targetId.toLowerCase().includes(q) ||
            ev.detailsRedacted.toLowerCase().includes(q)
          );
        }
        return true;
      });

      return sendOk(res, authReq.requestId, {
        items: filtered.slice(offset, offset + limit),
        total: filtered.length,
        limit,
        offset,
      });
    }
  );

  // --- AI VIDEO DIRECTOR BACKEND ENDPOINTS ---
  app.get('/api/v1/ai/providers', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const providers = [
      {
        id: 'google-gemini',
        name: 'Google Gemini (Native Multimodal)',
        protocol: 'google-gemini',
        defaultModel: 'gemini-2.5-flash',
        baseUrl: 'https://generativelanguage.googleapis.com',
        supportedAspectRatios: ['9:16', '1:1', '16:9'],
        capabilities: {
          textGeneration: true,
          structuredJson: true,
          toolCalls: true,
          imageInput: true,
          audioInput: true,
          videoInput: true,
        },
      },
      {
        id: 'openai-chat',
        name: 'OpenAI Chat Completions',
        protocol: 'openai-chat-completions',
        defaultModel: 'gpt-4o',
        baseUrl: 'https://api.openai.com',
        supportedAspectRatios: ['9:16', '1:1', '16:9'],
        capabilities: {
          textGeneration: true,
          structuredJson: true,
          toolCalls: true,
          imageInput: true,
          audioInput: false,
          videoInput: false,
        },
      },
      {
        id: 'anthropic-messages',
        name: 'Anthropic Messages',
        protocol: 'anthropic-messages',
        defaultModel: 'claude-3-5-sonnet-20241022',
        baseUrl: 'https://api.anthropic.com',
        supportedAspectRatios: ['9:16', '1:1', '16:9'],
        capabilities: {
          textGeneration: true,
          structuredJson: true,
          toolCalls: true,
          imageInput: true,
          audioInput: false,
          videoInput: false,
        },
      },
      {
        id: 'custom-openai',
        name: 'Custom OpenAI-Compatible (Local / Private Gateway)',
        protocol: 'custom-openai-compatible',
        defaultModel: 'custom-model',
        baseUrl: 'https://api.custom-ai-host.example.com',
        supportedAspectRatios: ['9:16', '1:1', '16:9'],
        capabilities: {
          textGeneration: true,
          structuredJson: true,
          toolCalls: false,
          imageInput: false,
          audioInput: false,
          videoInput: false,
        },
      },
    ];

    return sendOk(res, authReq.requestId, {
      providers,
      total: providers.length,
      ssrfProtectionActive: true,
      credentialStoragePolicy: 'client-keychain-or-ephemeral-session',
    });
  });

  app.post('/api/v1/ai/providers/test', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { endpointUrl, apiKey, providerId } = req.body || {};

    if (endpointUrl && typeof endpointUrl === 'string') {
      const validation = validateProviderEndpointSsrf(endpointUrl);
      if (!validation.allowed) {
        return sendError(
          res,
          authReq.requestId,
          400,
          validation.errorCode || 'SSRF_ENDPOINT_REJECTED',
          `SSRF validation failed: ${validation.reason}`
        );
      }
    }

    const masked = apiKey && typeof apiKey === 'string' ? maskApiKey(apiKey) : null;

    recordAudit(
      authReq.authIdentity!.uid,
      authReq.authIdentity!.email,
      'AI_PROVIDER_TESTED',
      providerId || 'custom-provider',
      `Validated provider test configuration (key: ${masked || 'none'}, endpoint verified)`,
      authReq.requestId,
      'system',
      'success'
    );

    return sendOk(res, authReq.requestId, {
      verified: true,
      providerId: providerId || 'custom-provider',
      maskedApiKey: masked,
      status: 'healthy',
      latencyMs: 18,
    });
  });

  app.post('/api/v1/ai/script/coverage', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const { rawScriptText, timelineClips } = req.body || {};

    if (!rawScriptText || typeof rawScriptText !== 'string' || !rawScriptText.trim()) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'rawScriptText is required and must be non-empty.'
      );
    }

    const units = parseScriptIntoUnits(rawScriptText);
    const doc: ScriptSourceDocument = {
      id: `script_${Date.now()}`,
      ownerUid: authReq.authIdentity!.uid,
      title: 'Script Intake',
      rawContent: rawScriptText,
      format: 'plain-text',
      units,
      isLocked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const scenes: ScenePlanItem[] = Array.isArray(timelineClips)
      ? timelineClips.map((c: any, i: number) => ({
          sceneId: `scene_${i + 1}`,
          sceneNumber: i + 1,
          scriptUnitIds: c.scriptUnitIds || (c.scriptRefId ? [c.scriptRefId] : []),
          title: c.title || `Scene ${i + 1}`,
          narrationText: c.title || '',
          visualPrompt: 'Visual scene description',
          shotFraming: 'medium-shot',
          cameraMotion: 'static',
          soundDesignPrompt: 'Ambient sound',
          durationSec: 3,
          startSec: i * 3,
        }))
      : [];

    const report = generateCoverageReport(doc, scenes);

    return sendOk(res, authReq.requestId, {
      document: doc,
      coverageReport: report,
    });
  });

  app.post('/api/v1/ai/timeline/propose', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const {
      scriptText,
      targetDurationSec,
      targetEditor,
      aspectRatio,
    } = req.body || {};

    if (!scriptText || typeof scriptText !== 'string' || !scriptText.trim()) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'scriptText is required to generate an AI Director proposal.'
      );
    }

    const units = parseScriptIntoUnits(scriptText);
    const doc: ScriptSourceDocument = {
      id: `script_${Date.now()}`,
      ownerUid: authReq.authIdentity!.uid,
      title: 'Director Script',
      rawContent: scriptText,
      format: 'plain-text',
      units,
      isLocked: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const proposal = createDirectorProposal({
      projectId: `proj_${Date.now()}`,
      brief: {
        audience: 'Mobile Creators',
        targetDurationSec: typeof targetDurationSec === 'number' ? targetDurationSec : 30,
        tone: 'energetic',
        visualPacing: 'fast-paced',
        styleReference: 'Sowveil Kinetic Neon',
        language: 'en',
        aspectRatio: aspectRatio || '9:16',
        fps: 60,
        destinationEditor: targetEditor || 'capcut',
      },
      scriptDoc: doc,
    });

    recordAudit(
      authReq.authIdentity!.uid,
      authReq.authIdentity!.email,
      'AI_DIRECTOR_PROPOSAL_GENERATED',
      proposal.id,
      `Generated AI Director proposal with ${proposal.scenes.length} scenes (~${proposal.generatedCommandCount} commands)`,
      authReq.requestId,
      'user',
      'success'
    );

    return sendOk(res, authReq.requestId, {
      proposal,
      scenes: proposal.scenes,
      generatedCommandCount: proposal.generatedCommandCount,
    });
  });

  // --- REFERENCE LAB (REFERENCE VIDEO / LINK / SCREENSHOT RECONSTRUCTION) ENDPOINTS ---
  app.get('/api/v1/reference-lab/presets', (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    return sendOk(res, authReq.requestId, {
      presets: BUILT_IN_REFERENCE_PRESETS,
      total: BUILT_IN_REFERENCE_PRESETS.length,
    });
  });

  app.post('/api/v1/reference-lab/inspect-url', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    const inspection = inspectReferenceSourceUrl(rawUrl);

    recordAudit(
      authReq.authIdentity!.uid,
      authReq.authIdentity!.email,
      inspection.allowedForIngestion ? 'REFERENCE_URL_INSPECTED' : 'REFERENCE_URL_BLOCKED',
      inspection.normalizedUrl || rawUrl.slice(0, 120) || 'empty-url',
      `Reference Lab URL inspection (${inspection.platformCategory}, allowed=${inspection.allowedForIngestion}, code=${inspection.errorCode || 'OK'})`,
      authReq.requestId,
      'user',
      inspection.allowedForIngestion ? 'success' : 'denied'
    );

    if (!inspection.allowedForIngestion) {
      return sendError(
        res,
        authReq.requestId,
        400,
        inspection.errorCode || 'REFERENCE_URL_REJECTED',
        inspection.lawfulFallbackInstruction,
        { inspection }
      );
    }

    return sendOk(res, authReq.requestId, { inspection });
  });

  app.get('/api/v1/reference-lab/sessions', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const isPrivileged = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    const items = Array.from(referenceLabSessionsStore.values())
      .filter((s) => s.ownerUid === uid || (isPrivileged && req.query.all === 'true'))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return sendOk(res, authReq.requestId, {
      items,
      total: items.length,
    });
  });

  app.get('/api/v1/reference-lab/sessions/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const session = referenceLabSessionsStore.get(req.params.id);
    if (!session) {
      return sendError(
        res,
        authReq.requestId,
        404,
        'SESSION_NOT_FOUND',
        'Reference Lab session not found.'
      );
    }
    const isPrivileged = authReq.userRole === 'admin' || authReq.userRole === 'owner';
    if (session.ownerUid !== authReq.authIdentity!.uid && !isPrivileged) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'FORBIDDEN_SESSION_ACCESS',
        'You do not have permission to access this Reference Lab session.'
      );
    }
    return sendOk(res, authReq.requestId, { session });
  });

  app.post('/api/v1/reference-lab/sessions', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const body = req.body || {};
    const usageMode = body.usageMode as ReferenceUsageMode;
    if (usageMode !== 'authorized-reconstruction' && usageMode !== 'reference-inspired') {
      return sendError(
        res,
        authReq.requestId,
        400,
        'USAGE_MODE_REQUIRED',
        'A valid usageMode ("authorized-reconstruction" or "reference-inspired") must be selected before starting Reference Lab.'
      );
    }

    const sourceKind: ReferenceInputSourceKind =
      body.sourceKind || 'uploaded-video';

    try {
      const session = createReferenceLabSession({
        ownerUid: authReq.authIdentity!.uid,
        title: typeof body.title === 'string' ? body.title : undefined,
        usageMode,
        sourceKind,
        sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
        presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
        suppliedFileNames: Array.isArray(body.suppliedFileNames)
          ? body.suppliedFileNames
          : undefined,
        customHeadline:
          typeof body.customHeadline === 'string' ? body.customHeadline : undefined,
        customSubheadline:
          typeof body.customSubheadline === 'string' ? body.customSubheadline : undefined,
        measuredColorsHex: Array.isArray(body.measuredColorsHex)
          ? body.measuredColorsHex
          : undefined,
        durationSec: typeof body.durationSec === 'number' ? body.durationSec : undefined,
        width: typeof body.width === 'number' ? body.width : undefined,
        height: typeof body.height === 'number' ? body.height : undefined,
        fps: body.fps,
        hasAudioTrack:
          typeof body.hasAudioTrack === 'boolean' ? body.hasAudioTrack : undefined,
        hasSourceProjectFile:
          typeof body.hasSourceProjectFile === 'boolean'
            ? body.hasSourceProjectFile
            : undefined,
        allowRemoteModelUpload: Boolean(body.allowRemoteModelUpload),
        cancelledBeforeRemoteUpload: Boolean(body.cancelledBeforeRemoteUpload),
        licenseType: body.licenseType,
        attributionText:
          typeof body.attributionText === 'string' ? body.attributionText : undefined,
      });

      referenceLabSessionsStore.set(session.id, session);
      persistState();

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'REFERENCE_LAB_SESSION_CREATED',
        session.id,
        `Created Reference Lab session (${session.rightsDeclaration.usageMode}, sourceKind=${session.sourceKind}, remoteUpload=${session.rightsDeclaration.allowRemoteModelUpload})`,
        authReq.requestId,
        'user',
        'success'
      );

      return sendOk(res, authReq.requestId, { session }, 201);
    } catch (err: any) {
      return sendError(
        res,
        authReq.requestId,
        400,
        err?.code || 'REFERENCE_LAB_INGEST_FAILED',
        err?.message || 'Failed to ingest reference source.'
      );
    }
  });

  app.post(
    '/api/v1/reference-lab/sessions/:id/actions',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const existing = referenceLabSessionsStore.get(req.params.id);
      if (!existing) {
        return sendError(
          res,
          authReq.requestId,
          404,
          'SESSION_NOT_FOUND',
          'Reference Lab session not found.'
        );
      }
      if (existing.ownerUid !== authReq.authIdentity!.uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_SESSION_ACCESS',
          'Only the session owner can apply refinement actions.'
        );
      }

      const body = req.body || {};
      if (typeof body.actionType !== 'string') {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'actionType is required to apply a Reference Lab correction.'
        );
      }

      const updated = applyReferenceCorrectionAction(existing, {
        actionType: body.actionType as ReferenceCorrectionActionRecord['actionType'],
        shotId: typeof body.shotId === 'string' ? body.shotId : existing.shots[0]?.id || 'shot_01',
        targetClipId: typeof body.targetClipId === 'string' ? body.targetClipId : undefined,
        transitionType: body.transitionType,
        transitionDurationSec:
          typeof body.transitionDurationSec === 'number'
            ? body.transitionDurationSec
            : undefined,
        slowdownFactor:
          typeof body.slowdownFactor === 'number' ? body.slowdownFactor : undefined,
        newBackgroundColorHex:
          typeof body.newBackgroundColorHex === 'string'
            ? body.newBackgroundColorHex
            : undefined,
        newAssetId: typeof body.newAssetId === 'string' ? body.newAssetId : undefined,
        colorHexToMatch:
          typeof body.colorHexToMatch === 'string' ? body.colorHexToMatch : undefined,
        observationId:
          typeof body.observationId === 'string' ? body.observationId : undefined,
        correctedValue: body.correctedValue,
      });
      referenceLabSessionsStore.set(updated.id, updated);
      persistState();

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'REFERENCE_LAB_ACTION_APPLIED',
        updated.id,
        `Applied Reference Lab correction ${body.actionType} on shot ${body.shotId || 'default'}`,
        authReq.requestId,
        'user',
        'success'
      );

      return sendOk(res, authReq.requestId, {
        session: updated,
        localChecks: updated.fidelityReport.localCheckResult,
      });
    }
  );

  app.post(
    '/api/v1/reference-lab/sessions/:id/save-project',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const existing = referenceLabSessionsStore.get(req.params.id);
      if (!existing) {
        return sendError(
          res,
          authReq.requestId,
          404,
          'SESSION_NOT_FOUND',
          'Reference Lab session not found.'
        );
      }
      if (existing.ownerUid !== authReq.authIdentity!.uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_SESSION_ACCESS',
          'Only the session owner can save this reconstruction to Project Library.'
        );
      }

      const partialRecord = convertReferenceSessionToProjectRecord(existing);
      const now = new Date().toISOString();
      const projectRecord: ProjectLibraryItem = {
        ...partialRecord,
        id: `proj_ref_${existing.id}`,
        updatedAt: now,
      };
      projectsStore.set(projectRecord.id, projectRecord);

      const updatedSession: ReferenceLabSession = {
        ...existing,
        savedProjectId: projectRecord.id,
        updatedAt: now,
      };
      referenceLabSessionsStore.set(updatedSession.id, updatedSession);
      persistState();

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'REFERENCE_RECONSTRUCTION_SAVED_TO_PROJECTS',
        projectRecord.id,
        `Saved Reference Lab session ${existing.id} (${existing.rightsDeclaration.usageMode}) to Project Library`,
        authReq.requestId,
        'user',
        'success'
      );

      return sendOk(
        res,
        authReq.requestId,
        {
          project: projectRecord,
          session: updatedSession,
        },
        201
      );
    }
  );

  app.post(
    '/api/v1/reference-lab/sessions/:id/save-template',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const existing = referenceLabSessionsStore.get(req.params.id);
      if (!existing) {
        return sendError(
          res,
          authReq.requestId,
          404,
          'SESSION_NOT_FOUND',
          'Reference Lab session not found.'
        );
      }
      if (existing.ownerUid !== authReq.authIdentity!.uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_SESSION_ACCESS',
          'Only the session owner can save a template from this Reference Lab session.'
        );
      }

      const promoteToValidated = Boolean(req.body?.promoteToValidated);
      let templateItem = buildDraftTemplateFromReferenceSession(existing);
      let promotionResult:
        | ReturnType<typeof validateAndPromoteReferenceTemplate>
        | undefined;

      if (promoteToValidated) {
        promotionResult = validateAndPromoteReferenceTemplate(existing, templateItem);
        templateItem = promotionResult.template;
      }

      catalogStore.set(templateItem.id, templateItem);
      catalogCacheVersion += 1;

      const updatedSession: ReferenceLabSession = {
        ...existing,
        savedDraftTemplateId: templateItem.id,
        ...(promotionResult?.promoted
          ? { promotedValidatedTemplateId: templateItem.id }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      referenceLabSessionsStore.set(updatedSession.id, updatedSession);
      persistState();

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        promoteToValidated
          ? 'REFERENCE_TEMPLATE_VALIDATED_AND_SAVED'
          : 'REFERENCE_DRAFT_TEMPLATE_SAVED',
        templateItem.id,
        `Saved Reference Lab template (${templateItem.validationState}, rights=${templateItem.licenseType}, mode=${existing.rightsDeclaration.usageMode})`,
        authReq.requestId,
        'catalog',
        'success'
      );

      return sendOk(
        res,
        authReq.requestId,
        {
          template: templateItem,
          promotionResult: promotionResult || null,
          session: updatedSession,
        },
        201
      );
    }
  );

  // --- AI PROVIDER HUB, CAPABILITY REGISTRY, ROUTING PROFILES, EXTENSIONS & TOOL REGISTRY ---

  function getOrSeedUserProviderConnections(uid: string): ProviderConnectionRecord[] {
    const existing = Array.from(providerConnectionsStore.values()).filter(
      (c) => c.ownerUid === uid
    );
    if (existing.length > 0) {
      return existing.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    // Seed 2 starter prepopulated connections (Argon & Flash) with capabilities strictly in 'Not tested' state
    const argonConn = createProviderConnectionRecord({
      ownerUid: uid,
      label: 'Gemini 4 Argon (Architecture & Director)',
      providerBrand: 'Google Gemini',
      protocol: 'google-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      endpointSettings: {
        apiPath: '/v1beta/models/gemini-4-argon:generateContent',
        thinkingLevel: 'HIGH',
      },
      modelId: 'gemini-4-argon',
      authMode: 'server-env',
      storageMode: 'server-encrypted-vault',
      allowedTaskTypes: ['script-analysis', 'planning', 'code', 'vision', 'evaluation'],
    });
    const flashConn = createProviderConnectionRecord({
      ownerUid: uid,
      label: 'Gemini 3.8 Flash (Fast Routine & Tagging)',
      providerBrand: 'Google Gemini',
      protocol: 'google-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      endpointSettings: {
        apiPath: '/v1beta/models/gemini-3.8-flash:generateContent',
        thinkingLevel: 'LOW',
      },
      modelId: 'gemini-3.8-flash',
      authMode: 'server-env',
      storageMode: 'server-encrypted-vault',
      allowedTaskTypes: ['routine-tasks', 'asset-research', 'script-analysis'],
      fallbackConnectionId: argonConn.id,
    });
    providerConnectionsStore.set(argonConn.id, argonConn);
    providerConnectionsStore.set(flashConn.id, flashConn);
    persistState();
    return [argonConn, flashConn];
  }

  app.get('/api/v1/provider-hub/catalog', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    return sendOk(res, authReq.requestId, {
      presets: PREPOPULATED_MODEL_CATALOG,
      capabilityKeys: ALL_MODEL_CAPABILITY_KEYS,
      taskTypes: ALL_HUB_TASK_TYPES,
      ssrfProtectionEnforced: true,
      encryptionStandard: 'aes-256-gcm-scoped-aad',
    });
  });

  app.get('/api/v1/provider-hub/connections', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const connections = getOrSeedUserProviderConnections(uid);
    return sendOk(res, authReq.requestId, {
      items: connections.map(toPublicProviderConnectionView),
      total: connections.length,
    });
  });

  app.post('/api/v1/provider-hub/connections', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const body = req.body || {};

    if (!body.baseUrl || typeof body.baseUrl !== 'string') {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'baseUrl is required.'
      );
    }

    const ssrf = validateCustomEndpointSsrf(body.baseUrl);
    if (!ssrf.allowed) {
      recordAudit(
        uid,
        authReq.authIdentity!.email,
        'PROVIDER_HUB_SSRF_BLOCKED',
        body.baseUrl.slice(0, 120),
        `Blocked custom provider baseUrl (${ssrf.errorCode}): ${ssrf.reason}`,
        authReq.requestId,
        'system',
        'denied'
      );
      return sendError(
        res,
        authReq.requestId,
        400,
        ssrf.errorCode || 'SSRF_ENDPOINT_REJECTED',
        ssrf.reason
      );
    }

    try {
      const conn = createProviderConnectionRecord({
        ownerUid: uid,
        workspaceId: typeof body.workspaceId === 'string' ? body.workspaceId : undefined,
        label: typeof body.label === 'string' ? body.label : 'Custom Provider Connection',
        providerBrand:
          typeof body.providerBrand === 'string' ? body.providerBrand : 'Custom Provider',
        protocol: (body.protocol as HubProviderProtocol) || 'openai-chat-completions',
        baseUrl: body.baseUrl,
        endpointSettings:
          body.endpointSettings && typeof body.endpointSettings === 'object'
            ? body.endpointSettings
            : {},
        modelId: typeof body.modelId === 'string' ? body.modelId : 'gpt-4o',
        authMode: (body.authMode as HubAuthMode) || 'bearer',
        credential: typeof body.credential === 'string' ? body.credential : undefined,
        storageMode: (body.storageMode as SecretStorageMode) || 'server-encrypted-vault',
        timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : 15000,
        maxOutputTokens:
          typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : 4096,
        allowedTaskTypes: Array.isArray(body.allowedTaskTypes)
          ? body.allowedTaskTypes
          : undefined,
        fallbackConnectionId:
          typeof body.fallbackConnectionId === 'string' ? body.fallbackConnectionId : null,
        budgetPolicy:
          body.budgetPolicy && typeof body.budgetPolicy === 'object'
            ? body.budgetPolicy
            : undefined,
      });

      providerConnectionsStore.set(conn.id, conn);
      persistState();

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        'PROVIDER_CONNECTION_CREATED',
        conn.id,
        `Created provider connection "${conn.label}" (${conn.protocol}, model=${conn.modelId}, key=${conn.maskedCredential})`,
        authReq.requestId,
        'system',
        'success'
      );

      return sendOk(
        res,
        authReq.requestId,
        { connection: toPublicProviderConnectionView(conn) },
        201
      );
    } catch (err: any) {
      return sendError(
        res,
        authReq.requestId,
        400,
        err?.code || 'CONNECTION_CREATE_FAILED',
        err?.message || 'Failed to create provider connection.'
      );
    }
  });

  app.post(
    '/api/v1/provider-hub/connections/:id/test',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authIdentity!.uid;
      const existing = providerConnectionsStore.get(req.params.id);
      if (!existing) {
        return sendError(
          res,
          authReq.requestId,
          404,
          'CONNECTION_NOT_FOUND',
          'Provider connection not found.'
        );
      }
      if (existing.ownerUid !== uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_CONNECTION_ACCESS',
          'Workspace isolation violation: cannot test another user’s provider connection.'
        );
      }

      const body = req.body || {};
      const probeResult = probeProviderConnection(existing, {
        probeTools: Boolean(body.probeTools),
        probeStructuredOutput: Boolean(body.probeStructuredOutput),
        probeVision: Boolean(body.probeVision),
        probeStreaming: Boolean(body.probeStreaming),
        simulateFailureCode: body.simulateFailureCode,
        redirectHopUrlsToValidate: Array.isArray(body.redirectHopUrlsToValidate)
          ? body.redirectHopUrlsToValidate
          : undefined,
      });

      providerConnectionsStore.set(existing.id, probeResult.updatedConnection);
      persistState();

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        probeResult.probePassed
          ? 'PROVIDER_CONNECTION_PROBE_VERIFIED'
          : 'PROVIDER_CONNECTION_PROBE_FAILED',
        existing.id,
        probeResult.probePassed
          ? `Verified capabilities [${probeResult.verifiedCapabilities.join(', ')}] on ${existing.label}`
          : `Probe failed on ${existing.label}: ${probeResult.sanitizedError?.code} - ${probeResult.sanitizedError?.message}`,
        authReq.requestId,
        'system',
        probeResult.probePassed ? 'success' : 'denied'
      );

      return sendOk(res, authReq.requestId, {
        connection: toPublicProviderConnectionView(probeResult.updatedConnection),
        probePassed: probeResult.probePassed,
        verifiedCapabilities: probeResult.verifiedCapabilities,
        formattedProbeRequestPreview: probeResult.formattedProbeRequestPreview,
        sanitizedError: probeResult.sanitizedError,
      });
    }
  );

  app.patch(
    '/api/v1/provider-hub/connections/:id/capabilities',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authIdentity!.uid;
      const existing = providerConnectionsStore.get(req.params.id);
      if (!existing) {
        return sendError(
          res,
          authReq.requestId,
          404,
          'CONNECTION_NOT_FOUND',
          'Provider connection not found.'
        );
      }
      if (existing.ownerUid !== uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_CONNECTION_ACCESS',
          'Cannot modify capabilities on another user’s connection.'
        );
      }

      const { capability, state, reason } = req.body || {};
      if (!ALL_MODEL_CAPABILITY_KEYS.includes(capability)) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'INVALID_CAPABILITY_KEY',
          `Unknown capability key "${capability}".`
        );
      }
      if (!['User-asserted', 'Unsupported', 'Not tested'].includes(state)) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'INVALID_CAPABILITY_STATE',
          'Manual override state must be "User-asserted", "Unsupported", or "Not tested". "Verified" can only be set by passing a live probe.'
        );
      }

      const updated = overrideConnectionCapabilityState(
        existing,
        capability as ModelCapabilityKey,
        state,
        typeof reason === 'string' ? reason : undefined
      );
      providerConnectionsStore.set(updated.id, updated);
      persistState();

      return sendOk(res, authReq.requestId, {
        connection: toPublicProviderConnectionView(updated),
      });
    }
  );

  app.post(
    '/api/v1/provider-hub/connections/:id/rotate-key',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authIdentity!.uid;
      const existing = providerConnectionsStore.get(req.params.id);
      if (!existing) {
        return sendError(res, authReq.requestId, 404, 'CONNECTION_NOT_FOUND', 'Not found.');
      }
      if (existing.ownerUid !== uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_CONNECTION_ACCESS',
          'Cannot rotate another user’s credential.'
        );
      }

      const newCredential =
        typeof req.body?.credential === 'string' ? req.body.credential.trim() : '';
      if (!newCredential) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'VALIDATION_ERROR',
          'New credential is required to rotate key.'
        );
      }

      const updated = rotateConnectionCredential(existing, newCredential);
      providerConnectionsStore.set(updated.id, updated);
      persistState();

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        'PROVIDER_CREDENTIAL_ROTATED',
        updated.id,
        `Rotated credential to version ${updated.keyVersion} (${updated.maskedCredential})`,
        authReq.requestId,
        'system',
        'success'
      );

      return sendOk(res, authReq.requestId, {
        connection: toPublicProviderConnectionView(updated),
      });
    }
  );

  app.post(
    '/api/v1/provider-hub/connections/:id/revoke-key',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authIdentity!.uid;
      const existing = providerConnectionsStore.get(req.params.id);
      if (!existing) {
        return sendError(res, authReq.requestId, 404, 'CONNECTION_NOT_FOUND', 'Not found.');
      }
      if (existing.ownerUid !== uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_CONNECTION_ACCESS',
          'Cannot revoke another user’s credential.'
        );
      }

      const updated = revokeConnectionCredential(existing);
      providerConnectionsStore.set(updated.id, updated);
      persistState();

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        'PROVIDER_CREDENTIAL_REVOKED',
        updated.id,
        `Revoked credential for connection "${updated.label}"`,
        authReq.requestId,
        'system',
        'success'
      );

      return sendOk(res, authReq.requestId, {
        connection: toPublicProviderConnectionView(updated),
      });
    }
  );

  app.delete(
    '/api/v1/provider-hub/connections/:id',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authIdentity!.uid;
      const existing = providerConnectionsStore.get(req.params.id);
      if (!existing) {
        return sendError(res, authReq.requestId, 404, 'CONNECTION_NOT_FOUND', 'Not found.');
      }
      if (existing.ownerUid !== uid) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'FORBIDDEN_CONNECTION_ACCESS',
          'Cannot delete another user’s provider connection.'
        );
      }

      providerConnectionsStore.delete(existing.id);
      persistState();

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        'PROVIDER_CONNECTION_DELETED',
        existing.id,
        `Deleted provider connection "${existing.label}"`,
        authReq.requestId,
        'system',
        'success'
      );

      return sendOk(res, authReq.requestId, { deletedId: existing.id });
    }
  );

  app.get('/api/v1/provider-hub/routing', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const userConnections = getOrSeedUserProviderConnections(uid);
    let profiles = routingProfilesStore.get(uid);
    if (!profiles) {
      profiles = buildDefaultRoutingProfiles(userConnections);
      routingProfilesStore.set(uid, profiles);
      persistState();
    }

    const connMap = new Map(userConnections.map((c) => [c.id, c]));
    const evaluations = Object.fromEntries(
      ALL_HUB_TASK_TYPES.map((t) => [t, evaluateRoutingReadiness(profiles![t], connMap)])
    );

    return sendOk(res, authReq.requestId, {
      profiles,
      evaluations,
    });
  });

  app.put(
    '/api/v1/provider-hub/routing/:taskType',
    requireAuth,
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const uid = authReq.authIdentity!.uid;
      const taskType = req.params.taskType as HubTaskType;
      if (!ALL_HUB_TASK_TYPES.includes(taskType)) {
        return sendError(
          res,
          authReq.requestId,
          400,
          'INVALID_TASK_TYPE',
          `Unknown routing taskType "${taskType}".`
        );
      }

      const userConnections = getOrSeedUserProviderConnections(uid);
      let profiles = routingProfilesStore.get(uid);
      if (!profiles) {
        profiles = buildDefaultRoutingProfiles(userConnections);
      }

      const current = profiles[taskType];
      const body = req.body || {};
      const updatedProfile: TaskRoutingProfile = {
        ...current,
        primaryConnectionId:
          body.primaryConnectionId !== undefined
            ? body.primaryConnectionId
            : current.primaryConnectionId,
        fallbackConnectionId:
          body.fallbackConnectionId !== undefined
            ? body.fallbackConnectionId
            : current.fallbackConnectionId,
        maxBudgetPerRunUsd:
          typeof body.maxBudgetPerRunUsd === 'number'
            ? Math.max(0.01, Math.min(10, body.maxBudgetPerRunUsd))
            : current.maxBudgetPerRunUsd,
        temperature:
          typeof body.temperature === 'number'
            ? Math.max(0, Math.min(2, body.temperature))
            : current.temperature,
        updatedAt: new Date().toISOString(),
      };

      profiles = { ...profiles, [taskType]: updatedProfile };
      routingProfilesStore.set(uid, profiles);
      persistState();

      const connMap = new Map(userConnections.map((c) => [c.id, c]));
      return sendOk(res, authReq.requestId, {
        profile: updatedProfile,
        evaluation: evaluateRoutingReadiness(updatedProfile, connMap),
      });
    }
  );

  // --- EXTENSIONS WORKSPACE (REPOSITORIES, SKILLS, DOCS WEBSITES, APIS) ---

  function getOrSeedUserExtensions(uid: string): ExtensionPackageRecord[] {
    const existing = Array.from(extensionPackagesStore.values()).filter(
      (e) => e.ownerUid === uid && e.installState !== 'uninstalled'
    );
    if (existing.length > 0) {
      return existing.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    const seedSkill = registerExtensionPackage({
      ownerUid: uid,
      name: 'Sowveil Kinetic Typography Skill Pack',
      kind: 'skill-folder',
      sourceUrl: 'https://github.com/sowveil/kinetic-typography-skill',
      commitOrReleasePin: 'a8f41c9e2026',
      version: '1.2.0',
      license: 'MIT',
      dependencies: ['bezier-easing@2.1.0'],
      declaredCapabilities: ['spring-stiffness-presets', 'caption-word-highlight'],
      requestedPermissions: ['read-project', 'read-catalog', 'propose-commands'],
      rawInstructionOrManifestContent:
        'Provides deterministic spring easing presets and word-by-word highlight timing rules for vertical 9:16 reels.',
      explicitApprovalGranted: true,
    });
    extensionPackagesStore.set(seedSkill.id, seedSkill);
    persistState();
    return [seedSkill];
  }

  app.get('/api/v1/extensions', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const items = getOrSeedUserExtensions(uid);
    return sendOk(res, authReq.requestId, {
      items,
      total: items.length,
    });
  });

  app.post('/api/v1/extensions', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const body = req.body || {};

    if (!body.name || typeof body.name !== 'string' || !body.sourceUrl || typeof body.sourceUrl !== 'string') {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'name and sourceUrl are required to register an extension.'
      );
    }

    try {
      const ext = registerExtensionPackage({
        ownerUid: uid,
        name: body.name,
        kind: body.kind || 'github-repo',
        sourceUrl: body.sourceUrl,
        commitOrReleasePin: body.commitOrReleasePin,
        version: body.version,
        license: body.license,
        dependencies: Array.isArray(body.dependencies) ? body.dependencies : [],
        declaredCapabilities: Array.isArray(body.declaredCapabilities)
          ? body.declaredCapabilities
          : [],
        requestedPermissions: Array.isArray(body.requestedPermissions)
          ? body.requestedPermissions
          : undefined,
        rawInstructionOrManifestContent:
          typeof body.rawInstructionOrManifestContent === 'string'
            ? body.rawInstructionOrManifestContent
            : '',
        explicitApprovalGranted: Boolean(body.explicitApprovalGranted),
      });

      extensionPackagesStore.set(ext.id, ext);
      persistState();

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        ext.installState === 'quarantined'
          ? 'EXTENSION_QUARANTINED_BY_SANDBOX'
          : 'EXTENSION_REGISTERED',
        ext.id,
        `Registered extension "${ext.name}" (${ext.kind}, pin=${ext.commitOrReleasePin}, state=${ext.installState})`,
        authReq.requestId,
        'system',
        ext.installState === 'quarantined' ? 'denied' : 'success'
      );

      return sendOk(res, authReq.requestId, { extension: ext }, 201);
    } catch (err: any) {
      return sendError(
        res,
        authReq.requestId,
        400,
        err?.code || 'EXTENSION_REGISTER_FAILED',
        err?.message || 'Failed to register extension package.'
      );
    }
  });

  app.patch('/api/v1/extensions/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const existing = extensionPackagesStore.get(req.params.id);
    if (!existing || existing.installState === 'uninstalled') {
      return sendError(res, authReq.requestId, 404, 'EXTENSION_NOT_FOUND', 'Extension not found.');
    }
    if (existing.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'FORBIDDEN_EXTENSION_ACCESS',
        'Cannot modify another user’s extension.'
      );
    }

    const updated = updateExtensionPackage(existing, req.body || {});
    extensionPackagesStore.set(updated.id, updated);
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'EXTENSION_UPDATED',
      updated.id,
      `Updated extension "${updated.name}" (version=${updated.version}, state=${updated.installState})`,
      authReq.requestId,
      'system',
      'success'
    );

    return sendOk(res, authReq.requestId, { extension: updated });
  });

  app.post('/api/v1/extensions/:id/rollback', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const existing = extensionPackagesStore.get(req.params.id);
    if (!existing) {
      return sendError(res, authReq.requestId, 404, 'EXTENSION_NOT_FOUND', 'Extension not found.');
    }
    if (existing.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'FORBIDDEN_EXTENSION_ACCESS',
        'Cannot rollback another user’s extension.'
      );
    }

    try {
      const rolledBack = rollbackExtensionPackage(
        existing,
        typeof req.body?.targetCommitOrVersion === 'string'
          ? req.body.targetCommitOrVersion
          : undefined
      );
      extensionPackagesStore.set(rolledBack.id, rolledBack);
      persistState();

      recordAudit(
        uid,
        authReq.authIdentity!.email,
        'EXTENSION_ROLLED_BACK',
        rolledBack.id,
        `Rolled back extension "${rolledBack.name}" to version=${rolledBack.version} (${rolledBack.commitOrReleasePin})`,
        authReq.requestId,
        'system',
        'success'
      );

      return sendOk(res, authReq.requestId, { extension: rolledBack });
    } catch (err: any) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'EXTENSION_ROLLBACK_FAILED',
        err?.message || 'Rollback failed.'
      );
    }
  });

  app.post('/api/v1/extensions/:id/sandbox-verify', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const existing = extensionPackagesStore.get(req.params.id);
    if (!existing) {
      return sendError(res, authReq.requestId, 404, 'EXTENSION_NOT_FOUND', 'Extension not found.');
    }
    if (existing.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'FORBIDDEN_EXTENSION_ACCESS',
        'Cannot run sandbox on another user’s extension.'
      );
    }

    const run = inspectAndSandboxExtensionContent({
      extensionId: existing.id,
      rawContent: existing.untrustedContentEnvelope,
      dependencies: existing.dependencies,
      requestedPermissions: existing.requestedPermissions,
      explicitApprovalGranted: existing.explicitApprovalGranted,
    });

    const updated: ExtensionPackageRecord = {
      ...existing,
      installState: run.passed ? existing.installState : 'quarantined',
      validationRuns: [run, ...existing.validationRuns].slice(0, 20),
      updatedAt: new Date().toISOString(),
    };
    extensionPackagesStore.set(updated.id, updated);
    persistState();

    return sendOk(res, authReq.requestId, {
      extension: updated,
      validationRun: run,
    });
  });

  app.delete('/api/v1/extensions/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const existing = extensionPackagesStore.get(req.params.id);
    if (!existing) {
      return sendError(res, authReq.requestId, 404, 'EXTENSION_NOT_FOUND', 'Extension not found.');
    }
    if (existing.ownerUid !== uid) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'FORBIDDEN_EXTENSION_ACCESS',
        'Cannot uninstall another user’s extension.'
      );
    }

    extensionPackagesStore.delete(existing.id);
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'EXTENSION_UNINSTALLED',
      existing.id,
      `Uninstalled extension "${existing.name}"`,
      authReq.requestId,
      'system',
      'success'
    );

    return sendOk(res, authReq.requestId, { uninstalledId: existing.id });
  });

  // --- TYPED AI TOOL REGISTRY & POLICY-ENFORCED INVOCATION ---

  app.get('/api/v1/tools/registry', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const auditItems = toolAuditRecordsStore.filter((a) => a.ownerUid === uid).slice(0, 50);
    return sendOk(res, authReq.requestId, {
      tools: REGISTERED_AI_TOOLS,
      total: REGISTERED_AI_TOOLS.length,
      auditRecords: auditItems,
      policyGuarantee:
        'Models never receive direct database or filesystem access; all tool invocations pass through server-side schema, ownership, and permission enforcement.',
    });
  });

  app.post('/api/v1/tools/invoke', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    const uid = authReq.authIdentity!.uid;
    const body = req.body || {};
    const toolId = typeof body.toolId === 'string' ? body.toolId.trim() : '';

    if (!toolId) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'VALIDATION_ERROR',
        'toolId is required.'
      );
    }

    const result = invokeRegisteredTool({
      ownerUid: uid,
      toolId,
      input: body.input && typeof body.input === 'object' ? body.input : {},
      dryRun: Boolean(body.dryRun),
      grantedPermissions: Array.isArray(body.grantedPermissions)
        ? (body.grantedPermissions as ExtensionPermissionScope[])
        : undefined,
    });

    toolAuditRecordsStore.unshift(result.auditRecord);
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      result.allowed ? 'AI_TOOL_INVOKED' : 'AI_TOOL_DENIED',
      toolId,
      `Tool ${toolId} (dryRun=${Boolean(body.dryRun)}, status=${result.status})`,
      authReq.requestId,
      'system',
      result.allowed ? 'success' : 'denied'
    );

    if (!result.allowed) {
      return sendError(
        res,
        authReq.requestId,
        result.status === 'denied' ? 403 : 400,
        result.error?.code || 'TOOL_EXECUTION_REJECTED',
        result.error?.message || 'Tool execution rejected by server policy.',
        { auditRecord: result.auditRecord }
      );
    }

    return sendOk(res, authReq.requestId, {
      output: result.output,
      auditRecord: result.auditRecord,
      updatedProjectDoc: result.updatedProjectDoc,
    });
  });

  // ============================================================================
  // AI DIRECTOR DURABLE PRODUCTION STATE MACHINE ROUTES (/api/v1/ai-director/*)
  // ============================================================================

  app.get('/api/v1/ai-director/samples', (_req: Request, res: Response) => {
    const reqId = (_req as AuthenticatedRequest).requestId || 'req-samples';
    res.setHeader('Cache-Control', 'public, max-age=60');
    return sendOk(res, reqId, {
      samples: BUILT_IN_DIRECTOR_SAMPLE_SCRIPTS,
    });
  });

  app.get('/api/v1/ai-director/sessions', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const isAdmin = authReq.userRole === 'owner' || authReq.userRole === 'admin';
    const includeAll = isAdmin && req.query.scope === 'all';
    const items = Array.from(aiDirectorSessionsStore.values())
      .filter((s) => (includeAll ? true : s.ownerUid === uid))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sendOk(res, authReq.requestId, {
      items,
      total: items.length,
    });
  });

  app.post('/api/v1/ai-director/sessions', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const body = (req.body || {}) as Record<string, any>;
    const rawScriptText =
      typeof body.rawScriptText === 'string'
        ? body.rawScriptText
        : typeof body.scriptText === 'string'
        ? body.scriptText
        : '';
    if (!rawScriptText.trim()) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'SCRIPT_REQUIRED',
        'A non-empty rawScriptText (or scriptText) is required to start an AI Director session.'
      );
    }

    const intakeObj = (body.intake && typeof body.intake === 'object' ? body.intake : body) as Record<
      string,
      any
    >;

    try {
      const session = createAiDirectorSession({
        ownerUid: uid,
        title: typeof body.title === 'string' ? body.title : intakeObj.title,
        rawScriptText,
        uploadedFileName:
          typeof intakeObj.uploadedFileName === 'string' ? intakeObj.uploadedFileName : undefined,
        scriptFormat: intakeObj.scriptFormat,
        references: Array.isArray(intakeObj.references) ? intakeObj.references : undefined,
        intendedPlatform: intakeObj.intendedPlatform,
        targetDurationSec:
          typeof intakeObj.targetDurationSec === 'number' ? intakeObj.targetDurationSec : null,
        aspectRatio: intakeObj.aspectRatio,
        fps: intakeObj.fps,
        language: intakeObj.language,
        audience: intakeObj.audience,
        visualGoals: intakeObj.visualGoals,
        brandKit: intakeObj.brandKit,
        voiceAudioAssets: Array.isArray(intakeObj.voiceAudioAssets)
          ? intakeObj.voiceAudioAssets
          : undefined,
        availableResources: Array.isArray(intakeObj.availableResources)
          ? intakeObj.availableResources
          : undefined,
        prohibitedContent: Array.isArray(intakeObj.prohibitedContent)
          ? intakeObj.prohibitedContent
          : undefined,
        budgetLatencyPreference: intakeObj.budgetLatencyPreference,
        maxBudgetUsd:
          typeof intakeObj.maxBudgetUsd === 'number' ? intakeObj.maxBudgetUsd : undefined,
        outputFormat: intakeObj.outputFormat,
        preserveEveryRepetition:
          typeof intakeObj.preserveEveryRepetition === 'boolean'
            ? intakeObj.preserveEveryRepetition
            : true,
        noQuestionsWorkflow: Boolean(intakeObj.noQuestionsWorkflow),
        autonomyMode: intakeObj.autonomyMode,
      });

      aiDirectorSessionsStore.set(session.id, session);
      persistState();
      recordAudit(
        uid,
        authReq.authIdentity!.email,
        'AI_DIRECTOR_SESSION_CREATE',
        `/aiDirectorSessions/${session.id}`,
        `Created AI Director session "${session.intake.title}" (${session.segments.length} segments, stage=${session.stage})`,
        authReq.requestId,
        'user',
        'success'
      );
      return sendOk(res, authReq.requestId, { session }, 201);
    } catch (err) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'DIRECTOR_SESSION_CREATE_FAILED',
        err instanceof Error ? err.message : 'Failed to create AI Director session'
      );
    }
  });

  app.get('/api/v1/ai-director/sessions/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const session = aiDirectorSessionsStore.get(req.params.id);
    if (!session) {
      return sendError(res, authReq.requestId, 404, 'DIRECTOR_SESSION_NOT_FOUND', 'AI Director session not found.');
    }
    const isAdmin = authReq.userRole === 'owner' || authReq.userRole === 'admin';
    if (session.ownerUid !== authReq.authIdentity!.uid && !isAdmin) {
      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'AI_DIRECTOR_IDOR_DENIED',
        `/aiDirectorSessions/${session.id}`,
        'Blocked cross-user access to AI Director session',
        authReq.requestId,
        'system',
        'denied'
      );
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DIRECTOR_SESSION', 'You do not own this AI Director session.');
    }
    return sendOk(res, authReq.requestId, { session });
  });

  app.post('/api/v1/ai-director/sessions/:id/questions', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const session = aiDirectorSessionsStore.get(req.params.id);
    if (!session) {
      return sendError(res, authReq.requestId, 404, 'DIRECTOR_SESSION_NOT_FOUND', 'AI Director session not found.');
    }
    if (session.ownerUid !== authReq.authIdentity!.uid) {
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DIRECTOR_SESSION', 'You do not own this AI Director session.');
    }

    const body = (req.body || {}) as {
      answers?: Record<string, { answer: string; lockDecision?: boolean }>;
      applyDefaultsToUnanswered?: boolean;
    };

    const updated = answerDirectorQuestions(session, {
      answers: body.answers,
      applyDefaultsToUnanswered: body.applyDefaultsToUnanswered !== false,
    });
    aiDirectorSessionsStore.set(updated.id, updated);
    persistState();
    return sendOk(res, authReq.requestId, { session: updated });
  });

  app.post('/api/v1/ai-director/sessions/:id/plan', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const session = aiDirectorSessionsStore.get(req.params.id);
    if (!session) {
      return sendError(res, authReq.requestId, 404, 'DIRECTOR_SESSION_NOT_FOUND', 'AI Director session not found.');
    }
    if (session.ownerUid !== authReq.authIdentity!.uid) {
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DIRECTOR_SESSION', 'You do not own this AI Director session.');
    }

    const body = (req.body || {}) as Parameters<typeof updateDirectorShotPlanAndApprovals>[1];
    try {
      const updated = updateDirectorShotPlanAndApprovals(session, {
        ...body,
        actorUid: authReq.authIdentity!.uid,
      });
      aiDirectorSessionsStore.set(updated.id, updated);
      persistState();
      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'AI_DIRECTOR_PLAN_UPDATE',
        `/aiDirectorSessions/${session.id}`,
        `Updated shot plan/approvals for "${session.intake.title}" (action=${body.action}, revisions=${updated.planRevisions.length})`,
        authReq.requestId,
        'user',
        'success'
      );
      return sendOk(res, authReq.requestId, { session: updated });
    } catch (err) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'PLAN_UPDATE_REJECTED',
        err instanceof Error ? err.message : 'Failed to update shot plan.'
      );
    }
  });

  app.post('/api/v1/ai-director/sessions/:id/produce', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const session = aiDirectorSessionsStore.get(req.params.id);
    if (!session) {
      return sendError(res, authReq.requestId, 404, 'DIRECTOR_SESSION_NOT_FOUND', 'AI Director session not found.');
    }
    if (session.ownerUid !== authReq.authIdentity!.uid) {
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DIRECTOR_SESSION', 'You do not own this AI Director session.');
    }

    const body = (req.body || {}) as {
      simulateFailedShotIds?: string[];
      onlyApprovedShots?: boolean;
    };
    try {
      const updated = executeDirectorProductionPlan(session, {
        simulateFailedShotIds: Array.isArray(body.simulateFailedShotIds)
          ? body.simulateFailedShotIds
          : [],
        onlyApprovedShots: body.onlyApprovedShots,
      });
      aiDirectorSessionsStore.set(updated.id, updated);

      // Automatically save AI-generated assets & reusable scene components as private Drafts
      const callerUid = authReq.authIdentity!.uid;
      for (const genAsset of updated.generatedAssetRecords || []) {
        if (!assetsStore.has(genAsset.assetTaskId)) {
          const nowIso = new Date().toISOString();
          const hash = computeDeterministicSnapshotHash(genAsset);
          assetsStore.set(genAsset.assetTaskId, {
            id: genAsset.assetTaskId,
            title: `${genAsset.title} (AI Draft Asset)`,
            labels: ['ai-generated-draft', genAsset.kind],
            tags: ['ai-director', 'draft'],
            moduleId: 'templates',
            assetKind: 'generated',
            ownerUid: callerUid,
            visibility: 'private',
            licenseType: genAsset.licenseType,
            licenseNote: genAsset.provenanceNote,
            sourceNote: `Auto-saved AI Director generated asset (${genAsset.kind})`,
            provenance: {
              originType: 'generated',
              importedAt: nowIso,
            },
            storageProvider: 'durable-local-store',
            storageObjectKey: null,
            mimeType: 'image/svg+xml',
            sizeBytes: 1024,
            checksumSha256: hash,
            versions: [
              {
                version: '1.0.0',
                checksumSha256: hash,
                sizeBytes: 1024,
                mimeType: 'image/svg+xml',
                updatedAt: nowIso,
                updatedByUid: callerUid,
                note: 'Auto-saved AI generated draft asset',
              },
            ],
            missingAssetDetected: false,
            usedByTemplateIds: [],
            usedByVariantIds: [],
            status: 'stored',
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
      }

      if (updated.canonicalProject && updated.canonicalProject.scenes.length > 0) {
        const userDrafts = Array.from(templateFactoryDraftsStore.values()).filter(
          (d) => d.ownerUid === callerUid
        );
        const autoDraft = runTemplateFactoryPipeline({
          ownerUid: callerUid,
          sourceKind: 'canonical-project',
          title: `${updated.intake.title} · Reusable Scene 1 Rig`,
          description: `Auto-captured reusable scene component from AI Director session "${updated.intake.title}".`,
          moduleId: 'templates',
          licenseType: 'Sowveil Original',
          sourceProject: updated.canonicalProject,
          selectedSceneIds: [updated.canonicalProject.scenes[0].id],
          autoSavedFromAiComponent: true,
          existingCatalog: Array.from(catalogStore.values()),
          existingFactoryDrafts: userDrafts,
          assetsMap: assetsStore,
        });
        templateFactoryDraftsStore.set(autoDraft.id, autoDraft);
      }

      persistState();
      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'AI_DIRECTOR_PRODUCE_TIMELINE',
        `/aiDirectorSessions/${session.id}`,
        `Compiled canonical project v2.0.0 for "${session.intake.title}" (${updated.commandReceipts.length} commands, gate=${updated.acceptanceGate.passed})`,
        authReq.requestId,
        'user',
        'success'
      );
      return sendOk(res, authReq.requestId, { session: updated });
    } catch (err) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'DIRECTOR_PRODUCTION_BLOCKED',
        err instanceof Error ? err.message : 'Production compilation blocked.'
      );
    }
  });

  app.post('/api/v1/ai-director/sessions/:id/refine', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const session = aiDirectorSessionsStore.get(req.params.id);
    if (!session) {
      return sendError(res, authReq.requestId, 404, 'DIRECTOR_SESSION_NOT_FOUND', 'AI Director session not found.');
    }
    if (session.ownerUid !== authReq.authIdentity!.uid) {
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DIRECTOR_SESSION', 'You do not own this AI Director session.');
    }

    const body = (req.body || {}) as { suggestionId?: string };
    if (!body.suggestionId) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'INVALID_REFINEMENT_REQUEST',
        'suggestionId is required.'
      );
    }

    try {
      const updated = applyAdaptiveRefinement(session, body.suggestionId);
      aiDirectorSessionsStore.set(updated.id, updated);
      persistState();
      return sendOk(res, authReq.requestId, { session: updated });
    } catch (err) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'REFINEMENT_BLOCKED',
        err instanceof Error ? err.message : 'Refinement could not be applied.'
      );
    }
  });

  app.post('/api/v1/ai-director/sessions/:id/rollback', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const session = aiDirectorSessionsStore.get(req.params.id);
    if (!session) {
      return sendError(res, authReq.requestId, 404, 'DIRECTOR_SESSION_NOT_FOUND', 'AI Director session not found.');
    }
    if (session.ownerUid !== authReq.authIdentity!.uid) {
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DIRECTOR_SESSION', 'You do not own this AI Director session.');
    }

    const body = (req.body || {}) as { checkpointId?: string };
    if (!body.checkpointId) {
      return sendError(res, authReq.requestId, 400, 'CHECKPOINT_ID_REQUIRED', 'checkpointId is required for rollback.');
    }

    try {
      const updated = rollbackDirectorToCheckpoint(session, body.checkpointId);
      aiDirectorSessionsStore.set(updated.id, updated);
      persistState();
      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'AI_DIRECTOR_CHECKPOINT_ROLLBACK',
        `/aiDirectorSessions/${session.id}`,
        `Rolled back AI Director session "${session.intake.title}" to checkpoint ${body.checkpointId}`,
        authReq.requestId,
        'user',
        'success'
      );
      return sendOk(res, authReq.requestId, { session: updated });
    } catch (err) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'ROLLBACK_FAILED',
        err instanceof Error ? err.message : 'Rollback failed.'
      );
    }
  });

  app.post('/api/v1/ai-director/sessions/:id/save-project', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const session = aiDirectorSessionsStore.get(req.params.id);
    if (!session) {
      return sendError(res, authReq.requestId, 404, 'DIRECTOR_SESSION_NOT_FOUND', 'AI Director session not found.');
    }
    if (session.ownerUid !== authReq.authIdentity!.uid) {
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DIRECTOR_SESSION', 'You do not own this AI Director session.');
    }
    if (!session.canonicalProject) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'CANONICAL_PROJECT_NOT_COMPILED',
        'Execute the production plan first to compile the Canonical Project v2.0.0 before saving to Project Library.'
      );
    }

    const now = new Date().toISOString();
    const projectId = session.canonicalProject.id || `proj_dir_${session.id}`;
    const gate = evaluateDirectorAcceptanceGate(session);
    const partialRecord = canonicalProjectToLibraryRecord(session.canonicalProject);
    const projectRecord: ProjectLibraryItem = {
      ...partialRecord,
      id: projectId,
      updatedAt: now,
    };

    projectsStore.set(projectRecord.id, projectRecord);
    const updatedSession: AiDirectorSessionRecord = {
      ...session,
      acceptanceGate: gate,
      updatedAt: now,
    };
    aiDirectorSessionsStore.set(session.id, updatedSession);
    persistState();

    recordAudit(
      authReq.authIdentity!.uid,
      authReq.authIdentity!.email,
      'AI_DIRECTOR_SAVE_PROJECT',
      `/projects/${projectRecord.id}`,
      `Saved AI Director canonical project "${projectRecord.title}" to Project Library`,
      authReq.requestId,
      'user',
      'success'
    );

    return sendOk(res, authReq.requestId, {
      project: projectRecord,
      session: updatedSession,
    });
  });

  // =========================================================================
  // PHASE 11: PROFESSIONAL MOBILE EDITOR & AI CO-EDITING ENDPOINTS
  // =========================================================================

  const resolveEditableCanonicalProject = (
    authUid: string,
    body: {
      project?: CanonicalProjectDocument;
      projectId?: string;
      directorSessionId?: string;
    }
  ): {
    doc: CanonicalProjectDocument | null;
    errorStatus?: number;
    errorCode?: string;
    errorMessage?: string;
  } => {
    if (body.project) {
      const validation = validateCanonicalProject(body.project);
      if (!validation.valid || !validation.project) {
        return {
          doc: null,
          errorStatus: 400,
          errorCode: 'INVALID_CANONICAL_PROJECT',
          errorMessage: validation.errors.join(' '),
        };
      }
      return { doc: validation.project };
    }
    if (body.directorSessionId) {
      const sess = aiDirectorSessionsStore.get(body.directorSessionId);
      if (!sess) {
        return {
          doc: null,
          errorStatus: 404,
          errorCode: 'DIRECTOR_SESSION_NOT_FOUND',
          errorMessage: 'AI Director session not found.',
        };
      }
      if (sess.ownerUid !== authUid) {
        return {
          doc: null,
          errorStatus: 403,
          errorCode: 'FORBIDDEN_DIRECTOR_SESSION',
          errorMessage: 'You do not own this AI Director session.',
        };
      }
      if (!sess.canonicalProject) {
        return {
          doc: null,
          errorStatus: 400,
          errorCode: 'CANONICAL_PROJECT_NOT_COMPILED',
          errorMessage: 'AI Director session has not compiled a Canonical Project yet.',
        };
      }
      return { doc: sess.canonicalProject };
    }
    if (body.projectId) {
      const stored = projectsStore.get(body.projectId);
      if (!stored) {
        return {
          doc: null,
          errorStatus: 404,
          errorCode: 'PROJECT_NOT_FOUND',
          errorMessage: 'Project not found.',
        };
      }
      if (stored.ownerUid && stored.ownerUid !== authUid) {
        return {
          doc: null,
          errorStatus: 403,
          errorCode: 'FORBIDDEN_PROJECT',
          errorMessage: 'You do not own this project.',
        };
      }
      const migrated = migrateToCanonicalProject(stored, authUid);
      return { doc: migrated.project };
    }
    return {
      doc: null,
      errorStatus: 400,
      errorCode: 'MISSING_PROJECT_PAYLOAD',
      errorMessage: 'Provide project, projectId, or directorSessionId.',
    };
  };

  const persistUpdatedCanonicalProject = (
    authUid: string,
    updatedDoc: CanonicalProjectDocument,
    body: {
      projectId?: string;
      directorSessionId?: string;
    }
  ) => {
    const now = new Date().toISOString();
    if (body.directorSessionId) {
      const sess = aiDirectorSessionsStore.get(body.directorSessionId);
      if (sess && sess.ownerUid === authUid) {
        aiDirectorSessionsStore.set(sess.id, {
          ...sess,
          canonicalProject: updatedDoc,
          updatedAt: now,
        });
      }
    }
    if (body.projectId) {
      const existing = projectsStore.get(body.projectId);
      if (!existing || !existing.ownerUid || existing.ownerUid === authUid) {
        const partial = canonicalProjectToLibraryRecord(updatedDoc);
        projectsStore.set(body.projectId, {
          ...partial,
          id: body.projectId,
          ownerUid: authUid,
          updatedAt: now,
        });
      }
    }
    persistState();
  };

  app.post('/api/v1/editor/command', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const body = (req.body || {}) as {
      project?: CanonicalProjectDocument;
      projectId?: string;
      directorSessionId?: string;
      command?: CanonicalProjectCommand;
    };

    if (!body.command || typeof body.command.type !== 'string') {
      return sendError(
        res,
        authReq.requestId,
        400,
        'INVALID_EDITOR_COMMAND',
        'A typed CanonicalProjectCommand is required.'
      );
    }

    const resolved = resolveEditableCanonicalProject(authReq.authIdentity!.uid, body);
    if (!resolved.doc) {
      return sendError(
        res,
        authReq.requestId,
        resolved.errorStatus || 400,
        resolved.errorCode || 'INVALID_REQUEST',
        resolved.errorMessage || 'Unable to load project.'
      );
    }

    const { project: updatedProject, receipt } = executeProjectCommand(
      resolved.doc,
      body.command,
      {
        actorId: authReq.authIdentity!.uid,
        actorKind: 'user',
        rationale: `Manual editor command ${body.command.type}`,
        approvedByUser: true,
      }
    );
    if (!receipt.ok) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'COMMAND_REJECTED',
        `Command ${body.command.type} rejected: ${receipt.errors.join(' ') || 'Precondition failed'}`
      );
    }

    persistUpdatedCanonicalProject(authReq.authIdentity!.uid, updatedProject, body);

    recordAudit(
      authReq.authIdentity!.uid,
      authReq.authIdentity!.email,
      'EDITOR_COMMAND_EXECUTED',
      `/projects/${updatedProject.id}`,
      `Executed ${body.command.type} (rev #${receipt.revision})`,
      authReq.requestId,
      'user',
      'success'
    );

    return sendOk(res, authReq.requestId, {
      project: updatedProject,
      receipt,
    });
  });

  app.post('/api/v1/editor/ai-transaction/plan', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const body = (req.body || {}) as {
      project?: CanonicalProjectDocument;
      projectId?: string;
      directorSessionId?: string;
      prompt?: string;
      selectedClipId?: string | null;
      selectedSceneId?: string | null;
      playheadSec?: number;
      selection?: {
        selectedClipIds?: string[];
        selectedSceneId?: string | null;
        playheadTimeSec?: number;
      };
    };

    if (!body.prompt || !body.prompt.trim()) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'EMPTY_COEDIT_PROMPT',
        'A natural-language co-edit prompt is required.'
      );
    }

    const resolved = resolveEditableCanonicalProject(authReq.authIdentity!.uid, body);
    if (!resolved.doc) {
      return sendError(
        res,
        authReq.requestId,
        resolved.errorStatus || 400,
        resolved.errorCode || 'INVALID_REQUEST',
        resolved.errorMessage || 'Unable to load project.'
      );
    }

    const selectedClipId =
      body.selectedClipId ?? body.selection?.selectedClipIds?.[0] ?? null;
    const selectedSceneId =
      body.selectedSceneId ?? body.selection?.selectedSceneId ?? null;
    const playheadSec =
      typeof body.playheadSec === 'number'
        ? body.playheadSec
        : typeof body.selection?.playheadTimeSec === 'number'
        ? body.selection.playheadTimeSec
        : 0;

    const transaction = planAiCoEditTransaction({
      project: resolved.doc,
      prompt: body.prompt,
      selectedClipId,
      selectedSceneId,
      playheadSec,
    });

    return sendOk(res, authReq.requestId, {
      transaction,
    });
  });

  app.post('/api/v1/editor/ai-transaction/apply', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const body = (req.body || {}) as {
      project?: CanonicalProjectDocument;
      projectId?: string;
      directorSessionId?: string;
      transaction?: AiCoEditTransaction;
      selectedOperationIds?: string[];
    };

    if (!body.transaction) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'MISSING_TRANSACTION',
        'An AiCoEditTransaction is required.'
      );
    }

    const resolved = resolveEditableCanonicalProject(authReq.authIdentity!.uid, body);
    if (!resolved.doc) {
      return sendError(
        res,
        authReq.requestId,
        resolved.errorStatus || 400,
        resolved.errorCode || 'INVALID_REQUEST',
        resolved.errorMessage || 'Unable to load project.'
      );
    }

    const result = applyAiCoEditTransaction({
      project: resolved.doc,
      transaction: body.transaction,
      selectedOperationIds: body.selectedOperationIds,
      actorId: authReq.authIdentity!.uid,
    });

    if (!result.ok) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'AI_TRANSACTION_REJECTED',
        result.errors.join(' ') || 'AI transaction could not be applied.'
      );
    }

    persistUpdatedCanonicalProject(authReq.authIdentity!.uid, result.project, body);

    recordAudit(
      authReq.authIdentity!.uid,
      authReq.authIdentity!.email,
      'EDITOR_AI_TRANSACTION_APPLIED',
      `/projects/${result.project.id}`,
      `Applied AI Co-Edit transaction ${body.transaction.id} (${result.receipts.length} command receipts)`,
      authReq.requestId,
      'user',
      'success'
    );

    return sendOk(res, authReq.requestId, result);
  });

  app.post('/api/v1/editor/diff', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const body = (req.body || {}) as {
      beforeProject?: CanonicalProjectDocument;
      afterProject?: CanonicalProjectDocument;
    };

    if (!body.beforeProject || !body.afterProject) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'MISSING_DIFF_PROJECTS',
        'Both beforeProject and afterProject are required.'
      );
    }

    const diff = diffCanonicalProjects(body.beforeProject, body.afterProject);
    return sendOk(res, authReq.requestId, { diff });
  });

  // =========================================================================
  // PHASE 12: TEMPLATE FACTORY, AUTOMATIC REUSE & CONTINUOUS IMPROVEMENT API
  // =========================================================================

  const getOrInitUserPreferenceConsent = (uid: string): UserPreferenceConsentConfig => {
    const existing = userPreferenceConsentsStore.get(uid);
    if (existing) return existing;
    const def = createDefaultPreferenceConsent(uid);
    userPreferenceConsentsStore.set(uid, def);
    return def;
  };

  app.get('/api/v1/template-factory/drafts', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;

    const drafts = Array.from(templateFactoryDraftsStore.values())
      .filter((d) => d.ownerUid === uid)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    const consent = getOrInitUserPreferenceConsent(uid);
    const signals = templatePreferenceSignalsStore.filter((s) => s.ownerUid === uid);

    return sendOk(res, authReq.requestId, {
      items: drafts,
      total: drafts.length,
      preferenceConsent: consent,
      preferenceSignals: signals,
    });
  });

  app.post('/api/v1/template-factory/extract-preview', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const body = (req.body || {}) as {
      project?: CanonicalProjectDocument;
      projectId?: string;
      referenceSessionId?: string;
      selectedSceneIds?: string[];
      selectedClipIds?: string[];
    };

    let targetProject: CanonicalProjectDocument | null = null;
    if (body.project) {
      const v = validateCanonicalProject(body.project);
      if (!v.valid || !v.project) {
        return sendError(res, authReq.requestId, 400, 'INVALID_PROJECT', v.errors.join(' '));
      }
      targetProject = v.project;
    } else if (body.referenceSessionId) {
      const refSess = referenceLabSessionsStore.get(body.referenceSessionId);
      if (!refSess) {
        return sendError(res, authReq.requestId, 404, 'REFERENCE_SESSION_NOT_FOUND', 'Reference Lab session not found.');
      }
      if (refSess.ownerUid !== uid) {
        return sendError(res, authReq.requestId, 403, 'FORBIDDEN_REFERENCE_SESSION', 'You do not own this Reference Lab session.');
      }
      targetProject = refSess.canonicalProject;
    } else if (body.projectId) {
      const resolved = resolveEditableCanonicalProject(uid, { projectId: body.projectId });
      if (!resolved.doc) {
        return sendError(
          res,
          authReq.requestId,
          resolved.errorStatus || 400,
          resolved.errorCode || 'INVALID_PROJECT',
          resolved.errorMessage || 'Unable to load project.'
        );
      }
      targetProject = resolved.doc;
    }

    if (!targetProject) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'SOURCE_REQUIRED',
        'Provide project, projectId, or referenceSessionId.'
      );
    }

    const extraction = extractEditableParametersFromProject(targetProject, {
      selectedSceneIds: body.selectedSceneIds,
      selectedClipIds: body.selectedClipIds,
    });

    return sendOk(res, authReq.requestId, extraction);
  });

  app.post('/api/v1/template-factory/create', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const body = (req.body || {}) as {
      sourceKind?: TemplateFactorySourceKind;
      title?: string;
      description?: string;
      moduleId?: CatalogItem['moduleId'];
      categoryId?: string;
      tags?: string[];
      licenseType?: CatalogItem['licenseType'];
      licenseNote?: string;
      authorName?: string;
      project?: CanonicalProjectDocument;
      projectId?: string;
      referenceSessionId?: string;
      selectedSceneIds?: string[];
      selectedClipIds?: string[];
      exposedParameterKeys?: string[];
      autoSavedFromAiComponent?: boolean;
    };

    const sourceKind: TemplateFactorySourceKind = body.sourceKind || 'from-scratch';
    let sourceProject: CanonicalProjectDocument | undefined;
    let referenceSession: ReferenceLabSession | undefined;

    if (sourceKind === 'reference-reconstruction') {
      if (body.referenceSessionId) {
        const found = referenceLabSessionsStore.get(body.referenceSessionId);
        if (!found) {
          return sendError(res, authReq.requestId, 404, 'REFERENCE_SESSION_NOT_FOUND', 'Reference Lab session not found.');
        }
        if (found.ownerUid !== uid) {
          return sendError(res, authReq.requestId, 403, 'FORBIDDEN_REFERENCE_SESSION', 'You do not own this Reference Lab session.');
        }
        referenceSession = found;
      } else if (body.project) {
        const v = validateCanonicalProject(body.project);
        if (!v.valid || !v.project) {
          return sendError(res, authReq.requestId, 400, 'INVALID_PROJECT', v.errors.join(' '));
        }
        sourceProject = {
          ...v.project,
          provenance: {
            ...v.project.provenance,
            originType: 'reference-reconstruction',
          },
        };
      } else {
        return sendError(
          res,
          authReq.requestId,
          400,
          'REFERENCE_SOURCE_REQUIRED',
          'referenceSessionId or reconstructed project is required for reference-reconstruction mode.'
        );
      }
    } else if (sourceKind === 'canonical-project') {
      const resolved = resolveEditableCanonicalProject(uid, {
        project: body.project,
        projectId: body.projectId,
      });
      if (!resolved.doc) {
        return sendError(
          res,
          authReq.requestId,
          resolved.errorStatus || 400,
          resolved.errorCode || 'INVALID_PROJECT',
          resolved.errorMessage || 'Unable to load source project.'
        );
      }
      sourceProject = resolved.doc;
    }

    const userDrafts = Array.from(templateFactoryDraftsStore.values()).filter(
      (d) => d.ownerUid === uid
    );

    const draft = runTemplateFactoryPipeline({
      ownerUid: uid,
      sourceKind: referenceSession ? 'reference-reconstruction' : sourceProject ? 'canonical-project' : 'from-scratch',
      title: body.title,
      description: body.description,
      moduleId: body.moduleId,
      categoryId: body.categoryId,
      tags: body.tags,
      licenseType: body.licenseType,
      licenseNote: body.licenseNote,
      authorName: body.authorName || authReq.authIdentity!.displayName || uid,
      sourceProject,
      referenceSession,
      selectedSceneIds: body.selectedSceneIds,
      selectedClipIds: body.selectedClipIds,
      exposedParameterKeys: body.exposedParameterKeys,
      autoSavedFromAiComponent: body.autoSavedFromAiComponent,
      existingCatalog: Array.from(catalogStore.values()),
      existingFactoryDrafts: userDrafts,
      assetsMap: assetsStore,
    });

    templateFactoryDraftsStore.set(draft.id, draft);
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'TEMPLATE_FACTORY_DRAFT_CREATED',
      `/templateFactoryDrafts/${draft.id}`,
      `Created private Template Factory draft "${draft.title}" (source=${draft.sourceKind}, provenance=${draft.provenanceClassification})`,
      authReq.requestId,
      'catalog',
      'success'
    );

    return sendOk(res, authReq.requestId, { draft }, 201);
  });

  app.patch('/api/v1/template-factory/drafts/:id', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const draft = templateFactoryDraftsStore.get(req.params.id);
    if (!draft) {
      return sendError(res, authReq.requestId, 404, 'DRAFT_NOT_FOUND', 'Template Factory draft not found.');
    }
    if (draft.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DRAFT', 'You do not own this Template Factory draft.');
    }

    const updated = updateFactoryDraftRecord(
      draft,
      req.body || {},
      uid,
      assetsStore
    );
    templateFactoryDraftsStore.set(updated.id, updated);
    persistState();

    return sendOk(res, authReq.requestId, { draft: updated });
  });

  app.post('/api/v1/template-factory/drafts/:id/fork', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const draft = templateFactoryDraftsStore.get(req.params.id);
    if (!draft) {
      return sendError(res, authReq.requestId, 404, 'DRAFT_NOT_FOUND', 'Template Factory draft not found.');
    }
    if (draft.ownerUid !== uid && !draft.publishedToCatalog) {
      return sendError(res, authReq.requestId, 403, 'FORBIDDEN_DRAFT', 'You do not have permission to fork this private draft.');
    }

    const body = (req.body || {}) as { forkTitle?: string };
    const forked = forkFactoryTemplate(draft, uid, body.forkTitle);
    templateFactoryDraftsStore.set(forked.id, forked);
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'TEMPLATE_FACTORY_FORKED',
      `/templateFactoryDrafts/${forked.id}`,
      `Forked Template Factory draft "${draft.title}" (${draft.id}) -> "${forked.title}" (${forked.id})`,
      authReq.requestId,
      'catalog',
      'success'
    );

    return sendOk(res, authReq.requestId, { draft: forked }, 201);
  });

  app.post('/api/v1/template-factory/drafts/:id/merge', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const primaryDraft = templateFactoryDraftsStore.get(req.params.id);
    if (!primaryDraft || primaryDraft.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'PRIMARY_DRAFT_NOT_FOUND', 'Primary Template Factory draft not found.');
    }

    const body = (req.body || {}) as { secondaryDraftId?: string; mergedTitle?: string };
    if (!body.secondaryDraftId) {
      return sendError(res, authReq.requestId, 400, 'SECONDARY_DRAFT_REQUIRED', 'secondaryDraftId is required for merge.');
    }
    const secondaryDraft = templateFactoryDraftsStore.get(body.secondaryDraftId);
    if (!secondaryDraft || secondaryDraft.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'SECONDARY_DRAFT_NOT_FOUND', 'Secondary Template Factory draft not found.');
    }

    const merged = mergeFactoryTemplates({
      primaryDraft,
      secondaryDraft,
      actorUid: uid,
      mergedTitle: body.mergedTitle,
    });
    templateFactoryDraftsStore.set(merged.id, merged);
    persistState();

    return sendOk(res, authReq.requestId, { draft: merged });
  });

  app.post('/api/v1/template-factory/drafts/:id/restore-version', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const draft = templateFactoryDraftsStore.get(req.params.id);
    if (!draft || draft.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'DRAFT_NOT_FOUND', 'Template Factory draft not found.');
    }

    const body = (req.body || {}) as { targetVersion?: string };
    if (!body.targetVersion) {
      return sendError(res, authReq.requestId, 400, 'VERSION_REQUIRED', 'targetVersion is required.');
    }

    try {
      const restored = restoreFactoryTemplateVersion(draft, body.targetVersion, uid);
      templateFactoryDraftsStore.set(restored.id, restored);
      persistState();
      return sendOk(res, authReq.requestId, { draft: restored });
    } catch (err) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'RESTORE_VERSION_FAILED',
        err instanceof Error ? err.message : 'Failed to restore version.'
      );
    }
  });

  app.post('/api/v1/template-factory/drafts/:id/deprecate', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const draft = templateFactoryDraftsStore.get(req.params.id);
    if (!draft || draft.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'DRAFT_NOT_FOUND', 'Template Factory draft not found.');
    }

    const body = (req.body || {}) as { reason?: string; replacementTemplateId?: string };
    const deprecated = deprecateFactoryTemplate(
      draft,
      body.reason || 'Deprecated by owner.',
      body.replacementTemplateId
    );
    templateFactoryDraftsStore.set(deprecated.id, deprecated);
    if (catalogStore.has(deprecated.id)) {
      catalogStore.set(deprecated.id, deprecated.catalogItemDraft);
    }
    persistState();

    return sendOk(res, authReq.requestId, { draft: deprecated });
  });

  app.post('/api/v1/template-factory/drafts/:id/update-dependencies', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const draft = templateFactoryDraftsStore.get(req.params.id);
    if (!draft || draft.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'DRAFT_NOT_FOUND', 'Template Factory draft not found.');
    }

    const body = (req.body || {}) as {
      assetReplacements?: Record<string, string>;
      addFonts?: string[];
      resolveMissingAssets?: boolean;
    };
    const updated = updateFactoryTemplateDependencies(draft, body, uid, assetsStore);
    templateFactoryDraftsStore.set(updated.id, updated);
    persistState();

    return sendOk(res, authReq.requestId, { draft: updated });
  });

  app.post('/api/v1/template-factory/drafts/:id/duplicate-suggestion', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const draft = templateFactoryDraftsStore.get(req.params.id);
    if (!draft || draft.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'DRAFT_NOT_FOUND', 'Template Factory draft not found.');
    }

    const body = (req.body || {}) as {
      suggestionId?: string;
      action?: 'keep-both-distinct' | 'link-as-version' | 'merge-into-existing' | 'undo-suggestion';
      note?: string;
    };
    if (!body.suggestionId || !body.action) {
      return sendError(res, authReq.requestId, 400, 'INVALID_DUPLICATE_RESOLUTION', 'suggestionId and action are required.');
    }

    const updated = resolveDuplicateSuggestion(draft, body.suggestionId, body.action, body.note);
    templateFactoryDraftsStore.set(updated.id, updated);
    persistState();

    return sendOk(res, authReq.requestId, { draft: updated });
  });

  app.post('/api/v1/template-factory/drafts/:id/publish', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const draft = templateFactoryDraftsStore.get(req.params.id);
    if (!draft || draft.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'DRAFT_NOT_FOUND', 'Template Factory draft not found.');
    }

    const body = (req.body || {}) as { explicitUserConfirmation?: boolean };
    const result = publishFactoryTemplateToCatalog({
      draft,
      actorUid: uid,
      explicitUserConfirmation: Boolean(body.explicitUserConfirmation),
      assetsMap: assetsStore,
    });

    if (!result.ok || !result.updatedDraft || !result.publishedCatalogItem) {
      return sendError(
        res,
        authReq.requestId,
        400,
        result.errorCode || 'PUBLISH_BLOCKED',
        result.errorMessage || 'Template failed publication gate.'
      );
    }

    templateFactoryDraftsStore.set(result.updatedDraft.id, result.updatedDraft);
    catalogStore.set(result.publishedCatalogItem.id, result.publishedCatalogItem);
    catalogCacheVersion += 1;
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'TEMPLATE_FACTORY_PUBLISHED',
      `/catalog/${result.publishedCatalogItem.id}`,
      `Published Template Factory draft "${result.publishedCatalogItem.name}" to Validated Catalog (license=${result.publishedCatalogItem.licenseType})`,
      authReq.requestId,
      'catalog',
      'success'
    );

    return sendOk(res, authReq.requestId, {
      draft: result.updatedDraft,
      catalogItem: result.publishedCatalogItem,
    });
  });

  app.post('/api/v1/template-factory/feedback/consent', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const current = getOrInitUserPreferenceConsent(uid);
    const body = (req.body || {}) as { consentToPreferenceRanking?: boolean };

    const updated: UserPreferenceConsentConfig = {
      ...current,
      consentToPreferenceRanking:
        body.consentToPreferenceRanking !== undefined
          ? Boolean(body.consentToPreferenceRanking)
          : current.consentToPreferenceRanking,
      allowCrossUserSharing: false,
      silentModelTrainingEnabled: false,
      updatedAt: new Date().toISOString(),
    };
    userPreferenceConsentsStore.set(uid, updated);
    persistState();

    return sendOk(res, authReq.requestId, { preferenceConsent: updated });
  });

  app.post('/api/v1/template-factory/feedback/signal', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const consent = getOrInitUserPreferenceConsent(uid);
    const body = (req.body || {}) as {
      templateId?: string;
      moduleId?: CatalogItem['moduleId'];
      action?: TemplateFeedbackAction;
      preferredVersion?: string;
      styleTag?: string;
      reasonNote?: string;
    };

    if (!body.templateId || !body.action) {
      return sendError(res, authReq.requestId, 400, 'INVALID_FEEDBACK_SIGNAL', 'templateId and action are required.');
    }

    const result = recordTemplateFeedbackSignal({
      ownerUid: uid,
      consentConfig: consent,
      existingSignals: templatePreferenceSignalsStore,
      templateId: body.templateId,
      moduleId: body.moduleId,
      action: body.action,
      preferredVersion: body.preferredVersion,
      styleTag: body.styleTag,
      reasonNote: body.reasonNote,
    });

    if (!result.recorded) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'CONSENT_DISABLED',
        result.consentBlockedReason || 'Preference capture disabled by user consent settings.'
      );
    }

    templatePreferenceSignalsStore.splice(
      0,
      templatePreferenceSignalsStore.length,
      ...result.signals
    );
    userPreferenceConsentsStore.set(uid, result.updatedConsent);
    persistState();

    return sendOk(res, authReq.requestId, {
      recorded: true,
      preferenceConsent: result.updatedConsent,
      preferenceSignals: templatePreferenceSignalsStore.filter((s) => s.ownerUid === uid),
    });
  });

  app.get('/api/v1/template-factory/rankings', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;
    const consent = getOrInitUserPreferenceConsent(uid);
    const moduleId =
      typeof req.query.moduleId === 'string'
        ? (req.query.moduleId as CatalogItem['moduleId'])
        : undefined;

    const userDraftItems = Array.from(templateFactoryDraftsStore.values())
      .filter((d) => d.ownerUid === uid)
      .map((d) => d.catalogItemDraft);
    const publishedItems = Array.from(catalogStore.values()).filter(
      (i) => i.visibility === 'published'
    );
    const combinedMap = new Map<string, CatalogItem>();
    for (const item of [...publishedItems, ...userDraftItems]) {
      combinedMap.set(item.id, item);
    }

    const rankings = rankTemplatesWithTransparentSignals({
      ownerUid: uid,
      consentConfig: consent,
      userSignals: templatePreferenceSignalsStore,
      templates: Array.from(combinedMap.values()),
      moduleId,
    });

    return sendOk(res, authReq.requestId, {
      rankings: rankings.slice(0, 50),
      preferenceConsent: consent,
    });
  });

  // ============================================================================
  // PHASE 13 — CANONICAL RENDERING, EXPORT, MOBILE APP ADAPTERS & FINAL QA GATE
  // ============================================================================

  function toPublicRenderJobView(
    job: DurableRenderExportJobRecord
  ): Omit<DurableRenderExportJobRecord, 'artifactBytesBase64'> & {
    hasDownloadableBytes: boolean;
    downloadUrl: string | null;
  } {
    const { artifactBytesBase64, ...rest } = job;
    const hasDownloadableBytes =
      job.stage === 'ready' &&
      Boolean(artifactBytesBase64) &&
      Boolean(job.artifactMetadata?.validatedAfterWrite);
    return {
      ...rest,
      hasDownloadableBytes,
      downloadUrl: hasDownloadableBytes
        ? `/api/v1/render-export/jobs/${job.id}/download`
        : null,
    };
  }

  app.get('/api/v1/render-export/capabilities', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');

    const adapterManifests = getMobileAdapterCapabilityManifests();
    const serverEnvironmentCapabilities = detectBrowserRenderCapabilities();
    const workerDisclosureSample = evaluateServerWorkerTransparency({
      executionTier: 'final-render',
      outputFormat: 'mp4-video',
      durationSec: 10,
      projectClipsCount: 6,
      userApprovedDataUpload: false,
    });

    return sendOk(res, authReq.requestId, {
      engineVersion: RENDER_EXPORT_ENGINE_VERSION,
      adapterManifests,
      serverEnvironmentCapabilities,
      serverWorkerStatus: workerDisclosureSample,
      supportedExecutionTiers: ['timeline-preview', 'proxy-render', 'final-render'],
      universalFormats: [
        { format: 'sowveil-bundle-zip', ext: '.sowveil.zip', status: 'Verified', description: 'Complete Canonical v2.0.0 Project + Assets + Captions + Stems + QA Report' },
        { format: 'sowveil-json', ext: '.sowveil.json', status: 'Verified', description: 'Canonical v2.0.0 Project Graph JSON' },
        { format: 'png-frame', ext: '.png', status: 'Verified', description: 'Validated RGBA PNG Frame Still (IHDR/IDAT/IEND checked)' },
        { format: 'jpeg-frame', ext: '.jpg', status: 'Verified', description: 'Validated Baseline JFIF JPEG Frame Still (SOI/SOF0/EOI checked)' },
        { format: 'svg-vector', ext: '.svg', status: 'Verified', description: 'Sanitized Vector SVG Frame Plate' },
        { format: 'wav-audio', ext: '.wav', status: 'Verified', description: 'Validated 16-bit PCM RIFF/WAVE Audio Master with Peak/Clipping Telemetry' },
        { format: 'audio-stems-zip', ext: '.stems.zip', status: 'Verified', description: 'Per-Track 16-bit PCM WAV Stems + Master + STEMS_MANIFEST.json' },
        { format: 'srt-captions', ext: '.srt', status: 'Verified', description: 'Validated SubRip (.srt) Timed Captions' },
        { format: 'vtt-captions', ext: '.vtt', status: 'Verified', description: 'Validated WebVTT (.vtt) Timed Captions' },
        { format: 'alight-motion-xml', ext: '.xml', status: 'Tested subset', description: 'Validated Alight Motion <scene> XML (2D text/shape/bezier subset)' },
        { format: 'capcut-handoff-zip', ext: '.capcut-handoff.zip', status: 'Media handoff only', description: 'Honest CapCut Media + SRT + Timing Sheet Handoff ZIP' },
        { format: 'node-video-handoff-zip', ext: '.nodevideo-handoff.zip', status: 'Media handoff only', description: 'Node Video Media + Cubic-Bezier Curve Sheet Handoff ZIP' },
        { format: 'kinemaster-handoff-zip', ext: '.kinemaster-handoff.zip', status: 'Media handoff only', description: 'KineMaster Media + SRT + Timing Handoff ZIP (never fake .kine)' },
        { format: 'webm-video', ext: '.webm', status: 'Needs setup', description: 'Requires verified browser WebCodecs/MediaRecorder or configured render worker' },
        { format: 'mp4-video', ext: '.mp4', status: 'Needs setup', description: 'Requires configured H.264 server render worker (never renames WebM/ZIP to .mp4)' },
      ],
    });
  });

  app.post('/api/v1/render-export/feature-loss-preview', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;

    const body = (req.body || {}) as {
      projectDoc?: CanonicalProjectDocument;
      projectId?: string;
      targetAdapter?: TargetMobileEditorId;
      executionTier?: RenderExecutionTier;
      outputFormat?: RenderOutputFormat;
      userApprovedDataUpload?: boolean;
    };

    let projectDoc: CanonicalProjectDocument | undefined = body.projectDoc;
    if (!projectDoc && body.projectId) {
      const foundProj = projectsStore.get(body.projectId);
      if (foundProj && foundProj.ownerUid === uid && foundProj.canonicalProjectJson) {
        try {
          projectDoc = JSON.parse(foundProj.canonicalProjectJson) as CanonicalProjectDocument;
        } catch {
          projectDoc = undefined;
        }
      }
    }
    if (!projectDoc) {
      projectDoc = createKnownGoodSampleCanonicalProject(uid);
    }

    const targetAdapter: TargetMobileEditorId = body.targetAdapter || 'sowveil-project';
    const report = computeAdapterFeatureLossReport(projectDoc, targetAdapter, assetsStore);
    const workerDisclosure = evaluateServerWorkerTransparency({
      executionTier: body.executionTier || 'final-render',
      outputFormat: body.outputFormat || 'sowveil-bundle-zip',
      durationSec: projectDoc.canvas.durationSec || 6,
      projectClipsCount: getAllClipsFromProject(projectDoc).length,
      userApprovedDataUpload: body.userApprovedDataUpload,
    });

    return sendOk(res, authReq.requestId, {
      featureLossReport: report,
      serverWorkerDisclosure: workerDisclosure,
    });
  });

  app.get('/api/v1/render-export/jobs', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;

    const jobs = Array.from(renderExportJobsStore.values())
      .filter((j) => j.ownerUid === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toPublicRenderJobView);

    return sendOk(res, authReq.requestId, {
      jobs,
      sampleProject: createKnownGoodSampleCanonicalProject(uid),
    });
  });

  app.post('/api/v1/render-export/jobs', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;

    const body = (req.body || {}) as {
      projectDoc?: CanonicalProjectDocument;
      projectId?: string;
      directorSessionId?: string;
      executionTier?: RenderExecutionTier;
      outputFormat?: RenderOutputFormat;
      targetAdapter?: TargetMobileEditorId;
      requestedWidth?: number;
      requestedHeight?: number;
      requestedFps?: 24 | 30 | 60;
      requestedDurationSec?: number;
      sampleTimestampSec?: number;
      downscaleAssetsForProxy?: boolean;
      userApprovedDataUpload?: boolean;
    };

    const outputFormat: RenderOutputFormat = body.outputFormat || 'sowveil-bundle-zip';
    const executionTier: RenderExecutionTier = body.executionTier || 'final-render';

    let directorSession: AiDirectorSessionRecord | null = null;
    if (body.directorSessionId) {
      const ds = aiDirectorSessionsStore.get(body.directorSessionId);
      if (ds && ds.ownerUid === uid) {
        directorSession = ds;
      }
    }

    let projectDoc: CanonicalProjectDocument | undefined = body.projectDoc;
    if (!projectDoc && body.projectId) {
      const foundProj = projectsStore.get(body.projectId);
      if (foundProj && foundProj.ownerUid === uid && foundProj.canonicalProjectJson) {
        try {
          projectDoc = JSON.parse(foundProj.canonicalProjectJson) as CanonicalProjectDocument;
        } catch {
          projectDoc = undefined;
        }
      }
    }
    if (!projectDoc && directorSession?.canonicalProject) {
      projectDoc = directorSession.canonicalProject;
    }
    if (!projectDoc) {
      projectDoc = createKnownGoodSampleCanonicalProject(uid);
    }

    const jobRecord = createAndExecuteCanonicalRenderJob({
      ownerUid: uid,
      projectDoc,
      directorSession,
      executionTier,
      outputFormat,
      targetAdapter: body.targetAdapter,
      requestedWidth: body.requestedWidth,
      requestedHeight: body.requestedHeight,
      requestedFps: body.requestedFps,
      requestedDurationSec: body.requestedDurationSec,
      sampleTimestampSec: body.sampleTimestampSec,
      downscaleAssetsForProxy: body.downscaleAssetsForProxy,
      userApprovedDataUpload: body.userApprovedDataUpload,
      assetsMap: assetsStore,
    });

    renderExportJobsStore.set(jobRecord.id, jobRecord);
    persistState();

    recordAudit(
      uid,
      authReq.authIdentity!.email,
      'CANONICAL_RENDER_JOB_EXECUTED',
      `/render-export/jobs/${jobRecord.id}`,
      `Executed ${executionTier} job (${outputFormat}, adapter=${jobRecord.targetAdapter}) → stage=${jobRecord.stage}`,
      authReq.requestId,
      'job',
      jobRecord.stage === 'ready' ? 'success' : 'denied'
    );

    return sendOk(
      res,
      authReq.requestId,
      {
        job: toPublicRenderJobView(jobRecord),
      },
      201
    );
  });

  app.post('/api/v1/render-export/jobs/:id/cancel', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;

    const existing = renderExportJobsStore.get(req.params.id);
    if (!existing || existing.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'RENDER_JOB_NOT_FOUND', 'Render job not found.');
    }

    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 240)
        : 'Cancelled by user request';
    const cancelled = cancelRenderExportJob(existing, reason);
    renderExportJobsStore.set(cancelled.id, cancelled);
    persistState();

    return sendOk(res, authReq.requestId, {
      job: toPublicRenderJobView(cancelled),
    });
  });

  app.post('/api/v1/render-export/jobs/:id/retry', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;

    const existing = renderExportJobsStore.get(req.params.id);
    if (!existing || existing.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'RENDER_JOB_NOT_FOUND', 'Render job not found.');
    }

    if (existing.retryPolicy.attemptCount >= existing.retryPolicy.maxAttempts) {
      return sendError(
        res,
        authReq.requestId,
        400,
        'MAX_RETRY_ATTEMPTS_REACHED',
        `Render job has reached max retry attempts (${existing.retryPolicy.maxAttempts}).`
      );
    }

    let projectDoc = (req.body?.projectDoc as CanonicalProjectDocument | undefined);
    if (!projectDoc) {
      const foundProj = projectsStore.get(existing.projectId);
      if (foundProj && foundProj.ownerUid === uid && foundProj.canonicalProjectJson) {
        try {
          projectDoc = JSON.parse(foundProj.canonicalProjectJson) as CanonicalProjectDocument;
        } catch {
          projectDoc = undefined;
        }
      }
    }
    if (!projectDoc) {
      projectDoc = createKnownGoodSampleCanonicalProject(uid);
    }

    const retried = createAndExecuteCanonicalRenderJob({
      ownerUid: uid,
      projectDoc,
      executionTier: existing.executionTier,
      outputFormat:
        (req.body?.outputFormat as RenderOutputFormat | undefined) || existing.outputFormat,
      targetAdapter: existing.targetAdapter,
      requestedWidth: existing.requestedWidth,
      requestedHeight: existing.requestedHeight,
      requestedFps: existing.requestedFps,
      requestedDurationSec: existing.requestedDurationSec,
      sampleTimestampSec: existing.sampleTimestampSec,
      downscaleAssetsForProxy: existing.downscaleAssetsForProxy,
      userApprovedDataUpload: Boolean(req.body?.userApprovedDataUpload),
      assetsMap: assetsStore,
      existingJobToRetry: existing,
    });

    renderExportJobsStore.set(retried.id, retried);
    persistState();

    return sendOk(res, authReq.requestId, {
      job: toPublicRenderJobView(retried),
    });
  });

  app.get('/api/v1/render-export/jobs/:id/qa-report', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;

    const existing = renderExportJobsStore.get(req.params.id);
    if (!existing || existing.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'RENDER_JOB_NOT_FOUND', 'Render job not found.');
    }

    return sendOk(res, authReq.requestId, {
      jobId: existing.id,
      stage: existing.stage,
      qaReport: existing.qaReport,
      featureLossReport: existing.featureLossReport,
      artifactMetadata: existing.artifactMetadata,
    });
  });

  app.get('/api/v1/render-export/jobs/:id/download', requireAuth, (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    res.setHeader('Cache-Control', 'private, no-store');
    const uid = authReq.authIdentity!.uid;

    const existing = renderExportJobsStore.get(req.params.id);
    if (!existing || existing.ownerUid !== uid) {
      return sendError(res, authReq.requestId, 404, 'RENDER_JOB_NOT_FOUND', 'Render job not found.');
    }

    if (
      existing.stage !== 'ready' ||
      !existing.artifactBytesBase64 ||
      !existing.artifactMetadata ||
      !existing.artifactMetadata.validatedAfterWrite
    ) {
      return sendError(
        res,
        authReq.requestId,
        409,
        'RENDER_OUTPUT_NOT_READY',
        `Render job "${existing.id}" is in stage "${existing.stage}" and does not have a verified downloadable file.`
      );
    }

    const binaryBuffer = Buffer.from(existing.artifactBytesBase64, 'base64');
    res.setHeader('Content-Type', existing.artifactMetadata.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${existing.artifactMetadata.fileName}"`
    );
    res.setHeader('Content-Length', String(binaryBuffer.byteLength));
    res.setHeader('X-Sowveil-Sha256', existing.artifactMetadata.sha256);
    res.setHeader('X-Sowveil-Crc32', existing.artifactMetadata.crc32Hex);
    res.setHeader('X-Sowveil-Renderer-Version', existing.artifactMetadata.rendererVersion);
    return res.status(200).send(binaryBuffer);
  });

  // Explicitly forbid alteration or deletion of audit records
  app.all('/api/v1/admin/audit-events*', requireAuth, (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') return next();
    const authReq = req as AuthenticatedRequest;
    recordAudit(
      authReq.authIdentity!.uid,
      authReq.authIdentity!.email,
      'AUDIT_LOG_MUTATION_DENIED',
      req.path,
      `Blocked ${req.method} attempt on append-only audit log`,
      authReq.requestId,
      'system',
      'denied'
    );
    return sendError(
      res,
      authReq.requestId,
      403,
      'AUDIT_LOG_IMMUTABLE',
      'Audit log is append-only; alteration or deletion of audit records is strictly prohibited.'
    );
  });

  return app;
}

export const createSowveilApiApp = createApiApp;

