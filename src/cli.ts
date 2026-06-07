#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { runAgent } from './agent/loop.js';
import { parseCliArgs } from './cliArgs.js';
import { loadConfig } from './config.js';
import { createInteractivePermissions } from './permissions.js';
import { createOpenAICompatibleProvider } from './providers/openaiCompatible.js';
import { resolveSessionStart } from './sessions/resume.js';
import { appendTranscriptEntry } from './sessions/transcript.js';
import { createDefaultToolRegistry } from './tools/index.js';
import { createWorkspace } from './workspace.js';

function printHelp(): void {
  console.log(`mini-code-agent

Usage:
  mini-code-agent "your task"
  mini-code-agent --continue "your next task"
  mini-code-agent --resume <sessionId> "your next task"
  mini-code-agent --no-session-persistence "one-off task"
  pnpm.cmd dev -- "your task"

Environment:
  OPENAI_API_KEY    API key for an OpenAI-compatible provider
  OPENAI_BASE_URL   Base URL, for example https://api.openai.com/v1
  OPENAI_MODEL      Model name
  MAX_AGENT_STEPS   Optional positive integer, default 10

Session:
  --continue                  Continue the latest session for this workspace
  --resume <sessionId>         Resume a specific session for this workspace
  --no-session-persistence     Do not read or write session history`);
}

async function main(argv: string[]): Promise<void> {
  const args = parseCliArgs(argv);

  if (args.help) {
    printHelp();
    return;
  }

  const task = args.task;
  if (!task) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  loadDotenv();

  const config = loadConfig();
  const workspace = await createWorkspace(process.cwd());
  const provider = createOpenAICompatibleProvider(config);
  const tools = createDefaultToolRegistry({
    workspace,
    permissions: createInteractivePermissions(),
  });
  const session = await resolveSessionStart({
    cwd: workspace.root,
    continueLatest: args.continueLatest,
    resumeSessionId: args.resumeSessionId,
    sessionPersistence: args.sessionPersistence,
  });
  console.error(`Session: ${session.sessionId}`);

  const answer = await runAgent({
    task,
    initialMessages: session.initialMessages,
    provider,
    tools,
    maxSteps: config.maxSteps,
    sessionId: session.sessionId,
    recordTranscriptEntry: session.transcriptPath
      ? async (entry) => appendTranscriptEntry(session.transcriptPath!, entry)
      : undefined,
  });

  console.log(answer);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
