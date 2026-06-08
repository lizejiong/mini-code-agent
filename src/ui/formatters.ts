import type { AgentMode } from '../modes/types.js';
import type { ChatToolCall } from '../providers/types.js';
import type { ToolResult } from '../tools/types.js';

export function formatStepStatus(event: {
  step: number;
  maxSteps: number;
  mode: AgentMode;
}): string {
  return `Step ${event.step}/${event.maxSteps} · mode ${event.mode}`;
}

export function formatToolCall(toolCall: ChatToolCall): string {
  const input = asRecord(toolCall.input);

  if (toolCall.name === 'read_file' && typeof input.path === 'string') {
    return `${toolCall.name} ${input.path}`;
  }

  if (toolCall.name === 'search_files' && typeof input.query === 'string') {
    return `${toolCall.name} "${input.query}"`;
  }

  if (toolCall.name === 'run_command' && typeof input.command === 'string') {
    return `${toolCall.name} ${input.command}`;
  }

  if (toolCall.name === 'todo_write' && Array.isArray(input.todos)) {
    return `${toolCall.name} ${input.todos.length} todos`;
  }

  return `${toolCall.name} ${JSON.stringify(toolCall.input)}`;
}

export function formatToolResult(
  name: string,
  result: ToolResult,
): { ok: boolean; content: string } {
  if (!result.ok) {
    return { ok: false, content: `${name} failed ${result.error}` };
  }

  return {
    ok: true,
    content: `${name} ok ${summarizeContent(result.content)}`,
  };
}

function summarizeContent(content: string): string {
  if (content.length === 0) {
    return '0 chars';
  }

  return `${content.length} chars`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}
