import type { ToolResult } from '../tools/types.js';

export type AgentMode = 'normal' | 'plan';

export type ModeTranscriptReason =
  | 'initial'
  | 'enter_plan'
  | 'exit_plan_approved'
  | 'exit_plan_rejected';

export type ModeController = {
  getMode(): AgentMode;
  getPlanFilePath(): string;
  enterPlanMode(): Promise<ToolResult>;
  exitPlanMode(): Promise<ToolResult>;
};
