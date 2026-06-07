# V4 简易交互式 TUI 设计文档

## 背景

当前项目已经具备最小 code agent 能力：

- V1：命令行任务、模型调用、本地工具、权限确认。
- V2：JSONL 会话历史与 resume。
- V3：plan mode，支持先规划、经用户批准、再执行。
- V3.5：`edit_file` 局部编辑工具。

参考 `D:\code\coding\claude-code-sourcemap` 后，可以看到 Claude Code 的重要体验不是只靠一次性命令，而是一个持续运行的交互式终端应用：用户可以连续输入任务，界面展示会话状态、工具活动、权限确认和最终回答。

V4 做学习版简易 TUI，不追求完整 Claude Code 体验，只把当前“一次性脚本式运行”改成“默认进入交互式聊天界面”。

## 目标

- `pnpm.cmd dev` 默认进入交互式 TUI。
- 旧脚本式任务参数直接废弃；传入任务参数时输出中文提示并退出。
- TUI 中用户可以连续输入多轮任务。
- 每轮任务复用同一个 session、workspace、provider、permissions 和 mode controller。
- TUI 显示基础运行状态：`Session`、`Mode`、当前是否运行中。
- TUI 显示消息流：用户输入、assistant 最终回答、工具调用、工具结果摘要、错误。
- 支持现有 plan mode 流程：模型进入 plan mode、写 plan、调用 `ExitPlanMode` 后继续复用现有 `y/n` 审批提示。
- 支持现有危险操作审批：`write_file`、`edit_file`、`run_command` 继续复用现有 `y/n` 审批提示。
- 任务运行中禁用新输入，避免同一个 agent loop 并发运行。

## 非目标

- 不做完整 Claude Code 风格全屏 UI。
- 不做复杂滚动、虚拟列表、主题、快捷键、vim mode、diff 面板。
- 不做多 session 选择器。
- 不做 slash command 系统。
- 不做子 agent、后台任务或任务队列。
- 不做权限规则持久化。
- 不做上下文 compact。

## 交互方式

启动：

```powershell
pnpm.cmd dev
```

进入 TUI：

```text
Mini Code Agent
Session: 8d7...   Mode: normal   Status: idle

user> 帮我阅读 src/cli.ts

[assistant thinking...]
[tool] read_file {"path":"src/cli.ts"}
[tool result] ok: 2341 chars
[assistant] src/cli.ts 现在负责...

user>
```

旧脚本式参数：

```powershell
pnpm.cmd dev -- "帮我修改 README"
```

输出：

```text
脚本式任务参数已废弃。请直接运行 pnpm.cmd dev 进入 TUI，然后在界面中输入任务。
```

`--help` 仍可用：

```powershell
pnpm.cmd dev -- --help
```

## 技术选择

使用 `Ink + React` 做 TUI。

原因：

- Claude Code 的 TUI 也是 React/Ink 风格，学习路径一致。
- 后续可以自然扩展成消息列表、状态栏、权限弹窗和快捷键。
- 比手写 readline 屏幕刷新更容易拆成组件。

新增依赖：

```text
dependencies:
  ink
  react

devDependencies:
  @types/react
```

## CLI 策略

`src/cli.ts` 改成：

1. 解析参数。
2. 如果是 `--help`，打印 TUI 版帮助。
3. 如果存在任务文本或旧脚本式运行参数，输出废弃提示，设置 `process.exitCode = 1`。
4. 无任务参数时启动 TUI。

旧参数处理：

- `--plan`
- `--continue`
- `--resume <sessionId>`
- `--no-session-persistence`
- 普通任务文本

这些都不再作为脚本式入口执行。V4 的 session 与 plan mode 状态由 TUI 持有；权限和计划审批先复用当前终端 `y/n` 提示。

## TUI 架构

新增目录：

```text
src/
  ui/
    App.tsx
    renderTui.tsx
    types.ts
    useAgentRunner.ts
```

职责：

- `src/ui/renderTui.tsx`：CLI 调用的 TUI 启动函数，负责 `render(<App />)`。
- `src/ui/App.tsx`：React 组件，持有输入框、消息流和状态栏。
- `src/ui/types.ts`：TUI 消息、运行状态、审批请求等类型。
- `src/ui/useAgentRunner.ts`：把 TUI 事件和现有 `runAgent`、provider、tools、session、mode controller 串起来。

## Agent 事件

当前 `runAgent` 只返回最终字符串。TUI 需要知道运行过程，所以 V4 增加轻量事件回调：

```ts
type AgentRunEvent =
  | { type: 'step_start'; step: number; maxSteps: number; mode: AgentMode }
  | { type: 'assistant_tool_calls'; toolCalls: ChatToolCall[] }
  | { type: 'tool_result'; name: string; result: ToolResult }
  | { type: 'assistant_final'; content: string }
  | { type: 'error'; error: string };
```

`runAgent` 新增：

```ts
onEvent?: (event: AgentRunEvent) => void;
```

设计原因：

- agent loop 仍然不依赖 React 或终端 UI。
- CLI/TUI 可以选择是否展示事件。
- transcript 记录和 UI 展示分离，避免把显示逻辑塞进核心 loop。

## 权限与审批

当前权限使用 `readline.question()`，不能直接用于 Ink TUI。V4 只调整边界，不做持久权限规则。

`PermissionController` 保持接口：

```ts
type PermissionController = {
  approveWriteFile(path: string, content: string): Promise<boolean>;
  approveRunCommand(command: string): Promise<boolean>;
};
```

V4 先复用当前 `readline` 风格的 `y/n` 审批：

- `approveWriteFile`、`approveRunCommand` 继续调用现有 `askYesNo()`。
- `approvePlan(plan, planFilePath)` 继续打印计划内容并调用现有 `askYesNo()`。
- TUI 的消息流负责展示 agent 运行过程和最终结果，不在 V4 内实现 Ink 弹窗审批。

这样做的原因是审批系统本身会牵涉焦点管理、输入拦截和 Promise 排队。V4 的主要学习目标是先建立交互式 TUI 主循环；真正的 TUI 内审批可以作为后续独立版本实现。

## Session 策略

V4 简化为：

- TUI 启动时创建一个 session。
- 多轮用户输入复用同一个 session。
- transcript 继续写入 `~/.mini-code-agent/projects/<projectKey>/<sessionId>.jsonl`。
- 暂不提供 TUI 内切换 session。

`--continue` 和 `--resume` 在 CLI 层废弃。后续版本如果需要恢复会话，可以在 TUI 内做“启动时选择 session”或 slash command。

## 错误处理

- 配置缺失：TUI 启动前失败，输出现有配置错误。
- 模型请求失败：消息流显示错误，状态回到 idle，用户可以继续输入下一条任务。
- 工具执行失败：作为工具结果展示，不中断 agent loop，由模型决定下一步。
- 达到 `MAX_AGENT_STEPS`：消息流显示 `Agent stopped after reaching max steps`，状态回到 idle。
- 用户拒绝权限：工具返回失败结果，消息流显示拒绝摘要。
- 用户在任务运行中输入：忽略或提示“任务运行中，请等待当前任务结束”。

## 测试策略

- CLI 参数测试：
  - 无参数表示进入 TUI。
  - `--help` 可用。
  - 传入任务参数会被标记为废弃脚本式调用。
- Agent loop 事件测试：
  - 每轮开始发出 `step_start`。
  - assistant 工具调用发出 `assistant_tool_calls`。
  - 工具完成发出 `tool_result`。
  - 最终回答发出 `assistant_final`。
- TUI runner 测试：
  - 提交一条用户任务后追加 user message。
  - agent 最终回答追加 assistant message。
  - agent 抛错时追加 error message 并恢复 idle。
- 权限实现测试：
  - 写文件审批能 resolve true/false。
  - plan 审批能 resolve true/false。

## 后续演进

V4 完成后，建议下一步：

- V5：Todo 工具和任务进度跟踪。
- V6：doctor / config 命令。
- V7：权限规则增强。
- V8：上下文 compact。
