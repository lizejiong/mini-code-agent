# V8 上下文 Compact 简易版设计文档

## 背景

当前项目已经具备：

- V1：基础 agent loop、provider、工具注册和权限确认。
- V2：session transcript 与 resume。
- V3：plan mode 与局部文件编辑工具。
- V4：交互式 TUI。
- V5：项目上下文注入。
- V6：Todo / Task 进度工具。
- V7：流式对话与 TUI 运行展示优化。

下一步学习 Claude Code 的核心上下文管理能力：`compact`。长会话会持续积累用户消息、assistant 回复、工具调用和工具结果；如果完整历史一直传给模型，后续请求会越来越大，最终接近或超过模型上下文窗口。`compact` 的目标是把较早历史压缩成可继续工作的摘要，同时保留最近几轮原始消息。

参考项目 `D:\code\coding\claude-code-sourcemap` 的实现包含 `/compact` 命令、自动 compact、microcompact、hooks、prompt cache sharing、附件恢复、plan/skill/file 状态恢复等复杂能力。V8 只抽取最核心的学习路径：生成摘要、写入 compact 边界、替换后续模型上下文，并提供手动和简单自动触发。

## 目标

- 支持 TUI 中输入 `/compact` 手动压缩当前会话历史。
- 支持简单自动 compact：
  - 粗略 token 数达到阈值时触发。
  - 消息数量达到阈值时兜底触发。
- compact 时调用当前 provider 生成详细摘要。
- compact 后后续模型请求使用：
  - compact boundary system message。
  - compact summary user message。
  - 最近保留的原始消息。
  - compact 后新增的消息。
- compact 事件写入 transcript，`--continue` / `--resume` 恢复时能使用压缩后的上下文。
- TUI 显示 compact 过程和 compact 完成状态。
- 保持实现可学习、边界清晰、测试可覆盖。

## 非目标

- 不实现 Claude Code 的 hooks。
- 不实现 session memory compact。
- 不实现 reactive compact。
- 不实现 microcompact。
- 不实现 prompt cache sharing。
- 不实现真实 tokenizer 或 provider token counting。
- 不恢复最近读过的文件附件。
- 不恢复 skill 附件。
- 不自动读取 transcript 原文补细节。
- 不提供复杂 `/context`、`/status` 或 slash command 框架；V8 只识别 `/compact`。
- 不重写旧 transcript 文件；transcript 继续追加 JSONL。

## 借鉴 Claude Code 的核心机制

参考项目的 compact 关键结构是：

```text
compact boundary
summary message
recent messages to keep
attachments / hook results
```

V8 简化为：

```text
compact boundary system message
summary user message
recent messages to keep
```

参考项目的 summary prompt 要求模型关注：

- 用户明确请求和意图。
- 关键技术概念。
- 读过、改过、创建过的文件。
- 错误和修复。
- 问题解决过程。
- 所有用户消息。
- 待办任务。
- 当前工作。
- 下一步。

V8 也采用这个摘要结构，但使用更短的中文 prompt，并明确禁止工具调用。

## 触发策略

### 手动触发

用户在 TUI 输入：

```text
/compact
```

TUI 不把这条命令作为普通用户任务发送给 agent，也不写入普通 user transcript。它会直接调用 compact 服务：

1. 检查当前可压缩消息数量。
2. 调 provider 生成摘要。
3. 选择最近消息保留。
4. 写入 `compact` transcript entry。
5. 更新内存中的 `conversationMessages`。
6. TUI 显示 compact 完成。

### 自动触发

每次用户提交普通任务、调用 `runAgent` 前，先检查当前 `conversationMessages` 是否需要 compact。

默认阈值：

```ts
const AUTO_COMPACT_ROUGH_TOKEN_THRESHOLD = 60_000;
const AUTO_COMPACT_MESSAGE_THRESHOLD = 40;
const COMPACT_KEEP_RECENT_MESSAGES = 8;
```

触发条件：

```text
roughTokens >= 60000 OR messageCount >= 40
```

粗略 token 估算使用字符数除以 4：

```ts
Math.ceil(content.length / 4)
```

这个估算不精确，但足够用于学习版自动 compact。V8 不试图判断真实模型上下文窗口。

## Compact 数据模型

扩展 `TranscriptEntry`：

```ts
type CompactTranscriptEntry = {
  type: 'compact';
  sessionId: string;
  timestamp: string;
  summary: string;
  trigger: 'manual' | 'auto';
  previousMessageCount: number;
  keptMessageCount: number;
  keptMessages: ChatMessage[];
};
```

设计原因：

- transcript 继续 append-only，避免修改历史文件。
- `summary` 保存模型生成的压缩摘要。
- `keptMessages` 保存 compact 后仍要原样传给模型的最近消息。
- resume 时可以从最新一条 `compact` entry 重建上下文，而不是重新读取并压缩旧历史。

## Transcript 恢复规则

`transcriptEntriesToMessages(entries)` 调整为识别最新 compact：

1. 找到最后一条 `type === 'compact'` 的 entry。
2. 如果不存在 compact，保持旧逻辑。
3. 如果存在 compact：
   - 先生成 compact boundary system message。
   - 再生成 summary user message。
   - 加入该 compact entry 的 `keptMessages`。
   - 再转换 compact entry 之后的普通 transcript entries。
4. compact entry 之前的普通 entries 不再进入模型上下文。

compact boundary 示例：

```text
Conversation compacted. Earlier messages are summarized below. Continue using the summary as authoritative context.
```

summary user message 示例：

```text
This session is being continued from a compacted conversation.

Summary:
...

Recent messages are preserved verbatim after this summary.
```

## 最近消息保留规则

V8 默认保留最近 `8` 条 `ChatMessage`。为了避免 provider 收到不合法消息序列，保留逻辑需要做最小规范化：

- 优先从最近 `8` 条开始。
- 如果第一条不是 `user`，向后丢弃，直到第一条是 `user`。
- 如果保留范围中出现没有对应 assistant `toolCalls` 的 `tool` 消息，丢弃该 orphan tool 消息。
- 如果规范化后没有可保留消息，则只保留 summary。

这样可以避免 compact 后上下文从 assistant 或 tool result 开始。

## Compact 服务设计

新增目录：

```text
src/
  compact/
    prompt.ts
    roughTokens.ts
    service.ts
```

### `prompt.ts`

职责：

- 生成 compact summary prompt。
- 格式化 raw summary，去掉 `<analysis>`，提取 `<summary>`。
- 生成 summary user message 文本。

prompt 使用中文，结构参考 Claude Code：

```text
你要总结目前为止的会话，帮助后续 agent 在不读取完整历史的情况下继续工作。
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
9. 下一步
```

### `roughTokens.ts`

职责：

- 对 `ChatMessage[]` 做粗略 token 估算。
- 判断是否超过自动 compact 阈值。

### `service.ts`

核心类型：

```ts
export type CompactTrigger = 'manual' | 'auto';

export type CompactResult = {
  summary: string;
  trigger: CompactTrigger;
  previousMessageCount: number;
  keptMessages: ChatMessage[];
  nextMessages: ChatMessage[];
};
```

核心函数：

```ts
export async function compactConversation(options: {
  messages: ChatMessage[];
  provider: ChatProvider;
  trigger: CompactTrigger;
  keepRecentMessages?: number;
}): Promise<CompactResult>;
```

行为：

1. 如果可压缩消息为空，返回明确错误。
2. 构造 summary 请求：原始 messages + compact prompt。
3. 调用 `provider.complete({ messages, tools: [] })`。
4. 从响应中提取 summary 文本。
5. 选择并规范化最近消息。
6. 生成 `nextMessages`：
   - compact boundary system message。
   - compact summary user message。
   - kept messages。
7. 返回 compact 结果，由 CLI/TUI 负责写 transcript 和更新内存。

## CLI / TUI 集成

当前 `cli.ts` 持有：

```ts
let conversationMessages: ChatMessage[] = [...session.initialMessages];
```

V8 需要让它支持 compact 后整体替换：

```ts
conversationMessages = compactResult.nextMessages;
```

同时写入 compact transcript：

```ts
await appendTranscriptEntry(session.transcriptPath, {
  type: 'compact',
  sessionId,
  timestamp,
  summary,
  trigger,
  previousMessageCount,
  keptMessageCount,
  keptMessages,
});
```

`renderTui` / `createAgentRunner` 增加可选回调：

```ts
compact(trigger: 'manual' | 'auto'): Promise<void>;
shouldAutoCompact(): boolean;
```

普通任务流程：

```text
user submits task
if shouldAutoCompact():
  compact('auto')
runAgent(task)
```

手动命令流程：

```text
user submits /compact
compact('manual')
do not runAgent
```

## TUI 展示

新增 TUI message role：

```ts
| { role: 'compact'; content: string }
```

展示示例：

```text
Compact
  manual compact completed: 42 messages -> summary + 6 recent messages
```

自动 compact 示例：

```text
Compact
  auto compact completed: rough tokens 61234, kept 8 recent messages
```

失败时使用现有 `error` role：

```text
Compact failed: Not enough messages to compact.
```

## 错误处理

- 当前消息少于 `COMPACT_KEEP_RECENT_MESSAGES + 2`：
  - 手动 compact 返回错误：消息太少，不需要 compact。
  - 自动 compact 不触发。
- summary 响应为空：
  - compact 失败，不替换 `conversationMessages`，不写 compact transcript。
- provider 请求失败：
  - compact 失败，TUI 显示错误，原上下文保持不变。
- compact 后规范化保留消息为空：
  - 允许，只使用 summary 继续。
- 自动 compact 失败：
  - 本轮仍继续执行用户任务，避免用户任务被 compact 失败阻塞。
  - TUI 显示错误。

## 测试策略

### Compact prompt 测试

- `formatCompactSummary` 会移除 `<analysis>`。
- `formatCompactSummary` 会提取 `<summary>` 内容。
- 没有 XML 标签时保留原文本。

### Rough token 测试

- 能估算 user / assistant / tool message 文本。
- 超过 token 阈值时返回需要 auto compact。
- 超过 message 阈值时返回需要 auto compact。
- 消息太少时不触发。

### Compact service 测试

- 手动 compact 调用 provider 并生成 `nextMessages`。
- compact 后 `nextMessages` 以 system boundary 和 user summary 开头。
- 保留最近消息。
- 第一条保留消息不是 user 时会规范化。
- provider 返回空 summary 时失败。
- 消息太少时失败。

### Transcript 测试

- 没有 compact entry 时保持旧转换逻辑。
- 有 compact entry 时只使用最新 compact 后的上下文。
- compact entry 后的新 user/assistant/tool entries 会继续追加到模型上下文。
- 多次 compact 时只以最后一次 compact 为准。

### TUI runner 测试

- 输入 `/compact` 调用 compact，不调用 `runAgent`。
- 普通任务在超过阈值时先自动 compact 再调用 `runAgent`。
- 自动 compact 失败时仍继续执行普通任务。
- compact 成功后追加 compact 展示消息。

### Build

- `pnpm.cmd test`
- `pnpm.cmd build`

## 后续演进

- V9 可以补 `list_dir` / `glob_files` / `grep_files`，增强 compact 前后的项目探索能力。
- 后续可以让 compact 恢复 plan 文件、todo 摘要和最近读过的文件。
- 后续可以用 provider token usage 或 tokenizer 替代粗略 token 估算。
- 后续可以实现完整 slash command 框架，再扩展 `/context`、`/status`、`/todos`。
- 后续可以引入自动 compact 失败熔断，接近 Claude Code 的连续失败保护。

## 自审记录

- 范围聚焦在 compact 核心，不混入 hooks、microcompact、prompt cache 或复杂附件恢复。
- 手动和自动触发都有明确入口。
- transcript append-only，恢复规则明确。
- compact 后模型上下文结构明确。
- 自动阈值和保留窗口有默认值。
- 错误处理覆盖 provider 失败、summary 为空、消息过少和自动 compact 失败。
- 测试覆盖 prompt、token 估算、service、transcript 和 TUI runner。
