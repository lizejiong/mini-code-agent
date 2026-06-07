import type { PlanStore } from '../plans/store.js';
import type { TranscriptEntry } from '../sessions/transcript.js';
import type { ToolResult } from '../tools/types.js';
import type { AgentMode, ModeController, ModeTranscriptReason } from './types.js';

export function createModeController(options: {
  initialMode: AgentMode;
  sessionId: string;
  planStore: PlanStore;
  approvePlan: (plan: string, planFilePath: string) => Promise<boolean>;
  recordTranscriptEntry?: (entry: TranscriptEntry) => Promise<void>;
}): ModeController {
  let mode = options.initialMode;

  async function record(nextMode: AgentMode, reason: ModeTranscriptReason): Promise<void> {
    await options.recordTranscriptEntry?.({
      type: 'mode',
      sessionId: options.sessionId,
      timestamp: new Date().toISOString(),
      mode: nextMode,
      reason,
      planFilePath: options.planStore.filePath,
    });
  }

  return {
    getMode() {
      return mode;
    },
    getPlanFilePath() {
      return options.planStore.filePath;
    },
    async enterPlanMode(): Promise<ToolResult> {
      mode = 'plan';
      await record('plan', 'enter_plan');
      return {
        ok: true,
        content: `Entered plan mode. Plan file: ${options.planStore.filePath}`,
      };
    },
    async exitPlanMode(): Promise<ToolResult> {
      const plan = await options.planStore.read();
      if (!plan.trim()) {
        return {
          ok: false,
          error: 'Cannot exit plan mode because the plan file is empty',
        };
      }

      const approved = await options.approvePlan(plan, options.planStore.filePath);
      if (!approved) {
        await record('plan', 'exit_plan_rejected');
        return {
          ok: false,
          error: 'User rejected the plan. Stay in plan mode and revise the plan.',
        };
      }

      mode = 'normal';
      await record('normal', 'exit_plan_approved');
      return {
        ok: true,
        content: `User approved the plan. You may now implement it.\n\nPlan file: ${options.planStore.filePath}\n\n${plan}`,
      };
    },
  };
}
