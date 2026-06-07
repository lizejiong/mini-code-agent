import { render } from 'ink';
import { App } from './App.js';
import type { TuiMessage } from './types.js';

export type RenderTuiOptions = {
  sessionId: string;
  getMode(): string;
  runTask(
    task: string,
    appendMessage: (message: TuiMessage) => void,
  ): Promise<void>;
};

export function renderTui(options: RenderTuiOptions): void {
  render(
    <App
      sessionId={options.sessionId}
      getMode={options.getMode}
      runTask={options.runTask}
    />,
  );
}
