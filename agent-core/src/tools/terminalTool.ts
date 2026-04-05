import { exec } from "child_process";
import { promisify } from "util";
import { ToolResult } from "../types";

const execAsync = promisify(exec);

const MAX_COMMAND_LENGTH = 2_000;

const BLOCKED_COMMAND_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bcurl\b[^\n]*\|\s*(?:bash|sh|pwsh|powershell)\b/i,
    reason: "Piped download-and-execute commands are blocked.",
  },
  {
    pattern: /\b(?:bash|sh|pwsh|powershell|cmd)\s+(?:-c|\/c)\b/i,
    reason: "Nested shell execution is blocked.",
  },
  /\brm\s+-rf\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\b/i,
].map((item) =>
  item instanceof RegExp
    ? { pattern: item, reason: "Destructive command pattern detected." }
    : item,
);

const BLOCKED_GIT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "Destructive git reset is blocked.",
  },
  {
    pattern: /\bgit\s+clean\s+-f(?:d|x|fd|fx|fdx)?\b/i,
    reason: "Destructive git clean is blocked.",
  },
  {
    pattern: /\bgit\s+checkout\s+--\b/i,
    reason: "Discarding working tree changes is blocked.",
  },
  {
    pattern: /\bgit\s+restore\s+--source\b/i,
    reason: "Force restore from source is blocked.",
  },
];

export class TerminalTool {
  public constructor(private readonly workspaceRoot: string) {}

  public async run(command: string, timeoutMs = 30_000): Promise<ToolResult> {
    const validationError = this.validateCommand(command);
    if (validationError) {
      return {
        ok: false,
        output: `Command blocked by safety policy: ${validationError}`,
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

  private validateCommand(command: string): string | null {
    const trimmed = command.trim();
    if (!trimmed) {
      return "Command cannot be empty.";
    }

    if (trimmed.length > MAX_COMMAND_LENGTH) {
      return `Command exceeds ${MAX_COMMAND_LENGTH} characters.`;
    }

    for (const blocked of BLOCKED_COMMAND_PATTERNS) {
      if (blocked.pattern.test(trimmed)) {
        return blocked.reason;
      }
    }

    for (const blocked of BLOCKED_GIT_PATTERNS) {
      if (blocked.pattern.test(trimmed)) {
        return blocked.reason;
      }
    }

    return null;
  }
}
