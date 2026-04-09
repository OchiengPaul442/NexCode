import { exec, spawn } from "child_process";
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

export function normalizeTerminalCommand(command: string): string {
  const trimmed = command.trim();
  const prefixMatch = trimmed.match(
    /^(?:pnpm\s+create\s+next-app(?:@latest)?|npx\s+create-next-app(?:@latest)?|npm\s+create-next-app(?:@latest)?)\s+/i,
  );

  if (!prefixMatch) {
    return command;
  }

  const prefix = prefixMatch[0];
  const remainder = trimmed.slice(prefix.length).trim();
  if (!remainder) {
    return command;
  }

  const segments = remainder.split(/\s+/);
  const project = segments[0]?.trim();
  if (
    !project ||
    project === "." ||
    project === ".." ||
    /[\\/]/.test(project)
  ) {
    return command;
  }

  const normalizedProject = project.toLowerCase();
  if (normalizedProject === project) {
    return command;
  }

  segments[0] = normalizedProject;
  return `${prefix}${segments.join(" ")}`.trim();
}

export class TerminalTool {
  public constructor(private readonly workspaceRoot: string) {}

  public async run(command: string, timeoutMs = 30_000): Promise<ToolResult> {
    const normalizedCommand = normalizeTerminalCommand(command);
    const validationError = this.validateCommand(normalizedCommand);
    if (validationError) {
      return {
        ok: false,
        output: `Command blocked by safety policy: ${validationError}`,
      };
    }

    try {
      const { stdout, stderr } = await execAsync(normalizedCommand, {
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

  public async *stream(
    command: string,
    timeoutMs = 30_000,
  ): AsyncGenerator<string, ToolResult> {
    const normalizedCommand = normalizeTerminalCommand(command);
    const validationError = this.validateCommand(normalizedCommand);
    if (validationError) {
      return {
        ok: false,
        output: `Command blocked by safety policy: ${validationError}`,
      };
    }

    const child = spawn(normalizedCommand, {
      cwd: this.workspaceRoot,
      env: process.env,
      shell: true,
    });

    const queue: string[] = [];
    let resolveNext: (() => void) | null = null;
    let settled = false;
    let timedOut = false;
    let exitCode: number | null = null;
    let output = "";

    const wake = () => {
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve();
      }
    };

    const pushChunk = (chunk: string) => {
      if (!chunk) {
        return;
      }

      output += chunk;
      queue.push(chunk);
      wake();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      pushChunk(`\n[command timed out after ${timeoutMs}ms]\n`);
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer | string) => {
      pushChunk(data.toString());
    });

    child.stderr?.on("data", (data: Buffer | string) => {
      pushChunk(data.toString());
    });

    child.on("error", (error) => {
      pushChunk(`\n${String(error)}\n`);
      settled = true;
      clearTimeout(timeout);
      wake();
    });

    child.on("close", (code) => {
      exitCode = code;
      if (!timedOut && typeof code === "number" && code !== 0) {
        pushChunk(`\n[process exited with code ${code}]\n`);
      }
      settled = true;
      clearTimeout(timeout);
      wake();
    });

    try {
      while (!settled || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }

        while (queue.length > 0) {
          const chunk = queue.shift();
          if (chunk) {
            yield chunk;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      if (!settled) {
        child.kill();
      }
    }

    const trimmedOutput = output.trim();
    return {
      ok: !timedOut && exitCode === 0,
      output:
        trimmedOutput.length > 0
          ? trimmedOutput
          : exitCode === 0
            ? "Command completed successfully."
            : "Command failed.",
    };
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
