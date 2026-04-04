import { ConfigManager } from "../config";
import { OllamaAdapter } from "./ollamaAdapter";
import { OpenAIAdapter } from "./openaiAdapter";
import { IProviderAdapter } from "./baseAdapter";

export class ProviderManager {
  private static instance: ProviderManager | undefined;
  private provider: IProviderAdapter;

  private constructor(context: any) {
    const providerName =
      ConfigManager.get<string>("provider")?.toLowerCase() ?? "ollama";
    if (providerName === "openai") {
      const url =
        ConfigManager.get<string>("openaiBaseUrl") ?? "https://api.openai.com";
      const model = ConfigManager.get<string>("openaiModel") ?? "gpt-4o";
      this.provider = new OpenAIAdapter(url, model);
    } else {
      const url =
        ConfigManager.get<string>("ollamaBaseUrl") ?? "http://localhost:11434";
      const model = ConfigManager.get<string>("ollamaModel") ?? "llama2";
      this.provider = new OllamaAdapter(url, model);
    }
  }

  static getInstance(context: any) {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager(context);
    }
    return ProviderManager.instance;
  }

  static reload(context: any) {
    ProviderManager.instance = new ProviderManager(context);
    return ProviderManager.instance;
  }

  getProvider(): IProviderAdapter {
    return this.provider;
  }
}
