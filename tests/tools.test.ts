import { mkdtempSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createWorkspace } from '../src/workspace.js';
import { createDefaultToolRegistry } from '../src/tools/index.js';
import type { PermissionController } from '../src/permissions.js';

function testPermissions(overrides: Partial<PermissionController> = {}): PermissionController {
  return {
    approveWriteFile: async () => true,
    approveRunCommand: async () => true,
    ...overrides,
  };
}

async function createRegistry(root: string, permissions = testPermissions()) {
  const workspace = await createWorkspace(root);
  return createDefaultToolRegistry({ workspace, permissions });
}

describe('local tools', () => {
  test('read_file returns file contents from the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'note.txt'), 'hello', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('read_file', { path: 'note.txt' });

    expect(result).toEqual({ ok: true, content: 'hello' });
  });

  test('write_file writes approved content inside the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    const registry = await createRegistry(root);

    const result = await registry.execute('write_file', {
      path: 'src/output.txt',
      content: 'created',
    });

    await expect(readFile(join(root, 'src/output.txt'), 'utf8')).resolves.toBe(
      'created',
    );
    expect(result).toEqual({
      ok: true,
      content: 'Wrote 7 bytes to src/output.txt',
    });
  });

  test('write_file reports denial without changing the file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'existing.txt'), 'before', 'utf8');
    const registry = await createRegistry(
      root,
      testPermissions({ approveWriteFile: async () => false }),
    );

    const result = await registry.execute('write_file', {
      path: 'existing.txt',
      content: 'after',
    });

    await expect(readFile(join(root, 'existing.txt'), 'utf8')).resolves.toBe(
      'before',
    );
    expect(result).toEqual({
      ok: false,
      error: 'User denied write_file for existing.txt',
    });
  });

  test('edit_file replaces a unique text fragment', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'example.ts'), 'const name = "old";\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('edit_file', {
      path: 'src/example.ts',
      old_text: '"old"',
      new_text: '"new"',
    });

    await expect(readFile(join(root, 'src', 'example.ts'), 'utf8')).resolves.toBe(
      'const name = "new";\n',
    );
    expect(result).toEqual({
      ok: true,
      content: 'Edited src/example.ts (lines 1-1)',
    });
  });

  test('edit_file reports when the old text is not found', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'example.ts'), 'const name = "old";\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('edit_file', {
      path: 'example.ts',
      old_text: '"missing"',
      new_text: '"new"',
    });

    await expect(readFile(join(root, 'example.ts'), 'utf8')).resolves.toBe(
      'const name = "old";\n',
    );
    expect(result).toEqual({
      ok: false,
      error: 'old_text not found in example.ts',
    });
  });

  test('edit_file rejects non-unique old text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'example.ts'), 'same\nsame\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('edit_file', {
      path: 'example.ts',
      old_text: 'same',
      new_text: 'changed',
    });

    await expect(readFile(join(root, 'example.ts'), 'utf8')).resolves.toBe(
      'same\nsame\n',
    );
    expect(result).toEqual({
      ok: false,
      error: 'old_text appears 2 times in example.ts; provide a larger unique fragment',
    });
  });

  test('edit_file deletes text when new_text is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'example.ts'), 'keep\nremove me\nkeep\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('edit_file', {
      path: 'example.ts',
      old_text: 'remove me\n',
      new_text: '',
    });

    await expect(readFile(join(root, 'example.ts'), 'utf8')).resolves.toBe(
      'keep\nkeep\n',
    );
    expect(result).toEqual({
      ok: true,
      content: 'Edited example.ts (lines 2-2)',
    });
  });

  test('edit_file reports denial without changing the file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'example.ts'), 'before\n', 'utf8');
    const registry = await createRegistry(
      root,
      testPermissions({ approveWriteFile: async () => false }),
    );

    const result = await registry.execute('edit_file', {
      path: 'example.ts',
      old_text: 'before',
      new_text: 'after',
    });

    await expect(readFile(join(root, 'example.ts'), 'utf8')).resolves.toBe(
      'before\n',
    );
    expect(result).toEqual({
      ok: false,
      error: 'User denied edit_file for example.ts',
    });
  });

  test('edit_file replaces multiline fragments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'example.ts'), 'before\nold\nblock\nafter\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('edit_file', {
      path: 'example.ts',
      old_text: 'old\nblock',
      new_text: 'new\nblock',
    });

    await expect(readFile(join(root, 'example.ts'), 'utf8')).resolves.toBe(
      'before\nnew\nblock\nafter\n',
    );
    expect(result).toEqual({
      ok: true,
      content: 'Edited example.ts (lines 2-3)',
    });
  });

  test('search_files lists matching file paths and respects the limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'alpha.ts'), '', 'utf8');
    await writeFile(join(root, 'src', 'beta.ts'), '', 'utf8');
    await writeFile(join(root, 'README.md'), '', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('search_files', {
      query: '.ts',
      limit: 1,
    });

    expect(result).toEqual({ ok: true, content: 'src/alpha.ts' });
  });

  test('search_files skips generated, dependency, and git directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, 'dist', 'src'), { recursive: true });
    await mkdir(join(root, '.git', 'hooks'), { recursive: true });
    await writeFile(join(root, 'src', 'tool.ts'), '', 'utf8');
    await writeFile(join(root, 'node_modules', 'pkg', 'tool.ts'), '', 'utf8');
    await writeFile(join(root, 'dist', 'src', 'tool.ts'), '', 'utf8');
    await writeFile(join(root, '.git', 'hooks', 'tool.ts'), '', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('search_files', {
      query: 'tool.ts',
      limit: 20,
    });

    expect(result).toEqual({ ok: true, content: 'src/tool.ts' });
  });

  test('list_dir lists directories before files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'b-dir'), { recursive: true });
    await mkdir(join(root, 'a-dir'), { recursive: true });
    await writeFile(join(root, 'z.txt'), '', 'utf8');
    await writeFile(join(root, 'a.txt'), '', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('list_dir', {
      path: '.',
      limit: 10,
    });

    expect(result).toEqual({
      ok: true,
      content: 'dir  a-dir\ndir  b-dir\nfile a.txt\nfile z.txt',
    });
  });

  test('list_dir reports non-directory targets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'note.txt'), 'hello', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('list_dir', {
      path: 'note.txt',
    });

    expect(result).toEqual({
      ok: false,
      error: 'list_dir target is not a directory: note.txt',
    });
  });

  test('list_dir skips generated directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    const registry = await createRegistry(root);

    const result = await registry.execute('list_dir', {
      path: '.',
      limit: 20,
    });

    expect(result).toEqual({ ok: true, content: 'dir  src' });
  });

  test('glob_files matches recursive TypeScript files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src', 'nested'), { recursive: true });
    await writeFile(join(root, 'src', 'index.ts'), '', 'utf8');
    await writeFile(join(root, 'src', 'nested', 'tool.ts'), '', 'utf8');
    await writeFile(join(root, 'README.md'), '', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('glob_files', {
      pattern: 'src/**/*.ts',
    });

    expect(result).toEqual({
      ok: true,
      content: 'src/index.ts\nsrc/nested/tool.ts',
    });
  });

  test('glob_files respects limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'a.txt'), '', 'utf8');
    await writeFile(join(root, 'b.txt'), '', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('glob_files', {
      pattern: '*.txt',
      limit: 1,
    });

    expect(result).toEqual({ ok: true, content: 'a.txt' });
  });

  test('glob_files skips generated directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, 'src', 'tool.ts'), '', 'utf8');
    await writeFile(join(root, 'node_modules', 'pkg', 'tool.ts'), '', 'utf8');
    await writeFile(join(root, 'dist', 'tool.ts'), '', 'utf8');
    await writeFile(join(root, '.git', 'tool.ts'), '', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('glob_files', {
      pattern: '**/*.ts',
      limit: 20,
    });

    expect(result).toEqual({ ok: true, content: 'src/tool.ts' });
  });

  test('grep_files finds literal text with line numbers', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'first\nNeedle here\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('grep_files', {
      pattern: 'needle',
      glob: 'src/**/*.ts',
    });

    expect(result).toEqual({
      ok: true,
      content: 'src/a.ts:2: Needle here',
    });
  });

  test('grep_files supports regex search', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'const answer = 42;\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('grep_files', {
      pattern: 'const\\s+\\w+',
      regex: true,
      case_sensitive: true,
    });

    expect(result).toEqual({
      ok: true,
      content: 'src/a.ts:1: const answer = 42;',
    });
  });

  test('grep_files filters candidate files by glob', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'src', 'a.ts'), 'target\n', 'utf8');
    await writeFile(join(root, 'docs', 'a.md'), 'target\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('grep_files', {
      pattern: 'target',
      glob: 'src/**/*.ts',
    });

    expect(result).toEqual({ ok: true, content: 'src/a.ts:1: target' });
  });

  test('grep_files reports invalid regex', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    const registry = await createRegistry(root);

    const result = await registry.execute('grep_files', {
      pattern: '[',
      regex: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Invalid regex for grep_files');
    }
  });

  test('grep_files respects limit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'a.txt'), 'same\n', 'utf8');
    await writeFile(join(root, 'b.txt'), 'same\n', 'utf8');
    const registry = await createRegistry(root);

    const result = await registry.execute('grep_files', {
      pattern: 'same',
      limit: 1,
    });

    expect(result).toEqual({ ok: true, content: 'a.txt:1: same' });
  });

  test('grep_files skips binary files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    await writeFile(join(root, 'text.txt'), 'needle\n', 'utf8');
    await writeFile(join(root, 'image.bin'), Buffer.from([0, 110, 101, 101, 100, 108, 101]));
    const registry = await createRegistry(root);

    const result = await registry.execute('grep_files', {
      pattern: 'needle',
    });

    expect(result).toEqual({ ok: true, content: 'text.txt:1: needle' });
  });

  test('run_command executes approved commands in the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    const registry = await createRegistry(root);

    const result = await registry.execute('run_command', {
      command: `"${process.execPath}" -e "process.stdout.write(process.cwd())"`,
    });

    if (!result.ok) {
      throw new Error(result.error);
    }

    expect(result.content).toBe(root);
  });

  test('run_command reports denial without executing the command', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-tools-'));
    const registry = await createRegistry(
      root,
      testPermissions({ approveRunCommand: async () => false }),
    );

    const result = await registry.execute('run_command', {
      command: `"${process.execPath}" -e "process.stdout.write('should-not-run')"`,
    });

    expect(result).toEqual({
      ok: false,
      error: 'User denied run_command',
    });
  });
});
