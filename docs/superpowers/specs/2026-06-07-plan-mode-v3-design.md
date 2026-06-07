# V3 Plan Mode 设计文档

## 背景

V1 实现了最小 code agent：模型可以调用本地工具读写文件、搜索文件和执行命令。V2 增加了 JSONL 会话历史与 `--continue` / `--resume`。V3 参考 `D:\code\coding\claude-code-sourcemap` 的 plan mode，把“先规划、经用户批准、再执行”做成 agent 内部状态，而不是普通文本约定。

Claude Code 的关键设计不是“输出一段计划”，而是：

- 进入 plan mode 后，agent 处于受限状态。
- plan mode 中只能做只读探索，并且只能写当前 session 的 plan 文件。
- 完成规划后通过 `ExitPlanMode` 请求用户批准。
- 用户批准后，agent 才切回 normal mode 并继续执行。

V3 采用学习版实现，保留这个核心状态机，暂不引入完整 TUI、子 agent、AskUserQuestion、权限规则持久化或计划文件恢复快照。

## 目标

- 支持 `--plan` 强制从 plan mode 开始。
- 支持模型在 normal mode 中主动调用 `EnterPlanMode`。
- plan mode 中只暴露安全工具：`read_file`、`search_files`、`read_plan`、`write_plan`、`ExitPlanMode`。
- normal mode 中暴露执行工具：`read_file`、`search_files`、`write_file`、`run_command`、`EnterPlanMode`。
- plan 文件保存到用户目录：`~/.mini-code-agent/plans/<sessionId>.md`。
- `ExitPlanMode` 读取 plan 文件并让 CLI 询问用户是否批准。
- 用户批准后切回 normal mode，并把“计划已批准，可以执行”作为 tool result 返回模型，agent loop 自动继续。
- 用户拒绝后保持 plan mode，并把拒绝结果返回模型，让它继续修订计划。
- plan mode 状态进入 transcript，`--continue` 后能知道当前 session 是否还在 plan mode。

## 非目标

- 不做独立 `AskUserQuestion` 工具。模型需要澄清时直接停止并输出问题，用户用 `--continue` 回答。
- 不做 `--execute-plan <id>`。
- 不做 plan 文件 fork、恢复快照或外部编辑器打开。
- 不做子 agent 或并行规划。
- 不做复杂权限配置持久化。
- 不改变现有 GLM / OpenAI-compatible provider。

## 交互方式

强制进入计划模式：

```text
pnpm.cmd dev -- --plan "实现一个复杂功能"
```

模型主动进入计划模式：

```text
pnpm.cmd dev -- "实现一个复杂功能"
```

流程：

```text
用户任务
  -> runAgent(mode=normal 或 plan)
  -> 模型可调用 EnterPlanMode
  -> mode 切换为 plan
  -> 模型只读探索并用 write_plan 写计划
  -> 模型调用 ExitPlanMode
  -> CLI 展示 ~/.mini-code-agent/plans/<sessionId>.md
  -> 用户批准
  -> mode 切回 normal
  -> tool result 告诉模型计划已批准
  -> 模型继续调用 write_file / run_command 执行
```

## 模式与工具

```ts
type AgentMode = 'normal' | 'plan';
```

normal mode 工具：

```text
read_file
search_files
write_file
run_command
EnterPlanMode
```

plan mode 工具：

```text
read_file
search_files
read_plan
write_plan
ExitPlanMode
```

V3 通过“按模式注册工具”实现边界，而不是在 `write_file` 或 `run_command` 内部检查模式。原因是工具列表本身就是模型的能力边界：plan mode 中模型看不到项目写入和命令执行工具，行为更容易理解，也更接近 Claude Code 的受限状态。

## Plan 文件

路径：

```text
~/.mini-code-agent/plans/<sessionId>.md
```

`read_plan` 行为：

- 文件存在：返回当前内容。
- 文件不存在：返回空字符串或明确提示“No plan written yet”。

`write_plan` 行为：

- 覆盖写入当前 session 的 plan 文件。
- 不接受任意路径。
- 返回写入字节数和 plan 文件路径。

V3 不支持 append/edit patch，模型每次需要写完整计划内容。这比增量 patch 简单，适合学习状态机。

## Mode Controller

新增 `ModeController` 负责运行时状态：

```ts
type ModeController = {
  getMode(): AgentMode;
  enterPlanMode(): Promise<ToolResult>;
  exitPlanMode(): Promise<ToolResult>;
  getPlanFilePath(): string;
};
```

`exitPlanMode()` 内部会：

1. 读取 plan 文件。
2. 如果为空，返回工具错误，保持 plan mode。
3. 把计划展示给用户。
4. 询问 `Approve this plan and continue? (y/N)`。
5. 用户批准：切回 normal mode，返回成功工具结果。
6. 用户拒绝：保持 plan mode，返回失败工具结果。

## Agent Loop

`runAgent` 需要支持动态工具列表：

- 每一轮 provider 请求前，根据 `modeController.getMode()` 构建工具 registry。
- 执行 `EnterPlanMode` / `ExitPlanMode` 后，下一轮自动看到新的工具列表。
- transcript 中记录模式事件，便于 resume。

当前 `runAgent` 只接收固定 `tools: ToolRegistry`。V3 将扩展为：

```ts
toolsForMode: (mode: AgentMode) => ToolRegistry
modeController: ModeController
```

为兼容测试和普通使用，可以保留旧的 `tools` 参数，或者一次性迁移现有调用点。V3 推荐一次性迁移，因为 CLI 是唯一生产调用点，测试也可同步调整。

## Transcript 扩展

新增 entry：

```ts
type ModeTranscriptEntry = {
  type: 'mode';
  sessionId: string;
  timestamp: string;
  mode: AgentMode;
  reason: 'initial' | 'enter_plan' | 'exit_plan_approved' | 'exit_plan_rejected';
  planFilePath?: string;
};
```

恢复时：

- 从 transcript 中最后一条 `mode` entry 推导当前模式。
- 如果没有 mode entry，默认 `normal`。
- `mode` entry 不转换为 provider 的 `ChatMessage`，它是本地运行时状态，不应该污染模型上下文。

## Prompt 策略

V3 不引入复杂系统 prompt 框架，只在用户任务前插入简短 system message：

normal mode：

- 你可以执行任务。
- 对复杂或不确定的实现任务，优先调用 `EnterPlanMode` 先探索和规划。

plan mode：

- 当前处于 plan mode。
- 不允许修改项目文件、运行命令或执行实现。
- 只能读取代码、搜索文件、读写 plan 文件。
- 完成后调用 `ExitPlanMode` 请求批准。

这些 prompt 放在 `src/prompts/planMode.ts`，让后续版本可以继续演进。

## 错误处理

- plan mode 中没有 plan 文件就调用 `ExitPlanMode`：返回工具错误，保持 plan mode。
- 用户拒绝计划：返回工具错误，保持 plan mode。
- 读取或写入 plan 文件失败：返回工具错误，保持当前模式。
- `--continue` 恢复到 plan mode 后，CLI 继续使用 plan mode 工具列表。
- `--plan` 和 `--no-session-persistence` 可以同时使用：仍生成内存 session id，plan 文件按该 id 写入用户目录，但 transcript 不落盘。

## 测试策略

- CLI 参数测试：解析 `--plan`。
- plan path/store 测试：路径位于 `~/.mini-code-agent/plans/<sessionId>.md`，读写不接受任意路径。
- mode controller 测试：进入 plan、批准退出、拒绝保持 plan、空 plan 拒绝退出。
- registry 测试：不同 mode 暴露不同工具。
- agent loop 测试：根据模式动态暴露工具，`EnterPlanMode` 后下一轮变成 plan 工具，`ExitPlanMode` 批准后下一轮变回 normal 工具。
- resume 测试：最后一条 mode entry 决定恢复模式。
