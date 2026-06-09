import { closeSync, mkdtempSync, openSync, utimesSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  appendTranscriptEntry,
  listSessionFilesNewestFirst,
  readTranscriptEntries,
  transcriptEntriesToMessages,
  type TranscriptEntry,
} from '../src/sessions/transcript.js';

describe('session transcript', () => {
  test('appends and reads jsonl entries in order', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-transcript-'));
    const filePath = join(root, 'session.jsonl');
    const entries: TranscriptEntry[] = [
      {
        type: 'user',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:00.000Z',
        content: 'hello',
      },
      {
        type: 'assistant',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:01.000Z',
        content: 'hi',
        toolCalls: [],
      },
    ];

    await appendTranscriptEntry(filePath, entries[0]);
    await appendTranscriptEntry(filePath, entries[1]);

    await expect(readTranscriptEntries(filePath)).resolves.toEqual(entries);
  });

  test('skips blank lines while reading transcript entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-transcript-'));
    const filePath = join(root, 'session.jsonl');
    await writeFile(
      filePath,
      '\n{"type":"user","sessionId":"550e8400-e29b-41d4-a716-446655440000","timestamp":"2026-06-07T00:00:00.000Z","content":"hello"}\n\n',
      'utf8',
    );

    await expect(readTranscriptEntries(filePath)).resolves.toHaveLength(1);
  });

  test('reports the line number for invalid jsonl', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-transcript-'));
    const filePath = join(root, 'session.jsonl');
    await writeFile(filePath, '{"type":"user"}\nnot-json\n', 'utf8');

    await expect(readTranscriptEntries(filePath)).rejects.toThrow(
      'Invalid transcript JSON at line 2',
    );
  });

  test('converts transcript entries back to chat messages', () => {
    const entries: TranscriptEntry[] = [
      {
        type: 'user',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:00.000Z',
        content: 'read file',
      },
      {
        type: 'assistant',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:01.000Z',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      {
        type: 'tool',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:02.000Z',
        toolCallId: 'call-1',
        name: 'read_file',
        result: { ok: true, content: 'file content' },
      },
    ];

    expect(transcriptEntriesToMessages(entries)).toEqual([
      { role: 'user', content: 'read file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      {
        role: 'tool',
        toolCallId: 'call-1',
        content: '{"ok":true,"content":"file content"}',
      },
    ]);
  });

  test('keeps mode entries in transcript but excludes them from chat messages', () => {
    const entries: TranscriptEntry[] = [
      {
        type: 'mode',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:00.000Z',
        mode: 'plan',
        reason: 'enter_plan',
        planFilePath:
          'C:\\Users\\lzj\\.mini-code-agent\\plans\\550e8400-e29b-41d4-a716-446655440000.md',
      },
      {
        type: 'user',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:01.000Z',
        content: 'continue',
      },
    ];

    expect(transcriptEntriesToMessages(entries)).toEqual([
      { role: 'user', content: 'continue' },
    ]);
  });

  test('uses the latest compact entry as the restored chat history boundary', () => {
    const entries: TranscriptEntry[] = [
      {
        type: 'user',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:00.000Z',
        content: 'old request',
      },
      {
        type: 'compact',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:01.000Z',
        summary: '压缩摘要',
        trigger: 'manual',
        previousMessageCount: 4,
        keptMessageCount: 1,
        keptMessages: [{ role: 'user', content: 'recent request' }],
      },
      {
        type: 'assistant',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:02.000Z',
        content: 'after compact',
        toolCalls: [],
      },
    ];

    expect(transcriptEntriesToMessages(entries)).toEqual([
      {
        role: 'system',
        content:
          'Conversation compacted. Earlier messages are summarized below. Continue using the summary as authoritative context.',
      },
      {
        role: 'user',
        content:
          'This session is being continued from a compacted conversation.\n\nSummary:\n压缩摘要\n\nRecent messages are preserved verbatim after this summary.',
      },
      { role: 'user', content: 'recent request' },
      { role: 'assistant', content: 'after compact', toolCalls: [] },
    ]);
  });

  test('uses only the newest compact entry when multiple compactions exist', () => {
    const entries: TranscriptEntry[] = [
      {
        type: 'compact',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:00.000Z',
        summary: '旧摘要',
        trigger: 'manual',
        previousMessageCount: 10,
        keptMessageCount: 0,
        keptMessages: [],
      },
      {
        type: 'user',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:01.000Z',
        content: 'between',
      },
      {
        type: 'compact',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-06-07T00:00:02.000Z',
        summary: '新摘要',
        trigger: 'auto',
        previousMessageCount: 12,
        keptMessageCount: 0,
        keptMessages: [],
      },
    ];

    const messages = transcriptEntriesToMessages(entries);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({
      role: 'user',
      content:
        'This session is being continued from a compacted conversation.\n\nSummary:\n新摘要',
    });
  });

  test('lists jsonl session files from newest to oldest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-transcript-'));
    const older = join(root, 'older.jsonl');
    const newer = join(root, 'newer.jsonl');
    const ignored = join(root, 'ignored.txt');
    closeSync(openSync(older, 'w'));
    closeSync(openSync(newer, 'w'));
    closeSync(openSync(ignored, 'w'));
    utimesSync(older, new Date('2026-06-07T00:00:00.000Z'), new Date('2026-06-07T00:00:00.000Z'));
    utimesSync(newer, new Date('2026-06-07T00:01:00.000Z'), new Date('2026-06-07T00:01:00.000Z'));

    await expect(listSessionFilesNewestFirst(root)).resolves.toEqual([newer, older]);
  });
});
