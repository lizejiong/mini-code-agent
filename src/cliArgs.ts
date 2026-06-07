export type ParsedCliArgs = {
  help: boolean;
  task: string;
};

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  /**
   * 当前环境下 `pnpm.cmd dev -- ...` 会把分隔符作为普通参数传进脚本。
   * 这里移除单独的分隔符，避免学习示例里的 `--` 意外变成用户任务内容。
   */
  const args = argv.filter((arg) => arg !== '--');

  return {
    help: args.includes('--help') || args.includes('-h'),
    task: args.filter((arg) => arg !== '--help' && arg !== '-h').join(' ').trim(),
  };
}
