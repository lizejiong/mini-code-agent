# V10 自动 Todo 策略设计文档

## 背景

当前项目已经具备基础 code agent 能力：

- V1：agent loop、provider、基础工具和权限确认。
- V2：session transcript 与恢复。
- V3：plan mode 与 `edit_file`。
- V4：交互式 TUI。
- V5：项目上下文注入。
- V6：Todo / Task 工具。
- V7：流式对话与 TUI 展示优化。
- V8：上下文 compact。
- V9：文件探索工具集。

V6 已经提供 `todo_read` 和 `todo_write`，TUI 也能展示 todo 摘要。但当前 todo 使用主要依赖模型自觉：复杂任务开始时不一定会主动创建 todo，执行过程中也不一定会持续更新状态。V10 的目标是增强 agent 的任务管理习惯，让复杂实现任务更稳定地先拆解、再执行、再同步进度。

## 目标

- 对复杂实现任务自动注入 todo 使用提示。
- 复用现有 `todo_read`、`todo_write`、`TodoStore` 和 TUI 展示，不重新设计 todo 数据结构。
- 只在 `normal mode` 生效，避免干扰 `plan mode` 的计划文件流程。
- 简单问答、代码解释、只读查看、简短描述生成不触发 todo 提示。
- 提示模型在复杂任务开始时创建 3-6 个 todo。
- 提示模型执行过程中最多保持一个 `in_progress`。
- 提示模型每完成一个阶段后更新 todo 状态。
- 提示模型最终回答前把完成项标记为 `completed`。
- 继续使用中文 JSDoc 风格注释解释关键逻辑。

## 非目标

- 不新增 todo 状态，仍然只使用 `pending`、`in_progress`、`completed`。
- 不强制拦截文件修改或命令执行。
- 不修改 TUI 的 todo 展示布局。
- 不修改 `todo_read` / `todo_write` 的工具输入输出。
- 不让 plan mode 自动创建 todo。
- 不实现模型行为的硬性证明；V10 只提供更明确、更稳定的运行时提示。
- 不引入外部依赖或网络服务。

## 方案

采用“提示词 + 运行时任务提示”的方案。

核心思路：

1. 新增一个 todo 策略模块，用轻量规则判断当前用户任务是否像复杂实现任务。
2. 在 `runAgent` 构造 system messages 时，根据任务和当前 mode 决定是否注入 todo policy prompt。
3. prompt 不直接替代模型判断，而是明确告诉模型：如果当前任务确实需要多步骤代码修改，应先使用 `todo_write` 建立任务列表。

这个方案比纯提示词更稳定，因为运行时会根据用户任务动态注入规则；也比硬性拦截更轻量，不会误伤简单任务或学习阶段的实验流程。

## 触发规则

新增函数：

```ts
shouldSuggestTodos(task: string): boolean
```

返回 `true` 的典型任务：

- “实现一个新功能”
- “修复一个 bug”
- “重构某个模块”
- “修改代码并运行测试”
- “继续下一版本”
- “做 V10”
- “提交前完成这个功能”

返回 `false` 的典型任务：

- “解释这段代码”
- “怎么使用”
- “列出当前功能”
- “生成一句话项目描述”
- “阅读一下本次改动”
- “当前已经可使用了吗”

判断方式使用启发式关键词，而不是调用模型或引入复杂分类器。关键词分为两组：

- 复杂实现关键词：`实现`、`修复`、`重构`、`修改`、`新增`、`继续下一版本`、`下个版本`、`V10`、`测试`、`提交`。
- 简单只读关键词：`解释`、`阅读`、`怎么使用`、`列出`、`描述`、`有哪些功能`、`当前`、`是否`。

当两组关键词都命中时，复杂实现关键词优先，但明显只读的问题仍然不触发。例如“带我阅读本次改动”不触发；“阅读代码并实现修复”触发。

## Prompt 设计

新增函数：

```ts
createTodoPolicyPrompt(options: {
  task: string;
  mode: AgentMode;
}): string | undefined
```

当 `mode !== 'normal'` 时返回 `undefined`。

当 `shouldSuggestTodos(task)` 返回 `false` 时返回 `undefined`。

当需要提示时，注入中文 system message：

```text
Todo 使用策略：

当前用户请求看起来是一个多步骤实现任务。开始修改代码前，先用 todo_write 创建 3-6 个 todo，覆盖理解现状、实现、验证和收尾。

执行过程中保持最多一个 in_progress；每完成一个阶段就更新 todo_write。最终回答前，将已完成事项标记为 completed。

如果你在读取上下文后判断任务其实很简单，可以不创建 todo，但不要在复杂任务中跳过进度维护。
```

这段提示强调“复杂任务应该维护 todo”，但保留模型在少数误判情况下跳过 todo 的空间。

## 接入点

修改：

```text
src/agent/loop.ts
```

在 `buildSystemMessages(options, mode)` 中追加 todo policy prompt。

建议顺序：

1. 项目上下文。
2. mode system prompt。
3. todo policy prompt。

原因：

- 项目上下文先提供仓库事实。
- mode prompt 先定义是否允许修改文件。
- todo policy prompt 再定义 normal mode 下复杂任务的进度管理习惯。

新增：

```text
src/todos/policy.ts
```

职责：

- 判断任务是否需要建议 todo。
- 生成 todo policy prompt。
- 集中维护触发关键词，避免把策略散落在 agent loop 里。

## 数据流

```text
用户任务
  -> runAgent
  -> buildSystemMessages
  -> createTodoPolicyPrompt(task, mode)
  -> provider request messages
  -> 模型看到 todo 使用策略
  -> 模型调用 todo_write / todo_read
  -> TodoStore 写入 session todo 文件
  -> TUI 展示 todo 摘要
```

V10 不改变工具执行流程，只改变发送给模型的 system messages。

## 错误处理

- `task` 为空字符串时不注入 todo policy prompt。
- `mode` 为 `plan` 时不注入 todo policy prompt。
- 关键词误判时，prompt 允许模型在确认任务很简单后不创建 todo。
- 如果模型没有遵守提示，V10 不在运行时强制失败；后续版本可以再做硬性 guard。

## 测试策略

### `todo policy` 单元测试

- 复杂实现任务返回 `true`。
- 下一版本类任务返回 `true`。
- 简单问答返回 `false`。
- 代码阅读类任务返回 `false`。
- `normal mode` 下复杂任务生成 prompt。
- `plan mode` 下复杂任务不生成 prompt。

### `agent loop` 测试

- provider 收到的 system messages 包含 todo policy prompt。
- 简单任务请求 provider 时不包含 todo policy prompt。
- plan mode 请求 provider 时不包含 todo policy prompt。
- 现有 mode prompt 和项目上下文顺序不被破坏。

### 回归测试

- `pnpm.cmd test`
- `pnpm.cmd build`

## 后续演进

- 后续可以增加硬性 guard：复杂任务在首次写文件前必须已经存在 todo。
- 后续可以把 todo 状态同步到 compact 摘要中。
- 后续可以让 TUI 高亮当前 `in_progress` 任务。
- 后续可以记录模型是否遵守 todo 策略，用于调试 agent 行为。

## 自审记录

- 范围聚焦在自动 todo 策略，没有混入 TUI 改版或工具 schema 改动。
- 设计复用现有 todo 工具和存储结构。
- 运行时只注入 system prompt，不拦截工具执行，风险可控。
- normal mode 与 plan mode 的边界明确。
- 测试覆盖策略判断、prompt 生成和 agent loop 接入。
