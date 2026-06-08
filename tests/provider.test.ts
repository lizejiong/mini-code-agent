import { describe, expect, test } from 'vitest';
import { createOpenAICompatibleProvider } from '../src/providers/openaiCompatible.js';
import type { ChatMessage, ChatToolSchema } from '../src/providers/types.js';

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

describe('createOpenAICompatibleProvider', () => {
  test('posts chat completions to the normalized base URL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = createOpenAICompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1/',
      model: 'model-a',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return jsonResponse({
          choices: [{ message: { role: 'assistant', content: 'hello' } }],
        }) as Response;
      },
    });

    const response = await provider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [],
    });

    expect(response).toEqual({ content: 'hello', toolCalls: [] });
    expect(calls[0].url).toBe('https://example.com/v1/chat/completions');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      model: 'model-a',
      messages: [{ role: 'user', content: 'Hi' }],
      tools: [],
    });
  });

  test('maps internal tool schemas to OpenAI-compatible function tools', async () => {
    let requestBody: unknown;
    const tool: ChatToolSchema = {
      name: 'read_file',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    };
    const provider = createOpenAICompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'model-a',
      fetch: async (_url, init) => {
        requestBody = JSON.parse(String(init!.body));
        return jsonResponse({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
        }) as Response;
      },
    });

    await provider.complete({ messages: [], tools: [tool] });

    expect(requestBody).toMatchObject({
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file',
            parameters: tool.parameters,
          },
        },
      ],
    });
  });

  test('maps OpenAI-compatible tool calls to internal tool calls', async () => {
    const provider = createOpenAICompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'model-a',
      fetch: async () =>
        jsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path":"README.md"}',
                    },
                  },
                ],
              },
            },
          ],
        }) as Response,
    });

    const response = await provider.complete({ messages: [], tools: [] });

    expect(response).toEqual({
      content: '',
      toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'README.md' } }],
    });
  });

  test('maps assistant and tool messages to OpenAI-compatible messages', async () => {
    let requestBody: unknown;
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      { role: 'tool', toolCallId: 'call-1', content: 'content' },
    ];
    const provider = createOpenAICompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'model-a',
      fetch: async (_url, init) => {
        requestBody = JSON.parse(String(init!.body));
        return jsonResponse({
          choices: [{ message: { role: 'assistant', content: 'done' } }],
        }) as Response;
      },
    });

    await provider.complete({ messages, tools: [] });

    expect(requestBody).toMatchObject({
      messages: [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: '{"path":"a.ts"}',
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: 'content' },
      ],
    });
  });

  test('streams content deltas from OpenAI-compatible SSE responses', async () => {
    let requestBody: unknown;
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const provider = createOpenAICompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'model-a',
      fetch: async (_url, init) => {
        requestBody = JSON.parse(String(init!.body));
        return {
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({}),
          body: new ReadableStream({
            start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
              }
              controller.close();
            },
          }),
        } as Response;
      },
    });
    const deltas: string[] = [];

    const response = await provider.stream!(
      { messages: [{ role: 'user', content: 'Hi' }], tools: [] },
      (chunk) => {
        if (chunk.type === 'content_delta') {
          deltas.push(chunk.content);
        }
      },
    );

    expect(requestBody).toMatchObject({ stream: true });
    expect(deltas).toEqual(['你', '好']);
    expect(response).toEqual({ content: '你好', toolCalls: [] });
  });

  test('aggregates streamed tool call deltas', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"src/a.ts\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const provider = createOpenAICompatibleProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'model-a',
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          text: async () => '',
          json: async () => ({}),
          body: new ReadableStream({
            start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
              }
              controller.close();
            },
          }),
        }) as Response,
    });

    const response = await provider.stream!({ messages: [], tools: [] }, () => {});

    expect(response).toEqual({
      content: '',
      toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'src/a.ts' } }],
    });
  });
});
