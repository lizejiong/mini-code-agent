import type { AgentRunEvent, RunAgentOptions } from '../agent/loop.js';
import type { TuiMessage, TuiStatus } from './types.js';
import {
  formatStepStatus,
  formatToolCall,
  formatToolResult,
} from './formatters.js';

export type AgentRunnerRun = (
  options: Pick<RunAgentOptions, 'task' | 'onEvent'>,
) => Promise<string>;

export type CreateAgentRunnerOptions = {
  appendMessage(message: TuiMessage): void;
  appendAssistantDelta(delta: string): void;
  finishAssistantMessage(content: string): void;
  refreshTodos?: () => Promise<void>;
  compact?: (trigger: 'manual' | 'auto') => Promise<string>;
  shouldAutoCompact?: () => boolean;
  runAgent: AgentRunnerRun;
};

export function createAgentRunner(options: CreateAgentRunnerOptions) {
  let status: TuiStatus = 'idle';

  return {
    getStatus: () => status,
    async run(task: string): Promise<void> {
      if (status === 'running') {
        options.appendMessage({
          role: 'status',
          content: '任务运行中，请等待当前任务结束。',
        });
        return;
      }

      status = 'running';
      if (task.trim() === '/compact') {
        try {
          await runCompact(options, 'manual');
        } catch {
          /**
           * runCompact 已经把错误写入 TUI；这里吞掉异常，保持 runner.run 的“展示错误但不抛出”语义。
           */
        } finally {
          status = 'idle';
        }
        return;
      }

      if (options.shouldAutoCompact?.()) {
        try {
          await runCompact(options, 'auto');
        } catch {
          /**
           * 自动 compact 是上下文优化，不应阻塞用户的正常任务；失败信息已经展示，继续运行 agent。
           */
        }
      }

      options.appendMessage({ role: 'user', content: task });
      const pendingRefreshes: Promise<void>[] = [];

      try {
        await options.runAgent({
          task,
          onEvent: (event) => {
            appendEventMessage(options, event);
            pendingRefreshes.push(maybeRefreshTodos(options, event));
          },
        });
        await Promise.all(pendingRefreshes);
      } catch (error) {
        options.appendMessage({
          role: 'error',
          content: error instanceof Error ? error.message : String(error),
        });
      } finally {
        status = 'idle';
      }
    },
  };
}

async function runCompact(
  options: CreateAgentRunnerOptions,
  trigger: 'manual' | 'auto',
): Promise<void> {
  if (!options.compact) {
    throw new Error('Compact is not configured.');
  }

  try {
    options.appendMessage({
      role: 'compact',
      content: await options.compact(trigger),
    });
  } catch (error) {
    options.appendMessage({
      role: 'error',
      content: `Compact failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}

async function maybeRefreshTodos(
  options: CreateAgentRunnerOptions,
  event: AgentRunEvent,
): Promise<void> {
  if (event.type !== 'tool_result' || event.name !== 'todo_write' || !event.result.ok) {
    return;
  }

  try {
    await options.refreshTodos?.();
  } catch (error) {
    options.appendMessage({
      role: 'error',
      content: `Todo 刷新失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function appendEventMessage(
  options: CreateAgentRunnerOptions,
  event: AgentRunEvent,
): void {
  if (event.type === 'step_start') {
    options.appendMessage({
      role: 'status',
      content: formatStepStatus(event),
    });
    return;
  }

  if (event.type === 'assistant_delta') {
    options.appendAssistantDelta(event.content);
    return;
  }

  if (event.type === 'assistant_tool_calls') {
    for (const toolCall of event.toolCalls) {
      options.appendMessage({
        role: 'tool_call',
        content: formatToolCall(toolCall),
      });
    }
    return;
  }

  if (event.type === 'tool_result') {
    const formatted = formatToolResult(event.name, event.result);
    options.appendMessage({ role: 'tool_result', ...formatted });
    return;
  }

  if (event.type === 'assistant_final') {
    options.finishAssistantMessage(event.content);
    return;
  }

  options.appendMessage({ role: 'error', content: event.error });
}
