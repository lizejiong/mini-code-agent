# Mini Code Agent V1 实现计划

> **给 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 构建一个最小 TypeScript code agent，可以调用 OpenAI-compatible 模型，并安全使用本地文件、搜索和 shell 工具。

**架构：** CLI 负责加载配置并启动有步数上限的 agent 循环。Provider 模块处理 OpenAI-compatible chat completions；tools 模块暴露类型化的本地动作，并通过工作区路径解析和权限确认做保护。

**技术栈：** Node.js、TypeScript、Vitest、tsx、OpenAI-compatible `/chat/completions` API。

---

## 文件结构

- 创建 `package.json`：包元信息、脚本、依赖和 CLI bin。
- 创建 `tsconfig.json`：严格 TypeScript 配置。
- 创建 `.gitignore`：排除本地依赖、构建产物和环境变量文件。
- 创建 `.env.example`：记录模型配置环境变量。
- 创建 `src/config.ts`：读取并校验环境变量。
- 创建 `src/workspace.ts`：在工作区根目录内解析安全路径。
- 创建 `src/permissions.ts`：处理审批提示，并暴露方便测试的权限函数。
- 创建 `src/tools/types.ts`：共享工具接口。
- 创建 `src/tools/fileTools.ts`：读取、写入、搜索/列出文件工具。
- 创建 `src/tools/commandTool.ts`：shell 命令工具。
- 创建 `src/tools/index.ts`：工具注册表和执行分发。
- 创建 `src/providers/types.ts`：provider 消息和工具调用类型。
- 创建 `src/providers/openaiCompatible.ts`：provider 实现。
- 创建 `src/agent/loop.ts`：有步数上限的工具使用循环。
- 创建 `src/cli.ts`：可执行 CLI 入口。
- 创建 `tests/*.test.ts`：针对配置、工作区、工具和循环的聚焦测试。

## 任务

### 任务 1：项目脚手架

**文件：**
- 创建：`package.json`
- 创建：`tsconfig.json`
- 创建：`.gitignore`
- 创建：`.env.example`

- [x] **步骤 1：创建脚手架文件**

添加 TypeScript ESM package 和脚本：

```json
{
  "name": "mini-code-agent",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "mini-code-agent": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "dotenv": "^16.4.7",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [x] **步骤 2：安装依赖**

运行：`pnpm.cmd install`

预期：依赖安装完成，并生成 lockfile。

### 任务 2：配置和工作区安全

**文件：**
- 创建：`tests/config.test.ts`
- 创建：`tests/workspace.test.ts`
- 创建：`src/config.ts`
- 创建：`src/workspace.ts`

- [x] **步骤 1：先写失败测试**

测试缺少必需配置时会失败，并测试路径不能逃出工作区。

- [x] **步骤 2：运行测试确认失败**

运行：`pnpm.cmd test tests/config.test.ts tests/workspace.test.ts`

预期：失败，因为模块尚不存在。

- [x] **步骤 3：实现配置和工作区模块**

添加环境变量解析和安全路径解析。

- [x] **步骤 4：运行测试确认通过**

运行：`pnpm.cmd test tests/config.test.ts tests/workspace.test.ts`

预期：两个测试文件通过。

### 任务 3：本地工具

**文件：**
- 创建：`tests/tools.test.ts`
- 创建：`src/tools/types.ts`
- 创建：`src/tools/fileTools.ts`
- 创建：`src/tools/commandTool.ts`
- 创建：`src/tools/index.ts`
- 修改：`src/permissions.ts`

- [x] **步骤 1：先写失败测试**

测试读取文件、允许写入、拒绝写入、搜索文件、允许执行命令、拒绝执行命令。

- [x] **步骤 2：运行测试确认失败**

运行：`pnpm.cmd test tests/tools.test.ts`

预期：失败，因为工具模块尚不存在。

- [x] **步骤 3：实现工具注册表和工具**

添加 V1 的四个工具和执行分发逻辑。

- [x] **步骤 4：运行测试确认通过**

运行：`pnpm.cmd test tests/tools.test.ts`

预期：工具测试通过。

### 任务 4：OpenAI-compatible Provider

**文件：**
- 创建：`tests/provider.test.ts`
- 创建：`src/providers/types.ts`
- 创建：`src/providers/openaiCompatible.ts`

- [x] **步骤 1：先写失败测试**

通过注入的 `fetch` 测试请求形状、base URL 规范化和 tool-call 响应映射。

- [x] **步骤 2：运行测试确认失败**

运行：`pnpm.cmd test tests/provider.test.ts`

预期：失败，因为 provider 模块尚不存在。

- [x] **步骤 3：实现 provider**

添加一个小型 provider，用于把 messages 和 tools 发送到 `/chat/completions`。

- [x] **步骤 4：运行测试确认通过**

运行：`pnpm.cmd test tests/provider.test.ts`

预期：provider 测试通过。

### 任务 5：Agent 循环和 CLI

**文件：**
- 创建：`tests/agent-loop.test.ts`
- 创建：`src/agent/loop.ts`
- 创建：`src/cli.ts`

- [x] **步骤 1：先写失败测试**

测试模型调用工具后再给出最终答案，并测试达到最大步骤数时终止。

- [x] **步骤 2：运行测试确认失败**

运行：`pnpm.cmd test tests/agent-loop.test.ts`

预期：失败，因为 agent loop 尚不存在。

- [x] **步骤 3：实现 loop 和 CLI**

添加有步数上限的循环和简单命令行入口。

- [x] **步骤 4：运行测试确认通过**

运行：`pnpm.cmd test tests/agent-loop.test.ts`

预期：agent loop 测试通过。

### 任务 6：最终验证

**文件：**
- 只修改 `pnpm.cmd build`、`pnpm.cmd test` 或 `pnpm.cmd dev -- --help` 输出中点名的源码或测试文件。

- [x] **步骤 1：构建**

运行：`pnpm.cmd build`

预期：TypeScript 编译以 exit code 0 结束。

- [x] **步骤 2：完整测试**

运行：`pnpm.cmd test`

预期：所有测试通过。

- [x] **步骤 3：不触发 API 调用的 CLI 冒烟测试**

运行：`pnpm.cmd dev -- --help`

预期：打印使用说明，不要求 API 配置。
