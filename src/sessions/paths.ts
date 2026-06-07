import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export function getSessionsHome(home = homedir()): string {
  return join(home, '.mini-code-agent');
}

export function getProjectSessionsDir(cwd: string, home = homedir()): string {
  const normalizedCwd = resolve(cwd);
  const readableName = sanitizePathPart(basename(normalizedCwd)) || 'workspace';
  const hash = createHash('sha1').update(normalizedCwd.toLowerCase()).digest('hex').slice(0, 10);

  /**
   * 目录名同时保留可读项目名和短哈希：前者方便人工定位，后者避免同名项目互相覆盖。
   */
  return join(getSessionsHome(home), 'projects', `${readableName}-${hash}`);
}

export function getSessionFilePath(cwd: string, sessionId: string, home = homedir()): string {
  return join(getProjectSessionsDir(cwd, home), `${sessionId}.jsonl`);
}

function sanitizePathPart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
