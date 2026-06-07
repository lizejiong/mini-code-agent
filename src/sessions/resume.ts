import { basename } from 'node:path';
import { access } from 'node:fs/promises';
import type { AgentMode } from '../modes/types.js';
import type { ChatMessage } from '../providers/types.js';
import { createSessionId, isSessionId } from './ids.js';
import { getProjectSessionsDir, getSessionFilePath } from './paths.js';
import {
  listSessionFilesNewestFirst,
  readTranscriptEntries,
  transcriptEntriesToMessages,
  type TranscriptEntry,
} from './transcript.js';

export type ResolveSessionStartOptions = {
  cwd: string;
  sessionsHome?: string;
  continueLatest: boolean;
  resumeSessionId: string | undefined;
  sessionPersistence: boolean;
};

export type ResolvedSessionStart = {
  sessionId: string;
  transcriptPath: string | undefined;
  entries: TranscriptEntry[];
  initialMessages: ChatMessage[];
  initialMode: AgentMode;
  mode: 'new' | 'continue' | 'resume' | 'disabled';
  persistenceEnabled: boolean;
};

export async function resolveSessionStart(
  options: ResolveSessionStartOptions,
): Promise<ResolvedSessionStart> {
  if (!options.sessionPersistence) {
    return createEmptySession('disabled', undefined);
  }

  if (options.continueLatest && options.resumeSessionId) {
    throw new Error('Use either --continue or --resume, not both');
  }

  if (options.continueLatest) {
    const projectDir = getProjectSessionsDir(options.cwd, options.sessionsHome);
    const [latestSessionFile] = await listSessionFilesNewestFirst(projectDir);
    if (!latestSessionFile) {
      throw new Error('No session found to continue for this workspace');
    }

    return readExistingSession('continue', latestSessionFile);
  }

  if (options.resumeSessionId) {
    if (!isSessionId(options.resumeSessionId)) {
      throw new Error(`Invalid session ID: ${options.resumeSessionId}`);
    }

    const transcriptPath = getSessionFilePath(
      options.cwd,
      options.resumeSessionId,
      options.sessionsHome,
    );
    try {
      await access(transcriptPath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`No session found with session ID: ${options.resumeSessionId}`);
      }

      throw error;
    }

    return readExistingSession('resume', transcriptPath);
  }

  const sessionId = createSessionId();
  return {
    sessionId,
    transcriptPath: getSessionFilePath(options.cwd, sessionId, options.sessionsHome),
    entries: [],
    initialMessages: [],
    initialMode: 'normal',
    mode: 'new',
    persistenceEnabled: true,
  };
}

function createEmptySession(
  mode: 'disabled',
  transcriptPath: string | undefined,
): ResolvedSessionStart {
  return {
    sessionId: createSessionId(),
    transcriptPath,
    entries: [],
    initialMessages: [],
    initialMode: 'normal',
    mode,
    persistenceEnabled: false,
  };
}

async function readExistingSession(
  mode: 'continue' | 'resume',
  transcriptPath: string,
): Promise<ResolvedSessionStart> {
  const sessionId = basename(transcriptPath, '.jsonl');
  const entries = await readTranscriptEntries(transcriptPath);

  return {
    sessionId,
    transcriptPath,
    entries,
    initialMessages: transcriptEntriesToMessages(entries),
    initialMode: getInitialMode(entries),
    mode,
    persistenceEnabled: true,
  };
}

function getInitialMode(entries: TranscriptEntry[]): AgentMode {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type === 'mode') {
      return entry.mode;
    }
  }

  return 'normal';
}
