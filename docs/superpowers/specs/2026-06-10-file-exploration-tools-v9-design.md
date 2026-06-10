# V9 文件探索工具集设计文档

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

下一步继续参考 `D:\code\coding\claude-code-sourcemap`，补齐 Claude Code 常用的代码探索链路：

```text
Glob -> Grep -> Read -> Edit
```

当前项目已经有 `read_file`、`edit_file`、`write_file` 和 `search_files`。其中 `search_files` 只能按路径子串匹配文件，不能按 glob 模式定位文件，也不能按文件内容搜索代码。V9 的目标是补齐“找文件”和“搜内容”这两个只读探索能力，让 agent 在修改代码前更稳定地定位相关文件。

## 目标

- 新增 `list_dir` 工具，用于列出工作区内目录内容。
- 新增 `glob_files` 工具，用于按 glob 模式查找文件。
- 新增 `grep_files` 工具，用于按文本或正则搜索文件内容。
- 三个工具均为只读工具，不需要用户审批。
- 三个工具在 normal mode 和 plan mode 都可用。
- 统一跳过 `.git`、`node_modules`、`dist` 等无关目录。
- 输出限制数量，避免大仓库返回过多内容。
- 保留现有 `search_files`，避免破坏已有功能；V9 新工具是增强，不是替换。
- 继续使用中文 JSDoc 风格注释解释关键逻辑。

## 非目标

- 不实现 LSP / symbol search。
- 不实现语义搜索或向量索引。
- 不实现完整 `.gitignore` 解析。
- 不引入复杂 slash command 框架。
- 不做 diff 预览。
- 不做 TUI 内权限审批。
- 不修改 `read_file` / `edit_file` 的行为。
- 不依赖外部网络。

## 工具设计

### `list_dir`

输入：

```ts
{
  path: string;
  limit?: number;
}
```

默认值：

- `path`：调用方必须传入，可用 `"."` 表示工作区根目录。
- `limit`：默认 `100`，最大 `200`。

输出示例：

```text
dir  src
dir  tests
file package.json
file tsconfig.json
```

行为：

1. 使用 `context.workspace.resolvePath(path)` 解析路径。
2. 使用 `realpath` 和 `context.workspace.assertInside()` 防止路径逃逸。
3. 读取目录项。
4. 跳过 `.git`、`node_modules`、`dist`。
5. 目录排在文件前，名称按字母排序。
6. 输出最多 `limit` 条。
7. 如果目标不是目录，返回 `ok: false`。

### `glob_files`

输入：

```ts
{
  pattern: string;
  limit?: number;
}
```

默认值：

- `limit`：默认 `100`，最大 `500`。

示例：

```json
{
  "pattern": "src/**/*.ts"
}
```

输出示例：

```text
src/agent/loop.ts
src/tools/fileTools.ts
src/tools/registryForMode.ts
```

行为：

1. 递归遍历工作区文件。
2. 跳过 `.git`、`node_modules`、`dist`。
3. 将路径统一为 POSIX 风格。
4. 用轻量 glob 匹配支持：
   - `*`：匹配单段路径中的任意字符。
   - `**`：匹配多级目录。
   - `?`：匹配单个字符。
5. 按路径排序。
6. 输出最多 `limit` 条。

V9 先不引入 `fast-glob`，原因是当前项目依赖少，学习版可以先用本地实现理解 glob 基本原理。后续如果需要更完整的 brace、extglob、ignore 规则，再替换为成熟库。

### `grep_files`

输入：

```ts
{
  pattern: string;
  glob?: string;
  regex?: boolean;
  case_sensitive?: boolean;
  limit?: number;
}
```

默认值：

- `glob`：不传时搜索全部可扫描文本文件。
- `regex`：默认 `false`，按普通文本搜索。
- `case_sensitive`：默认 `false`。
- `limit`：默认 `50`，最大 `200`。

示例：

```json
{
  "pattern": "compactConversation",
  "glob": "src/**/*.ts"
}
```

输出示例：

```text
src/compact/service.ts:22: export async function compactConversation(options: {
tests/compact-service.test.ts:2:   compactConversation,
```

行为：

1. 优先复用 V9 的文件收集和 glob 匹配逻辑得到候选文件。
2. 跳过明显二进制文件和过大的文件。
3. 逐行搜索内容。
4. 普通文本模式使用 `includes`；正则模式使用 `RegExp`。
5. 每条结果包含相对路径、行号和去掉首尾空白的预览。
6. 输出最多 `limit` 条。
7. 如果正则非法，返回 `ok: false`。

V9 不强制依赖本机 `rg`，原因是 Windows 环境下 `rg` 是否存在不一定稳定；先用 Node 实现可测试、可移植的版本。后续可以加“优先 `rg`、失败回退 Node”的优化。

## 文件组织

新增：

```text
src/tools/fileDiscovery.ts
```

职责：

- 目录跳过规则。
- 工作区文件递归收集。
- POSIX 相对路径转换。
- glob 匹配。
- 文本文件和大小过滤。

修改：

```text
src/tools/fileTools.ts
src/tools/registryForMode.ts
src/ui/formatters.ts
```

说明：

- `fileTools.ts` 新增三个工具定义。
- `registryForMode.ts` 把三个工具加入 shared 工具列表，使 plan/normal 都可用。
- `formatters.ts` 增加工具调用摘要，TUI 显示更清晰。

## 安全设计

- 所有输入路径都通过 workspace 解析和 `assertInside` 校验。
- `list_dir` 只读取目录，不读取文件内容。
- `glob_files` 只返回路径。
- `grep_files` 只读取工作区内文件内容。
- 默认跳过依赖、构建产物和 Git 内部目录。
- 限制遍历文件数、文件大小和输出结果数，避免一次工具调用返回过大内容。

建议常量：

```ts
MAX_DISCOVERY_FILES = 5000
MAX_GREP_FILE_BYTES = 1_000_000
SKIPPED_DISCOVERY_DIRECTORIES = ['.git', 'node_modules', 'dist']
```

## 错误处理

- `list_dir` 路径不存在：返回 `ok: false`。
- `list_dir` 目标不是目录：返回 `ok: false`。
- `glob_files` pattern 为空：schema 拒绝。
- `grep_files` pattern 为空：schema 拒绝。
- `grep_files` 正则非法：返回 `ok: false`，提示非法正则。
- 遍历中遇到不可读文件或目录：跳过，不中断整个搜索。
- 没有匹配结果：返回 `ok: true`，content 为空字符串。

## 测试策略

### `fileDiscovery` 测试

- 递归收集文件，跳过 `.git`、`node_modules`、`dist`。
- 路径输出统一为 POSIX 风格。
- `*` 只匹配单段路径。
- `**` 匹配多级目录。
- `?` 匹配单个字符。

### 工具测试

- `list_dir` 能列目录，并区分 `dir` / `file`。
- `list_dir` 拒绝工作区外路径。
- `glob_files` 能匹配 `src/**/*.ts`。
- `glob_files` 遵守 `limit`。
- `grep_files` 能按普通文本搜索。
- `grep_files` 能按正则搜索。
- `grep_files` 支持 `glob` 限定文件范围。
- `grep_files` 非法正则返回失败。
- `grep_files` 跳过二进制或大文件。

### Registry 测试

- normal mode 暴露 `list_dir`、`glob_files`、`grep_files`。
- plan mode 暴露 `list_dir`、`glob_files`、`grep_files`。

### Formatter 测试

- `list_dir` 工具调用摘要显示路径。
- `glob_files` 工具调用摘要显示 pattern。
- `grep_files` 工具调用摘要显示 pattern 和 glob。

### Build

- `pnpm.cmd test`
- `pnpm.cmd build`

## 后续演进

- V10 可以做 diff 预览，让写文件和编辑前展示改动。
- 后续可以把 `grep_files` 改为优先调用 `rg`，并保留 Node fallback。
- 后续可以支持 `.gitignore`。
- 后续可以新增 LSP / symbol search。
- 后续可以在 compact 后恢复最近探索过的文件列表。

## 自审记录

- 范围聚焦在只读文件探索工具。
- `list_dir`、`glob_files`、`grep_files` 都有明确输入输出和错误处理。
- 设计不依赖网络或外部服务。
- normal / plan mode 都可用，符合只读工具定位。
- 没有混入权限审批、diff、slash command 或 LSP。
