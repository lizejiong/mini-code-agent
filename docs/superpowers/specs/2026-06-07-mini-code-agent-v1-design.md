# Mini Code Agent V1 设计文档

## 目标

构建一个用于学习的 code agent：它可以从终端运行，调用 OpenAI-compatible 模型，并使用一组很小的本地工具来查看和修改工作区。

## 范围

V1 包含：

- Node.js + TypeScript CLI。
- 通过 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 调用 OpenAI-compatible chat completions。
- 一个多步骤 agent 循环：发送消息给模型、执行模型请求的工具调用、把工具结果返回给模型。
- 四个本地工具：读取文件、写入文件、搜索/列出文件、执行命令。
- 基础路径安全限制：文件工具只能访问当前工作区内的路径。
- 基础权限确认：写文件和执行命令前询问用户。

V1 不包含：

- 全屏 TUI。
- 会话恢复。
- MCP。
- 插件系统。
- skills 系统。
- 多 agent 工作流。
- 复杂 patch 编辑。

## 架构

项目拆成几个小模块：

- `src/cli.ts`：解析命令行参数、加载配置、启动一次任务。
- `src/agent/loop.ts`：负责模型和工具之间的循环。
- `src/providers/openaiCompatible.ts`：调用配置好的 OpenAI-compatible API。
- `src/tools/*`：定义工具 schema 和工具实现。
- `src/permissions.ts`：处理交互式 `y/n` 审批。
- `src/workspace.ts`：在工作区根目录内安全解析路径。

agent 循环保持简单：输入用户任务，发送模型请求，执行可选工具调用，返回工具结果；重复这个过程，直到模型给出最终回答，或者达到最大步骤数。

## 错误处理

- 缺少 API 配置时，在启动 agent 前失败。
- 工具输入校验失败时，把错误作为工具结果返回给模型。
- 访问工作区外路径时拒绝执行。
- 用户拒绝写文件或执行命令时，把拒绝结果作为工具错误返回给模型。
- API 调用失败时停止运行，并输出清晰错误。
- 达到最大步骤数后停止循环，避免失控执行。

## 测试

V1 需要覆盖：

- 环境配置加载。
- 工作区路径边界。
- 读文件、写文件、搜索文件、执行命令的工具行为。
- 权限拒绝行为。
- 模型先调用工具、再返回最终答案的 agent 循环行为。

## 版本路线

- V1：最小可用 code agent。
- V2：会话历史和 resume。
- V3：计划模式和 todo 列表。
- V4：更好的终端 UI、更细的权限和配置文件。
