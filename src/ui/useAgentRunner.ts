import type { AgentRunEvent, RunAgentOptions } from '../agent/loop.js';
import type { TuiMessage, TuiStatus } from './types.js';

export type AgentRunnerRun = (
  options: Pick<RunAgentOptions, 'task' | 'onEvent'>,
) => Promise<string>;

export type CreateAgentRunnerOptions = {
  appendMessage(message: TuiMessage): void;
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
      options.appendMessage({ role: 'user', content: task });

      try {
        await options.runAgent({
          task,
          onEvent: (event) => appendEventMessage(options.appendMessage, event),
        });
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

function appendEventMessage(
  appendMessage: (message: TuiMessage) => void,
  event: AgentRunEvent,
): void {
  if (event.type === 'step_start') {
    appendMessage({
      role: 'status',
      content: `Step ${event.step}/${event.maxSteps} mode=${event.mode}`,
    });
    return;
  }

  if (event.type === 'assistant_tool_calls') {
    for (const toolCall of event.toolCalls) {
      appendMessage({
        role: 'tool',
        content: `${toolCall.name} ${JSON.stringify(toolCall.input)}`,
      });
    }
    return;
  }

  if (event.type === 'tool_result') {
    appendMessage({
      role: 'tool',
      content: `${event.name} ${event.result.ok ? 'ok' : 'failed'}`,
    });
    return;
  }

  if (event.type === 'assistant_final') {
    appendMessage({ role: 'assistant', content: event.content });
    return;
  }

  appendMessage({ role: 'error', content: event.error });
}
