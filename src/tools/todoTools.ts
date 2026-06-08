import { z } from 'zod';
import type { TodoStore } from '../todos/store.js';
import type { ToolDefinition } from './types.js';

const todoStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

const todoItemSchema = z.object({
  id: z.string().trim().min(1),
  content: z.string().trim().min(1),
  status: todoStatusSchema,
});

const todoReadInput = z.object({});

const todoWriteInput = z.object({
  todos: z.array(todoItemSchema),
});

export function createTodoReadTool(
  todoStore: TodoStore,
): ToolDefinition<typeof todoReadInput> {
  return {
    name: 'todo_read',
    description: 'Read the current session todo list before updating task progress.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    inputSchema: todoReadInput,
    async execute() {
      return {
        ok: true,
        content: JSON.stringify(await todoStore.read(), null, 2),
      };
    },
  };
}

export function createTodoWriteTool(
  todoStore: TodoStore,
): ToolDefinition<typeof todoWriteInput> {
  return {
    name: 'todo_write',
    description:
      'Replace the current session todo list. Use pending, in_progress, and completed to track multi-step work.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
              },
            },
            required: ['id', 'content', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['todos'],
      additionalProperties: false,
    },
    inputSchema: todoWriteInput,
    async execute(input) {
      /**
       * V6 采用整体替换，避免模型在多轮局部更新中把旧状态和新状态合并错。
       */
      const result = await todoStore.write(input.todos);
      if (!result.ok) {
        return result;
      }

      return {
        ok: true,
        content: `${result.content}; summary: ${summarizeForTool(input.todos)}`,
      };
    },
  };
}

function summarizeForTool(items: Array<{ status: string }>): string {
  const pending = items.filter((item) => item.status === 'pending').length;
  const inProgress = items.filter((item) => item.status === 'in_progress').length;
  const completed = items.filter((item) => item.status === 'completed').length;
  return `${inProgress} in_progress / ${pending} pending / ${completed} completed`;
}
