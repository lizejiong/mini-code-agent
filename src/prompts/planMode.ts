import type { AgentMode } from '../modes/types.js';

export function createModeSystemPrompt(mode: AgentMode, planFilePath: string): string {
  if (mode === 'plan') {
    return `Plan mode is active. You must not modify project files or run commands.

Allowed actions:
- Read files and search files to understand the codebase.
- Use write_plan to write the complete Markdown plan file at ${planFilePath}.
- Use read_plan if you need to review the current plan.
- When the plan is ready, call ExitPlanMode to request user approval.

Do not explore exhaustively. In the current turn, gather only enough context to identify the files, approach, and verification command, then write_plan and call ExitPlanMode.`;
  }

  return 'You are in normal mode. For non-trivial or ambiguous implementation tasks, call EnterPlanMode before coding.';
}
