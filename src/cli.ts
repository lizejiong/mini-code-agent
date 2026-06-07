#!/usr/bin/env node
import { config as loadDotenv } from 'dotenv';
import { runAgent } from './agent/loop.js';
import { parseCliArgs } from './cliArgs.js';
import { loadConfig } from './config.js';
import { createInteractivePermissions } from './permissions.js';
import { createOpenAICompatibleProvider } from './providers/openaiCompatible.js';
import { createDefaultToolRegistry } from './tools/index.js';
import { createWorkspace } from './workspace.js';

function printHelp(): void {
  console.log(`mini-code-agent

Usage:
  mini-code-agent "your task"
  pnpm.cmd dev -- "your task"

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

  const answer = await runAgent({
    task,
    provider,
    tools,
    maxSteps: config.maxSteps,
  });

  console.log(answer);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
