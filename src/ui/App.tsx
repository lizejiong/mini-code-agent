import { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { TuiMessage, TuiStatus, TuiTodoSummary } from './types.js';

export type AppProps = {
  sessionId: string;
  getMode(): string;
  runTask(
    task: string,
    appendMessage: (message: TuiMessage) => void,
    refreshTodos: () => Promise<void>,
  ): Promise<void>;
  loadTodoSummary(): Promise<TuiTodoSummary>;
};

export function App(props: AppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<TuiStatus>('idle');
  const [messages, setMessages] = useState<TuiMessage[]>([]);
  const [todoSummary, setTodoSummary] = useState<TuiTodoSummary | undefined>();
  const appendMessage = (message: TuiMessage) => {
    setMessages((current) => [...current, message]);
  };
  const refreshTodos = async () => {
    setTodoSummary(await props.loadTodoSummary());
  };

  useEffect(() => {
    void refreshTodos();
  }, []);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      exit();
      return;
    }

    if (key.return) {
      const task = input.trim();
      if (!task || status === 'running') {
        return;
      }

      setInput('');
      setStatus('running');
      props
        .runTask(task, appendMessage, refreshTodos)
        .catch((error: unknown) => {
          appendMessage({
            role: 'error',
            content: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => setStatus('idle'));
      return;
    }

    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }

    if (inputChar) {
      setInput((current) => current + inputChar);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Mini Code Agent</Text>
      <Text>
        Session: {props.sessionId} Mode: {props.getMode()} Status: {status}
      </Text>
      <Text>{formatTodoSummary(todoSummary)}</Text>
      <Box flexDirection="column" marginY={1}>
        {messages.map((message, index) => (
          <Text key={index}>
            [{message.role}] {message.content}
          </Text>
        ))}
      </Box>
      <Text>{status === 'running' ? 'agent is running...' : `> ${input}`}</Text>
      <Text dimColor>Ctrl+C 退出</Text>
    </Box>
  );
}

function formatTodoSummary(summary: TuiTodoSummary | undefined): string {
  if (!summary) {
    return 'Todos: loading';
  }

  if (!summary.available) {
    return `Todos: unavailable (${summary.error})`;
  }

  const current = summary.current ? ` Current: ${summary.current}` : '';
  return `Todos: ${summary.inProgress} in_progress / ${summary.pending} pending / ${summary.completed} completed${current}`;
}
