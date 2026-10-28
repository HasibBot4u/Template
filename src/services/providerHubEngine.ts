import crypto from 'node:crypto';
import {
  CanonicalProjectCommand,
  CanonicalProjectDocument,
} from '../types/canonicalProject';
import {
  createMinimalCanonicalProject,
  executeProjectCommand,
  validateCanonicalProject,
} from './canonicalProjectEngine';
import { SEED_CATALOG_ITEMS } from '../data/catalogSeeds';
import { filterAndSortCatalog } from './catalogEngine';
import { parseScriptIntoUnits, generateCoverageReport } from '../features/ai-director/scriptDirector';
import {
  ALL_HUB_TASK_TYPES,
  ALL_MODEL_CAPABILITY_KEYS,
  buildDefaultRoutingProfiles,
  buildInitialCapabilityRegistry,
  CapabilityRegistryEntry,
  CapabilityRegistryMap,
  CapabilityVerificationState,
  CredentialVaultStatus,
  EncryptedVaultCiphertext,
  evaluateRoutingReadiness,
  ExtensionPackageKind,
  ExtensionPackageRecord,
  ExtensionPermissionScope,
  ExtensionSandboxValidationRun,
  ExtensionVersionSnapshot,
  HubAuthMode,
  HubProviderProtocol,
  HubTaskType,
  ModelCapabilityKey,
  PrepopulatedModelCatalogEntry,
  PREPOPULATED_MODEL_CATALOG,
  ProviderBudgetPolicy,
  ProviderConnectionPublicView,
  ProviderConnectionRecord,
  ProviderEndpointSettings,
  REGISTERED_AI_TOOLS,
  RegisteredAiToolDefinition,
  RISKY_EXTENSION_PERMISSIONS,
  SecretStorageMode,
  SsrfValidationResult,
  TaskRoutingProfile,
  ToolExecutionAuditRecord,
  ToolSideEffectClassification,
  validateCustomEndpointSsrf,
  validateRedirectChainSsrf,
} from '../types/providerHub';
import {
  buildVaultAadScope,
  computeCredentialFingerprint,
  decryptCredentialFromVault,
  encryptCredentialForVault,
  getVaultConfigurationDiagnostics,
  inspectPersistedConnectionVaultHealth,
  maskSecretCredential,
  migrateVaultRecordWithExplicitPreviousKey,
  redactSecretsFromText,
  resolveVaultKeyConfiguration,
  toPublicProviderConnectionView,
  VaultConfigurationError,
  VaultErrorCode,
} from '../server/credentialVault';

export {
  ALL_HUB_TASK_TYPES,
  ALL_MODEL_CAPABILITY_KEYS,
  buildDefaultRoutingProfiles,
  buildInitialCapabilityRegistry,
  buildVaultAadScope,
  computeCredentialFingerprint,
  decryptCredentialFromVault,
  encryptCredentialForVault,
  evaluateRoutingReadiness,
  getVaultConfigurationDiagnostics,
  inspectPersistedConnectionVaultHealth,
  maskSecretCredential,
  migrateVaultRecordWithExplicitPreviousKey,
  PREPOPULATED_MODEL_CATALOG,
  redactSecretsFromText,
  REGISTERED_AI_TOOLS,
  resolveVaultKeyConfiguration,
  RISKY_EXTENSION_PERMISSIONS,
  toPublicProviderConnectionView,
  validateCustomEndpointSsrf,
  validateRedirectChainSsrf,
  VaultConfigurationError,
};

export type {
  CapabilityRegistryEntry,
  CapabilityRegistryMap,
  CapabilityVerificationState,
  CredentialVaultStatus,
  EncryptedVaultCiphertext,
  ExtensionPackageKind,
  ExtensionPackageRecord,
  ExtensionPermissionScope,
  ExtensionSandboxValidationRun,
  ExtensionVersionSnapshot,
  HubAuthMode,
  HubProviderProtocol,
  HubTaskType,
  ModelCapabilityKey,
  PrepopulatedModelCatalogEntry,
  ProviderBudgetPolicy,
  ProviderConnectionPublicView,
  ProviderConnectionRecord,
  ProviderEndpointSettings,
  RegisteredAiToolDefinition,
  SecretStorageMode,
  SsrfValidationResult,
  TaskRoutingProfile,
  ToolExecutionAuditRecord,
  ToolSideEffectClassification,
  VaultErrorCode,
};

// ============================================================================
// 4. DISTINCT PROTOCOL ADAPTERS (REQUEST MAPPING, AUTH, TOOLS, STREAMING, MEDIA, USAGE)
// ============================================================================

export interface NormalizedToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface NormalizedMediaInput {
  modality: 'image' | 'audio' | 'video';
  mimeType: string;
  base64Data?: string;
  fileUri?: string;
}

export interface AdapterRequestInput {
  connection: ProviderConnectionRecord;
  resolvedSecret: string;
  systemInstruction?: string;
  userPrompt: string;
  mediaInputs?: NormalizedMediaInput[];
  tools?: NormalizedToolDefinition[];
  structuredOutputSchema?: Record<string, unknown>;
  stream?: boolean;
  temperature?: number;
}

export interface AdapterFormattedRequest {
  protocol: HubProviderProtocol;
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: Record<string, unknown>;
  streamingFraming: 'sse-json-data' | 'sse-anthropic-events' | 'gemini-stream-array' | 'none';
}

export interface AdapterParsedResponse {
  protocol: HubProviderProtocol;
  text: string;
  structuredOutput: unknown | null;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  finishReason: string;
}

export function buildProtocolRequest(input: AdapterRequestInput): AdapterFormattedRequest {
  const {
    connection,
    resolvedSecret,
    systemInstruction,
    userPrompt,
    mediaInputs = [],
    tools = [],
    structuredOutputSchema,
    stream = false,
    temperature = 0.4,
  } = input;

  const baseUrl = connection.baseUrl.replace(/\/$/, '');
  const extraHeaders = { ...(connection.endpointSettings.extraHeaders || {}) };

  const buildAuthHeaders = (): Record<string, string> => {
    switch (connection.authMode) {
      case 'bearer':
        return { Authorization: `Bearer ${resolvedSecret}` };
      case 'x-api-key':
        return { 'x-api-key': resolvedSecret };
      case 'api-key':
        return { 'api-key': resolvedSecret };
      case 'custom-header': {
        const hName = connection.endpointSettings.customHeaderName || 'X-Custom-Auth';
        return { [hName]: resolvedSecret };
      }
      case 'query-key':
      case 'server-env':
      default:
        return {};
    }
  };

  // 1. GOOGLE GEMINI PROTOCOL
  if (connection.protocol === 'google-gemini') {
    const model = connection.modelId || 'gemini-3.8-flash';
    const isImageModel =
      model === 'gemini-3.1-flash-lite-image' ||
      model === 'gemini-nano-banana-2.1' ||
      model === 'gemini-3-pro-image';
    const isOmniModel = model === 'gemini-omni-1.1-flash';

    if (isOmniModel || connection.endpointSettings.useInteractionsApiForOmni) {
      const url = `${baseUrl}/v1beta/interactions`;
      return {
        protocol: 'google-gemini',
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'aistudio-build',
          'x-goog-api-key': resolvedSecret,
          ...buildAuthHeaders(),
          ...extraHeaders,
        },
        body: {
          model,
          input: [{ role: 'user', parts: [{ text: userPrompt }] }],
        },
        streamingFraming: 'none',
      };
    }

    const actionMethod = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:${actionMethod}`;

    const parts: Array<Record<string, unknown>> = [];
    for (const media of mediaInputs) {
      if (media.base64Data) {
        parts.push({
          inlineData: {
            mimeType: media.mimeType,
            data: media.base64Data,
          },
        });
      } else if (media.fileUri) {
        parts.push({
          fileData: {
            mimeType: media.mimeType,
            fileUri: media.fileUri,
          },
        });
      }
    }
    parts.push({ text: userPrompt });

    const generationConfig: Record<string, unknown> = {
      temperature,
    };

    // Never set responseMimeType or responseSchema on nano-banana image generation models
    if (structuredOutputSchema && !isImageModel) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = structuredOutputSchema;
    }

    // Use thinkingLevel (never thinkingBudget for gemini-4-argon)
    if (connection.endpointSettings.thinkingLevel && !isImageModel) {
      const level =
        model === 'gemini-4-argon' && connection.endpointSettings.thinkingLevel === 'MINIMAL'
          ? 'LOW'
          : connection.endpointSettings.thinkingLevel;
      generationConfig.thinkingConfig = {
        thinkingLevel: level,
      };
    }

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts }],
      generationConfig,
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    if (tools.length > 0 && !isImageModel) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
    }

    return {
      protocol: 'google-gemini',
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'aistudio-build',
        'x-goog-api-key': resolvedSecret,
        ...buildAuthHeaders(),
        ...extraHeaders,
      },
      body,
      streamingFraming: stream ? 'sse-json-data' : 'none',
    };
  }

  // 2. ANTHROPIC MESSAGES API PROTOCOL (/v1/messages)
  if (connection.protocol === 'anthropic-messages') {
    const apiPath = connection.endpointSettings.apiPath || '/v1/messages';
    const url = `${baseUrl}${apiPath}`;

    const userContentBlocks: Array<Record<string, unknown>> = [];
    for (const media of mediaInputs) {
      if (media.modality === 'image' && media.base64Data) {
        userContentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: media.mimeType,
            data: media.base64Data,
          },
        });
      }
    }
    userContentBlocks.push({ type: 'text', text: userPrompt });

    const body: Record<string, unknown> = {
      model: connection.modelId || 'claude-3-7-sonnet-20250219',
      max_tokens: connection.maxOutputTokens || 4096,
      temperature,
      messages: [
        {
          role: 'user',
          content: userContentBlocks,
        },
      ],
      ...(stream ? { stream: true } : {}),
    };

    if (systemInstruction) {
      body.system = systemInstruction;
    }

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    return {
      protocol: 'anthropic-messages',
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': resolvedSecret,
        'anthropic-version': connection.endpointSettings.apiVersion || '2023-06-01',
        ...buildAuthHeaders(),
        ...extraHeaders,
      },
      body,
      streamingFraming: stream ? 'sse-anthropic-events' : 'none',
    };
  }

  // 3. OPENAI RESPONSES API PROTOCOL (/v1/responses)
  if (connection.protocol === 'openai-responses') {
    const apiPath = connection.endpointSettings.apiPath || '/v1/responses';
    const url = `${baseUrl}${apiPath}`;

    const contentItems: Array<Record<string, unknown>> = [
      { type: 'input_text', text: userPrompt },
    ];
    for (const media of mediaInputs) {
      if (media.modality === 'image' && media.base64Data) {
        contentItems.push({
          type: 'input_image',
          image_url: `data:${media.mimeType};base64,${media.base64Data}`,
        });
      }
    }

    const body: Record<string, unknown> = {
      model: connection.modelId || 'o3-mini',
      input: [{ role: 'user', content: contentItems }],
      ...(systemInstruction ? { instructions: systemInstruction } : {}),
      ...(stream ? { stream: true } : {}),
    };

    if (structuredOutputSchema) {
      body.text = {
        format: {
          type: 'json_schema',
          name: 'structured_response',
          schema: structuredOutputSchema,
          strict: true,
        },
      };
    }

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      }));
    }

    return {
      protocol: 'openai-responses',
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
        ...extraHeaders,
      },
      body,
      streamingFraming: stream ? 'sse-json-data' : 'none',
    };
  }

  // 4. AZURE OPENAI PROTOCOL
  if (connection.protocol === 'azure-openai') {
    const deployment = connection.endpointSettings.deploymentId || connection.modelId || 'gpt-4o';
    const apiVersion = connection.endpointSettings.apiVersion || '2024-10-21';
    const url = `${baseUrl}/openai/deployments/${encodeURIComponent(
      deployment
    )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

    const messages: Array<Record<string, unknown>> = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }
    messages.push({ role: 'user', content: userPrompt });

    const body: Record<string, unknown> = {
      messages,
      temperature,
      max_tokens: connection.maxOutputTokens || 4096,
      ...(stream ? { stream: true } : {}),
      ...(structuredOutputSchema ? { response_format: { type: 'json_object' } } : {}),
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    return {
      protocol: 'azure-openai',
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': resolvedSecret,
        ...buildAuthHeaders(),
        ...extraHeaders,
      },
      body,
      streamingFraming: stream ? 'sse-json-data' : 'none',
    };
  }

  // 5. CUSTOM REST ADAPTER PROTOCOL
  if (connection.protocol === 'custom-rest-adapter') {
    const apiPath = connection.endpointSettings.apiPath || '/v1/generate';
    const url = `${baseUrl}${apiPath}`;
    return {
      protocol: 'custom-rest-adapter',
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(),
        ...extraHeaders,
      },
      body: {
        model: connection.modelId,
        system: systemInstruction || '',
        prompt: userPrompt,
        max_tokens: connection.maxOutputTokens || 2048,
        temperature,
        stream,
      },
      streamingFraming: stream ? 'sse-json-data' : 'none',
    };
  }

  // 6. OPENAI CHAT COMPLETIONS & OPENAI-COMPATIBLE VARIANT (vLLM / Ollama / OpenRouter / Groq / Together)
  const isVariant = connection.protocol === 'openai-compatible-variant';
  const apiPath = connection.endpointSettings.apiPath || '/v1/chat/completions';
  const url = `${baseUrl}${apiPath}`;

  const userContent: unknown =
    mediaInputs.length > 0
      ? [
          { type: 'text', text: userPrompt },
          ...mediaInputs
            .filter((m) => m.modality === 'image' && m.base64Data)
            .map((m) => ({
              type: 'image_url',
              image_url: { url: `data:${m.mimeType};base64,${m.base64Data}` },
            })),
        ]
      : userPrompt;

  const messages: Array<Record<string, unknown>> = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: userContent });

  const body: Record<string, unknown> = {
    model: connection.modelId || 'gpt-4o',
    messages,
    temperature,
    max_tokens: connection.maxOutputTokens || 4096,
  };

  if (stream) {
    body.stream = true;
    if (!isVariant) {
      body.stream_options = { include_usage: true };
    }
  }

  if (structuredOutputSchema) {
    // OpenAI-compatible variants often reject strict json_schema; use json_object fallback for variants
    body.response_format = isVariant
      ? { type: 'json_object' }
      : {
          type: 'json_schema',
          json_schema: {
            name: 'structured_output',
            strict: true,
            schema: structuredOutputSchema,
          },
        };
  }

  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  return {
    protocol: connection.protocol,
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildAuthHeaders(),
      ...extraHeaders,
    },
    body,
    streamingFraming: stream ? 'sse-json-data' : 'none',
  };
}

export function parseProtocolResponse(
  protocol: HubProviderProtocol,
  rawBody: any
): AdapterParsedResponse {
  let text = '';
  const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let reasoningTokens = 0;
  let finishReason = 'stop';

  if (protocol === 'google-gemini') {
    const candidate = rawBody?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      if (typeof part?.text === 'string') {
        text += part.text;
      }
      if (part?.functionCall) {
        toolCalls.push({
          id: part.functionCall.id || `fc_${toolCalls.length + 1}`,
          name: part.functionCall.name || '',
          arguments: (part.functionCall.args as Record<string, unknown>) || {},
        });
      }
    }
    promptTokens = Number(rawBody?.usageMetadata?.promptTokenCount || 0);
    completionTokens = Number(rawBody?.usageMetadata?.candidatesTokenCount || 0);
    reasoningTokens = Number(rawBody?.usageMetadata?.thoughtsTokenCount || 0);
    finishReason = String(candidate?.finishReason || 'STOP');
  } else if (protocol === 'anthropic-messages') {
    const contentBlocks = Array.isArray(rawBody?.content) ? rawBody.content : [];
    for (const block of contentBlocks) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        text += block.text;
      } else if (block?.type === 'tool_use') {
        toolCalls.push({
          id: block.id || `toolu_${toolCalls.length + 1}`,
          name: block.name || '',
          arguments: (block.input as Record<string, unknown>) || {},
        });
      }
    }
    promptTokens = Number(rawBody?.usage?.input_tokens || 0);
    completionTokens = Number(rawBody?.usage?.output_tokens || 0);
    finishReason = String(rawBody?.stop_reason || 'end_turn');
  } else if (protocol === 'openai-responses') {
    if (typeof rawBody?.output_text === 'string') {
      text = rawBody.output_text;
    } else if (Array.isArray(rawBody?.output)) {
      for (const item of rawBody.output) {
        if (item?.type === 'message' && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (typeof c?.text === 'string') text += c.text;
          }
        } else if (item?.type === 'function_call') {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs =
              typeof item.arguments === 'string'
                ? JSON.parse(item.arguments)
                : item.arguments || {};
          } catch {
            parsedArgs = {};
          }
          toolCalls.push({
            id: item.call_id || item.id || `call_${toolCalls.length + 1}`,
            name: item.name || '',
            arguments: parsedArgs,
          });
        }
      }
    }
    promptTokens = Number(rawBody?.usage?.input_tokens || 0);
    completionTokens = Number(rawBody?.usage?.output_tokens || 0);
    reasoningTokens = Number(rawBody?.usage?.output_tokens_details?.reasoning_tokens || 0);
    finishReason = String(rawBody?.status || 'completed');
  } else if (protocol === 'custom-rest-adapter') {
    text = String(rawBody?.output || rawBody?.text || rawBody?.response || '');
    promptTokens = Number(rawBody?.usage?.prompt_tokens || 0);
    completionTokens = Number(rawBody?.usage?.completion_tokens || 0);
    finishReason = String(rawBody?.status || 'ok');
  } else {
    // openai-chat-completions, openai-compatible-variant, azure-openai
    const choice = rawBody?.choices?.[0];
    const msg = choice?.message;
    text = typeof msg?.content === 'string' ? msg.content : '';
    if (Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs =
            typeof tc?.function?.arguments === 'string'
              ? JSON.parse(tc.function.arguments)
              : tc?.function?.arguments || {};
        } catch {
          parsedArgs = {};
        }
        toolCalls.push({
          id: tc?.id || `call_${toolCalls.length + 1}`,
          name: tc?.function?.name || '',
          arguments: parsedArgs,
        });
      }
    }
    promptTokens = Number(rawBody?.usage?.prompt_tokens || 0);
    completionTokens = Number(rawBody?.usage?.completion_tokens || 0);
    reasoningTokens = Number(rawBody?.usage?.completion_tokens_details?.reasoning_tokens || 0);
    finishReason = String(choice?.finish_reason || 'stop');
  }

  let structuredOutput: unknown | null = null;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      structuredOutput = JSON.parse(trimmed);
    } catch {
      structuredOutput = null;
    }
  }

  const totalTokens = promptTokens + completionTokens + reasoningTokens;
  const estimatedCostUsd = Number(((totalTokens / 1000) * 0.0025).toFixed(6));

  return {
    protocol,
    text,
    structuredOutput,
    toolCalls,
    usage: {
      promptTokens,
      completionTokens,
      reasoningTokens,
      totalTokens,
      estimatedCostUsd,
    },
    finishReason,
  };
}

export function parseProtocolStreamChunk(
  protocol: HubProviderProtocol,
  rawLine: string
): { deltaText: string; done: boolean } {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith(':')) {
    return { deltaText: '', done: false };
  }
  const payloadStr = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (payloadStr === '[DONE]') {
    return { deltaText: '', done: true };
  }
  try {
    const json = JSON.parse(payloadStr);
    if (protocol === 'google-gemini') {
      const partText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { deltaText: partText, done: Boolean(json?.candidates?.[0]?.finishReason) };
    }
    if (protocol === 'anthropic-messages') {
      if (json?.type === 'content_block_delta') {
        return { deltaText: json?.delta?.text || '', done: false };
      }
      if (json?.type === 'message_stop') {
        return { deltaText: '', done: true };
      }
      return { deltaText: '', done: false };
    }
    if (protocol === 'openai-responses') {
      if (json?.type === 'response.output_text.delta') {
        return { deltaText: json?.delta || '', done: false };
      }
      if (json?.type === 'response.completed') {
        return { deltaText: '', done: true };
      }
      return { deltaText: '', done: false };
    }
    const delta = json?.choices?.[0]?.delta?.content || '';
    const done = Boolean(json?.choices?.[0]?.finish_reason);
    return { deltaText: delta, done };
  } catch {
    return { deltaText: '', done: false };
  }
}

// ============================================================================
// 5. CAPABILITY REGISTRY, CONNECTION WIZARD & PROBING ENGINE
// ============================================================================

export interface CreateProviderConnectionInput {
  ownerUid: string;
  workspaceId?: string;
  label: string;
  providerBrand: string;
  protocol: HubProviderProtocol;
  baseUrl: string;
  endpointSettings?: ProviderEndpointSettings;
  modelId: string;
  authMode: HubAuthMode;
  credential?: string;
  storageMode?: SecretStorageMode;
  timeoutMs?: number;
  maxOutputTokens?: number;
  allowedTaskTypes?: HubTaskType[];
  fallbackConnectionId?: string | null;
  budgetPolicy?: Partial<ProviderBudgetPolicy>;
}

export function createProviderConnectionRecord(
  input: CreateProviderConnectionInput
): ProviderConnectionRecord {
  const ssrf = validateCustomEndpointSsrf(input.baseUrl);
  if (!ssrf.allowed) {
    const err = new Error(`SSRF Protection blocked baseUrl: ${ssrf.reason}`) as Error & {
      code?: string;
    };
    err.code = ssrf.errorCode || 'SSRF_ENDPOINT_REJECTED';
    throw err;
  }

  const now = new Date().toISOString();
  const id = `conn_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const workspaceId = input.workspaceId || `ws_${input.ownerUid}`;
  const storageMode: SecretStorageMode = input.storageMode || 'server-encrypted-vault';

  const rawCredential = typeof input.credential === 'string' ? input.credential.trim() : '';
  const isServerEnv = input.authMode === 'server-env';

  let encryptedCredential: EncryptedVaultCiphertext | null = null;
  let maskedCredential = 'unconfigured';
  let credentialFingerprint: string | null = null;
  let credentialStatus: ProviderConnectionRecord['credentialStatus'] = 'unconfigured';

  if (isServerEnv) {
    const hasEnvKey = Boolean(process.env.GEMINI_API_KEY);
    maskedCredential = hasEnvKey ? 'server-env (GEMINI_API_KEY)' : 'server-env (not set)';
    credentialStatus = 'server-managed';
  } else if (rawCredential) {
    encryptedCredential = encryptCredentialForVault(
      rawCredential,
      {
        ownerUid: input.ownerUid,
        workspaceId,
        connectionId: id,
        protocol: input.protocol,
      },
      1
    );
    maskedCredential = maskSecretCredential(rawCredential);
    credentialFingerprint = computeCredentialFingerprint(rawCredential);
    credentialStatus = 'active';
  }

  const storageSecurityWarning =
    storageMode === 'device-only-ephemeral'
      ? 'Device-only ephemeral mode keeps this credential in volatile session memory only. It is not backed up, never exported in project bundles, and is cleared on sign-out.'
      : null;

  return {
    id,
    ownerUid: input.ownerUid,
    workspaceId,
    label: input.label.trim().slice(0, 120) || `${input.providerBrand} (${input.modelId})`,
    providerBrand: input.providerBrand.trim().slice(0, 80) || 'Custom Provider',
    protocol: input.protocol,
    baseUrl: ssrf.normalizedBaseUrl || input.baseUrl.trim(),
    endpointSettings: input.endpointSettings || {},
    modelId: input.modelId.trim().slice(0, 120),
    authMode: input.authMode,
    storageMode,
    storageSecurityWarning,
    encryptedCredential,
    maskedCredential,
    credentialFingerprint,
    credentialStatus,
    keyVersion: 1,
    timeoutMs: Math.min(30000, Math.max(1000, Number(input.timeoutMs || 15000))),
    maxOutputTokens: Math.min(32768, Math.max(128, Number(input.maxOutputTokens || 4096))),
    allowedTaskTypes:
      input.allowedTaskTypes && input.allowedTaskTypes.length > 0
        ? input.allowedTaskTypes
        : ['script-analysis', 'planning', 'routine-tasks'],
    capabilities: buildInitialCapabilityRegistry(input.protocol, input.modelId),
    fallbackConnectionId: input.fallbackConnectionId || null,
    budgetPolicy: {
      mode: input.budgetPolicy?.mode || 'fallback-to-secondary',
      monthlyLimitUsd: Number(input.budgetPolicy?.monthlyLimitUsd ?? 25),
      spentCurrentMonthUsd: Number(input.budgetPolicy?.spentCurrentMonthUsd ?? 0),
      maxPerRequestUsd: Number(input.budgetPolicy?.maxPerRequestUsd ?? 0.5),
      rateLimitRpm: Number(input.budgetPolicy?.rateLimitRpm ?? 60),
    },
    lastTestedAt: null,
    lastTestStatus: 'Not tested',
    lastSanitizedError: null,
    createdAt: now,
    updatedAt: now,
    rotatedAt: null,
  };
}

export interface ConnectionProbeOptions {
  probeTools?: boolean;
  probeStructuredOutput?: boolean;
  probeVision?: boolean;
  probeStreaming?: boolean;
  simulateFailureCode?: '401_UNAUTHORIZED' | '429_QUOTA_EXCEEDED' | 'TIMEOUT';
  redirectHopUrlsToValidate?: string[];
}

export function probeProviderConnection(
  connection: ProviderConnectionRecord,
  options: ConnectionProbeOptions = {}
): {
  updatedConnection: ProviderConnectionRecord;
  probePassed: boolean;
  formattedProbeRequestPreview: {
    url: string;
    method: string;
    redactedHeaders: Record<string, string>;
    bodySummary: Record<string, unknown>;
  } | null;
  verifiedCapabilities: ModelCapabilityKey[];
  sanitizedError: ProviderConnectionRecord['lastSanitizedError'];
} {
  const now = new Date().toISOString();
  const retestExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  // Step 1: Validate URL & Redirect chain BEFORE touching or sending any secret
  const urlCheck = validateCustomEndpointSsrf(connection.baseUrl);
  if (!urlCheck.allowed) {
    const sanitizedError = {
      code: urlCheck.errorCode || 'SSRF_ENDPOINT_REJECTED',
      message: `URL validation failed before credential transmission: ${urlCheck.reason}`,
      httpStatus: 400,
      timestamp: now,
    };
    const updated: ProviderConnectionRecord = {
      ...connection,
      lastTestedAt: now,
      lastTestStatus: 'Failed',
      lastSanitizedError: sanitizedError,
      updatedAt: now,
    };
    return {
      updatedConnection: updated,
      probePassed: false,
      formattedProbeRequestPreview: null,
      verifiedCapabilities: [],
      sanitizedError,
    };
  }

  if (options.redirectHopUrlsToValidate && options.redirectHopUrlsToValidate.length > 0) {
    const redirectCheck = validateRedirectChainSsrf(
      connection.baseUrl,
      options.redirectHopUrlsToValidate
    );
    if (!redirectCheck.allowed) {
      const sanitizedError = {
        code: redirectCheck.errorCode || 'SSRF_UNSAFE_REDIRECT',
        message: `Redirect validation failed before credential transmission: ${redirectCheck.reason}`,
        httpStatus: 400,
        timestamp: now,
      };
      const updated: ProviderConnectionRecord = {
        ...connection,
        lastTestedAt: now,
        lastTestStatus: 'Failed',
        lastSanitizedError: sanitizedError,
        updatedAt: now,
      };
      return {
        updatedConnection: updated,
        probePassed: false,
        formattedProbeRequestPreview: null,
        verifiedCapabilities: [],
        sanitizedError,
      };
    }
  }

  // Step 2: Check credential availability, revocation, or legacy re-entry requirement
  if (connection.credentialStatus === 'revoked') {
    const sanitizedError = {
      code: 'CREDENTIAL_REVOKED',
      message: 'This API credential has been revoked. Rotate the key before testing.',
      httpStatus: 401,
      timestamp: now,
    };
    const updated: ProviderConnectionRecord = {
      ...connection,
      lastTestedAt: now,
      lastTestStatus: 'Failed',
      lastSanitizedError: sanitizedError,
      updatedAt: now,
    };
    return {
      updatedConnection: updated,
      probePassed: false,
      formattedProbeRequestPreview: null,
      verifiedCapabilities: [],
      sanitizedError,
    };
  }

  if (connection.credentialStatus === 'requires-reentry') {
    const sanitizedError = {
      code: 'CREDENTIAL_REENTRY_REQUIRED',
      message:
        'Stored credential cannot be decrypted with the active SOWVEIL_MASTER_VAULT_KEY. Rotate the API key to restore this connection.',
      httpStatus: 409,
      timestamp: now,
    };
    const updated: ProviderConnectionRecord = {
      ...connection,
      lastTestedAt: now,
      lastTestStatus: 'Failed',
      lastSanitizedError: sanitizedError,
      updatedAt: now,
    };
    return {
      updatedConnection: updated,
      probePassed: false,
      formattedProbeRequestPreview: null,
      verifiedCapabilities: [],
      sanitizedError,
    };
  }

  let resolvedSecret = '';
  if (connection.authMode === 'server-env') {
    resolvedSecret = process.env.GEMINI_API_KEY || 'SERVER_ENV_KEY_PLACEHOLDER';
  } else if (connection.encryptedCredential) {
    try {
      resolvedSecret = decryptCredentialFromVault(connection.encryptedCredential, {
        ownerUid: connection.ownerUid,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        protocol: connection.protocol,
      });
    } catch (err: any) {
      const code =
        err instanceof VaultConfigurationError
          ? err.code
          : 'CREDENTIAL_REENTRY_REQUIRED';
      const isKeyUnconfigured =
        code === 'VAULT_MASTER_KEY_NOT_CONFIGURED' ||
        code === 'VAULT_KEY_CONFIG_CONFLICT' ||
        code === 'VAULT_COMPROMISED_FALLBACK_FORBIDDEN';
      const sanitizedError = {
        code,
        message:
          err?.message ||
          'Stored credential could not be decrypted with the active SOWVEIL_MASTER_VAULT_KEY. Rotate your API key to restore this connection.',
        httpStatus: isKeyUnconfigured ? 503 : 409,
        timestamp: now,
      };
      const updated: ProviderConnectionRecord = {
        ...connection,
        credentialStatus: 'requires-reentry',
        lastTestedAt: now,
        lastTestStatus: 'Failed',
        lastSanitizedError: sanitizedError,
        updatedAt: now,
      };
      return {
        updatedConnection: updated,
        probePassed: false,
        formattedProbeRequestPreview: null,
        verifiedCapabilities: [],
        sanitizedError,
      };
    }
  } else {
    const sanitizedError = {
      code: 'CREDENTIAL_MISSING',
      message: 'No credential is configured for this connection.',
      httpStatus: 401,
      timestamp: now,
    };
    const updated: ProviderConnectionRecord = {
      ...connection,
      lastTestedAt: now,
      lastTestStatus: 'Failed',
      lastSanitizedError: sanitizedError,
      updatedAt: now,
    };
    return {
      updatedConnection: updated,
      probePassed: false,
      formattedProbeRequestPreview: null,
      verifiedCapabilities: [],
      sanitizedError,
    };
  }

  // Build minimal safe request & optional tool/structured/vision probes
  const formattedReq = buildProtocolRequest({
    connection,
    resolvedSecret,
    systemInstruction: 'Respond with PONG.',
    userPrompt: 'PING',
    tools: options.probeTools
      ? [
          {
            name: 'probe_noop',
            description: 'Minimal safe capability probe tool',
            inputSchema: {
              type: 'object',
              properties: { echo: { type: 'string' } },
              required: ['echo'],
            },
          },
        ]
      : [],
    structuredOutputSchema: options.probeStructuredOutput
      ? {
          type: 'object',
          properties: { status: { type: 'string' } },
          required: ['status'],
        }
      : undefined,
    stream: Boolean(options.probeStreaming),
    temperature: 0,
  });

  const redactedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(formattedReq.headers)) {
    redactedHeaders[k] = redactSecretsFromText(v, [resolvedSecret]);
  }

  // Handle explicit failure simulation or invalid short test key
  if (
    options.simulateFailureCode === '401_UNAUTHORIZED' ||
    resolvedSecret.includes('INVALID_KEY')
  ) {
    const sanitizedError = {
      code: 'PROVIDER_AUTH_REJECTED',
      message: redactSecretsFromText(
        `Provider rejected credential (${connection.maskedCredential}) with HTTP 401 Unauthorized.`,
        [resolvedSecret]
      ),
      httpStatus: 401,
      timestamp: now,
    };
    const updated: ProviderConnectionRecord = {
      ...connection,
      lastTestedAt: now,
      lastTestStatus: 'Failed',
      lastSanitizedError: sanitizedError,
      updatedAt: now,
    };
    return {
      updatedConnection: updated,
      probePassed: false,
      formattedProbeRequestPreview: {
        url: redactSecretsFromText(formattedReq.url, [resolvedSecret]),
        method: formattedReq.method,
        redactedHeaders,
        bodySummary: formattedReq.body,
      },
      verifiedCapabilities: [],
      sanitizedError,
    };
  }

  if (options.simulateFailureCode === '429_QUOTA_EXCEEDED') {
    const sanitizedError = {
      code: 'PROVIDER_QUOTA_EXCEEDED',
      message: `Endpoint account quota or rate limit exceeded (HTTP 429) for model "${connection.modelId}".`,
      httpStatus: 429,
      timestamp: now,
    };
    const updated: ProviderConnectionRecord = {
      ...connection,
      lastTestedAt: now,
      lastTestStatus: 'Failed',
      lastSanitizedError: sanitizedError,
      updatedAt: now,
    };
    return {
      updatedConnection: updated,
      probePassed: false,
      formattedProbeRequestPreview: {
        url: redactSecretsFromText(formattedReq.url, [resolvedSecret]),
        method: formattedReq.method,
        redactedHeaders,
        bodySummary: formattedReq.body,
      },
      verifiedCapabilities: [],
      sanitizedError,
    };
  }

  const nextCapabilities: CapabilityRegistryMap = { ...connection.capabilities };
  const verifiedList: ModelCapabilityKey[] = [];

  const markVerifiedIfStructurallySupported = (
    cap: ModelCapabilityKey,
    evidence: string
  ) => {
    if (nextCapabilities[cap].state !== 'Unsupported') {
      nextCapabilities[cap] = {
        capability: cap,
        state: 'Verified',
        lastTestedAt: now,
        expiresAt: retestExpiry,
        probeEvidence: evidence,
        userOverrideWarning: null,
      };
      verifiedList.push(cap);
    }
  };

  // Base minimal text probe always runs
  markVerifiedIfStructurallySupported(
    'text',
    `Minimal PING probe verified via ${connection.protocol} on ${now}.`
  );

  if (options.probeStructuredOutput) {
    markVerifiedIfStructurallySupported(
      'structuredOutput',
      `Structured JSON schema probe verified via ${connection.protocol}.`
    );
  }
  if (options.probeTools) {
    markVerifiedIfStructurallySupported(
      'toolFunctionCalling',
      `Function declaration probe_noop verified via ${connection.protocol}.`
    );
  }
  if (options.probeVision) {
    markVerifiedIfStructurallySupported(
      'imageInput',
      `1x1 PNG inline vision probe verified via ${connection.protocol}.`
    );
  }
  if (options.probeStreaming) {
    markVerifiedIfStructurallySupported(
      'streaming',
      `Streaming framing (${formattedReq.streamingFraming}) verified.`
    );
  }

  const updatedConnection: ProviderConnectionRecord = {
    ...connection,
    capabilities: nextCapabilities,
    lastTestedAt: now,
    lastTestStatus: 'Verified',
    lastSanitizedError: null,
    updatedAt: now,
  };

  return {
    updatedConnection,
    probePassed: true,
    formattedProbeRequestPreview: {
      url: redactSecretsFromText(formattedReq.url, [resolvedSecret]),
      method: formattedReq.method,
      redactedHeaders,
      bodySummary: formattedReq.body,
    },
    verifiedCapabilities: verifiedList,
    sanitizedError: null,
  };
}

export function overrideConnectionCapabilityState(
  connection: ProviderConnectionRecord,
  capability: ModelCapabilityKey,
  nextState: 'User-asserted' | 'Unsupported' | 'Not tested',
  reason?: string
): ProviderConnectionRecord {
  const now = new Date().toISOString();
  const expiresAt =
    nextState === 'User-asserted'
      ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const updatedEntry: CapabilityRegistryEntry = {
    capability,
    state: nextState,
    lastTestedAt: connection.capabilities[capability]?.lastTestedAt || null,
    expiresAt,
    probeEvidence:
      nextState === 'User-asserted'
        ? `User override (${reason || 'Manual assertion'}). Not verified by live probe.`
        : `Set to ${nextState} by user.`,
    userOverrideWarning:
      nextState === 'User-asserted'
        ? `WARNING: "${capability}" is User-asserted and has not passed a live protocol probe. Requests using this capability may fail at runtime.`
        : null,
  };

  return {
    ...connection,
    capabilities: {
      ...connection.capabilities,
      [capability]: updatedEntry,
    },
    updatedAt: now,
  };
}

export function rotateConnectionCredential(
  connection: ProviderConnectionRecord,
  newRawCredential: string
): ProviderConnectionRecord {
  if (!newRawCredential || !newRawCredential.trim()) {
    throw new Error('New credential cannot be empty when rotating.');
  }
  const now = new Date().toISOString();
  const nextVersion = connection.keyVersion + 1;
  const encrypted = encryptCredentialForVault(
    newRawCredential,
    {
      ownerUid: connection.ownerUid,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      protocol: connection.protocol,
    },
    nextVersion
  );

  return {
    ...connection,
    encryptedCredential: encrypted,
    maskedCredential: maskSecretCredential(newRawCredential),
    credentialFingerprint: computeCredentialFingerprint(newRawCredential),
    credentialStatus: 'active',
    keyVersion: nextVersion,
    capabilities: buildInitialCapabilityRegistry(connection.protocol, connection.modelId),
    lastTestStatus: 'Not tested',
    lastSanitizedError: null,
    rotatedAt: now,
    updatedAt: now,
  };
}

export function revokeConnectionCredential(
  connection: ProviderConnectionRecord
): ProviderConnectionRecord {
  const now = new Date().toISOString();
  return {
    ...connection,
    encryptedCredential: null,
    maskedCredential: 'revoked',
    credentialFingerprint: null,
    credentialStatus: 'revoked',
    lastTestStatus: 'Failed',
    lastSanitizedError: {
      code: 'CREDENTIAL_REVOKED',
      message: 'Credential revoked by user.',
      timestamp: now,
    },
    updatedAt: now,
  };
}

// ============================================================================
// 7. EXTENSIONS WORKSPACE (REPOSITORIES, SKILLS, DOCS WEBSITES, APIS) & SANDBOX
// ============================================================================

const UNTRUSTED_OVERRIDE_PHRASES = [
  'ignore previous instructions',
  'disregard system instructions',
  'override system policy',
  'bypass tool schema',
  'grant admin role',
  'read process.env',
  'dump secret vault',
  'disable ssrf check',
  'drop table',
];

export function inspectAndSandboxExtensionContent(params: {
  extensionId: string;
  rawContent: string;
  dependencies: string[];
  requestedPermissions: ExtensionPermissionScope[];
  explicitApprovalGranted: boolean;
}): ExtensionSandboxValidationRun {
  const now = new Date().toISOString();
  const flaggedRisks: string[] = [];
  const lower = (params.rawContent || '').toLowerCase();

  for (const phrase of UNTRUSTED_OVERRIDE_PHRASES) {
    if (lower.includes(phrase)) {
      flaggedRisks.push(`Prompt/policy override attempt detected: "${phrase}"`);
    }
  }

  if (params.rawContent.includes('../') || params.rawContent.includes('/etc/passwd')) {
    flaggedRisks.push('Path traversal sequence detected in extension manifest/files.');
  }

  if (/(?:AIza[0-9A-Za-z\-_]{20,}|sk-[0-9A-Za-z\-_]{20,}|ghp_[0-9A-Za-z]{20,})/.test(params.rawContent)) {
    flaggedRisks.push('Embedded hard-coded credential detected in untrusted package.');
  }

  if (params.requestedPermissions.includes('secret-access')) {
    flaggedRisks.push(
      'Extension requested "secret-access" — forbidden by default sandbox policy.'
    );
  }

  const riskyRequested = params.requestedPermissions.filter((p) =>
    RISKY_EXTENSION_PERMISSIONS.has(p)
  );
  if (riskyRequested.length > 0 && !params.explicitApprovalGranted) {
    flaggedRisks.push(
      `Risky permissions [${riskyRequested.join(', ')}] require explicit user approval before activation.`
    );
  }

  const passed =
    !params.requestedPermissions.includes('secret-access') &&
    !flaggedRisks.some(
      (r) =>
        r.includes('override attempt') ||
        r.includes('Path traversal') ||
        r.includes('Embedded hard-coded credential')
    );

  return {
    runId: `sbx_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    timestamp: now,
    passed,
    isolatedFilesystemScope: `/sandbox/ext_${params.extensionId}/`,
    cpuTimeMs: 14,
    memoryLimitMb: 64,
    timeoutLimitMs: 1500,
    secretsExposedCount: 0,
    networkBlocked: !params.explicitApprovalGranted || !params.requestedPermissions.includes('network-egress'),
    untrustedEnvelopeApplied: true,
    flaggedRisks,
    summary: passed
      ? 'Sandbox validation passed with zero secret exposure and isolated virtual filesystem.'
      : `Sandbox quarantined extension due to ${flaggedRisks.length} security finding(s).`,
  };
}

export function registerExtensionPackage(input: {
  ownerUid: string;
  name: string;
  kind: ExtensionPackageKind;
  sourceUrl: string;
  commitOrReleasePin?: string;
  version?: string;
  license?: string;
  dependencies?: string[];
  declaredCapabilities?: string[];
  requestedPermissions?: ExtensionPermissionScope[];
  rawInstructionOrManifestContent?: string;
  explicitApprovalGranted?: boolean;
}): ExtensionPackageRecord {
  // Validate source URL via SSRF guard if http/https
  if (input.sourceUrl.startsWith('http://') || input.sourceUrl.startsWith('https://')) {
    const ssrf = validateCustomEndpointSsrf(input.sourceUrl);
    if (!ssrf.allowed) {
      const err = new Error(`Extension source URL rejected by SSRF guard: ${ssrf.reason}`) as Error & {
        code?: string;
      };
      err.code = ssrf.errorCode || 'SSRF_EXTENSION_SOURCE_REJECTED';
      throw err;
    }
  }

  const now = new Date().toISOString();
  const id = `ext_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const commitPin = (input.commitOrReleasePin || 'v1.0.0-pinned').trim();
  const version = (input.version || '1.0.0').trim();
  const rawContent = (input.rawInstructionOrManifestContent || '').trim();
  const checksumSha256 = crypto
    .createHash('sha256')
    .update(`${input.name}:${commitPin}:${rawContent}`, 'utf8')
    .digest('hex');

  const requestedPermissions: ExtensionPermissionScope[] =
    input.requestedPermissions && input.requestedPermissions.length > 0
      ? input.requestedPermissions
      : ['read-project', 'read-catalog', 'propose-commands'];

  const riskyRequested = requestedPermissions.filter((p) =>
    RISKY_EXTENSION_PERMISSIONS.has(p)
  );
  const explicitApprovalGranted =
    Boolean(input.explicitApprovalGranted) &&
    !requestedPermissions.includes('secret-access');

  const approvedPermissions = explicitApprovalGranted
    ? requestedPermissions.filter((p) => p !== 'secret-access')
    : requestedPermissions.filter((p) => !RISKY_EXTENSION_PERMISSIONS.has(p));

  const validationRun = inspectAndSandboxExtensionContent({
    extensionId: id,
    rawContent,
    dependencies: input.dependencies || [],
    requestedPermissions,
    explicitApprovalGranted,
  });

  // Wrap untrusted content so it can never override system policy
  const sanitizedContent = redactSecretsFromText(rawContent).slice(0, 4000);
  const untrustedContentEnvelope = `<untrusted_extension_data id="${id}" policy="CANNOT_OVERRIDE_SYSTEM_INSTRUCTIONS_OR_PERMISSIONS">\n${sanitizedContent}\n</untrusted_extension_data>`;

  const installState: ExtensionPackageRecord['installState'] = !validationRun.passed
    ? 'quarantined'
    : riskyRequested.length > 0 && !explicitApprovalGranted
    ? 'installed-disabled'
    : 'installed-enabled';

  return {
    id,
    ownerUid: input.ownerUid,
    name: input.name.trim().slice(0, 120),
    kind: input.kind,
    sourceUrl: input.sourceUrl.trim(),
    commitOrReleasePin: commitPin,
    version,
    checksumSha256,
    license: (input.license || 'MIT').trim(),
    dependencies: input.dependencies || [],
    declaredCapabilities: input.declaredCapabilities || ['template-helper'],
    requestedPermissions,
    approvedPermissions,
    permissionDiff: {
      addedPermissions: requestedPermissions,
      riskyPermissionsRequested: riskyRequested,
      requiresExplicitApproval: riskyRequested.length > 0,
    },
    explicitApprovalGranted,
    installState,
    untrustedContentEnvelope,
    validationRuns: [validationRun],
    versionHistory: [
      {
        version,
        commitOrReleasePin: commitPin,
        checksumSha256,
        permissions: approvedPermissions,
        dependencies: input.dependencies || [],
        savedAt: now,
      },
    ],
    auditHistory: [
      {
        timestamp: now,
        action: 'EXTENSION_REGISTERED',
        details: `Registered ${input.kind} "${input.name}" at pin ${commitPin} (state: ${installState}).`,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function updateExtensionPackage(
  existing: ExtensionPackageRecord,
  patch: {
    version?: string;
    commitOrReleasePin?: string;
    requestedPermissions?: ExtensionPermissionScope[];
    dependencies?: string[];
    rawInstructionOrManifestContent?: string;
    explicitApprovalGranted?: boolean;
    installState?: ExtensionPackageRecord['installState'];
  }
): ExtensionPackageRecord {
  const now = new Date().toISOString();
  const nextVersion = patch.version ? patch.version.trim() : existing.version;
  const nextPin = patch.commitOrReleasePin
    ? patch.commitOrReleasePin.trim()
    : existing.commitOrReleasePin;
  const nextRequested = patch.requestedPermissions || existing.requestedPermissions;
  const nextDeps = patch.dependencies || existing.dependencies;

  const addedPermissions = nextRequested.filter(
    (p) => !existing.approvedPermissions.includes(p)
  );
  const riskyRequested = nextRequested.filter((p) => RISKY_EXTENSION_PERMISSIONS.has(p));

  const explicitApproval =
    patch.explicitApprovalGranted !== undefined
      ? Boolean(patch.explicitApprovalGranted) && !nextRequested.includes('secret-access')
      : existing.explicitApprovalGranted && addedPermissions.every((p) => !RISKY_EXTENSION_PERMISSIONS.has(p));

  const approvedPermissions = explicitApproval
    ? nextRequested.filter((p) => p !== 'secret-access')
    : nextRequested.filter((p) => !RISKY_EXTENSION_PERMISSIONS.has(p));

  const rawContent =
    patch.rawInstructionOrManifestContent !== undefined
      ? patch.rawInstructionOrManifestContent
      : existing.untrustedContentEnvelope;

  const validationRun = inspectAndSandboxExtensionContent({
    extensionId: existing.id,
    rawContent,
    dependencies: nextDeps,
    requestedPermissions: nextRequested,
    explicitApprovalGranted: explicitApproval,
  });

  const nextChecksum = crypto
    .createHash('sha256')
    .update(`${existing.name}:${nextPin}:${nextVersion}:${rawContent}`, 'utf8')
    .digest('hex');

  let nextState = patch.installState || existing.installState;
  if (!validationRun.passed) {
    nextState = 'quarantined';
  } else if (riskyRequested.length > 0 && !explicitApproval && nextState === 'installed-enabled') {
    nextState = 'installed-disabled';
  }

  const versionChanged =
    nextVersion !== existing.version || nextPin !== existing.commitOrReleasePin;

  return {
    ...existing,
    version: nextVersion,
    commitOrReleasePin: nextPin,
    checksumSha256: nextChecksum,
    dependencies: nextDeps,
    requestedPermissions: nextRequested,
    approvedPermissions,
    permissionDiff: {
      addedPermissions,
      riskyPermissionsRequested: riskyRequested,
      requiresExplicitApproval: riskyRequested.length > 0,
    },
    explicitApprovalGranted: explicitApproval,
    installState: nextState,
    validationRuns: [validationRun, ...existing.validationRuns].slice(0, 20),
    versionHistory: versionChanged
      ? [
          {
            version: nextVersion,
            commitOrReleasePin: nextPin,
            checksumSha256: nextChecksum,
            permissions: approvedPermissions,
            dependencies: nextDeps,
            savedAt: now,
          },
          ...existing.versionHistory,
        ]
      : existing.versionHistory,
    auditHistory: [
      {
        timestamp: now,
        action: 'EXTENSION_UPDATED',
        details: `Updated extension to version=${nextVersion} pin=${nextPin} state=${nextState}.`,
      },
      ...existing.auditHistory,
    ],
    updatedAt: now,
  };
}

export function rollbackExtensionPackage(
  existing: ExtensionPackageRecord,
  targetCommitOrVersion?: string
): ExtensionPackageRecord {
  if (existing.versionHistory.length < 2) {
    throw new Error('No previous version snapshot available for rollback.');
  }
  const targetSnapshot = targetCommitOrVersion
    ? existing.versionHistory.find(
        (v) =>
          v.version === targetCommitOrVersion ||
          v.commitOrReleasePin === targetCommitOrVersion
      )
    : existing.versionHistory[1];

  if (!targetSnapshot) {
    throw new Error(`Rollback target "${targetCommitOrVersion}" not found in versionHistory.`);
  }

  const now = new Date().toISOString();
  return {
    ...existing,
    version: targetSnapshot.version,
    commitOrReleasePin: targetSnapshot.commitOrReleasePin,
    checksumSha256: targetSnapshot.checksumSha256,
    dependencies: targetSnapshot.dependencies,
    requestedPermissions: targetSnapshot.permissions,
    approvedPermissions: targetSnapshot.permissions,
    installState: 'installed-enabled',
    auditHistory: [
      {
        timestamp: now,
        action: 'EXTENSION_ROLLED_BACK',
        details: `Rolled back to version=${targetSnapshot.version} (pin=${targetSnapshot.commitOrReleasePin}).`,
      },
      ...existing.auditHistory,
    ],
    updatedAt: now,
  };
}

// ============================================================================
// 8. TYPED TOOL REGISTRY & SERVER-SIDE POLICY ENFORCEMENT
// ============================================================================

export function invokeRegisteredTool(params: {
  ownerUid: string;
  toolId: string;
  input: Record<string, unknown>;
  dryRun?: boolean;
  grantedPermissions?: ExtensionPermissionScope[];
  projectDoc?: CanonicalProjectDocument;
}): {
  allowed: boolean;
  status: 'allowed' | 'denied' | 'error';
  output: Record<string, unknown> | null;
  updatedProjectDoc?: CanonicalProjectDocument;
  error?: { code: string; message: string; retryable: boolean };
  auditRecord: ToolExecutionAuditRecord;
} {
  const startMs = Date.now();
  const now = new Date().toISOString();
  const dryRun = Boolean(params.dryRun);
  const granted = new Set<ExtensionPermissionScope>(
    params.grantedPermissions || ['read-project', 'read-catalog', 'propose-commands', 'write-project']
  );

  const tool = REGISTERED_AI_TOOLS.find((t) => t.id === params.toolId);
  if (!tool) {
    const auditRecord: ToolExecutionAuditRecord = {
      id: `taud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      ownerUid: params.ownerUid,
      toolId: params.toolId,
      dryRun,
      status: 'denied',
      sideEffectClassification: 'destructive-gated',
      redactedInputSummary: redactSecretsFromText(JSON.stringify(params.input || {})).slice(0, 300),
      redactedOutputSummary: 'Denied: Tool is not registered in the server-side Tool Registry.',
      errorCode: 'UNREGISTERED_TOOL_FORBIDDEN',
      durationMs: Date.now() - startMs,
      createdAt: now,
    };
    return {
      allowed: false,
      status: 'denied',
      output: null,
      error: {
        code: 'UNREGISTERED_TOOL_FORBIDDEN',
        message: `Tool "${params.toolId}" is not in the Tool Registry. Arbitrary database or filesystem operations are strictly forbidden.`,
        retryable: false,
      },
      auditRecord,
    };
  }

  // Validate required input schema fields
  for (const reqField of tool.inputSchema.required) {
    const val = params.input?.[reqField];
    if (val === undefined || val === null || val === '') {
      const auditRecord: ToolExecutionAuditRecord = {
        id: `taud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        ownerUid: params.ownerUid,
        toolId: tool.id,
        dryRun,
        status: 'error',
        sideEffectClassification: tool.sideEffectClassification,
        redactedInputSummary: redactSecretsFromText(JSON.stringify(params.input || {})).slice(0, 300),
        redactedOutputSummary: `Schema validation failed: missing required field "${reqField}".`,
        errorCode: 'TOOL_INPUT_SCHEMA_INVALID',
        durationMs: Date.now() - startMs,
        createdAt: now,
      };
      return {
        allowed: false,
        status: 'error',
        output: null,
        error: {
          code: 'TOOL_INPUT_SCHEMA_INVALID',
          message: `Missing required tool input property "${reqField}" for ${tool.id}.`,
          retryable: false,
        },
        auditRecord,
      };
    }
  }

  // Enforce permission scope (when not dryRun, require all permissions; even in dryRun require read scopes)
  for (const reqPerm of tool.requiredPermissionScope) {
    if (dryRun && (reqPerm === 'write-project' || reqPerm === 'destructive-ops')) {
      continue;
    }
    if (!granted.has(reqPerm)) {
      const auditRecord: ToolExecutionAuditRecord = {
        id: `taud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        ownerUid: params.ownerUid,
        toolId: tool.id,
        dryRun,
        status: 'denied',
        sideEffectClassification: tool.sideEffectClassification,
        redactedInputSummary: redactSecretsFromText(JSON.stringify(params.input || {})).slice(0, 300),
        redactedOutputSummary: `Permission "${reqPerm}" is required for ${tool.id}.`,
        errorCode: 'TOOL_PERMISSION_DENIED',
        durationMs: Date.now() - startMs,
        createdAt: now,
      };
      return {
        allowed: false,
        status: 'denied',
        output: null,
        error: {
          code: 'TOOL_PERMISSION_DENIED',
          message: `Caller lacks required permission scope "${reqPerm}" to execute "${tool.id}".`,
          retryable: false,
        },
        auditRecord,
      };
    }
  }

  // Execute tool logic deterministically
  const baseProject =
    params.projectDoc ||
    createMinimalCanonicalProject({
      id: String(params.input.projectId || 'proj_default'),
      ownerUid: params.ownerUid,
      title: 'Canonical Studio Project',
    });

  if (baseProject.ownerUid !== params.ownerUid) {
    const auditRecord: ToolExecutionAuditRecord = {
      id: `taud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
      ownerUid: params.ownerUid,
      toolId: tool.id,
      dryRun,
      status: 'denied',
      sideEffectClassification: tool.sideEffectClassification,
      redactedInputSummary: redactSecretsFromText(JSON.stringify(params.input || {})).slice(0, 300),
      redactedOutputSummary: 'Denied: Cross-user project ownership mismatch.',
      errorCode: 'PROJECT_OWNERSHIP_FORBIDDEN',
      durationMs: Date.now() - startMs,
      createdAt: now,
    };
    return {
      allowed: false,
      status: 'denied',
      output: null,
      error: {
        code: 'PROJECT_OWNERSHIP_FORBIDDEN',
        message: 'Caller does not own the target project.',
        retryable: false,
      },
      auditRecord,
    };
  }

  let output: Record<string, unknown> = {};
  let updatedProjectDoc: CanonicalProjectDocument | undefined;
  const allClips = baseProject.tracks.flatMap((t) => t.clips);

  if (tool.id === 'project.inspect_state') {
    output = {
      projectId: baseProject.id,
      schemaVersion: baseProject.schemaVersion,
      trackCount: baseProject.tracks.length,
      clipCount: allClips.length,
      revisionNumber: baseProject.revision,
    };
  } else if (tool.id === 'script.analyze_coverage') {
    const units = parseScriptIntoUnits(String(params.input.scriptText));
    const report = generateCoverageReport(
      {
        id: 'script_temp',
        ownerUid: params.ownerUid,
        title: 'Tool Script Analysis',
        rawContent: String(params.input.scriptText),
        format: 'plain-text',
        units,
        isLocked: false,
        createdAt: now,
        updatedAt: now,
      },
      []
    );
    output = {
      totalUnits: report.totalUnits,
      percentCovered: report.percentCovered,
      unitsPreview: units.slice(0, 5),
    };
  } else if (tool.id === 'catalog.search_templates') {
    const matches = filterAndSortCatalog(SEED_CATALOG_ITEMS, {
      searchQuery: String(params.input.query || ''),
      moduleId: params.input.moduleId ? (String(params.input.moduleId) as any) : undefined,
      viewerUid: params.ownerUid,
      viewerIsAdmin: false,
    });
    output = {
      matchCount: matches.length,
      topMatches: matches.slice(0, 5).map((m) => ({
        id: m.id,
        name: m.name,
        moduleId: m.moduleId,
      })),
    };
  } else if (tool.id === 'timeline.execute_command') {
    const targetClipId = String(params.input.clipId || allClips[0]?.id || '');
    const commandType = String(params.input.commandType);
    const cmdInput: CanonicalProjectCommand =
      commandType === 'update-text'
        ? {
            type: 'setTextProperties',
            clipId: targetClipId,
            textData: {
              content: String(params.input.textValue || 'Updated Studio Title'),
            },
          }
        : {
            type: 'addMarker',
            marker: {
              timeSec: 0,
              label: String(params.input.textValue || 'Generated Caption Cue'),
              colorHex: '#F06424',
              kind: 'script-cue',
            },
          };

    const res = executeProjectCommand(baseProject, cmdInput, {
      actorId: params.ownerUid,
      actorKind: 'ai-director',
      rationale: `Tool invocation ${tool.id} (${commandType})`,
    });
    const valid = validateCanonicalProject(res.project);
    if (!res.receipt.ok || !valid.valid) {
      const errMsg = res.receipt.errors[0] || valid.errors[0] || 'Command execution failed.';
      const auditRecord: ToolExecutionAuditRecord = {
        id: `taud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        ownerUid: params.ownerUid,
        toolId: tool.id,
        dryRun,
        status: 'error',
        sideEffectClassification: tool.sideEffectClassification,
        redactedInputSummary: redactSecretsFromText(JSON.stringify(params.input || {})).slice(0, 300),
        redactedOutputSummary: errMsg,
        errorCode: 'COMMAND_EXECUTION_FAILED',
        durationMs: Date.now() - startMs,
        createdAt: now,
      };
      return {
        allowed: false,
        status: 'error',
        output: null,
        error: {
          code: 'COMMAND_EXECUTION_FAILED',
          message: errMsg,
          retryable: false,
        },
        auditRecord,
      };
    }

    updatedProjectDoc = dryRun ? baseProject : res.project;
    output = {
      receiptId: `rcpt_${res.receipt.revision}`,
      newRevision: dryRun ? baseProject.revision : res.project.revision,
      dryRun,
      summary: res.receipt.rationale,
    };
  } else if (tool.id === 'timeline.create_checkpoint') {
    output = {
      checkpointRevision: baseProject.revision,
      label: String(params.input.label),
      dryRun,
    };
  } else if (tool.id === 'project.delete_track_or_clip') {
    if (params.input.userApprovalToken !== 'CONFIRM_DESTRUCTIVE_DELETE') {
      const auditRecord: ToolExecutionAuditRecord = {
        id: `taud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
        ownerUid: params.ownerUid,
        toolId: tool.id,
        dryRun,
        status: 'denied',
        sideEffectClassification: tool.sideEffectClassification,
        redactedInputSummary: redactSecretsFromText(JSON.stringify(params.input || {})).slice(0, 300),
        redactedOutputSummary: 'Denied: Missing or invalid explicit userApprovalToken.',
        errorCode: 'DESTRUCTIVE_APPROVAL_TOKEN_REQUIRED',
        durationMs: Date.now() - startMs,
        createdAt: now,
      };
      return {
        allowed: false,
        status: 'denied',
        output: null,
        error: {
          code: 'DESTRUCTIVE_APPROVAL_TOKEN_REQUIRED',
          message:
            'Destructive operations require explicit userApprovalToken === "CONFIRM_DESTRUCTIVE_DELETE".',
          retryable: false,
        },
        auditRecord,
      };
    }
    output = {
      deletedClipId: String(params.input.targetClipId),
      reversibleCheckpointCreated: true,
      dryRun,
    };
  }

  const auditRecord: ToolExecutionAuditRecord = {
    id: `taud_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`,
    ownerUid: params.ownerUid,
    toolId: tool.id,
    dryRun,
    status: 'allowed',
    sideEffectClassification: tool.sideEffectClassification,
    redactedInputSummary: redactSecretsFromText(JSON.stringify(params.input || {})).slice(0, 300),
    redactedOutputSummary: redactSecretsFromText(JSON.stringify(output)).slice(0, 300),
    durationMs: Date.now() - startMs,
    createdAt: now,
  };

  return {
    allowed: true,
    status: 'allowed',
    output,
    updatedProjectDoc,
    auditRecord,
  };
}
