import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export type Workspace = {
  root: string;
  resolvePath(path: string): Promise<string>;
  assertInside(path: string): Promise<string>;
};

export async function createWorkspace(root: string = process.cwd()): Promise<Workspace> {
  const realRoot = await realpath(root);

  return {
    root: realRoot,
    async resolvePath(path: string): Promise<string> {
      const resolved = isAbsolute(path) ? resolve(path) : resolve(realRoot, path);
      return assertPathInside(realRoot, resolved);
    },
    async assertInside(path: string): Promise<string> {
      return assertPathInside(realRoot, path);
    },
  };
}

function assertPathInside(root: string, target: string): string {
  const resolvedTarget = resolve(target);
  const relativePath = relative(root, resolvedTarget);

  /**
   * `path.relative` 可以跨平台判断路径是否仍在工作区内：工作区内路径会是普通相对路径，
   * 逃逸路径会以 `..` 开头，或在 Windows 跨盘符时变成绝对路径。
   * 把这段逻辑集中在这里，避免每个工具各自实现不完整的路径安全规则。
   */
  if (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  ) {
    return resolvedTarget;
  }

  throw new Error(`Path escapes workspace: ${target}`);
}
