import fs from "fs/promises";
import path from "path";

interface PromptVersionRecord {
  version: string;
  timestamp: string;
  role: string;
  score: number;
  notes?: string;
}

interface PromptVersionState {
  activeVersion: string;
  history: PromptVersionRecord[];
}

export class PromptVersionManager {
  private readonly filePath: string;

  public constructor(memoryDir: string) {
    this.filePath = path.join(memoryDir, "prompt-versions.json");
  }

  public async record(
    role: string,
    score: number,
    notes?: string,
  ): Promise<void> {
    const state = await this.readState();
    const nextVersion = this.bumpPatch(state.activeVersion);

    state.activeVersion = nextVersion;
    state.history.push({
      version: nextVersion,
      timestamp: new Date().toISOString(),
      role,
      score,
      notes,
    });

    await this.writeState(state);
  }

  public async getActiveVersion(): Promise<string> {
    const state = await this.readState();
    return state.activeVersion;
  }

  private async readState(): Promise<PromptVersionState> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PromptVersionState;
      if (!parsed.activeVersion || !Array.isArray(parsed.history)) {
        throw new Error("Invalid prompt version state");
      }
      return parsed;
    } catch {
      const initial: PromptVersionState = {
        activeVersion: "0.1.0",
        history: [],
      };
      await this.writeState(initial);
      return initial;
    }
  }

  private async writeState(state: PromptVersionState): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }

  private bumpPatch(version: string): string {
    const [major, minor, patch] = version
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
    return `${major}.${minor}.${patch + 1}`;
  }
}
