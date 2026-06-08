#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { runAgent } from './agent/loop.js';
import { parseCliArgs } from './cliArgs.js';
import { loadConfig } from './config.js';
import { createProjectContextBuilder } from './context/projectContext.js';
import { askYesNo, createInteractivePermissions } from './permissions.js';
import { createModeController } from './modes/controller.js';
import { createPlanStore } from './plans/store.js';
import { createOpenAICompatibleProvider } from './providers/openaiCompatible.js';
import type { ChatMessage } from './providers/types.js';
import { resolveSessionStart } from './sessions/resume.js';
import {
  appendTranscriptEntry,
  transcriptEntriesToMessages,
  type TranscriptEntry,
} from './sessions/transcript.js';
import { createTodoStore, summarizeTodos } from './todos/store.js';
import { createRegistryForMode } from './tools/registryForMode.js';
import { createAgentRunner } from './ui/useAgentRunner.js';
import { renderTui } from './ui/renderTui.js';
import { createWorkspace } from './workspace.js';

function printHelp(): void {
  console.log(`mini-code-agent

Usage:
  mini-code-agent
  pnpm.cmd dev

说明:
  默认启动交互式 TUI。脚本式任务参数已废弃，请进入 TUI 后输入任务。

Environment:
  OPENAI_API_KEY    API key for an OpenAI-compatible provider
  OPENAI_BASE_URL   Base URL, for example https://api.openai.com/v1
  OPENAI_MODEL      Model name
  MAX_AGENT_STEPS   Optional positive integer, default 10`);
}

async function main(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);

  if (args.help) {
    printHelp();
    return;
  }

  if (args.deprecatedScriptArgs) {
    console.error(
      '脚本式任务参数已废弃。请直接运行 pnpm.cmd dev 进入 TUI，然后在界面中输入任务。',
    );
    process.exitCode = 1;
    return;
  }

  loadDotenv();

  const config = loadConfig();
  const workspace = await createWorkspace(process.cwd());
  const buildSystemContext = createProjectContextBuilder({
    workspaceRoot: workspace.root,
  });
  const provider = createOpenAICompatibleProvider(config);
  const permissions = createInteractivePermissions();
  const toolContext = { workspace, permissions };
  const session = await resolveSessionStart({
    cwd: workspace.root,
    continueLatest: false,
    resumeSessionId: undefined,
    sessionPersistence: true,
  });
  let conversationMessages: ChatMessage[] = [...session.initialMessages];
  const recordTranscriptEntry = async (entry: TranscriptEntry) => {
    if (session.transcriptPath) {
      await appendTranscriptEntry(session.transcriptPath, entry);
    }

    conversationMessages = [
      ...conversationMessages,
      ...transcriptEntriesToMessages([entry]),
    ];
  };
  const planStore = createPlanStore({ sessionId: session.sessionId });
  const todoStore = createTodoStore({ sessionId: session.sessionId });
  const loadTodoSummary = async () => {
    try {
      return {
        available: true as const,
        ...summarizeTodos(await todoStore.read()),
      };
    } catch (error) {
      return {
        available: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  const modeController = createModeController({
    initialMode: session.initialMode,
    sessionId: session.sessionId,
    planStore,
    approvePlan,
    recordTranscriptEntry,
  });

  renderTui({
    sessionId: session.sessionId,
    getMode: () => modeController.getMode(),
    loadTodoSummary,
    runTask: async (
      task,
      appendMessage,
      appendAssistantDelta,
      finishAssistantMessage,
      refreshTodos,
    ) => {
      const runner = createAgentRunner({
        appendMessage,
        appendAssistantDelta,
        finishAssistantMessage,
        refreshTodos,
        runAgent: async ({ task, onEvent }) =>
          runAgent({
            task,
            initialMessages: conversationMessages,
            provider,
            toolsForMode: (mode) =>
              createRegistryForMode({
                mode,
                context: toolContext,
                modeController,
                planStore,
                todoStore,
              }),
            modeController,
            maxSteps: config.maxSteps,
            sessionId: session.sessionId,
            recordTranscriptEntry,
            buildSystemContext,
            onEvent,
          }),
      });

      await runner.run(task);
    },
  });
}

async function approvePlan(plan: string, planFilePath: string): Promise<boolean> {
  console.error(`\nPlan file: ${planFilePath}\n\n${plan}\n`);
  return askYesNo('Approve this plan and continue? [y/N] ');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
