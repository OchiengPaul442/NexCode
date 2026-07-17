import { spawn, SpawnOptions } from "child_process";
import { ToolResult } from "../types";

export interface CommandRunnerOptions {
  workspaceRoot: string;
  timeoutMs?: number;
  maxBuffer?: number;
  shell?: boolean;
  env?: Record<string, string>;
}

export interface CommandResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface SandboxProfile {
  allowNetwork: boolean;
  allowFileSystemWrite: boolean;
  allowProcessExecution: boolean;
  allowedPaths: string[];
  blockedPaths: string[];
}

const DEFAULT_SANDBOX: SandboxProfile = {
  allowNetwork: true,
  allowFileSystemWrite: true,
  allowProcessExecution: true,
  allowedPaths: [],
  blockedPaths: [],
};

const READ_ONLY_SANDBOX: SandboxProfile = {
  allowNetwork: false,
  allowFileSystemWrite: false,
  allowProcessExecution: true,
  allowedPaths: [],
  blockedPaths: [],
};

export class CommandRunner {
  private readonly workspaceRoot: string;
  private readonly defaultTimeout: number;
  private readonly defaultMaxBuffer: number;

  constructor(options: CommandRunnerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.defaultTimeout = options.timeoutMs ?? 30_000;
    this.defaultMaxBuffer = options.maxBuffer ?? 2 * 1024 * 1024;
  }

  public static createReadOnlyRunner(workspaceRoot: string): CommandRunner {
    return new CommandRunner({
      workspaceRoot,
      timeoutMs: 30_000,
    });
  }

  public static createSandboxedRunner(
    workspaceRoot: string,
    profile: SandboxProfile,
  ): CommandRunner {
    return new CommandRunner({
      workspaceRoot,
      timeoutMs: 30_000,
    });
  }

  public async run(
    command: string,
    options: {
      timeoutMs?: number;
      sandbox?: SandboxProfile;
      env?: Record<string, string>;
    } = {},
  ): Promise<CommandResult> {
    const timeout = options.timeoutMs ?? this.defaultTimeout;
    const sandbox = options.sandbox ?? DEFAULT_SANDBOX;

    const validationError = this.validateCommand(command, sandbox);
    if (validationError) {
      return {
        ok: false,
        output: validationError,
        exitCode: null,
        timedOut: false,
      };
    }

    return this.executeCommand(command, {
      timeout,
      env: options.env,
    });
  }

  public async *stream(
    command: string,
    options: {
      timeoutMs?: number;
      sandbox?: SandboxProfile;
      env?: Record<string, string>;
    } = {},
  ): AsyncGenerator<string, CommandResult> {
    const timeout = options.timeoutMs ?? this.defaultTimeout;
    const sandbox = options.sandbox ?? DEFAULT_SANDBOX;

    const validationError = this.validateCommand(command, sandbox);
    if (validationError) {
      yield validationError;
      return {
        ok: false,
        output: validationError,
        exitCode: null,
        timedOut: false,
      };
    }

    return yield* this.streamCommand(command, {
      timeout,
      env: options.env,
    });
  }

  private validateCommand(
    command: string,
    sandbox: SandboxProfile,
  ): string | null {
    const trimmed = command.trim();
    if (!trimmed) {
      return "Command cannot be empty.";
    }

    if (trimmed.length > 2000) {
      return "Command exceeds 2000 characters.";
    }

    if (!sandbox.allowProcessExecution) {
      return "Process execution is not allowed in this sandbox.";
    }

    return null;
  }

  private async executeCommand(
    command: string,
    options: {
      timeout: number;
      env?: Record<string, string>;
    },
  ): Promise<CommandResult> {
    const isWindows = process.platform === "win32";
    const spawnOptions: SpawnOptions = {
      cwd: this.workspaceRoot,
      shell: true,
      env: {
        ...process.env,
        ...options.env,
      },
    };

    if (isWindows) {
      spawnOptions.shell = "powershell.exe";
    }

    return new Promise((resolve) => {
      const child = spawn(command, spawnOptions);
      let output = "";
      let timedOut = false;
      let exitCode: number | null = null;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
        resolve({
          ok: false,
          output: output + `\n[command timed out after ${options.timeout}ms]`,
          exitCode,
          timedOut,
        });
      }, options.timeout);

      child.stdout?.on("data", (data: Buffer | string) => {
        output += data.toString();
      });

      child.stderr?.on("data", (data: Buffer | string) => {
        output += data.toString();
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          output: output + `\n${String(error)}`,
          exitCode,
          timedOut,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        exitCode = code;
        const trimmedOutput = output.trim();
        resolve({
          ok: !timedOut && exitCode === 0,
          output:
            trimmedOutput.length > 0
              ? trimmedOutput
              : exitCode === 0
                ? "Command completed successfully."
                : "Command failed.",
          exitCode,
          timedOut,
        });
      });
    });
  }

  private async *streamCommand(
    command: string,
    options: {
      timeout: number;
      env?: Record<string, string>;
    },
  ): AsyncGenerator<string, CommandResult> {
    const isWindows = process.platform === "win32";
    const spawnOptions: SpawnOptions = {
      cwd: this.workspaceRoot,
      shell: true,
      env: {
        ...process.env,
        ...options.env,
      },
    };

    if (isWindows) {
      spawnOptions.shell = "powershell.exe";
    }

    const child = spawn(command, spawnOptions);
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
      if (!chunk) return;
      output += chunk;
      queue.push(chunk);
      wake();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      pushChunk(`\n[command timed out after ${options.timeout}ms]\n`);
      child.kill();
    }, options.timeout);

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
      exitCode,
      timedOut,
    };
  }
}
