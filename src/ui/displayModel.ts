import type { TuiMessage, TuiStatus, TuiTodoSummary } from './types.js';

export type TuiViewModel = {
  header: {
    title: string;
    session: string;
    meta: string[];
  };
  rows: TuiViewRow[];
  prompt: {
    marker: string;
    text: string;
    hint: string;
  };
};

export type TuiViewRow =
  | { type: 'message'; label: string; text: string }
  | { type: 'status'; text: string }
  | {
      type: 'tool';
      tone: TuiViewTone;
      label: string;
      target: string;
      result?: string;
    };

export type TuiViewTone = 'normal' | 'working' | 'success' | 'error' | 'compact';

export type CreateTuiViewModelInput = {
  sessionId: string;
  mode: string;
  status: TuiStatus;
  todoSummary: TuiTodoSummary | undefined;
  input: string;
  messages: TuiMessage[];
};

export function createTuiViewModel(input: CreateTuiViewModelInput): TuiViewModel {
  return {
    header: {
      title: 'Mini Code Agent',
      session: `${shortSession(input.sessionId)} · ${input.mode}`,
      meta: [`status ${input.status}`, ...formatTodoMeta(input.todoSummary)],
    },
    rows: createRows(input.messages),
    prompt: {
      marker: '›',
      text: input.status === 'running' ? 'Agent 运行中...' : input.input,
      hint: 'Enter 发送 · Ctrl+C 退出',
    },
  };
}

function createRows(messages: TuiMessage[]): TuiViewRow[] {
  const rows: TuiViewRow[] = [];

  for (const message of messages) {
    if (message.role === 'user') {
      rows.push({ type: 'message', label: 'You', text: message.content });
      continue;
    }

    if (message.role === 'assistant') {
      rows.push({
        type: 'message',
        label: `Assistant${message.streaming ? ' ...' : ''}`,
        text: message.content,
      });
      continue;
    }

    if (message.role === 'status') {
      rows.push({ type: 'status', text: message.content });
      continue;
    }

    if (message.role === 'tool_call') {
      const tool = parseToolCall(message.content);
      rows.push({
        type: 'tool',
        tone: 'working',
        label: tool.label,
        target: tool.target,
      });
      continue;
    }

    if (message.role === 'tool_result') {
      attachToolResult(rows, message);
      continue;
    }

    if (message.role === 'compact') {
      rows.push({
        type: 'tool',
        tone: 'compact',
        label: 'compact',
        target: message.content,
      });
      continue;
    }

    rows.push({
      type: 'tool',
      tone: 'error',
      label: 'error',
      target: message.content,
    });
  }

  return rows;
}

function attachToolResult(
  rows: TuiViewRow[],
  message: Extract<TuiMessage, { role: 'tool_result' }>,
): void {
  const last = rows[rows.length - 1];
  const result = formatToolResultForView(message);

  /**
   * 工具结果跟随最近的工具调用展示，读起来像 Claude Code 的一组动作。
   * 如果因为历史压缩或异常顺序找不到工具调用，就退化成单独的结果行。
   */
  if (last?.type === 'tool' && !last.result) {
    last.tone = message.ok ? 'success' : 'error';
    last.result = `⎿ ${result}`;
    return;
  }

  rows.push({
    type: 'tool',
    tone: message.ok ? 'success' : 'error',
    label: 'result',
    target: result,
  });
}

function formatTodoMeta(summary: TuiTodoSummary | undefined): string[] {
  if (!summary) {
    return ['todos loading'];
  }

  if (!summary.available) {
    return ['todos unavailable'];
  }

  const meta = [
    `todos ${summary.inProgress}/${summary.pending}/${summary.completed}`,
  ];
  if (summary.current) {
    meta.push(`current ${summary.current}`);
  }

  return meta;
}

function parseToolCall(content: string): { label: string; target: string } {
  const [name = 'tool', ...targetParts] = content.split(' ');
  return {
    label: formatToolLabel(name),
    target: targetParts.join(' ') || name,
  };
}

function formatToolLabel(name: string): string {
  const labels: Record<string, string> = {
    read_file: 'read',
    list_dir: 'list',
    search_files: 'search',
    glob_files: 'glob',
    grep_files: 'grep',
    write_file: 'write',
    edit_file: 'edit',
    run_command: 'shell',
    todo_read: 'todo',
    todo_write: 'todo',
    EnterPlanMode: 'mode',
  };

  return labels[name] ?? name;
}

function formatToolResultForView(
  message: Extract<TuiMessage, { role: 'tool_result' }>,
): string {
  if (!message.ok) {
    return summarizeError(message.content);
  }

  const okMatch = message.content.match(/^\S+\s+ok\s+(.+)$/);
  if (!okMatch) {
    return `ok · ${message.content}`;
  }

  return `ok · ${okMatch[1]}`;
}

function summarizeError(content: string): string {
  if (content.includes('EISDIR')) {
    return '这是目录，请使用 list_dir 查看内容';
  }

  if (content.includes('ENOENT')) {
    return '文件不存在或路径不正确';
  }

  if (content.includes('EACCES') || content.includes('EPERM')) {
    return '权限不足，无法完成操作';
  }

  return content.replace(/^\S+\s+failed\s+/, '失败 · ');
}

function shortSession(sessionId: string): string {
  return sessionId.slice(0, 8);
}
