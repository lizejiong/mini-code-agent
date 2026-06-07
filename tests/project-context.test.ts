import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createProjectContextBuilder } from '../src/context/projectContext.js';

describe('createProjectContextBuilder', () => {
  test('includes project instruction files, README, and git status', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
    await writeFile(join(root, 'agent.md'), 'Agent rules', 'utf8');
    await writeFile(join(root, 'README.md'), '# Project', 'utf8');

    const build = createProjectContextBuilder({
      workspaceRoot: root,
      runGitStatus: async () => 'M src/app.ts',
    });

    const context = await build();

    expect(context).toContain('项目上下文：');
    expect(context).toContain('--- agent.md ---');
    expect(context).toContain('Agent rules');
    expect(context).toContain('--- README.md ---');
    expect(context).toContain('# Project');
    expect(context).toContain('Git 状态：\nM src/app.ts');
  });

  test('skips missing context files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
    await writeFile(join(root, 'README.md'), '# Only README', 'utf8');

    const build = createProjectContextBuilder({
      workspaceRoot: root,
      runGitStatus: async () => '',
    });

    const context = await build();

    expect(context).toContain('--- README.md ---');
    expect(context).not.toContain('--- agent.md ---');
    expect(context).not.toContain('--- AGENT.md ---');
    expect(context).not.toContain('--- .agent.md ---');
  });

  test('truncates long context files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
    await writeFile(join(root, 'agent.md'), 'abcdef', 'utf8');

    const build = createProjectContextBuilder({
      workspaceRoot: root,
      maxFileChars: 3,
      runGitStatus: async () => '',
    });

    const context = await build();

    expect(context).toContain('abc');
    expect(context).toContain(
      '[已截断：原始长度 6 字符，展示 3 字符]',
    );
  });

  test('records unavailable git status without failing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
    const build = createProjectContextBuilder({
      workspaceRoot: root,
      runGitStatus: async () => {
        throw new Error('not a git repository');
      },
    });

    await expect(build()).resolves.toContain(
      'Git 状态：\n[无法读取：not a git repository]',
    );
  });

  test('records clean git status when git status is empty', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mini-agent-context-'));
    const build = createProjectContextBuilder({
      workspaceRoot: root,
      runGitStatus: async () => '',
    });

    await expect(build()).resolves.toContain('Git 状态：\n[干净]');
  });
});
