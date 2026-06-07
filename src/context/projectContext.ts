import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROJECT_CONTEXT_FILES = ['agent.md', 'AGENT.md', '.agent.md', 'README.md'];

export type ProjectContextOptions = {
  workspaceRoot: string;
  maxFileChars?: number;
  maxGitStatusChars?: number;
  readTextFile?: (path: string) => Promise<string>;
  runGitStatus?: (cwd: string) => Promise<string>;
};

export type BuildProjectContext = () => Promise<string>;

export function createProjectContextBuilder(
  options: ProjectContextOptions,
): BuildProjectContext {
  const maxFileChars = options.maxFileChars ?? 4_000;
  const maxGitStatusChars = options.maxGitStatusChars ?? 4_000;
  const readTextFile = options.readTextFile ?? ((path) => readFile(path, 'utf8'));
  const runGitStatus = options.runGitStatus ?? defaultRunGitStatus;

  return async () => {
    const sections: string[] = [
      '项目上下文：',
      '',
      '工作区：',
      options.workspaceRoot,
      '',
      '项目文件：',
    ];

    for (const fileName of PROJECT_CONTEXT_FILES) {
      const filePath = join(options.workspaceRoot, fileName);
      if (!(await fileExists(filePath))) {
        continue;
      }

      sections.push('', `--- ${fileName} ---`);
      try {
        sections.push(
          truncateWithNotice(await readTextFile(filePath), maxFileChars),
        );
      } catch (error) {
        sections.push(`[无法读取：${errorMessage(error)}]`);
      }
    }

    sections.push('', 'Git 状态：');
    try {
      const gitStatus = await runGitStatus(options.workspaceRoot);
      sections.push(
        truncateWithNotice(gitStatus.trim() || '[干净]', maxGitStatusChars),
      );
    } catch (error) {
      sections.push(`[无法读取：${errorMessage(error)}]`);
    }

    return sections.join('\n');
  };
}

async function defaultRunGitStatus(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['status', '--short'], { cwd });
  return stdout;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function truncateWithNotice(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  /**
   * V5 先用字符数做简单预算，便于学习上下文注入边界；后续 compact 版本再引入 token 估算。
   */
  return `${content.slice(0, maxChars)}\n\n[已截断：原始长度 ${content.length} 字符，展示 ${maxChars} 字符]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
