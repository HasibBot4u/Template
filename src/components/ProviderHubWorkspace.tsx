import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  GitBranch,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Unlock,
  Wrench,
  XCircle,
} from 'lucide-react';
import { AuthenticatedUser } from '../types/sowveil';
import { auth } from '../services/firebaseClient';
import {
  ALL_HUB_TASK_TYPES,
  ALL_MODEL_CAPABILITY_KEYS,
  buildDefaultRoutingProfiles,
  CapabilityVerificationState,
  evaluateRoutingReadiness,
  ExtensionPackageKind,
  ExtensionPackageRecord,
  ExtensionPermissionScope,
  HubAuthMode,
  HubProviderProtocol,
  HubTaskType,
  ModelCapabilityKey,
  PREPOPULATED_MODEL_CATALOG,
  PrepopulatedModelCatalogEntry,
  ProviderConnectionPublicView,
  REGISTERED_AI_TOOLS,
  RISKY_EXTENSION_PERMISSIONS,
  SecretStorageMode,
  TaskRoutingProfile,
  ToolExecutionAuditRecord,
  validateCustomEndpointSsrf,
} from '../types/providerHub';

export interface ProviderHubWorkspaceProps {
  userUid?: string;
  currentUser?: AuthenticatedUser | null;
  onNotify: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
  getAuthToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

type HubTabId =
  | 'connections'
  | 'capabilities'
  | 'routing'
  | 'extensions'
  | 'tool-registry';

export interface ProviderHubApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  errorCode?: string;
  errorMessage?: string;
  details?: unknown;
}

/**
 * Browser-safe authenticated API helper for Provider Hub, Extensions, and Tool Registry.
 * - Obtains a verified Firebase ID token via `auth.currentUser.getIdToken()` (or injected test token getter).
 * - Sends `Authorization: Bearer <token>`.
 * - Never sends unverified development bypass headers.
 * - Never places credentials in URLs.
 */
export async function executeProviderHubApiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    getAuthToken?: () => Promise<string | null>;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<ProviderHubApiResult<T>> {
  const resolveToken =
    options.getAuthToken ||
    (async () => {
      if (auth?.currentUser) {
        return await auth.currentUser.getIdToken();
      }
      return null;
    });

  let token: string | null = null;
  try {
    token = await resolveToken();
  } catch {
    token = null;
  }

  if (!token) {
    return {
      ok: false,
      status: 401,
      errorCode: 'AUTH_SESSION_REQUIRED',
      errorMessage:
        'An active authenticated session is required for Provider Hub operations. Please sign in and retry.',
    };
  }

  const effectiveFetch = options.fetchImpl || globalThis.fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await effectiveFetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json || json.ok === false) {
      return {
        ok: false,
        status: response.status,
        errorCode: json?.error?.code || `HTTP_${response.status}`,
        errorMessage:
          json?.error?.message ||
          `Request to ${path} failed with HTTP ${response.status}.`,
        details: json?.error?.details,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: json.data as T,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      errorCode: 'NETWORK_REQUEST_FAILED',
      errorMessage:
        err?.message || `Network error while contacting ${path}. No local fallback was applied.`,
    };
  }
}

export const ProviderHubWorkspace: React.FC<ProviderHubWorkspaceProps> = ({
  userUid,
  currentUser,
  onNotify,
  getAuthToken,
  fetchImpl,
}) => {
  const activeUserUid = currentUser?.uid || userUid || auth?.currentUser?.uid || null;
  const [activeTab, setActiveTab] = useState<HubTabId>('connections');
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState<boolean>(false);
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [apiErrorBanner, setApiErrorBanner] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [vaultDiagnostics, setVaultDiagnostics] = useState<{
    configured: boolean;
    sourceEnvVar: string | null;
    errorCode: string | null;
    message: string;
  } | null>(null);

  // Server-backed connections state (public views only — never holds encryptedCredential or raw key)
  const [connections, setConnections] = useState<ProviderConnectionPublicView[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');

  // New Connection Wizard Form State
  const [selectedPresetId, setSelectedPresetId] = useState<string>('preset-openai-chat-gpt4o');
  const [newLabel, setNewLabel] = useState<string>('OpenAI GPT-4o Production');
  const [newBrand, setNewBrand] = useState<string>('OpenAI');
  const [newProtocol, setNewProtocol] = useState<HubProviderProtocol>('openai-chat-completions');
  const [newBaseUrl, setNewBaseUrl] = useState<string>('https://api.openai.com');
  const [newApiPath, setNewApiPath] = useState<string>('/v1/chat/completions');
  const [newModelId, setNewModelId] = useState<string>('gpt-4o');
  const [newAuthMode, setNewAuthMode] = useState<HubAuthMode>('bearer');
  const [newStorageMode, setNewStorageMode] = useState<SecretStorageMode>('server-encrypted-vault');
  const [newCredential, setNewCredential] = useState<string>('');
  const [showCredentialInput, setShowCredentialInput] = useState<boolean>(false);
  const [newMonthlyBudgetUsd, setNewMonthlyBudgetUsd] = useState<number>(25);
  const [newBudgetMode, setNewBudgetMode] = useState<
    'hard-stop' | 'fallback-to-secondary' | 'warn-only'
  >('fallback-to-secondary');
  const [rotateKeyInput, setRotateKeyInput] = useState<string>('');

  // Probe options
  const [probeTools, setProbeTools] = useState<boolean>(true);
  const [probeStructuredOutput, setProbeStructuredOutput] = useState<boolean>(true);
  const [probeVision, setProbeVision] = useState<boolean>(false);
  const [probeStreaming, setProbeStreaming] = useState<boolean>(true);
  const [lastProbePreview, setLastProbePreview] = useState<{
    url: string;
    method: string;
    redactedHeaders: Record<string, string>;
    bodySummary: Record<string, unknown>;
  } | null>(null);

  // Task Routing Profiles (8 task profiles)
  const [routingProfiles, setRoutingProfiles] = useState<Record<HubTaskType, TaskRoutingProfile>>(
    () => buildDefaultRoutingProfiles([])
  );

  // Extensions Workspace State
  const [extensions, setExtensions] = useState<ExtensionPackageRecord[]>([]);
  const [extName, setExtName] = useState<string>('');
  const [extKind, setExtKind] = useState<ExtensionPackageKind>('github-repo');
  const [extSourceUrl, setExtSourceUrl] = useState<string>('https://github.com/');
  const [extCommitPin, setExtCommitPin] = useState<string>('v1.0.0-pinned');
  const [extLicense, setExtLicense] = useState<string>('MIT');
  const [extPermissions, setExtPermissions] = useState<ExtensionPermissionScope[]>([
    'read-project',
    'read-catalog',
  ]);
  const [extManifestContent, setExtManifestContent] = useState<string>('');
  const [extExplicitApproval, setExtExplicitApproval] = useState<boolean>(false);

  // Tool Registry Interactive Runner State
  const [selectedToolId, setSelectedToolId] = useState<string>(REGISTERED_AI_TOOLS[0].id);
  const [toolDryRun, setToolDryRun] = useState<boolean>(true);
  const [toolProjectId, setToolProjectId] = useState<string>('proj_canonical_demo');
  const [toolCommandType, setToolCommandType] = useState<string>('update-text');
  const [toolTextValue, setToolTextValue] = useState<string>('SOWVEIL 2026 LAUNCH');
  const [toolScriptText, setToolScriptText] = useState<string>(
    'Scene 1: Hook viewers with high-contrast kinetic typography.\nScene 2: Reveal the SaaS dashboard mockup with spring easing.\nScene 3: Close with logo reveal and audio riser.'
  );
  const [toolCatalogQuery, setToolCatalogQuery] = useState<string>('kinetic');
  const [toolApprovalToken, setToolApprovalToken] = useState<string>('');
  const [toolGrantedPerms, setToolGrantedPerms] = useState<ExtensionPermissionScope[]>([
    'read-project',
    'read-catalog',
    'propose-commands',
    'write-project',
  ]);
  const [toolAudits, setToolAudits] = useState<ToolExecutionAuditRecord[]>([]);
  const [lastToolResult, setLastToolResult] = useState<Record<string, unknown> | null>(null);

  const apiCall = useCallback(
    async <T,>(
      path: string,
      options: {
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        body?: Record<string, unknown>;
      } = {}
    ): Promise<ProviderHubApiResult<T>> => {
      return executeProviderHubApiRequest<T>(path, {
        ...options,
        getAuthToken,
        fetchImpl,
      });
    },
    [getAuthToken, fetchImpl]
  );

  const loadProviderHubData = useCallback(async () => {
    if (!activeUserUid) {
      setConnections([]);
      setExtensions([]);
      setToolAudits([]);
      return;
    }

    setIsLoadingWorkspace(true);
    setApiErrorBanner(null);

    try {
      const [connRes, routingRes, extRes, toolsRes] = await Promise.all([
        apiCall<{
          items: ProviderConnectionPublicView[];
          total: number;
          vaultStatus?: {
            configured: boolean;
            sourceEnvVar: string | null;
            errorCode: string | null;
            message: string;
          };
        }>('/api/v1/provider-hub/connections'),
        apiCall<{
          profiles: Record<HubTaskType, TaskRoutingProfile>;
        }>('/api/v1/provider-hub/routing'),
        apiCall<{
          items: ExtensionPackageRecord[];
        }>('/api/v1/extensions'),
        apiCall<{
          auditRecords: ToolExecutionAuditRecord[];
        }>('/api/v1/tools/registry'),
      ]);

      if (!connRes.ok) {
        setApiErrorBanner({
          code: connRes.errorCode || 'LOAD_CONNECTIONS_FAILED',
          message: connRes.errorMessage || 'Failed to load Provider Hub connections.',
        });
        return;
      }

      const loadedConnections = connRes.data?.items || [];
      setConnections(loadedConnections);
      if (connRes.data?.vaultStatus) {
        setVaultDiagnostics(connRes.data.vaultStatus);
      }
      setSelectedConnectionId((prev) =>
        prev && loadedConnections.some((c) => c.id === prev)
          ? prev
          : loadedConnections[0]?.id || ''
      );

      if (routingRes.ok && routingRes.data?.profiles) {
        setRoutingProfiles(routingRes.data.profiles);
      }
      if (extRes.ok && extRes.data?.items) {
        setExtensions(extRes.data.items);
      }
      if (toolsRes.ok && toolsRes.data?.auditRecords) {
        setToolAudits(toolsRes.data.auditRecords);
      }
    } finally {
      setIsLoadingWorkspace(false);
    }
  }, [activeUserUid, apiCall]);

  useEffect(() => {
    void loadProviderHubData();
  }, [loadProviderHubData]);

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === selectedConnectionId) || connections[0] || null,
    [connections, selectedConnectionId]
  );

  const connectionsMap = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections]
  );

  const ssrfLiveCheck = useMemo(
    () => validateCustomEndpointSsrf(newBaseUrl),
    [newBaseUrl]
  );

  const handleApplyCatalogPreset = (preset: PrepopulatedModelCatalogEntry) => {
    setSelectedPresetId(preset.presetId);
    setNewLabel(preset.label);
    setNewBrand(preset.providerBrand);
    setNewProtocol(preset.protocol);
    setNewBaseUrl(preset.defaultBaseUrl);
    setNewApiPath(preset.defaultApiPath);
    setNewModelId(preset.modelId);
    setNewAuthMode(preset.recommendedAuthMode);
  };

  const handleCreateConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ssrfLiveCheck.allowed) {
      onNotify(`SSRF Guard blocked URL: ${ssrfLiveCheck.reason}`, 'error');
      return;
    }

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ connection: ProviderConnectionPublicView }>(
        '/api/v1/provider-hub/connections',
        {
          method: 'POST',
          body: {
            label: newLabel,
            providerBrand: newBrand,
            protocol: newProtocol,
            baseUrl: newBaseUrl,
            endpointSettings: {
              apiPath: newApiPath,
            },
            modelId: newModelId,
            authMode: newAuthMode,
            credential: newCredential,
            storageMode: newStorageMode,
            budgetPolicy: {
              mode: newBudgetMode,
              monthlyLimitUsd: newMonthlyBudgetUsd,
              spentCurrentMonthUsd: 0,
              maxPerRequestUsd: 0.5,
              rateLimitRpm: 60,
            },
          },
        }
      );

      if (!res.ok || !res.data?.connection) {
        const msg =
          res.errorMessage ||
          'Failed to save provider connection. Unsaved form input was preserved.';
        setApiErrorBanner({
          code: res.errorCode || 'CONNECTION_CREATE_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const created = res.data.connection;
      setConnections((prev) => [created, ...prev]);
      setSelectedConnectionId(created.id);
      setNewCredential('');
      onNotify(
        `Saved provider connection "${created.label}" (${created.protocol}). Capabilities initialized as Not tested until probed.`,
        'success'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleRunProbe = async (
    simulateFailureCode?: '401_UNAUTHORIZED' | '429_QUOTA_EXCEEDED'
  ) => {
    if (!selectedConnection) return;

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{
        connection: ProviderConnectionPublicView;
        probePassed: boolean;
        verifiedCapabilities: ModelCapabilityKey[];
        formattedProbeRequestPreview: {
          url: string;
          method: string;
          redactedHeaders: Record<string, string>;
          bodySummary: Record<string, unknown>;
        } | null;
        sanitizedError: ProviderConnectionPublicView['lastSanitizedError'];
      }>(`/api/v1/provider-hub/connections/${encodeURIComponent(selectedConnection.id)}/test`, {
        method: 'POST',
        body: {
          probeTools,
          probeStructuredOutput,
          probeVision,
          probeStreaming,
          simulateFailureCode,
        },
      });

      if (!res.ok || !res.data?.connection) {
        const msg = res.errorMessage || 'Connection probe request failed.';
        setApiErrorBanner({
          code: res.errorCode || 'PROBE_REQUEST_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const { connection: updatedConn, probePassed, verifiedCapabilities, formattedProbeRequestPreview, sanitizedError } =
        res.data;
      setConnections((prev) =>
        prev.map((c) => (c.id === updatedConn.id ? updatedConn : c))
      );
      setLastProbePreview(formattedProbeRequestPreview || null);

      if (probePassed) {
        onNotify(
          `Verified ${verifiedCapabilities.length} capability(s) on "${updatedConn.label}": ${verifiedCapabilities.join(', ')}`,
          'success'
        );
      } else {
        onNotify(
          `Probe failed (${sanitizedError?.code}): ${sanitizedError?.message}`,
          'error'
        );
      }
    } finally {
      setIsMutating(false);
    }
  };

  const handleCapabilityOverride = async (
    cap: ModelCapabilityKey,
    nextState: 'User-asserted' | 'Unsupported' | 'Not tested'
  ) => {
    if (!selectedConnection) return;

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ connection: ProviderConnectionPublicView }>(
        `/api/v1/provider-hub/connections/${encodeURIComponent(selectedConnection.id)}/capabilities`,
        {
          method: 'PATCH',
          body: {
            capability: cap,
            state: nextState,
            reason: 'Manual capability matrix adjustment in Provider Hub',
          },
        }
      );

      if (!res.ok || !res.data?.connection) {
        const msg = res.errorMessage || `Failed to update capability "${cap}".`;
        setApiErrorBanner({
          code: res.errorCode || 'CAPABILITY_UPDATE_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const updated = res.data.connection;
      setConnections((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
      onNotify(
        nextState === 'User-asserted'
          ? `Marked "${cap}" as User-asserted (unverified override warning active).`
          : `Set "${cap}" to ${nextState}.`,
        nextState === 'User-asserted' ? 'warning' : 'info'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleRotateCredential = async () => {
    if (!selectedConnection) return;
    if (!rotateKeyInput.trim()) {
      onNotify('Enter a new API credential before rotating.', 'warning');
      return;
    }

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ connection: ProviderConnectionPublicView }>(
        `/api/v1/provider-hub/connections/${encodeURIComponent(selectedConnection.id)}/rotate-key`,
        {
          method: 'POST',
          body: {
            credential: rotateKeyInput,
          },
        }
      );

      if (!res.ok || !res.data?.connection) {
        const msg =
          res.errorMessage || 'Failed to rotate API credential. Input was preserved.';
        setApiErrorBanner({
          code: res.errorCode || 'CREDENTIAL_ROTATION_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const updated = res.data.connection;
      setConnections((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
      setRotateKeyInput('');
      onNotify(
        `Rotated credential for "${updated.label}" to key version v${updated.keyVersion} (${updated.maskedCredential}).`,
        'success'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleRevokeCredential = async () => {
    if (!selectedConnection) return;

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ connection: ProviderConnectionPublicView }>(
        `/api/v1/provider-hub/connections/${encodeURIComponent(selectedConnection.id)}/revoke-key`,
        {
          method: 'POST',
        }
      );

      if (!res.ok || !res.data?.connection) {
        const msg = res.errorMessage || 'Failed to revoke credential.';
        setApiErrorBanner({
          code: res.errorCode || 'CREDENTIAL_REVOKE_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const updated = res.data.connection;
      setConnections((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
      onNotify(
        `Revoked credential for "${updated.label}". Vault ciphertext wiped.`,
        'warning'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteConnection = async (id: string) => {
    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ deletedId: string }>(
        `/api/v1/provider-hub/connections/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
        }
      );

      if (!res.ok) {
        const msg = res.errorMessage || 'Failed to delete provider connection.';
        setApiErrorBanner({
          code: res.errorCode || 'CONNECTION_DELETE_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      setConnections((prev) => {
        const remaining = prev.filter((c) => c.id !== id);
        if (selectedConnectionId === id) {
          setSelectedConnectionId(remaining[0]?.id || '');
        }
        return remaining;
      });
      onNotify('Deleted provider connection and purged vault record.', 'info');
    } finally {
      setIsMutating(false);
    }
  };

  const handleUpdateRoutingProfile = async (
    taskType: HubTaskType,
    patch: Partial<
      Pick<
        TaskRoutingProfile,
        'primaryConnectionId' | 'fallbackConnectionId' | 'maxBudgetPerRunUsd' | 'temperature'
      >
    >
  ) => {
    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{
        profile: TaskRoutingProfile;
      }>(`/api/v1/provider-hub/routing/${encodeURIComponent(taskType)}`, {
        method: 'PUT',
        body: patch as Record<string, unknown>,
      });

      if (!res.ok || !res.data?.profile) {
        const msg = res.errorMessage || `Failed to update routing profile for ${taskType}.`;
        setApiErrorBanner({
          code: res.errorCode || 'ROUTING_UPDATE_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const updatedProfile = res.data.profile;
      setRoutingProfiles((prev) => ({
        ...prev,
        [taskType]: updatedProfile,
      }));
      onNotify(`Updated task routing profile for "${updatedProfile.label}".`, 'success');
    } finally {
      setIsMutating(false);
    }
  };

  const handleRegisterExtension = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extName.trim() || !extSourceUrl.trim()) {
      onNotify('Extension name and source URL are required.', 'warning');
      return;
    }

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{
        extension: ExtensionPackageRecord;
      }>('/api/v1/extensions', {
        method: 'POST',
        body: {
          name: extName,
          kind: extKind,
          sourceUrl: extSourceUrl,
          commitOrReleasePin: extCommitPin,
          version: '1.0.0',
          license: extLicense,
          requestedPermissions: extPermissions,
          rawInstructionOrManifestContent: extManifestContent,
          explicitApprovalGranted: extExplicitApproval,
        },
      });

      if (!res.ok || !res.data?.extension) {
        const msg =
          res.errorMessage ||
          'Extension registration failed. Unsaved manifest input was preserved.';
        setApiErrorBanner({
          code: res.errorCode || 'EXTENSION_REGISTER_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const registered = res.data.extension;
      setExtensions((prev) => [registered, ...prev]);
      setExtName('');
      setExtManifestContent('');
      onNotify(
        registered.installState === 'quarantined'
          ? `Extension "${registered.name}" was quarantined by the security sandbox.`
          : `Registered extension "${registered.name}" (${registered.installState}).`,
        registered.installState === 'quarantined' ? 'error' : 'success'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleToggleExtensionState = async (ext: ExtensionPackageRecord) => {
    const nextState =
      ext.installState === 'installed-enabled'
        ? 'installed-disabled'
        : 'installed-enabled';

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ extension: ExtensionPackageRecord }>(
        `/api/v1/extensions/${encodeURIComponent(ext.id)}`,
        {
          method: 'PATCH',
          body: {
            installState: nextState,
          },
        }
      );

      if (!res.ok || !res.data?.extension) {
        const msg = res.errorMessage || `Failed to update extension "${ext.name}".`;
        setApiErrorBanner({
          code: res.errorCode || 'EXTENSION_UPDATE_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const updated = res.data.extension;
      setExtensions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      onNotify(`Extension "${updated.name}" is now ${updated.installState}.`, 'info');
    } finally {
      setIsMutating(false);
    }
  };

  const handleApproveExtensionPermissions = async (ext: ExtensionPackageRecord) => {
    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ extension: ExtensionPackageRecord }>(
        `/api/v1/extensions/${encodeURIComponent(ext.id)}`,
        {
          method: 'PATCH',
          body: {
            explicitApprovalGranted: true,
            installState: 'installed-enabled',
          },
        }
      );

      if (!res.ok || !res.data?.extension) {
        const msg = res.errorMessage || `Failed to approve permissions for "${ext.name}".`;
        setApiErrorBanner({
          code: res.errorCode || 'EXTENSION_APPROVAL_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const updated = res.data.extension;
      setExtensions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      onNotify(
        `Approved permissions for "${updated.name}" (state: ${updated.installState}).`,
        'success'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleSimulateExtensionUpdate = async (ext: ExtensionPackageRecord) => {
    const nextPatchVersion = `${ext.version}.1`;
    const nextPin = `commit-${Date.now().toString(16).slice(-6)}`;
    const nextPerms: ExtensionPermissionScope[] = ext.requestedPermissions.includes(
      'write-project'
    )
      ? ext.requestedPermissions
      : [...ext.requestedPermissions, 'write-project'];

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ extension: ExtensionPackageRecord }>(
        `/api/v1/extensions/${encodeURIComponent(ext.id)}`,
        {
          method: 'PATCH',
          body: {
            version: nextPatchVersion,
            commitOrReleasePin: nextPin,
            requestedPermissions: nextPerms,
            explicitApprovalGranted: false,
          },
        }
      );

      if (!res.ok || !res.data?.extension) {
        const msg = res.errorMessage || `Failed to update "${ext.name}".`;
        setApiErrorBanner({
          code: res.errorCode || 'EXTENSION_UPDATE_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const updated = res.data.extension;
      setExtensions((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      onNotify(
        `Updated "${updated.name}" to v${updated.version}. Permission diff requires explicit approval before re-enabling.`,
        'warning'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleRollbackExtension = async (ext: ExtensionPackageRecord) => {
    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ extension: ExtensionPackageRecord }>(
        `/api/v1/extensions/${encodeURIComponent(ext.id)}/rollback`,
        {
          method: 'POST',
          body: {},
        }
      );

      if (!res.ok || !res.data?.extension) {
        const msg = res.errorMessage || `Rollback failed for "${ext.name}".`;
        setApiErrorBanner({
          code: res.errorCode || 'EXTENSION_ROLLBACK_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      const rolledBack = res.data.extension;
      setExtensions((prev) =>
        prev.map((item) => (item.id === rolledBack.id ? rolledBack : item))
      );
      onNotify(
        `Rolled back "${rolledBack.name}" to v${rolledBack.version} (${rolledBack.commitOrReleasePin}).`,
        'success'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleUninstallExtension = async (extId: string) => {
    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{ uninstalledId: string }>(
        `/api/v1/extensions/${encodeURIComponent(extId)}`,
        {
          method: 'DELETE',
        }
      );

      if (!res.ok) {
        const msg = res.errorMessage || 'Failed to uninstall extension.';
        setApiErrorBanner({
          code: res.errorCode || 'EXTENSION_DELETE_FAILED',
          message: msg,
        });
        onNotify(msg, 'error');
        return;
      }

      setExtensions((prev) => prev.filter((item) => item.id !== extId));
      onNotify('Uninstalled extension package.', 'info');
    } finally {
      setIsMutating(false);
    }
  };

  const handleInvokeTool = async (e: React.FormEvent) => {
    e.preventDefault();
    const inputObj: Record<string, unknown> = {};
    if (selectedToolId === 'project.inspect_state') {
      inputObj.projectId = toolProjectId;
    } else if (selectedToolId === 'script.analyze_coverage') {
      inputObj.scriptText = toolScriptText;
    } else if (selectedToolId === 'catalog.search_templates') {
      inputObj.query = toolCatalogQuery;
    } else if (selectedToolId === 'timeline.execute_command') {
      inputObj.projectId = toolProjectId;
      inputObj.commandType = toolCommandType;
      inputObj.textValue = toolTextValue;
    } else if (selectedToolId === 'timeline.create_checkpoint') {
      inputObj.projectId = toolProjectId;
      inputObj.label = toolTextValue || 'Pre-AI Checkpoint';
    } else if (selectedToolId === 'project.delete_track_or_clip') {
      inputObj.projectId = toolProjectId;
      inputObj.targetClipId = 'clip_title_main';
      inputObj.userApprovalToken = toolApprovalToken;
    }

    setIsMutating(true);
    setApiErrorBanner(null);
    try {
      const res = await apiCall<{
        output: Record<string, unknown>;
        auditRecord: ToolExecutionAuditRecord;
      }>('/api/v1/tools/invoke', {
        method: 'POST',
        body: {
          toolId: selectedToolId,
          input: inputObj,
          dryRun: toolDryRun,
          grantedPermissions: toolGrantedPerms,
        },
      });

      if (!res.ok) {
        const auditDetail = (res.details as { auditRecord?: ToolExecutionAuditRecord } | undefined)
          ?.auditRecord;
        if (auditDetail) {
          setToolAudits((prev) => [auditDetail, ...prev]);
        }
        setLastToolResult({
          error: {
            code: res.errorCode || 'TOOL_EXECUTION_REJECTED',
            message: res.errorMessage || 'Tool execution rejected by server policy.',
          },
        });
        onNotify(`Tool blocked (${res.errorCode}): ${res.errorMessage}`, 'error');
        return;
      }

      if (res.data?.auditRecord) {
        setToolAudits((prev) => [res.data!.auditRecord, ...prev]);
      }
      setLastToolResult(res.data?.output || {});
      onNotify(
        `Tool "${selectedToolId}" executed (${toolDryRun ? 'Dry-Run' : 'Live'}).`,
        'success'
      );
    } finally {
      setIsMutating(false);
    }
  };

  const renderCapabilityBadge = (state: CapabilityVerificationState) => {
    switch (state) {
      case 'Verified':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded">
            <CheckCircle2 className="w-3 h-3" /> Verified
          </span>
        );
      case 'User-asserted':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded">
            <AlertTriangle className="w-3 h-3" /> User-asserted
          </span>
        );
      case 'Unsupported':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-rose-500/15 text-rose-300 border border-rose-500/30 rounded">
            <XCircle className="w-3 h-3" /> Unsupported
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-zinc-800 text-zinc-400 border border-zinc-700 rounded">
            Not tested
          </span>
        );
    }
  };

  if (!activeUserUid) {
    return (
      <div className="min-h-screen bg-[#111214] text-zinc-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#18191C] border border-zinc-800 rounded-xl p-6 text-center space-y-4">
          <Lock className="w-10 h-10 text-[#F06424] mx-auto" />
          <h1 className="text-lg font-bold text-white">
            Sign In Required for Provider Hub & Vault
          </h1>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Provider connections, encrypted server vault credentials, routing profiles, and
            sandboxed extensions are strictly isolated per authenticated user workspace.
          </p>
          <div className="flex items-center justify-center gap-3 pt-2">
            <Link
              to="/signin"
              className="px-4 py-2 rounded-lg bg-[#F06424] hover:bg-[#ff7638] text-xs font-bold text-black transition-colors"
            >
              Sign In to Continue
            </Link>
            <Link
              to="/app"
              className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 transition-colors"
            >
              Back to Studio
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#111214] text-zinc-100 flex flex-col">
      {/* Top Header */}
      <header className="border-b border-zinc-800/80 bg-[#16171A] px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              to="/app"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-zinc-800/80 hover:bg-zinc-700 text-xs text-zinc-200 border border-zinc-700 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Studio
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#F06424]" />
                <h1 className="text-sm sm:text-base font-bold tracking-tight text-white">
                  Provider Hub, Secret Vault & Extensions Sandbox
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase bg-[#F06424]/15 text-[#F06424] border border-[#F06424]/30 rounded">
                  AES-256-GCM AAD Vault
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Distinct protocol adapters · Live capability probing · SSRF & redirect guard ·
                Untrusted skill sandbox · Typed tool registry
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => void loadProviderHubData()}
              disabled={isLoadingWorkspace || isMutating}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 disabled:opacity-50"
            >
              {isLoadingWorkspace ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F06424]" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 text-zinc-400" />
              )}
              Sync Server State
            </button>
            <span className="px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 font-mono text-[11px]">
              Workspace: ws_{activeUserUid.slice(0, 10)}
            </span>
          </div>
        </div>
      </header>

      {/* Vault Status & Truthful Error Banners */}
      <div className="max-w-7xl w-full mx-auto px-4 pt-3 space-y-2">
        {vaultDiagnostics && !vaultDiagnostics.configured && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">
                Server Vault Master Key Not Configured ({vaultDiagnostics.errorCode}):
              </span>{' '}
              {vaultDiagnostics.message} Server-env connections remain usable, but storing or
              decrypting custom encrypted credentials will fail closed until{' '}
              <code className="font-mono text-amber-100">SOWVEIL_MASTER_VAULT_KEY</code> is set.
            </div>
          </div>
        )}

        {apiErrorBanner && (
          <div
            role="alert"
            data-testid="provider-hub-api-error"
            className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/40 text-xs text-rose-200 flex items-start justify-between gap-3"
          >
            <div className="flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-mono font-bold">[{apiErrorBanner.code}]</span>{' '}
                {apiErrorBanner.message}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setApiErrorBanner(null)}
              className="text-[11px] text-rose-300 hover:text-white underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Sub-navigation Tabs */}
      <div className="border-b border-zinc-800 bg-[#141518] px-4 mt-2">
        <div className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto py-2 no-scrollbar">
          {[
            { id: 'connections', label: '1. Provider Connections & Vault', icon: KeyRound },
            {
              id: 'capabilities',
              label: '2. Capability Registry (14 Scopes)',
              icon: CheckCircle2,
            },
            { id: 'routing', label: '3. Task Routing Profiles (8 Tasks)', icon: RouteIcon },
            { id: 'extensions', label: '4. Extensions & Skill Sandbox', icon: Boxes },
            { id: 'tool-registry', label: '5. Typed AI Tool Registry', icon: Wrench },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as HubTabId)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#F06424] text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 space-y-6">
        {/* TAB 1: PROVIDER CONNECTIONS & VAULT */}
        {activeTab === 'connections' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Prepopulated Model Catalog + Connection Wizard */}
            <div className="lg:col-span-5 space-y-5">
              <section className="bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#F06424]" />
                    Prepopulated Model Presets
                  </h2>
                  <span className="text-[11px] text-zinc-500">
                    Click to populate adapter
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Gemini 4 Argon (<code className="text-zinc-200">gemini-4-argon</code>) and
                  Gemini 3.8 Flash (<code className="text-zinc-200">gemini-3.8-flash</code>) are
                  prepopulated when the endpoint account has quota. Capabilities start as{' '}
                  <strong className="text-zinc-200">Not tested</strong> until verified by a live
                  probe.
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {PREPOPULATED_MODEL_CATALOG.map((preset) => {
                    const isSelected = selectedPresetId === preset.presetId;
                    return (
                      <button
                        key={preset.presetId}
                        type="button"
                        onClick={() => handleApplyCatalogPreset(preset)}
                        className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                          isSelected
                            ? 'bg-[#F06424]/10 border-[#F06424] text-zinc-100'
                            : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold">{preset.label}</span>
                          <span className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 text-zinc-300 rounded">
                            {preset.protocol}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400 font-mono">
                          <span>model: {preset.modelId}</span>
                          <span>·</span>
                          <span>auth: {preset.recommendedAuthMode}</span>
                        </div>
                        <p className="mt-1 text-[10px] text-zinc-500">
                          {preset.quotaDisclaimer}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Connection Wizard Form */}
              <form
                onSubmit={handleCreateConnection}
                className="bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-3.5"
              >
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5 text-[#F06424]" />
                  Add Provider Connection
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Connection Label
                    </label>
                    <input
                      type="text"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Protocol Adapter (Distinct)
                    </label>
                    <select
                      value={newProtocol}
                      onChange={(e) => setNewProtocol(e.target.value as HubProviderProtocol)}
                      className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    >
                      <option value="google-gemini">google-gemini (GenerateContent)</option>
                      <option value="openai-chat-completions">
                        openai-chat-completions (/v1/chat/completions)
                      </option>
                      <option value="openai-responses">
                        openai-responses (/v1/responses Stateful)
                      </option>
                      <option value="anthropic-messages">
                        anthropic-messages (/v1/messages)
                      </option>
                      <option value="openai-compatible-variant">
                        openai-compatible-variant (OpenRouter/vLLM)
                      </option>
                      <option value="azure-openai">azure-openai (Deployments API)</option>
                      <option value="custom-rest-adapter">custom-rest-adapter</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      HTTPS Base URL (SSRF Guard Active)
                    </label>
                    <input
                      type="text"
                      value={newBaseUrl}
                      onChange={(e) => setNewBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com"
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Model ID</label>
                    <input
                      type="text"
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                      required
                    />
                  </div>
                </div>

                {/* Live SSRF Validation Indicator */}
                <div
                  className={`p-2 rounded text-[11px] flex items-center gap-2 border ${
                    ssrfLiveCheck.allowed
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                  }`}
                >
                  {ssrfLiveCheck.allowed ? (
                    <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
                  )}
                  <span>
                    {ssrfLiveCheck.allowed
                      ? `SSRF Check Passed: ${ssrfLiveCheck.normalizedBaseUrl} (Port ${ssrfLiveCheck.port})`
                      : `SSRF Blocked [${ssrfLiveCheck.errorCode}]: ${ssrfLiveCheck.reason}`}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Authentication Header Mode
                    </label>
                    <select
                      value={newAuthMode}
                      onChange={(e) => setNewAuthMode(e.target.value as HubAuthMode)}
                      className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    >
                      <option value="bearer">Authorization: Bearer &lt;token&gt;</option>
                      <option value="x-api-key">x-api-key (Anthropic)</option>
                      <option value="api-key">api-key (Azure)</option>
                      <option value="custom-header">Custom Header</option>
                      <option value="server-env">Server Environment (GEMINI_API_KEY)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Secret Storage Mode
                    </label>
                    <select
                      value={newStorageMode}
                      onChange={(e) => setNewStorageMode(e.target.value as SecretStorageMode)}
                      className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    >
                      <option value="server-encrypted-vault">
                        Server-Side Encrypted Vault (Recommended)
                      </option>
                      <option value="device-only-ephemeral">
                        Device-Only Ephemeral Session
                      </option>
                    </select>
                  </div>
                </div>

                {newStorageMode === 'device-only-ephemeral' && (
                  <div className="p-2.5 rounded bg-amber-950/40 border border-amber-500/40 text-[11px] text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <strong>Device-Only Security Warning:</strong> Ephemeral mode keeps this key
                      in volatile session memory only. It is never exported in project JSON/ZIP
                      bundles and is wiped on sign-out.
                    </span>
                  </div>
                )}

                {newAuthMode !== 'server-env' && (
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      API Key / Token (Encrypted with AES-256-GCM + User/Workspace AAD)
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type={showCredentialInput ? 'text' : 'password'}
                        value={newCredential}
                        onChange={(e) => setNewCredential(e.target.value)}
                        placeholder="sk-proj-..."
                        autoComplete="off"
                        className="w-full pl-2.5 pr-9 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCredentialInput((v) => !v)}
                        className="absolute right-2 text-zinc-400 hover:text-zinc-200"
                        title="Toggle visibility"
                      >
                        {showCredentialInput ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Monthly Budget Cap (USD)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      value={newMonthlyBudgetUsd}
                      onChange={(e) => setNewMonthlyBudgetUsd(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Budget Exhaustion Policy
                    </label>
                    <select
                      value={newBudgetMode}
                      onChange={(e) => setNewBudgetMode(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    >
                      <option value="fallback-to-secondary">Fallback to Secondary</option>
                      <option value="hard-stop">Hard Stop Requests</option>
                      <option value="warn-only">Warn Only</option>
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!ssrfLiveCheck.allowed || isMutating}
                  className="w-full py-2 px-4 rounded-lg bg-[#F06424] hover:bg-[#e05617] disabled:opacity-40 text-xs font-bold text-white transition-colors"
                >
                  Save Connection to Encrypted Vault
                </button>
              </form>
            </div>

            {/* Right Column: Active Connections, Vault Lifecycle & Connection Probe */}
            <div className="lg:col-span-7 space-y-5">
              <section className="bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                    Workspace Connections ({connections.length})
                  </h2>
                  <span className="text-[11px] text-zinc-400">
                    Raw keys are never returned after save
                  </span>
                </div>

                <div className="space-y-2.5">
                  {connections.map((conn) => {
                    const isSelected = selectedConnection?.id === conn.id;
                    return (
                      <div
                        key={conn.id}
                        onClick={() => setSelectedConnectionId(conn.id)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-zinc-900 border-[#F06424]'
                            : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white">{conn.label}</span>
                            <span className="px-2 py-0.5 text-[10px] font-mono bg-zinc-800 text-zinc-300 rounded">
                              {conn.protocol}
                            </span>
                            <span className="px-2 py-0.5 text-[10px] font-mono bg-zinc-800 text-[#F06424] rounded">
                              {conn.modelId}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {conn.credentialStatus === 'requires-reentry' && (
                              <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded">
                                Re-entry Required
                              </span>
                            )}
                            {conn.lastTestStatus === 'Verified' ? (
                              <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded">
                                Probe Verified
                              </span>
                            ) : conn.lastTestStatus === 'Failed' ? (
                              <span className="px-2 py-0.5 text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 rounded">
                                Probe Failed
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 text-[10px] font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700 rounded">
                                Not tested
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteConnection(conn.id);
                              }}
                              className="p-1 text-zinc-500 hover:text-rose-400"
                              title="Delete connection"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-zinc-400 font-mono">
                          <div>
                            <span className="text-zinc-500">Endpoint:</span>{' '}
                            <span className="text-zinc-300">{conn.baseUrl}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Key:</span>{' '}
                            <span className="text-zinc-200">{conn.maskedCredential}</span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Vault Status:</span>{' '}
                            <span
                              className={
                                conn.credentialStatus === 'revoked'
                                  ? 'text-rose-400'
                                  : conn.credentialStatus === 'requires-reentry'
                                  ? 'text-amber-300'
                                  : 'text-emerald-400'
                              }
                            >
                              {conn.credentialStatus} (v{conn.keyVersion})
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500">Budget:</span>{' '}
                            <span className="text-zinc-300">
                              ${conn.budgetPolicy.spentCurrentMonthUsd.toFixed(2)} / $
                              {conn.budgetPolicy.monthlyLimitUsd}
                            </span>
                          </div>
                        </div>

                        {conn.lastSanitizedError && (
                          <div className="mt-2 p-2 rounded bg-rose-950/40 border border-rose-500/30 text-[11px] text-rose-300 font-mono">
                            [{conn.lastSanitizedError.code}] {conn.lastSanitizedError.message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Selected Connection Vault & Probe Inspector */}
              {selectedConnection && (
                <section className="bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                        Connection Diagnostics & Secret Lifecycle: {selectedConnection.label}
                      </h3>
                      <p className="text-[11px] text-zinc-400">
                        AAD Scope:{' '}
                        <code className="text-zinc-300">
                          {selectedConnection.ownerUid}:{selectedConnection.workspaceId}:
                          {selectedConnection.id}:{selectedConnection.protocol}
                        </code>
                      </p>
                    </div>
                  </div>

                  {selectedConnection.credentialStatus === 'requires-reentry' && (
                    <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <strong>Credential Re-entry Required:</strong> This connection record and
                        its routing assignments were preserved, but its stored ciphertext cannot be
                        decrypted under the active <code className="font-mono">SOWVEIL_MASTER_VAULT_KEY</code>.
                        Enter a fresh API key below and click <strong>Rotate Key</strong> to restore
                        live requests.
                      </div>
                    </div>
                  )}

                  {/* Secret Rotation & Revocation Controls */}
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-zinc-900/70 p-3 rounded-lg border border-zinc-800">
                    <div className="sm:col-span-6">
                      <input
                        type="password"
                        value={rotateKeyInput}
                        onChange={(e) => setRotateKeyInput(e.target.value)}
                        placeholder="Enter new API key to rotate vault version..."
                        autoComplete="off"
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-950 border border-zinc-700 rounded text-zinc-100"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => void handleRotateCredential()}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-100 border border-zinc-700 disabled:opacity-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> Rotate Key
                      </button>
                    </div>
                    <div className="sm:col-span-3">
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => void handleRevokeCredential()}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-rose-950/60 hover:bg-rose-900/70 text-xs font-semibold text-rose-200 border border-rose-500/30 disabled:opacity-50"
                      >
                        <Lock className="w-3.5 h-3.5" /> Revoke Key
                      </button>
                    </div>
                  </div>

                  {/* Live Capability Probe Controls */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-300">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={probeStructuredOutput}
                          onChange={(e) => setProbeStructuredOutput(e.target.checked)}
                        />
                        Probe Structured JSON
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={probeTools}
                          onChange={(e) => setProbeTools(e.target.checked)}
                        />
                        Probe Tool Calling
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={probeVision}
                          onChange={(e) => setProbeVision(e.target.checked)}
                        />
                        Probe Vision (1x1 PNG)
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={probeStreaming}
                          onChange={(e) => setProbeStreaming(e.target.checked)}
                        />
                        Probe SSE Streaming
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => void handleRunProbe()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white disabled:opacity-50"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Test Connection & Verify Capabilities
                      </button>
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => void handleRunProbe('401_UNAUTHORIZED')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 border border-zinc-700 disabled:opacity-50"
                      >
                        Simulate 401 Auth Failure
                      </button>
                      <button
                        type="button"
                        disabled={isMutating}
                        onClick={() => void handleRunProbe('429_QUOTA_EXCEEDED')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 border border-zinc-700 disabled:opacity-50"
                      >
                        Simulate 429 Quota Error
                      </button>
                    </div>
                  </div>

                  {lastProbePreview && (
                    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span className="font-semibold text-zinc-300">
                          Redacted Protocol Wire Preview ({selectedConnection.protocol})
                        </span>
                        <span className="font-mono text-emerald-400">
                          {lastProbePreview.method} {lastProbePreview.url}
                        </span>
                      </div>
                      <pre className="text-[10px] font-mono text-zinc-300 overflow-x-auto max-h-40">
                        {JSON.stringify(
                          {
                            headers: lastProbePreview.redactedHeaders,
                            body: lastProbePreview.bodySummary,
                          },
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: CAPABILITY REGISTRY (14 SCOPES) */}
        {activeTab === 'capabilities' && selectedConnection && (
          <section className="bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white">
                  Capability Registry Matrix — {selectedConnection.label}
                </h2>
                <p className="text-xs text-zinc-400">
                  Capabilities are never inferred as Verified from brand name alone. Manual
                  User-asserted overrides carry an explicit runtime warning.
                </p>
              </div>
              <select
                value={selectedConnection.id}
                onChange={(e) => setSelectedConnectionId(e.target.value)}
                className="px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({c.modelId})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ALL_MODEL_CAPABILITY_KEYS.map((capKey) => {
                const entry = selectedConnection.capabilities[capKey];
                return (
                  <div
                    key={capKey}
                    className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800 flex flex-col justify-between gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-bold text-zinc-100">
                        {capKey}
                      </span>
                      {renderCapabilityBadge(entry.state)}
                    </div>
                    <p className="text-[11px] text-zinc-400">{entry.probeEvidence}</p>
                    {entry.userOverrideWarning && (
                      <div className="p-2 rounded bg-amber-950/40 border border-amber-500/30 text-[10px] text-amber-300">
                        {entry.userOverrideWarning}
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-1 border-t border-zinc-800/80 text-[10px] text-zinc-500">
                      <span>
                        {entry.lastTestedAt
                          ? `Tested: ${new Date(entry.lastTestedAt).toLocaleTimeString()}`
                          : 'Never probed'}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => void handleCapabilityOverride(capKey, 'User-asserted')}
                          className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-300 disabled:opacity-50"
                        >
                          Assert Override
                        </button>
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => void handleCapabilityOverride(capKey, 'Unsupported')}
                          className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-rose-300 disabled:opacity-50"
                        >
                          Mark Unsupported
                        </button>
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => void handleCapabilityOverride(capKey, 'Not tested')}
                          className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* TAB 3: TASK ROUTING PROFILES (8 TASKS) */}
        {activeTab === 'routing' && (
          <section className="bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-white">
                Multi-Model Task Routing Profiles (8 Specialized Tasks)
              </h2>
              <p className="text-xs text-zinc-400">
                Route high-complexity architecture and shot planning to flagship reasoning models
                (e.g., Gemini 4 Argon / Claude Sonnet / o3-mini) and routine tagging to low-latency
                models (e.g., Gemini 3.8 Flash).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ALL_HUB_TASK_TYPES.map((taskKey) => {
                const profile = routingProfiles[taskKey];
                const readiness = evaluateRoutingReadiness(profile, connectionsMap);
                return (
                  <div
                    key={taskKey}
                    className="p-3.5 rounded-lg bg-zinc-900/70 border border-zinc-800 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-white">{profile.label}</span>
                        <p className="text-[11px] text-zinc-400">{profile.description}</p>
                      </div>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${
                          readiness.ready
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                        }`}
                      >
                        {readiness.ready ? 'Ready' : 'Blocked'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {profile.requiredCapabilities.map((reqCap) => (
                        <span
                          key={reqCap}
                          className="px-1.5 py-0.5 text-[10px] font-mono bg-zinc-800 text-zinc-300 rounded"
                        >
                          req: {reqCap}
                        </span>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">
                          Primary Connection
                        </label>
                        <select
                          value={profile.primaryConnectionId || ''}
                          disabled={isMutating}
                          onChange={(e) =>
                            void handleUpdateRoutingProfile(taskKey, {
                              primaryConnectionId: e.target.value || null,
                            })
                          }
                          className="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-700 rounded text-zinc-100"
                        >
                          <option value="">None</option>
                          {connections.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-zinc-400 mb-1">
                          Fallback Connection
                        </label>
                        <select
                          value={profile.fallbackConnectionId || ''}
                          disabled={isMutating}
                          onChange={(e) =>
                            void handleUpdateRoutingProfile(taskKey, {
                              fallbackConnectionId: e.target.value || null,
                            })
                          }
                          className="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-700 rounded text-zinc-100"
                        >
                          <option value="">None</option>
                          {connections.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {readiness.warnings.length > 0 && (
                      <div className="p-2 rounded bg-amber-950/30 border border-amber-500/30 text-[10px] text-amber-200 space-y-0.5">
                        {readiness.warnings.map((w, idx) => (
                          <div key={idx}>• {w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* TAB 4: EXTENSIONS & SKILL SANDBOX */}
        {activeTab === 'extensions' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleRegisterExtension}
              className="lg:col-span-5 bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-3.5"
            >
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <Boxes className="w-3.5 h-3.5 text-[#F06424]" />
                Register Sandboxed Extension / Custom Skill
              </h2>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Imported repositories, skills, markdown instructions, and docs websites are wrapped
                in an <code className="text-zinc-200">&lt;untrusted_extension_data&gt;</code>{' '}
                envelope and validated in an isolated sandbox with zero secret access.
              </p>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">Extension Name</label>
                <input
                  type="text"
                  value={extName}
                  onChange={(e) => setExtName(e.target.value)}
                  placeholder="e.g., Custom Alight Curve Skill"
                  className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Source Kind</label>
                  <select
                    value={extKind}
                    onChange={(e) => setExtKind(e.target.value as ExtensionPackageKind)}
                    className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                  >
                    <option value="github-repo">GitHub Repository (Pinned)</option>
                    <option value="skill-folder">Skill Folder</option>
                    <option value="instruction-file">Instruction Markdown</option>
                    <option value="docs-website">Documentation Website</option>
                    <option value="zip-package">Uploaded ZIP Package</option>
                    <option value="api-tool">External API Connector</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Commit / Release Pin
                  </label>
                  <input
                    type="text"
                    value={extCommitPin}
                    onChange={(e) => setExtCommitPin(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    HTTPS Source URL
                  </label>
                  <input
                    type="text"
                    value={extSourceUrl}
                    onChange={(e) => setExtSourceUrl(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">License</label>
                  <input
                    type="text"
                    value={extLicense}
                    onChange={(e) => setExtLicense(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Requested Permissions (Risky scopes require explicit approval)
                </label>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  {(
                    [
                      'read-project',
                      'read-catalog',
                      'propose-commands',
                      'write-project',
                      'network-egress',
                      'destructive-ops',
                    ] as ExtensionPermissionScope[]
                  ).map((perm) => {
                    const checked = extPermissions.includes(perm);
                    const isRisky = RISKY_EXTENSION_PERMISSIONS.has(perm);
                    return (
                      <label
                        key={perm}
                        className="flex items-center gap-1.5 p-1.5 rounded bg-zinc-900 border border-zinc-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setExtPermissions((prev) => [...prev, perm]);
                            } else {
                              setExtPermissions((prev) => prev.filter((p) => p !== perm));
                            }
                          }}
                        />
                        <span className={isRisky ? 'text-amber-300 font-mono' : 'text-zinc-300 font-mono'}>
                          {perm}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">
                  Skill Instructions / Manifest Content (Scanned for prompt injection)
                </label>
                <textarea
                  rows={3}
                  value={extManifestContent}
                  onChange={(e) => setExtManifestContent(e.target.value)}
                  placeholder="Paste SKILL.md or package manifest..."
                  className="w-full p-2 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={extExplicitApproval}
                  onChange={(e) => setExtExplicitApproval(e.target.checked)}
                />
                Grant explicit user approval for requested write/network permissions
              </label>

              <button
                type="submit"
                disabled={isMutating}
                className="w-full py-2 px-4 rounded-lg bg-[#F06424] hover:bg-[#e05617] disabled:opacity-50 text-xs font-bold text-white"
              >
                Inspect in Sandbox & Register Extension
              </button>
            </form>

            <div className="lg:col-span-7 space-y-3">
              {extensions.map((ext) => {
                const latestRun = ext.validationRuns[0];
                return (
                  <div
                    key={ext.id}
                    className="bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{ext.name}</span>
                          <span className="px-2 py-0.5 text-[10px] font-mono bg-zinc-800 text-zinc-300 rounded">
                            {ext.kind} · v{ext.version}
                          </span>
                          <span className="px-2 py-0.5 text-[10px] font-mono bg-zinc-900 text-zinc-400 border border-zinc-800 rounded">
                            pin: {ext.commitOrReleasePin}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                          sha256: {ext.checksumSha256.slice(0, 24)}… · License: {ext.license}
                        </p>
                      </div>

                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${
                          ext.installState === 'installed-enabled'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : ext.installState === 'quarantined'
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        }`}
                      >
                        {ext.installState}
                      </span>
                    </div>

                    {latestRun && (
                      <div className="p-2.5 rounded bg-zinc-900/80 border border-zinc-800 text-[11px] space-y-1">
                        <div className="flex items-center justify-between text-zinc-300">
                          <span className="font-semibold">
                            Sandbox Run ({latestRun.isolatedFilesystemScope})
                          </span>
                          <span className="font-mono text-[10px] text-zinc-400">
                            CPU {latestRun.cpuTimeMs}ms · Mem {latestRun.memoryLimitMb}MB ·
                            Secrets Exposed: {latestRun.secretsExposedCount}
                          </span>
                        </div>
                        <p className="text-zinc-400">{latestRun.summary}</p>
                        {latestRun.flaggedRisks.length > 0 && (
                          <div className="text-rose-300 font-mono text-[10px] space-y-0.5 pt-1">
                            {latestRun.flaggedRisks.map((risk, i) => (
                              <div key={i}>• {risk}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap gap-1">
                        {ext.requestedPermissions.map((p) => (
                          <span
                            key={p}
                            className={`px-2 py-0.5 text-[10px] font-mono rounded ${
                              ext.approvedPermissions.includes(p)
                                ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-950/50 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {p} ({ext.approvedPermissions.includes(p) ? 'approved' : 'pending'})
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {ext.permissionDiff.requiresExplicitApproval &&
                          !ext.explicitApprovalGranted && (
                            <button
                              type="button"
                              disabled={isMutating}
                              onClick={() => void handleApproveExtensionPermissions(ext)}
                              className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-[11px] font-semibold text-white disabled:opacity-50"
                            >
                              Approve Risky Scope
                            </button>
                          )}
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => void handleToggleExtensionState(ext)}
                          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 disabled:opacity-50"
                        >
                          {ext.installState === 'installed-enabled' ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => void handleSimulateExtensionUpdate(ext)}
                          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-zinc-200 disabled:opacity-50"
                        >
                          Update Pin
                        </button>
                        {ext.versionHistory.length > 1 && (
                          <button
                            type="button"
                            disabled={isMutating}
                            onClick={() => void handleRollbackExtension(ext)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] text-amber-300 disabled:opacity-50"
                          >
                            <RotateCcw className="w-3 h-3" /> Rollback
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isMutating}
                          onClick={() => void handleUninstallExtension(ext.id)}
                          className="px-2.5 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-[11px] text-rose-200 disabled:opacity-50"
                        >
                          Uninstall
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 5: TYPED AI TOOL REGISTRY */}
        {activeTab === 'tool-registry' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                Registered Server-Enforced AI Tools ({REGISTERED_AI_TOOLS.length})
              </h2>
              <p className="text-xs text-zinc-400">
                Models never receive direct database or filesystem access. Every tool invocation
                validates input schema, project ownership, permission scope, and destructive
                approval tokens on the server.
              </p>

              <div className="space-y-2.5">
                {REGISTERED_AI_TOOLS.map((tool) => {
                  const selected = selectedToolId === tool.id;
                  return (
                    <div
                      key={tool.id}
                      onClick={() => setSelectedToolId(tool.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                        selected
                          ? 'bg-zinc-900 border-[#F06424]'
                          : 'bg-[#18191C] border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-bold text-white">
                          {tool.id}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-mono rounded ${
                            tool.sideEffectClassification === 'destructive-gated'
                              ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                              : tool.sideEffectClassification === 'reversible-mutation'
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          }`}
                        >
                          {tool.sideEffectClassification}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1">{tool.description}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-400">
                        <span>perms: [{tool.requiredPermissionScope.join(', ')}]</span>
                        <span>·</span>
                        <span>timeout: {tool.timeoutMs}ms</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-6 space-y-4">
              <form
                onSubmit={handleInvokeTool}
                className="bg-[#18191C] border border-zinc-800 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-[#F06424]" />
                    Policy-Enforced Tool Sandbox Runner
                  </h3>
                  <label className="inline-flex items-center gap-1.5 text-xs text-emerald-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={toolDryRun}
                      onChange={(e) => setToolDryRun(e.target.checked)}
                    />
                    Dry-Run Mode
                  </label>
                </div>

                <div className="text-xs font-mono text-[#F06424]">
                  Selected Tool: {selectedToolId}
                </div>

                {selectedToolId === 'script.analyze_coverage' ? (
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Script Text Input
                    </label>
                    <textarea
                      rows={3}
                      value={toolScriptText}
                      onChange={(e) => setToolScriptText(e.target.value)}
                      className="w-full p-2 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    />
                  </div>
                ) : selectedToolId === 'catalog.search_templates' ? (
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">
                      Catalog Search Query
                    </label>
                    <input
                      type="text"
                      value={toolCatalogQuery}
                      onChange={(e) => setToolCatalogQuery(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Project ID</label>
                      <input
                        type="text"
                        value={toolProjectId}
                        onChange={(e) => setToolProjectId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                      />
                    </div>
                    {selectedToolId === 'timeline.execute_command' && (
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">
                          Text Layer Value
                        </label>
                        <input
                          type="text"
                          value={toolTextValue}
                          onChange={(e) => setToolTextValue(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                        />
                      </div>
                    )}
                    {selectedToolId === 'project.delete_track_or_clip' && (
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">
                          Destructive Approval Token
                        </label>
                        <input
                          type="text"
                          value={toolApprovalToken}
                          onChange={(e) => setToolApprovalToken(e.target.value)}
                          placeholder="CONFIRM_DESTRUCTIVE_DELETE"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100"
                        />
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isMutating}
                  className="w-full py-2 px-4 rounded-lg bg-[#F06424] hover:bg-[#e05617] disabled:opacity-50 text-xs font-bold text-white"
                >
                  Invoke Tool via Server Policy Gate
                </button>
              </form>

              {lastToolResult && (
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-1.5">
                  <div className="text-[11px] font-semibold text-zinc-300">
                    Structured Tool Output / Policy Decision
                  </div>
                  <pre className="text-[10px] font-mono text-zinc-300 overflow-x-auto">
                    {JSON.stringify(lastToolResult, null, 2)}
                  </pre>
                </div>
              )}

              {toolAudits.length > 0 && (
                <div className="bg-[#18191C] border border-zinc-800 rounded-xl p-3 space-y-2">
                  <div className="text-xs font-bold text-zinc-300">
                    Tool Execution Audit Trail ({toolAudits.length})
                  </div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {toolAudits.map((aud) => (
                      <div
                        key={aud.id}
                        className="p-2 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono flex items-center justify-between gap-2"
                      >
                        <div>
                          <span className="text-zinc-200 font-bold">{aud.toolId}</span>{' '}
                          <span className="text-zinc-500">
                            ({aud.dryRun ? 'dry-run' : 'live'})
                          </span>
                          <div className="text-zinc-400 truncate max-w-xs">
                            {aud.redactedOutputSummary}
                          </div>
                        </div>
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            aud.status === 'allowed'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {aud.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
