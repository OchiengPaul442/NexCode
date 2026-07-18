import { describe, expect, it } from "vitest";
import { normalizeTerminalCommand } from "../src/tools/terminalTool";

const IS_WINDOWS = process.platform === "win32";

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

describe("find command translation", () => {
  it("translates find -type f -iname with current dir", () => {
    const result = normalizeTerminalCommand('find . -type f -iname "*.ts"');
    if (IS_WINDOWS) {
      expect(result).toContain("Get-ChildItem");
      expect(result).toContain('-Filter "*.ts"');
      expect(result).toContain("-File");
      expect(result).toContain("-Recurse");
    } else {
      expect(result).toBe('find . -type f -iname "*.ts"');
    }
  });

  it("translates find -type f -iname with path", () => {
    const result = normalizeTerminalCommand('find /path -type f -iname "*.ts"');
    if (IS_WINDOWS) {
      expect(result).toContain("Get-ChildItem");
      expect(result).toContain('-Path "/path"');
      expect(result).toContain('-Filter "*.ts"');
    } else {
      expect(result).toBe('find /path -type f -iname "*.ts"');
    }
  });

  it("translates find -name with current dir", () => {
    const result = normalizeTerminalCommand('find . -name "*.ts"');
    if (IS_WINDOWS) {
      expect(result).toContain("Get-ChildItem");
      expect(result).toContain('-Filter "*.ts"');
    } else {
      expect(result).toBe('find . -name "*.ts"');
    }
  });

  it("translates find -name with path", () => {
    const result = normalizeTerminalCommand('find src -name "*.ts"');
    if (IS_WINDOWS) {
      expect(result).toContain("Get-ChildItem");
      expect(result).toContain('-Path "src"');
      expect(result).toContain('-Filter "*.ts"');
    } else {
      expect(result).toBe('find src -name "*.ts"');
    }
  });

  it("translates find -type f with no filter", () => {
    const result = normalizeTerminalCommand("find . -type f");
    if (IS_WINDOWS) {
      expect(result).toContain("Get-ChildItem");
      expect(result).toContain("-File");
    } else {
      expect(result).toBe("find . -type f");
    }
  });

  it("translates find -maxdepth", () => {
    const result = normalizeTerminalCommand('find . -maxdepth 1 -type f -name "*.ts"');
    if (IS_WINDOWS) {
      expect(result).toContain("Get-ChildItem");
      expect(result).toContain("-Depth 1");
      expect(result).toContain('-Filter "*.ts"');
      expect(result).toContain("-File");
    } else {
      expect(result).toBe('find . -maxdepth 1 -type f -name "*.ts"');
    }
  });

  it("strips -exec from find commands", () => {
    const result = normalizeTerminalCommand('find . -name "*.ts" -exec grep -l "pattern" {} \\;');
    if (IS_WINDOWS) {
      expect(result).toContain("Get-ChildItem");
      expect(result).not.toContain("-exec");
    } else {
      expect(result).toBe('find . -name "*.ts" -exec grep -l "pattern" {} \\;');
    }
  });

  it("translates complex find with OR conditions", () => {
    const result = normalizeTerminalCommand('find . -type f \\( -iname "*.ts" -o -iname "*.js" \\)');
    if (IS_WINDOWS) {
      expect(result).toContain("Get-ChildItem");
      expect(result).toContain("-Include");
      expect(result).toContain('"*.ts"');
      expect(result).toContain('"*.js"');
    } else {
      expect(result).toBe('find . -type f \\( -iname "*.ts" -o -iname "*.js" \\)');
    }
  });
});
