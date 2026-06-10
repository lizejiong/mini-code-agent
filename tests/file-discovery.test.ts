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
    expect(toPosixRelativePath('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe(
      'src/a.ts',
    );
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
