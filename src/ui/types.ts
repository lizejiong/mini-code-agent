export type TuiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; content: string }
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
