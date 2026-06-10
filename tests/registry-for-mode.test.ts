import { describe, expect, test } from 'vitest';
import type { ModeController } from '../src/modes/types.js';
import type { PlanStore } from '../src/plans/store.js';
import type { TodoStore } from '../src/todos/store.js';
import { createRegistryForMode } from '../src/tools/registryForMode.js';
import type { ToolContext } from '../src/tools/types.js';

function fakeContext(): ToolContext {
  return {
    workspace: {} as never,
    permissions: {} as never,
  };
}

function fakeModeController(mode: 'normal' | 'plan'): ModeController {
  return {
    getMode: () => mode,
    getPlanFilePath: () => 'plan.md',
    enterPlanMode: async () => ({ ok: true, content: 'entered' }),
    exitPlanMode: async () => ({ ok: true, content: 'exited' }),
  };
}

function fakePlanStore(): PlanStore {
  return {
    filePath: 'plan.md',
    read: async () => '# Plan',
    write: async () => ({ ok: true, content: 'written' }),
  };
}

function fakeTodoStore(): TodoStore {
  return {
    filePath: 'todos.json',
    read: async () => [],
    write: async () => ({ ok: true, content: 'written' }),
  };
}

describe('createRegistryForMode', () => {
  test('normal mode exposes execution tools and EnterPlanMode', () => {
    const registry = createRegistryForMode({
      mode: 'normal',
      context: fakeContext(),
      modeController: fakeModeController('normal'),
      planStore: fakePlanStore(),
      todoStore: fakeTodoStore(),
    });

    expect(registry.definitions.map((tool) => tool.name).sort()).toEqual([
      'EnterPlanMode',
      'edit_file',
      'glob_files',
      'grep_files',
      'list_dir',
      'read_file',
      'run_command',
      'search_files',
      'todo_read',
      'todo_write',
      'write_file',
    ]);
  });

  test('plan mode exposes read-only tools, plan tools, and ExitPlanMode', () => {
    const registry = createRegistryForMode({
      mode: 'plan',
      context: fakeContext(),
      modeController: fakeModeController('plan'),
      planStore: fakePlanStore(),
      todoStore: fakeTodoStore(),
    });

    expect(registry.definitions.map((tool) => tool.name).sort()).toEqual([
      'ExitPlanMode',
      'glob_files',
      'grep_files',
      'list_dir',
      'read_file',
      'read_plan',
      'search_files',
      'todo_read',
      'todo_write',
      'write_plan',
    ]);
  });
});
