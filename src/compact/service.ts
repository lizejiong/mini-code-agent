import type { ChatMessage, ChatProvider } from '../providers/types.js';
import {
  createCompactSummaryMessage,
  createCompactSummaryPrompt,
  formatCompactSummary,
} from './prompt.js';
import { COMPACT_KEEP_RECENT_MESSAGES } from './roughTokens.js';

export const COMPACT_BOUNDARY_MESSAGE =
  'Conversation compacted. Earlier messages are summarized below. Continue using the summary as authoritative context.';

export type CompactTrigger = 'manual' | 'auto';

export type CompactResult = {
  summary: string;
  trigger: CompactTrigger;
  previousMessageCount: number;
  keptMessages: ChatMessage[];
  nextMessages: ChatMessage[];
};

export async function compactConversation(options: {
  messages: ChatMessage[];
  provider: ChatProvider;
  trigger: CompactTrigger;
  keepRecentMessages?: number;
  minMessages?: number;
}): Promise<CompactResult> {
  const minMessages = options.minMessages ?? COMPACT_KEEP_RECENT_MESSAGES + 2;
  if (options.messages.length < minMessages) {
    throw new Error('Not enough messages to compact.');
  }

  const response = await options.provider.complete({
    messages: [
      ...options.messages,
      { role: 'user', content: createCompactSummaryPrompt() },
    ],
    tools: [],
  });
  const summary = formatCompactSummary(response.content);
  if (!summary) {
    throw new Error('Compact summary is empty.');
  }

  const keptMessages = selectRecentMessages(
    options.messages,
    options.keepRecentMessages ?? COMPACT_KEEP_RECENT_MESSAGES,
  );
  const nextMessages = buildCompactedMessages(summary, keptMessages);

  return {
    summary,
    trigger: options.trigger,
    previousMessageCount: options.messages.length,
    keptMessages,
    nextMessages,
  };
}

export function buildCompactedMessages(
  summary: string,
  keptMessages: ChatMessage[],
): ChatMessage[] {
  return [
    { role: 'system', content: COMPACT_BOUNDARY_MESSAGE },
    {
      role: 'user',
      content: createCompactSummaryMessage(summary, keptMessages.length > 0),
    },
    ...keptMessages,
  ];
}

function selectRecentMessages(
  messages: ChatMessage[],
  keepRecentMessages: number,
): ChatMessage[] {
  const recent = messages.slice(-keepRecentMessages);
  const firstUserIndex = recent.findIndex((message) => message.role === 'user');
  if (firstUserIndex < 0) {
    return [];
  }

  return dropOrphanToolMessages(recent.slice(firstUserIndex));
}

function dropOrphanToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const availableToolCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }

    for (const toolCall of message.toolCalls ?? []) {
      availableToolCallIds.add(toolCall.id);
    }
  }

  /**
   * compact 后的保留片段可能从工具结果中间切开；丢弃孤立 tool message 可以避免 provider 收到无法配对的 tool result。
   */
  return messages.filter(
    (message) =>
      message.role !== 'tool' || availableToolCallIds.has(message.toolCallId),
  );
}
