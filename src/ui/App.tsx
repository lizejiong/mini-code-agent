import { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import {
  createTuiViewModel,
  type TuiViewRow,
  type TuiViewTone,
} from './displayModel.js';
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

  const view = createTuiViewModel({
    sessionId: props.sessionId,
    mode: props.getMode(),
    status,
    todoSummary,
    input,
    messages,
  });

  return (
    <Box flexDirection="column">
      <Header title={view.header.title} session={view.header.session} meta={view.header.meta} />
      <Box flexDirection="column" marginY={1}>
        {view.rows.map((row, index) => (
          <Box key={index} flexDirection="column" marginBottom={1}>
            <TuiRow row={row} />
          </Box>
        ))}
      </Box>
      <Box flexDirection="row">
        <Text color="cyan">{view.prompt.marker} </Text>
        <Text>{view.prompt.text}</Text>
        <Text dimColor>  {view.prompt.hint}</Text>
      </Box>
    </Box>
  );
}

function Header(props: { title: string; session: string; meta: string[] }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexDirection="row">
        <Text color="cyan">● </Text>
        <Text bold>{props.title}</Text>
        <Text dimColor>  {props.session}</Text>
      </Box>
      <Box flexDirection="row">
        {props.meta.map((item, index) => (
          <Text key={item} dimColor>
            {index > 0 ? '  ·  ' : ''}
            {item}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function TuiRow(props: { row: TuiViewRow }) {
  const { row } = props;

  if (row.type === 'message') {
    return (
      <>
        <Text color={row.label.startsWith('Assistant') ? 'blue' : 'cyan'}>{row.label}</Text>
        <Box marginLeft={2}>
          <Text>{row.text}</Text>
        </Box>
      </>
    );
  }

  if (row.type === 'status') {
    return <Text dimColor>{row.text}</Text>;
  }

  return (
    <>
      <Box flexDirection="row">
        <Text color={toneColor(row.tone)}>● </Text>
        <Text dimColor>{row.label} </Text>
        <Text>{row.target}</Text>
      </Box>
      {row.result ? (
        <Box marginLeft={2}>
          <Text color={row.tone === 'error' ? 'red' : undefined} dimColor={row.tone !== 'error'}>
            {row.result}
          </Text>
        </Box>
      ) : null}
    </>
  );
}

function toneColor(tone: TuiViewTone): string | undefined {
  if (tone === 'working') {
    return 'yellow';
  }

  if (tone === 'success') {
    return 'green';
  }

  if (tone === 'error') {
    return 'red';
  }

  if (tone === 'compact') {
    return 'magenta';
  }

  return undefined;
}
