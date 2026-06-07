# Session History Resume V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为 mini-code-agent 增加本地 JSONL 会话历史、`--continue`、`--resume <sessionId>` 和 `--no-session-persistence`。

**Architecture:** 会话能力拆到 `src/sessions`，路径计算、JSONL transcript 和恢复策略彼此独立。`runAgent` 只接收历史消息和 transcript 写入回调，CLI 负责把参数解析结果组装成具体会话上下文。

**Tech Stack:** Node.js 18+、TypeScript ESM、Vitest、`node:fs/promises`、`node:os`、`node:path`、`node:crypto`。

---

## 文件结构

- Create: `src/sessions/ids.ts`，负责生成和校验 `sessionId`。
- Create: `src/sessions/paths.ts`，负责 `~/.mini-code-agent/projects/<sanitized-cwd>/<sessionId>.jsonl` 路径计算。
- Create: `src/sessions/transcript.ts`，负责 JSONL 追加、读取、按时间排序、transcript 到 `ChatMessage[]` 转换。
- Create: `src/sessions/resume.ts`，负责根据 CLI 参数决定新建、继续、恢复或禁用持久化。
- Modify: `src/cliArgs.ts`，增加 `--continue`、`--resume <id>`、`--no-session-persistence`。
- Modify: `src/agent/loop.ts`，增加历史消息输入和 transcript 记录回调。
- Modify: `src/cli.ts`，连接 CLI 参数、会话恢复、agent loop 和输出。
- Test: `tests/session-ids.test.ts`、`tests/session-paths.test.ts`、`tests/session-transcript.test.ts`、`tests/session-resume.test.ts`、`tests/agent-loop.test.ts`、`tests/cli-args.test.ts`。

### Task 1: CLI 参数解析

- [x] **Step 1: 写失败测试**

在 `tests/cli-args.test.ts` 增加：

```ts
test('parses session resume flags while preserving the task text', () => {
  expect(parseCliArgs(['--continue', 'next', 'step'])).toEqual({
    help: false,
    task: 'next step',
    continueLatest: true,
    resumeSessionId: undefined,
    sessionPersistence: true,
  });

  expect(parseCliArgs(['--resume', 'abc-123', 'fix', 'tests'])).toEqual({
    help: false,
    task: 'fix tests',
    continueLatest: false,
    resumeSessionId: 'abc-123',
    sessionPersistence: true,
  });

  expect(parseCliArgs(['--no-session-persistence', 'one-off'])).toEqual({
    help: false,
    task: 'one-off',
    continueLatest: false,
    resumeSessionId: undefined,
    sessionPersistence: false,
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm.cmd test tests/cli-args.test.ts`

Expected: FAIL，断言缺少新增字段或任务文本错误。

- [x] **Step 3: 实现最小解析逻辑**

修改 `src/cliArgs.ts`：过滤 `--` 后逐项消费参数，识别三类 session flag，把剩余参数拼成 `task`。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm.cmd test tests/cli-args.test.ts`

Expected: PASS。

### Task 2: sessionId 与路径

- [x] **Step 1: 写失败测试**

新增 `tests/session-ids.test.ts` 和 `tests/session-paths.test.ts`，覆盖：

```ts
expect(createSessionId()).toMatch(/^[0-9a-f-]{36}$/);
expect(isSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
expect(isSessionId('abc/def')).toBe(false);
```

```ts
const home = join(tmpdir(), 'mini-agent-home-test');
const cwd = join('D:\\code\\coding', 'mini-code-agent');
const projectDir = getProjectSessionsDir(cwd, home);
expect(projectDir).toContain(join(home, '.mini-code-agent', 'projects'));
expect(projectDir).toMatch(/[a-f0-9]{10}$/);
expect(getSessionFilePath(cwd, '550e8400-e29b-41d4-a716-446655440000', home)).toBe(
  join(projectDir, '550e8400-e29b-41d4-a716-446655440000.jsonl'),
);
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm.cmd test tests/session-ids.test.ts tests/session-paths.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 3: 实现 `ids.ts` 和 `paths.ts`**

实现 `createSessionId`、`isSessionId`、`getSessionsHome`、`getProjectSessionsDir`、`getSessionFilePath`。路径目录名使用安全前缀加 SHA-1 短哈希。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm.cmd test tests/session-ids.test.ts tests/session-paths.test.ts`

Expected: PASS。

### Task 3: JSONL transcript

- [x] **Step 1: 写失败测试**

新增 `tests/session-transcript.test.ts`，覆盖：

- 追加两条 entry 后能按顺序读回。
- 空行会被跳过。
- 损坏 JSON 行会报包含行号的错误。
- `transcriptEntriesToMessages` 能把 user、assistant、tool 转为 `ChatMessage[]`。
- `listSessionFilesNewestFirst` 按 mtime 从新到旧排序。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm.cmd test tests/session-transcript.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 3: 实现 `transcript.ts`**

实现 `TranscriptEntry` union、`appendTranscriptEntry`、`readTranscriptEntries`、`transcriptEntriesToMessages`、`listSessionFilesNewestFirst`。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm.cmd test tests/session-transcript.test.ts`

Expected: PASS。

### Task 4: 恢复策略

- [x] **Step 1: 写失败测试**

新增 `tests/session-resume.test.ts`，覆盖：

- 默认新建 session 并返回 transcript 路径。
- `sessionPersistence: false` 返回新 session，但没有 transcript 路径和历史消息。
- `continueLatest: true` 读取最新 `.jsonl`。
- `resumeSessionId` 读取指定 `.jsonl`。
- 当前项目没有会话时 `--continue` 抛出明确错误。
- 指定 session 不存在时 `--resume` 抛出明确错误。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm.cmd test tests/session-resume.test.ts`

Expected: FAIL，模块不存在。

- [x] **Step 3: 实现 `resume.ts`**

实现 `resolveSessionStart`，返回 `{ sessionId, transcriptPath, entries, initialMessages, mode, persistenceEnabled }`。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm.cmd test tests/session-resume.test.ts`

Expected: PASS。

### Task 5: agent loop 记录 transcript

- [x] **Step 1: 写失败测试**

扩展 `tests/agent-loop.test.ts`，覆盖：

- `initialMessages` 会排在新用户任务之前。
- `recordTranscriptEntry` 会依次记录 user、assistant、tool、最终 assistant。
- 工具结果 transcript 保留结构化 `ToolResult`，传给模型时仍是 JSON 字符串。

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm.cmd test tests/agent-loop.test.ts`

Expected: FAIL，`runAgent` 不支持新增选项。

- [x] **Step 3: 修改 `src/agent/loop.ts`**

给 `RunAgentOptions` 增加 `initialMessages?: ChatMessage[]`、`sessionId?: string`、`recordTranscriptEntry?: (entry: TranscriptEntry) => Promise<void>`。在用户消息、每次 assistant 响应、每个工具结果处调用记录回调。

- [x] **Step 4: 运行测试确认通过**

Run: `pnpm.cmd test tests/agent-loop.test.ts`

Expected: PASS。

### Task 6: CLI 接入

- [x] **Step 1: 写失败测试或最小集成验证**

由于 CLI 当前直接连接真实 provider，不新增复杂 mock CLI 测试。通过已有单元测试覆盖参数、恢复和 agent loop，最后用 `pnpm.cmd dev -- --help` 验证帮助文本。

- [x] **Step 2: 修改 `src/cli.ts`**

在创建 provider 前调用 `resolveSessionStart`。输出 `Session: <sessionId>`。把 `initialMessages` 和 `appendTranscriptEntry` 传给 `runAgent`。帮助文本补充 session flags。

- [x] **Step 3: 运行全量验证**

Run:

```text
pnpm.cmd test
pnpm.cmd build
pnpm.cmd dev -- --help
```

Expected: 全部成功，帮助文本显示 `--continue`、`--resume <sessionId>`、`--no-session-persistence`。

## 自检

- 规格覆盖：设计文档中的目标都有对应 Task，非目标没有进入实现任务。
- 占位扫描：没有未完成占位词或空泛步骤。
- 类型一致性：`TranscriptEntry`、`ChatMessage`、`ToolResult` 在设计、计划和任务中命名一致。
