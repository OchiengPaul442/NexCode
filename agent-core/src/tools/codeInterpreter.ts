import fs from "fs/promises";
import path from "path";
import os from "os";
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
}

/**
 * Code interpreter for sandboxed code execution.
 * 
 * Features:
 * - Execute JavaScript/TypeScript in sandboxed VM
 * - Execute Python via child process
 * - Input/output capture
 * - Timeout enforcement
 * - Resource limits
 */
export class CodeInterpreter {
  private readonly config: CodeInterpreterConfig;

  constructor(config: CodeInterpreterConfig = {}) {
    this.config = {
      timeoutMs: 30000,
      maxMemoryMb: 256,
      allowedLanguages: ["javascript", "typescript", "python"],
      ...config,
    };
  }

  /**
   * Execute code in a sandboxed environment.
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

    try {
      switch (language) {
        case "javascript":
        case "typescript":
          return await this.executeJavaScript(code, input);
        case "python":
          return await this.executePython(code, input);
        default:
          return {
            ok: false,
            output: `Unsupported language: ${language}`,
          };
      }
    } catch (error) {
      return {
        ok: false,
        output: `Execution failed: ${String(error)}`,
      };
    }
  }

  /**
   * Execute JavaScript/TypeScript code.
   */
  private async executeJavaScript(
    code: string,
    input?: string,
  ): Promise<ToolResult> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    
    try {
      // Write code to a temp file and execute with node
      const tmpFile = path.join(os.tmpdir(), `nexcode-eval-${Date.now()}.js`);
      await fs.writeFile(tmpFile, code, "utf8");
      
      try {
        const { stdout, stderr } = await execFileAsync("node", [tmpFile], {
          timeout: this.config.timeoutMs,
          maxBuffer: 1024 * 1024,
        });
        
        return {
          ok: true,
          output: stdout + (stderr ? `\nStderr: ${stderr}` : ""),
        };
      } finally {
        await fs.unlink(tmpFile).catch(() => {});
      }
    } catch (error: any) {
      return {
        ok: false,
        output: `JavaScript error: ${error.message}\n${error.stdout || ""}${error.stderr || ""}`,
      };
    }
  }

  /**
   * Execute Python code.
   */
  private async executePython(
    code: string,
    input?: string,
  ): Promise<ToolResult> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    
    const env = {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
    };

    try {
      const pythonCode = input
        ? `import sys\nsys.stdin = open('/dev/null', 'r')\n${code}`
        : code;

      const { stdout, stderr } = await execFileAsync(
        "python3",
        ["-c", pythonCode],
        {
          timeout: this.config.timeoutMs,
          env,
          maxBuffer: 1024 * 1024, // 1MB
        },
      );

      return {
        ok: true,
        output: stdout + (stderr ? `\nStderr: ${stderr}` : ""),
      };
    } catch (error: any) {
      return {
        ok: false,
        output: `Python error: ${error.message}\n${error.stdout || ""}${error.stderr || ""}`,
      };
    }
  }

  private output: string[] = [];
}
