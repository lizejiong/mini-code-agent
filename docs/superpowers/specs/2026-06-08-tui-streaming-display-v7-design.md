# V7 Claude Code 风格 TUI 运行展示优化设计文档

## 背景

当前项目已经完成：

- V1：基础 agent loop、本地工具、权限确认。
- V2：session transcript 与 resume。
- V3：plan mode 与局部编辑工具。
- V4：简易交互式 TUI。
- V5：项目上下文注入。
- V6：session 级 Todo 工具与 TUI 摘要展示。

现在的 TUI 仍然偏“日志输出”：模型回答必须等完整响应结束后才显示，工具调用和结果也只是原始文本。用户希望下一版不仅做流式对话，也把已有状态、工具、错误等运行展示优化到更接近 Claude Code 的体验；但当前系统没有的数据不硬造。

## 目标

- 支持 assistant 文本流式输出。
- 保留非流式 provider 的回退路径。
- provider 内部聚合 streamed tool call delta，工具调用仍在完整模型消息返回后执行。
- TUI 消息展示更接近 Claude Code 风格：
  - 用户消息清楚区分。
  - assistant 流式文本能逐段追加。
  - tool call 展示工具名和关键参数摘要。
  - tool result 展示成功/失败和结果摘要。
  - step/status 展示当前 step、max steps 和 mode。
  - error 使用单独样式。
- 顶部继续展示 session、mode、status 和 todo summary。
- 展示只基于现有事件和已有数据，不新增假的 token、费用、耗时或工具活动面板数据。

## 非目标

- 不在 TUI 中展示 tool call delta。
- 不做取消生成。
- 不做复杂滚动历史、虚拟列表或快捷键系统。
- 不做 slash command。
- 不做 diff 面板。
- 不做 token 用量、费用或速度统计。
- 不改变 transcript 结构；transcript 仍只记录完整 assistant 消息。

## Provider 设计

`ChatProvider` 增加可选 streaming 能力：

```ts
export type ChatCompletionChunk =
  | { type: 'content_delta'; content: string }
  | { type: 'message_complete'; response: ChatCompletionResponse };

export type ChatProvider = {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  stream?(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void,
  ): Promise<ChatCompletionResponse>;
};
```

这样设计的原因：

- 现有测试和非流式 provider 不需要立即改造。
- agent loop 可以优先使用 `stream()`，没有时回退 `complete()`。
- `stream()` 最终仍返回完整 `ChatCompletionResponse`，用于后续工具执行和 transcript 记录。

## OpenAI-compatible Streaming

`createOpenAICompatibleProvider` 在请求体中增加：

```json
{
  "stream": true
}
```

并解析 SSE：

```text
data: {"choices":[{"delta":{"content":"你"}}]}
data: {"choices":[{"delta":{"content":"好"}}]}
data: [DONE]
```

V7 解析：

- `delta.content`
- `delta.tool_calls`
- 完整结束时聚合成 `content`

如果流里出现 `delta.tool_calls`，provider 只在内部按 `index` 聚合 `id`、`function.name` 和 `function.arguments` 字符串；TUI 不展示参数增量。完整模型消息结束后，`stream()` 返回完整 `ChatCompletionResponse`，后续仍由 `runAgent` 执行工具。

## Agent Loop 事件

新增事件：

```ts
| { type: 'assistant_delta'; content: string }
```

行为：

- 当前 provider 支持 streaming 时，优先调用 `provider.stream()`。
- 每收到 `content_delta` 就发出 `assistant_delta`。
- 完整响应结束后仍发出 `assistant_final`。
- 如果 streamed response 包含工具调用，仍按现有流程发出 `assistant_tool_calls` 并执行工具。

## TUI 消息模型

扩展 `TuiMessage`：

```ts
export type TuiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; streaming?: boolean }
  | { role: 'tool_call'; content: string }
  | { role: 'tool_result'; content: string; ok: boolean }
  | { role: 'status'; content: string }
  | { role: 'error'; content: string };
```

TUI 层处理 `assistant_delta`：

- 如果最后一条消息是 `assistant` 且 `streaming: true`，追加 delta。
- 否则创建新的 streaming assistant 消息。
- 收到 `assistant_final` 后，把最后一条 streaming assistant 标记为非 streaming；如果之前没有 delta，则添加完整 assistant 消息。
- `createAgentRunner` 不直接读取 React state，而是调用 App 注入的 `appendAssistantDelta()` 和 `finishAssistantMessage()` 回调，避免异步 state 更新导致“最后一条消息”判断不可靠。

## 展示 Formatter

新增：

```text
src/ui/formatters.ts
```

职责：

- `formatStepStatus(event)`：格式化 step/mode。
- `formatToolCall(toolCall)`：格式化工具调用摘要。
- `formatToolResult(name, result)`：格式化工具结果摘要。

示例：

```text
read_file src/tools/types.ts
search_files "todo"
todo_write 3 todos
run_command pnpm.cmd test
read_file ok 1200 chars
edit_file failed old_text not found
```

formatter 保持纯函数，便于单测。

## TUI 布局

继续使用 Ink，不引入复杂面板状态机。

顶部：

```text
Mini Code Agent
Session: ...  Mode: normal  Status: running
Todos: 1 in_progress / 2 pending / 0 completed Current: ...
```

消息区：

```text
You
  帮我阅读 src/tools

Status
  Step 1/30 · mode normal

Tool
  read_file src/tools/types.ts
  ok 1200 chars

Assistant
  正在阅读工具定义...
```

样式：

- user：cyan。
- assistant：white。
- tool call：yellow。
- tool result ok：green。
- tool result failed：red。
- status：dim。
- error：red。

## 测试策略

- Provider：
  - `stream()` 请求包含 `stream: true`。
  - 能解析 `data:` SSE content delta。
  - 能聚合 streamed tool call delta。
  - `[DONE]` 后返回完整 content。
- Agent loop：
  - provider 支持 stream 时发出 `assistant_delta`。
  - streamed response 带工具调用时仍执行工具。
  - provider 不支持 stream 时回退 `complete()`。
- TUI runner：
  - `assistant_delta` 会创建并追加 streaming assistant 消息。
  - `assistant_final` 会结束 streaming 状态。
  - 没有 delta 时，`assistant_final` 仍创建 assistant 消息。
  - tool call/result 使用新的 role 和 formatter 输出。
- Formatter：
  - 覆盖常见工具摘要：`read_file`、`search_files`、`todo_write`、`run_command`。
  - 覆盖成功/失败 result 摘要。
- Build：
  - TypeScript 编译通过。

## 后续演进

- V8：如果需要更完整 Claude Code 体验，再做 tool call delta 解析。
- V9：TUI 内权限审批。
- V10：slash commands 或上下文 compact。

## 自审记录

- 范围只展示当前系统已有数据，不新增虚假的 token、费用或耗时。
- Streaming 支持文本 delta 和内部 tool call delta 聚合，但 TUI 不展示工具参数增量。
- TUI 优化以 formatter 和消息模型为边界，不引入复杂滚动系统。
