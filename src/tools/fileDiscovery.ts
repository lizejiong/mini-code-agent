import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const SKIPPED_DISCOVERY_DIRECTORIES = new Set([
  '.git',
  'dist',
  'node_modules',
]);

export const MAX_DISCOVERY_FILES = 5_000;
export const MAX_GREP_FILE_BYTES = 1_000_000;

export type CollectWorkspaceFilesOptions = {
  limit?: number;
  skipDirectories?: Set<string>;
};

export async function collectWorkspaceFiles(
  root: string,
  options: CollectWorkspaceFilesOptions = {},
): Promise<string[]> {
  const limit = options.limit ?? MAX_DISCOVERY_FILES;
  const skipDirectories =
    options.skipDirectories ?? SKIPPED_DISCOVERY_DIRECTORIES;
  const pending = [''];
  const files: string[] = [];

  while (pending.length > 0 && files.length < limit) {
    const current = pending.shift()!;
    const absoluteCurrent = current ? join(root, current) : root;
    let entries;

    try {
      entries = await readdir(absoluteCurrent, { withFileTypes: true });
    } catch {
      /** 遍历工具面向探索场景，遇到不可读目录时跳过比中断整个搜索更实用。 */
      continue;
    }

    for (const entry of entries) {
      const relativePath = current ? `${current}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (!skipDirectories.has(entry.name)) {
          pending.push(relativePath);
        }
        continue;
      }

      if (entry.isFile()) {
        files.push(toPosixRelativePath(root, join(absoluteCurrent, entry.name)));
      }

      if (files.length >= limit) {
        break;
      }
    }
  }

  return files.sort();
}

export function toPosixRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(/[\\/]+/).join('/');
}

export function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(normalizeGlobPath(path));
}

export function globToRegExp(pattern: string): RegExp {
  const normalizedPattern = normalizeGlobPath(pattern);
  let source = '^';
  let index = 0;

  while (index < normalizedPattern.length) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];
    const afterNext = normalizedPattern[index + 2];

    if (char === '*' && next === '*') {
      if (afterNext === '/') {
        /** 双星加斜杠允许匹配零层或多层目录，保证递归模式也能命中当前目录文件。 */
        source += '(?:.*/)?';
        index += 3;
        continue;
      }

      source += '.*';
      index += 2;
      continue;
    }

    if (char === '*') {
      source += '[^/]*';
      index += 1;
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      index += 1;
      continue;
    }

    source += escapeRegExp(char);
    index += 1;
  }

  return new RegExp(`${source}$`);
}

function normalizeGlobPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
