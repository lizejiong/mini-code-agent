import { homedir } from 'node:os';
import { join } from 'node:path';

export function getPlansDir(home = homedir()): string {
  return join(home, '.mini-code-agent', 'plans');
}

export function getPlanFilePath(sessionId: string, home = homedir()): string {
  return join(getPlansDir(home), `${sessionId}.md`);
}
