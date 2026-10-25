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
  CatalogCreateSchema,
  CatalogPatchSchema,
  EditorAdapterAdminPatchSchema,
  ExportArtifactFormatEnum,
  ModuleAdminPatchSchema,
  PlatformSettingsPatchSchema,
  redactSensitiveDiagnosticString,
  UserRoleAssignmentSchema,
  UserStatusUpdateSchema,
} from '../schemas/sowveilSchemas';

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
  const configuredBootstrapSecret =
    options.ownerBootstrapSecret ||
    process.env.OWNER_BOOTSTRAP_SECRET ||
    'SOWVEIL_OWNER_BOOTSTRAP_ONCE';
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
  const modulesStore = new Map<string, ModuleDefinition>();
  const editorAdaptersStore = new Map<TargetMobileEditorId, MobileEditorAdapterDescriptor>();
  const assetsStore = new Map<string, AssetMetadataRecord>();
  const auditLog: AuditEventRecord[] = [];
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  const authRateBuckets = new Map<string, { count: number; resetAt: number }>();
  const AUTH_RATE_LIMIT_PER_MINUTE = 10;

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
    catalogStore.set(item.id, {
      ...item,
      favoritesCompatible: item.favoritesCompatible ?? true,
      supportedExportFormats: item.supportedExportFormats || [
        'sowveil-json',
        'alight-xml',
        'zip-bundle',
        'svg-frame',
      ],
    });
  }
  catalogStore.set('draft-internal-rig', {
    ...SEED_CATALOG_ITEMS[0],
    id: 'draft-internal-rig',
    name: 'Internal Unreleased Draft Preset',
    slug: 'internal-unreleased-draft-preset',
    visibility: 'draft',
  });

  // Seed asset metadata records from initial catalog items (no mocked binary URLs)
  for (const item of SEED_CATALOG_ITEMS.slice(0, 12)) {
    const assetId = `asset_${item.id}`;
    assetsStore.set(assetId, {
      id: assetId,
      title: `${item.name} (${item.packLabel})`,
      moduleId: item.moduleId,
      catalogItemId: item.id,
      assetKind: item.assetKind,
      ownerUid: 'system-seed',
      licenseType: item.licenseType,
      licenseNote: item.licenseNote,
      sourceNote: `Procedural ${item.sourceType} preset specification`,
      storageProvider: storageEnabled ? 'cloud-storage' : 'none-configured',
      storageObjectKey: null,
      mimeType: item.moduleId === 'sfx' ? 'audio/wav' : 'application/json',
      sizeBytes: item.metadata.fileSizeBytes ?? null,
      status: 'metadata-only',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
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
    const authHeader = req.header('authorization');
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      try {
        const identity = await verifyToken(authHeader.slice(7).trim());
        const r = roleStore.get(identity.uid) || 'user';
        callerIsAdmin = r === 'admin' || r === 'owner';
      } catch {
        callerIsAdmin = false;
      }
    }

    const requestedVisibility =
      typeof req.query.visibility === 'string' ? req.query.visibility : 'published';
    if (requestedVisibility !== 'published' && !callerIsAdmin) {
      return sendError(
        res,
        authReq.requestId,
        403,
        'DRAFT_ACCESS_FORBIDDEN',
        'Ordinary users cannot list draft or archived catalog records.'
      );
    }

    const moduleId = typeof req.query.moduleId === 'string' ? req.query.moduleId : undefined;
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
    const capabilityFilter =
      typeof req.query.capabilityType === 'string' ? req.query.capabilityType : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
    const { limit, offset } = parsePagination(req);

    const all = Array.from(catalogStore.values()).filter((item) => {
      if (!callerIsAdmin && item.visibility !== 'published') return false;
      if (
        requestedVisibility &&
        requestedVisibility !== 'all' &&
        item.visibility !== requestedVisibility
      ) {
        return false;
      }
      if (moduleId && item.moduleId !== moduleId) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (capabilityFilter && item.capabilityType !== capabilityFilter) return false;
      if (q) {
        return (
          item.name.toLowerCase().includes(q) ||
          item.slug.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.packLabel.toLowerCase().includes(q) ||
          item.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });

    if (!callerIsAdmin && requestedVisibility === 'published') {
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    }
    const sliced = all.slice(offset, offset + limit);
    return sendOk(res, authReq.requestId, {
      items: sliced,
      total: all.length,
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

    if (item.visibility !== 'published') {
      let callerIsAdmin = false;
      const authHeader = req.header('authorization');
      if (authHeader?.toLowerCase().startsWith('bearer ')) {
        try {
          const identity = await verifyToken(authHeader.slice(7).trim());
          const r = roleStore.get(identity.uid) || 'user';
          callerIsAdmin = r === 'admin' || r === 'owner';
        } catch {
          callerIsAdmin = false;
        }
      }
      if (!callerIsAdmin) {
        return sendError(
          res,
          authReq.requestId,
          403,
          'DRAFT_ACCESS_FORBIDDEN',
          'Ordinary users cannot access draft or archived catalog records.'
        );
      }
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
    return sendOk(res, authReq.requestId, {
      items: set ? Array.from(set) : [],
      total: set ? set.size : 0,
    });
  });

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

    const owned = Array.from(projectsStore.values()).filter((p) => p.ownerUid === uid);
    return sendOk(res, authReq.requestId, {
      items: owned.slice(offset, offset + limit),
      total: owned.length,
      limit,
      offset,
    });
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
    const record: ProjectLibraryItem = {
      id: `proj_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      ownerUid: uid,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    };
    projectsStore.set(record.id, record);
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

    const updated: ProjectLibraryItem = {
      ...proj,
      ...parsed.data,
      id: proj.id,
      ownerUid: proj.ownerUid,
      updatedAt: new Date().toISOString(),
    };
    projectsStore.set(proj.id, updated);
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

  // 2. Catalog Create / Update / Archive-Delete with Cache Invalidation & Retention Checks
  app.post(
    '/api/v1/catalog',
    requireAuth,
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
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

      const now = new Date().toISOString();
      const created: CatalogItem = {
        ...SEED_CATALOG_ITEMS[0],
        ...parsed.data,
        metadata: {
          ...SEED_CATALOG_ITEMS[0].metadata,
          version: parsed.data.version || '1.0.0',
        },
        moduleId: parsed.data.moduleId as CatalogItem['moduleId'],
        createdAt: now,
        updatedAt: now,
      };
      catalogStore.set(created.id, created);
      catalogCacheVersion += 1;

      recordAudit(
        authReq.authIdentity!.uid,
        authReq.authIdentity!.email,
        'CATALOG_ITEM_CREATED',
        created.id,
        `Created catalog item "${created.name}" (${created.visibility}, cache v${catalogCacheVersion})`,
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
    requireRole(['admin', 'owner']),
    (req: Request, res: Response) => {
      const authReq = req as AuthenticatedRequest;
      const existing = catalogStore.get(req.params.id);
      if (!existing) {
        return sendError(res, authReq.requestId, 404, 'NOT_FOUND', 'Catalog item not found.');
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

      const prevVis = existing.visibility;
      const updated: CatalogItem = {
        ...existing,
        ...parsed.data,
        metadata: {
          ...existing.metadata,
          ...(parsed.data.version ? { version: parsed.data.version } : {}),
        },
        id: existing.id,
        updatedAt: new Date().toISOString(),
      };
      catalogStore.set(updated.id, updated);
      catalogCacheVersion += 1;

      const auditAction =
        parsed.data.visibility === 'published' && prevVis !== 'published'
          ? 'CATALOG_ITEM_PUBLISHED'
          : parsed.data.visibility === 'archived' && prevVis !== 'archived'
          ? 'CATALOG_ITEM_ARCHIVED'
          : 'CATALOG_ITEM_UPDATED';

      recordAudit(
        authReq.authIdentity!.uid,
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
        updatedAt: new Date().toISOString(),
      };
      catalogStore.set(existing.id, archived);
      catalogCacheVersion += 1;

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
        title: parsed.data.title,
        moduleId: parsed.data.moduleId,
        catalogItemId: parsed.data.catalogItemId,
        assetKind: parsed.data.assetKind,
        ownerUid: authReq.authIdentity!.uid,
        licenseType: parsed.data.licenseType,
        licenseNote: parsed.data.licenseNote,
        sourceNote: parsed.data.sourceNote,
        storageProvider: storageEnabled ? 'cloud-storage' : 'none-configured',
        storageObjectKey: null,
        mimeType: parsed.data.mimeType,
        sizeBytes: parsed.data.sizeBytes,
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
