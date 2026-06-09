const COMPACT_PROMPT = `你要总结目前为止的会话，帮助后续 agent 在不读取完整历史的情况下继续工作。
不要调用任何工具，只输出文本。

请先在 <analysis> 中整理，再在 <summary> 中输出最终摘要。

摘要必须包含：
1. 用户主要请求和意图
2. 关键技术概念
3. 涉及文件和代码区域
4. 错误和修复
5. 已完成工作
6. 所有重要用户反馈
7. 当前待办
8. 当前工作状态
9. 下一步`;

export function createCompactSummaryPrompt(): string {
  return COMPACT_PROMPT;
}

export function formatCompactSummary(summary: string): string {
  /**
   * <analysis> 是模型生成摘要前的草稿区，保留它会污染后续上下文，所以 compact 后只保留最终摘要。
   */
  let formatted = summary.replace(/<analysis>[\s\S]*?<\/analysis>/, '');
  const match = formatted.match(/<summary>([\s\S]*?)<\/summary>/);
  if (match) {
    formatted = match[1] ?? '';
  }

  return formatted.replace(/\n\n+/g, '\n\n').trim();
}

export function createCompactSummaryMessage(
  summary: string,
  recentMessagesPreserved: boolean,
): string {
  const recentNotice = recentMessagesPreserved
    ? '\n\nRecent messages are preserved verbatim after this summary.'
    : '';

  return `This session is being continued from a compacted conversation.

Summary:
${formatCompactSummary(summary)}${recentNotice}`;
}
