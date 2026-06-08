import type { AgentMode, ModeController } from '../modes/types.js';
import type { PlanStore } from '../plans/store.js';
import type { TodoStore } from '../todos/store.js';
import { runCommandTool } from './commandTool.js';
import {
  editFileTool,
  readFileTool,
  searchFilesTool,
  writeFileTool,
} from './fileTools.js';
import { createToolRegistry } from './index.js';
import {
  createEnterPlanModeTool,
  createExitPlanModeTool,
  createReadPlanTool,
  createWritePlanTool,
} from './planModeTools.js';
import { createTodoReadTool, createTodoWriteTool } from './todoTools.js';
import type { ToolContext, ToolRegistry } from './types.js';

export function createRegistryForMode(options: {
  mode: AgentMode;
  context: ToolContext;
  modeController: ModeController;
  planStore: PlanStore;
  todoStore: TodoStore;
}): ToolRegistry {
  const shared = [
    readFileTool,
    searchFilesTool,
    createTodoReadTool(options.todoStore),
    createTodoWriteTool(options.todoStore),
  ];
  const tools =
    options.mode === 'plan'
      ? [
          ...shared,
          createReadPlanTool(options.planStore),
          createWritePlanTool(options.planStore),
          createExitPlanModeTool(options.modeController),
        ]
      : [
          ...shared,
          writeFileTool,
          editFileTool,
          runCommandTool,
          createEnterPlanModeTool(options.modeController),
        ];

  return createToolRegistry(tools, options.context);
}
