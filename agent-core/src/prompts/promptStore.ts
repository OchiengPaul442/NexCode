import fs from "fs/promises";
import path from "path";
import { type AgentMode } from "../types";
import { DEFAULT_SYSTEM_PROMPTS } from "./defaultPrompts";

const PROMPT_FILE_MAP: Record<AgentMode, string> = {
  auto: "orchestrator.system.md",
  planner: "planner.system.md",
  coder: "coder.system.md",
  reviewer: "reviewer.system.md",
  qa: "qa.system.md",
  security: "security.system.md",
};

export interface PromptStoreOptions {
  /** Directory containing workspace prompt files. */
  promptsDir?: string;
  /**
   * Whether workspace prompt files are allowed to override built-in defaults.
   * When false (the safe default), workspace prompts are silently ignored and
   * the built-in trusted defaults are always used.  This prevents a malicious
   * repository from injecting arbitrary system instructions via prompt files.
   */
  allowWorkspacePrompts?: boolean;
}

export class PromptStore {
  private cache = new Map<AgentMode, string>();
  private readonly promptsDir: string;
  private readonly allowWorkspacePrompts: boolean;

  public constructor(optionsOrDir: string | PromptStoreOptions = {}) {
    if (typeof optionsOrDir === "string") {
      this.promptsDir = optionsOrDir;
      this.allowWorkspacePrompts = false;
    } else {
      this.promptsDir = optionsOrDir.promptsDir ?? "";
      this.allowWorkspacePrompts = optionsOrDir.allowWorkspacePrompts ?? false;
    }
  }

  /**
   * Returns the system prompt for the given mode.  When workspace prompts are
   * disabled (the default) or the workspace directory contains no override, the
   * built-in trusted default is returned.
   */
  public async getPrompt(mode: AgentMode): Promise<string> {
    if (this.cache.has(mode)) {
      return this.cache.get(mode) as string;
    }

    // Workspace prompt overrides are only read when explicitly allowed.
    if (this.allowWorkspacePrompts && this.promptsDir) {
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
        // File does not exist — fall through to built-in default.
      }
    }

    const fallback = DEFAULT_SYSTEM_PROMPTS[mode];
    this.cache.set(mode, fallback);
    return fallback;
  }

  /** Whether workspace prompt files are allowed. */
  public isWorkspacePromptsAllowed(): boolean {
    return this.allowWorkspacePrompts;
  }

  public clearCache(): void {
    this.cache.clear();
  }
}
