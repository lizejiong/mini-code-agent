import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const execAsync = promisify(exec);

const runCommandInput = z.object({
  command: z.string().min(1),
});

export const runCommandTool: ToolDefinition<typeof runCommandInput> = {
  name: 'run_command',
  description: 'Run a shell command in the workspace after approval.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute from the workspace root.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  inputSchema: runCommandInput,
  async execute(input, context) {
    const approved = await context.permissions.approveRunCommand(input.command);
    if (!approved) {
      return {
        ok: false,
        error: 'User denied run_command',
      };
    }

    try {
      const { stdout, stderr } = await execAsync(input.command, {
        cwd: context.workspace.root,
        timeout: 30_000,
        windowsHide: true,
      });

      /**
       * 同时返回 stdout 和 stderr，因为很多 CLI 即使命令成功，也会把进度或警告打印到 stderr。
       */
      const content = [stdout, stderr].filter(Boolean).join('\n').trimEnd();
      return { ok: true, content };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
