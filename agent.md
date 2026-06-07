# Mini Code Agent 项目 Agent 约定

本文档是本仓库的 agent 协作说明。后续任何 agent 在修改本项目代码、文档或目录结构前，应优先阅读本文档，并遵守这里定义的包管理、技术栈、目录约定、演进规则和代码风格。

## 包管理

- 使用 `pnpm` 作为唯一包管理器。

## 技术栈

当前 V1 技术栈：

- Node.js 18+。
- TypeScript。
- ESM module：`package.json` 使用 `"type": "module"`。
- Vitest：单元测试和行为测试。
- tsx：本地开发运行 TypeScript CLI。
- zod：工具输入和配置等运行时 schema 校验。
- dotenv：加载本地 `.env` 配置。
- OpenAI-compatible `/chat/completions` API：第一版模型接口。

## 当前目录约定

V1 目录结构应保持轻量：

```text
src/
  agent/
    loop.ts
  providers/
    types.ts
    openaiCompatible.ts
  tools/
    types.ts
    fileTools.ts
    commandTool.ts
    index.ts
  cli.ts
  config.ts
  permissions.ts
  workspace.ts
tests/
  *.test.ts
docs/
  superpowers/
    specs/
    plans/
```

目录职责：

- `src/cli.ts`：命令行入口，只负责参数、配置、工作区和运行 agent。不要把 agent 业务逻辑写进 CLI。
- `src/agent/`：agent 循环、消息推进、工具调用调度策略。不要直接处理具体文件系统细节。
- `src/providers/`：模型 provider 适配层。负责请求和响应格式转换，不负责工具执行。
- `src/tools/`：本地工具定义、输入 schema、工具实现和工具注册表。
- `src/workspace.ts`：路径解析和工作区边界保护。所有文件工具必须通过这里处理路径。
- `src/permissions.ts`：写文件、执行命令等危险操作的确认逻辑。
- `tests/`：用行为测试描述模块边界。新增生产逻辑前先写对应测试。
- `docs/superpowers/`：Superpowers 产出的设计、计划和项目记忆。此目录下文档默认使用中文。

## 面向未来的目录预留

后续可以按功能成熟度逐步引入这些目录：

```text
src/
  commands/      # 斜杠命令或 CLI 子命令，例如 init、config、resume、doctor
  services/      # API、会话、压缩、MCP、插件等长期服务
  context/       # 会话上下文、系统提示词上下文、模型上下文预算
  state/         # 运行时状态、会话状态、任务状态
  prompts/       # 系统提示词、工具提示词、压缩提示词
  mcp/           # MCP client/server 适配，成熟后也可放入 services/mcp
  plugins/       # 插件加载、插件缓存、插件 manifest
  skills/        # 项目自带 skill 或 skill 加载机制
  ui/            # 若引入 TUI，再放终端 UI 组件
```

## 目录结构演进规则

1. 先扩展现有小模块，直到职责边界变得不清晰，再拆新目录。
2. 新目录必须有一句清楚的职责说明，能回答“这里放什么、不放什么”。
3. 不为了模仿参考项目而创建空目录。
4. 不把所有共享逻辑都塞进 `utils/`。只有真正跨模块、无业务归属的纯函数才进入 `utils/`。
5. 文件工具、命令工具、provider、agent loop 之间通过类型化接口通信，不互相读取内部实现。
6. 危险能力必须集中接入权限层，例如写文件、执行命令、删除文件、网络请求。
7. 工作区路径安全必须集中在 `workspace.ts` 或后续 `workspace/` 模块中，不能在各工具里各写一套路径判断。

## 代码风格

- 关键逻辑和设计决策处必须写注释，帮助学习者理解"为什么这样做"。
- 不需要在每行都加注释，但要确保非显而易见的逻辑、边界处理、性能考量等关键地方有清晰说明。
- 注释使用 JSDoc 风格：多行说明用 `/** ... */`，单行简短说明用 `/** 一行 */`，不使用 `//` 做文档注释。
