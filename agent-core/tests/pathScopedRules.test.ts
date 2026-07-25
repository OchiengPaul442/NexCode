import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { PathScopedRuleManager } from "../src/rules/pathScopedRules";

describe("PathScopedRuleManager", () => {
  let tempDir: string;
  let manager: PathScopedRuleManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rules-test-"));
    manager = new PathScopedRuleManager(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should load rules", async () => {
    await manager.load();
    // Should not throw
    expect(true).toBe(true);
  });

  it("should return empty rules when no rule files exist", async () => {
    await manager.load();
    const rules = manager.getApplicableRules("test.ts");
    expect(rules).toEqual([]);
  });

  it("should load rules from .nexcode/rules directory", async () => {
    const rulesDir = path.join(tempDir, ".nexcode", "rules");
    await fs.mkdir(rulesDir, { recursive: true });
    
    await fs.writeFile(
      path.join(rulesDir, "typescript.md"),
      `---
pathPattern: "*.ts"
tools: ["write", "patch"]
priority: 10
---

# TypeScript Rules
- Use TypeScript strict mode
`
    );

    await manager.load();
    
    const rules = manager.getApplicableRules("test.ts");
    expect(rules.length).toBe(1);
    expect(rules[0].pathPattern).toBe("*.ts");
  });

  it("should build context for applicable rules", async () => {
    const rulesDir = path.join(tempDir, ".nexcode", "rules");
    await fs.mkdir(rulesDir, { recursive: true });
    
    await fs.writeFile(
      path.join(rulesDir, "typescript.md"),
      `---
pathPattern: "*.ts"
---

# TypeScript Rules
- Use strict mode
`
    );

    await manager.load();
    
    const context = manager.buildContext("test.ts");
    expect(context).toContain("TypeScript Rules");
  });

  it("should filter rules by tool", async () => {
    const rulesDir = path.join(tempDir, ".nexcode", "rules");
    await fs.mkdir(rulesDir, { recursive: true });
    
    await fs.writeFile(
      path.join(rulesDir, "write-only.md"),
      `---
pathPattern: "*.ts"
tools: ["write"]
---

# Write Rules
- Always read first
`
    );

    await manager.load();
    
    const rulesForWrite = manager.getApplicableRules("test.ts", "write");
    expect(rulesForWrite.length).toBe(1);

    const rulesForRead = manager.getApplicableRules("test.ts", "read");
    expect(rulesForRead.length).toBe(0);
  });

  it("should create default rules", async () => {
    await manager.createDefaultRules();
    await manager.load();
    
    const rulesDir = path.join(tempDir, ".nexcode", "rules");
    const files = await fs.readdir(rulesDir);
    expect(files.length).toBeGreaterThan(0);
  });
});
