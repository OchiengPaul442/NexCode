import { TerminalTool } from "./terminalTool";
import { ToolResult } from "../types";

interface TestToolInput {
  runner?: string;
  filter?: string;
  script?: string;
}

const RUNNER_COMMANDS: Record<string, (filter?: string) => string> = {
  npm: (filter) => filter ? `npm test -- --grep "${filter}"` : "npm test",
  vitest: (filter) => filter ? `npx vitest run "${filter}"` : "npx vitest run",
  jest: (filter) => filter ? `npx jest "${filter}"` : "npx jest",
  pytest: (filter) => filter ? `pytest -k "${filter}"` : "pytest",
  go: (filter) => filter ? `go test -run "${filter}" ./...` : "go test ./...",
  maven: (filter) => filter ? `mvn test -Dtest="${filter}"` : "mvn test",
  gradle: (filter) => filter ? `gradle test --tests "${filter}"` : "gradle test",
  cargo: (filter) => filter ? `cargo test "${filter}"` : "cargo test",
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
    if (input.script) {
      return input.script.trim();
    }

    const runner = input.runner ?? "npm";
    const commandBuilder = RUNNER_COMMANDS[runner];
    if (!commandBuilder) {
      return `npm test`;
    }

    return commandBuilder(input.filter);
  }

  public run(input?: string | TestToolInput): Promise<ToolResult> {
    return this.terminal.run(this.resolveCommand(input), 300_000);
  }

  public stream(input?: string | TestToolInput): AsyncGenerator<string, ToolResult> {
    return this.terminal.stream(this.resolveCommand(input), 300_000);
  }
}
