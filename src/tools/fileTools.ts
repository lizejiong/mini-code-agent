import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';
import { z } from 'zod';
import {
  collectWorkspaceFiles,
  matchesGlob,
  MAX_GREP_FILE_BYTES,
  SKIPPED_DISCOVERY_DIRECTORIES,
} from './fileDiscovery.js';
import type { ToolDefinition } from './types.js';

const readFileInput = z.object({
  path: z.string().min(1),
});

const writeFileInput = z.object({
  path: z.string().min(1),
  content: z.string(),
});

const editFileInput = z.object({
  path: z.string().min(1),
  old_text: z.string().min(1),
  new_text: z.string(),
});

const searchFilesInput = z.object({
  query: z.string().default(''),
  limit: z.number().int().positive().max(100).default(50),
});

const listDirInput = z.object({
  path: z.string().min(1),
  limit: z.number().int().positive().max(200).default(100),
});

const globFilesInput = z.object({
  pattern: z.string().min(1),
  limit: z.number().int().positive().max(500).default(100),
});

const grepFilesInput = z.object({
  pattern: z.string().min(1),
  glob: z.string().min(1).optional(),
  regex: z.boolean().default(false),
  case_sensitive: z.boolean().default(false),
  limit: z.number().int().positive().max(200).default(50),
});

const SKIPPED_SEARCH_DIRECTORIES = new Set([
  '.git',
  'dist',
  'node_modules',
]);

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

export const editFileTool: ToolDefinition<typeof editFileInput> = {
  name: 'edit_file',
  description: 'Replace one unique UTF-8 text fragment in a workspace file after approval.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      old_text: {
        type: 'string',
        description: 'Exact text fragment to replace. It must appear exactly once.',
      },
      new_text: {
        type: 'string',
        description: 'Replacement text. Use an empty string to delete old_text.',
      },
    },
    required: ['path', 'old_text', 'new_text'],
    additionalProperties: false,
  },
  inputSchema: editFileInput,
  async execute(input, context) {
    const targetPath = await context.workspace.resolvePath(input.path);
    const realTarget = await realpath(targetPath);
    await context.workspace.assertInside(realTarget);

    const originalContent = await readFile(realTarget, 'utf8');
    const matchCount = countOccurrences(originalContent, input.old_text);
    if (matchCount === 0) {
      return {
        ok: false,
        error: `old_text not found in ${input.path}`,
      };
    }
    if (matchCount > 1) {
      return {
        ok: false,
        error: `old_text appears ${matchCount} times in ${input.path}; provide a larger unique fragment`,
      };
    }

    const matchIndex = originalContent.indexOf(input.old_text);
    const newContent =
      originalContent.slice(0, matchIndex) +
      input.new_text +
      originalContent.slice(matchIndex + input.old_text.length);
    const approved = await context.permissions.approveWriteFile(
      input.path,
      newContent,
    );
    if (!approved) {
      return {
        ok: false,
        error: `User denied edit_file for ${input.path}`,
      };
    }

    await writeFile(realTarget, newContent, 'utf8');
    const startLine = countLineBreaks(originalContent.slice(0, matchIndex)) + 1;
    const endLine = startLine + countTouchedLines(input.old_text) - 1;
    return {
      ok: true,
      content: `Edited ${input.path} (lines ${startLine}-${endLine})`,
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

export const listDirTool: ToolDefinition<typeof listDirInput> = {
  name: 'list_dir',
  description: 'List one workspace directory without reading file contents.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative directory path.' },
      limit: { type: 'number', description: 'Maximum number of entries to return.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  inputSchema: listDirInput,
  async execute(input, context) {
    const targetPath = await context.workspace.resolvePath(input.path);
    const realTarget = await realpath(targetPath);
    await context.workspace.assertInside(realTarget);
    const targetStat = await stat(realTarget);

    if (!targetStat.isDirectory()) {
      return {
        ok: false,
        error: `list_dir target is not a directory: ${input.path}`,
      };
    }

    const entries = await readdir(realTarget, { withFileTypes: true });
    const directories = entries
      .filter(
        (entry) =>
          entry.isDirectory() && !SKIPPED_DISCOVERY_DIRECTORIES.has(entry.name),
      )
      .map((entry) => `dir  ${entry.name}`)
      .sort();
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) => `file ${entry.name}`)
      .sort();

    /**
     * 目录优先能让模型先看到项目结构，再决定是否继续深入读取具体文件。
     */
    return {
      ok: true,
      content: [...directories, ...files].slice(0, input.limit).join('\n'),
    };
  },
};

export const globFilesTool: ToolDefinition<typeof globFilesInput> = {
  name: 'glob_files',
  description: 'List workspace files matching a lightweight glob pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern such as src/**/*.ts.',
      },
      limit: { type: 'number', description: 'Maximum number of paths to return.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  inputSchema: globFilesInput,
  async execute(input, context) {
    const files = await collectWorkspaceFiles(context.workspace.root);
    const matches = files
      .filter((file) => matchesGlob(file, input.pattern))
      .slice(0, input.limit);

    return {
      ok: true,
      content: matches.join('\n'),
    };
  },
};

export const grepFilesTool: ToolDefinition<typeof grepFilesInput> = {
  name: 'grep_files',
  description: 'Search workspace text files by literal text or regular expression.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Literal text or regular expression pattern to search for.',
      },
      glob: {
        type: 'string',
        description: 'Optional glob pattern limiting candidate files.',
      },
      regex: {
        type: 'boolean',
        description: 'Treat pattern as a JavaScript regular expression.',
      },
      case_sensitive: {
        type: 'boolean',
        description: 'Use case-sensitive matching.',
      },
      limit: { type: 'number', description: 'Maximum number of matches to return.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  inputSchema: grepFilesInput,
  async execute(input, context) {
    let expression: RegExp | undefined;

    if (input.regex) {
      try {
        expression = new RegExp(input.pattern, input.case_sensitive ? '' : 'i');
      } catch (error) {
        return {
          ok: false,
          error: `Invalid regex for grep_files: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }

    const files = await collectWorkspaceFiles(context.workspace.root);
    const candidates = input.glob
      ? files.filter((file) => matchesGlob(file, input.glob!))
      : files;
    const matches: string[] = [];
    const literalPattern = input.case_sensitive
      ? input.pattern
      : input.pattern.toLowerCase();

    for (const file of candidates) {
      if (matches.length >= input.limit) {
        break;
      }

      const targetPath = await context.workspace.resolvePath(file);
      const realTarget = await realpath(targetPath);
      await context.workspace.assertInside(realTarget);
      const targetStat = await stat(realTarget);

      if (targetStat.size > MAX_GREP_FILE_BYTES) {
        continue;
      }

      let contentBuffer: Buffer;
      try {
        contentBuffer = await readFile(realTarget);
      } catch {
        /** 搜索应尽量返回可读文件结果，不因为单个文件读取失败而中断。 */
        continue;
      }

      if (isProbablyBinary(contentBuffer)) {
        continue;
      }

      const lines = contentBuffer.toString('utf8').split(/\r?\n/);
      for (const [lineIndex, line] of lines.entries()) {
        const matched = expression
          ? expression.test(line)
          : (input.case_sensitive ? line : line.toLowerCase()).includes(
              literalPattern,
            );

        if (matched) {
          matches.push(`${file}:${lineIndex + 1}: ${line.trim()}`);
        }

        if (matches.length >= input.limit) {
          break;
        }
      }
    }

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
        /**
         * 搜索工具面向模型提供“项目源码视图”，跳过依赖、构建产物和 Git 内部目录，
         * 避免模型在 plan mode 中把步骤浪费在无关文件上。
         */
        if (SKIPPED_SEARCH_DIRECTORIES.has(entry.name)) {
          continue;
        }

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

function countOccurrences(content: string, searchText: string): number {
  let count = 0;
  let searchFrom = 0;

  while (true) {
    const index = content.indexOf(searchText, searchFrom);
    if (index === -1) {
      return count;
    }

    count += 1;
    searchFrom = index + searchText.length;
  }
}

function countLineBreaks(content: string): number {
  return (content.match(/\n/g) ?? []).length;
}

function countTouchedLines(content: string): number {
  /**
   * 末尾换行只是行分隔符，不代表额外编辑了下一行；这样删除整行文本时摘要仍指向被删的那一行。
   */
  const contentWithoutTrailingNewline = content.endsWith('\n')
    ? content.slice(0, -1)
    : content;
  return countLineBreaks(contentWithoutTrailingNewline) + 1;
}

function isProbablyBinary(content: Buffer): boolean {
  return content.includes(0);
}

function toPosixRelativePath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join('/');
}
