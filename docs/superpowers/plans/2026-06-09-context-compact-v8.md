# V8 Context Compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现手动 `/compact` 与简单自动 compact，让长会话可以用摘要替换旧历史并继续运行。

**Architecture:** 新增 `src/compact/` 封装 prompt、粗略 token 估算和 compact service；扩展 transcript 支持 append-only compact entry；TUI runner 在普通任务前做自动 compact，并拦截 `/compact` 做手动 compact。

**Tech Stack:** TypeScript、Vitest、Ink、现有 OpenAI-compatible provider 抽象。

---

## File Structure

- Create: `src/compact/prompt.ts`，生成和格式化 compact 摘要文本。
- Create: `src/compact/roughTokens.ts`，估算消息 token 并判断自动 compact。
- Create: `src/compact/service.ts`，调用 provider 生成摘要、保留最近消息、构造 compact 后上下文。
- Modify: `src/sessions/transcript.ts`，新增 compact entry 与恢复规则。
- Modify: `src/cli.ts`，持有 compact 回调，更新 `conversationMessages`，写 transcript。
- Modify: `src/ui/types.ts`，新增 compact 展示消息。
- Modify: `src/ui/App.tsx`、`src/ui/renderTui.tsx`、`src/ui/useAgentRunner.ts`，集成 `/compact` 与自动 compact 展示。
- Test: `tests/compact-prompt.test.ts`。
- Test: `tests/compact-rough-tokens.test.ts`。
- Test: `tests/compact-service.test.ts`。
- Modify Test: `tests/session-transcript.test.ts`。
- Modify Test: `tests/ui-runner.test.ts`。

### Task 1: Compact Prompt

**Files:**
- Create: `src/compact/prompt.ts`
- Test: `tests/compact-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/compact-prompt.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  createCompactSummaryMessage,
  createCompactSummaryPrompt,
  formatCompactSummary,
} from '../src/compact/prompt.js';

describe('compact prompt', () => {
  test('creates a no-tools Chinese summary prompt', () => {
    const prompt = createCompactSummaryPrompt();

    expect(prompt).toContain('不要调用任何工具');
    expect(prompt).toContain('<analysis>');
    expect(prompt).toContain('<summary>');
    expect(prompt).toContain('用户主要请求和意图');
  });

  test('removes analysis and extracts summary content', () => {
    const formatted = formatCompactSummary(
      '<analysis>草稿</analysis>\n<summary>\n最终摘要\n</summary>',
    );

    expect(formatted).toBe('最终摘要');
  });

  test('keeps plain text when summary tags are absent', () => {
    expect(formatCompactSummary('普通摘要')).toBe('普通摘要');
  });

  test('wraps formatted summary as a continuation user message', () => {
    const message = createCompactSummaryMessage('摘要内容', true);

    expect(message).toContain('This session is being continued');
    expect(message).toContain('Summary:');
    expect(message).toContain('摘要内容');
    expect(message).toContain('Recent messages are preserved verbatim');
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm.cmd test tests/compact-prompt.test.ts
```

Expected: fail because `src/compact/prompt.ts` does not exist.

- [ ] **Step 3: Implement prompt helpers**

Create `src/compact/prompt.ts` with:

```ts
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
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/compact-prompt.test.ts
```

Expected: pass.

### Task 2: Rough Token Estimation

**Files:**
- Create: `src/compact/roughTokens.ts`
- Test: `tests/compact-rough-tokens.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/compact-rough-tokens.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  estimateRoughTokens,
  shouldAutoCompact,
} from '../src/compact/roughTokens.js';
import type { ChatMessage } from '../src/providers/types.js';

describe('compact rough tokens', () => {
  test('estimates rough tokens from message content', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '12345678' },
      { role: 'assistant', content: '1234' },
      { role: 'tool', toolCallId: 'tool-1', content: '1234' },
    ];

    expect(estimateRoughTokens(messages)).toBe(4);
  });

  test('triggers auto compact by rough token threshold', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(80) },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'again' },
    ];

    expect(
      shouldAutoCompact(messages, {
        roughTokenThreshold: 10,
        messageThreshold: 100,
        minMessages: 3,
      }),
    ).toBe(true);
  });

  test('triggers auto compact by message threshold', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '1' },
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
    ];

    expect(
      shouldAutoCompact(messages, {
        roughTokenThreshold: 1000,
        messageThreshold: 3,
        minMessages: 3,
      }),
    ).toBe(true);
  });

  test('does not trigger when there are too few messages', () => {
    expect(
      shouldAutoCompact([{ role: 'user', content: 'x'.repeat(100) }], {
        roughTokenThreshold: 1,
        messageThreshold: 1,
        minMessages: 3,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm.cmd test tests/compact-rough-tokens.test.ts
```

Expected: fail because `src/compact/roughTokens.ts` does not exist.

- [ ] **Step 3: Implement rough token helpers**

Create `src/compact/roughTokens.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/compact-rough-tokens.test.ts
```

Expected: pass.

### Task 3: Compact Service

**Files:**
- Create: `src/compact/service.ts`
- Test: `tests/compact-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `tests/compact-service.test.ts` covering provider call, boundary + summary messages, recent message normalization, empty summary failure, and too-few messages failure.

- [ ] **Step 2: Run service tests to verify RED**

Run:

```bash
pnpm.cmd test tests/compact-service.test.ts
```

Expected: fail because service does not exist.

- [ ] **Step 3: Implement compact service**

Create `src/compact/service.ts` with exported `COMPACT_BOUNDARY_MESSAGE`, `CompactTrigger`, `CompactResult`, `compactConversation`, and internal recent-message normalization.

- [ ] **Step 4: Run service tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/compact-service.test.ts
```

Expected: pass.

### Task 4: Transcript Compact Entries

**Files:**
- Modify: `src/sessions/transcript.ts`
- Modify Test: `tests/session-transcript.test.ts`

- [ ] **Step 1: Add failing transcript tests**

Extend transcript tests for compact entry conversion, compact entry after-history append, and multiple compact entries using only the latest compact.

- [ ] **Step 2: Run transcript tests to verify RED**

Run:

```bash
pnpm.cmd test tests/session-transcript.test.ts
```

Expected: fail because compact entry type is unsupported.

- [ ] **Step 3: Implement compact transcript conversion**

Add `compact` to `TranscriptEntry`, import compact message helpers, and make `transcriptEntriesToMessages` rebuild from the latest compact entry.

- [ ] **Step 4: Run transcript tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/session-transcript.test.ts
```

Expected: pass.

### Task 5: TUI Runner Compact Flow

**Files:**
- Modify: `src/ui/types.ts`
- Modify: `src/ui/useAgentRunner.ts`
- Modify Test: `tests/ui-runner.test.ts`

- [ ] **Step 1: Add failing TUI runner tests**

Extend `tests/ui-runner.test.ts` to prove `/compact` calls compact without `runAgent`, auto compact runs before normal tasks, auto compact failure still runs the task, and compact success appends a compact message.

- [ ] **Step 2: Run UI runner tests to verify RED**

Run:

```bash
pnpm.cmd test tests/ui-runner.test.ts
```

Expected: fail because runner has no compact callbacks.

- [ ] **Step 3: Implement runner compact behavior**

Add optional `compact`, `shouldAutoCompact`, and compact role handling. Intercept `/compact`; before normal task, run auto compact when requested.

- [ ] **Step 4: Run UI runner tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/ui-runner.test.ts
```

Expected: pass.

### Task 6: CLI and App Integration

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/renderTui.tsx`

- [ ] **Step 1: Wire compact callbacks**

In `cli.ts`, create a `runCompact(trigger)` helper that calls `compactConversation`, writes compact transcript entries, and replaces `conversationMessages`.

- [ ] **Step 2: Display compact messages in App**

Render `role: 'compact'` with a dim or magenta label, keeping existing status/error display.

- [ ] **Step 3: Run focused related tests**

Run:

```bash
pnpm.cmd test tests/compact-prompt.test.ts tests/compact-rough-tokens.test.ts tests/compact-service.test.ts tests/session-transcript.test.ts tests/ui-runner.test.ts
```

Expected: all pass.

### Task 7: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run full test suite**

Run:

```bash
pnpm.cmd test
```

Expected: all tests pass.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm.cmd build
```

Expected: TypeScript build exits 0.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add -A
git commit -m "feat: add context compact v8"
```

Expected: commit succeeds on `codex/context-compact-v8`.

## Self-Review

- Spec coverage: manual `/compact` is covered by Task 5 and Task 6; auto compact by Task 2, Task 5, Task 6; summary generation by Task 1 and Task 3; transcript recovery by Task 4; TUI display by Task 5 and Task 6.
- Placeholder scan: the plan intentionally leaves implementation details for Task 3 and Task 5 tests to be written during TDD, but every task has concrete file paths, commands, and expected behavior.
- Type consistency: compact trigger is consistently `'manual' | 'auto'`; transcript compact entry stores `summary`, `trigger`, `previousMessageCount`, `keptMessageCount`, and `keptMessages`.
