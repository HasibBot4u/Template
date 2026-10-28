import React, { useMemo, useState } from 'react';
import {
  ALL_HUB_TASK_TYPES,
  ALL_MODEL_CAPABILITY_KEYS,
  buildDefaultRoutingProfiles,
  CapabilityVerificationState,
  createProviderConnectionRecord,
  evaluateRoutingReadiness,
  ExtensionPackageKind,
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
  updateExtensionPackage,
  validateCustomEndpointSsrf,
} from '../services/providerHubEngine';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Cpu,
  GitBranch,
  KeyRound,
  Lock,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';

interface ProviderHubWorkspaceProps {
  userUid?: string;
  onNotify?: (message: string, tone?: 'info' | 'warning' | 'error' | 'success') => void;
}

type HubWorkspaceTab =
  | 'connections'
  | 'capabilities'
  | 'routing'
  | 'extensions'
  | 'tool-registry';

export const ProviderHubWorkspace: React.FC<ProviderHubWorkspaceProps> = ({
  userUid = 'user_studio_creator',
  onNotify,
}) => {
  const [activeTab, setActiveTab] = useState<HubWorkspaceTab>('connections');

  // Seed initial connections (Argon & Flash) in 'Not tested' capability state
  const [connections, setConnections] = useState<ProviderConnectionRecord[]>(() => {
    const argon = createProviderConnectionRecord({
      ownerUid: userUid,
      label: 'Gemini 4 Argon (High-Complexity Architecture & Director)',
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
    const flash = createProviderConnectionRecord({
      ownerUid: userUid,
      label: 'Gemini 3.8 Flash (Low-Latency Routine & Tagging)',
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
      fallbackConnectionId: argon.id,
    });
    return [argon, flash];
  });

  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(
    () => connections[0]?.id || ''
  );

  // Connection Wizard Form State
  const [wizardLabel, setWizardLabel] = useState('OpenAI GPT-4o Production Gateway');
  const [wizardBrand, setWizardBrand] = useState('OpenAI');
  const [wizardProtocol, setWizardProtocol] = useState<HubProviderProtocol>(
    'openai-chat-completions'
  );
  const [wizardBaseUrl, setWizardBaseUrl] = useState('https://api.openai.com');
  const [wizardApiPath, setWizardApiPath] = useState('/v1/chat/completions');
  const [wizardModelId, setWizardModelId] = useState('gpt-4o');
  const [wizardAuthMode, setWizardAuthMode] = useState<HubAuthMode>('bearer');
  const [wizardCredentialInput, setWizardCredentialInput] = useState('');
  const [wizardStorageMode, setWizardStorageMode] = useState<SecretStorageMode>(
    'server-encrypted-vault'
  );
  const [wizardTimeoutMs, setWizardTimeoutMs] = useState(15000);
  const [wizardBudgetLimitUsd, setWizardBudgetLimitUsd] = useState(25);
  const [wizardBudgetMode, setWizardBudgetMode] = useState<
    'hard-stop' | 'fallback-to-secondary' | 'warn-only'
  >('fallback-to-secondary');
  const [wizardError, setWizardError] = useState<string | null>(null);

  // Probe options
  const [probeTools, setProbeTools] = useState(true);
  const [probeStructuredOutput, setProbeStructuredOutput] = useState(true);
  const [probeVision, setProbeVision] = useState(false);
  const [probeStreaming, setProbeStreaming] = useState(true);
  const [lastProbePreview, setLastProbePreview] = useState<{
    url: string;
    method: string;
    redactedHeaders: Record<string, string>;
    bodySummary: Record<string, unknown>;
  } | null>(null);

  // Rotate key input
  const [rotateKeyValue, setRotateKeyValue] = useState('');

  // Task Routing Profiles State
  const [routingProfiles, setRoutingProfiles] = useState<
    Record<HubTaskType, TaskRoutingProfile>
  >(() => buildDefaultRoutingProfiles(connections));

  // Extensions Workspace State
  const [extensions, setExtensions] = useState<ExtensionPackageRecord[]>(() => [
    registerExtensionPackage({
      ownerUid: userUid,
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
    }),
    registerExtensionPackage({
      ownerUid: userUid,
      name: 'External Motion LUT & Shader Repo',
      kind: 'github-repo',
      sourceUrl: 'https://github.com/sowveil-community/mobile-lut-pack',
      commitOrReleasePin: 'v2.0.1-release',
      version: '2.0.1',
      license: 'Apache-2.0',
      dependencies: ['gl-matrix@3.4.3'],
      declaredCapabilities: ['color-grade-lut', 'shader-pass'],
      requestedPermissions: ['read-project', 'propose-commands', 'write-project'],
      rawInstructionOrManifestContent:
        'Applies LUT color grading curves to canonical adjustment tracks.',
      explicitApprovalGranted: false,
    }),
  ]);

  const [extName, setExtName] = useState('');
  const [extKind, setExtKind] = useState<ExtensionPackageKind>('github-repo');
  const [extSourceUrl, setExtSourceUrl] = useState('https://github.com/example/motion-skill');
  const [extCommitPin, setExtCommitPin] = useState('main-9f8e7d6c');
  const [extLicense, setExtLicense] = useState('MIT');
  const [extContent, setExtContent] = useState(
    'Skill manifest: suggests pacing markers for 9:16 product reels.'
  );
  const [extReqWrite, setExtReqWrite] = useState(false);
  const [extReqNetwork, setExtReqNetwork] = useState(false);
  const [extExplicitApprove, setExtExplicitApprove] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);

  // Tool Registry Interactive Simulator State
  const [selectedToolId, setSelectedToolId] = useState<string>(
    REGISTERED_AI_TOOLS[0].id
  );
  const [toolDryRun, setToolDryRun] = useState<boolean>(true);
  const [toolInputJson, setToolInputJson] = useState<string>(
    JSON.stringify({ projectId: 'proj_canonical_01' }, null, 2)
  );
  const [toolAuditLog, setToolAuditLog] = useState<ToolExecutionAuditRecord[]>([]);
  const [lastToolResponse, setLastToolResponse] = useState<Record<string, unknown> | null>(
    null
  );

  const selectedConnection = useMemo(
    () => connections.find((c) => c.id === selectedConnectionId) || connections[0] || null,
    [connections, selectedConnectionId]
  );

  const connectionsById = useMemo(
    () => new Map(connections.map((c) => [c.id, c])),
    [connections]
  );

  const liveSsrfCheck = useMemo(
    () => validateCustomEndpointSsrf(wizardBaseUrl),
    [wizardBaseUrl]
  );

  const applyCatalogPresetToWizard = (presetId: string) => {
    const preset = PREPOPULATED_MODEL_CATALOG.find((p) => p.presetId === presetId);
    if (!preset) return;
    setWizardLabel(preset.label);
    setWizardBrand(preset.providerBrand);
    setWizardProtocol(preset.protocol);
    setWizardBaseUrl(preset.defaultBaseUrl);
    setWizardApiPath(preset.defaultApiPath);
    setWizardModelId(preset.modelId);
    setWizardAuthMode(preset.recommendedAuthMode);
    setWizardError(null);
  };

  const handleCreateConnection = (e: React.FormEvent) => {
    e.preventDefault();
    setWizardError(null);

    try {
      const created = createProviderConnectionRecord({
        ownerUid: userUid,
        label: wizardLabel,
        providerBrand: wizardBrand,
        protocol: wizardProtocol,
        baseUrl: wizardBaseUrl,
        endpointSettings: { apiPath: wizardApiPath },
        modelId: wizardModelId,
        authMode: wizardProtocol === 'google-gemini' ? 'server-env' : wizardAuthMode,
        credential: wizardProtocol === 'google-gemini' ? undefined : wizardCredentialInput,
        storageMode: wizardStorageMode,
        timeoutMs: wizardTimeoutMs,
        budgetPolicy: {
          mode: wizardBudgetMode,
          monthlyLimitUsd: wizardBudgetLimitUsd,
          spentCurrentMonthUsd: 0,
          maxPerRequestUsd: 0.5,
          rateLimitRpm: 60,
        },
      });
      setConnections((prev) => [created, ...prev]);
      setSelectedConnectionId(created.id);
      setWizardCredentialInput('');
      onNotify?.(
        `Saved provider connection "${created.label}" (${created.maskedCredential}). Capabilities set to Not tested until probed.`,
        'success'
      );
    } catch (err: any) {
      const msg = err?.message || 'Failed to create provider connection.';
      setWizardError(msg);
      onNotify?.(msg, 'error');
    }
  };

  const handleRunProbe = (conn: ProviderConnectionRecord) => {
    const result = probeProviderConnection(conn, {
      probeTools,
      probeStructuredOutput,
      probeVision,
      probeStreaming,
    });
    setConnections((prev) =>
      prev.map((c) => (c.id === conn.id ? result.updatedConnection : c))
    );
    setLastProbePreview(result.formattedProbeRequestPreview);
    if (result.probePassed) {
      onNotify?.(
        `Connection "${conn.label}" verified (${result.verifiedCapabilities.join(', ')}).`,
        'success'
      );
    } else {
      onNotify?.(
        `Probe failed for "${conn.label}": ${result.sanitizedError?.code} — ${result.sanitizedError?.message}`,
        'error'
      );
    }
  };

  const handleCapabilityOverride = (
    conn: ProviderConnectionRecord,
    cap: ModelCapabilityKey,
    nextState: 'User-asserted' | 'Unsupported' | 'Not tested'
  ) => {
    const updated = overrideConnectionCapabilityState(
      conn,
      cap,
      nextState,
      'Manual operator override in Capability Registry'
    );
    setConnections((prev) => prev.map((c) => (c.id === conn.id ? updated : c)));
    onNotify?.(
      `Set capability "${cap}" on "${conn.label}" to ${nextState}.`,
      nextState === 'User-asserted' ? 'warning' : 'info'
    );
  };

  const handleRotateCredential = (conn: ProviderConnectionRecord) => {
    if (!rotateKeyValue.trim()) {
      onNotify?.('Enter a new credential value before rotating.', 'warning');
      return;
    }
    try {
      const updated = rotateConnectionCredential(conn, rotateKeyValue);
      setConnections((prev) => prev.map((c) => (c.id === conn.id ? updated : c)));
      setRotateKeyValue('');
      onNotify?.(
        `Rotated credential for "${conn.label}" to key version v${updated.keyVersion} (${updated.maskedCredential}).`,
        'success'
      );
    } catch (err: any) {
      onNotify?.(err?.message || 'Rotation failed.', 'error');
    }
  };

  const handleRevokeCredential = (conn: ProviderConnectionRecord) => {
    const updated = revokeConnectionCredential(conn);
    setConnections((prev) => prev.map((c) => (c.id === conn.id ? updated : c)));
    onNotify?.(`Revoked credential for "${conn.label}".`, 'warning');
  };

  const handleDeleteConnection = (connId: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== connId));
    onNotify?.('Deleted provider connection from vault.', 'info');
  };

  const handleRegisterExtension = (e: React.FormEvent) => {
    e.preventDefault();
    setExtError(null);
    const reqPerms: ExtensionPermissionScope[] = [
      'read-project',
      'read-catalog',
      'propose-commands',
    ];
    if (extReqWrite) reqPerms.push('write-project');
    if (extReqNetwork) reqPerms.push('network-egress');

    try {
      const created = registerExtensionPackage({
        ownerUid: userUid,
        name: extName || 'Custom Studio Skill Package',
        kind: extKind,
        sourceUrl: extSourceUrl,
        commitOrReleasePin: extCommitPin,
        version: '1.0.0',
        license: extLicense,
        dependencies: ['sowveil-canonical-sdk@2.0.0'],
        declaredCapabilities: ['custom-skill-extension'],
        requestedPermissions: reqPerms,
        rawInstructionOrManifestContent: extContent,
        explicitApprovalGranted: extExplicitApprove,
      });
      setExtensions((prev) => [created, ...prev]);
      setExtName('');
      onNotify?.(
        `Registered extension "${created.name}" (state: ${created.installState}, checksum: ${created.checksumSha256.slice(0, 10)}…).`,
        created.installState === 'quarantined' ? 'error' : 'success'
      );
    } catch (err: any) {
      setExtError(err?.message || 'Extension registration failed.');
      onNotify?.(err?.message || 'Extension registration failed.', 'error');
    }
  };

  const handleInvokeTool = (overrideToolId?: string) => {
    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(toolInputJson);
    } catch {
      onNotify?.('Invalid JSON in tool input payload.', 'error');
      return;
    }

    const targetId = overrideToolId || selectedToolId;
    const res = invokeRegisteredTool({
      ownerUid: userUid,
      toolId: targetId,
      input: parsedInput,
      dryRun: toolDryRun,
    });
    setToolAuditLog((prev) => [res.auditRecord, ...prev]);
    setLastToolResponse({
      allowed: res.allowed,
      status: res.status,
      output: res.output,
      error: res.error,
      auditRecord: res.auditRecord,
    });
    onNotify?.(
      res.allowed
        ? `Tool "${targetId}" executed (${toolDryRun ? 'Dry-Run' : 'Live'}).`
        : `Tool "${targetId}" blocked by policy: ${res.error?.code}`,
      res.allowed ? 'success' : 'error'
    );
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#2A231E] pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-[#B8AAA0]">
            <span>AI Provider Hub</span>
            <span aria-hidden="true">·</span>
            <span>AES-256-GCM Scoped Vault</span>
            <span aria-hidden="true">·</span>
            <span>SSRF & Sandbox Policy Enforced</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#F3EEE8] mt-1">
            Model Providers, Capability Registry, Extensions & Tool Governance
          </h1>
        </div>

        {/* Segmented Workspace Navigation */}
        <div
          role="tablist"
          aria-label="Provider Hub Sections"
          className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#141210] border border-[#2A231E]"
        >
          {(
            [
              { id: 'connections', label: 'Connections & Vault', icon: KeyRound },
              { id: 'capabilities', label: 'Capability Registry (14)', icon: Cpu },
              { id: 'routing', label: 'Task Routing (8)', icon: RouteIcon },
              { id: 'extensions', label: `Extensions (${extensions.length})`, icon: GitBranch },
              { id: 'tool-registry', label: `Tool Registry (${REGISTERED_AI_TOOLS.length})`, icon: Wrench },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-[#F06424] text-[#080707]'
                    : 'text-[#B8AAA0] hover:text-[#F3EEE8]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: CONNECTIONS & WIZARD */}
      {activeTab === 'connections' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Connection Wizard */}
          <div className="lg:col-span-5 rounded-xl border border-[#2A231E] bg-[#11100F] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#F3EEE8]">
                01. Multi-Protocol Connection Wizard
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#83766D]">
                HTTPS + SSRF Guard
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#B8AAA0]">
                Load Prepopulated Protocol Preset
              </label>
              <select
                aria-label="Load Prepopulated Protocol Preset"
                onChange={(e) => applyCatalogPresetToWizard(e.target.value)}
                defaultValue=""
                className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-2 text-xs text-[#F3EEE8]"
              >
                <option value="" disabled>
                  Select a model preset…
                </option>
                {PREPOPULATED_MODEL_CATALOG.map((p) => (
                  <option key={p.presetId} value={p.presetId}>
                    {p.label} [{p.protocol}]
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[#83766D]">
                Note: Prepopulated models (including Gemini 4 Argon and Gemini 3.8 Flash) do not
                assume account quota or permission. All capabilities start as Not tested.
              </p>
            </div>

            <form onSubmit={handleCreateConnection} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Connection Label</label>
                  <input
                    type="text"
                    required
                    value={wizardLabel}
                    onChange={(e) => setWizardLabel(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Protocol Adapter</label>
                  <select
                    aria-label="Protocol Adapter"
                    value={wizardProtocol}
                    onChange={(e) =>
                      setWizardProtocol(e.target.value as HubProviderProtocol)
                    }
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                  >
                    <option value="google-gemini">google-gemini (Google GenAI REST/SDK)</option>
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
                      openai-compatible-variant (OpenRouter/vLLM/Groq)
                    </option>
                    <option value="azure-openai">azure-openai (Azure Deployments)</option>
                    <option value="custom-rest-adapter">
                      custom-rest-adapter (Custom JSON Contract)
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-[#B8AAA0] mb-1">
                    Base URL (HTTPS Required)
                  </label>
                  <input
                    type="text"
                    required
                    value={wizardBaseUrl}
                    onChange={(e) => setWizardBaseUrl(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs font-mono text-[#F3EEE8]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Endpoint Path</label>
                  <input
                    type="text"
                    value={wizardApiPath}
                    onChange={(e) => setWizardApiPath(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs font-mono text-[#F3EEE8]"
                  />
                </div>
              </div>

              {/* Live SSRF Validation Indicator */}
              <div
                className={`rounded-lg border px-3 py-2 text-xs flex items-center gap-2 ${
                  liveSsrfCheck.allowed
                    ? 'border-[#55B98B]/40 bg-[#55B98B]/10 text-[#55B98B]'
                    : 'border-[#F06464]/40 bg-[#F06464]/10 text-[#F06464]'
                }`}
              >
                {liveSsrfCheck.allowed ? (
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                )}
                <span>
                  {liveSsrfCheck.allowed
                    ? `SSRF Check Passed: ${liveSsrfCheck.hostname}:${liveSsrfCheck.port}`
                    : `SSRF Blocked (${liveSsrfCheck.errorCode}): ${liveSsrfCheck.reason}`}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Model ID</label>
                  <input
                    type="text"
                    required
                    value={wizardModelId}
                    onChange={(e) => setWizardModelId(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs font-mono text-[#F3EEE8]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Storage Policy</label>
                  <select
                    aria-label="Storage Policy"
                    value={wizardStorageMode}
                    onChange={(e) =>
                      setWizardStorageMode(e.target.value as SecretStorageMode)
                    }
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                  >
                    <option value="server-encrypted-vault">
                      Server Encrypted Vault (AES-256-GCM)
                    </option>
                    <option value="device-only-ephemeral">
                      Device-Only Ephemeral (Never Synced/Exported)
                    </option>
                  </select>
                </div>
              </div>

              {wizardStorageMode === 'device-only-ephemeral' && (
                <div className="rounded-lg border border-[#E4B45A]/40 bg-[#E4B45A]/10 p-2.5 text-xs text-[#E4B45A]">
                  Security Limitation: Device-only ephemeral credentials remain in volatile
                  memory for the current session only, are never backed up or exported in
                  project archives, and are wiped on reload/sign-out.
                </div>
              )}

              {wizardProtocol === 'google-gemini' ? (
                <div className="rounded-lg border border-[#342A24] bg-[#191614] p-3 text-xs text-[#B8AAA0]">
                  Google Gemini connections use server-side environment authentication (
                  <code className="text-[#F3EEE8]">GEMINI_API_KEY</code> in{' '}
                  <strong className="text-[#F3EEE8]">Settings &gt; Secrets</strong>) and never
                  request or expose keys in the browser.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#B8AAA0] mb-1">Auth Header Mode</label>
                    <select
                      aria-label="Auth Header Mode"
                      value={wizardAuthMode}
                      onChange={(e) => setWizardAuthMode(e.target.value as HubAuthMode)}
                      className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                    >
                      <option value="bearer">Authorization: Bearer</option>
                      <option value="x-api-key">x-api-key (Anthropic)</option>
                      <option value="api-key">api-key (Azure)</option>
                      <option value="custom-header">Custom Header</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[#B8AAA0] mb-1">
                      Provider Credential (Write-Only)
                    </label>
                    <input
                      type="password"
                      value={wizardCredentialInput}
                      onChange={(e) => setWizardCredentialInput(e.target.value)}
                      placeholder="Encrypted on save; never shown again"
                      className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs font-mono text-[#F3EEE8]"
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Timeout (ms)</label>
                  <input
                    type="number"
                    min={1000}
                    max={30000}
                    value={wizardTimeoutMs}
                    onChange={(e) => setWizardTimeoutMs(Number(e.target.value))}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#F3EEE8]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Monthly Cap ($)</label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={wizardBudgetLimitUsd}
                    onChange={(e) => setWizardBudgetLimitUsd(Number(e.target.value))}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs font-mono tabular-nums text-[#F3EEE8]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Budget Policy</label>
                  <select
                    aria-label="Budget Policy"
                    value={wizardBudgetMode}
                    onChange={(e) => setWizardBudgetMode(e.target.value as any)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-2 py-1.5 text-xs text-[#F3EEE8]"
                  >
                    <option value="fallback-to-secondary">Fallback</option>
                    <option value="hard-stop">Hard Stop</option>
                    <option value="warn-only">Warn Only</option>
                  </select>
                </div>
              </div>

              {wizardError && (
                <div className="text-xs text-[#F06464] bg-[#F06464]/10 border border-[#F06464]/40 rounded-lg p-2.5">
                  {wizardError}
                </div>
              )}

              <button
                type="submit"
                disabled={!liveSsrfCheck.allowed}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#F06424] hover:bg-[#E05514] disabled:opacity-40 text-[#080707] font-semibold text-xs transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Save Connection to Encrypted Vault</span>
              </button>
            </form>
          </div>

          {/* Right: Active Connections & Diagnostic Probes */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-xl border border-[#2A231E] bg-[#11100F] p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-[#F3EEE8]">
                  02. Configured Connections & Live Protocol Prober
                </h2>
                <div className="flex flex-wrap items-center gap-3 text-xs text-[#B8AAA0]">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={probeTools}
                      onChange={(e) => setProbeTools(e.target.checked)}
                    />
                    <span>Probe Tools</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={probeStructuredOutput}
                      onChange={(e) => setProbeStructuredOutput(e.target.checked)}
                    />
                    <span>Probe JSON Schema</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={probeVision}
                      onChange={(e) => setProbeVision(e.target.checked)}
                    />
                    <span>Probe Vision</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={probeStreaming}
                      onChange={(e) => setProbeStreaming(e.target.checked)}
                    />
                    <span>Probe Streaming</span>
                  </label>
                </div>
              </div>

              <div className="space-y-3">
                {connections.map((conn) => {
                  const isSelected = conn.id === selectedConnection?.id;
                  const verifiedCount = Object.values(conn.capabilities).filter(
                    (c) => c.state === 'Verified'
                  ).length;

                  return (
                    <div
                      key={conn.id}
                      onClick={() => setSelectedConnectionId(conn.id)}
                      className={`rounded-xl border p-4 cursor-pointer transition-colors space-y-3 ${
                        isSelected
                          ? 'border-[#F06424] bg-[#191614]'
                          : 'border-[#2A231E] bg-[#141210] hover:border-[#83766D]'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[#F3EEE8]">
                              {conn.label}
                            </span>
                            <span className="text-xs font-mono text-[#83766D]">
                              · {conn.protocol}
                            </span>
                          </div>
                          <div className="text-xs font-mono tabular-nums text-[#B8AAA0] mt-0.5">
                            Model: <span className="text-[#F3EEE8]">{conn.modelId}</span> ·
                            Endpoint: {conn.baseUrl} · Key:{' '}
                            <span className="text-[#E4B45A]">{conn.maskedCredential}</span> (v
                            {conn.keyVersion})
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs font-mono tabular-nums ${
                              conn.lastTestStatus === 'Verified'
                                ? 'text-[#55B98B]'
                                : conn.lastTestStatus === 'Failed'
                                ? 'text-[#F06464]'
                                : 'text-[#E4B45A]'
                            }`}
                          >
                            {conn.lastTestStatus} ({verifiedCount}/14 Verified)
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRunProbe(conn);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#F06424] text-[#080707] text-xs font-semibold hover:bg-[#E05514]"
                          >
                            <Play className="w-3 h-3" />
                            <span>Test Connection</span>
                          </button>
                        </div>
                      </div>

                      {conn.lastSanitizedError && (
                        <div className="rounded-lg border border-[#F06464]/40 bg-[#F06464]/10 p-2.5 text-xs font-mono text-[#F06464]">
                          [{conn.lastSanitizedError.code}] {conn.lastSanitizedError.message}
                        </div>
                      )}

                      {/* Key Lifecycle Actions (Rotate / Revoke / Delete) */}
                      <div
                        className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#2A231E]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2">
                          {conn.authMode !== 'server-env' && (
                            <>
                              <input
                                type="password"
                                placeholder="New key for rotation…"
                                value={isSelected ? rotateKeyValue : ''}
                                onChange={(e) => {
                                  setSelectedConnectionId(conn.id);
                                  setRotateKeyValue(e.target.value);
                                }}
                                className="rounded border border-[#342A24] bg-[#0B0A09] px-2 py-1 text-xs font-mono text-[#F3EEE8]"
                              />
                              <button
                                type="button"
                                onClick={() => handleRotateCredential(conn)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#342A24] bg-[#11100F] hover:border-[#83766D] text-xs text-[#F3EEE8]"
                              >
                                <RefreshCw className="w-3 h-3" />
                                <span>Rotate</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRevokeCredential(conn)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#E4B45A]/50 bg-[#E4B45A]/10 text-xs text-[#E4B45A]"
                              >
                                <Lock className="w-3 h-3" />
                                <span>Revoke</span>
                              </button>
                            </>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteConnection(conn.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[#F06464] hover:underline"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {lastProbePreview && (
                <div className="rounded-lg border border-[#342A24] bg-[#0B0A09] p-3 space-y-1.5">
                  <div className="text-xs font-semibold text-[#B8AAA0]">
                    Last Protocol Probe Request Preview (Credentials Redacted)
                  </div>
                  <pre className="text-[11px] font-mono text-[#F3EEE8] overflow-x-auto">
                    {JSON.stringify(lastProbePreview, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: 14-CAPABILITY REGISTRY */}
      {activeTab === 'capabilities' && selectedConnection && (
        <div className="rounded-xl border border-[#2A231E] bg-[#11100F] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#F3EEE8]">
                Model Capability Registry — {selectedConnection.label}
              </h2>
              <p className="text-xs text-[#B8AAA0]">
                Capabilities are never inferred solely from provider brand. Each capability is
                tracked as Verified, User-asserted, Unsupported, or Not tested.
              </p>
            </div>
            <select
              aria-label="Select Connection for Capability Registry"
              value={selectedConnection.id}
              onChange={(e) => setSelectedConnectionId(e.target.value)}
              className="rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({c.modelId})
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#2A231E] text-[#83766D]">
                  <th className="py-2 pr-3 font-medium">Capability</th>
                  <th className="py-2 px-3 font-medium">Verification State</th>
                  <th className="py-2 px-3 font-medium">Evidence & Override Warning</th>
                  <th className="py-2 px-3 font-medium">Retest / Expiry</th>
                  <th className="py-2 pl-3 font-medium text-right">Manual Override</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2A231E]">
                {ALL_MODEL_CAPABILITY_KEYS.map((capKey) => {
                  const entry = selectedConnection.capabilities[capKey];
                  const stateColor =
                    entry.state === 'Verified'
                      ? 'text-[#55B98B]'
                      : entry.state === 'User-asserted'
                      ? 'text-[#E4B45A]'
                      : entry.state === 'Unsupported'
                      ? 'text-[#F06464]'
                      : 'text-[#B8AAA0]';

                  return (
                    <tr key={capKey} className="hover:bg-[#191614]/60">
                      <td className="py-2.5 pr-3 font-mono text-[#F3EEE8]">{capKey}</td>
                      <td className={`py-2.5 px-3 font-semibold ${stateColor}`}>
                        {entry.state}
                      </td>
                      <td className="py-2.5 px-3 text-[#B8AAA0]">
                        <div>{entry.probeEvidence}</div>
                        {entry.userOverrideWarning && (
                          <div className="text-[11px] text-[#E4B45A] mt-0.5">
                            {entry.userOverrideWarning}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-[#83766D]">
                        {entry.expiresAt ? entry.expiresAt.slice(0, 10) : '—'}
                      </td>
                      <td className="py-2.5 pl-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          {(
                            ['User-asserted', 'Not tested', 'Unsupported'] as Array<
                              'User-asserted' | 'Not tested' | 'Unsupported'
                            >
                          ).map((st) => (
                            <button
                              key={st}
                              type="button"
                              onClick={() =>
                                handleCapabilityOverride(selectedConnection, capKey, st)
                              }
                              className={`px-2 py-1 rounded border text-[11px] ${
                                entry.state === st
                                  ? 'border-[#F06424] text-[#F06424] bg-[#F06424]/10'
                                  : 'border-[#342A24] text-[#B8AAA0] hover:text-[#F3EEE8]'
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: TASK ROUTING PROFILES */}
      {activeTab === 'routing' && (
        <div className="rounded-xl border border-[#2A231E] bg-[#11100F] p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-[#F3EEE8]">
              Task Routing Profiles (8 Specialized Production Stages)
            </h2>
            <p className="text-xs text-[#B8AAA0]">
              Route high-complexity architecture/planning to Argon or reasoning models, and
              routine tagging/asset matching to fast models with automatic fallback.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ALL_HUB_TASK_TYPES.map((taskKey) => {
              const profile = routingProfiles[taskKey];
              const readiness = evaluateRoutingReadiness(profile, connectionsById);

              return (
                <div
                  key={taskKey}
                  className="rounded-xl border border-[#2A231E] bg-[#141210] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-[#F3EEE8]">{profile.label}</div>
                      <div className="text-xs text-[#B8AAA0]">{profile.description}</div>
                    </div>
                    <span
                      className={`text-xs font-mono ${
                        readiness.ready ? 'text-[#55B98B]' : 'text-[#F06464]'
                      }`}
                    >
                      {readiness.ready ? 'Route Ready' : 'Incompatible'}
                    </span>
                  </div>

                  <div className="text-[11px] font-mono text-[#83766D]">
                    Required Capabilities: {profile.requiredCapabilities.join(' · ')}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-[#B8AAA0] mb-1">
                        Primary Model Connection
                      </label>
                      <select
                        aria-label={`${profile.label} Primary Connection`}
                        value={profile.primaryConnectionId || ''}
                        onChange={(e) =>
                          setRoutingProfiles((prev) => ({
                            ...prev,
                            [taskKey]: {
                              ...prev[taskKey],
                              primaryConnectionId: e.target.value || null,
                            },
                          }))
                        }
                        className="w-full rounded border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
                      >
                        {connections.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#B8AAA0] mb-1">
                        Fallback Connection
                      </label>
                      <select
                        aria-label={`${profile.label} Fallback Connection`}
                        value={profile.fallbackConnectionId || ''}
                        onChange={(e) =>
                          setRoutingProfiles((prev) => ({
                            ...prev,
                            [taskKey]: {
                              ...prev[taskKey],
                              fallbackConnectionId: e.target.value || null,
                            },
                          }))
                        }
                        className="w-full rounded border border-[#342A24] bg-[#191614] px-2.5 py-1.5 text-xs text-[#F3EEE8]"
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
                    <div className="space-y-1 text-[11px] text-[#E4B45A]">
                      {readiness.warnings.map((w, i) => (
                        <div key={i}>• {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: EXTENSIONS WORKSPACE */}
      {activeTab === 'extensions' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Register Extension Form */}
          <div className="lg:col-span-5 rounded-xl border border-[#2A231E] bg-[#11100F] p-5 space-y-4">
            <h2 className="text-sm font-bold text-[#F3EEE8]">
              Register Untrusted Skill, Repository, Docs Website or API
            </h2>
            <p className="text-xs text-[#B8AAA0]">
              Imported packages are treated as untrusted inputs, pinned to a commit/release,
              scanned for secret leaks or policy overrides, and isolated in a zero-secret
              sandbox.
            </p>

            <form onSubmit={handleRegisterExtension} className="space-y-3">
              <div>
                <label className="block text-xs text-[#B8AAA0] mb-1">Extension Name</label>
                <input
                  type="text"
                  required
                  value={extName}
                  onChange={(e) => setExtName(e.target.value)}
                  placeholder="e.g. Custom Beat-Sync Transition Pack"
                  className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">Source Kind</label>
                  <select
                    aria-label="Extension Source Kind"
                    value={extKind}
                    onChange={(e) => setExtKind(e.target.value as ExtensionPackageKind)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                  >
                    <option value="github-repo">GitHub Repository</option>
                    <option value="skill-folder">Skill Folder</option>
                    <option value="zip-package">ZIP Package</option>
                    <option value="instruction-file">Instruction File</option>
                    <option value="docs-website">Docs Website</option>
                    <option value="api-tool">External API / Tool</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">
                    Commit SHA / Release Pin
                  </label>
                  <input
                    type="text"
                    required
                    value={extCommitPin}
                    onChange={(e) => setExtCommitPin(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs font-mono text-[#F3EEE8]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-[#B8AAA0] mb-1">
                    Approved HTTPS Source URL
                  </label>
                  <input
                    type="text"
                    required
                    value={extSourceUrl}
                    onChange={(e) => setExtSourceUrl(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs font-mono text-[#F3EEE8]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#B8AAA0] mb-1">License</label>
                  <input
                    type="text"
                    value={extLicense}
                    onChange={(e) => setExtLicense(e.target.value)}
                    className="w-full rounded-lg border border-[#342A24] bg-[#191614] px-3 py-1.5 text-xs text-[#F3EEE8]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#B8AAA0] mb-1">
                  Manifest / Skill Instructions (Inspected by Sandbox)
                </label>
                <textarea
                  rows={3}
                  value={extContent}
                  onChange={(e) => setExtContent(e.target.value)}
                  className="w-full rounded-lg border border-[#342A24] bg-[#191614] p-2.5 text-xs font-mono text-[#F3EEE8]"
                />
              </div>

              <div className="space-y-1.5 rounded-lg border border-[#342A24] bg-[#191614] p-3 text-xs">
                <div className="font-semibold text-[#F3EEE8]">
                  Permission Scope & Risky Operation Gate
                </div>
                <label className="flex items-center gap-2 text-[#B8AAA0]">
                  <input
                    type="checkbox"
                    checked={extReqWrite}
                    onChange={(e) => setExtReqWrite(e.target.checked)}
                  />
                  <span>Request write-project permission (Risky — requires approval)</span>
                </label>
                <label className="flex items-center gap-2 text-[#B8AAA0]">
                  <input
                    type="checkbox"
                    checked={extReqNetwork}
                    onChange={(e) => setExtReqNetwork(e.target.checked)}
                  />
                  <span>Request network-egress permission (Risky — requires approval)</span>
                </label>
                <label className="flex items-center gap-2 text-[#E4B45A] pt-1">
                  <input
                    type="checkbox"
                    checked={extExplicitApprove}
                    onChange={(e) => setExtExplicitApprove(e.target.checked)}
                  />
                  <span>Grant explicit user approval for requested write/network permissions</span>
                </label>
              </div>

              {extError && (
                <div className="text-xs text-[#F06464] bg-[#F06464]/10 border border-[#F06464]/40 rounded-lg p-2.5">
                  {extError}
                </div>
              )}

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#F06424] text-[#080707] font-semibold text-xs hover:bg-[#E05514]"
              >
                <GitBranch className="w-4 h-4" />
                <span>Inspect in Sandbox & Register Extension</span>
              </button>
            </form>
          </div>

          {/* Registered Extensions List */}
          <div className="lg:col-span-7 space-y-4">
            {extensions.map((ext) => {
              const latestRun = ext.validationRuns[0];
              return (
                <div
                  key={ext.id}
                  className="rounded-xl border border-[#2A231E] bg-[#11100F] p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#F3EEE8]">{ext.name}</span>
                        <span className="text-xs font-mono text-[#83766D]">
                          · {ext.kind} · v{ext.version}
                        </span>
                      </div>
                      <div className="text-xs font-mono tabular-nums text-[#B8AAA0] mt-0.5">
                        Pin: <span className="text-[#F3EEE8]">{ext.commitOrReleasePin}</span> ·
                        SHA-256: {ext.checksumSha256.slice(0, 12)}… · License: {ext.license}
                      </div>
                    </div>

                    <span
                      className={`text-xs font-mono font-semibold ${
                        ext.installState === 'installed-enabled'
                          ? 'text-[#55B98B]'
                          : ext.installState === 'quarantined'
                          ? 'text-[#F06464]'
                          : 'text-[#E4B45A]'
                      }`}
                    >
                      {ext.installState}
                    </span>
                  </div>

                  {/* Permission Diff & Sandbox Telemetry */}
                  <div className="rounded-lg border border-[#2A231E] bg-[#141210] p-3 text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[#B8AAA0]">
                        Requested Permissions:{' '}
                        <span className="font-mono text-[#F3EEE8]">
                          {ext.requestedPermissions.join(', ')}
                        </span>
                      </span>
                      <span className="text-[#B8AAA0]">
                        Approved:{' '}
                        <span className="font-mono text-[#55B98B]">
                          {ext.approvedPermissions.join(', ') || 'none'}
                        </span>
                      </span>
                    </div>
                    {ext.permissionDiff.riskyPermissionsRequested.length > 0 && (
                      <div className="text-[#E4B45A] font-mono text-[11px]">
                        Risky Operations Flagged:{' '}
                        {ext.permissionDiff.riskyPermissionsRequested.join(', ')} (Explicit
                        Approval: {ext.explicitApprovalGranted ? 'Granted' : 'Pending'})
                      </div>
                    )}
                    {latestRun && (
                      <div className="text-[11px] font-mono tabular-nums text-[#83766D]">
                        Sandbox: scope={latestRun.isolatedFilesystemScope} · CPU=
                        {latestRun.cpuTimeMs}ms · MemLimit={latestRun.memoryLimitMb}MB ·
                        SecretsExposed={latestRun.secretsExposedCount} · {latestRun.summary}
                      </div>
                    )}
                  </div>

                  {/* Lifecycle Controls: Approve / Disable / Update / Rollback / Uninstall */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#2A231E]">
                    <div className="flex flex-wrap items-center gap-2">
                      {!ext.explicitApprovalGranted &&
                        ext.permissionDiff.riskyPermissionsRequested.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const updated = updateExtensionPackage(ext, {
                                explicitApprovalGranted: true,
                                installState: 'installed-enabled',
                              });
                              setExtensions((prev) =>
                                prev.map((item) => (item.id === ext.id ? updated : item))
                              );
                              onNotify?.(
                                `Approved permissions and enabled "${ext.name}".`,
                                'success'
                              );
                            }}
                            className="px-2.5 py-1 rounded bg-[#55B98B] text-[#080707] font-semibold text-xs"
                          >
                            Approve & Enable
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() => {
                          const nextState =
                            ext.installState === 'installed-enabled'
                              ? 'installed-disabled'
                              : 'installed-enabled';
                          const updated = updateExtensionPackage(ext, {
                            installState: nextState,
                          });
                          setExtensions((prev) =>
                            prev.map((item) => (item.id === ext.id ? updated : item))
                          );
                          onNotify?.(`Set "${ext.name}" to ${nextState}.`, 'info');
                        }}
                        className="px-2.5 py-1 rounded border border-[#342A24] bg-[#191614] text-xs text-[#F3EEE8]"
                      >
                        {ext.installState === 'installed-enabled' ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const nextVer = `1.${ext.versionHistory.length + 1}.0`;
                          const updated = updateExtensionPackage(ext, {
                            version: nextVer,
                            commitOrReleasePin: `pin-${Date.now().toString(16).slice(-6)}`,
                          });
                          setExtensions((prev) =>
                            prev.map((item) => (item.id === ext.id ? updated : item))
                          );
                          onNotify?.(`Updated "${ext.name}" to v${nextVer}.`, 'info');
                        }}
                        className="px-2.5 py-1 rounded border border-[#342A24] bg-[#191614] text-xs text-[#F3EEE8]"
                      >
                        Simulate Version Update
                      </button>
                      {ext.versionHistory.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const rolled = rollbackExtensionPackage(ext);
                            setExtensions((prev) =>
                              prev.map((item) => (item.id === ext.id ? rolled : item))
                            );
                            onNotify?.(
                              `Rolled back "${ext.name}" to v${rolled.version} (${rolled.commitOrReleasePin}).`,
                              'warning'
                            );
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#E4B45A]/50 bg-[#E4B45A]/10 text-xs text-[#E4B45A]"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Rollback</span>
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setExtensions((prev) => prev.filter((item) => item.id !== ext.id));
                        onNotify?.(`Uninstalled extension "${ext.name}".`, 'info');
                      }}
                      className="inline-flex items-center gap-1 text-xs text-[#F06464] hover:underline"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Uninstall</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: TYPED TOOL REGISTRY */}
      {activeTab === 'tool-registry' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Tool List & Schemas */}
          <div className="lg:col-span-7 space-y-3">
            {REGISTERED_AI_TOOLS.map((tool) => {
              const isSelected = tool.id === selectedToolId;
              return (
                <div
                  key={tool.id}
                  onClick={() => {
                    setSelectedToolId(tool.id);
                    if (tool.id === 'project.inspect_state') {
                      setToolInputJson(
                        JSON.stringify({ projectId: 'proj_canonical_01' }, null, 2)
                      );
                    } else if (tool.id === 'script.analyze_coverage') {
                      setToolInputJson(
                        JSON.stringify(
                          {
                            scriptText:
                              'Scene 1: Hook opener. Scene 2: Live mobile canvas demo.',
                          },
                          null,
                          2
                        )
                      );
                    } else if (tool.id === 'catalog.search_templates') {
                      setToolInputJson(
                        JSON.stringify({ query: 'kinetic', moduleId: 'text-animation' }, null, 2)
                      );
                    } else if (tool.id === 'timeline.execute_command') {
                      setToolInputJson(
                        JSON.stringify(
                          {
                            projectId: 'proj_canonical_01',
                            commandType: 'update-text',
                            textValue: 'SOWVEIL VERIFIED TITLE',
                          },
                          null,
                          2
                        )
                      );
                    } else if (tool.id === 'project.delete_track_or_clip') {
                      setToolInputJson(
                        JSON.stringify(
                          {
                            projectId: 'proj_canonical_01',
                            targetClipId: 'clip_01',
                            userApprovalToken: 'MISSING_TOKEN',
                          },
                          null,
                          2
                        )
                      );
                    }
                  }}
                  className={`rounded-xl border p-4 cursor-pointer transition-colors space-y-2 ${
                    isSelected
                      ? 'border-[#F06424] bg-[#191614]'
                      : 'border-[#2A231E] bg-[#11100F] hover:border-[#83766D]'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Code2 className="w-4 h-4 text-[#F06424]" />
                      <span className="text-sm font-mono font-bold text-[#F3EEE8]">
                        {tool.id}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-[#B8AAA0]">
                      {tool.sideEffectClassification} · timeout {tool.timeoutMs}ms · dryRun:{' '}
                      {tool.supportsDryRun ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <p className="text-xs text-[#B8AAA0]">{tool.description}</p>
                  <div className="text-[11px] font-mono text-[#83766D]">
                    Permissions: {tool.requiredPermissionScope.join(', ')} · Required Inputs:{' '}
                    {tool.inputSchema.required.join(', ')}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Policy Enforcement & Dry-Run Console */}
          <div className="lg:col-span-5 rounded-xl border border-[#2A231E] bg-[#11100F] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#F3EEE8]">
                Server-Side Tool Policy Enforcement Console
              </h2>
              <Terminal className="w-4 h-4 text-[#F06424]" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-[#F3EEE8]">{selectedToolId}</span>
                <label className="inline-flex items-center gap-1.5 text-[#B8AAA0]">
                  <input
                    type="checkbox"
                    checked={toolDryRun}
                    onChange={(e) => setToolDryRun(e.target.checked)}
                  />
                  <span>Dry-Run Mode</span>
                </label>
              </div>
              <textarea
                rows={5}
                value={toolInputJson}
                onChange={(e) => setToolInputJson(e.target.value)}
                className="w-full rounded-lg border border-[#342A24] bg-[#0B0A09] p-3 text-xs font-mono text-[#F3EEE8]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleInvokeTool()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#F06424] text-[#080707] font-semibold text-xs hover:bg-[#E05514]"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Invoke Selected Tool</span>
              </button>
              <button
                type="button"
                onClick={() => handleInvokeTool('db.rawSqlQuery_UNREGISTERED')}
                className="px-3 py-2 rounded-lg border border-[#F06464]/50 bg-[#F06464]/10 text-xs font-semibold text-[#F06464]"
              >
                Test Unregistered DB Tool Block
              </button>
            </div>

            {lastToolResponse && (
              <div className="rounded-lg border border-[#342A24] bg-[#0B0A09] p-3 space-y-1.5">
                <div className="text-xs font-semibold text-[#B8AAA0]">
                  Policy Enforcement Output
                </div>
                <pre className="text-[11px] font-mono text-[#F3EEE8] overflow-x-auto">
                  {JSON.stringify(lastToolResponse, null, 2)}
                </pre>
              </div>
            )}

            {toolAuditLog.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[#2A231E]">
                <div className="text-xs font-semibold text-[#B8AAA0]">
                  Append-Only Tool Execution Audit Trail ({toolAuditLog.length})
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {toolAuditLog.map((rec) => (
                    <div
                      key={rec.id}
                      className="rounded border border-[#2A231E] bg-[#141210] p-2 text-[11px] font-mono flex items-center justify-between gap-2"
                    >
                      <span className="text-[#F3EEE8]">{rec.toolId}</span>
                      <span
                        className={
                          rec.status === 'allowed' ? 'text-[#55B98B]' : 'text-[#F06464]'
                        }
                      >
                        {rec.status.toUpperCase()} ({rec.durationMs}ms)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
