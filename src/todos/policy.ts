import type { AgentMode } from '../modes/types.js';

const IMPLEMENTATION_KEYWORDS = [
  '实现',
  '修复',
  '重构',
  '修改',
  '新增',
  '继续下一版本',
  '下个版本',
  '下一版本',
  'v10',
  '测试',
  '提交',
];

const READ_ONLY_KEYWORDS = [
  '解释',
  '阅读',
  '怎么使用',
  '列出',
  '描述',
  '有哪些功能',
  '当前',
  '是否',
];

export function shouldSuggestTodos(task: string): boolean {
  const normalizedTask = task.trim().toLowerCase();
  if (!normalizedTask) {
    return false;
  }

  const hasImplementationIntent = IMPLEMENTATION_KEYWORDS.some((keyword) =>
    normalizedTask.includes(keyword.toLowerCase()),
  );
  if (!hasImplementationIntent) {
    return false;
  }

  const hasReadOnlyIntent = READ_ONLY_KEYWORDS.some((keyword) =>
    normalizedTask.includes(keyword.toLowerCase()),
  );

  /**
   * 明确的实现/修复意图优先于“阅读”等上下文收集词，避免“阅读代码并实现修复”被误判成只读任务。
   */
  return !hasReadOnlyIntent || /实现|修复|重构|修改|新增/.test(normalizedTask);
}

export function createTodoPolicyPrompt(options: {
  task: string;
  mode: AgentMode;
}): string | undefined {
  if (options.mode !== 'normal' || !shouldSuggestTodos(options.task)) {
    return undefined;
  }

  return `Todo 使用策略：

当前用户请求看起来是一个多步骤实现任务。开始修改代码前，先用 todo_write 创建 3-6 个 todo，覆盖理解现状、实现、验证和收尾。

执行过程中保持最多一个 in_progress；每完成一个阶段就更新 todo_write。最终回答前，将已完成事项标记为 completed。

如果你在读取上下文后判断任务其实很简单，可以不创建 todo，但不要在复杂任务中跳过进度维护。`;
}
