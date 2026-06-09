import type { ChatMessage } from '../providers/types.js';

export const AUTO_COMPACT_ROUGH_TOKEN_THRESHOLD = 60_000;
export const AUTO_COMPACT_MESSAGE_THRESHOLD = 40;
export const COMPACT_KEEP_RECENT_MESSAGES = 8;

export type AutoCompactThresholds = {
  roughTokenThreshold?: number;
  messageThreshold?: number;
  minMessages?: number;
};

export function estimateRoughTokens(messages: ChatMessage[]): number {
  const characters = messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );

  /** 学习版不引入 tokenizer，先用常见的 chars/4 粗估，后续可替换为真实 token 计数。 */
  return Math.ceil(characters / 4);
}

export function shouldAutoCompact(
  messages: ChatMessage[],
  thresholds: AutoCompactThresholds = {},
): boolean {
  const minMessages = thresholds.minMessages ?? COMPACT_KEEP_RECENT_MESSAGES + 2;
  if (messages.length < minMessages) {
    return false;
  }

  return (
    estimateRoughTokens(messages) >=
      (thresholds.roughTokenThreshold ?? AUTO_COMPACT_ROUGH_TOKEN_THRESHOLD) ||
    messages.length >=
      (thresholds.messageThreshold ?? AUTO_COMPACT_MESSAGE_THRESHOLD)
  );
}
