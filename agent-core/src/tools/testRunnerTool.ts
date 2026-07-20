import { type TerminalTool } from "./terminalTool";
import { type ToolResult } from "../types";

interface TestToolInput {
  runner?: string;
  filter?: string;
}

const SHELL_METACHARACTER_RE = /["'`$\\|;&(){}[\]!#~]/;

function sanitizeFilter(filter: string): string {
  if (SHELL_METACHARACTER_RE.test(filter)) {
    throw new Error(
      `Test filter contains disallowed shell metacharacters. Only alphanumeric, spaces, hyphens, underscores, dots, and slashes are allowed.`
    );
  }
  return filter;
}

const RUNNER_COMMANDS: Record<string, (filter?: string) => string> = {
  npm: (filter) => filter ? `npm test -- --grep "${sanitizeFilter(filter)}"` : "npm test",
  vitest: (filter) => filter ? `npx vitest run "${sanitizeFilter(filter)}"` : "npx vitest run",
  jest: (filter) => filter ? `npx jest "${sanitizeFilter(filter)}"` : "npx jest",
  pytest: (filter) => filter ? `pytest -k "${sanitizeFilter(filter)}"` : "pytest",
  go: (filter) => filter ? `go test -run "${sanitizeFilter(filter)}" ./...` : "go test ./...",
  maven: (filter) => filter ? `mvn test -Dtest="${sanitizeFilter(filter)}"` : "mvn test",
  gradle: (filter) => filter ? `gradle test --tests "${sanitizeFilter(filter)}"` : "gradle test",
  cargo: (filter) => filter ? `cargo test "${sanitizeFilter(filter)}"` : "cargo test",
};

export class TestRunnerTool {
  public constructor(private readonly terminal: TerminalTool) {}

  public resolveCommand(input?: string | TestToolInput): string {
    if (!input) {
      return "npm test";
    }

    if (typeof input === "string") {
      const parsed = this.parseInput(input);
      return this.buildCommand(parsed);
    }

    return this.buildCommand(input);
  }

  private parseInput(input: string): TestToolInput {
    const trimmed = input.trim();
    if (!trimmed) {
      return {};
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed;
      }
    } catch {
      // Not JSON, treat as filter string
    }

    return { filter: trimmed };
  }

  private buildCommand(input: TestToolInput): string {
    const runner = input.runner ?? "npm";
    const commandBuilder = RUNNER_COMMANDS[runner];
    if (!commandBuilder) {
      return `npm test`;
    }

    return commandBuilder(input.filter);
  }

  public run(input?: string | TestToolInput, signal?: AbortSignal): Promise<ToolResult> {
    return this.terminal.run(this.resolveCommand(input), 300_000, signal);
  }

  public stream(input?: string | TestToolInput, signal?: AbortSignal): AsyncGenerator<string, ToolResult> {
    return this.terminal.stream(this.resolveCommand(input), 300_000, signal);
  }
}
