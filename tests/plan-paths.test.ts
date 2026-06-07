import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { getPlanFilePath, getPlansDir } from '../src/plans/paths.js';

describe('plan paths', () => {
  test('stores plan files under the mini-code-agent user plans directory', () => {
    const home = join(tmpdir(), 'mini-agent-plan-home');
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';

    expect(getPlansDir(home)).toBe(join(home, '.mini-code-agent', 'plans'));
    expect(getPlanFilePath(sessionId, home)).toBe(
      join(home, '.mini-code-agent', 'plans', `${sessionId}.md`),
    );
  });
});
