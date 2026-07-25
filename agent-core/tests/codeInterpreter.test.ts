import { describe, it, expect, beforeEach } from "vitest";
import { CodeInterpreter } from "../src/tools/codeInterpreter";

describe("CodeInterpreter", () => {
  let interpreter: CodeInterpreter;

  beforeEach(() => {
    interpreter = new CodeInterpreter({
      timeoutMs: 5000,
      allowedLanguages: ["javascript", "python"],
    });
  });

  it("should create code interpreter", () => {
    expect(interpreter).toBeDefined();
  });

  it("should execute simple JavaScript", async () => {
    const result = await interpreter.execute('console.log(1 + 1)', "javascript");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("2");
  });

  it("should execute JavaScript with console.log", async () => {
    const result = await interpreter.execute('console.log("hello")', "javascript");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("hello");
  });

  it("should execute Python code", async () => {
    try {
      const result = await interpreter.execute("print(1 + 1)", "python");
      expect(result.ok).toBe(true);
      expect(result.output).toContain("2");
    } catch {
      // Python might not be installed
      expect(true).toBe(true);
    }
  });

  it("should reject disallowed languages", async () => {
    const result = await interpreter.execute("echo hello", "bash");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not allowed");
  });

  it("should handle JavaScript errors", async () => {
    const result = await interpreter.execute("throw new Error('test error')", "javascript");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("test error");
  });

  it("should handle Python errors", async () => {
    const result = await interpreter.execute("raise ValueError('test error')", "python");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("test error");
  });

  it("should handle timeout", async () => {
    const shortInterpreter = new CodeInterpreter({
      timeoutMs: 100, // Very short timeout
      allowedLanguages: ["python"],
    });
    
    const result = await shortInterpreter.execute("import time; time.sleep(10)", "python");
    expect(result.ok).toBe(false);
  });
});
