import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { getSessionFilePath } from '../src/sessions/paths.js';
import { resolveSessionStart } from '../src/sessions/resume.js';
import { appendTranscriptEntry } from '../src/sessions/transcript.js';

describe('resolveSessionStart', () => {
  test('creates a new persistent session by default', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-session-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'mini-agent-project-'));

    const result = await resolveSessionStart({
      cwd,
      sessionsHome: home,
      continueLatest: false,
      resumeSessionId: undefined,
      sessionPersistence: true,
    });

    expect(result.mode).toBe('new');
    expect(result.persistenceEnabled).toBe(true);
    expect(result.transcriptPath).toBe(getSessionFilePath(cwd, result.sessionId, home));
    expect(result.entries).toEqual([]);
    expect(result.initialMessages).toEqual([]);
  });

  test('creates an in-memory session when persistence is disabled', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-session-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'mini-agent-project-'));

    const result = await resolveSessionStart({
      cwd,
      sessionsHome: home,
      continueLatest: false,
      resumeSessionId: undefined,
      sessionPersistence: false,
    });

    expect(result.mode).toBe('disabled');
    expect(result.persistenceEnabled).toBe(false);
    expect(result.transcriptPath).toBeUndefined();
    expect(result.entries).toEqual([]);
    expect(result.initialMessages).toEqual([]);
  });

  test('continues the newest session for the current project', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-session-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'mini-agent-project-'));
    const olderId = '550e8400-e29b-41d4-a716-446655440000';
    const newerId = '550e8400-e29b-41d4-a716-446655440001';
    await appendTranscriptEntry(getSessionFilePath(cwd, olderId, home), {
      type: 'user',
      sessionId: olderId,
      timestamp: '2026-06-07T00:00:00.000Z',
      content: 'old',
    });
    await appendTranscriptEntry(getSessionFilePath(cwd, newerId, home), {
      type: 'user',
      sessionId: newerId,
      timestamp: '2026-06-07T00:01:00.000Z',
      content: 'new',
    });

    const result = await resolveSessionStart({
      cwd,
      sessionsHome: home,
      continueLatest: true,
      resumeSessionId: undefined,
      sessionPersistence: true,
    });

    expect(result.mode).toBe('continue');
    expect(result.sessionId).toBe(newerId);
    expect(result.initialMessages).toEqual([{ role: 'user', content: 'new' }]);
  });

  test('resumes a specific session id for the current project', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-session-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'mini-agent-project-'));
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    await appendTranscriptEntry(getSessionFilePath(cwd, sessionId, home), {
      type: 'user',
      sessionId,
      timestamp: '2026-06-07T00:00:00.000Z',
      content: 'restore me',
    });

    const result = await resolveSessionStart({
      cwd,
      sessionsHome: home,
      continueLatest: false,
      resumeSessionId: sessionId,
      sessionPersistence: true,
    });

    expect(result.mode).toBe('resume');
    expect(result.sessionId).toBe(sessionId);
    expect(result.initialMessages).toEqual([{ role: 'user', content: 'restore me' }]);
  });

  test('reports missing sessions clearly', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-session-home-'));
    const cwd = mkdtempSync(join(tmpdir(), 'mini-agent-project-'));

    await expect(
      resolveSessionStart({
        cwd,
        sessionsHome: home,
        continueLatest: true,
        resumeSessionId: undefined,
        sessionPersistence: true,
      }),
    ).rejects.toThrow('No session found to continue for this workspace');

    await expect(
      resolveSessionStart({
        cwd,
        sessionsHome: home,
        continueLatest: false,
        resumeSessionId: '550e8400-e29b-41d4-a716-446655440000',
        sessionPersistence: true,
      }),
    ).rejects.toThrow(
      'No session found with session ID: 550e8400-e29b-41d4-a716-446655440000',
    );
  });
});
