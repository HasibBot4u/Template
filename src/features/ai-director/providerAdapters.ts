import {
  AiProviderCapabilities,
  AiProviderConfig,
  AiProviderProtocol,
} from './types';

export interface FormattedAiRequest {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ParsedAiResponse {
  text: string;
  structuredData?: unknown;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  rawFinishReason?: string;
}

export interface IAiProviderAdapter {
  protocol: AiProviderProtocol;
  defaultCapabilities: AiProviderCapabilities;
  formatChatRequest(params: {
    config: AiProviderConfig;
    apiKey: string;
    systemInstruction: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    temperature?: number;
    responseFormatJson?: boolean;
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  }): FormattedAiRequest;
  parseChatResponse(responseBody: unknown): ParsedAiResponse;
}

/**
 * 1. OpenAI Chat Completions Adapter (/v1/chat/completions)
 */
export class OpenAiChatCompletionsAdapter implements IAiProviderAdapter {
  protocol: AiProviderProtocol = 'openai-chat-completions';
  defaultCapabilities: AiProviderCapabilities = {
    textGeneration: true,
    structuredJson: true,
    toolCalls: true,
    imageInput: true,
    audioInput: false,
    audioGeneration: false,
    videoInput: false,
    maxContextTokens: 128000,
  };

  formatChatRequest(params: {
    config: AiProviderConfig;
    apiKey: string;
    systemInstruction: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    temperature?: number;
    responseFormatJson?: boolean;
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  }): FormattedAiRequest {
    const { config, apiKey, systemInstruction, messages, temperature = 0.7, responseFormatJson, tools } = params;
    const url = `${config.baseUrl.replace(/\/$/, '')}${config.apiPath || '/v1/chat/completions'}`;

    const formattedMessages = [
      ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
      ...messages,
    ];

    const body: Record<string, unknown> = {
      model: config.modelId || 'gpt-4o',
      messages: formattedMessages,
      temperature,
    };

    if (responseFormatJson) {
      body.response_format = { type: 'json_object' };
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    return {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(config.customHeaders || {}),
      },
      body,
    };
  }

  parseChatResponse(responseBody: any): ParsedAiResponse {
    const choice = responseBody?.choices?.[0];
    const message = choice?.message;
    const text = message?.content || '';
    const toolCalls = message?.tool_calls?.map((tc: any) => ({
      name: tc?.function?.name || '',
      arguments: tc?.function?.arguments ? JSON.parse(tc.function.arguments) : {},
    }));

    let structuredData: unknown;
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        structuredData = JSON.parse(text);
      } catch {
        // Text is not JSON
      }
    }

    return {
      text,
      structuredData,
      toolCalls,
      tokenUsage: responseBody?.usage
        ? {
            promptTokens: responseBody.usage.prompt_tokens || 0,
            completionTokens: responseBody.usage.completion_tokens || 0,
            totalTokens: responseBody.usage.total_tokens || 0,
          }
        : undefined,
      rawFinishReason: choice?.finish_reason,
    };
  }
}

/**
 * 2. OpenAI Responses Adapter (/v1/responses)
 */
export class OpenAiResponsesAdapter implements IAiProviderAdapter {
  protocol: AiProviderProtocol = 'openai-responses';
  defaultCapabilities: AiProviderCapabilities = {
    textGeneration: true,
    structuredJson: true,
    toolCalls: true,
    imageInput: true,
    audioInput: false,
    audioGeneration: false,
    videoInput: false,
    maxContextTokens: 128000,
  };

  formatChatRequest(params: {
    config: AiProviderConfig;
    apiKey: string;
    systemInstruction: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    temperature?: number;
    responseFormatJson?: boolean;
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  }): FormattedAiRequest {
    const { config, apiKey, systemInstruction, messages, tools } = params;
    const url = `${config.baseUrl.replace(/\/$/, '')}${config.apiPath || '/v1/responses'}`;

    const input = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: config.modelId || 'gpt-4o',
      instructions: systemInstruction,
      input,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    }

    return {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(config.customHeaders || {}),
      },
      body,
    };
  }

  parseChatResponse(responseBody: any): ParsedAiResponse {
    const outputItem = responseBody?.output?.[0];
    const text = outputItem?.content?.[0]?.text || responseBody?.output_text || '';
    return {
      text,
      tokenUsage: responseBody?.usage
        ? {
            promptTokens: responseBody.usage.input_tokens || 0,
            completionTokens: responseBody.usage.output_tokens || 0,
            totalTokens: (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0),
          }
        : undefined,
      rawFinishReason: responseBody?.status,
    };
  }
}

/**
 * 3. Anthropic Messages Adapter (/v1/messages)
 */
export class AnthropicMessagesAdapter implements IAiProviderAdapter {
  protocol: AiProviderProtocol = 'anthropic-messages';
  defaultCapabilities: AiProviderCapabilities = {
    textGeneration: true,
    structuredJson: true,
    toolCalls: true,
    imageInput: true,
    audioInput: false,
    audioGeneration: false,
    videoInput: false,
    maxContextTokens: 200000,
  };

  formatChatRequest(params: {
    config: AiProviderConfig;
    apiKey: string;
    systemInstruction: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    temperature?: number;
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  }): FormattedAiRequest {
    const { config, apiKey, systemInstruction, messages, temperature = 0.7, tools } = params;
    const url = `${config.baseUrl.replace(/\/$/, '')}${config.apiPath || '/v1/messages'}`;

    // Anthropic requires 'user' or 'assistant' in messages; system is a top-level field
    const anthropicMessages = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const body: Record<string, unknown> = {
      model: config.modelId || 'claude-3-5-sonnet-20241022',
      max_tokens: config.maxOutputTokens || 4096,
      messages: anthropicMessages,
      temperature,
    };

    if (systemInstruction) {
      body.system = systemInstruction;
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...(config.customHeaders || {}),
      },
      body,
    };
  }

  parseChatResponse(responseBody: any): ParsedAiResponse {
    let text = '';
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

    if (Array.isArray(responseBody?.content)) {
      for (const block of responseBody.content) {
        if (block.type === 'text') {
          text += block.text || '';
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name || '',
            arguments: block.input || {},
          });
        }
      }
    }

    let structuredData: unknown;
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        structuredData = JSON.parse(text);
      } catch {
        // Not JSON
      }
    }

    return {
      text,
      structuredData,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      tokenUsage: responseBody?.usage
        ? {
            promptTokens: responseBody.usage.input_tokens || 0,
            completionTokens: responseBody.usage.output_tokens || 0,
            totalTokens: (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0),
          }
        : undefined,
      rawFinishReason: responseBody?.stop_reason,
    };
  }
}

/**
 * 4. Google Gemini Adapter (Google GenAI REST format)
 */
export class GoogleGeminiAdapter implements IAiProviderAdapter {
  protocol: AiProviderProtocol = 'google-gemini';
  defaultCapabilities: AiProviderCapabilities = {
    textGeneration: true,
    structuredJson: true,
    toolCalls: true,
    imageInput: true,
    audioInput: true,
    audioGeneration: false,
    videoInput: true,
    maxContextTokens: 1000000,
  };

  formatChatRequest(params: {
    config: AiProviderConfig;
    apiKey: string;
    systemInstruction: string;
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    temperature?: number;
    responseFormatJson?: boolean;
    tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  }): FormattedAiRequest {
    const { config, apiKey, systemInstruction, messages, temperature = 0.7, responseFormatJson } = params;
    const model = config.modelId || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
      apiKey
    )}`;

    const contents = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature,
        ...(responseFormatJson ? { responseMimeType: 'application/json' } : {}),
      },
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    return {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.customHeaders || {}),
      },
      body,
    };
  }

  parseChatResponse(responseBody: any): ParsedAiResponse {
    const candidate = responseBody?.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';
    let structuredData: unknown;
    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
      try {
        structuredData = JSON.parse(text);
      } catch {
        // Not JSON
      }
    }

    return {
      text,
      structuredData,
      tokenUsage: responseBody?.usageMetadata
        ? {
            promptTokens: responseBody.usageMetadata.promptTokenCount || 0,
            completionTokens: responseBody.usageMetadata.candidatesTokenCount || 0,
            totalTokens: responseBody.usageMetadata.totalTokenCount || 0,
          }
        : undefined,
      rawFinishReason: candidate?.finishReason,
    };
  }
}

/**
 * 5. Custom OpenAI-compatible Adapter
 */
export class CustomOpenAiCompatibleAdapter extends OpenAiChatCompletionsAdapter {
  override protocol: AiProviderProtocol = 'custom-openai-compatible';
}

/**
 * 6. Custom Anthropic-compatible Adapter
 */
export class CustomAnthropicCompatibleAdapter extends AnthropicMessagesAdapter {
  override protocol: AiProviderProtocol = 'custom-anthropic-compatible';
}

const ADAPTER_REGISTRY: Record<AiProviderProtocol, IAiProviderAdapter> = {
  'openai-chat-completions': new OpenAiChatCompletionsAdapter(),
  'openai-responses': new OpenAiResponsesAdapter(),
  'anthropic-messages': new AnthropicMessagesAdapter(),
  'google-gemini': new GoogleGeminiAdapter(),
  'custom-openai-compatible': new CustomOpenAiCompatibleAdapter(),
  'custom-anthropic-compatible': new CustomAnthropicCompatibleAdapter(),
};

export function getProviderAdapter(protocol: AiProviderProtocol): IAiProviderAdapter {
  const adapter = ADAPTER_REGISTRY[protocol];
  if (!adapter) {
    throw new Error(`Unsupported AI provider protocol: "${protocol}".`);
  }
  return adapter;
}
