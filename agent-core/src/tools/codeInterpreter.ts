import fs from "fs/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { type ToolResult } from "../types";

/**
 * Configuration for the code interpreter.
 */
export interface CodeInterpreterConfig {
  /** Maximum execution time in milliseconds */
  timeoutMs?: number;
  /** Maximum memory usage in MB */
  maxMemoryMb?: number;
  /** Allowed languages */
  allowedLanguages?: string[];
  /** Maximum code length in characters */
  maxCodeLength?: number;
}

/**
 * Code interpreter for sandboxed code execution.
 *
 * Executes JavaScript and Python in restricted environments with:
 * - Timeout enforcement
 * - Process isolation
 * - Minimal environment variables
 * - Code length limits
 */
export class CodeInterpreter {
  private readonly config: CodeInterpreterConfig;

  constructor(config: CodeInterpreterConfig = {}) {
    this.config = {
      timeoutMs: 30000,
      maxMemoryMb: 256,
      allowedLanguages: ["javascript", "python"],
      maxCodeLength: 100000,
      ...config,
    };
  }

  /**
   * Execute code in a sandboxed environment.
   * @param code - The code to execute
   * @param language - The programming language (javascript or python)
   * @param input - Optional input data
   * @returns ToolResult with output or error
   */
  async execute(
    code: string,
    language: string,
    input?: string,
  ): Promise<ToolResult> {
    // Validate language
    if (!this.config.allowedLanguages?.includes(language)) {
      return {
        ok: false,
        output: `Language '${language}' is not allowed. Allowed: ${this.config.allowedLanguages?.join(", ")}`,
      };
    }

    // Validate code length
    if (code.length > (this.config.maxCodeLength ?? 100000)) {
      return {
        ok: false,
        output: `Code length ${code.length} exceeds maximum ${this.config.maxCodeLength} characters`,
      };
    }

    try {
      switch (language) {
        case "javascript":
          return await this.executeJavaScript(code, input);
        case "python":
          return await this.executePython(code, input);
        default:
          return {
            ok: false,
            output: `Unsupported language: ${language}`,
          };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        output: `Execution failed: ${message}`,
      };
    }
  }

  /**
   * Execute JavaScript code in a restricted environment.
   * Uses child_process.execFile with minimal environment.
   * @param code - JavaScript code to execute
   * @param _input - Optional input (not used for JavaScript)
   * @returns ToolResult with output or error
   */
  private async executeJavaScript(
    code: string,
    _input?: string,
  ): Promise<ToolResult> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    // Create minimal environment (no secrets, no tokens)
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      TMPDIR: os.tmpdir(),
      NODE_ENV: "test",
    };

    // Write code to a temp file with random name to prevent TOCTOU races
    const tmpFile = path.join(os.tmpdir(), `nexcode-eval-${randomUUID()}.js`);

    try {
      await fs.writeFile(tmpFile, code, "utf8");

      const { stdout, stderr } = await execFileAsync("node", [tmpFile], {
        timeout: this.config.timeoutMs,
        maxBuffer: 1024 * 1024,
        env,
      });

      return {
        ok: true,
        output: stdout + (stderr ? `\nStderr: ${stderr}` : ""),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        output: `JavaScript error: ${message}`,
      };
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  /**
   * Execute Python code in a restricted environment.
   * Uses child_process.execFile with minimal environment.
   * @param code - Python code to execute
   * @param _input - Optional input (not used for Python)
   * @returns ToolResult with output or error
   */
  private async executePython(
    code: string,
    _input?: string,
  ): Promise<ToolResult> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    // Create minimal environment (no secrets, no tokens)
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PYTHONIOENCODING: "utf-8",
    };

    // Determine Python executable based on platform
    const pythonCmd = process.platform === "win32" ? "python" : "python3";

    try {
      const { stdout, stderr } = await execFileAsync(pythonCmd, ["-c", code], {
        timeout: this.config.timeoutMs,
        maxBuffer: 1024 * 1024,
        env,
      });

      return {
        ok: true,
        output: stdout + (stderr ? `\nStderr: ${stderr}` : ""),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        output: `Python error: ${message}`,
      };
    }
  }
}
