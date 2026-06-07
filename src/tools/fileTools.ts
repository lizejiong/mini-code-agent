import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';
import { z } from 'zod';
import type { ToolDefinition } from './types.js';

const readFileInput = z.object({
  path: z.string().min(1),
});

const writeFileInput = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const searchFilesInput = z.object({
  query: z.string().default(''),
  limit: z.number().int().positive().max(100).default(50),
});

export const readFileTool: ToolDefinition<typeof readFileInput> = {
  name: 'read_file',
  description: 'Read a UTF-8 text file from the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  inputSchema: readFileInput,
  async execute(input, context) {
    const targetPath = await context.workspace.resolvePath(input.path);
    const realTarget = await realpath(targetPath);
    await context.workspace.assertInside(realTarget);

    return {
      ok: true,
      content: await readFile(realTarget, 'utf8'),
    };
  },
};

export const writeFileTool: ToolDefinition<typeof writeFileInput> = {
  name: 'write_file',
  description: 'Write UTF-8 text content to a workspace file after approval.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      content: { type: 'string', description: 'Complete UTF-8 file content.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  inputSchema: writeFileInput,
  async execute(input, context) {
    const approved = await context.permissions.approveWriteFile(
      input.path,
      input.content,
    );
    if (!approved) {
      return {
        ok: false,
        error: `User denied write_file for ${input.path}`,
      };
    }

    const targetPath = await context.workspace.resolvePath(input.path);
    const parentPath = dirname(targetPath);
    await mkdir(parentPath, { recursive: true });

    /**
     * 父目录创建后再解析真实路径，避免通过符号链接目录写文件时悄悄逃出工作区。
     */
    const realParentPath = await realpath(parentPath);
    await context.workspace.assertInside(realParentPath);

    await writeFile(targetPath, input.content, 'utf8');
    return {
      ok: true,
      content: `Wrote ${Buffer.byteLength(input.content, 'utf8')} bytes to ${input.path}`,
    };
  },
};

export const searchFilesTool: ToolDefinition<typeof searchFilesInput> = {
  name: 'search_files',
  description: 'List workspace files whose relative path contains a query string.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Substring to match in file paths.' },
      limit: { type: 'number', description: 'Maximum number of paths to return.' },
    },
    additionalProperties: false,
  },
  inputSchema: searchFilesInput,
  async execute(input, context) {
    const files = await collectFiles(context.workspace.root);
    const query = input.query.toLowerCase();
    const matches = files
      .filter((file) => file.toLowerCase().includes(query))
      .slice(0, input.limit);

    return {
      ok: true,
      content: matches.join('\n'),
    };
  },
};

async function collectFiles(root: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const pending = [''];
  const files: string[] = [];

  /**
   * V1 的搜索刻意保持简单，但仍限制遍历数量，避免 agent 在大型仓库里无限制列文件。
   */
  const traversalLimit = 1_000;

  while (pending.length > 0 && files.length < traversalLimit) {
    const current = pending.shift()!;
    const absoluteCurrent = current ? `${root}${sep}${current}` : root;
    const entries = await readdir(absoluteCurrent, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = current ? `${current}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        pending.push(relativePath);
      } else if (entry.isFile()) {
        files.push(toPosixRelativePath(root, `${absoluteCurrent}${sep}${entry.name}`));
      }

      if (files.length >= traversalLimit) {
        break;
      }
    }
  }

  return files.sort();
}

function toPosixRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/');
}
