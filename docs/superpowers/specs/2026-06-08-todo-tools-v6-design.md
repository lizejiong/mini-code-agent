# V6 Todo / Task 进度工具设计文档

## 背景

当前项目已经具备基础 code agent 能力：

- V1：agent loop、本地工具、权限确认。
- V2：session transcript 与 resume。
- V3：plan mode 和局部文件编辑。
- V4：简易交互式 TUI。
- V5：项目上下文注入。

下一步继续学习 Claude Code 的核心 agent 能力：让模型显式维护任务进度。复杂任务通常包含多个步骤，如果只靠对话历史，模型容易忘记当前做到哪里；Todo 工具把任务状态结构化，后续也能服务 compact、TUI 面板和更复杂的计划执行。

## 目标

- 新增 session 级 Todo Store。
- Todo 数据持久化到当前 session 文件旁边。
- 提供 `todo_read` 工具读取当前 todo 列表。
- 提供 `todo_write` 工具整体写入当前 todo 列表。
- Todo 项包含：
  - `id`
  - `content`
  - `status`
- `status` 支持：
  - `pending`
  - `in_progress`
  - `completed`
- normal mode 和 plan mode 都允许使用 todo 工具。
- TUI 展示 todo 摘要和当前进行中的任务。
- Todo 更新后，TUI 能在同一轮运行中刷新展示。

## 非目标

- 不做子任务树。
- 不做优先级、截止时间、负责人等字段。
- 不从 plan 文本自动解析 todo。
- 不做跨 session 共享 todo。
- 不把 todo 写入 transcript。
- 不做复杂 TUI 面板、快捷键或可编辑 todo 列表。
- 不要求每次任务强制使用 todo；先通过工具描述引导模型在多步骤任务中使用。

## 数据设计

新增目录：

```text
src/
  todos/
    store.ts
```

核心类型：

```ts
export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

export type TodoStore = {
  filePath: string;
  read(): Promise<TodoItem[]>;
  write(items: TodoItem[]): Promise<ToolResult>;
};
```

文件路径：

```text
~/.mini-code-agent/todos/<sessionId>.json
```

这个路径与当前 `PlanStore` 的 session 级设计保持一致。Todo 属于 agent 运行状态，不属于项目文件，因此不放在 workspace 内，也不需要用户确认写文件。

## 工具设计

新增文件：

```text
src/tools/todoTools.ts
```

工具：

- `todo_read`
  - 输入：空对象。
  - 输出：当前 todo 列表 JSON。
- `todo_write`
  - 输入：
    ```ts
    {
      todos: Array<{
        id: string;
        content: string;
        status: 'pending' | 'in_progress' | 'completed';
      }>
    }
    ```
  - 行为：整体替换当前 session 的 todo 列表。
  - 输出：写入数量和状态摘要。

`todo_write` 使用整体替换，而不是增删改单项工具。原因是模型每次更新时可以提交完整的当前事实，避免“先读旧状态、再局部 patch”时出现状态漂移。V6 的列表规模很小，整体写入更容易测试和学习。

## 工具注册

`registryForMode` 在 normal 和 plan 两种模式都注册 Todo 工具：

```text
plan mode:
  read_file
  search_files
  todo_read
  todo_write
  read_plan
  write_plan
  ExitPlanMode

normal mode:
  read_file
  search_files
  todo_read
  todo_write
  write_file
  edit_file
  run_command
  EnterPlanMode
```

plan mode 允许写 todo，是因为 todo 属于任务管理状态，不修改项目文件；这与 plan 文件类似，是 planning 过程的一部分。

## TUI 设计

新增轻量类型：

```ts
export type TodoSummary = {
  pending: number;
  inProgress: number;
  completed: number;
  current: string | undefined;
};
```

TUI 顶部展示：

```text
Todos: 1 in_progress / 2 pending / 3 completed
Current: 实现 todo store
```

刷新策略：

- TUI 启动时读取一次 todo。
- 每轮任务开始前可以展示旧摘要。
- 当 agent 工具事件中出现 `todo_write` 成功结果后，TUI 调用 `loadTodoSummary()` 刷新摘要。
- 如果读取失败，TUI 显示 `Todos: unavailable`，不阻塞 agent。

## CLI 集成

`src/cli.ts` 在创建 session 后创建 Todo Store：

```ts
const todoStore = createTodoStore({ sessionId: session.sessionId });
```

然后：

- 传给 `createRegistryForMode`。
- 传给 `renderTui`，用于读取摘要。

## 错误处理

- Todo 文件不存在：返回空数组。
- Todo JSON 解析失败：返回明确错误，避免静默覆盖损坏文件。
- `todo_write` 输入不合法：由 zod schema 返回工具错误。
- `todo_write` 的 `id` 和 `content` 为空字符串：schema 拒绝。
- TUI 读取摘要失败：展示不可用状态，不影响模型继续运行。

## 测试策略

- `TodoStore`：
  - 缺失文件返回空数组。
  - 写入后可以读回。
  - JSON 损坏时抛出清晰错误。
- `todoTools`：
  - `todo_read` 返回当前列表。
  - `todo_write` 写入列表并返回状态摘要。
  - 非法状态、空 id、空 content 被拒绝。
- `registryForMode`：
  - normal mode 暴露 `todo_read` 和 `todo_write`。
  - plan mode 暴露 `todo_read` 和 `todo_write`。
- `TUI runner`：
  - `todo_write` 成功后触发 todo 摘要刷新。
  - 非 todo 工具结果不刷新。
- `build`：
  - CLI 集成通过 TypeScript 编译验证。

## 后续演进

- V7：上下文 compact 简易版，把 todo 状态作为 compact 的稳定摘要来源之一。
- V8：TUI 内 `/todos` 或 `/status` 命令。
- V9：更完整的权限与审批 UI。

## 自审记录

- 范围聚焦在 session 级任务状态，未混入 compact、slash command 或复杂 TUI 面板。
- Todo Store、工具层、registry、TUI 展示边界清晰。
- 所有用户已确认的关键选择都已落地：持久化、`todo_read` + `todo_write`、normal/plan 都可用。
