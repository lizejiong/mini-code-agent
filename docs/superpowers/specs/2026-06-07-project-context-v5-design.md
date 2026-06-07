# V5 项目上下文注入设计文档

## 背景

当前项目已经完成：

- V1：基础 agent loop、本地工具、权限确认。
- V2：session transcript 与 resume。
- V3：plan mode。
- V4：简易交互式 TUI。

现在的 agent 仍然有一个核心缺口：模型每轮请求主要只看到用户输入、会话历史和 mode prompt，不会自动知道项目约定、README、当前 git 状态等上下文。Claude Code 的核心能力之一就是每轮请求前构造系统上下文，让模型知道当前项目、工作区状态和用户约定。V5 做学习版“项目上下文注入”。

## 目标

- 每次模型请求前注入项目上下文 system message。
- 自动读取项目约定文件：
  - `agent.md`
  - `AGENT.md`
  - `.agent.md`
- 自动读取 `README.md` 摘要。
- 自动注入 `git status --short`。
- 对每个文件内容做字符数截断，避免上下文过大。
- 缺失文件不报错，直接跳过。
- 非 git 仓库或 git 不可用时不阻塞 agent，写入明确的上下文说明。
- 保持 `runAgent` 与上下文收集解耦：agent loop 只调用一个 `buildSystemContext()` 回调，不直接读文件或执行 git。
- TUI 每轮任务复用同一套上下文构建器。

## 非目标

- 不做自动 compact。
- 不做 token 级预算估算，只用字符数上限。
- 不递归扫描目录。
- 不读取任意用户 home 配置。
- 不做团队记忆、远程记忆或 MCP context。
- 不做 `/context` 命令。
- 不把上下文写入 transcript。它是每轮动态生成的系统上下文，不属于用户/assistant 对话历史。

## 参考 Claude Code 的取舍

Claude Code 中能看到 `context.ts`、`commands/context`、`utils/contextAnalysis`、`CLAUDE.md` 注入、git 状态和 context usage 等复杂能力。V5 只抽取最核心的学习点：

```text
项目约定 + README + git status -> system context -> 每轮模型请求
```

这样可以先学会“上下文构造层”这个边界，再逐步扩展到 compact、context usage、slash command 和记忆系统。

## 上下文内容格式

注入为一条 system message，放在 mode prompt 前面：

```text
Project context:

Workspace:
D:\code\coding\mini-code-agent

Files:

--- agent.md ---
...

--- README.md ---
...

Git status:
M src/example.ts
?? notes.md
```

如果文件被截断：

```text
--- agent.md ---
<前 4000 字符>

[truncated: original length 12000 chars, shown 4000 chars]
```

如果 git 不可用：

```text
Git status:
[unavailable: not a git repository]
```

## 模块设计

新增目录：

```text
src/
  context/
    projectContext.ts
```

职责：

- `src/context/projectContext.ts` 只负责读取当前 workspace 的项目上下文并格式化为 system prompt。
- `src/agent/loop.ts` 只负责在每轮 provider request 前调用上下文回调。
- `src/cli.ts` 创建上下文构建器，并传给 `runAgent`。

核心类型：

```ts
export type ProjectContextOptions = {
  workspaceRoot: string;
  maxFileChars?: number;
  maxGitStatusChars?: number;
  readTextFile?: (path: string) => Promise<string>;
  runGitStatus?: (cwd: string) => Promise<string>;
};

export type BuildProjectContext = () => Promise<string>;
```

默认候选文件：

```ts
const PROJECT_CONTEXT_FILES = ['agent.md', 'AGENT.md', '.agent.md', 'README.md'];
```

## Agent Loop 集成

`RunAgentOptions` 新增：

```ts
buildSystemContext?: () => Promise<string | undefined>;
```

每轮请求前：

1. 调用 `buildSystemContext()`。
2. 如果返回非空字符串，把它作为第一条 system message。
3. 如果当前有 mode controller，再追加 mode system prompt。
4. 最后追加会话消息。

顺序：

```text
project context system message
mode system message
conversation messages
```

这样设计的原因：

- 项目上下文是更稳定的背景。
- mode prompt 是当前运行状态约束，靠近用户/工具消息更容易约束当前行为。

## TUI 集成

`src/cli.ts` 创建：

```ts
const buildSystemContext = createProjectContextBuilder({
  workspaceRoot: workspace.root,
});
```

每次 TUI 用户提交任务时，传给 `runAgent`：

```ts
buildSystemContext,
```

因为 `buildSystemContext` 在 agent loop 每轮调用，所以工具修改文件后，下一轮 git status 可以反映新的工作区状态。

## 错误处理

- 文件不存在：跳过。
- 文件读取失败：在对应文件段落写入 `[unavailable: <message>]`，不让整个 agent 失败。
- git 命令失败：写入 `[unavailable: <message>]`。
- 上下文构建器自身抛出异常：`runAgent` 不吞掉异常；这属于 V5 的实现 bug，应通过测试覆盖。

## 测试策略

- `projectContext` 测试：
  - 读取存在的 `agent.md` 和 `README.md`。
  - 跳过缺失文件。
  - 文件内容超过上限时截断并标注。
  - git status 正常输出时进入上下文。
  - git status 失败时上下文包含 unavailable。
- `agent-loop` 测试：
  - `buildSystemContext` 返回内容时，请求消息第一条是 system context。
  - mode prompt 和 project context 同时存在时，顺序正确。
  - 每轮都会重新调用 `buildSystemContext`。
- `cli` 集成通过类型和构建验证。

## 后续演进

V5 完成后，建议：

- V6：Todo / Task 进度工具。
- V7：上下文 compact 简易版。
- V8：TUI 内 `/context` 命令，显示当前上下文来源与大小。
- V9：权限规则增强。

