# V10 自动 Todo 策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为复杂实现任务自动注入 todo 使用策略提示，让 agent 更稳定地先拆解任务、执行中更新进度、收尾前完成状态同步。

**Architecture:** 新增 `src/todos/policy.ts` 负责复杂任务启发式判断和 system prompt 生成；`src/agent/loop.ts` 只在构造 system messages 时调用该模块。现有 `todo_read`、`todo_write`、`TodoStore`、TUI 展示和工具 schema 保持不变。

**Tech Stack:** TypeScript、Vitest、现有 `runAgent`、`AgentMode`、ChatMessage system prompt 流程。

---

## File Structure

- Create: `src/todos/policy.ts`
- Create: `tests/todo-policy.test.ts`
- Modify: `src/agent/loop.ts`
- Modify: `tests/agent-loop.test.ts`

### Task 1: Todo Policy Module

**Files:**
- Create: `src/todos/policy.ts`
- Test: `tests/todo-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `tests/todo-policy.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  createTodoPolicyPrompt,
  shouldSuggestTodos,
} from '../src/todos/policy.js';

describe('todo policy', () => {
  test('suggests todos for complex implementation tasks', () => {
    expect(shouldSuggestTodos('帮我实现一个新的文件编辑工具')).toBe(true);
    expect(shouldSuggestTodos('修复 run_command 的错误并运行测试')).toBe(true);
    expect(shouldSuggestTodos('继续下一版本，做 V10')).toBe(true);
  });

  test('does not suggest todos for simple read-only tasks', () => {
    expect(shouldSuggestTodos('怎么使用')).toBe(false);
    expect(shouldSuggestTodos('生成一句话项目描述')).toBe(false);
    expect(shouldSuggestTodos('带我阅读本次改动')).toBe(false);
    expect(shouldSuggestTodos('当前已经可使用了吗')).toBe(false);
  });

  test('lets implementation intent win over read-only words', () => {
    expect(shouldSuggestTodos('阅读代码并实现修复')).toBe(true);
  });

  test('returns no prompt for simple normal mode tasks', () => {
    expect(
      createTodoPolicyPrompt({ task: '怎么使用', mode: 'normal' }),
    ).toBeUndefined();
  });

  test('returns no prompt in plan mode', () => {
    expect(
      createTodoPolicyPrompt({ task: '帮我实现一个新功能', mode: 'plan' }),
    ).toBeUndefined();
  });

  test('creates a Chinese todo policy prompt for complex normal mode tasks', () => {
    const prompt = createTodoPolicyPrompt({
      task: '帮我实现一个新功能',
      mode: 'normal',
    });

    expect(prompt).toContain('Todo 使用策略');
    expect(prompt).toContain('todo_write');
    expect(prompt).toContain('3-6 个 todo');
    expect(prompt).toContain('最多一个 in_progress');
    expect(prompt).toContain('completed');
  });
});
```

- [ ] **Step 2: Run policy tests to verify RED**

Run:

```bash
pnpm.cmd test tests/todo-policy.test.ts
```

Expected: fail because `src/todos/policy.ts` does not exist.

- [ ] **Step 3: Implement todo policy module**

Create `src/todos/policy.ts`:

```ts
import type { AgentMode } from '../modes/types.js';

const IMPLEMENTATION_KEYWORDS = [
  '实现',
  '修复',
  '重构',
  '修改',
  '新增',
  '继续下一版本',
  '下个版本',
  '下一版本',
  'v10',
  '测试',
  '提交',
];

const READ_ONLY_KEYWORDS = [
  '解释',
  '阅读',
  '怎么使用',
  '列出',
  '描述',
  '有哪些功能',
  '当前',
  '是否',
];

export function shouldSuggestTodos(task: string): boolean {
  const normalizedTask = task.trim().toLowerCase();
  if (!normalizedTask) {
    return false;
  }

  const hasImplementationIntent = IMPLEMENTATION_KEYWORDS.some((keyword) =>
    normalizedTask.includes(keyword.toLowerCase()),
  );
  if (!hasImplementationIntent) {
    return false;
  }

  const hasReadOnlyIntent = READ_ONLY_KEYWORDS.some((keyword) =>
    normalizedTask.includes(keyword.toLowerCase()),
  );

  /**
   * 明确的实现/修复意图优先于“阅读”等上下文收集词，避免“阅读代码并实现修复”被误判成只读任务。
   */
  return !hasReadOnlyIntent || /实现|修复|重构|修改|新增/.test(normalizedTask);
}

export function createTodoPolicyPrompt(options: {
  task: string;
  mode: AgentMode;
}): string | undefined {
  if (options.mode !== 'normal' || !shouldSuggestTodos(options.task)) {
    return undefined;
  }

  return `Todo 使用策略：

当前用户请求看起来是一个多步骤实现任务。开始修改代码前，先用 todo_write 创建 3-6 个 todo，覆盖理解现状、实现、验证和收尾。

执行过程中保持最多一个 in_progress；每完成一个阶段就更新 todo_write。最终回答前，将已完成事项标记为 completed。

如果你在读取上下文后判断任务其实很简单，可以不创建 todo，但不要在复杂任务中跳过进度维护。`;
}
```

- [ ] **Step 4: Run policy tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/todo-policy.test.ts
```

Expected: pass.

### Task 2: Agent Loop Prompt Injection

**Files:**
- Modify: `src/agent/loop.ts`
- Modify Test: `tests/agent-loop.test.ts`

- [ ] **Step 1: Add failing agent loop tests**

Append these tests inside `describe('runAgent', () => { ... })` in `tests/agent-loop.test.ts`:

```ts
  test('injects todo policy prompt for complex normal mode tasks', async () => {
    const requests: ChatCompletionRequest[] = [];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return { content: 'done', toolCalls: [] };
      },
    };

    await runAgent({
      task: '帮我实现一个新功能',
      provider,
      tools: fakeRegistry(),
      maxSteps: 1,
      modeController: {
        getMode: () => 'normal',
        getPlanFilePath: () => 'plan.md',
        enterPlanMode: async () => ({ ok: true, content: 'entered' }),
        exitPlanMode: async () => ({ ok: true, content: 'exited' }),
      },
    });

    expect(requests[0].messages).toContainEqual({
      role: 'system',
      content: expect.stringContaining('Todo 使用策略'),
    });
  });

  test('does not inject todo policy prompt for simple tasks', async () => {
    const requests: ChatCompletionRequest[] = [];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return { content: 'done', toolCalls: [] };
      },
    };

    await runAgent({
      task: '怎么使用',
      provider,
      tools: fakeRegistry(),
      maxSteps: 1,
      modeController: {
        getMode: () => 'normal',
        getPlanFilePath: () => 'plan.md',
        enterPlanMode: async () => ({ ok: true, content: 'entered' }),
        exitPlanMode: async () => ({ ok: true, content: 'exited' }),
      },
    });

    expect(
      requests[0].messages.some(
        (message) =>
          message.role === 'system' &&
          message.content.includes('Todo 使用策略'),
      ),
    ).toBe(false);
  });

  test('does not inject todo policy prompt in plan mode', async () => {
    const requests: ChatCompletionRequest[] = [];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return { content: 'done', toolCalls: [] };
      },
    };

    await runAgent({
      task: '帮我实现一个新功能',
      provider,
      tools: fakeRegistry(),
      maxSteps: 1,
      modeController: {
        getMode: () => 'plan',
        getPlanFilePath: () => 'plan.md',
        enterPlanMode: async () => ({ ok: true, content: 'entered' }),
        exitPlanMode: async () => ({ ok: true, content: 'exited' }),
      },
    });

    expect(
      requests[0].messages.some(
        (message) =>
          message.role === 'system' &&
          message.content.includes('Todo 使用策略'),
      ),
    ).toBe(false);
  });

  test('places todo policy after project context and mode prompt', async () => {
    const requests: ChatCompletionRequest[] = [];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return { content: 'done', toolCalls: [] };
      },
    };

    await runAgent({
      task: '帮我实现一个新功能',
      provider,
      tools: fakeRegistry(),
      maxSteps: 1,
      buildSystemContext: async () => 'Project context here',
      modeController: {
        getMode: () => 'normal',
        getPlanFilePath: () => 'plan.md',
        enterPlanMode: async () => ({ ok: true, content: 'entered' }),
        exitPlanMode: async () => ({ ok: true, content: 'exited' }),
      },
    });

    expect(requests[0].messages.slice(0, 3)).toEqual([
      { role: 'system', content: 'Project context here' },
      { role: 'system', content: expect.stringContaining('normal mode') },
      { role: 'system', content: expect.stringContaining('Todo 使用策略') },
    ]);
  });
```

- [ ] **Step 2: Run agent loop tests to verify RED**

Run:

```bash
pnpm.cmd test tests/agent-loop.test.ts
```

Expected: fail because `runAgent` does not inject todo policy prompt yet.

- [ ] **Step 3: Inject todo policy prompt in agent loop**

Modify `src/agent/loop.ts`.

Add import:

```ts
import { createTodoPolicyPrompt } from '../todos/policy.js';
```

In `buildSystemMessages(options, mode)`, after the existing mode prompt block, add:

```ts
  const todoPolicyPrompt = createTodoPolicyPrompt({
    task: options.task,
    mode,
  });
  if (todoPolicyPrompt) {
    /**
     * Todo 策略放在 mode prompt 后面：先确定当前模式是否允许执行，再补充 normal mode 下的进度维护习惯。
     */
    systemMessages.push({
      role: 'system',
      content: todoPolicyPrompt,
    });
  }
```

- [ ] **Step 4: Run agent loop tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/agent-loop.test.ts
```

Expected: pass.

### Task 3: Final Verification and Commit

**Files:**
- All changed files.

- [ ] **Step 1: Run focused V10 tests**

Run:

```bash
pnpm.cmd test tests/todo-policy.test.ts tests/agent-loop.test.ts
```

Expected: pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm.cmd test
```

Expected: all tests pass.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm.cmd build
```

Expected: TypeScript build exits 0.

- [ ] **Step 4: Review git diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; changed files are limited to:

```text
src/todos/policy.ts
src/agent/loop.ts
tests/todo-policy.test.ts
tests/agent-loop.test.ts
```

- [ ] **Step 5: Commit implementation**

Run:

```bash
git add -A
git commit -m "feat: add auto todo policy v10"
```

Expected: commit succeeds on `codex/auto-todo-policy-v10`.

## Self-Review

- Spec coverage: Task 1 covers policy decision and prompt generation; Task 2 covers `runAgent` system message integration and message ordering; Task 3 covers test/build verification and commit.
- Placeholder scan: no incomplete markers are intended in this plan.
- Type consistency: `shouldSuggestTodos(task: string): boolean` and `createTodoPolicyPrompt({ task, mode })` match the V10 design document and use existing `AgentMode`.
