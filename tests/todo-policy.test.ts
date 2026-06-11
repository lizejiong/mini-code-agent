import { describe, expect, test } from 'vitest';
import {
  createTodoPolicyPrompt,
  shouldSuggestTodos,
} from '../src/todos/policy.js';

describe('todo policy', () => {
  test('suggests todos for complex implementation tasks', () => {
    expect(shouldSuggestTodos('帮我实现一个新的文件编辑工具')).toBe(true);
    expect(shouldSuggestTodos('修复 run_command 的错误并运行测试')).toBe(true);
    expect(shouldSuggestTodos('继续下一版本，做 V10')).toBe(true);
  });

  test('does not suggest todos for simple read-only tasks', () => {
    expect(shouldSuggestTodos('怎么使用')).toBe(false);
    expect(shouldSuggestTodos('生成一句话项目描述')).toBe(false);
    expect(shouldSuggestTodos('带我阅读本次改动')).toBe(false);
    expect(shouldSuggestTodos('当前已经可使用了吗')).toBe(false);
  });

  test('lets implementation intent win over read-only words', () => {
    expect(shouldSuggestTodos('阅读代码并实现修复')).toBe(true);
  });

  test('returns no prompt for simple normal mode tasks', () => {
    expect(
      createTodoPolicyPrompt({ task: '怎么使用', mode: 'normal' }),
    ).toBeUndefined();
  });

  test('returns no prompt in plan mode', () => {
    expect(
      createTodoPolicyPrompt({ task: '帮我实现一个新功能', mode: 'plan' }),
    ).toBeUndefined();
  });

  test('creates a Chinese todo policy prompt for complex normal mode tasks', () => {
    const prompt = createTodoPolicyPrompt({
      task: '帮我实现一个新功能',
      mode: 'normal',
    });

    expect(prompt).toContain('Todo 使用策略');
    expect(prompt).toContain('todo_write');
    expect(prompt).toContain('3-6 个 todo');
    expect(prompt).toContain('最多一个 in_progress');
    expect(prompt).toContain('completed');
  });
});
