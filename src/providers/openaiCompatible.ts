import type {
  ChatCompletionChunk,
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
    async stream(
      request: ChatCompletionRequest,
      onChunk: (chunk: ChatCompletionChunk) => void,
    ): Promise<ChatCompletionResponse> {
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
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `OpenAI-compatible stream request failed with status ${response.status}: ${await response.text()}`,
        );
      }

      if (!response.body) {
        throw new Error('OpenAI-compatible stream response did not include a body');
      }

      const finalResponse = await readStreamingResponse(response.body, onChunk);
      onChunk({ type: 'message_complete', response: finalResponse });
      return finalResponse;
    },
  };
}

async function readStreamingResponse(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: ChatCompletionChunk) => void,
): Promise<ChatCompletionResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const parsed = parseSseDelta(line.trim());
      if (!parsed) {
        continue;
      }

      if (parsed.content) {
        content += parsed.content;
        onChunk({ type: 'content_delta', content: parsed.content });
      }

      mergeToolCallDeltas(toolCalls, parsed.toolCalls);
    }
  }

  buffer += decoder.decode();
  for (const line of buffer.split('\n')) {
    const parsed = parseSseDelta(line.trim());
    if (!parsed) {
      continue;
    }

    if (parsed.content) {
      content += parsed.content;
      onChunk({ type: 'content_delta', content: parsed.content });
    }

    mergeToolCallDeltas(toolCalls, parsed.toolCalls);
  }

  return {
    content,
    toolCalls: [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => ({
        id: toolCall.id,
        name: toolCall.name,
        input: parseToolArguments(toolCall.arguments || '{}'),
      })),
  };
}

function parseSseDelta(
  line: string,
):
  | {
      content: string | undefined;
      toolCalls: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    }
  | undefined {
  if (!line.startsWith('data:')) {
    return undefined;
  }

  const data = line.slice('data:'.length).trim();
  if (!data || data === '[DONE]') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const delta = parsed.choices?.[0]?.delta;
    return {
      content: delta?.content,
      toolCalls: delta?.tool_calls ?? [],
    };
  } catch {
    return undefined;
  }
}

function mergeToolCallDeltas(
  toolCalls: Map<number, { id: string; name: string; arguments: string }>,
  deltas: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
): void {
  for (const delta of deltas) {
    const current = toolCalls.get(delta.index) ?? {
      id: '',
      name: '',
      arguments: '',
    };
    toolCalls.set(delta.index, {
      id: delta.id ?? current.id,
      name: delta.function?.name ?? current.name,
      arguments: current.arguments + (delta.function?.arguments ?? ''),
    });
  }
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
