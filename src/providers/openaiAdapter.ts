import { IProviderAdapter, ChatMessage } from "./baseAdapter";

export class OpenAIAdapter implements IProviderAdapter {
  url: string;
  model: string;
  constructor(url = "https://api.openai.com", model = "gpt-4o") {
    this.url = url;
    this.model = model;
  }

  async *chat(messages: ChatMessage[], options?: any): AsyncGenerator<string> {
    // Prototype stub — in a later phase this will call OpenAI Responses API with streaming.
    yield `OpenAI stub response: received ${messages.length} messages.`;
  }

  supportsToolCalling = false;
  supportsImageInput = false;
}
