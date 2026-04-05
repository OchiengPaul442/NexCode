import fs from "fs/promises";
import path from "path";
import { AgentMode } from "../types";
import { DEFAULT_SYSTEM_PROMPTS } from "./defaultPrompts";

const PROMPT_FILE_MAP: Record<AgentMode, string> = {
  auto: "orchestrator.system.md",
  planner: "planner.system.md",
  coder: "coder.system.md",
  reviewer: "reviewer.system.md",
  qa: "qa.system.md",
  security: "security.system.md",
};

export class PromptStore {
  private cache = new Map<AgentMode, string>();

  public constructor(private readonly promptsDir: string) {}

  public async getPrompt(mode: AgentMode): Promise<string> {
    if (this.cache.has(mode)) {
      return this.cache.get(mode) as string;
    }

    const filename = PROMPT_FILE_MAP[mode];
    const filePath = path.join(this.promptsDir, filename);

    try {
      const prompt = await fs.readFile(filePath, "utf8");
      const normalized = prompt.trim();
      if (normalized.length > 0) {
        this.cache.set(mode, normalized);
        return normalized;
      }
    } catch {
      // Default prompt fallback is expected when users do not provide custom prompts.
    }

    const fallback = DEFAULT_SYSTEM_PROMPTS[mode];
    this.cache.set(mode, fallback);
    return fallback;
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
