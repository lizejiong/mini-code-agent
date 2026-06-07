import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  getProjectSessionsDir,
  getSessionFilePath,
  getSessionsHome,
} from '../src/sessions/paths.js';

describe('session paths', () => {
  test('stores sessions under the mini-code-agent user directory', () => {
    const home = join(tmpdir(), 'mini-agent-home-test');

    expect(getSessionsHome(home)).toBe(join(home, '.mini-code-agent'));
  });

  test('builds a readable and collision-resistant project directory', () => {
    const home = join(tmpdir(), 'mini-agent-home-test');
    const cwd = join('D:\\code\\coding', 'mini-code-agent');
    const projectDir = getProjectSessionsDir(cwd, home);

    expect(projectDir).toContain(join(home, '.mini-code-agent', 'projects'));
    expect(projectDir).toMatch(/mini-code-agent-[a-f0-9]{10}$/);
    expect(
      getSessionFilePath(cwd, '550e8400-e29b-41d4-a716-446655440000', home),
    ).toBe(join(projectDir, '550e8400-e29b-41d4-a716-446655440000.jsonl'));
  });
});
