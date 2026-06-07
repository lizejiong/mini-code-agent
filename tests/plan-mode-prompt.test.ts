import { describe, expect, test } from 'vitest';
import { createModeSystemPrompt } from '../src/prompts/planMode.js';

describe('createModeSystemPrompt', () => {
  test('plan mode prompt directs the model to write the plan and request approval promptly', () => {
    const prompt = createModeSystemPrompt('plan', 'C:\\Users\\lzj\\.mini-code-agent\\plans\\session.md');

    expect(prompt).toContain('write_plan');
    expect(prompt).toContain('ExitPlanMode');
    expect(prompt).toContain('Do not explore exhaustively');
    expect(prompt).toContain('current turn');
  });
});
