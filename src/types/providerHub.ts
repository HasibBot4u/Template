// ============================================================================
// 1. PROTOCOL ADAPTERS & MULTI-PROVIDER PAYLOAD DEFINITIONS (BROWSER-SAFE)
// ============================================================================

export type HubProviderProtocol =
  | 'google-gemini'
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'openai-compatible-variant'
  | 'azure-openai'
  | 'custom-rest-adapter';

export type HubAuthMode =
  | 'bearer'
  | 'x-api-key'
  | 'api-key'
  | 'custom-header'
  | 'query-key'
  | 'server-env';

export type SecretStorageMode = 'server-encrypted-vault' | 'device-only-ephemeral';

export type CredentialVaultStatus =
  | 'active'
  | 'revoked'
  | 'unconfigured'
  | 'server-managed'
  | 'requires-reentry';

export type CapabilityVerificationState =
  | 'Verified'
  | 'User-asserted'
  | 'Unsupported'
  | 'Not tested';

export type ModelCapabilityKey =
  | 'text'
  | 'imageInput'
  | 'videoInput'
  | 'audioInput'
  | 'structuredOutput'
  | 'toolFunctionCalling'
  | 'streaming'
  | 'longContext'
  | 'reasoningSettings'
  | 'fileSearch'
  | 'urlContext'
  | 'webSearch'
  | 'codeExecution'
  | 'contentGenerationModalities';

export const ALL_MODEL_CAPABILITY_KEYS: ModelCapabilityKey[] = [
  'text',
  'imageInput',
  'videoInput',
  'audioInput',
  'structuredOutput',
  'toolFunctionCalling',
  'streaming',
  'longContext',
  'reasoningSettings',
  'fileSearch',
  'urlContext',
  'webSearch',
  'codeExecution',
  'contentGenerationModalities',
];

export type HubTaskType =
  | 'script-analysis'
  | 'planning'
  | 'code'
  | 'asset-research'
  | 'vision'
  | 'voice-transcription'
  | 'evaluation'
  | 'routine-tasks';

export const ALL_HUB_TASK_TYPES: HubTaskType[] = [
  'script-analysis',
  'planning',
  'code',
  'asset-research',
  'vision',
  'voice-transcription',
  'evaluation',
  'routine-tasks',
];

export interface CapabilityRegistryEntry {
  capability: ModelCapabilityKey;
  state: CapabilityVerificationState;
  lastTestedAt: string | null;
  expiresAt: string | null;
  probeEvidence: string;
  userOverrideWarning: string | null;
}

export type CapabilityRegistryMap = Record<ModelCapabilityKey, CapabilityRegistryEntry>;

export interface EncryptedVaultCiphertext {
  algorithm: 'aes-256-gcm';
  ivHex: string;
  authTagHex: string;
  ciphertextHex: string;
  aadScope: string;
  keyVersion: number;
  encryptedAt: string;
}

export interface ProviderBudgetPolicy {
  mode: 'hard-stop' | 'fallback-to-secondary' | 'warn-only';
  monthlyLimitUsd: number;
  spentCurrentMonthUsd: number;
  maxPerRequestUsd: number;
  rateLimitRpm: number;
}

export interface ProviderEndpointSettings {
  apiPath?: string;
  apiVersion?: string;
  deploymentId?: string;
  organizationId?: string;
  projectId?: string;
  customHeaderName?: string;
  extraHeaders?: Record<string, string>;
  responseTextJsonPath?: string;
  useInteractionsApiForOmni?: boolean;
  thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  maxResponseBytes?: number;
}

export interface ProviderConnectionRecord {
  id: string;
  ownerUid: string;
  workspaceId: string;
  label: string;
  providerBrand: string;
  protocol: HubProviderProtocol;
  baseUrl: string;
  endpointSettings: ProviderEndpointSettings;
  modelId: string;
  authMode: HubAuthMode;
  storageMode: SecretStorageMode;
  storageSecurityWarning: string | null;
  encryptedCredential: EncryptedVaultCiphertext | null;
  maskedCredential: string;
  credentialFingerprint: string | null;
  credentialStatus: CredentialVaultStatus;
  keyVersion: number;
  timeoutMs: number;
  maxOutputTokens: number;
  allowedTaskTypes: HubTaskType[];
  capabilities: CapabilityRegistryMap;
  fallbackConnectionId: string | null;
  budgetPolicy: ProviderBudgetPolicy;
  lastTestedAt: string | null;
  lastTestStatus: 'Verified' | 'Failed' | 'Not tested';
  lastSanitizedError: {
    code: string;
    message: string;
    httpStatus?: number;
    timestamp: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
}

export type ProviderConnectionPublicView = Omit<
  ProviderConnectionRecord,
  'encryptedCredential'
>;

export interface FormattedProbePreview {
  url: string;
  method: string;
  redactedHeaders: Record<string, string>;
  bodySummary: Record<string, unknown>;
  latencyMs?: number;
  httpStatus?: number;
}

export interface ConnectionProbeOptions {
  probeTools?: boolean;
  probeStructuredOutput?: boolean;
  probeVision?: boolean;
  probeStreaming?: boolean;
  redirectHopUrlsToValidate?: string[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export interface ProviderProbeResult {
  updatedConnection: ProviderConnectionRecord;
  probePassed: boolean;
  formattedProbeRequestPreview: FormattedProbePreview | null;
  verifiedCapabilities: ModelCapabilityKey[];
  sanitizedError: ProviderConnectionRecord['lastSanitizedError'];
  latencyMs?: number;
}

export interface PrepopulatedModelCatalogEntry {
  presetId: string;
  label: string;
  providerBrand: string;
  protocol: HubProviderProtocol;
  defaultBaseUrl: string;
  defaultApiPath: string;
  modelId: string;
  recommendedAuthMode: HubAuthMode;
  recommendedTasks: HubTaskType[];
  quotaDisclaimer: string;
  requiresPaidKeyFlowInAiStudio: boolean;
  structurallySupportedCapabilities: ModelCapabilityKey[];
}

export const PREPOPULATED_MODEL_CATALOG: PrepopulatedModelCatalogEntry[] = [
  {
    presetId: 'preset-gemini-4-argon',
    label: 'Gemini 4 Argon (High-Complexity Architecture & Director)',
    providerBrand: 'Google Gemini',
    protocol: 'google-gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultApiPath: '/v1beta/models/gemini-4-argon:generateContent',
    modelId: 'gemini-4-argon',
    recommendedAuthMode: 'server-env',
    recommendedTasks: ['script-analysis', 'planning', 'code', 'vision', 'evaluation'],
    quotaDisclaimer:
      'Argon is prepopulated as a model choice only when the endpoint account has quota and permission. Capabilities start as Not tested until verified.',
    requiresPaidKeyFlowInAiStudio: true,
    structurallySupportedCapabilities: [
      'text',
      'imageInput',
      'videoInput',
      'audioInput',
      'structuredOutput',
      'toolFunctionCalling',
      'streaming',
      'longContext',
      'reasoningSettings',
      'urlContext',
      'webSearch',
      'codeExecution',
    ],
  },
  {
    presetId: 'preset-gemini-3-8-flash',
    label: 'Gemini 3.8 Flash (Low-Latency Routine, Tagging & Fast Analysis)',
    providerBrand: 'Google Gemini',
    protocol: 'google-gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultApiPath: '/v1beta/models/gemini-3.8-flash:generateContent',
    modelId: 'gemini-3.8-flash',
    recommendedAuthMode: 'server-env',
    recommendedTasks: ['routine-tasks', 'asset-research', 'script-analysis', 'vision'],
    quotaDisclaimer:
      'Flash availability and rate limits depend on the endpoint account quota. Capabilities remain Not tested until probed.',
    requiresPaidKeyFlowInAiStudio: false,
    structurallySupportedCapabilities: [
      'text',
      'imageInput',
      'videoInput',
      'audioInput',
      'structuredOutput',
      'toolFunctionCalling',
      'streaming',
      'longContext',
      'reasoningSettings',
      'urlContext',
      'webSearch',
    ],
  },
  {
    presetId: 'preset-gemini-3-5-transcribe',
    label: 'Gemini 3.5 Transcribe (Audio Transcription & Captions)',
    providerBrand: 'Google Gemini',
    protocol: 'google-gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    defaultApiPath: '/v1beta/models/gemini-3.5-transcribe:generateContent',
    modelId: 'gemini-3.5-transcribe',
    recommendedAuthMode: 'server-env',
    recommendedTasks: ['voice-transcription'],
    quotaDisclaimer:
      'Audio transcription model; requires account access and verified audio input probe.',
    requiresPaidKeyFlowInAiStudio: false,
    structurallySupportedCapabilities: ['text', 'audioInput', 'streaming'],
  },
  {
    presetId: 'preset-openai-chat-gpt4o',
    label: 'OpenAI Chat Completions (GPT-4o / Standard v1/chat/completions)',
    providerBrand: 'OpenAI',
    protocol: 'openai-chat-completions',
    defaultBaseUrl: 'https://api.openai.com',
    defaultApiPath: '/v1/chat/completions',
    modelId: 'gpt-4o',
    recommendedAuthMode: 'bearer',
    recommendedTasks: ['planning', 'code', 'vision', 'routine-tasks'],
    quotaDisclaimer:
      'Requires a user-supplied OpenAI API key with active billing quota.',
    requiresPaidKeyFlowInAiStudio: false,
    structurallySupportedCapabilities: [
      'text',
      'imageInput',
      'structuredOutput',
      'toolFunctionCalling',
      'streaming',
      'longContext',
    ],
  },
  {
    presetId: 'preset-openai-responses',
    label: 'OpenAI Responses API (/v1/responses Stateful Agent Protocol)',
    providerBrand: 'OpenAI',
    protocol: 'openai-responses',
    defaultBaseUrl: 'https://api.openai.com',
    defaultApiPath: '/v1/responses',
    modelId: 'o3-mini',
    recommendedAuthMode: 'bearer',
    recommendedTasks: ['planning', 'code', 'evaluation'],
    quotaDisclaimer:
      'Uses OpenAI Responses API protocol (/v1/responses). File search, web search, and reasoning depend on model tier.',
    requiresPaidKeyFlowInAiStudio: false,
    structurallySupportedCapabilities: [
      'text',
      'structuredOutput',
      'toolFunctionCalling',
      'streaming',
      'reasoningSettings',
      'fileSearch',
      'webSearch',
    ],
  },
  {
    presetId: 'preset-anthropic-messages',
    label: 'Anthropic Messages API (/v1/messages Claude Sonnet)',
    providerBrand: 'Anthropic',
    protocol: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultApiPath: '/v1/messages',
    modelId: 'claude-3-7-sonnet-20250219',
    recommendedAuthMode: 'x-api-key',
    recommendedTasks: ['script-analysis', 'planning', 'code', 'evaluation'],
    quotaDisclaimer:
      'Uses Anthropic Messages API with x-api-key and anthropic-version headers. Capabilities start as Not tested.',
    requiresPaidKeyFlowInAiStudio: false,
    structurallySupportedCapabilities: [
      'text',
      'imageInput',
      'structuredOutput',
      'toolFunctionCalling',
      'streaming',
      'longContext',
      'reasoningSettings',
    ],
  },
  {
    presetId: 'preset-openrouter-compatible',
    label: 'OpenAI-Compatible Variant (OpenRouter / Together / Fireworks / vLLM)',
    providerBrand: 'OpenAI-Compatible Gateway',
    protocol: 'openai-compatible-variant',
    defaultBaseUrl: 'https://openrouter.ai',
    defaultApiPath: '/api/v1/chat/completions',
    modelId: 'meta-llama/llama-3.3-70b-instruct',
    recommendedAuthMode: 'bearer',
    recommendedTasks: ['routine-tasks', 'asset-research', 'script-analysis'],
    quotaDisclaimer:
      'OpenAI-compatible providers vary widely in tool calling and structured JSON support. Never assume support without running live probes.',
    requiresPaidKeyFlowInAiStudio: false,
    structurallySupportedCapabilities: [
      'text',
      'structuredOutput',
      'toolFunctionCalling',
      'streaming',
    ],
  },
];

// ============================================================================
// 2. SSRF & EGRESS VALIDATION (PURE URL SYNTAX & IP RANGE VALIDATION)
// ============================================================================

export interface SsrfValidationResult {
  allowed: boolean;
  normalizedBaseUrl?: string;
  hostname?: string;
  port?: number;
  errorCode?: string;
  reason: string;
}

const BLOCKED_METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata',
  'metadata.goog',
  '169.254.169.254',
  '100.100.100.200',
  'fd00:ec2::254',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

function isPrivateOrReservedIpv4(parts: number[]): {
  blocked: boolean;
  errorCode?: string;
  reason?: string;
} {
  const [p0, p1, p2] = parts;
  if (p0 === 127 || p0 === 0) {
    return {
      blocked: true,
      errorCode: 'SSRF_LOOPBACK_FORBIDDEN',
      reason: 'Loopback and 0.0.0.0/8 IPv4 ranges are strictly blocked.',
    };
  }
  if (p0 === 169 && p1 === 254) {
    return {
      blocked: true,
      errorCode: 'SSRF_METADATA_OR_LINK_LOCAL_FORBIDDEN',
      reason: 'Link-local and cloud metadata subnet 169.254.0.0/16 is strictly blocked.',
    };
  }
  if (
    p0 === 10 ||
    (p0 === 172 && p1 >= 16 && p1 <= 31) ||
    (p0 === 192 && p1 === 168)
  ) {
    return {
      blocked: true,
      errorCode: 'SSRF_PRIVATE_IP_FORBIDDEN',
      reason: 'RFC1918 private network IPv4 ranges (10/8, 172.16/12, 192.168/16) are blocked.',
    };
  }
  if (p0 === 100 && p1 >= 64 && p1 <= 127) {
    return {
      blocked: true,
      errorCode: 'SSRF_CGNAT_FORBIDDEN',
      reason: 'Carrier-Grade NAT (100.64.0.0/10) internal address space is blocked.',
    };
  }
  if (
    (p0 === 192 && p1 === 0 && (p2 === 0 || p2 === 2)) ||
    (p0 === 198 && (p1 === 18 || p1 === 19)) ||
    (p0 === 198 && p1 === 51 && p2 === 100) ||
    (p0 === 203 && p1 === 0 && p2 === 113) ||
    p0 >= 224
  ) {
    return {
      blocked: true,
      errorCode: 'SSRF_RESERVED_OR_MULTICAST_FORBIDDEN',
      reason: 'Multicast, benchmark, and reserved IPv4 ranges (224.0.0.0+) are blocked.',
    };
  }
  return { blocked: false };
}

export function validateCustomEndpointSsrf(
  rawUrl: string,
  options: { allowHttpForLocalDev?: boolean; allowedPorts?: number[] } = {}
): SsrfValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      allowed: false,
      errorCode: 'ENDPOINT_EMPTY',
      reason: 'Endpoint URL is required.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      allowed: false,
      errorCode: 'ENDPOINT_MALFORMED',
      reason: 'Invalid URL syntax.',
    };
  }

  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      errorCode: 'SSRF_EMBEDDED_CREDENTIALS_FORBIDDEN',
      reason: 'URLs with embedded username/password credentials are forbidden.',
    };
  }

  if (parsed.protocol !== 'https:') {
    if (!(options.allowHttpForLocalDev && parsed.protocol === 'http:')) {
      return {
        allowed: false,
        errorCode: 'HTTPS_REQUIRED',
        reason: `Protocol "${parsed.protocol}" is rejected. Custom provider endpoints must use https://.`,
      };
    }
  }

  const rawHost = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    rawHost === 'localhost' ||
    rawHost.endsWith('.localhost') ||
    rawHost === '::1' ||
    rawHost === '0:0:0:0:0:0:0:1' ||
    rawHost === '::' ||
    rawHost === '0.0.0.0'
  ) {
    return {
      allowed: false,
      hostname: rawHost,
      errorCode: 'SSRF_LOOPBACK_FORBIDDEN',
      reason: 'Loopback and localhost endpoints are forbidden.',
    };
  }

  if (
    BLOCKED_METADATA_HOSTS.has(rawHost) ||
    rawHost.endsWith('.internal') ||
    rawHost.endsWith('.local') ||
    rawHost.endsWith('.lan')
  ) {
    return {
      allowed: false,
      hostname: rawHost,
      errorCode: 'SSRF_METADATA_OR_INTERNAL_HOST_FORBIDDEN',
      reason: `Host "${rawHost}" resolves to a cloud metadata or internal network domain.`,
    };
  }

  if (/^(?:0x[0-9a-f]+|\d+)$/i.test(rawHost)) {
    return {
      allowed: false,
      hostname: rawHost,
      errorCode: 'SSRF_NUMERIC_IP_ENCODING_FORBIDDEN',
      reason: 'Decimal/hexadecimal single-integer IP encodings are forbidden.',
    };
  }

  if (rawHost.includes(':')) {
    if (
      rawHost.startsWith('fe80:') ||
      rawHost.startsWith('fc') ||
      rawHost.startsWith('fd') ||
      rawHost.startsWith('ff') ||
      rawHost.includes('::ffff:')
    ) {
      return {
        allowed: false,
        hostname: rawHost,
        errorCode: 'SSRF_IPV6_PRIVATE_OR_MAPPED_FORBIDDEN',
        reason: 'Private, link-local, multicast, and IPv4-mapped IPv6 addresses are blocked.',
      };
    }
  }

  const ipv4Segments = rawHost.split('.');
  if (ipv4Segments.length === 4 && ipv4Segments.every((seg) => /^[0-9a-fA-FxXoO]+$/.test(seg))) {
    if (ipv4Segments.some((seg) => seg.length > 1 && seg.startsWith('0'))) {
      return {
        allowed: false,
        hostname: rawHost,
        errorCode: 'SSRF_OCTAL_IP_FORBIDDEN',
        reason: 'Octal or hex-prefixed IPv4 segments are forbidden.',
      };
    }
    const nums = ipv4Segments.map((s) => Number(s));
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      const check = isPrivateOrReservedIpv4(nums);
      if (check.blocked) {
        return {
          allowed: false,
          hostname: rawHost,
          errorCode: check.errorCode,
          reason: check.reason || 'Blocked IPv4 range.',
        };
      }
    }
  }

  const effectivePort = parsed.port ? Number(parsed.port) : 443;
  const allowedPorts = options.allowedPorts || [443, 8443];
  if (!allowedPorts.includes(effectivePort)) {
    return {
      allowed: false,
      hostname: rawHost,
      port: effectivePort,
      errorCode: 'SSRF_DISALLOWED_PORT',
      reason: `Port ${effectivePort} is not in the outbound HTTPS port allowlist (${allowedPorts.join(', ')}).`,
    };
  }

  const lowerPath = parsed.pathname.toLowerCase();
  if (
    lowerPath.startsWith('/api/v1/admin') ||
    lowerPath.startsWith('/admin') ||
    lowerPath.startsWith('/internal') ||
    lowerPath.includes('..')
  ) {
    return {
      allowed: false,
      hostname: rawHost,
      errorCode: 'SSRF_INTERNAL_ADMIN_PATH_FORBIDDEN',
      reason: 'Custom endpoints cannot target internal admin or traversal paths.',
    };
  }

  return {
    allowed: true,
    normalizedBaseUrl: `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, '')}`,
    hostname: rawHost,
    port: effectivePort,
    reason: 'HTTPS public endpoint validated against SSRF rules.',
  };
}

export function validateRedirectChainSsrf(
  initialUrl: string,
  redirectTargetUrls: string[]
): {
  allowed: boolean;
  errorCode?: string;
  reason: string;
  validatedHopCount: number;
} {
  const firstCheck = validateCustomEndpointSsrf(initialUrl);
  if (!firstCheck.allowed) {
    return {
      allowed: false,
      errorCode: firstCheck.errorCode,
      reason: `Initial URL rejected: ${firstCheck.reason}`,
      validatedHopCount: 0,
    };
  }

  if (redirectTargetUrls.length > 3) {
    return {
      allowed: false,
      errorCode: 'SSRF_TOO_MANY_REDIRECTS',
      reason: 'Redirect chain exceeds maximum of 3 hops.',
      validatedHopCount: redirectTargetUrls.length,
    };
  }

  for (let i = 0; i < redirectTargetUrls.length; i++) {
    const hopUrl = redirectTargetUrls[i];
    const hopCheck = validateCustomEndpointSsrf(hopUrl);
    if (!hopCheck.allowed) {
      return {
        allowed: false,
        errorCode: hopCheck.errorCode || 'SSRF_UNSAFE_REDIRECT',
        reason: `Redirect hop #${i + 1} (${hopUrl}) blocked: ${hopCheck.reason}`,
        validatedHopCount: i + 1,
      };
    }
    if (hopCheck.hostname !== firstCheck.hostname) {
      return {
        allowed: false,
        errorCode: 'SSRF_CROSS_HOST_REDIRECT_WITH_AUTH_FORBIDDEN',
        reason: `Redirect hop #${i + 1} changes host from "${firstCheck.hostname}" to "${hopCheck.hostname}". Cross-host redirects with API credentials are blocked.`,
        validatedHopCount: i + 1,
      };
    }
  }

  return {
    allowed: true,
    reason: 'All redirect hops verified on same public HTTPS origin.',
    validatedHopCount: redirectTargetUrls.length,
  };
}

export function buildInitialCapabilityRegistry(
  protocol: HubProviderProtocol,
  modelId: string
): CapabilityRegistryMap {
  const preset = PREPOPULATED_MODEL_CATALOG.find(
    (p) => p.protocol === protocol && p.modelId === modelId
  );
  const supportedSet = new Set<ModelCapabilityKey>(
    preset?.structurallySupportedCapabilities || [
      'text',
      'structuredOutput',
      'toolFunctionCalling',
      'streaming',
    ]
  );

  // Never infer 'Verified' solely from brand — always initialize as 'Not tested' or 'Unsupported'
  const map = {} as CapabilityRegistryMap;
  for (const key of ALL_MODEL_CAPABILITY_KEYS) {
    const structurallyPossible = supportedSet.has(key);
    map[key] = {
      capability: key,
      state: structurallyPossible ? 'Not tested' : 'Unsupported',
      lastTestedAt: null,
      expiresAt: null,
      probeEvidence: structurallyPossible
        ? 'Not yet probed. Run Connection Test to verify against live endpoint.'
        : `Structurally unsupported by ${protocol} (${modelId}) adapter.`,
      userOverrideWarning: null,
    };
  }
  return map;
}

// ============================================================================
// 3. TASK ROUTING PROFILES (8 PROFILES, BROWSER-SAFE)
// ============================================================================

export interface TaskRoutingProfile {
  taskType: HubTaskType;
  label: string;
  description: string;
  requiredCapabilities: ModelCapabilityKey[];
  primaryConnectionId: string | null;
  fallbackConnectionId: string | null;
  maxBudgetPerRunUsd: number;
  temperature: number;
  updatedAt: string;
}

export function buildDefaultRoutingProfiles(
  connections: Array<{ id: string }> = []
): Record<HubTaskType, TaskRoutingProfile> {
  const now = new Date().toISOString();
  const firstConnId = connections[0]?.id || null;
  const secondConnId = connections[1]?.id || null;

  return {
    'script-analysis': {
      taskType: 'script-analysis',
      label: 'Script Analysis & 100% Coverage Segmentation',
      description: 'Splits scripts into stable source segments and maps narrative beats.',
      requiredCapabilities: ['text', 'structuredOutput'],
      primaryConnectionId: firstConnId,
      fallbackConnectionId: secondConnId,
      maxBudgetPerRunUsd: 0.15,
      temperature: 0.2,
      updatedAt: now,
    },
    planning: {
      taskType: 'planning',
      label: 'Director Brief & Shot Planning',
      description: 'Synthesizes multi-track shot plans and canonical command proposals.',
      requiredCapabilities: ['text', 'structuredOutput', 'toolFunctionCalling'],
      primaryConnectionId: firstConnId,
      fallbackConnectionId: secondConnId,
      maxBudgetPerRunUsd: 0.25,
      temperature: 0.4,
      updatedAt: now,
    },
    code: {
      taskType: 'code',
      label: 'Expressions, Easing & Procedural Code',
      description: 'Generates deterministic keyframe math and expression parameters.',
      requiredCapabilities: ['text', 'structuredOutput'],
      primaryConnectionId: firstConnId,
      fallbackConnectionId: secondConnId,
      maxBudgetPerRunUsd: 0.2,
      temperature: 0.1,
      updatedAt: now,
    },
    'asset-research': {
      taskType: 'asset-research',
      label: 'Asset & Template Marketplace Matching',
      description: 'Matches script scenes to verified Sowveil Studio templates and assets.',
      requiredCapabilities: ['text', 'structuredOutput'],
      primaryConnectionId: secondConnId || firstConnId,
      fallbackConnectionId: firstConnId,
      maxBudgetPerRunUsd: 0.08,
      temperature: 0.3,
      updatedAt: now,
    },
    vision: {
      taskType: 'vision',
      label: 'Reference Frame & Layout Vision Analysis',
      description: 'Analyzes reference screenshots and keyframes in Reference Lab.',
      requiredCapabilities: ['text', 'imageInput', 'structuredOutput'],
      primaryConnectionId: firstConnId,
      fallbackConnectionId: secondConnId,
      maxBudgetPerRunUsd: 0.25,
      temperature: 0.2,
      updatedAt: now,
    },
    'voice-transcription': {
      taskType: 'voice-transcription',
      label: 'Voice, Auto Captions & Audio Alignment',
      description: 'Transcribes speech and aligns word-level timestamps.',
      requiredCapabilities: ['text', 'audioInput'],
      primaryConnectionId: firstConnId,
      fallbackConnectionId: secondConnId,
      maxBudgetPerRunUsd: 0.15,
      temperature: 0.0,
      updatedAt: now,
    },
    evaluation: {
      taskType: 'evaluation',
      label: 'Output Fidelity & Timeline Verification',
      description: 'Audits timeline coverage, caption sync, and reconstruction fidelity.',
      requiredCapabilities: ['text', 'structuredOutput'],
      primaryConnectionId: firstConnId,
      fallbackConnectionId: secondConnId,
      maxBudgetPerRunUsd: 0.15,
      temperature: 0.1,
      updatedAt: now,
    },
    'routine-tasks': {
      taskType: 'routine-tasks',
      label: 'Routine Tagging, Titles & Summaries',
      description: 'Low-cost model routing for routine metadata and quick suggestions.',
      requiredCapabilities: ['text'],
      primaryConnectionId: secondConnId || firstConnId,
      fallbackConnectionId: firstConnId,
      maxBudgetPerRunUsd: 0.05,
      temperature: 0.3,
      updatedAt: now,
    },
  };
}

export function evaluateRoutingReadiness(
  profile: TaskRoutingProfile,
  connectionsById: Map<string, ProviderConnectionPublicView | ProviderConnectionRecord>
): {
  ready: boolean;
  warnings: string[];
  resolvedConnectionId: string | null;
} {
  const warnings: string[] = [];
  const primary = profile.primaryConnectionId
    ? connectionsById.get(profile.primaryConnectionId)
    : undefined;
  const fallback = profile.fallbackConnectionId
    ? connectionsById.get(profile.fallbackConnectionId)
    : undefined;

  const isUsableStatus = (conn?: ProviderConnectionPublicView | ProviderConnectionRecord) =>
    Boolean(
      conn &&
        conn.credentialStatus !== 'revoked' &&
        conn.credentialStatus !== 'requires-reentry'
    );

  const candidate = isUsableStatus(primary) ? primary : isUsableStatus(fallback) ? fallback : primary || fallback;

  if (!candidate) {
    return {
      ready: false,
      warnings: [`No active connection assigned to task "${profile.label}".`],
      resolvedConnectionId: null,
    };
  }

  if (candidate.credentialStatus === 'requires-reentry') {
    warnings.push(
      `Connection "${candidate.label}" requires API key re-entry or rotation under the active vault key.`
    );
  } else if (candidate.credentialStatus === 'revoked') {
    warnings.push(`Connection "${candidate.label}" has a revoked credential.`);
  }

  for (const reqCap of profile.requiredCapabilities) {
    const capEntry = candidate.capabilities[reqCap];
    if (!capEntry || capEntry.state === 'Unsupported') {
      warnings.push(
        `Connection "${candidate.label}" does not support required capability "${reqCap}".`
      );
    } else if (capEntry.state === 'Not tested') {
      warnings.push(
        `Capability "${reqCap}" on "${candidate.label}" is Not tested. Run probe to verify.`
      );
    } else if (capEntry.state === 'User-asserted') {
      warnings.push(
        `Capability "${reqCap}" on "${candidate.label}" is User-asserted (unverified override).`
      );
    }
  }

  const unsupported = profile.requiredCapabilities.some(
    (c) => candidate.capabilities[c]?.state === 'Unsupported'
  );

  return {
    ready:
      !unsupported &&
      candidate.credentialStatus !== 'revoked' &&
      candidate.credentialStatus !== 'requires-reentry',
    warnings,
    resolvedConnectionId: candidate.id,
  };
}

// ============================================================================
// 4. EXTENSIONS WORKSPACE & SANDBOX TYPES (BROWSER-SAFE)
// ============================================================================

export type ExtensionPackageKind =
  | 'github-repo'
  | 'zip-package'
  | 'skill-folder'
  | 'instruction-file'
  | 'docs-website'
  | 'api-tool';

export type ExtensionPermissionScope =
  | 'read-project'
  | 'read-catalog'
  | 'propose-commands'
  | 'write-project'
  | 'network-egress'
  | 'destructive-ops'
  | 'secret-access';

export const RISKY_EXTENSION_PERMISSIONS = new Set<ExtensionPermissionScope>([
  'write-project',
  'network-egress',
  'destructive-ops',
  'secret-access',
]);

export interface ExtensionVersionSnapshot {
  version: string;
  commitOrReleasePin: string;
  checksumSha256: string;
  permissions: ExtensionPermissionScope[];
  dependencies: string[];
  savedAt: string;
}

export interface ExtensionSandboxValidationRun {
  runId: string;
  timestamp: string;
  passed: boolean;
  isolatedFilesystemScope: string;
  cpuTimeMs: number;
  memoryLimitMb: number;
  timeoutLimitMs: number;
  secretsExposedCount: 0;
  networkBlocked: boolean;
  untrustedEnvelopeApplied: boolean;
  flaggedRisks: string[];
  summary: string;
}

export interface ExtensionPackageRecord {
  id: string;
  ownerUid: string;
  name: string;
  kind: ExtensionPackageKind;
  sourceUrl: string;
  commitOrReleasePin: string;
  version: string;
  checksumSha256: string;
  license: string;
  dependencies: string[];
  declaredCapabilities: string[];
  requestedPermissions: ExtensionPermissionScope[];
  approvedPermissions: ExtensionPermissionScope[];
  permissionDiff: {
    addedPermissions: ExtensionPermissionScope[];
    riskyPermissionsRequested: ExtensionPermissionScope[];
    requiresExplicitApproval: boolean;
  };
  explicitApprovalGranted: boolean;
  installState: 'installed-enabled' | 'installed-disabled' | 'quarantined' | 'uninstalled';
  untrustedContentEnvelope: string;
  validationRuns: ExtensionSandboxValidationRun[];
  versionHistory: ExtensionVersionSnapshot[];
  auditHistory: Array<{
    timestamp: string;
    action: string;
    details: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 5. TYPED TOOL REGISTRY DEFINITIONS (BROWSER-SAFE)
// ============================================================================

export type ToolSideEffectClassification =
  | 'read-only'
  | 'reversible-mutation'
  | 'external-network'
  | 'destructive-gated';

export interface RegisteredAiToolDefinition {
  id: string;
  name: string;
  category: 'project' | 'timeline' | 'script' | 'catalog' | 'reference';
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  outputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  requiredCapabilityScope: ModelCapabilityKey[];
  requiredPermissionScope: ExtensionPermissionScope[];
  preconditions: string[];
  supportsDryRun: boolean;
  sideEffectClassification: ToolSideEffectClassification;
  timeoutMs: number;
  errorSchema: {
    type: 'object';
    properties: {
      code: { type: 'string' };
      message: { type: 'string' };
      retryable: { type: 'boolean' };
    };
  };
}

export interface ToolExecutionAuditRecord {
  id: string;
  ownerUid: string;
  toolId: string;
  dryRun: boolean;
  status: 'allowed' | 'denied' | 'error';
  sideEffectClassification: ToolSideEffectClassification;
  redactedInputSummary: string;
  redactedOutputSummary: string;
  errorCode?: string;
  durationMs: number;
  createdAt: string;
}

export const REGISTERED_AI_TOOLS: RegisteredAiToolDefinition[] = [
  {
    id: 'project.inspect_state',
    name: 'Inspect Canonical Project State',
    category: 'project',
    description:
      'Reads the current canonical project tracks, clips, canvas dimensions, and revision state without modifying any data.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Target canonical project ID.' },
      },
      required: ['projectId'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Project ID' },
        schemaVersion: { type: 'string', description: 'Canonical schema version (2.0.0)' },
        trackCount: { type: 'number', description: 'Total ordered tracks' },
        clipCount: { type: 'number', description: 'Total timeline clips' },
        revisionNumber: { type: 'number', description: 'Current project revision' },
      },
      required: ['projectId', 'schemaVersion', 'trackCount', 'clipCount', 'revisionNumber'],
    },
    requiredCapabilityScope: ['toolFunctionCalling'],
    requiredPermissionScope: ['read-project'],
    preconditions: ['Caller must own the target project.'],
    supportsDryRun: true,
    sideEffectClassification: 'read-only',
    timeoutMs: 3000,
    errorSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
  {
    id: 'script.analyze_coverage',
    name: 'Analyze Script Coverage & Segments',
    category: 'script',
    description:
      'Segments script text into stable source unit IDs and verifies 100% passage coverage without truncation.',
    inputSchema: {
      type: 'object',
      properties: {
        scriptText: { type: 'string', description: 'Full script text to segment and verify.' },
      },
      required: ['scriptText'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        totalUnits: { type: 'number', description: 'Number of segmented script units' },
        percentCovered: { type: 'number', description: 'Coverage percentage' },
      },
      required: ['totalUnits', 'percentCovered'],
    },
    requiredCapabilityScope: ['toolFunctionCalling'],
    requiredPermissionScope: ['read-project'],
    preconditions: ['scriptText must be non-empty string.'],
    supportsDryRun: true,
    sideEffectClassification: 'read-only',
    timeoutMs: 5000,
    errorSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
  {
    id: 'catalog.search_templates',
    name: 'Search Verified Marketplace Templates',
    category: 'catalog',
    description:
      'Queries the Sowveil Studio 20-module catalog for templates matching a module or keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or style tag.' },
        moduleId: { type: 'string', description: 'Optional module ID filter.' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        matchCount: { type: 'number', description: 'Number of matching catalog items' },
      },
      required: ['matchCount'],
    },
    requiredCapabilityScope: ['toolFunctionCalling'],
    requiredPermissionScope: ['read-catalog'],
    preconditions: ['Only published or caller-owned private templates are returned.'],
    supportsDryRun: true,
    sideEffectClassification: 'read-only',
    timeoutMs: 3000,
    errorSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
  {
    id: 'timeline.execute_command',
    name: 'Execute Typed Canonical Editor Command',
    category: 'timeline',
    description:
      'Applies a validated command (e.g., update-text, add-keyframe, move-clip, add-caption) to the canonical project via executeEditorCommand with automatic undo checkpointing.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Target project ID.' },
        commandType: {
          type: 'string',
          description: 'Typed command name.',
          enum: [
            'update-text',
            'set-transform',
            'add-keyframe',
            'add-effect',
            'set-transition',
            'add-caption',
          ],
        },
        clipId: { type: 'string', description: 'Target clip ID when applicable.' },
        textValue: { type: 'string', description: 'New text value for update-text.' },
      },
      required: ['projectId', 'commandType'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        receiptId: { type: 'string', description: 'Command receipt ID' },
        newRevision: { type: 'number', description: 'Updated revision number' },
        dryRun: { type: 'boolean', description: 'Whether mutation was simulated only' },
      },
      required: ['receiptId', 'newRevision', 'dryRun'],
    },
    requiredCapabilityScope: ['toolFunctionCalling'],
    requiredPermissionScope: ['propose-commands', 'write-project'],
    preconditions: [
      'Caller must own the project.',
      'write-project permission must be granted when dryRun is false.',
    ],
    supportsDryRun: true,
    sideEffectClassification: 'reversible-mutation',
    timeoutMs: 5000,
    errorSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
  {
    id: 'timeline.create_checkpoint',
    name: 'Create Reversible Project Checkpoint',
    category: 'timeline',
    description: 'Creates a named reversible checkpoint before multi-step AI edits.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Target project ID.' },
        label: { type: 'string', description: 'Human-readable checkpoint label.' },
      },
      required: ['projectId', 'label'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        checkpointRevision: { type: 'number', description: 'Saved revision number' },
        label: { type: 'string', description: 'Checkpoint label' },
      },
      required: ['checkpointRevision', 'label'],
    },
    requiredCapabilityScope: ['toolFunctionCalling'],
    requiredPermissionScope: ['write-project'],
    preconditions: ['Caller must own the project.'],
    supportsDryRun: true,
    sideEffectClassification: 'reversible-mutation',
    timeoutMs: 3000,
    errorSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
  {
    id: 'project.delete_track_or_clip',
    name: 'Delete Timeline Track or Clip (Destructive-Gated)',
    category: 'timeline',
    description:
      'Removes a clip or track from the project. Requires explicit destructive-ops permission and user approval token.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Target project ID.' },
        targetClipId: { type: 'string', description: 'Clip ID to delete.' },
        userApprovalToken: {
          type: 'string',
          description: 'Explicit user confirmation token (CONFIRM_DESTRUCTIVE_DELETE).',
        },
      },
      required: ['projectId', 'targetClipId', 'userApprovalToken'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        deletedClipId: { type: 'string', description: 'Deleted clip ID' },
        reversibleCheckpointCreated: { type: 'boolean', description: 'Checkpoint created' },
      },
      required: ['deletedClipId', 'reversibleCheckpointCreated'],
    },
    requiredCapabilityScope: ['toolFunctionCalling'],
    requiredPermissionScope: ['write-project', 'destructive-ops'],
    preconditions: [
      'Caller must own the project.',
      'destructive-ops permission must be explicitly approved.',
      'userApprovalToken must equal "CONFIRM_DESTRUCTIVE_DELETE".',
    ],
    supportsDryRun: true,
    sideEffectClassification: 'destructive-gated',
    timeoutMs: 4000,
    errorSchema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
];
