# Project Context V5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每轮模型请求注入项目约定、README 摘要和 git 状态，让 agent 更接近 Claude Code 的项目感知能力。

**Architecture:** 新增 `src/context/projectContext.ts` 负责上下文读取和格式化；`runAgent` 通过 `buildSystemContext` 回调接收动态 system context；`cli.ts` 在 TUI 启动时创建上下文构建器并传入每轮任务。

**Tech Stack:** TypeScript、Node.js fs/promises、child_process execFile、Vitest、现有 OpenAI-compatible provider。

---

## 文件结构

- Create: `src/context/projectContext.ts`
  - 读取 `agent.md`、`AGENT.md`、`.agent.md`、`README.md`，执行 `git status --short`，格式化 system context。
- Create: `tests/project-context.test.ts`
  - 覆盖上下文文件读取、截断、缺失文件、git status 成功和失败。
- Modify: `src/agent/loop.ts`
  - 新增 `buildSystemContext` 选项，把项目上下文插入 provider request。
- Modify: `tests/agent-loop.test.ts`
  - 覆盖 project context 注入顺序和每轮重新构建。
- Modify: `src/cli.ts`
  - 创建 project context builder，并传给 TUI 运行的 `runAgent`。
- Modify: `agent.md`
  - 更新目录约定，新增 `src/context/` 职责说明。

## Task 1: 实现 project context builder

**Files:**
- Create: `src/context/projectContext.ts`
- Create: `tests/project-context.test.ts`

- [ ] **Step 1: 写失败测试：读取项目约定和 README**

创建 `tests/project-context.test.ts`：

```ts
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createProjectContextBuilder } from '../src/context/projectContext.js';

describe('createProjectContextBuilder', () => {
  test('includes project instruction files and README', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
    await writeFile(join(root, 'agent.md'), 'Agent rules', 'utf8');
    await writeFile(join(root, 'README.md'), '# Project', 'utf8');

    const build = createProjectContextBuilder({
      workspaceRoot: root,
      runGitStatus: async () => 'M src/app.ts',
    });

    await expect(build()).resolves.toContain('--- agent.md ---');
    await expect(build()).resolves.toContain('Agent rules');
    await expect(build()).resolves.toContain('--- README.md ---');
    await expect(build()).resolves.toContain('M src/app.ts');
  });
});
```

- [ ] **Step 2: 写失败测试：缺失文件被跳过**

添加：

```ts
test('skips missing context files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
  await writeFile(join(root, 'README.md'), '# Only README', 'utf8');

  const build = createProjectContextBuilder({
    workspaceRoot: root,
    runGitStatus: async () => '',
  });

  const context = await build();

  expect(context).toContain('--- README.md ---');
  expect(context).not.toContain('--- agent.md ---');
});
```

- [ ] **Step 3: 写失败测试：长文件截断**

添加：

```ts
test('truncates long context files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
  await writeFile(join(root, 'agent.md'), 'abcdef', 'utf8');

  const build = createProjectContextBuilder({
    workspaceRoot: root,
    maxFileChars: 3,
    runGitStatus: async () => '',
  });

  const context = await build();

  expect(context).toContain('abc');
  expect(context).toContain('[truncated: original length 6 chars, shown 3 chars]');
});
```

- [ ] **Step 4: 写失败测试：git status 失败不阻塞**

添加：

```ts
test('records unavailable git status without failing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
  const build = createProjectContextBuilder({
    workspaceRoot: root,
    runGitStatus: async () => {
      throw new Error('not a git repository');
    },
  });

  await expect(build()).resolves.toContain(
    'Git status:\n[unavailable: not a git repository]',
  );
});
```

- [ ] **Step 5: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/project-context.test.ts
```

Expected:

```text
FAIL tests/project-context.test.ts
```

失败原因应是 `src/context/projectContext.ts` 不存在。

- [ ] **Step 6: 实现 project context builder**

创建 `src/context/projectContext.ts`：

```ts
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PROJECT_CONTEXT_FILES = ['agent.md', 'AGENT.md', '.agent.md', 'README.md'];

export type ProjectContextOptions = {
  workspaceRoot: string;
  maxFileChars?: number;
  maxGitStatusChars?: number;
  readTextFile?: (path: string) => Promise<string>;
  runGitStatus?: (cwd: string) => Promise<string>;
};

export type BuildProjectContext = () => Promise<string>;

export function createProjectContextBuilder(
  options: ProjectContextOptions,
): BuildProjectContext {
  const maxFileChars = options.maxFileChars ?? 4_000;
  const maxGitStatusChars = options.maxGitStatusChars ?? 4_000;
  const readTextFile = options.readTextFile ?? ((path) => readFile(path, 'utf8'));
  const runGitStatus = options.runGitStatus ?? defaultRunGitStatus;

  return async () => {
    const sections: string[] = [
      'Project context:',
      '',
      'Workspace:',
      options.workspaceRoot,
      '',
      'Files:',
    ];

    for (const fileName of PROJECT_CONTEXT_FILES) {
      const filePath = join(options.workspaceRoot, fileName);
      if (!(await fileExists(filePath))) {
        continue;
      }

      sections.push('', `--- ${fileName} ---`);
      try {
        sections.push(truncateWithNotice(await readTextFile(filePath), maxFileChars));
      } catch (error) {
        sections.push(`[unavailable: ${errorMessage(error)}]`);
      }
    }

    sections.push('', 'Git status:');
    try {
      const gitStatus = await runGitStatus(options.workspaceRoot);
      sections.push(truncateWithNotice(gitStatus.trim() || '[clean]', maxGitStatusChars));
    } catch (error) {
      sections.push(`[unavailable: ${errorMessage(error)}]`);
    }

    return sections.join('\n');
  };
}

async function defaultRunGitStatus(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd });
  return stdout;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function truncateWithNotice(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n\n[truncated: original length ${content.length} chars, shown ${maxChars} chars]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 7: 验证 project context 测试通过**

Run:

```powershell
pnpm.cmd test tests/project-context.test.ts
```

Expected:

```text
1 test file passed
```

## Task 2: 在 agent loop 中注入 system context

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `tests/agent-loop.test.ts`

- [ ] **Step 1: 写失败测试：project context 作为第一条 system message**

在 `tests/agent-loop.test.ts` 添加：

```ts
test('prepends project system context to provider messages', async () => {
  const requests: ChatCompletionRequest[] = [];
  const provider: ChatProvider = {
    complete: async (request) => {
      requests.push(request);
      return { content: 'done', toolCalls: [] };
    },
  };

  await runAgent({
    task: 'Read project',
    provider,
    tools: fakeRegistry(),
    maxSteps: 1,
    buildSystemContext: async () => 'Project context here',
  });

  expect(requests[0].messages[0]).toEqual({
    role: 'system',
    content: 'Project context here',
  });
  expect(requests[0].messages[1]).toEqual({
    role: 'user',
    content: 'Read project',
  });
});
```

- [ ] **Step 2: 写失败测试：project context 在 mode prompt 前**

添加：

```ts
test('places project context before mode prompt', async () => {
  const requests: ChatCompletionRequest[] = [];
  const provider: ChatProvider = {
    complete: async (request) => {
      requests.push(request);
      return { content: 'done', toolCalls: [] };
    },
  };

  await runAgent({
    task: 'Plan',
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

  expect(requests[0].messages[0]).toEqual({
    role: 'system',
    content: 'Project context here',
  });
  expect(requests[0].messages[1]).toEqual({
    role: 'system',
    content: expect.stringContaining('normal mode'),
  });
});
```

- [ ] **Step 3: 写失败测试：每轮重新构建上下文**

添加：

```ts
test('rebuilds system context on each model step', async () => {
  const seenContexts: string[] = [];
  let calls = 0;
  const responses: ChatCompletionResponse[] = [
    {
      content: '',
      toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
    },
    { content: 'done', toolCalls: [] },
  ];
  const provider: ChatProvider = {
    complete: async (request) => {
      seenContexts.push(request.messages[0].content);
      return responses.shift()!;
    },
  };

  await runAgent({
    task: 'Read',
    provider,
    tools: fakeRegistry(),
    maxSteps: 2,
    buildSystemContext: async () => `context ${++calls}`,
  });

  expect(seenContexts).toEqual(['context 1', 'context 2']);
});
```

- [ ] **Step 4: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/agent-loop.test.ts
```

Expected:

```text
FAIL tests/agent-loop.test.ts
```

失败原因应是 `buildSystemContext` 类型不存在或 system message 未注入。

- [ ] **Step 5: 实现 runAgent 注入**

在 `RunAgentOptions` 中加入：

```ts
buildSystemContext?: () => Promise<string | undefined>;
```

在每轮请求前构造：

```ts
const systemMessages: ChatMessage[] = [];
const projectContext = await options.buildSystemContext?.();
if (projectContext?.trim()) {
  systemMessages.push({ role: 'system', content: projectContext });
}

if (options.modeController) {
  systemMessages.push({
    role: 'system',
    content: createModeSystemPrompt(
      mode,
      options.modeController.getPlanFilePath(),
    ),
  });
}

const requestMessages = [...systemMessages, ...messages];
```

替换当前只处理 mode prompt 的 `requestMessages` 逻辑。

- [ ] **Step 6: 验证 agent loop 测试通过**

Run:

```powershell
pnpm.cmd test tests/agent-loop.test.ts
```

Expected:

```text
1 test file passed
```

## Task 3: CLI / TUI 接入 project context

**Files:**
- Modify: `src/cli.ts`
- Modify: `agent.md`

- [ ] **Step 1: 在 CLI 创建上下文构建器**

在 `src/cli.ts` import：

```ts
import { createProjectContextBuilder } from './context/projectContext.js';
```

在 workspace 创建后加入：

```ts
const buildSystemContext = createProjectContextBuilder({
  workspaceRoot: workspace.root,
});
```

- [ ] **Step 2: 传给 runAgent**

在 TUI `runAgent({ ... })` options 中加入：

```ts
buildSystemContext,
```

- [ ] **Step 3: 更新 agent.md 目录说明**

在 `agent.md` 的当前目录约定中补充：

```text
src/
  context/
    projectContext.ts
```

在目录职责中补充：

```text
- `src/context/`：构造模型请求所需的项目上下文，例如项目约定文件、README 摘要和 git 状态；不直接执行工具。
```

- [ ] **Step 4: 验证构建**

Run:

```powershell
pnpm.cmd build
```

Expected:

```text
tsc -p tsconfig.json
```

exit code 为 `0`。

## Task 4: 全量验证

**Files:**
- No production files.

- [ ] **Step 1: 运行全量测试**

Run:

```powershell
pnpm.cmd test
```

Expected:

```text
Test Files 通过
Tests 通过
```

- [ ] **Step 2: 运行构建**

Run:

```powershell
pnpm.cmd build
```

Expected:

```text
tsc -p tsconfig.json
```

exit code 为 `0`。

- [ ] **Step 3: 手动烟测 TUI 启动**

Run:

```powershell
pnpm.cmd dev
```

Expected:

```text
Mini Code Agent
Session: ...
Mode: normal
Status: idle
```

输入：

```text
阅读 agent.md，总结项目约定
```

Expected:

```text
agent 能直接引用 agent.md 中的包管理、目录约定和中文注释规则
```

## 自审记录

- 规格覆盖：项目约定文件、README、git status、截断、缺失文件、非 git 错误、agent loop 注入、TUI 接入都有任务覆盖。
- 占位符扫描：本文档未包含未决占位内容。
- 类型一致性：`createProjectContextBuilder`、`BuildProjectContext`、`buildSystemContext` 命名在规格和任务中一致。
- 范围控制：V5 不做 compact、slash command、token 估算或递归扫描。

