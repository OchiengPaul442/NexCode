import fs from "fs/promises";
import path from "path";
import { Minimatch } from "minimatch";

export interface PathScopedRule {
  /** Glob pattern for file paths this rule applies to */
  pathPattern: string;
  /** Instructions to inject when files matching pathPattern are accessed */
  instructions: string;
  /** Optional: only apply when specific tools are used */
  tools?: string[];
  /** Optional: priority (higher = applied later, overrides earlier) */
  priority?: number;
}

/**
 * Manages path-scoped rules that inject context-specific instructions
 * when files matching certain patterns are accessed.
 * 
 * Similar to Claude Code's `.claude/rules/` with YAML frontmatter.
 * 
 * Rule files are stored in `.nexcode/rules/` directory:
 *   .nexcode/rules/
 *     typescript.md    # Rules for *.ts files
 *     tests.md         # Rules for *.test.ts files
 *     config.md        # Rules for *.json, *.yaml files
 */
export class PathScopedRuleManager {
  private readonly rulesDir: string;
  private rules: PathScopedRule[] = [];
  private loaded = false;

  /**
   * @param storagePath - VS Code's globalStoragePath (NOT the workspace root)
   *                      Rules are stored here, not in the user's project.
   */
  constructor(storagePath: string) {
    this.rulesDir = path.join(storagePath, "rules");
  }

  /**
   * Load all rules from the rules directory.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      await fs.mkdir(this.rulesDir, { recursive: true });
      const files = await fs.readdir(this.rulesDir);

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const rule = await this.parseRuleFile(path.join(this.rulesDir, file));
        if (rule) {
          this.rules.push(rule);
        }
      }

      // Sort by priority (lower first, higher overrides)
      this.rules.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
      this.loaded = true;
    } catch {
      // Best effort — rules are optional
      this.loaded = true;
    }
  }

  /**
   * Get applicable rules for a given file path and tool.
   */
  getApplicableRules(filePath: string, toolName?: string): PathScopedRule[] {
    return this.rules.filter(rule => {
      // Check path pattern
      const mm = new Minimatch(rule.pathPattern);
      if (!mm.match(filePath)) {
        return false;
      }

      // Check tool filter
      if (rule.tools && toolName && !rule.tools.includes(toolName)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Build context string from applicable rules.
   */
  buildContext(filePath: string, toolName?: string): string {
    const applicable = this.getApplicableRules(filePath, toolName);
    if (applicable.length === 0) return "";

    return [
      "Path-scoped rules for this file:",
      ...applicable.map(rule => `- ${rule.instructions}`),
    ].join("\n");
  }

  /**
   * Parse a rule file with YAML-like frontmatter.
   * 
   * Format:
   * ```
   * ---
   * pathPattern: "*.ts"
   * tools: ["write", "patch"]
   * priority: 10
   * ---
   * 
   * # TypeScript Rules
   * - Use TypeScript strict mode
   * - Add JSDoc comments to all exports
   * ```
   */
  private async parseRuleFile(filePath: string): Promise<PathScopedRule | null> {
    try {
      const content = await fs.readFile(filePath, "utf8");
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

      if (!frontmatterMatch) {
        // No frontmatter — treat entire file as instructions with filename as path pattern
        const basename = path.basename(filePath, ".md");
        return {
          pathPattern: `*.${basename}`,
          instructions: content.trim(),
        };
      }

      const frontmatter = frontmatterMatch[1];
      const instructions = frontmatterMatch[2].trim();

      // Parse simple YAML-like frontmatter
      const rule: PathScopedRule = {
        pathPattern: "",
        instructions,
      };

      for (const line of frontmatter.split("\n")) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (!match) continue;

        const [, key, value] = match;
        switch (key) {
          case "pathPattern":
          case "pattern":
            rule.pathPattern = value.replace(/^["']|["']$/g, "");
            break;
          case "tools":
            rule.tools = JSON.parse(value);
            break;
          case "priority":
            rule.priority = parseInt(value, 10);
            break;
        }
      }

      if (!rule.pathPattern) {
        // Use filename as default pattern
        const basename = path.basename(filePath, ".md");
        rule.pathPattern = `*.${basename}`;
      }

      return rule;
    } catch {
      return null;
    }
  }

  /**
   * Create a default rule file for demonstration.
   */
  async createDefaultRules(): Promise<void> {
    const defaultRules = [
      {
        filename: "typescript.md",
        content: `---
pathPattern: "*.ts"
tools: ["write", "patch"]
priority: 10
---

# TypeScript Rules
- Use TypeScript strict mode
- Add JSDoc comments to all exports
- Prefer interfaces over type aliases
- Use readonly for immutable properties
`,
      },
      {
        filename: "tests.md",
        content: `---
pathPattern: "*.test.ts"
tools: ["write", "patch"]
priority: 20
---

# Test Rules
- Follow existing test patterns
- Use descriptive test names
- Mock external dependencies
- Test both success and error cases
`,
      },
      {
        filename: "config.md",
        content: `---
pathPattern: "*.{json,yaml,yml,toml}"
tools: ["write"]
priority: 5
---

# Config File Rules
- Validate JSON syntax before writing
- Preserve existing formatting
- Add comments where supported
`,
      },
    ];

    try {
      await fs.mkdir(this.rulesDir, { recursive: true });
      for (const rule of defaultRules) {
        const filePath = path.join(this.rulesDir, rule.filename);
        try {
          await fs.access(filePath);
        } catch {
          await fs.writeFile(filePath, rule.content, "utf8");
        }
      }
    } catch {
      // Best effort
    }
  }
}
