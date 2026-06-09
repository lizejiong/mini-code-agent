import { describe, expect, test } from 'vitest';
import {
  COMPACT_BOUNDARY_MESSAGE,
  compactConversation,
} from '../src/compact/service.js';
import type { ChatMessage, ChatProvider } from '../src/providers/types.js';

describe('compact service', () => {
  test('summarizes messages and builds the compacted context', async () => {
    const requests: unknown[] = [];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return {
          content: '<analysis>草稿</analysis><summary>压缩摘要</summary>',
          toolCalls: [],
        };
      },
    };
    const messages: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'latest' },
    ];

    const result = await compactConversation({
      messages,
      provider,
      trigger: 'manual',
      keepRecentMessages: 2,
      minMessages: 3,
    });

    expect(requests).toHaveLength(1);
    expect(result.summary).toBe('压缩摘要');
    expect(result.previousMessageCount).toBe(4);
    expect(result.keptMessages).toEqual([
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'latest' },
    ]);
    expect(result.nextMessages).toEqual([
      { role: 'system', content: COMPACT_BOUNDARY_MESSAGE },
      {
        role: 'user',
        content:
          'This session is being continued from a compacted conversation.\n\nSummary:\n压缩摘要\n\nRecent messages are preserved verbatim after this summary.',
      },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'latest' },
    ]);
  });

  test('normalizes kept messages so they start with a user message', async () => {
    const provider = fakeSummaryProvider('摘要');
    const result = await compactConversation({
      messages: [
        { role: 'user', content: 'old' },
        { role: 'assistant', content: 'assistant-only' },
        { role: 'user', content: 'recent user' },
      ],
      provider,
      trigger: 'auto',
      keepRecentMessages: 2,
      minMessages: 3,
    });

    expect(result.keptMessages).toEqual([{ role: 'user', content: 'recent user' }]);
  });

  test('drops orphan tool messages from kept messages', async () => {
    const provider = fakeSummaryProvider('摘要');
    const result = await compactConversation({
      messages: [
        { role: 'user', content: 'old' },
        { role: 'user', content: 'recent' },
        { role: 'tool', toolCallId: 'missing', content: 'orphan' },
      ],
      provider,
      trigger: 'manual',
      keepRecentMessages: 2,
      minMessages: 3,
    });

    expect(result.keptMessages).toEqual([{ role: 'user', content: 'recent' }]);
  });

  test('fails when summary is empty', async () => {
    await expect(
      compactConversation({
        messages: [
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'two' },
          { role: 'user', content: 'three' },
        ],
        provider: fakeSummaryProvider(''),
        trigger: 'manual',
        minMessages: 3,
      }),
    ).rejects.toThrow('Compact summary is empty');
  });

  test('fails when there are too few messages', async () => {
    await expect(
      compactConversation({
        messages: [{ role: 'user', content: 'one' }],
        provider: fakeSummaryProvider('摘要'),
        trigger: 'manual',
      }),
    ).rejects.toThrow('Not enough messages to compact');
  });
});

function fakeSummaryProvider(content: string): ChatProvider {
  return {
    complete: async () => ({ content, toolCalls: [] }),
  };
}
