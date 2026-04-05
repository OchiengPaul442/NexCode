import { exec } from "child_process";
import { promisify } from "util";
import { ToolResult } from "../types";

const execAsync = promisify(exec);

const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\b/i,
];

export class TerminalTool {
  public constructor(private readonly workspaceRoot: string) {}

  public async run(command: string, timeoutMs = 30_000): Promise<ToolResult> {
    if (this.isBlocked(command)) {
      return {
        ok: false,
        output: "Command blocked by safety policy.",
      };
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
      });

      return {
        ok: true,
        output: `${stdout}${stderr}`.trim(),
      };
    } catch (error) {
      const typedError = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      return {
        ok: false,
        output:
          `${typedError.stdout ?? ""}${typedError.stderr ?? ""}${typedError.message ?? ""}`.trim(),
      };
    }
  }

  private isBlocked(command: string): boolean {
    return BLOCKED_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
  }
}
