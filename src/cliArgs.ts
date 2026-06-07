export type ParsedCliArgs = {
  help: boolean;
  deprecatedScriptArgs: boolean;
};

const DEPRECATED_SCRIPT_FLAGS = new Set([
  '--plan',
  '--continue',
  '--resume',
  '--no-session-persistence',
]);

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  /**
   * 当前环境下 `pnpm.cmd dev -- ...` 会把分隔符作为普通参数传进脚本。
   * TUI 入口仍然移除分隔符，避免它影响 help 和废弃参数判断。
   */
  const args = argv.filter((arg) => arg !== '--');
  const help = args.includes('--help') || args.includes('-h');
  const deprecatedScriptArgs =
    !help &&
    args.some((arg) => DEPRECATED_SCRIPT_FLAGS.has(arg) || !arg.startsWith('-'));

  return {
    help,
    deprecatedScriptArgs,
  };
}
