import { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { TuiMessage, TuiStatus, TuiTodoSummary } from './types.js';

export type AppProps = {
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

export function App(props: AppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<TuiStatus>('idle');
  const [messages, setMessages] = useState<TuiMessage[]>([]);
  const [todoSummary, setTodoSummary] = useState<TuiTodoSummary | undefined>();
  const appendMessage = (message: TuiMessage) => {
    setMessages((current) => [...current, message]);
  };
  const appendAssistantDelta = (delta: string) => {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        const next = [...current];
        next[next.length - 1] = { ...last, content: last.content + delta };
        return next;
      }

      return [...current, { role: 'assistant', content: delta, streaming: true }];
    });
  };
  const finishAssistantMessage = (content: string) => {
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role !== 'assistant' || !last.streaming) {
        return [...current, { role: 'assistant', content }];
      }

      const next = [...current];
      next[next.length - 1] = {
        role: 'assistant',
        content: last.content || content,
        streaming: false,
      };
      return next;
    });
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
        .runTask(
          task,
          appendMessage,
          appendAssistantDelta,
          finishAssistantMessage,
          refreshTodos,
        )
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
          <Box key={index} flexDirection="column" marginBottom={1}>
            {renderMessage(message)}
          </Box>
        ))}
      </Box>
      <Text>{status === 'running' ? 'agent is running...' : `> ${input}`}</Text>
      <Text dimColor>Ctrl+C 退出</Text>
    </Box>
  );
}

function renderMessage(message: TuiMessage) {
  if (message.role === 'user') {
    return (
      <>
        <Text color="cyan">You</Text>
        <Text>  {message.content}</Text>
      </>
    );
  }

  if (message.role === 'assistant') {
    return (
      <>
        <Text color="white">Assistant{message.streaming ? ' ...' : ''}</Text>
        <Text>  {message.content}</Text>
      </>
    );
  }

  if (message.role === 'tool_call') {
    return <Text color="yellow">Tool  {message.content}</Text>;
  }

  if (message.role === 'tool_result') {
    return (
      <Text color={message.ok ? 'green' : 'red'}>
        Result  {message.content}
      </Text>
    );
  }

  if (message.role === 'compact') {
    return <Text color="magenta">Compact  {message.content}</Text>;
  }

  if (message.role === 'status') {
    return <Text dimColor>Status  {message.content}</Text>;
  }

  return <Text color="red">Error  {message.content}</Text>;
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
