import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AssetKind,
  AssetMetadataRecord,
  AuditEventRecord,
  AuthenticatedUser,
  CapabilityStatus,
  CapabilityType,
  CatalogItem,
  EditorCompatibilityStatus,
  ExportArtifactFormat,
  JobRecord,
  MobileEditorAdapterDescriptor,
  ModuleDefinition,
  ModuleId,
  PlatformSettingsConfig,
  PreviewRenderKind,
  TargetMobileEditorId,
  TemplateLicenseType,
  TemplateVisibility,
  UserRole,
} from '../types/sowveil';
import {
  AssetMetadataCreateSchema,
  CatalogCreateSchema,
  CatalogPatchSchema,
  EditorAdapterAdminPatchSchema,
  ModuleAdminPatchSchema,
  PlatformSettingsPatchSchema,
} from '../schemas/sowveilSchemas';
import { SOWVEIL_MODULES } from '../data/modules';
import { PreviewRenderer } from './PreviewRenderer';
import { auth } from '../services/firebaseClient';
import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Edit3,
  Eye,
  FileCode2,
  FolderLock,
  Layers,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react';

interface AdminConsoleWorkspaceProps {
  subroute: string;
  catalogItemId?: string;
  currentUser: AuthenticatedUser | null;
  role: UserRole;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

interface AdminSummaryResponse {
  range: '24h' | '7d' | '30d' | 'all';
  generatedAt: string;
  catalog: {
    total: number;
    published: number;
    draft: number;
    archived: number;
    cacheVersion: number;
  };
  modules: {
    total: number;
    enabled: number;
    disabled: number;
  };
  users: {
    total: number;
    active: number;
    suspended: number;
    owners: number;
    admins: number;
  };
  jobs: {
    totalInRange: number;
    queued: number;
    running: number;
    readyOrDownloaded: number;
    failed: number;
    needsSetup: number;
  };
  assets: {
    total: number;
    metadataOnly: number;
    stored: number;
    storageProvider: string;
  };
  auditCountInRange: number;
  recentAuditEvents: AuditEventRecord[];
}

interface SafeAdminUserRecord {
  uid: string;
  displayName: string;
  emailMasked: string;
  role: UserRole;
  status: 'active' | 'suspended' | 'pending';
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AdminAnalyticsResponse {
  externalTelemetryProvider: string;
  externalTelemetryNote: string;
  realOperationalTotals: {
    totalExportAndRenderJobs: number;
    totalFavoritesSaved: number;
    totalProjectLibraryRecords: number;
    totalAuditEvents: number;
  };
  exportsByEditor: Record<string, number>;
  exportsByFormat: Record<string, number>;
  catalogByModule: Array<{ moduleId: string; label: string; count: number }>;
}

const ADMIN_NAV_ITEMS = [
  { id: 'overview', label: 'Summary', path: '/admin', icon: Activity },
  { id: 'catalog', label: 'Catalog', path: '/admin/catalog', icon: Layers },
  { id: 'assets', label: 'Assets', path: '/admin/assets', icon: FolderLock },
  { id: 'modules', label: '20 Modules', path: '/admin/modules', icon: Boxes },
  { id: 'users', label: 'Users', path: '/admin/users', icon: Users },
  { id: 'roles', label: 'Roles & Policy', path: '/admin/roles', icon: ShieldCheck },
  { id: 'jobs', label: 'Jobs', path: '/admin/jobs', icon: FileCode2 },
  { id: 'analytics', label: 'Analytics', path: '/admin/analytics', icon: BarChart3 },
  { id: 'settings', label: 'Settings & Editors', path: '/admin/settings', icon: Settings },
  { id: 'audit', label: 'Audit Log', path: '/admin/audit', icon: ShieldAlert },
] as const;

const ALL_EXPORT_FORMATS: ExportArtifactFormat[] = [
  'sowveil-json',
  'alight-xml',
  'zip-bundle',
  'svg-frame',
  'wav-audio',
  'srt-captions',
];

const ALL_PREVIEW_KINDS: PreviewRenderKind[] = [
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
];

const ALL_CAPABILITY_TYPES: CapabilityType[] = [
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
];

export const AdminConsoleWorkspace: React.FC<AdminConsoleWorkspaceProps> = ({
  subroute,
  catalogItemId,
  currentUser,
  role,
  onNotify,
}) => {
  const navigate = useNavigate();
  const params = useParams<{ itemId?: string }>();
  const resolvedCatalogItemId = catalogItemId || params.itemId;

  const [loading, setLoading] = useState<boolean>(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [cacheVersion, setCacheVersion] = useState<number>(1);

  // Overview state
  const [summaryRange, setSummaryRange] = useState<'24h' | '7d' | '30d' | 'all'>('7d');
  const [summaryData, setSummaryData] = useState<AdminSummaryResponse | null>(null);

  // Catalog state
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogModuleFilter, setCatalogModuleFilter] = useState<string>('all');
  const [catalogVisibilityFilter, setCatalogVisibilityFilter] = useState<string>('all');
  const [catalogCapabilityFilter, setCatalogCapabilityFilter] = useState<string>('all');
  const [catalogPage, setCatalogPage] = useState<number>(1);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);

  // Catalog Form state (/admin/catalog/new or /admin/catalog/:id)
  const [formItem, setFormItem] = useState<{
    id: string;
    moduleId: ModuleId;
    categoryId: string;
    name: string;
    slug: string;
    packLabel: string;
    summary: string;
    description: string;
    tagsCsv: string;
    status: CapabilityStatus;
    statusReason: string;
    capabilityType: CapabilityType;
    assetKind: AssetKind;
    previewKind: PreviewRenderKind;
    visibility: TemplateVisibility;
    licenseType: TemplateLicenseType;
    licenseNote: string;
    sourceType: 'original-svg-css' | 'procedural-canvas' | 'reference-seed';
    supportedExportFormats: ExportArtifactFormat[];
  }>({
    id: 'ta-kinetic-mobile-card',
    moduleId: 'text-animation',
    categoryId: 'ta-title',
    name: 'Kinetic Title Card',
    slug: 'kinetic-title-card',
    packLabel: 'Typography Pack',
    summary: 'Mobile-ready kinetic typography preset with deterministic easing curves.',
    description:
      'Procedural text animation preset designed for 9:16 mobile vertical compositions and Alight Motion XML export.',
    tagsCsv: 'kinetic, mobile, title, 60fps',
    status: 'Available',
    statusReason: 'Mobile browser preview & Editor Gateway export ready',
    capabilityType: 'text-preset',
    assetKind: 'scene-spec',
    previewKind: 'text-rise-up',
    visibility: 'draft',
    licenseType: 'Original Demo Specification',
    licenseNote: 'Original procedural specification created in Sowveil Studio.',
    sourceType: 'original-svg-css',
    supportedExportFormats: ['sowveil-json', 'alight-xml', 'zip-bundle', 'svg-frame'],
  });
  const [formValidationErrors, setFormValidationErrors] = useState<string[]>([]);

  // Assets state
  const [assets, setAssets] = useState<AssetMetadataRecord[]>([]);
  const [assetsStorageProvider, setAssetsStorageProvider] = useState<string>('none-configured');
  const [assetsStorageNote, setAssetsStorageNote] = useState<string>('');
  const [assetsQuery, setAssetsQuery] = useState('');
  const [showNewAssetModal, setShowNewAssetModal] = useState(false);
  const [newAssetForm, setNewAssetForm] = useState({
    title: '',
    moduleId: 'sfx' as ModuleId,
    assetKind: 'audio' as AssetKind,
    licenseType: 'Original Demo Specification' as AssetMetadataRecord['licenseType'],
    licenseNote: 'First-party procedural audio specification.',
    sourceNote: 'Generated in-browser via Web Audio API synthesizer.',
    mimeType: 'audio/wav',
  });

  // Modules state
  const [modulesList, setModulesList] = useState<ModuleDefinition[]>(SOWVEIL_MODULES);
  const [editingModuleId, setEditingModuleId] = useState<ModuleId | null>(null);
  const [modulePatchDraft, setModulePatchDraft] = useState<{
    label: string;
    shortLabel: string;
    description: string;
    displayOrder: number;
    enabled: boolean;
    icon: string;
    integrationAvailabilityMessage: string;
    confirmationReason: string;
  } | null>(null);

  // Users & Roles state
  const [usersList, setUsersList] = useState<SafeAdminUserRecord[]>([]);
  const [usersQuery, setUsersQuery] = useState('');
  const [roleUpdateReason, setRoleUpdateReason] = useState<Record<string, string>>({});

  // Jobs state
  const [adminJobs, setAdminJobs] = useState<JobRecord[]>([]);
  const [adminJobsStatusFilter, setAdminJobsStatusFilter] = useState<string>('all');
  const [adminJobsQuery, setAdminJobsQuery] = useState('');

  // Analytics state
  const [analyticsData, setAnalyticsData] = useState<AdminAnalyticsResponse | null>(null);

  // Settings & Editor Compatibility state
  const [platformSettings, setPlatformSettings] = useState<PlatformSettingsConfig | null>(null);
  const [editorsList, setEditorsList] = useState<MobileEditorAdapterDescriptor[]>([]);
  const [editingEditorId, setEditingEditorId] = useState<TargetMobileEditorId | null>(null);
  const [editorDraft, setEditorDraft] = useState<{
    compatibilityStatus: EditorCompatibilityStatus;
    verifiedFormats: ExportArtifactFormat[];
    testedVersions: string;
    honestCapabilitySummary: string;
    limitationsNote: string;
    docsUrl: string;
    verificationNote: string;
  } | null>(null);

  // Audit Log state
  const [auditEvents, setAuditEvents] = useState<AuditEventRecord[]>([]);
  const [auditQuery, setAuditQuery] = useState('');
  const [auditOutcomeFilter, setAuditOutcomeFilter] = useState<string>('all');
  const [auditTargetFilter, setAuditTargetFilter] = useState<string>('all');

  const getAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }, []);

  const fetchAdminDataForRoute = useCallback(async () => {
    setLoading(true);
    setErrorBanner(null);
    try {
      const headers = await getAuthHeaders();

      if (subroute === 'overview') {
        const res = await fetch(`/api/v1/admin/summary?range=${summaryRange}`, { headers });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Failed to load operational summary');
        }
        setSummaryData(json.data);
        if (json.data.catalog?.cacheVersion) setCacheVersion(json.data.catalog.cacheVersion);
      } else if (
        subroute === 'catalog' ||
        subroute === 'catalog-new' ||
        subroute === 'catalog-edit'
      ) {
        const res = await fetch('/api/v1/catalog?visibility=all&limit=100', { headers });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Failed to load catalog entries');
        }
        const items: CatalogItem[] = json.data.items || [];
        setCatalogItems(items);
        if (json.data.cacheVersion) setCacheVersion(json.data.cacheVersion);

        if (subroute === 'catalog-edit' && resolvedCatalogItemId) {
          const existing = items.find((i) => i.id === resolvedCatalogItemId);
          if (existing) {
            setFormItem({
              id: existing.id,
              moduleId: existing.moduleId,
              categoryId: existing.categoryId,
              name: existing.name,
              slug: existing.slug,
              packLabel: existing.packLabel,
              summary: existing.summary,
              description: existing.description,
              tagsCsv: existing.tags.join(', '),
              status: existing.status,
              statusReason: existing.statusReason,
              capabilityType: existing.capabilityType,
              assetKind: existing.assetKind,
              previewKind: existing.previewKind,
              visibility: existing.visibility,
              licenseType: existing.licenseType,
              licenseNote: existing.licenseNote,
              sourceType: existing.sourceType,
              supportedExportFormats: existing.supportedExportFormats || [
                'sowveil-json',
                'alight-xml',
              ],
            });
          }
        }
      } else if (subroute === 'assets') {
        const res = await fetch('/api/v1/admin/assets', { headers });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Failed to load asset registry');
        }
        setAssets(json.data.items || []);
        setAssetsStorageProvider(json.data.storageProvider || 'none-configured');
        setAssetsStorageNote(json.data.storageProviderNote || '');
      } else if (subroute === 'modules') {
        const res = await fetch('/api/v1/admin/modules', { headers });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Failed to load modules configuration');
        }
        setModulesList(json.data.items || SOWVEIL_MODULES);
      } else if (subroute === 'users' || subroute === 'roles') {
        const res = await fetch('/api/v1/admin/users', { headers });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Failed to load users directory');
        }
        setUsersList(json.data.items || []);
      } else if (subroute === 'jobs') {
        const res = await fetch('/api/v1/admin/jobs', { headers });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Failed to load admin job queue');
        }
        setAdminJobs(json.data.items || []);
      } else if (subroute === 'analytics') {
        const res = await fetch('/api/v1/admin/analytics', { headers });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Failed to load operational analytics');
        }
        setAnalyticsData(json.data);
      } else if (subroute === 'settings') {
        const [settingsRes, editorsRes] = await Promise.all([
          fetch('/api/v1/admin/settings', { headers }),
          fetch('/api/v1/admin/editors', { headers }),
        ]);
        const settingsJson = await settingsRes.json();
        const editorsJson = await editorsRes.json();
        if (!settingsRes.ok || !settingsJson.ok) {
          throw new Error(settingsJson.error?.message || 'Failed to load platform settings');
        }
        setPlatformSettings(settingsJson.data.settings || settingsJson.data);
        if (editorsRes.ok && editorsJson.ok) {
          setEditorsList(editorsJson.data.items || []);
        }
      } else if (subroute === 'audit') {
        const res = await fetch('/api/v1/admin/audit-events', { headers });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error?.message || 'Failed to load append-only audit log');
        }
        setAuditEvents(json.data.items || []);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Admin request failed');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, resolvedCatalogItemId, subroute, summaryRange]);

  useEffect(() => {
    fetchAdminDataForRoute();
  }, [fetchAdminDataForRoute]);

  // Filtered Catalog Items + Pagination
  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return catalogItems.filter((item) => {
      if (catalogModuleFilter !== 'all' && item.moduleId !== catalogModuleFilter) return false;
      if (catalogVisibilityFilter !== 'all' && item.visibility !== catalogVisibilityFilter)
        return false;
      if (catalogCapabilityFilter !== 'all' && item.status !== catalogCapabilityFilter)
        return false;
      if (q) {
        return (
          item.name.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q) ||
          item.packLabel.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [
    catalogCapabilityFilter,
    catalogItems,
    catalogModuleFilter,
    catalogQuery,
    catalogVisibilityFilter,
  ]);

  const PAGE_SIZE = 12;
  const totalCatalogPages = Math.max(1, Math.ceil(filteredCatalog.length / PAGE_SIZE));
  const paginatedCatalog = useMemo(() => {
    const start = (catalogPage - 1) * PAGE_SIZE;
    return filteredCatalog.slice(start, start + PAGE_SIZE);
  }, [catalogPage, filteredCatalog]);

  // Live Preview Item for Catalog Create/Edit
  const livePreviewItem = useMemo<CatalogItem>(
    () => ({
      id: formItem.id || 'preview-draft-item',
      moduleId: formItem.moduleId,
      name: formItem.name || 'Untitled Preset',
      slug: formItem.slug || 'untitled-preset',
      summary: formItem.summary || 'Live schema-validated preview.',
      description: formItem.description || 'Live schema-validated description.',
      tags: formItem.tagsCsv
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      categoryId: formItem.categoryId || 'default',
      packLabel: formItem.packLabel || 'Draft Pack',
      assetKind: formItem.assetKind,
      capabilityType: formItem.capabilityType,
      previewKind: formItem.previewKind,
      metadata: {
        width: 1080,
        height: 1920,
        durationSec: 3,
        durationLabel: '3.0s',
        fps: 60,
        version: '1.0.0',
      },
      primaryActionLabel: 'Export to Mobile Editor',
      supportedOperations: ['applyTextAnimation'],
      supportedExportFormats: formItem.supportedExportFormats,
      requiredHostCapabilities: [],
      requiredDependencies: [],
      selectionRequirement: 'None (Mobile PWA)',
      status: formItem.status,
      statusReason: formItem.statusReason,
      licenseType: formItem.licenseType,
      licenseNote: formItem.licenseNote,
      sourceType: formItem.sourceType,
      visibility: formItem.visibility,
      supportsTemplateComparison: true,
      editableParams: [
        {
          key: 'previewText',
          label: 'Preview Text',
          type: 'text',
          defaultValue: formItem.name || 'Make it move',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    [formItem]
  );

  const handleSaveCatalogItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormValidationErrors([]);

    const tags = formItem.tagsCsv
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const basePayload = {
      moduleId: formItem.moduleId,
      name: formItem.name.trim(),
      slug:
        formItem.slug.trim() ||
        formItem.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-'),
      summary: formItem.summary.trim(),
      description: formItem.description.trim() || formItem.summary.trim(),
      categoryId: formItem.categoryId.trim(),
      packLabel: formItem.packLabel.trim(),
      tags,
      assetKind: formItem.assetKind,
      capabilityType: formItem.capabilityType,
      previewKind: formItem.previewKind,
      status: formItem.status,
      statusReason: formItem.statusReason.trim(),
      licenseType: formItem.licenseType,
      licenseNote: formItem.licenseNote.trim(),
      sourceType: formItem.sourceType,
      visibility: formItem.visibility,
      supportedExportFormats: formItem.supportedExportFormats,
    };

    const payload =
      subroute === 'catalog-new'
        ? { ...basePayload, id: formItem.id.trim() }
        : basePayload;

    const schema = subroute === 'catalog-new' ? CatalogCreateSchema : CatalogPatchSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const errs = parsed.error.issues.map(
        (iss) => `${iss.path.join('.') || 'field'}: ${iss.message}`
      );
      setFormValidationErrors(errs);
      onNotify('Catalog item failed client/server Zod schema validation.', 'error');
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const url =
        subroute === 'catalog-new'
          ? '/api/v1/catalog'
          : `/api/v1/catalog/${encodeURIComponent(resolvedCatalogItemId || formItem.id)}`;
      const method = subroute === 'catalog-new' ? 'POST' : 'PATCH';

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Failed to save catalog item', 'error');
        return;
      }

      const nextVer = Number(res.headers.get('x-catalog-cache-version') || cacheVersion + 1);
      setCacheVersion(nextVer);
      onNotify(
        subroute === 'catalog-new'
          ? `Created catalog item "${json.data.name}" and invalidated catalog cache (v${nextVer}).`
          : `Updated catalog item "${json.data.name}" (cache v${nextVer}).`,
        'success'
      );
      navigate('/admin/catalog');
    } catch (err) {
      onNotify(
        `Catalog save failed: ${err instanceof Error ? err.message : 'Error'}`,
        'error'
      );
    }
  };

  const handleQuickVisibilityChange = async (
    item: CatalogItem,
    nextVisibility: 'published' | 'draft' | 'archived'
  ) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/catalog/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ visibility: nextVisibility }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Failed to change visibility', 'error');
        return;
      }
      setCatalogItems((prev) => prev.map((i) => (i.id === item.id ? json.data : i)));
      const nextVer = Number(res.headers.get('x-catalog-cache-version') || cacheVersion + 1);
      setCacheVersion(nextVer);
      onNotify(
        `Changed "${item.name}" visibility to ${nextVisibility} (cache v${nextVer}).`,
        'success'
      );
    } catch (err) {
      onNotify(
        `Visibility update failed: ${err instanceof Error ? err.message : 'Error'}`,
        'error'
      );
    }
  };

  const handleConfirmSoftDeleteCatalog = async (id: string) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/catalog/${encodeURIComponent(id)}?confirm=true`, {
        method: 'DELETE',
        headers,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Soft-delete failed', 'error');
        return;
      }
      setCatalogItems((prev) =>
        prev.map((i) => (i.id === id ? json.data.item : i))
      );
      setConfirmDeleteItemId(null);
      if (json.data.cacheVersion) setCacheVersion(json.data.cacheVersion);
      onNotify(
        `Archived "${json.data.item.name}". Existing user favorites/projects preserve safe references.`,
        'info'
      );
    } catch (err) {
      onNotify(`Delete failed: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  };

  const handleCreateAssetRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = AssetMetadataCreateSchema.safeParse(newAssetForm);
    if (!parsed.success) {
      onNotify(parsed.error.issues[0]?.message || 'Invalid asset metadata', 'error');
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/v1/admin/assets', {
        method: 'POST',
        headers,
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Failed to register asset metadata', 'error');
        return;
      }
      setAssets((prev) => [json.data, ...prev]);
      setShowNewAssetModal(false);
      onNotify(`Registered asset metadata "${json.data.title}" in audit log.`, 'success');
    } catch (err) {
      onNotify(`Asset creation failed: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  };

  const handleSaveModuleConfig = async (moduleId: ModuleId) => {
    if (!modulePatchDraft) return;
    const parsed = ModuleAdminPatchSchema.safeParse({
      label: modulePatchDraft.label.trim(),
      ...(modulePatchDraft.shortLabel.trim()
        ? { shortLabel: modulePatchDraft.shortLabel.trim() }
        : {}),
      description: modulePatchDraft.description.trim(),
      displayOrder: Number(modulePatchDraft.displayOrder),
      enabled: modulePatchDraft.enabled,
      icon: modulePatchDraft.icon.trim(),
      integrationAvailabilityMessage: modulePatchDraft.integrationAvailabilityMessage.trim(),
      ...(modulePatchDraft.confirmationReason.trim()
        ? { confirmationReason: modulePatchDraft.confirmationReason.trim() }
        : {}),
    });

    if (!parsed.success) {
      onNotify(
        parsed.error.issues[0]?.message || 'Module configuration validation failed',
        'error'
      );
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/admin/modules/${encodeURIComponent(moduleId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Module update rejected', 'error');
        return;
      }
      setModulesList((prev) =>
        prev
          .map((m) => (m.id === moduleId ? json.data : m))
          .sort((a, b) => a.displayOrder - b.displayOrder)
      );
      setEditingModuleId(null);
      setModulePatchDraft(null);
      onNotify(`Updated module "${json.data.label}" and logged audit event.`, 'success');
    } catch (err) {
      onNotify(`Module save failed: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  };

  const handleAttemptDeleteModule = async (moduleId: ModuleId) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/admin/modules/${encodeURIComponent(moduleId)}`, {
        method: 'DELETE',
        headers,
      });
      const json = await res.json();
      onNotify(
        json.error?.message || 'Required modules cannot be deleted from Sowveil Studio.',
        'warning'
      );
    } catch {
      onNotify('Required modules cannot be deleted.', 'warning');
    }
  };

  const handleChangeUserStatus = async (
    targetUid: string,
    nextStatus: 'active' | 'suspended'
  ) => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(targetUid)}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: nextStatus,
          reason:
            nextStatus === 'suspended'
              ? 'Suspended via Admin Users Console'
              : 'Reactivated via Admin Users Console',
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'User status change rejected', 'error');
        return;
      }
      setUsersList((prev) =>
        prev.map((u) => (u.uid === targetUid ? { ...u, status: json.data.status } : u))
      );
      onNotify(`Updated user ${targetUid} status to ${nextStatus}.`, 'success');
    } catch (err) {
      onNotify(`Status update failed: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  };

  const handleAssignUserRole = async (targetUid: string, nextRole: UserRole) => {
    const reason =
      (roleUpdateReason[targetUid] || '').trim() ||
      `Role updated to ${nextRole} via Admin Role Policy Console`;
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/admin/users/${encodeURIComponent(targetUid)}/role`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ role: nextRole, reason }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Role assignment blocked by server policy', 'error');
        return;
      }
      setUsersList((prev) =>
        prev.map((u) => (u.uid === targetUid ? { ...u, role: json.data.role } : u))
      );
      onNotify(`Assigned role "${nextRole}" to ${targetUid} and wrote audit record.`, 'success');
    } catch (err) {
      onNotify(`Role assignment failed: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  };

  const handleSavePlatformSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platformSettings) return;
    const parsed = PlatformSettingsPatchSchema.safeParse({
      exportMaxSizeMb: Number(platformSettings.exportMaxSizeMb),
      userDailyExportQuota: Number(platformSettings.userDailyExportQuota),
      jobRetentionDays: Number(platformSettings.jobRetentionDays),
      archivedCatalogRetentionDays: Number(platformSettings.archivedCatalogRetentionDays),
      allowPublicCatalogBrowsing: platformSettings.allowPublicCatalogBrowsing,
      enableAlightMotionXmlExport: platformSettings.enableAlightMotionXmlExport,
      enableUniversalZipBundles: platformSettings.enableUniversalZipBundles,
      enableWebShareHandoff: platformSettings.enableWebShareHandoff,
      maintenanceBannerText: platformSettings.maintenanceBannerText,
      integrationStatusHeadline: platformSettings.integrationStatusHeadline,
    });
    if (!parsed.success) {
      onNotify(parsed.error.issues[0]?.message || 'Settings validation failed', 'error');
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/v1/admin/settings', {
        method: 'PATCH',
        headers,
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Failed to update settings', 'error');
        return;
      }
      setPlatformSettings(json.data.settings || json.data);
      onNotify('Saved platform configuration and recorded audit event.', 'success');
    } catch (err) {
      onNotify(`Settings save failed: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  };

  const handleSaveEditorCompatibility = async (editorId: TargetMobileEditorId) => {
    if (!editorDraft) return;
    const payload = {
      compatibilityStatus: editorDraft.compatibilityStatus,
      verifiedFormats: editorDraft.verifiedFormats,
      testedVersions: editorDraft.testedVersions.trim(),
      honestCapabilitySummary: editorDraft.honestCapabilitySummary.trim(),
      limitationsNote: editorDraft.limitationsNote.trim(),
      ...(editorDraft.docsUrl.trim().startsWith('http')
        ? { docsUrl: editorDraft.docsUrl.trim() }
        : {}),
      verificationNote: editorDraft.verificationNote.trim(),
    };

    const parsed = EditorAdapterAdminPatchSchema.safeParse(payload);
    if (!parsed.success) {
      onNotify(
        parsed.error.issues[0]?.message || 'Editor compatibility validation failed',
        'error'
      );
      return;
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/admin/editors/${encodeURIComponent(editorId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(parsed.data),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        onNotify(json.error?.message || 'Editor compatibility update rejected', 'error');
        return;
      }
      setEditorsList((prev) =>
        prev.map((ed) => (ed.id === editorId ? json.data : ed))
      );
      setEditingEditorId(null);
      setEditorDraft(null);
      onNotify(
        `Updated "${json.data.name}" compatibility status to ${json.data.compatibilityStatus}.`,
        'success'
      );
    } catch (err) {
      onNotify(`Editor update failed: ${err instanceof Error ? err.message : 'Error'}`, 'error');
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-7xl mx-auto space-y-5">
      {/* Mobile-First Admin Header */}
      <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono-tabular text-[#F06424]">
              <ShieldCheck className="w-4 h-4" />
              <span>SERVER-AUTHORIZED ADMIN CONSOLE · ROLE: {role.toUpperCase()}</span>
              <span className="text-[#83766D]">· CACHE v{cacheVersion}</span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-[#F3EEE8] mt-1">
              Sowveil Studio Operations & Governance
            </h1>
            <p className="text-xs text-[#B8AAA0] mt-0.5">
              Every mutation is verified server-side against Firebase ID tokens and recorded in the append-only audit log.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchAdminDataForRoute}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-xs font-medium text-[#F3EEE8]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#F06424]' : ''}`} />
              <span>Refresh</span>
            </button>
            <Link
              to="/technical"
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#83766D] text-xs font-medium text-[#B8AAA0]"
            >
              <Smartphone className="w-3.5 h-3.5 text-[#55B98B]" />
              <span>/technical</span>
            </Link>
          </div>
        </div>

        {/* Horizontal Touch-Friendly Scrollable Admin Navigation Strip */}
        <nav
          aria-label="Admin Console Sections"
          className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar border-t border-[#342A24] pt-3"
        >
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              subroute === item.id ||
              (item.id === 'catalog' &&
                (subroute === 'catalog-new' || subroute === 'catalog-edit'));
            return (
              <Link
                key={item.id}
                to={item.path}
                className={`min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? 'bg-[#F06424] text-[#080707] font-semibold'
                    : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24] hover:text-[#F3EEE8]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {errorBanner && (
        <div
          role="alert"
          className="rounded-xl border border-[#F06464]/50 bg-[#F06464]/10 p-4 flex items-center justify-between gap-3 text-xs text-[#F06464]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={fetchAdminDataForRoute}
            className="px-3 py-1.5 rounded-lg border border-[#F06464]/40 bg-[#11100F] text-[#F3EEE8] font-semibold"
          >
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-6 flex items-center justify-center gap-2.5 text-xs font-mono-tabular text-[#B8AAA0]">
          <Loader2 className="w-4 h-4 animate-spin text-[#F06424]" />
          <span>Loading server-authorized admin telemetry…</span>
        </div>
      )}

      {/* 1. /admin — Operational Summary */}
      {!loading && subroute === 'overview' && summaryData && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#F3EEE8]">
                Operational Summary ({summaryData.range.toUpperCase()} Window)
              </h2>
              <p className="text-xs text-[#B8AAA0]">
                Real persisted server counts. Snapshot generated at {summaryData.generatedAt}.
              </p>
            </div>
            <div className="flex items-center gap-1.5" role="group" aria-label="Date range filter">
              {(['24h', '7d', '30d', 'all'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSummaryRange(r)}
                  className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-mono-tabular ${
                    summaryRange === r
                      ? 'bg-[#F06424] text-[#080707] font-semibold'
                      : 'bg-[#191614] text-[#B8AAA0] border border-[#342A24]'
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
              <div className="text-xs font-mono-tabular text-[#83766D]">CATALOG ITEMS</div>
              <div className="text-2xl font-bold font-mono-tabular text-[#F3EEE8]">
                {summaryData.catalog.published}{' '}
                <span className="text-xs font-normal text-[#55B98B]">published</span>
              </div>
              <div className="text-xs font-mono-tabular text-[#B8AAA0]">
                {summaryData.catalog.draft} draft · {summaryData.catalog.archived} archived
              </div>
            </div>

            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
              <div className="text-xs font-mono-tabular text-[#83766D]">CREATIVE MODULES</div>
              <div className="text-2xl font-bold font-mono-tabular text-[#55B98B]">
                {summaryData.modules.enabled} / {summaryData.modules.total}
              </div>
              <div className="text-xs text-[#B8AAA0]">
                Required 20-module registry protected
              </div>
            </div>

            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
              <div className="text-xs font-mono-tabular text-[#83766D]">USERS & ADMINS</div>
              <div className="text-2xl font-bold font-mono-tabular text-[#F3EEE8]">
                {summaryData.users.active} active
              </div>
              <div className="text-xs font-mono-tabular text-[#B8AAA0]">
                {summaryData.users.owners} owner · {summaryData.users.admins} admin
              </div>
            </div>

            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
              <div className="text-xs font-mono-tabular text-[#83766D]">
                AUDIT & JOBS ({summaryData.range.toUpperCase()})
              </div>
              <div className="text-2xl font-bold font-mono-tabular text-[#E4B45A]">
                {summaryData.auditCountInRange} events
              </div>
              <div className="text-xs font-mono-tabular text-[#B8AAA0]">
                {summaryData.jobs.totalInRange} jobs ({summaryData.jobs.failed} failed)
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1.5">
              <div className="font-mono-tabular text-[#83766D]">BINARY STORAGE PROVIDER</div>
              <div className="font-semibold text-[#E4B45A]">
                {summaryData.assets.storageProvider} ({summaryData.assets.metadataOnly} metadata-only records)
              </div>
              <p className="text-[#B8AAA0]">
                Assets registry stores verified license/ownership metadata without fabricating mock storage URLs.
              </p>
            </div>
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1.5">
              <div className="font-mono-tabular text-[#83766D]">RECENT AUDIT EVENTS</div>
              <div className="font-semibold text-[#55B98B]">
                {summaryData.recentAuditEvents.length} recent entries in window
              </div>
              <Link to="/admin/audit" className="inline-block text-[#F06424] hover:underline">
                Open append-only audit log →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 2. /admin/catalog — Search, Filters, Pagination, Publish/Archive */}
      {!loading && subroute === 'catalog' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#F3EEE8]">
                Catalog Registry ({filteredCatalog.length} matching of {catalogItems.length} total)
              </h2>
              <p className="text-xs text-[#B8AAA0]">
                Filter across all 20 modules by visibility (`published`, `draft`, `archived`) and capability status.
              </p>
            </div>
            <Link
              to="/admin/catalog/new"
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>New Catalog Preset</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={catalogQuery}
                onChange={(e) => {
                  setCatalogQuery(e.target.value);
                  setCatalogPage(1);
                }}
                placeholder="Search name, ID, pack, tag…"
                className="w-full min-h-[44px] rounded-xl border border-[#342A24] bg-[#11100F] pl-8 pr-3 py-2 text-xs text-[#F3EEE8]"
              />
            </div>

            <select
              aria-label="Filter catalog by module"
              value={catalogModuleFilter}
              onChange={(e) => {
                setCatalogModuleFilter(e.target.value);
                setCatalogPage(1);
              }}
              className="min-h-[44px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
            >
              <option value="all">All 20 Modules ({catalogItems.length})</option>
              {SOWVEIL_MODULES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayOrder}. {m.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter catalog by visibility"
              value={catalogVisibilityFilter}
              onChange={(e) => {
                setCatalogVisibilityFilter(e.target.value);
                setCatalogPage(1);
              }}
              className="min-h-[44px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
            >
              <option value="all">All Visibilities</option>
              <option value="published">Published (Public)</option>
              <option value="draft">Draft (Admin Only)</option>
              <option value="archived">Archived (Soft-Deleted)</option>
            </select>

            <select
              aria-label="Filter catalog by capability"
              value={catalogCapabilityFilter}
              onChange={(e) => {
                setCatalogCapabilityFilter(e.target.value);
                setCatalogPage(1);
              }}
              className="min-h-[44px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
            >
              <option value="all">All Capability States</option>
              <option value="Available">Available</option>
              <option value="Needs setup">Needs setup</option>
              <option value="Unsupported">Unsupported</option>
            </select>
          </div>

          {paginatedCatalog.length === 0 ? (
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-8 text-center text-xs text-[#B8AAA0]">
              No catalog entries match the selected filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {paginatedCatalog.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular">
                      <span className="text-[#F06424]">
                        {item.moduleId} · {item.packLabel}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] ${
                            item.visibility === 'published'
                              ? 'bg-[#55B98B]/15 text-[#55B98B]'
                              : item.visibility === 'draft'
                              ? 'bg-[#E4B45A]/15 text-[#E4B45A]'
                              : 'bg-[#F06464]/15 text-[#F06464]'
                          }`}
                        >
                          {item.visibility}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-[#191614] border border-[#342A24] text-[#B8AAA0]">
                          {item.status}
                        </span>
                      </div>
                    </div>

                    <div className="font-bold text-sm text-[#F3EEE8]">{item.name}</div>
                    <p className="text-xs text-[#B8AAA0] line-clamp-2">{item.summary}</p>
                    <div className="text-[11px] font-mono-tabular text-[#83766D]">
                      ID: {item.id} · Preview: {item.previewKind} · Type: {item.capabilityType}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#342A24]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        to={`/admin/catalog/${encodeURIComponent(item.id)}`}
                        className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-xs text-[#F3EEE8]"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#F06424]" />
                        <span>Edit & Preview</span>
                      </Link>

                      {item.visibility !== 'published' && (
                        <button
                          type="button"
                          onClick={() => handleQuickVisibilityChange(item, 'published')}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#55B98B]/40 bg-[#55B98B]/10 text-xs text-[#55B98B]"
                        >
                          Publish
                        </button>
                      )}
                      {item.visibility !== 'draft' && (
                        <button
                          type="button"
                          onClick={() => handleQuickVisibilityChange(item, 'draft')}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#E4B45A]/40 bg-[#E4B45A]/10 text-xs text-[#E4B45A]"
                        >
                          Move to Draft
                        </button>
                      )}
                    </div>

                    {confirmDeleteItemId === item.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleConfirmSoftDeleteCatalog(item.id)}
                          className="min-h-[38px] px-2.5 py-1 rounded-lg bg-[#F06464] text-[#080707] font-semibold text-xs"
                        >
                          Confirm Archive
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteItemId(null)}
                          className="min-h-[38px] px-2.5 py-1 rounded-lg border border-[#342A24] text-xs text-[#B8AAA0]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      item.visibility !== 'archived' && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteItemId(item.id)}
                          className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F06464] text-xs text-[#F06464]"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>Archive</span>
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination Bar */}
          <div className="flex items-center justify-between pt-2 text-xs font-mono-tabular text-[#B8AAA0]">
            <span>
              Page {catalogPage} of {totalCatalogPages} ({filteredCatalog.length} items)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={catalogPage <= 1}
                onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                className="min-h-[40px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#11100F] disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>
              <button
                type="button"
                disabled={catalogPage >= totalCatalogPages}
                onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages, p + 1))}
                className="min-h-[40px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#11100F] disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. /admin/catalog/new & /admin/catalog/:id — Create/Edit with Schema Validation & Live Preview */}
      {!loading && (subroute === 'catalog-new' || subroute === 'catalog-edit') && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link
                to="/admin/catalog"
                className="inline-flex items-center gap-1 text-xs text-[#F06424] hover:underline"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Back to Admin Catalog</span>
              </Link>
              <h2 className="text-base font-bold text-[#F3EEE8] mt-1">
                {subroute === 'catalog-new'
                  ? 'Create New Catalog Entry (/admin/catalog/new)'
                  : `Edit Catalog Entry: ${resolvedCatalogItemId}`}
              </h2>
            </div>
          </div>

          {formValidationErrors.length > 0 && (
            <div className="rounded-xl border border-[#F06464] bg-[#F06464]/10 p-4 space-y-1 text-xs text-[#F06464]">
              <div className="font-bold">Zod Schema Validation Errors:</div>
              <ul className="list-disc pl-4 space-y-0.5">
                {formValidationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <form
              onSubmit={handleSaveCatalogItem}
              className="lg:col-span-7 rounded-2xl border border-[#342A24] bg-[#11100F] p-4 sm:p-5 space-y-4 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {subroute === 'catalog-new' && (
                  <label className="space-y-1">
                    <span className="text-[#B8AAA0] font-semibold">Preset ID *</span>
                    <input
                      type="text"
                      required
                      value={formItem.id}
                      onChange={(e) => setFormItem((p) => ({ ...p, id: e.target.value }))}
                      className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                    />
                  </label>
                )}

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">Preset Name *</span>
                  <input
                    type="text"
                    required
                    value={formItem.name}
                    onChange={(e) => setFormItem((p) => ({ ...p, name: e.target.value }))}
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">Module *</span>
                  <select
                    value={formItem.moduleId}
                    onChange={(e) =>
                      setFormItem((p) => ({ ...p, moduleId: e.target.value as ModuleId }))
                    }
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  >
                    {SOWVEIL_MODULES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayOrder}. {m.label} ({m.id})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">Category ID *</span>
                  <input
                    type="text"
                    required
                    value={formItem.categoryId}
                    onChange={(e) => setFormItem((p) => ({ ...p, categoryId: e.target.value }))}
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">Pack / Collection Label *</span>
                  <input
                    type="text"
                    required
                    value={formItem.packLabel}
                    onChange={(e) => setFormItem((p) => ({ ...p, packLabel: e.target.value }))}
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">Preview Engine Kind *</span>
                  <select
                    value={formItem.previewKind}
                    onChange={(e) =>
                      setFormItem((p) => ({
                        ...p,
                        previewKind: e.target.value as PreviewRenderKind,
                      }))
                    }
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  >
                    {ALL_PREVIEW_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">Visibility State *</span>
                  <select
                    value={formItem.visibility}
                    onChange={(e) =>
                      setFormItem((p) => ({
                        ...p,
                        visibility: e.target.value as 'published' | 'draft' | 'archived',
                      }))
                    }
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  >
                    <option value="draft">draft (Admin preview only)</option>
                    <option value="published">published (Live in workspace)</option>
                    <option value="archived">archived (Hidden, preserves references)</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">Capability Status *</span>
                  <select
                    value={formItem.status}
                    onChange={(e) =>
                      setFormItem((p) => ({
                        ...p,
                        status: e.target.value as CapabilityStatus,
                      }))
                    }
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  >
                    <option value="Available">Available</option>
                    <option value="Needs setup">Needs setup</option>
                    <option value="Unsupported">Unsupported</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">Capability Type *</span>
                  <select
                    value={formItem.capabilityType}
                    onChange={(e) =>
                      setFormItem((p) => ({
                        ...p,
                        capabilityType: e.target.value as CapabilityType,
                      }))
                    }
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  >
                    {ALL_CAPABILITY_TYPES.map((ct) => (
                      <option key={ct} value={ct}>
                        {ct}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-[#B8AAA0] font-semibold">Summary Description *</span>
                <textarea
                  rows={2}
                  required
                  value={formItem.summary}
                  onChange={(e) => setFormItem((p) => ({ ...p, summary: e.target.value }))}
                  className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[#B8AAA0] font-semibold">Tags (comma-separated) *</span>
                <input
                  type="text"
                  required
                  value={formItem.tagsCsv}
                  onChange={(e) => setFormItem((p) => ({ ...p, tagsCsv: e.target.value }))}
                  className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#342A24]">
                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">License Rights</span>
                  <select
                    value={formItem.licenseType}
                    onChange={(e) =>
                      setFormItem((p) => ({
                        ...p,
                        licenseType: e.target.value as typeof formItem.licenseType,
                      }))
                    }
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  >
                    <option value="Original Demo Specification">Original Demo Specification</option>
                    <option value="Reference Metadata Only">Reference Metadata Only</option>
                    <option value="User Owned">User Owned</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0] font-semibold">License / Source Note</span>
                  <input
                    type="text"
                    value={formItem.licenseNote}
                    onChange={(e) =>
                      setFormItem((p) => ({ ...p, licenseNote: e.target.value }))
                    }
                    className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                  />
                </label>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-[#342A24]">
                <span className="text-[#B8AAA0] font-semibold block">
                  Supported Mobile Export Formats
                </span>
                <div className="flex flex-wrap gap-2">
                  {ALL_EXPORT_FORMATS.map((fmt) => {
                    const checked = formItem.supportedExportFormats.includes(fmt);
                    return (
                      <label
                        key={fmt}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-mono-tabular cursor-pointer ${
                          checked
                            ? 'border-[#F06424] bg-[#F06424]/15 text-[#F3EEE8]'
                            : 'border-[#342A24] bg-[#191614] text-[#83766D]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setFormItem((p) => ({
                              ...p,
                              supportedExportFormats: e.target.checked
                                ? [...p.supportedExportFormats, fmt]
                                : p.supportedExportFormats.filter((f) => f !== fmt),
                            }));
                          }}
                          className="accent-[#F06424]"
                        />
                        <span>{fmt}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#342A24]">
                <Link
                  to="/admin/catalog"
                  className="min-h-[44px] inline-flex items-center px-4 py-2 rounded-xl border border-[#342A24] bg-[#191614] text-[#B8AAA0]"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  className="min-h-[44px] inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-[#F06424] hover:bg-[#FF4B24] text-[#080707] font-semibold"
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {subroute === 'catalog-new' ? 'Create & Validate Entry' : 'Save Changes'}
                  </span>
                </button>
              </div>
            </form>

            {/* Live Preview Surface */}
            <div className="lg:col-span-5 space-y-3">
              <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-mono-tabular">
                  <span className="text-[#55B98B] flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5" />
                    <span>LIVE SCHEMA PREVIEW</span>
                  </span>
                  <span className="text-[#83766D]">{livePreviewItem.previewKind}</span>
                </div>
                <div className="h-64 rounded-xl overflow-hidden border border-[#342A24] bg-[#080707]">
                  <PreviewRenderer
                    item={livePreviewItem}
                    comparisonMode="edits"
                    customValues={{ previewText: livePreviewItem.name }}
                  />
                </div>
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-[#F3EEE8]">{livePreviewItem.name}</div>
                  <p className="text-[#B8AAA0]">{livePreviewItem.summary}</p>
                  <div className="text-[11px] font-mono-tabular text-[#83766D] pt-1">
                    License: {livePreviewItem.licenseType} · Visibility: {livePreviewItem.visibility}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. /admin/assets — Asset Metadata, Rights & Storage Provider Honesty */}
      {!loading && subroute === 'assets' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#E4B45A]/40 bg-[#11100F] p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-mono-tabular text-[#E4B45A] flex items-center gap-1.5">
                <Database className="w-4 h-4" />
                <span>CONFIGURED BINARY STORAGE PROVIDER: {assetsStorageProvider.toUpperCase()}</span>
              </div>
              <p className="text-xs text-[#B8AAA0]">
                {assetsStorageNote ||
                  'Sowveil Studio never fabricates fake cloud bucket URLs. Assets registered here track verified ownership, license rights, and procedural or inline generator parameters.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewAssetModal((v) => !v)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#F06424] text-[#080707] font-semibold text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Register Asset Rights</span>
            </button>
          </div>

          {showNewAssetModal && (
            <form
              onSubmit={handleCreateAssetRecord}
              className="rounded-2xl border border-[#F06424]/50 bg-[#11100F] p-4 sm:p-5 space-y-3 text-xs"
            >
              <h3 className="font-bold text-sm text-[#F3EEE8]">
                Register Verified Asset Metadata & Rights
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-[#B8AAA0]">Asset Title *</span>
                  <input
                    type="text"
                    required
                    value={newAssetForm.title}
                    onChange={(e) => setNewAssetForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="e.g., Sub-Bass Impact Synthesizer"
                    className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0]">Module *</span>
                  <select
                    value={newAssetForm.moduleId}
                    onChange={(e) =>
                      setNewAssetForm((p) => ({ ...p, moduleId: e.target.value as ModuleId }))
                    }
                    className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                  >
                    {SOWVEIL_MODULES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0]">Asset Kind *</span>
                  <select
                    value={newAssetForm.assetKind}
                    onChange={(e) =>
                      setNewAssetForm((p) => ({
                        ...p,
                        assetKind: e.target.value as AssetKind,
                      }))
                    }
                    className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                  >
                    <option value="audio">audio</option>
                    <option value="svg">svg</option>
                    <option value="scene-spec">scene-spec</option>
                    <option value="expression">expression</option>
                    <option value="curve">curve</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0]">License Type *</span>
                  <select
                    value={newAssetForm.licenseType}
                    onChange={(e) =>
                      setNewAssetForm((p) => ({
                        ...p,
                        licenseType: e.target.value as AssetMetadataRecord['licenseType'],
                      }))
                    }
                    className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                  >
                    <option value="Original Demo Specification">Original Demo Specification</option>
                    <option value="Reference Metadata Only">Reference Metadata Only</option>
                    <option value="User Owned">User Owned</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0]">License Note *</span>
                  <input
                    type="text"
                    required
                    value={newAssetForm.licenseNote}
                    onChange={(e) =>
                      setNewAssetForm((p) => ({ ...p, licenseNote: e.target.value }))
                    }
                    className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[#B8AAA0]">Source Attribution *</span>
                  <input
                    type="text"
                    required
                    value={newAssetForm.sourceNote}
                    onChange={(e) =>
                      setNewAssetForm((p) => ({ ...p, sourceNote: e.target.value }))
                    }
                    className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                  />
                </label>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewAssetModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-[#342A24] text-[#B8AAA0]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-[#F06424] text-[#080707] font-semibold"
                >
                  Save Asset Metadata
                </button>
              </div>
            </form>
          )}

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={assetsQuery}
              onChange={(e) => setAssetsQuery(e.target.value)}
              placeholder="Filter assets by title, license, or source note…"
              className="w-full min-h-[44px] rounded-xl border border-[#342A24] bg-[#11100F] pl-8 pr-3 py-2 text-xs text-[#F3EEE8]"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {assets
              .filter((a) => {
                const q = assetsQuery.trim().toLowerCase();
                if (!q) return true;
                return (
                  a.title.toLowerCase().includes(q) ||
                  a.licenseType.toLowerCase().includes(q) ||
                  a.sourceNote.toLowerCase().includes(q)
                );
              })
              .map((asset) => (
                <div
                  key={asset.id}
                  className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between font-mono-tabular">
                    <span className="text-[#F06424]">
                      {asset.moduleId} · {asset.assetKind}
                    </span>
                    <span className="text-[#55B98B]">{asset.status}</span>
                  </div>
                  <div className="font-bold text-sm text-[#F3EEE8]">{asset.title}</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-[#B8AAA0] pt-1">
                    <div>
                      <span className="text-[#83766D] block">LICENSE TYPE</span>
                      <span>{asset.licenseType}</span>
                    </div>
                    <div>
                      <span className="text-[#83766D] block">STORAGE PROVIDER</span>
                      <span className="font-mono-tabular text-[#E4B45A]">
                        {asset.storageProvider}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-[#83766D] block">SOURCE & RIGHTS NOTE</span>
                      <span>
                        {asset.licenseNote} · {asset.sourceNote}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 5. /admin/modules — Manage 20 Required Modules (No Deletion Allowed; Disable Requires Confirmation Reason) */}
      {!loading && subroute === 'modules' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
            <h2 className="text-base font-bold text-[#F3EEE8]">
              20-Module Registry & Capability Configuration (/admin/modules)
            </h2>
            <p className="text-xs text-[#B8AAA0]">
              All 20 modules are core architectural pillars and cannot be deleted (<code className="text-[#F3EEE8]">403 REQUIRED_MODULE_DELETION_FORBIDDEN</code>). Disabling a module requires an explicit confirmation reason and writes an immutable audit event.
            </p>
          </div>

          <div className="space-y-3">
            {modulesList.map((mod) => {
              const isEditing = editingModuleId === mod.id;
              return (
                <div
                  key={mod.id}
                  className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#191614] border border-[#342A24] font-mono-tabular text-[#F06424]">
                        #{mod.displayOrder}
                      </span>
                      <span className="font-bold text-sm text-[#F3EEE8]">{mod.label}</span>
                      <span className="font-mono-tabular text-[#83766D]">({mod.route})</span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono-tabular text-[11px] ${
                          mod.enabled
                            ? 'bg-[#55B98B]/15 text-[#55B98B]'
                            : 'bg-[#F06464]/15 text-[#F06464]'
                        }`}
                      >
                        {mod.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingModuleId(null);
                            setModulePatchDraft(null);
                          } else {
                            setEditingModuleId(mod.id);
                            setModulePatchDraft({
                              label: mod.label,
                              shortLabel: mod.shortLabel || mod.label,
                              description: mod.description,
                              displayOrder: mod.displayOrder,
                              enabled: mod.enabled,
                              icon: mod.icon,
                              integrationAvailabilityMessage:
                                mod.integrationAvailabilityMessage ||
                                'Mobile browser preview & Editor Gateway export ready',
                              confirmationReason: '',
                            });
                          }
                        }}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] hover:border-[#F06424] text-[#F3EEE8]"
                      >
                        {isEditing ? 'Close Editor' : 'Configure Module'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleAttemptDeleteModule(mod.id)}
                        title="Required modules cannot be deleted"
                        className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#342A24] bg-[#191614] text-[#83766D] hover:text-[#F06464]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Protected</span>
                      </button>
                    </div>
                  </div>

                  <p className="text-[#B8AAA0]">{mod.description}</p>
                  <div className="text-[11px] font-mono-tabular text-[#83766D]">
                    Capability Type: <span className="text-[#F3EEE8]">{mod.capabilityType}</span> · Availability Message:{' '}
                    <span className="text-[#55B98B]">
                      {mod.integrationAvailabilityMessage || 'Mobile Editor Gateway Ready'}
                    </span>
                  </div>

                  {isEditing && modulePatchDraft && (
                    <div className="rounded-xl border border-[#F06424]/40 bg-[#191614] p-4 space-y-3 pt-3">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="space-y-1">
                          <span className="text-[#B8AAA0]">Display Label</span>
                          <input
                            type="text"
                            value={modulePatchDraft.label}
                            onChange={(e) =>
                              setModulePatchDraft((p) =>
                                p ? { ...p, label: e.target.value } : p
                              )
                            }
                            className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-1.5 text-[#F3EEE8]"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[#B8AAA0]">Short Label (Mobile Pill)</span>
                          <input
                            type="text"
                            value={modulePatchDraft.shortLabel}
                            onChange={(e) =>
                              setModulePatchDraft((p) =>
                                p ? { ...p, shortLabel: e.target.value } : p
                              )
                            }
                            className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-1.5 text-[#F3EEE8]"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[#B8AAA0]">Navigation Order (1–20)</span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={modulePatchDraft.displayOrder}
                            onChange={(e) =>
                              setModulePatchDraft((p) =>
                                p ? { ...p, displayOrder: Number(e.target.value) } : p
                              )
                            }
                            className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-1.5 text-[#F3EEE8]"
                          />
                        </label>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="space-y-1">
                          <span className="text-[#B8AAA0]">Icon Identifier</span>
                          <input
                            type="text"
                            value={modulePatchDraft.icon}
                            onChange={(e) =>
                              setModulePatchDraft((p) =>
                                p ? { ...p, icon: e.target.value } : p
                              )
                            }
                            className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-1.5 text-[#F3EEE8]"
                          />
                        </label>

                        <label className="space-y-1">
                          <span className="text-[#B8AAA0]">Integration Availability Message</span>
                          <input
                            type="text"
                            value={modulePatchDraft.integrationAvailabilityMessage}
                            onChange={(e) =>
                              setModulePatchDraft((p) =>
                                p
                                  ? {
                                      ...p,
                                      integrationAvailabilityMessage: e.target.value,
                                    }
                                  : p
                              )
                            }
                            className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-1.5 text-[#F3EEE8]"
                          />
                        </label>
                      </div>

                      <label className="block space-y-1">
                        <span className="text-[#B8AAA0]">Module Description</span>
                        <input
                          type="text"
                          value={modulePatchDraft.description}
                          onChange={(e) =>
                            setModulePatchDraft((p) =>
                              p ? { ...p, description: e.target.value } : p
                            )
                          }
                          className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#11100F] px-3 py-1.5 text-[#F3EEE8]"
                        />
                      </label>

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#342A24]">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={modulePatchDraft.enabled}
                            onChange={(e) =>
                              setModulePatchDraft((p) =>
                                p ? { ...p, enabled: e.target.checked } : p
                              )
                            }
                            className="accent-[#F06424] w-4 h-4"
                          />
                          <span className="font-semibold text-[#F3EEE8]">
                            Module Enabled in Workspace
                          </span>
                        </label>

                        {!modulePatchDraft.enabled && (
                          <input
                            type="text"
                            required
                            value={modulePatchDraft.confirmationReason}
                            onChange={(e) =>
                              setModulePatchDraft((p) =>
                                p ? { ...p, confirmationReason: e.target.value } : p
                              )
                            }
                            placeholder="Required audit reason for disabling module (min 5 chars)…"
                            className="flex-1 min-w-[240px] min-h-[40px] rounded-lg border border-[#F06464] bg-[#11100F] px-3 py-1.5 text-[#F3EEE8]"
                          />
                        )}

                        <button
                          type="button"
                          onClick={() => handleSaveModuleConfig(mod.id)}
                          className="min-h-[40px] px-4 py-1.5 rounded-lg bg-[#F06424] text-[#080707] font-semibold"
                        >
                          Save Module & Audit
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. /admin/users — Safe User Directory (Masked Emails, No Secrets/Tokens) */}
      {!loading && subroute === 'users' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
            <h2 className="text-base font-bold text-[#F3EEE8]">
              User Directory & Account Status (/admin/users)
            </h2>
            <p className="text-xs text-[#B8AAA0]">
              Exposes only safe operational metadata (masked email, role, account status, creation timestamp). Auth tokens, passwords, and private user project files are never returned.
            </p>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={usersQuery}
              onChange={(e) => setUsersQuery(e.target.value)}
              placeholder="Search users by UID, display name, masked email, or role…"
              className="w-full min-h-[44px] rounded-xl border border-[#342A24] bg-[#11100F] pl-8 pr-3 py-2 text-xs text-[#F3EEE8]"
            />
          </div>

          <div className="space-y-2.5">
            {usersList
              .filter((u) => {
                const q = usersQuery.trim().toLowerCase();
                if (!q) return true;
                return (
                  u.uid.toLowerCase().includes(q) ||
                  u.displayName.toLowerCase().includes(q) ||
                  u.emailMasked.toLowerCase().includes(q) ||
                  u.role.toLowerCase().includes(q)
                );
              })
              .map((u) => (
                <div
                  key={u.uid}
                  className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#F3EEE8]">{u.displayName}</span>
                      <span className="px-2 py-0.5 rounded font-mono-tabular uppercase bg-[#F06424]/15 text-[#F06424]">
                        {u.role}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-mono-tabular ${
                          u.status === 'active'
                            ? 'bg-[#55B98B]/15 text-[#55B98B]'
                            : 'bg-[#F06464]/15 text-[#F06464]'
                        }`}
                      >
                        {u.status}
                      </span>
                    </div>
                    <div className="font-mono-tabular text-[#B8AAA0]">
                      UID: {u.uid} · Email: {u.emailMasked} · Verified:{' '}
                      {u.emailVerified ? 'Yes' : 'No'}
                    </div>
                    <div className="font-mono-tabular text-[11px] text-[#83766D]">
                      Created: {u.createdAt} · Updated: {u.updatedAt}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {u.status === 'active' ? (
                      <button
                        type="button"
                        onClick={() => handleChangeUserStatus(u.uid, 'suspended')}
                        className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#F06464]/40 bg-[#F06464]/10 text-[#F06464] font-semibold"
                      >
                        Suspend Account
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleChangeUserStatus(u.uid, 'active')}
                        className="min-h-[40px] px-3 py-1.5 rounded-lg border border-[#55B98B]/40 bg-[#55B98B]/10 text-[#55B98B] font-semibold"
                      >
                        Reactivate Account
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 7. /admin/roles — Role Assignment with Self-Escalation & Last-Owner Lockout Protection */}
      {!loading && subroute === 'roles' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2">
            <h2 className="text-base font-bold text-[#F3EEE8]">
              Role Governance & Privilege Policy (/admin/roles)
            </h2>
            <ul className="text-xs text-[#B8AAA0] space-y-1 list-disc pl-4">
              <li>
                <strong className="text-[#F3EEE8]">Self-Escalation Blocked:</strong> No user may elevate their own role via client UI or direct API call (<code className="text-[#F06464]">SELF_ROLE_ESCALATION_FORBIDDEN</code>).
              </li>
              <li>
                <strong className="text-[#F3EEE8]">Owner Grant Restriction:</strong> Only an existing <code className="text-[#F06424]">owner</code> can assign or revoke the <code className="text-[#F06424]">owner</code> role (<code className="text-[#F06464]">ONLY_OWNER_CAN_GRANT_OWNER</code>).
              </li>
              <li>
                <strong className="text-[#F3EEE8]">Last-Owner Lockout Protection:</strong> The server refuses any request that would demote or suspend the last active owner (<code className="text-[#F06464]">409 LAST_OWNER_PROTECTION</code>).
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            {usersList.map((u) => {
              const isSelf = currentUser?.uid === u.uid;
              return (
                <div
                  key={u.uid}
                  className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-sm text-[#F3EEE8]">{u.displayName}</span>{' '}
                      <span className="font-mono-tabular text-[#83766D]">
                        ({u.uid} · {u.emailMasked})
                      </span>
                      {isSelf && (
                        <span className="ml-2 px-2 py-0.5 rounded bg-[#191614] border border-[#342A24] text-[11px] font-mono-tabular text-[#E4B45A]">
                          Current Session Actor
                        </span>
                      )}
                    </div>
                    <span className="px-2.5 py-1 rounded font-mono-tabular uppercase font-bold bg-[#F06424]/15 text-[#F06424]">
                      Current Role: {u.role}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={roleUpdateReason[u.uid] || ''}
                      onChange={(e) =>
                        setRoleUpdateReason((prev) => ({ ...prev, [u.uid]: e.target.value }))
                      }
                      placeholder="Audit reason for role change (required, min 3 chars)…"
                      className="flex-1 min-w-[220px] min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                    />

                    {(['user', 'admin', 'owner'] as UserRole[]).map((targetRole) => (
                      <button
                        key={targetRole}
                        type="button"
                        disabled={u.role === targetRole}
                        onClick={() => handleAssignUserRole(u.uid, targetRole)}
                        className={`min-h-[40px] px-3 py-1.5 rounded-lg font-mono-tabular uppercase font-semibold ${
                          u.role === targetRole
                            ? 'bg-[#191614] text-[#83766D] border border-[#342A24] opacity-50'
                            : 'bg-[#191614] text-[#F3EEE8] border border-[#342A24] hover:border-[#F06424]'
                        }`}
                      >
                        Set {targetRole}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 8. /admin/jobs — Redacted Job Inspector */}
      {!loading && subroute === 'jobs' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
            <h2 className="text-base font-bold text-[#F3EEE8]">
              Caption, Render & Export Job Inspector (/admin/jobs)
            </h2>
            <p className="text-xs text-[#B8AAA0]">
              All diagnostic messages pass through <code className="text-[#F3EEE8]">redactSensitiveDiagnosticString()</code> so bearer tokens, API keys, and local personal paths are scrubbed before persistence or display.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={adminJobsQuery}
                onChange={(e) => setAdminJobsQuery(e.target.value)}
                placeholder="Search jobs by title, requestId, moduleId, or errorCode…"
                className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] pl-8 pr-3 py-2 text-xs text-[#F3EEE8]"
              />
            </div>

            <select
              value={adminJobsStatusFilter}
              onChange={(e) => setAdminJobsStatusFilter(e.target.value)}
              className="min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
            >
              <option value="all">All Job States ({adminJobs.length})</option>
              <option value="ready">ready</option>
              <option value="downloaded">downloaded</option>
              <option value="succeeded">succeeded</option>
              <option value="running">running</option>
              <option value="queued">queued</option>
              <option value="failed">failed</option>
              <option value="needs-setup">needs-setup</option>
            </select>
          </div>

          <div className="space-y-2.5">
            {adminJobs
              .filter((j) => {
                if (adminJobsStatusFilter !== 'all' && j.status !== adminJobsStatusFilter)
                  return false;
                const q = adminJobsQuery.trim().toLowerCase();
                if (!q) return true;
                return (
                  j.title.toLowerCase().includes(q) ||
                  j.requestId.toLowerCase().includes(q) ||
                  j.moduleId.toLowerCase().includes(q) ||
                  (j.errorCode || '').toLowerCase().includes(q)
                );
              })
              .map((job) => (
                <div
                  key={job.id}
                  className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-2 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-sm text-[#F3EEE8]">{job.title}</span>
                    <div className="flex items-center gap-2 font-mono-tabular">
                      <span className="text-[#83766D]">Retries: {job.attemptCount}</span>
                      <span className="px-2 py-0.5 rounded bg-[#191614] border border-[#342A24] text-[#55B98B]">
                        {job.status}
                      </span>
                    </div>
                  </div>
                  <p className="text-[#B8AAA0] font-mono-tabular">{job.redactedMessage}</p>
                  <div className="text-[11px] font-mono-tabular text-[#83766D] flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-[#342A24]">
                    <span>Job ID: {job.id}</span>
                    <span>Req ID: {job.requestId}</span>
                    <span>Module: {job.moduleId}</span>
                    <span>Type: {job.type}</span>
                    {job.errorCode && <span className="text-[#F06464]">Error: {job.errorCode}</span>}
                    <span>Updated: {job.updatedAt}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 9. /admin/analytics — Honest Privacy-Aware Operational Metrics */}
      {!loading && subroute === 'analytics' && analyticsData && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#E4B45A]/40 bg-[#11100F] p-4 space-y-1">
            <div className="text-xs font-mono-tabular text-[#E4B45A]">
              EXTERNAL TELEMETRY PROVIDER STATUS: {analyticsData.externalTelemetryProvider.toUpperCase()}
            </div>
            <p className="text-xs text-[#B8AAA0]">{analyticsData.externalTelemetryNote}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs font-mono-tabular">
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
              <span className="text-[#83766D]">EXPORT & RENDER JOBS</span>
              <div className="text-2xl font-bold text-[#F3EEE8]">
                {analyticsData.realOperationalTotals.totalExportAndRenderJobs}
              </div>
            </div>
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
              <span className="text-[#83766D]">SAVED FAVORITES</span>
              <div className="text-2xl font-bold text-[#55B98B]">
                {analyticsData.realOperationalTotals.totalFavoritesSaved}
              </div>
            </div>
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
              <span className="text-[#83766D]">PROJECT LIBRARY ITEMS</span>
              <div className="text-2xl font-bold text-[#F3EEE8]">
                {analyticsData.realOperationalTotals.totalProjectLibraryRecords}
              </div>
            </div>
            <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-1">
              <span className="text-[#83766D]">IMMUTABLE AUDIT EVENTS</span>
              <div className="text-2xl font-bold text-[#E4B45A]">
                {analyticsData.realOperationalTotals.totalAuditEvents}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 space-y-3 text-xs">
            <h3 className="font-bold text-sm text-[#F3EEE8]">
              Published Catalog Counts Across All 20 Modules
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 font-mono-tabular">
              {analyticsData.catalogByModule.map((m) => (
                <div
                  key={m.moduleId}
                  className="rounded-lg border border-[#342A24] bg-[#191614] p-2.5 flex items-center justify-between"
                >
                  <span className="text-[#F3EEE8] truncate">{m.label}</span>
                  <span className="text-[#F06424] font-bold">{m.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 10. /admin/settings — Safe Product Settings + Mobile Editor Compatibility Admin Editor */}
      {!loading && subroute === 'settings' && platformSettings && (
        <div className="space-y-6">
          {/* Non-editable Secrets Security Notice */}
          <div className="rounded-xl border border-[#55B98B]/40 bg-[#11100F] p-4 flex items-start gap-3 text-xs">
            <Lock className="w-4 h-4 text-[#55B98B] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-[#F3EEE8]">
                Secrets & Environment Credentials Isolation Active
              </div>
              <p className="text-[#B8AAA0]">
                Server secrets (<code className="text-[#F3EEE8]">OWNER_BOOTSTRAP_SECRET</code>, <code className="text-[#F3EEE8]">GEMINI_API_KEY</code>, private signing keys) are never sent to or editable from <code className="text-[#F3EEE8]">/admin/settings</code>. Any request payload containing secret keys is rejected with <code className="text-[#F06464]">403 SECRETS_NOT_EDITABLE</code>.
              </p>
            </div>
          </div>

          <form
            onSubmit={handleSavePlatformSettings}
            className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 sm:p-5 space-y-4 text-xs"
          >
            <h2 className="text-base font-bold text-[#F3EEE8]">
              Safe Platform Quotas, Feature Flags & Retention (/admin/settings)
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-[#B8AAA0] font-semibold">
                  Max Export Package Size (MB)
                </span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={platformSettings.exportMaxSizeMb}
                  onChange={(e) =>
                    setPlatformSettings((p) =>
                      p ? { ...p, exportMaxSizeMb: Number(e.target.value) } : p
                    )
                  }
                  className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[#B8AAA0] font-semibold">
                  User Daily Export Quota
                </span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={platformSettings.userDailyExportQuota}
                  onChange={(e) =>
                    setPlatformSettings((p) =>
                      p ? { ...p, userDailyExportQuota: Number(e.target.value) } : p
                    )
                  }
                  className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[#B8AAA0] font-semibold">Job History Retention (Days)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={platformSettings.jobRetentionDays}
                  onChange={(e) =>
                    setPlatformSettings((p) =>
                      p ? { ...p, jobRetentionDays: Number(e.target.value) } : p
                    )
                  }
                  className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[#B8AAA0] font-semibold">
                Workspace Status / Maintenance Banner Text
              </span>
              <input
                type="text"
                value={platformSettings.maintenanceBannerText}
                onChange={(e) =>
                  setPlatformSettings((p) =>
                    p ? { ...p, maintenanceBannerText: e.target.value } : p
                  )
                }
                placeholder="Optional operational notice shown to users…"
                className="w-full min-h-[42px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-[#F3EEE8]"
              />
            </label>

            <div className="flex flex-wrap gap-4 pt-2">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={platformSettings.enableAlightMotionXmlExport}
                  onChange={(e) =>
                    setPlatformSettings((p) =>
                      p ? { ...p, enableAlightMotionXmlExport: e.target.checked } : p
                    )
                  }
                  className="accent-[#F06424] w-4 h-4"
                />
                <span>Enable Alight Motion XML Export</span>
              </label>

              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={platformSettings.enableWebShareHandoff}
                  onChange={(e) =>
                    setPlatformSettings((p) =>
                      p ? { ...p, enableWebShareHandoff: e.target.checked } : p
                    )
                  }
                  className="accent-[#F06424] w-4 h-4"
                />
                <span>Enable Web Share API Mobile Handoff</span>
              </label>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#342A24]">
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#F06424] text-[#080707] font-semibold"
              >
                Save Platform Settings
              </button>
            </div>
          </form>

          {/* Mobile Editor Capability & Compatibility Admin Matrix */}
          <div className="rounded-2xl border border-[#342A24] bg-[#11100F] p-4 sm:p-5 space-y-4 text-xs">
            <div>
              <h3 className="text-base font-bold text-[#F3EEE8]">
                Mobile Editor Capability & Compatibility Admin Matrix
              </h3>
              <p className="text-xs text-[#B8AAA0] mt-0.5">
                Manage compatibility statuses (<code className="text-[#55B98B]">Verified</code>, <code className="text-[#E4B45A]">Tested subset</code>, <code className="text-[#F3EEE8]">Media handoff only</code>, <code className="text-[#B8AAA0]">Needs target-app validation</code>, <code className="text-[#F06464]">Unsupported</code>). Server policy blocks marking any editor <code className="text-[#55B98B]">Verified</code> without tested versions and a verification note.
              </p>
            </div>

            <div className="space-y-3">
              {editorsList.map((ed) => {
                const isEditing = editingEditorId === ed.id;
                return (
                  <div
                    key={ed.id}
                    className="rounded-xl border border-[#342A24] bg-[#191614] p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-bold text-sm text-[#F3EEE8]">{ed.name}</span>{' '}
                        <span className="font-mono-tabular text-[#83766D]">({ed.id})</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded bg-[#11100F] border border-[#342A24] font-mono-tabular text-[#55B98B]">
                          {ed.compatibilityStatus}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (isEditing) {
                              setEditingEditorId(null);
                              setEditorDraft(null);
                            } else {
                              setEditingEditorId(ed.id);
                              setEditorDraft({
                                compatibilityStatus: ed.compatibilityStatus,
                                verifiedFormats: ed.verifiedFormats || [ed.defaultExportFormat],
                                testedVersions: ed.testedVersions || 'Android Mobile v1.0',
                                honestCapabilitySummary: ed.honestCapabilitySummary,
                                limitationsNote: ed.limitationsNote,
                                docsUrl: ed.docsUrl || '',
                                verificationNote: ed.verificationNote || '',
                              });
                            }
                          }}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg border border-[#342A24] bg-[#11100F] hover:border-[#F06424] text-[#F3EEE8]"
                        >
                          {isEditing ? 'Close' : 'Edit Compatibility'}
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] font-mono-tabular text-[#B8AAA0]">
                      Verified Formats: {(ed.verifiedFormats || ed.supportedFormats).join(', ')} · Tested Versions:{' '}
                      {ed.testedVersions || 'Not recorded'} · Last Validated:{' '}
                      {ed.lastValidationDate || '—'}
                    </div>
                    <div className="text-[11px] text-[#83766D]">
                      Limitations: {ed.limitationsNote}
                    </div>

                    {isEditing && editorDraft && (
                      <div className="rounded-xl border border-[#F06424]/40 bg-[#11100F] p-4 space-y-3 mt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className="space-y-1">
                            <span className="text-[#B8AAA0]">Compatibility Status *</span>
                            <select
                              value={editorDraft.compatibilityStatus}
                              onChange={(e) =>
                                setEditorDraft((p) =>
                                  p
                                    ? {
                                        ...p,
                                        compatibilityStatus: e.target
                                          .value as EditorCompatibilityStatus,
                                      }
                                    : p
                                )
                              }
                              className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                            >
                              <option value="Verified">Verified</option>
                              <option value="Tested subset">Tested subset</option>
                              <option value="Experimental">Experimental</option>
                              <option value="Media handoff only">Media handoff only</option>
                              <option value="Needs target-app validation">
                                Needs target-app validation
                              </option>
                              <option value="Unsupported">Unsupported</option>
                            </select>
                          </label>

                          <label className="space-y-1">
                            <span className="text-[#B8AAA0]">Tested App Versions *</span>
                            <input
                              type="text"
                              value={editorDraft.testedVersions}
                              onChange={(e) =>
                                setEditorDraft((p) =>
                                  p ? { ...p, testedVersions: e.target.value } : p
                                )
                              }
                              className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                            />
                          </label>
                        </div>

                        <label className="block space-y-1">
                          <span className="text-[#B8AAA0]">Known Limitations Note *</span>
                          <input
                            type="text"
                            value={editorDraft.limitationsNote}
                            onChange={(e) =>
                              setEditorDraft((p) =>
                                p ? { ...p, limitationsNote: e.target.value } : p
                              )
                            }
                            className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                          />
                        </label>

                        <label className="block space-y-1">
                          <span className="text-[#B8AAA0]">
                            Verification Note (required &gt;= 10 chars when status is Verified) *
                          </span>
                          <input
                            type="text"
                            value={editorDraft.verificationNote}
                            onChange={(e) =>
                              setEditorDraft((p) =>
                                p ? { ...p, verificationNote: e.target.value } : p
                              )
                            }
                            placeholder="Explain real export generator test verification…"
                            className="w-full min-h-[40px] rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-[#F3EEE8]"
                          />
                        </label>

                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleSaveEditorCompatibility(ed.id)}
                            className="min-h-[40px] px-4 py-1.5 rounded-lg bg-[#F06424] text-[#080707] font-semibold"
                          >
                            Save Compatibility Record
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 11. /admin/audit — Searchable Append-Only Audit Log */}
      {!loading && subroute === 'audit' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-[#342A24] bg-[#11100F] p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#F3EEE8]">
                Append-Only Security & Operations Audit Log (/admin/audit)
              </h2>
              <p className="text-xs text-[#B8AAA0]">
                Immutable record of every admin/owner privilege action, catalog change, module update, and role assignment. Client/API deletion or modification is blocked (<code className="text-[#F06464]">403 AUDIT_LOG_IMMUTABLE</code>).
              </p>
            </div>
            <span className="px-3 py-1.5 rounded-lg border border-[#55B98B]/40 bg-[#55B98B]/10 text-xs font-mono-tabular text-[#55B98B]">
              {auditEvents.length} Immutable Entries
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#83766D] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={auditQuery}
                onChange={(e) => setAuditQuery(e.target.value)}
                placeholder="Search action, actorUid, targetId…"
                className="w-full min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] pl-8 pr-3 py-2 text-xs text-[#F3EEE8]"
              />
            </div>

            <select
              value={auditOutcomeFilter}
              onChange={(e) => setAuditOutcomeFilter(e.target.value)}
              className="min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
            >
              <option value="all">All Outcomes</option>
              <option value="success">success</option>
              <option value="denied">denied</option>
              <option value="failed">failed</option>
            </select>

            <select
              value={auditTargetFilter}
              onChange={(e) => setAuditTargetFilter(e.target.value)}
              className="min-h-[42px] rounded-xl border border-[#342A24] bg-[#11100F] px-3 py-2 text-xs text-[#F3EEE8]"
            >
              <option value="all">All Target Types</option>
              <option value="catalog">catalog</option>
              <option value="module">module</option>
              <option value="user">user</option>
              <option value="role">role</option>
              <option value="asset">asset</option>
              <option value="settings">settings</option>
              <option value="editor-adapter">editor-adapter</option>
            </select>
          </div>

          <div className="space-y-2.5">
            {auditEvents
              .filter((ev) => {
                if (auditOutcomeFilter !== 'all' && ev.outcome !== auditOutcomeFilter)
                  return false;
                if (auditTargetFilter !== 'all' && ev.targetType !== auditTargetFilter)
                  return false;
                const q = auditQuery.trim().toLowerCase();
                if (!q) return true;
                return (
                  ev.action.toLowerCase().includes(q) ||
                  ev.actorUid.toLowerCase().includes(q) ||
                  ev.targetId.toLowerCase().includes(q) ||
                  ev.detailsRedacted.toLowerCase().includes(q)
                );
              })
              .map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-xl border border-[#342A24] bg-[#11100F] p-3.5 space-y-1.5 text-xs font-mono-tabular"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[#F06424] font-bold">{ev.action}</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] ${
                          ev.outcome === 'success'
                            ? 'bg-[#55B98B]/15 text-[#55B98B]'
                            : 'bg-[#F06464]/15 text-[#F06464]'
                        }`}
                      >
                        {ev.outcome || 'success'}
                      </span>
                      <span className="text-[#83766D]">{ev.createdAt}</span>
                    </div>
                  </div>
                  <div className="text-[#F3EEE8] font-sans">{ev.detailsRedacted}</div>
                  <div className="text-[11px] text-[#83766D]">
                    Actor: {ev.actorUid} · Target: [{ev.targetType || 'system'}] {ev.targetId}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};
