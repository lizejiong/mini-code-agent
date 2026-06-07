import { z } from 'zod';
import type { ModeController } from '../modes/types.js';
import type { PlanStore } from '../plans/store.js';
import type { ToolDefinition } from './types.js';

const emptyInput = z.object({});

const writePlanInput = z.object({
  content: z.string(),
});

export function createEnterPlanModeTool(
  modeController: ModeController,
): ToolDefinition<typeof emptyInput> {
  return {
    name: 'EnterPlanMode',
    description: 'Enter read-only planning mode before implementing a non-trivial task.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    inputSchema: emptyInput,
    async execute() {
      return modeController.enterPlanMode();
    },
  };
}

export function createExitPlanModeTool(
  modeController: ModeController,
): ToolDefinition<typeof emptyInput> {
  return {
    name: 'ExitPlanMode',
    description: 'Request user approval for the current plan and exit plan mode if approved.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    inputSchema: emptyInput,
    async execute() {
      return modeController.exitPlanMode();
    },
  };
}

export function createReadPlanTool(planStore: PlanStore): ToolDefinition<typeof emptyInput> {
  return {
    name: 'read_plan',
    description: 'Read the current session plan file.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    inputSchema: emptyInput,
    async execute() {
      return {
        ok: true,
        content: await planStore.read(),
      };
    },
  };
}

export function createWritePlanTool(
  planStore: PlanStore,
): ToolDefinition<typeof writePlanInput> {
  return {
    name: 'write_plan',
    description: 'Overwrite the current session plan file with complete Markdown content.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Complete Markdown plan content for the current session.',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
    inputSchema: writePlanInput,
    async execute(input) {
      return planStore.write(input.content);
    },
  };
}
