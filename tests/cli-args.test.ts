import { describe, expect, test } from 'vitest';
import { parseCliArgs } from '../src/cliArgs.js';

describe('parseCliArgs', () => {
  test('drops pnpm argument separator before building the task', () => {
    expect(parseCliArgs(['--', 'read', 'README.md'])).toEqual({
      help: false,
      task: 'read README.md',
      continueLatest: false,
      resumeSessionId: undefined,
      sessionPersistence: true,
      forcePlanMode: false,
    });
  });

  test('detects help without requiring a task', () => {
    expect(parseCliArgs(['--', '--help'])).toEqual({
      help: true,
      task: '',
      continueLatest: false,
      resumeSessionId: undefined,
      sessionPersistence: true,
      forcePlanMode: false,
    });
  });

  test('parses session resume flags while preserving the task text', () => {
    expect(parseCliArgs(['--continue', 'next', 'step'])).toEqual({
      help: false,
      task: 'next step',
      continueLatest: true,
      resumeSessionId: undefined,
      sessionPersistence: true,
      forcePlanMode: false,
    });

    expect(parseCliArgs(['--resume', 'abc-123', 'fix', 'tests'])).toEqual({
      help: false,
      task: 'fix tests',
      continueLatest: false,
      resumeSessionId: 'abc-123',
      sessionPersistence: true,
      forcePlanMode: false,
    });

    expect(parseCliArgs(['--no-session-persistence', 'one-off'])).toEqual({
      help: false,
      task: 'one-off',
      continueLatest: false,
      resumeSessionId: undefined,
      sessionPersistence: false,
      forcePlanMode: false,
    });
  });

  test('parses --plan as force plan mode without including it in the task', () => {
    expect(parseCliArgs(['--plan', 'implement', 'auth'])).toEqual({
      help: false,
      task: 'implement auth',
      continueLatest: false,
      resumeSessionId: undefined,
      sessionPersistence: true,
      forcePlanMode: true,
    });
  });
});
