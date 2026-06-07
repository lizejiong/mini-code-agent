import type { ChatMessage, ChatProvider, ChatToolCall } from '../providers/types.js';
import type { TranscriptEntry } from '../sessions/transcript.js';
import type { ToolRegistry, ToolResult } from '../tools/types.js';

export type RunAgentOptions = {
  task: string;
  initialMessages?: ChatMessage[];
  provider: ChatProvider;
  tools: ToolRegistry;
  maxSteps: number;
  sessionId?: string;
  recordTranscriptEntry?: (entry: TranscriptEntry) => Promise<void>;
};

export async function runAgent(options: RunAgentOptions): Promise<string> {
  const messages: ChatMessage[] = [
    ...(options.initialMessages ?? []),
    { role: 'user', content: options.task },
  ];
  const toolSchemas = options.tools.definitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
  await recordTranscriptEntry(options, {
    type: 'user',
    content: options.task,
  });

  for (let step = 0; step < options.maxSteps; step += 1) {
    const response = await options.provider.complete({
      messages,
      tools: toolSchemas,
    });

    if (response.toolCalls.length === 0) {
      await recordTranscriptEntry(options, {
        type: 'assistant',
        content: response.content,
        toolCalls: [],
      });
      return response.content;
    }

    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });
    await recordTranscriptEntry(options, {
      type: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    for (const toolCall of response.toolCalls) {
      const result = await options.tools.execute(toolCall.name, toolCall.input);

      /**
       * 工具结果序列化成 JSON，模型才能区分“成功但内容为空”和“结构化失败”。
       * 这样 provider 层仍然只需要处理普通 chat message content。
       */
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        content: JSON.stringify(result),
      });
      await recordTranscriptEntry(options, {
        type: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.name,
        result,
      });
    }
  }

  /** 达到最大步数时停止，避免模型反复请求工具导致失控循环。 */
  throw new Error('Agent stopped after reaching max steps');
}

async function recordTranscriptEntry(
  options: RunAgentOptions,
  entry:
    | {
        type: 'user';
        content: string;
      }
    | {
        type: 'assistant';
        content: string;
        toolCalls: ChatToolCall[];
      }
    | {
        type: 'tool';
        toolCallId: string;
        name: string;
        result: ToolResult;
      },
): Promise<void> {
  if (!options.recordTranscriptEntry || !options.sessionId) {
    return;
  }

  const base = {
    sessionId: options.sessionId,
    timestamp: new Date().toISOString(),
  };

  if (entry.type === 'user') {
    await options.recordTranscriptEntry({ ...base, ...entry });
    return;
  }

  if (entry.type === 'assistant') {
    await options.recordTranscriptEntry({ ...base, ...entry });
    return;
  }

  await options.recordTranscriptEntry({ ...base, ...entry });
}
