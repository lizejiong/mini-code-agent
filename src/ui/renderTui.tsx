import { render } from 'ink';
import { App } from './App.js';
import type { TuiMessage, TuiTodoSummary } from './types.js';

export type RenderTuiOptions = {
  sessionId: string;
  getMode(): string;
  runTask(
    task: string,
    appendMessage: (message: TuiMessage) => void,
    appendAssistantDelta: (delta: string) => void,
    finishAssistantMessage: (content: string) => void,
    refreshTodos: () => Promise<void>,
  ): Promise<void>;
  loadTodoSummary(): Promise<TuiTodoSummary>;
};

export function renderTui(options: RenderTuiOptions): void {
  render(
    <App
      sessionId={options.sessionId}
      getMode={options.getMode}
      runTask={options.runTask}
      loadTodoSummary={options.loadTodoSummary}
    />,
  );
}
