import { describe, expect, test } from 'vitest';
import { parseCliArgs } from '../src/cliArgs.js';

describe('parseCliArgs', () => {
  test('parses empty args as TUI mode', () => {
    expect(parseCliArgs([])).toEqual({
      help: false,
      deprecatedScriptArgs: false,
    });
  });

  test('detects deprecated script task arguments', () => {
    expect(parseCliArgs(['--', 'read', 'README.md'])).toEqual({
      help: false,
      deprecatedScriptArgs: true,
    });
  });

  test('detects deprecated script flags', () => {
    expect(parseCliArgs(['--plan'])).toEqual({
      help: false,
      deprecatedScriptArgs: true,
    });

    expect(parseCliArgs(['--continue'])).toEqual({
      help: false,
      deprecatedScriptArgs: true,
    });

    expect(parseCliArgs(['--resume', 'abc-123'])).toEqual({
      help: false,
      deprecatedScriptArgs: true,
    });

    expect(parseCliArgs(['--no-session-persistence'])).toEqual({
      help: false,
      deprecatedScriptArgs: true,
    });
  });

  test('detects help without marking script args deprecated', () => {
    expect(parseCliArgs(['--', '--help'])).toEqual({
      help: true,
      deprecatedScriptArgs: false,
    });
  });
});
