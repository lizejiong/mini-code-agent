import type { z } from 'zod';
import type { PermissionController } from '../permissions.js';
import type { Workspace } from '../workspace.js';

export type ToolResult =
  | {
      ok: true;
      content: string;
    }
  | {
      ok: false;
      error: string;
    };

export type ToolContext = {
  workspace: Workspace;
  permissions: PermissionController;
};

export type ToolDefinition<InputSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  inputSchema: InputSchema;
  execute(input: z.infer<InputSchema>, context: ToolContext): Promise<ToolResult>;
};

export type ToolRegistry = {
  definitions: ToolDefinition[];
  execute(name: string, input: unknown): Promise<ToolResult>;
};
