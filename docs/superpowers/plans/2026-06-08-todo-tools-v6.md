# Todo Tools V6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 session 级 Todo / Task 进度工具，让 agent 能读写任务清单，并让 TUI 展示当前任务进度。

**Architecture:** 新增 `src/todos/store.ts` 负责 todo JSON 持久化；新增 `src/tools/todoTools.ts` 暴露 `todo_read` 和 `todo_write`；`registryForMode` 在 normal/plan 都注册工具；CLI 创建 todo store 并传给 registry 与 TUI；TUI 在 `todo_write` 成功后刷新摘要。

**Tech Stack:** TypeScript、Node.js `fs/promises`、zod、Vitest、Ink/React TUI。

---

## 文件结构

- Create: `src/todos/store.ts`
  - 定义 `TodoItem`、`TodoStatus`、`TodoStore`、`TodoSummary`。
  - 基于 `sessionId` 读写 `~/.mini-code-agent/todos/<sessionId>.json`。
  - 提供 `summarizeTodos()`。
- Create: `tests/todo-store.test.ts`
  - 覆盖缺失文件、写入读回、损坏 JSON、摘要计算。
- Create: `src/tools/todoTools.ts`
  - 提供 `createTodoReadTool(todoStore)` 和 `createTodoWriteTool(todoStore)`。
- Create: `tests/todo-tools.test.ts`
  - 覆盖工具读写和 schema 校验。
- Modify: `src/tools/registryForMode.ts`
  - 新增 `todoStore` 参数，并在 normal/plan 注册 todo 工具。
- Modify: `tests/registry-for-mode.test.ts`
  - 验证两种模式都暴露 `todo_read` 和 `todo_write`。
- Modify: `src/ui/types.ts`
  - 导入或定义 TUI 可消费的 todo 摘要类型。
- Modify: `src/ui/useAgentRunner.ts`
  - 在 `todo_write` 成功后调用 `refreshTodos()`。
- Modify: `tests/ui-runner.test.ts`
  - 验证 todo 更新刷新逻辑。
- Modify: `src/ui/App.tsx`
  - 展示 todo 摘要。
- Modify: `src/ui/renderTui.tsx`
  - 传递 todo 摘要读取函数。
- Modify: `src/cli.ts`
  - 创建 todo store，传给 registry 和 TUI。
- Modify: `agent.md`
  - 更新目录约定，新增 `src/todos/` 职责。

## Task 1: Todo Store

**Files:**
- Create: `tests/todo-store.test.ts`
- Create: `src/todos/store.ts`

- [ ] **Step 1: 写失败测试：缺失文件返回空列表**

创建 `tests/todo-store.test.ts`：

```ts
import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createTodoStore, summarizeTodos } from '../src/todos/store.js';

describe('todo store', () => {
  test('returns an empty list when the todo file is missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-todos-'));
    const store = createTodoStore({ sessionId: 'session-a', home });

    await expect(store.read()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/todo-store.test.ts
```

Expected:

```text
FAIL tests/todo-store.test.ts
Cannot find module '../src/todos/store.js'
```

- [ ] **Step 3: 实现最小 Todo Store**

创建 `src/todos/store.ts`：

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ToolResult } from '../tools/types.js';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

export type TodoSummary = {
  pending: number;
  inProgress: number;
  completed: number;
  current: string | undefined;
};

export type TodoStore = {
  filePath: string;
  read(): Promise<TodoItem[]>;
  write(items: TodoItem[]): Promise<ToolResult>;
};

export function createTodoStore(options: {
  sessionId: string;
  home?: string;
}): TodoStore {
  const filePath = getTodoFilePath(options.sessionId, options.home);

  return {
    filePath,
    async read() {
      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error('Todo file must contain a JSON array');
        }

        return parsed as TodoItem[];
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return [];
        }

        throw new Error(`Failed to read todo file ${filePath}: ${errorMessage(error)}`);
      }
    },
    async write(items) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
      return {
        ok: true,
        content: `Wrote ${items.length} todos to ${filePath}`,
      };
    },
  };
}

export function getTodoFilePath(sessionId: string, home = homedir()): string {
  return join(home, '.mini-code-agent', 'todos', `${sessionId}.json`);
}

export function summarizeTodos(items: TodoItem[]): TodoSummary {
  const summary: TodoSummary = {
    pending: 0,
    inProgress: 0,
    completed: 0,
    current: undefined,
  };

  for (const item of items) {
    if (item.status === 'pending') summary.pending += 1;
    if (item.status === 'in_progress') {
      summary.inProgress += 1;
      summary.current ??= item.content;
    }
    if (item.status === 'completed') summary.completed += 1;
  }

  return summary;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: 验证缺失文件测试通过**

Run:

```powershell
pnpm.cmd test tests/todo-store.test.ts
```

Expected:

```text
1 test file passed
```

- [ ] **Step 5: 补充 store 行为测试**

在 `tests/todo-store.test.ts` 中追加：

```ts
test('writes and reads todos', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mini-agent-todos-'));
  const store = createTodoStore({ sessionId: 'session-a', home });

  await store.write([
    { id: '1', content: '实现 store', status: 'completed' },
    { id: '2', content: '实现工具', status: 'in_progress' },
  ]);

  await expect(store.read()).resolves.toEqual([
    { id: '1', content: '实现 store', status: 'completed' },
    { id: '2', content: '实现工具', status: 'in_progress' },
  ]);
});

test('reports malformed todo JSON', async () => {
  const home = mkdtempSync(join(tmpdir(), 'mini-agent-todos-'));
  const store = createTodoStore({ sessionId: 'session-a', home });
  await store.write([]);
  await writeFile(store.filePath, '{broken', 'utf8');

  await expect(store.read()).rejects.toThrow('Failed to read todo file');
});

test('summarizes todo status counts and current task', () => {
  expect(
    summarizeTodos([
      { id: '1', content: '完成 A', status: 'completed' },
      { id: '2', content: '正在做 B', status: 'in_progress' },
      { id: '3', content: '等待 C', status: 'pending' },
    ]),
  ).toEqual({
    pending: 1,
    inProgress: 1,
    completed: 1,
    current: '正在做 B',
  });
});
```

- [ ] **Step 6: 如测试失败，修正目录创建测试写法**

如果 `reports malformed todo JSON` 因目录不存在失败，把测试改成先调用 `await store.write([])`，再覆写 `store.filePath`。

- [ ] **Step 7: 运行 Todo Store 测试**

Run:

```powershell
pnpm.cmd test tests/todo-store.test.ts
```

Expected:

```text
4 tests passed
```

## Task 2: Todo 工具

**Files:**
- Create: `src/tools/todoTools.ts`
- Create: `tests/todo-tools.test.ts`

- [ ] **Step 1: 写失败测试：todo_read 读取列表**

创建 `tests/todo-tools.test.ts`：

```ts
import { describe, expect, test } from 'vitest';
import { createToolRegistry } from '../src/tools/index.js';
import { createTodoReadTool, createTodoWriteTool } from '../src/tools/todoTools.js';
import type { TodoItem, TodoStore } from '../src/todos/store.js';
import type { ToolContext, ToolResult } from '../src/tools/types.js';

function fakeTodoStore(initial: TodoItem[] = []): TodoStore {
  let items = initial;

  return {
    filePath: 'todos.json',
    read: async () => items,
    write: async (next) => {
      items = next;
      return { ok: true, content: `Wrote ${next.length} todos` };
    },
  };
}

function fakeContext(): ToolContext {
  return {} as ToolContext;
}

describe('todo tools', () => {
  test('todo_read returns the current todo list', async () => {
    const registry = createToolRegistry(
      [
        createTodoReadTool(
          fakeTodoStore([{ id: '1', content: '读任务', status: 'pending' }]),
        ),
      ],
      fakeContext(),
    );

    const result = await registry.execute('todo_read', {});

    expect(result).toEqual({
      ok: true,
      content: JSON.stringify(
        [{ id: '1', content: '读任务', status: 'pending' }],
        null,
        2,
      ),
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/todo-tools.test.ts
```

Expected:

```text
FAIL tests/todo-tools.test.ts
Cannot find module '../src/tools/todoTools.js'
```

- [ ] **Step 3: 实现 todo 工具**

创建 `src/tools/todoTools.ts`：

```ts
import { z } from 'zod';
import type { TodoStore } from '../todos/store.js';
import type { ToolDefinition } from './types.js';

const todoStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

const todoItemSchema = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1),
  status: todoStatusSchema,
});

const todoReadInput = z.object({});

const todoWriteInput = z.object({
  todos: z.array(todoItemSchema),
});

export function createTodoReadTool(todoStore: TodoStore): ToolDefinition<typeof todoReadInput> {
  return {
    name: 'todo_read',
    description: 'Read the current session todo list before updating task progress.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    inputSchema: todoReadInput,
    async execute() {
      return {
        ok: true,
        content: JSON.stringify(await todoStore.read(), null, 2),
      };
    },
  };
}

export function createTodoWriteTool(todoStore: TodoStore): ToolDefinition<typeof todoWriteInput> {
  return {
    name: 'todo_write',
    description:
      'Replace the current session todo list. Use pending, in_progress, and completed to track multi-step work.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
              },
            },
            required: ['id', 'content', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['todos'],
      additionalProperties: false,
    },
    inputSchema: todoWriteInput,
    async execute(input) {
      /**
       * V6 采用整体替换，避免模型在多轮局部更新中把旧状态和新状态合并错。
       */
      const result = await todoStore.write(input.todos);
      if (!result.ok) return result;

      return {
        ok: true,
        content: `${result.content}; summary: ${summarizeForTool(input.todos)}`,
      };
    },
  };
}

function summarizeForTool(items: Array<{ status: string }>): string {
  const pending = items.filter((item) => item.status === 'pending').length;
  const inProgress = items.filter((item) => item.status === 'in_progress').length;
  const completed = items.filter((item) => item.status === 'completed').length;
  return `${inProgress} in_progress / ${pending} pending / ${completed} completed`;
}
```

- [ ] **Step 4: 验证 todo_read 测试通过**

Run:

```powershell
pnpm.cmd test tests/todo-tools.test.ts
```

Expected:

```text
1 test passed
```

- [ ] **Step 5: 补充 todo_write 和校验测试**

在 `tests/todo-tools.test.ts` 中追加：

```ts
test('todo_write replaces the todo list', async () => {
  const store = fakeTodoStore();
  const registry = createToolRegistry(
    [createTodoWriteTool(store), createTodoReadTool(store)],
    fakeContext(),
  );

  const result = await registry.execute('todo_write', {
    todos: [{ id: '1', content: '写工具', status: 'in_progress' }],
  });

  expect(result.ok).toBe(true);
  expect(result.content).toContain('1 in_progress / 0 pending / 0 completed');
  await expect(registry.execute('todo_read', {})).resolves.toEqual({
    ok: true,
    content: JSON.stringify(
      [{ id: '1', content: '写工具', status: 'in_progress' }],
      null,
      2,
    ),
  });
});

test('todo_write rejects invalid todo status', async () => {
  const registry = createToolRegistry([createTodoWriteTool(fakeTodoStore())], fakeContext());

  const result = await registry.execute('todo_write', {
    todos: [{ id: '1', content: '坏状态', status: 'doing' }],
  });

  expect(result.ok).toBe(false);
  expect(result.error).toContain('Invalid input for todo_write');
});

test('todo_write rejects empty id and content', async () => {
  const registry = createToolRegistry([createTodoWriteTool(fakeTodoStore())], fakeContext());

  const result = await registry.execute('todo_write', {
    todos: [{ id: '', content: '', status: 'pending' }],
  });

  expect(result.ok).toBe(false);
  expect(result.error).toContain('Invalid input for todo_write');
});
```

- [ ] **Step 6: 运行 todo 工具测试**

Run:

```powershell
pnpm.cmd test tests/todo-tools.test.ts
```

Expected:

```text
4 tests passed
```

## Task 3: 工具注册与 CLI 接入

**Files:**
- Modify: `src/tools/registryForMode.ts`
- Modify: `tests/registry-for-mode.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: 写失败测试：normal/plan 都暴露 todo 工具**

修改 `tests/registry-for-mode.test.ts`，让 `createRegistryForMode` 测试传入 fake todo store，并在两个模式的工具名断言中加入：

```ts
'todo_read',
'todo_write',
```

新增 helper：

```ts
function fakeTodoStore() {
  return {
    filePath: 'todos.json',
    read: async () => [],
    write: async () => ({ ok: true as const, content: 'ok' }),
  };
}
```

每次调用 `createRegistryForMode` 时传入：

```ts
todoStore: fakeTodoStore(),
```

- [ ] **Step 2: 运行 registry 测试确认失败**

Run:

```powershell
pnpm.cmd test tests/registry-for-mode.test.ts
```

Expected:

```text
FAIL tests/registry-for-mode.test.ts
```

失败原因应是 `todoStore` 参数不存在或工具列表不包含 todo 工具。

- [ ] **Step 3: 修改 registryForMode**

在 `src/tools/registryForMode.ts` 中：

```ts
import type { TodoStore } from '../todos/store.js';
import { createTodoReadTool, createTodoWriteTool } from './todoTools.js';
```

options 增加：

```ts
todoStore: TodoStore;
```

shared 改成：

```ts
const shared = [
  readFileTool,
  searchFilesTool,
  createTodoReadTool(options.todoStore),
  createTodoWriteTool(options.todoStore),
];
```

- [ ] **Step 4: 修改 CLI 创建并传入 todo store**

在 `src/cli.ts` 中导入：

```ts
import { createTodoStore, summarizeTodos } from './todos/store.js';
```

创建 session 后添加：

```ts
const todoStore = createTodoStore({ sessionId: session.sessionId });
```

调用 `createRegistryForMode` 时添加：

```ts
todoStore,
```

`renderTui` 参数先暂不接 todo 展示，Task 4 再处理。

- [ ] **Step 5: 运行 registry 测试和 build**

Run:

```powershell
pnpm.cmd test tests/registry-for-mode.test.ts
pnpm.cmd build
```

Expected:

```text
registry-for-mode.test.ts passed
tsc exit code 0
```

## Task 4: TUI Todo 摘要展示与刷新

**Files:**
- Modify: `src/ui/types.ts`
- Modify: `src/ui/useAgentRunner.ts`
- Modify: `tests/ui-runner.test.ts`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/renderTui.tsx`
- Modify: `src/cli.ts`

- [ ] **Step 1: 写失败测试：todo_write 成功后刷新摘要**

修改 `tests/ui-runner.test.ts`，新增测试：

```ts
test('refreshes todos after successful todo_write tool result', async () => {
  let refreshed = 0;
  const messages: TuiMessage[] = [];
  const runner = createAgentRunner({
    appendMessage: (message) => messages.push(message),
    refreshTodos: async () => {
      refreshed += 1;
    },
    runAgent: async ({ onEvent }) => {
      onEvent?.({
        type: 'tool_result',
        name: 'todo_write',
        result: { ok: true, content: 'Wrote 1 todos' },
      });
      return 'done';
    },
  });

  await runner.run('更新任务');

  expect(refreshed).toBe(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/ui-runner.test.ts
```

Expected:

```text
FAIL tests/ui-runner.test.ts
```

失败原因应是 `refreshTodos` 选项不存在。

- [ ] **Step 3: 修改 useAgentRunner**

在 `CreateAgentRunnerOptions` 中增加：

```ts
refreshTodos?: () => Promise<void>;
```

在 `run()` 内部创建刷新队列：

```ts
const pendingRefreshes: Promise<void>[] = [];
```

传给 `runAgent` 的 `onEvent` 保持同步，并在收到事件时收集刷新 Promise：

```ts
onEvent: (event) => {
  appendEventMessage(options.appendMessage, event);
  pendingRefreshes.push(maybeRefreshTodos(options, event));
},
```

`await options.runAgent(...)` 之后，在 `finally` 之前等待刷新完成：

```ts
await Promise.all(pendingRefreshes);
```

新增 helper。刷新失败不应让 agent 结果丢失，只追加一条错误消息：

```ts
async function maybeRefreshTodos(
  options: CreateAgentRunnerOptions,
  event: AgentRunEvent,
): Promise<void> {
  if (event.type !== 'tool_result' || event.name !== 'todo_write' || !event.result.ok) {
    return;
  }

  try {
    await options.refreshTodos?.();
  } catch (error) {
    options.appendMessage({
      role: 'error',
      content: `Todo 刷新失败：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
```

- [ ] **Step 4: 补充非 todo 和失败结果不刷新测试**

在 `tests/ui-runner.test.ts` 增加两个断言：

```ts
test('does not refresh todos for non-todo tool results', async () => {
  let refreshed = 0;
  const runner = createAgentRunner({
    appendMessage: () => {},
    refreshTodos: async () => {
      refreshed += 1;
    },
    runAgent: async ({ onEvent }) => {
      onEvent?.({
        type: 'tool_result',
        name: 'read_file',
        result: { ok: true, content: 'file' },
      });
      return 'done';
    },
  });

  await runner.run('读文件');

  expect(refreshed).toBe(0);
});

test('does not refresh todos when todo_write fails', async () => {
  let refreshed = 0;
  const runner = createAgentRunner({
    appendMessage: () => {},
    refreshTodos: async () => {
      refreshed += 1;
    },
    runAgent: async ({ onEvent }) => {
      onEvent?.({
        type: 'tool_result',
        name: 'todo_write',
        result: { ok: false, error: 'bad input' },
      });
      return 'done';
    },
  });

  await runner.run('坏任务');

  expect(refreshed).toBe(0);
});
```

- [ ] **Step 5: 修改 TUI 类型和组件展示**

在 `src/ui/types.ts` 增加：

```ts
export type TuiTodoSummary =
  | {
      available: true;
      pending: number;
      inProgress: number;
      completed: number;
      current: string | undefined;
    }
  | {
      available: false;
      error: string;
    };
```

在 `AppProps` 增加第三个 `runTask` 参数和摘要读取函数：

```ts
runTask(
  task: string,
  appendMessage: (message: TuiMessage) => void,
  refreshTodos: () => Promise<void>,
): Promise<void>;

loadTodoSummary(): Promise<TuiTodoSummary>;
```

`App` 从 React 导入 `useEffect`，增加 `todoSummary` state：

```ts
const [todoSummary, setTodoSummary] = useState<TuiTodoSummary | undefined>();
const refreshTodos = async () => {
  setTodoSummary(await props.loadTodoSummary());
};

useEffect(() => {
  void refreshTodos();
}, []);
```

提交任务时传入刷新函数：

```ts
props.runTask(task, appendMessage, refreshTodos)
```

展示：

```tsx
<Text>{formatTodoSummary(todoSummary)}</Text>
```

新增格式化函数：

```ts
function formatTodoSummary(summary: TuiTodoSummary | undefined): string {
  if (!summary) return 'Todos: loading';
  if (!summary.available) return `Todos: unavailable (${summary.error})`;

  const current = summary.current ? ` Current: ${summary.current}` : '';
  return `Todos: ${summary.inProgress} in_progress / ${summary.pending} pending / ${summary.completed} completed${current}`;
}
```

- [ ] **Step 6: 修改 renderTui 和 CLI**

`src/ui/renderTui.tsx` 的 options 增加：

```ts
loadTodoSummary(): Promise<TuiTodoSummary>;
```

传给 `App`。

`src/cli.ts` 中创建：

```ts
const loadTodoSummary = async () => {
  try {
    return {
      available: true as const,
      ...summarizeTodos(await todoStore.read()),
    };
  } catch (error) {
    return {
      available: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
```

传给 `renderTui`：

```ts
loadTodoSummary,
```

扩展 `runTask` 签名：

```ts
runTask(task, appendMessage, refreshTodos)
```

CLI 创建 runner 时把 `refreshTodos` 传给 `createAgentRunner`：

```ts
const runner = createAgentRunner({
  appendMessage,
  refreshTodos,
  runAgent: async ({ task, onEvent }) =>
    runAgent({
      task,
      initialMessages: conversationMessages,
      provider,
      toolsForMode: (mode) =>
        createRegistryForMode({
          mode,
          context: toolContext,
          modeController,
          planStore,
          todoStore,
        }),
      modeController,
      maxSteps: config.maxSteps,
      sessionId: session.sessionId,
      recordTranscriptEntry,
      buildSystemContext,
      onEvent,
    }),
});
```

- [ ] **Step 7: 运行 TUI runner 测试和 build**

Run:

```powershell
pnpm.cmd test tests/ui-runner.test.ts
pnpm.cmd build
```

Expected:

```text
ui-runner.test.ts passed
tsc exit code 0
```

## Task 5: 文档与全量验证

**Files:**
- Modify: `agent.md`

- [ ] **Step 1: 更新 agent.md 目录约定**

在当前目录结构中加入：

```text
  todos/
    store.ts
```

目录职责增加：

```md
- `src/todos/`：维护 session 级任务清单状态，例如 todo 读写、摘要计算和后续任务进度上下文；不直接调用模型。
```

- [ ] **Step 2: 全量测试**

Run:

```powershell
pnpm.cmd test
```

Expected:

```text
Test Files 通过
Tests 通过
```

- [ ] **Step 3: 构建验证**

Run:

```powershell
pnpm.cmd build
```

Expected:

```text
tsc -p tsconfig.json
```

exit code 为 `0`。

- [ ] **Step 4: CLI 冒烟验证**

Run:

```powershell
pnpm.cmd dev -- --help
```

Expected:

```text
mini-code-agent
Usage:
  mini-code-agent
  pnpm.cmd dev
```

## 自审记录

- 规格覆盖：持久化、`todo_read`、`todo_write`、normal/plan 注册、TUI 摘要、更新刷新、错误处理都有对应任务。
- 完整性扫描：计划中没有未完成标记、未解释的“后续实现”或模糊测试要求。
- 类型一致性：`TodoItem`、`TodoStatus`、`TodoStore`、`TodoSummary`、`TuiTodoSummary` 命名在任务中保持一致。
- 范围控制：没有引入 compact、slash command、复杂 TUI 面板或跨 session todo。
