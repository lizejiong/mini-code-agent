export type TuiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; streaming?: boolean }
  | { role: 'tool_call'; content: string }
  | { role: 'tool_result'; content: string; ok: boolean }
  | { role: 'compact'; content: string }
  | { role: 'status'; content: string }
  | { role: 'error'; content: string };

export type TuiStatus = 'idle' | 'running';

export type TuiTodoSummary =
  | {
      available: true;
      pending: number;
      inProgress: number;
      completed: number;
      current: string | undefined;
    }
  | {
      available: false;
      error: string;
    };
