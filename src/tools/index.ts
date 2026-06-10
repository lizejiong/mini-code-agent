import { ZodError } from 'zod';
import type {
  ToolContext,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
} from './types.js';
import { runCommandTool } from './commandTool.js';
import {
  editFileTool,
  globFilesTool,
  grepFilesTool,
  listDirTool,
  readFileTool,
  searchFilesTool,
  writeFileTool,
} from './fileTools.js';

export function createDefaultToolRegistry(context: ToolContext): ToolRegistry {
  return createToolRegistry(
    [
      readFileTool,
      writeFileTool,
      editFileTool,
      searchFilesTool,
      listDirTool,
      globFilesTool,
      grepFilesTool,
      runCommandTool,
    ],
    context,
  );
}

export function createToolRegistry(
  definitions: ToolDefinition[],
  context: ToolContext,
): ToolRegistry {
  const tools = new Map(definitions.map((tool) => [tool.name, tool]));

  return {
    definitions,
    async execute(name: string, input: unknown): Promise<ToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        return { ok: false, error: `Unknown tool: ${name}` };
      }

      try {
        const parsedInput = tool.inputSchema.parse(input);
        return await tool.execute(parsedInput, context);
      } catch (error) {
        if (error instanceof ZodError) {
          return {
            ok: false,
            error: `Invalid input for ${name}: ${error.message}`,
          };
        }

        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
