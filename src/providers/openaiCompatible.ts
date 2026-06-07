import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatProvider,
  ChatToolCall,
  ChatToolSchema,
} from './types.js';

type FetchLike = typeof fetch;

type OpenAICompatibleProviderOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetch?: FetchLike;
};

type OpenAIMessage = Record<string, unknown>;

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): ChatProvider {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  return {
    async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          messages: request.messages.map(toOpenAIMessage),
          tools: request.tools.map(toOpenAITool),
        }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI-compatible request failed with status ${response.status}: ${await response.text()}`,
        );
      }

      const body = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              type: string;
              function?: {
                name: string;
                arguments: string;
              };
            }>;
          };
        }>;
      };
      const message = body.choices?.[0]?.message;

      return {
        content: message?.content ?? '',
        toolCalls: (message?.tool_calls ?? []).map(toInternalToolCall),
      };
    },
  };
}

function toOpenAIMessage(message: ChatMessage): OpenAIMessage {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      ...(message.toolCalls && message.toolCalls.length > 0
        ? {
            /**
             * 内部 agent loop 保存的是已解析的工具输入对象。
             * OpenAI-compatible API 要求 function arguments 是 JSON 字符串，
             * 所以这个格式转换集中放在 provider 边界。
             */
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              type: 'function',
              function: {
                name: toolCall.name,
                arguments: JSON.stringify(toolCall.input),
              },
            })),
          }
        : {}),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toOpenAITool(tool: ChatToolSchema): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toInternalToolCall(toolCall: {
  id: string;
  function?: { name: string; arguments: string };
}): ChatToolCall {
  return {
    id: toolCall.id,
    name: toolCall.function?.name ?? '',
    input: parseToolArguments(toolCall.function?.arguments ?? '{}'),
  };
}

function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
