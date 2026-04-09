import { describe, expect, it } from "vitest";
import { normalizeTerminalCommand } from "../src/tools/terminalTool";

describe("normalizeTerminalCommand", () => {
  it("normalizes create-next-app project names to lowercase", () => {
    expect(
      normalizeTerminalCommand("pnpm create next-app@latest PORTFOLIO --yes"),
    ).toBe("pnpm create next-app@latest portfolio --yes");
  });

  it("leaves dot-based project directories unchanged", () => {
    expect(
      normalizeTerminalCommand("pnpm create next-app@latest . --yes"),
    ).toBe("pnpm create next-app@latest . --yes");
  });
});
