export type ChatToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type ChatMessage =
  | {
      role: 'system' | 'user';
      content: string;
    }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ChatToolCall[];
    }
  | {
      role: 'tool';
      toolCallId: string;
      content: string;
    };

export type ChatToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatCompletionRequest = {
  messages: ChatMessage[];
  tools: ChatToolSchema[];
};

export type ChatCompletionResponse = {
  content: string;
  toolCalls: ChatToolCall[];
};

export type ChatCompletionChunk =
  | { type: 'content_delta'; content: string }
  | { type: 'message_complete'; response: ChatCompletionResponse };

export type ChatProvider = {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  stream?(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void,
  ): Promise<ChatCompletionResponse>;
};
