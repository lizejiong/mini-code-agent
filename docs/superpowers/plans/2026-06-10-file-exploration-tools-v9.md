# V9 File Exploration Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `list_dir`、`glob_files`、`grep_files` 三个只读文件探索工具，补齐 Claude Code 风格的 `Glob -> Grep -> Read -> Edit` 工作流。

**Architecture:** 新增 `src/tools/fileDiscovery.ts` 承担可复用的目录遍历、路径归一化、glob 匹配和文本搜索辅助逻辑；`src/tools/fileTools.ts` 只负责工具 schema、参数说明和调用 helper；registry 将三个工具加入 normal/plan shared 工具列表。

**Tech Stack:** TypeScript、Node `fs/promises`、Vitest、现有 ToolRegistry / Workspace 抽象。

---

## File Structure

- Create: `src/tools/fileDiscovery.ts`
- Modify: `src/tools/fileTools.ts`
- Modify: `src/tools/registryForMode.ts`
- Modify: `src/ui/formatters.ts`
- Create: `tests/file-discovery.test.ts`
- Modify: `tests/tools.test.ts`
- Modify: `tests/registry-for-mode.test.ts`
- Modify: `tests/ui-formatters.test.ts`

### Task 1: File Discovery Helpers

**Files:**
- Create: `src/tools/fileDiscovery.ts`
- Test: `tests/file-discovery.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tests/file-discovery.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  collectWorkspaceFiles,
  matchesGlob,
  toPosixRelativePath,
} from '../src/tools/fileDiscovery.js';

describe('file discovery helpers', () => {
  test('collects workspace files and skips generated directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-discovery-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, 'src', 'index.ts'), '', 'utf8');
    await writeFile(join(root, 'node_modules', 'pkg', 'index.ts'), '', 'utf8');
    await writeFile(join(root, 'dist', 'index.js'), '', 'utf8');
    await writeFile(join(root, '.git', 'config'), '', 'utf8');

    await expect(collectWorkspaceFiles(root)).resolves.toEqual(['src/index.ts']);
  });

  test('converts paths to posix relative paths', () => {
    expect(toPosixRelativePath('C:\\\\repo', 'C:\\\\repo\\\\src\\\\a.ts')).toBe('src/a.ts');
  });

  test('matches single-segment star patterns', () => {
    expect(matchesGlob('src/app.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/nested/app.ts', 'src/*.ts')).toBe(false);
  });

  test('matches double-star patterns across directories', () => {
    expect(matchesGlob('src/app.ts', 'src/**/*.ts')).toBe(true);
    expect(matchesGlob('src/nested/app.ts', 'src/**/*.ts')).toBe(true);
  });

  test('matches question mark as one character', () => {
    expect(matchesGlob('src/a.ts', 'src/?.ts')).toBe(true);
    expect(matchesGlob('src/ab.ts', 'src/?.ts')).toBe(false);
  });
});
```

- [ ] **Step 2: Run helper tests to verify RED**

Run:

```bash
pnpm.cmd test tests/file-discovery.test.ts
```

Expected: fail because `src/tools/fileDiscovery.ts` does not exist.

- [ ] **Step 3: Implement helper module**

Create `src/tools/fileDiscovery.ts` with:

- `SKIPPED_DISCOVERY_DIRECTORIES`
- `MAX_DISCOVERY_FILES`
- `MAX_GREP_FILE_BYTES`
- `toPosixRelativePath(root, absolutePath)`
- `collectWorkspaceFiles(root, options?)`
- `matchesGlob(path, pattern)`
- `globToRegExp(pattern)`

Implementation notes:

- Use `readdir(..., { withFileTypes: true })`.
- Skip unreadable directories with `try/catch`.
- Sort output paths.
- Convert `\` to `/`.
- Convert glob to RegExp manually:
  - `*` -> `[^/]*`
  - `**/` -> `(?:.*/)?`
  - `**` -> `.*`
  - `?` -> `[^/]`
  - escape regex special chars.

- [ ] **Step 4: Run helper tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/file-discovery.test.ts
```

Expected: pass.

### Task 2: list_dir Tool

**Files:**
- Modify: `src/tools/fileTools.ts`
- Modify Test: `tests/tools.test.ts`

- [ ] **Step 1: Add failing list_dir tests**

Add tests to `tests/tools.test.ts`:

- `list_dir lists directories before files`
- `list_dir reports non-directory targets`
- `list_dir skips generated directories`

- [ ] **Step 2: Run tools tests to verify RED**

Run:

```bash
pnpm.cmd test tests/tools.test.ts
```

Expected: fail because `list_dir` is not registered.

- [ ] **Step 3: Implement list_dir**

In `src/tools/fileTools.ts`:

- add `listDirInput`
- export `listDirTool`
- use `resolvePath`, `realpath`, `assertInside`
- use `readdir` and `stat`
- format output as `dir  name` and `file name`
- return `ok: false` when target is not a directory

- [ ] **Step 4: Run tools tests to verify GREEN for list_dir**

Run:

```bash
pnpm.cmd test tests/tools.test.ts
```

Expected: list_dir tests pass.

### Task 3: glob_files Tool

**Files:**
- Modify: `src/tools/fileTools.ts`
- Modify Test: `tests/tools.test.ts`

- [ ] **Step 1: Add failing glob_files tests**

Add tests to `tests/tools.test.ts`:

- `glob_files matches recursive TypeScript files`
- `glob_files respects limit`
- `glob_files skips generated directories`

- [ ] **Step 2: Run tools tests to verify RED**

Run:

```bash
pnpm.cmd test tests/tools.test.ts
```

Expected: fail because `glob_files` is not registered.

- [ ] **Step 3: Implement glob_files**

In `src/tools/fileTools.ts`:

- add `globFilesInput`
- export `globFilesTool`
- call `collectWorkspaceFiles(context.workspace.root)`
- filter with `matchesGlob`
- slice by `limit`
- return newline-separated matches

- [ ] **Step 4: Run tools tests to verify GREEN for glob_files**

Run:

```bash
pnpm.cmd test tests/tools.test.ts
```

Expected: glob_files tests pass.

### Task 4: grep_files Tool

**Files:**
- Modify: `src/tools/fileTools.ts`
- Modify Test: `tests/tools.test.ts`

- [ ] **Step 1: Add failing grep_files tests**

Add tests to `tests/tools.test.ts`:

- `grep_files finds literal text with line numbers`
- `grep_files supports regex search`
- `grep_files filters candidate files by glob`
- `grep_files reports invalid regex`
- `grep_files respects limit`

- [ ] **Step 2: Run tools tests to verify RED**

Run:

```bash
pnpm.cmd test tests/tools.test.ts
```

Expected: fail because `grep_files` is not registered.

- [ ] **Step 3: Implement grep_files**

In `src/tools/fileTools.ts`:

- add `grepFilesInput`
- export `grepFilesTool`
- collect candidate files
- optionally filter by `glob`
- skip files above `MAX_GREP_FILE_BYTES`
- read files as UTF-8
- for literal search, support case-insensitive mode by lowercasing line and pattern
- for regex search, construct `RegExp` with `i` flag unless `case_sensitive`
- format matches as `path:line: preview`
- catch invalid regex and return `ok: false`

- [ ] **Step 4: Run tools tests to verify GREEN for grep_files**

Run:

```bash
pnpm.cmd test tests/tools.test.ts
```

Expected: grep_files tests pass.

### Task 5: Registry and Formatter

**Files:**
- Modify: `src/tools/registryForMode.ts`
- Modify: `src/tools/index.ts`
- Modify: `src/ui/formatters.ts`
- Modify Test: `tests/registry-for-mode.test.ts`
- Modify Test: `tests/ui-formatters.test.ts`

- [ ] **Step 1: Add failing registry and formatter tests**

Update registry tests so normal and plan mode include:

- `list_dir`
- `glob_files`
- `grep_files`

Update formatter tests for:

- `list_dir src/tools`
- `glob_files src/**/*.ts`
- `grep_files compactConversation in src/**/*.ts`

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
pnpm.cmd test tests/registry-for-mode.test.ts tests/ui-formatters.test.ts
```

Expected: fail because tools are not imported/registered/formatted.

- [ ] **Step 3: Register and format tools**

Update:

- `src/tools/index.ts` default registry list.
- `src/tools/registryForMode.ts` shared list.
- `src/ui/formatters.ts` `formatToolCall` cases.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
pnpm.cmd test tests/registry-for-mode.test.ts tests/ui-formatters.test.ts
```

Expected: pass.

### Task 6: Final Verification and Commit

**Files:**
- All changed files.

- [ ] **Step 1: Run focused V9 tests**

Run:

```bash
pnpm.cmd test tests/file-discovery.test.ts tests/tools.test.ts tests/registry-for-mode.test.ts tests/ui-formatters.test.ts
```

Expected: pass.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm.cmd test
```

Expected: all tests pass.

- [ ] **Step 3: Run build**

Run:

```bash
pnpm.cmd build
```

Expected: TypeScript build exits 0.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add -A
git commit -m "feat: add file exploration tools v9"
```

Expected: commit succeeds on `codex/file-exploration-v9`.

## Self-Review

- Spec coverage: `list_dir` is covered in Task 2; `glob_files` in Task 3; `grep_files` in Task 4; shared registration in Task 5; helper behavior and skip rules in Task 1.
- 未完成标记扫描：没有遗留未完成标记。
- Type consistency: tool names are consistently `list_dir`, `glob_files`, `grep_files`; input names are `path`, `pattern`, `glob`, `regex`, `case_sensitive`, `limit`.
