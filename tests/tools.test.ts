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
