import type { ChatMessage, ChatProvider, ChatToolCall } from '../providers/types.js';
import type { AgentMode, ModeController } from '../modes/types.js';
import { createModeSystemPrompt } from '../prompts/planMode.js';
import type { TranscriptEntry } from '../sessions/transcript.js';
import type { ToolRegistry, ToolResult } from '../tools/types.js';

export type RunAgentOptions = {
  task: string;
  initialMessages?: ChatMessage[];
  provider: ChatProvider;
  tools?: ToolRegistry;
  toolsForMode?: (mode: AgentMode) => ToolRegistry;
  modeController?: ModeController;
  maxSteps: number;
  sessionId?: string;
  recordTranscriptEntry?: (entry: TranscriptEntry) => Promise<void>;
  onEvent?: (event: AgentRunEvent) => void;
  buildSystemContext?: () => Promise<string | undefined>;
};

export type AgentRunEvent =
  | { type: 'step_start'; step: number; maxSteps: number; mode: AgentMode }
  | { type: 'assistant_delta'; content: string }
  | { type: 'assistant_tool_calls'; toolCalls: ChatToolCall[] }
  | { type: 'tool_result'; name: string; result: ToolResult }
  | { type: 'assistant_final'; content: string }
  | { type: 'error'; error: string };

export async function runAgent(options: RunAgentOptions): Promise<string> {
  const messages: ChatMessage[] = [
    ...(options.initialMessages ?? []),
    { role: 'user', content: options.task },
  ];
  await recordTranscriptEntry(options, {
    type: 'user',
    content: options.task,
  });

  for (let step = 0; step < options.maxSteps; step += 1) {
    const mode = options.modeController?.getMode() ?? 'normal';
    options.onEvent?.({
      type: 'step_start',
      step: step + 1,
      maxSteps: options.maxSteps,
      mode,
    });

    const activeTools = getActiveTools(options, mode);
    const toolSchemas = activeTools.definitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
    const requestMessages = [
      ...(await buildSystemMessages(options, mode)),
      ...messages,
    ];

    const response = options.provider.stream
      ? await options.provider.stream(
          {
            messages: requestMessages,
            tools: toolSchemas,
          },
          (chunk) => {
            if (chunk.type === 'content_delta') {
              options.onEvent?.({
                type: 'assistant_delta',
                content: chunk.content,
              });
            }
          },
        )
      : await options.provider.complete({
          messages: requestMessages,
          tools: toolSchemas,
        });

    if (response.toolCalls.length === 0) {
      await recordTranscriptEntry(options, {
        type: 'assistant',
        content: response.content,
        toolCalls: [],
      });
      options.onEvent?.({
        type: 'assistant_final',
        content: response.content,
      });
      return response.content;
    }

    options.onEvent?.({
      type: 'assistant_tool_calls',
      toolCalls: response.toolCalls,
    });

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
      const result = await activeTools.execute(toolCall.name, toolCall.input);
      options.onEvent?.({
        type: 'tool_result',
        name: toolCall.name,
        result,
      });

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

async function buildSystemMessages(
  options: RunAgentOptions,
  mode: AgentMode,
): Promise<ChatMessage[]> {
  const systemMessages: ChatMessage[] = [];
  const projectContext = await options.buildSystemContext?.();
  if (projectContext?.trim()) {
    /**
     * 项目上下文必须排在模式提示词前面，让后续 normal/plan 规则可以建立在当前仓库事实之上。
     */
    systemMessages.push({ role: 'system', content: projectContext });
  }

  if (options.modeController) {
    systemMessages.push({
      role: 'system',
      content: createModeSystemPrompt(
        mode,
        options.modeController.getPlanFilePath(),
      ),
    });
  }

  return systemMessages;
}

function getActiveTools(options: RunAgentOptions, mode: AgentMode): ToolRegistry {
  const activeTools = options.toolsForMode?.(mode) ?? options.tools;
  if (!activeTools) {
    throw new Error('No tool registry configured');
  }

  return activeTools;
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
