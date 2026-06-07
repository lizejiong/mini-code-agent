import { describe, expect, test } from 'vitest';
import { parseCliArgs } from '../src/cliArgs.js';

describe('parseCliArgs', () => {
  test('drops pnpm argument separator before building the task', () => {
    expect(parseCliArgs(['--', 'read', 'README.md'])).toEqual({
      help: false,
      task: 'read README.md',
    });
  });

  test('detects help without requiring a task', () => {
    expect(parseCliArgs(['--', '--help'])).toEqual({
      help: true,
      task: '',
    });
  });
});
