import { describe, expect, test } from 'vitest';
import {
  estimateRoughTokens,
  shouldAutoCompact,
} from '../src/compact/roughTokens.js';
import type { ChatMessage } from '../src/providers/types.js';

describe('compact rough tokens', () => {
  test('estimates rough tokens from message content', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '12345678' },
      { role: 'assistant', content: '1234' },
      { role: 'tool', toolCallId: 'tool-1', content: '1234' },
    ];

    expect(estimateRoughTokens(messages)).toBe(4);
  });

  test('triggers auto compact by rough token threshold', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(80) },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'again' },
    ];

    expect(
      shouldAutoCompact(messages, {
        roughTokenThreshold: 10,
        messageThreshold: 100,
        minMessages: 3,
      }),
    ).toBe(true);
  });

  test('triggers auto compact by message threshold', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '1' },
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
    ];

    expect(
      shouldAutoCompact(messages, {
        roughTokenThreshold: 1000,
        messageThreshold: 3,
        minMessages: 3,
      }),
    ).toBe(true);
  });

  test('does not trigger when there are too few messages', () => {
    expect(
      shouldAutoCompact([{ role: 'user', content: 'x'.repeat(100) }], {
        roughTokenThreshold: 1,
        messageThreshold: 1,
        minMessages: 3,
      }),
    ).toBe(false);
  });
});
