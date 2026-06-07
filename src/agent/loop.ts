import type { ChatMessage, ChatProvider } from '../providers/types.js';
import type { ToolRegistry } from '../tools/types.js';

export type RunAgentOptions = {
  task: string;
  provider: ChatProvider;
  tools: ToolRegistry;
  maxSteps: number;
};

export async function runAgent(options: RunAgentOptions): Promise<string> {
  const messages: ChatMessage[] = [{ role: 'user', content: options.task }];
  const toolSchemas = options.tools.definitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  for (let step = 0; step < options.maxSteps; step += 1) {
    const response = await options.provider.complete({
      messages,
      tools: toolSchemas,
    });

    if (response.toolCalls.length === 0) {
      return response.content;
    }

    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls,
    });

    for (const toolCall of response.toolCalls) {
      const result = await options.tools.execute(toolCall.name, toolCall.input);

      /**
       * 工具结果序列化成 JSON，模型才能区分“成功但内容为空”和“结构化失败”。
       * 这样 provider 层仍然只需要处理普通 chat message content。
       */
      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  /** 达到最大步数时停止，避免模型反复请求工具导致失控循环。 */
  throw new Error('Agent stopped after reaching max steps');
}
