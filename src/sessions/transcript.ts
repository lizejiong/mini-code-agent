import { mkdir, readdir, readFile, stat, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildCompactedMessages,
  type CompactTrigger,
} from '../compact/service.js';
import type { AgentMode, ModeTranscriptReason } from '../modes/types.js';
import type { ChatMessage, ChatToolCall } from '../providers/types.js';
import type { ToolResult } from '../tools/types.js';

export type TranscriptEntry =
  | {
      type: 'user';
      sessionId: string;
      timestamp: string;
      content: string;
    }
  | {
      type: 'assistant';
      sessionId: string;
      timestamp: string;
      content: string;
      toolCalls: ChatToolCall[];
    }
  | {
      type: 'tool';
      sessionId: string;
      timestamp: string;
      toolCallId: string;
      name: string;
      result: ToolResult;
    }
  | {
      type: 'mode';
      sessionId: string;
      timestamp: string;
      mode: AgentMode;
      reason: ModeTranscriptReason;
      planFilePath?: string;
    }
  | {
      type: 'compact';
      sessionId: string;
      timestamp: string;
      summary: string;
      trigger: CompactTrigger;
      previousMessageCount: number;
      keptMessageCount: number;
      keptMessages: ChatMessage[];
    };

export async function appendTranscriptEntry(
  filePath: string,
  entry: TranscriptEntry,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

export async function readTranscriptEntries(filePath: string): Promise<TranscriptEntry[]> {
  const content = await readFile(filePath, 'utf8');
  const entries: TranscriptEntry[] = [];

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }

    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch (error) {
      throw new Error(`Invalid transcript JSON at line ${index + 1}`, { cause: error });
    }
  }

  return entries;
}

export function transcriptEntriesToMessages(entries: TranscriptEntry[]): ChatMessage[] {
  const latestCompactIndex = findLatestCompactIndex(entries);
  if (latestCompactIndex >= 0) {
    const compactEntry = entries[latestCompactIndex];
    if (compactEntry?.type !== 'compact') {
      throw new Error('Invalid compact transcript state');
    }

    return [
      ...buildCompactedMessages(compactEntry.summary, compactEntry.keptMessages),
      ...entries
        .slice(latestCompactIndex + 1)
        .flatMap<ChatMessage>((entry) => transcriptEntryToMessages(entry)),
    ];
  }

  return entries.flatMap<ChatMessage>((entry) => transcriptEntryToMessages(entry));
}

function transcriptEntryToMessages(entry: TranscriptEntry): ChatMessage[] {
    if (entry.type === 'mode') {
      return [];
    }

    if (entry.type === 'compact') {
      return [];
    }

    if (entry.type === 'user') {
      return [{ role: 'user', content: entry.content }];
    }

    if (entry.type === 'assistant') {
      return [
        {
          role: 'assistant',
          content: entry.content,
          toolCalls: entry.toolCalls,
        },
      ];
    }

    /**
     * provider 层只认识 chat message；工具结果保持 JSON 字符串，避免恢复后上下文格式和实时执行路径不一致。
     */
    return [
      {
        role: 'tool',
        toolCallId: entry.toolCallId,
        content: JSON.stringify(entry.result),
      },
    ];
}

function findLatestCompactIndex(entries: TranscriptEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.type === 'compact') {
      return index;
    }
  }

  return -1;
}

export async function listSessionFilesNewestFirst(projectDir: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(projectDir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const files = await Promise.all(
    names
      .filter((name) => name.endsWith('.jsonl'))
      .map(async (name) => {
        const filePath = join(projectDir, name);
        const fileStat = await stat(filePath);
        return { filePath, mtimeMs: fileStat.mtimeMs };
      }),
  );

  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.filePath.localeCompare(left.filePath))
    .map((file) => file.filePath);
}
