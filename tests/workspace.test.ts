import { mkdtempSync } from 'node:fs';
import { realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createWorkspace } from '../src/workspace.js';

describe('createWorkspace', () => {
  test('resolves relative paths inside the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-workspace-'));
    const workspace = await createWorkspace(root);

    await expect(workspace.resolvePath('src/index.ts')).resolves.toBe(
      resolve(root, 'src/index.ts'),
    );
  });

  test('rejects paths outside the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-workspace-'));
    const workspace = await createWorkspace(root);

    await expect(workspace.resolvePath('../outside.txt')).rejects.toThrow(
      'Path escapes workspace',
    );
  });

  test('rejects symlinks that resolve outside the workspace root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-workspace-'));
    const outside = mkdtempSync(join(tmpdir(), 'mini-agent-outside-'));
    const outsideFile = join(outside, 'secret.txt');
    await writeFile(outsideFile, 'secret', 'utf8');

    const workspace = await createWorkspace(root);
    const normalizedOutside = await realpath(outsideFile);

    await expect(workspace.assertInside(normalizedOutside)).rejects.toThrow(
      'Path escapes workspace',
    );
  });
});
