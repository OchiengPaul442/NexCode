export type ChatMessage = { role: string; content: string };

export interface IProviderAdapter {
  chat(messages: ChatMessage[], options?: any): AsyncGenerator<string>;
  supportsToolCalling?: boolean;
  supportsImageInput?: boolean;
}
