import { describe, expect, test } from 'vitest';
import { createModeController } from '../src/modes/controller.js';
import type { PlanStore } from '../src/plans/store.js';
import type { TranscriptEntry } from '../src/sessions/transcript.js';

function planStore(content = '# Plan'): PlanStore {
  return {
    filePath: 'C:\\Users\\lzj\\.mini-code-agent\\plans\\session.md',
    read: async () => content,
    write: async () => ({ ok: true as const, content: 'written' }),
  };
}

describe('mode controller', () => {
  test('enters plan mode and records the mode transition', async () => {
    const entries: TranscriptEntry[] = [];
    const controller = createModeController({
      initialMode: 'normal',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      planStore: planStore(),
      approvePlan: async () => true,
      recordTranscriptEntry: async (entry) => {
        entries.push(entry);
      },
    });

    await expect(controller.enterPlanMode()).resolves.toEqual({
      ok: true,
      content: expect.stringContaining('Entered plan mode'),
    });
    expect(controller.getMode()).toBe('plan');
    expect(entries[0]).toMatchObject({
      type: 'mode',
      mode: 'plan',
      reason: 'enter_plan',
    });
  });

  test('exits plan mode after approval and records approval', async () => {
    const entries: TranscriptEntry[] = [];
    const controller = createModeController({
      initialMode: 'plan',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      planStore: planStore('# Approved Plan'),
      approvePlan: async () => true,
      recordTranscriptEntry: async (entry) => {
        entries.push(entry);
      },
    });

    await expect(controller.exitPlanMode()).resolves.toEqual({
      ok: true,
      content: expect.stringContaining('User approved the plan'),
    });
    expect(controller.getMode()).toBe('normal');
    expect(entries[0]).toMatchObject({
      type: 'mode',
      mode: 'normal',
      reason: 'exit_plan_approved',
    });
  });

  test('stays in plan mode when approval is rejected', async () => {
    const controller = createModeController({
      initialMode: 'plan',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      planStore: planStore('# Rejected Plan'),
      approvePlan: async () => false,
    });

    await expect(controller.exitPlanMode()).resolves.toEqual({
      ok: false,
      error: expect.stringContaining('User rejected the plan'),
    });
    expect(controller.getMode()).toBe('plan');
  });

  test('stays in plan mode when the plan is empty', async () => {
    const controller = createModeController({
      initialMode: 'plan',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      planStore: planStore('   '),
      approvePlan: async () => true,
    });

    await expect(controller.exitPlanMode()).resolves.toEqual({
      ok: false,
      error: 'Cannot exit plan mode because the plan file is empty',
    });
    expect(controller.getMode()).toBe('plan');
  });
});
