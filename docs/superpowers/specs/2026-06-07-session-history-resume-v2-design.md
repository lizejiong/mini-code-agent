# V2 会话历史与恢复设计

## 背景

V1 已经具备一次性任务执行能力：CLI 接收任务、模型按需调用本地工具、最后输出答案。它的问题是每次运行都是全新上下文，用户无法继续上一轮对话，也无法查看某次运行期间模型和工具之间发生了什么。

参考 `D:\code\coding\claude-code-sourcemap` 的会话机制后，V2 只实现最小可学习版本：用 JSONL 记录完整 transcript，并提供基于当前工作目录的继续与恢复能力。

## 目标

- 每次运行生成一个 `sessionId`。
- 默认把用户消息、模型消息、工具结果追加写入 JSONL。
- 按工作目录隔离会话，避免不同项目互相混在一起。
- 支持 `--continue` 继续当前项目最近一次会话。
- 支持 `--resume <sessionId>` 恢复当前项目下指定会话。
- 支持 `--no-session-persistence` 关闭本次运行的会话落盘。
- CLI 输出当前 `sessionId`，便于用户后续恢复。

## 非目标

- 不实现 `--fork-session`。
- 不支持从任意 `.jsonl` 路径恢复。
- 不把大工具结果拆到外部 `tool-results` 目录。
- 不实现会话标题、压缩、搜索 UI 或多分支对话树。
- 不实现中断 turn 的自动修复。

## 存储位置

V2 使用用户目录保存会话：

```text
~/.mini-code-agent/projects/<sanitized-cwd>/<sessionId>.jsonl
```

`<sanitized-cwd>` 由当前工作目录派生，并附带短哈希。这样做的原因是：

- 路径可读：目录名仍能看出来源项目。
- 碰撞概率低：同名项目位于不同父目录时不会覆盖。
- 跨平台安全：去掉 Windows 路径分隔符、冒号等不适合做目录名的字符。

## JSONL 记录格式

每行是一条独立 JSON，便于追加写入和后续流式读取。

```ts
type TranscriptEntry =
  | {
      type: 'user';
      sessionId: string;
      timestamp: string;
      content: string;
    }
  | {
      type: 'assistant';
      sessionId: string;
      timestamp: string;
      content: string;
      toolCalls: ChatToolCall[];
    }
  | {
      type: 'tool';
      sessionId: string;
      timestamp: string;
      toolCallId: string;
      name: string;
      result: ToolResult;
    };
```

恢复时把 transcript 重新转换成 provider 需要的 `ChatMessage[]`：

- `user` -> `{ role: 'user', content }`
- `assistant` -> `{ role: 'assistant', content, toolCalls }`
- `tool` -> `{ role: 'tool', toolCallId, content: JSON.stringify(result) }`

## CLI 行为

```text
mini-code-agent "任务"
mini-code-agent --continue "继续处理刚才的问题"
mini-code-agent --resume <sessionId> "基于指定会话继续"
mini-code-agent --no-session-persistence "只运行，不落盘"
```

约束：

- 当前仍是非交互式 CLI，因此 `--continue` 和 `--resume` 也必须提供新任务文本。
- `--continue` 只查找当前工作目录对应项目下最近修改的 `.jsonl`。
- `--resume <sessionId>` 只允许恢复当前工作目录对应项目下的会话。
- `--no-session-persistence` 不读取旧 transcript，也不写入新 transcript。

## 模块边界

```text
src/sessions/
  ids.ts          生成和校验 sessionId
  paths.ts        计算用户级会话目录与 transcript 文件路径
  transcript.ts   JSONL 追加、读取、列表、ChatMessage 转换
  resume.ts       组合 CLI 参数，决定新建、continue、resume 或禁用持久化
```

`src/agent/loop.ts` 只关心“拿到历史消息”和“在关键节点写 transcript”，不直接关心文件路径。这样后续如果改成数据库或远程存储，agent loop 不需要重写。

## 风险与处理

- JSONL 某行损坏：V2 直接报错，避免悄悄丢上下文导致模型基于不完整历史行动。
- 会话不存在：CLI 报明确错误。
- `--continue` 没有历史：CLI 报明确错误。
- transcript 写入失败：V2 让错误冒泡，因为用户以为能恢复但实际没落盘会更危险。
