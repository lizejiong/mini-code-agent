import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ToolResult } from '../tools/types.js';
import { getPlanFilePath } from './paths.js';

export type PlanStore = {
  filePath: string;
  read(): Promise<string>;
  write(content: string): Promise<ToolResult>;
};

export function createPlanStore(options: { sessionId: string; home?: string }): PlanStore {
  const filePath = getPlanFilePath(options.sessionId, options.home);

  return {
    filePath,
    async read() {
      try {
        return await readFile(filePath, 'utf8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return '';
        }

        throw error;
      }
    },
    async write(content) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
      return {
        ok: true,
        content: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${filePath}`,
      };
    },
  };
}
