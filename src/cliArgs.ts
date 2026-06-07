export type ParsedCliArgs = {
  help: boolean;
  task: string;
  continueLatest: boolean;
  resumeSessionId: string | undefined;
  sessionPersistence: boolean;
  forcePlanMode: boolean;
};

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  /**
   * 当前环境下 `pnpm.cmd dev -- ...` 会把分隔符作为普通参数传进脚本。
   * 这里移除单独的分隔符，避免学习示例里的 `--` 意外变成用户任务内容。
   */
  const args = argv.filter((arg) => arg !== '--');
  const taskParts: string[] = [];
  let continueLatest = false;
  let resumeSessionId: string | undefined;
  let sessionPersistence = true;
  let forcePlanMode = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--continue') {
      continueLatest = true;
      continue;
    }

    if (arg === '--resume') {
      resumeSessionId = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--no-session-persistence') {
      sessionPersistence = false;
      continue;
    }

    if (arg === '--plan') {
      forcePlanMode = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      continue;
    }

    taskParts.push(arg);
  }

  return {
    help: args.includes('--help') || args.includes('-h'),
    task: taskParts.join(' ').trim(),
    continueLatest,
    resumeSessionId,
    sessionPersistence,
    forcePlanMode,
  };
}
