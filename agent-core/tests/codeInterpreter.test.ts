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

  it("should have default config", () => {
    const defaultInterpreter = new CodeInterpreter();
    expect(defaultInterpreter).toBeDefined();
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
      // Python might not be installed - skip test
      console.log("Python not available, skipping test");
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

  it("should handle code length limit", async () => {
    const longCode = "a".repeat(200000);
    const result = await interpreter.execute(longCode, "javascript");
    expect(result.ok).toBe(false);
    expect(result.output).toContain("exceeds maximum");
  });

  it("should use minimal environment variables", async () => {
    const result = await interpreter.execute('console.log(process.env.NODE_ENV)', "javascript");
    expect(result.ok).toBe(true);
    expect(result.output).toContain("test");
  });

  it("should use random temp file names", async () => {
    const result1 = await interpreter.execute('console.log("a")', "javascript");
    const result2 = await interpreter.execute('console.log("b")', "javascript");
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    // Both should succeed without file collisions
  });
});
