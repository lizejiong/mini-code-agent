import { describe, expect, test } from 'vitest';
import {
  createCompactSummaryMessage,
  createCompactSummaryPrompt,
  formatCompactSummary,
} from '../src/compact/prompt.js';

describe('compact prompt', () => {
  test('creates a no-tools Chinese summary prompt', () => {
    const prompt = createCompactSummaryPrompt();

    expect(prompt).toContain('不要调用任何工具');
    expect(prompt).toContain('<analysis>');
    expect(prompt).toContain('<summary>');
    expect(prompt).toContain('用户主要请求和意图');
  });

  test('removes analysis and extracts summary content', () => {
    const formatted = formatCompactSummary(
      '<analysis>草稿</analysis>\n<summary>\n最终摘要\n</summary>',
    );

    expect(formatted).toBe('最终摘要');
  });

  test('keeps plain text when summary tags are absent', () => {
    expect(formatCompactSummary('普通摘要')).toBe('普通摘要');
  });

  test('wraps formatted summary as a continuation user message', () => {
    const message = createCompactSummaryMessage('摘要内容', true);

    expect(message).toContain('This session is being continued');
    expect(message).toContain('Summary:');
    expect(message).toContain('摘要内容');
    expect(message).toContain('Recent messages are preserved verbatim');
  });
});
