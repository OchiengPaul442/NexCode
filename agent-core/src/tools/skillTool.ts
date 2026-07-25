import fs from "fs/promises";
import path from "path";
import { type ToolResult } from "../types";

/**
 * Skill metadata parsed from SKILL.md frontmatter.
 */
export interface SkillMetadata {
  name: string;
  description: string;
  location: string;
}

/**
 * SkillTool enables skills to be invoked as tools.
 * 
 * Features:
 * - Auto-discover skills from .opencode/skills/
 * - Register as tools in ToolRegistry
 * - Execute skill workflows
 * - Return structured results
 */
export class SkillTool {
  private readonly skillsDir: string;
  private skills: Map<string, SkillMetadata> = new Map();

  constructor(workspaceRoot: string) {
    this.skillsDir = path.join(workspaceRoot, ".opencode", "skills");
  }

  /**
   * Load all skills from the skills directory.
   */
  async loadSkills(): Promise<void> {
    try {
      await fs.mkdir(this.skillsDir, { recursive: true });
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = path.join(this.skillsDir, entry.name, "SKILL.md");
          try {
            const content = await fs.readFile(skillPath, "utf8");
            const metadata = this.parseSkillMetadata(content, skillPath);
            if (metadata) {
              this.skills.set(entry.name, metadata);
            }
          } catch {
            // Skill file not found or unreadable
          }
        }
      }
    } catch {
      // Skills directory doesn't exist or is empty
    }
  }

  /**
   * Get list of available skills.
   */
  listSkills(): SkillMetadata[] {
    return Array.from(this.skills.values());
  }

  /**
   * Execute a skill by name.
   */
  async executeSkill(
    skillName: string,
    parameters: Record<string, string>,
  ): Promise<ToolResult> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return {
        ok: false,
        output: `Skill '${skillName}' not found. Available skills: ${Array.from(this.skills.keys()).join(", ")}`,
      };
    }

    try {
      const content = await fs.readFile(skill.location, "utf8");
      const instructions = this.extractInstructions(content);

      // Build the skill execution context
      const context = [
        `# Skill: ${skill.name}`,
        "",
        skill.description,
        "",
        "## Instructions",
        "",
        instructions,
        "",
        "## Parameters",
        "",
        ...Object.entries(parameters).map(([key, value]) => `- ${key}: ${value}`),
      ].join("\n");

      return {
        ok: true,
        output: context,
      };
    } catch (error) {
      return {
        ok: false,
        output: `Failed to execute skill '${skillName}': ${String(error)}`,
      };
    }
  }

  /**
   * Parse skill metadata from SKILL.md content.
   */
  private parseSkillMetadata(content: string, location: string): SkillMetadata | null {
    // Parse YAML-like frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      // No frontmatter - use filename as name
      return {
        name: path.basename(path.dirname(location)),
        description: content.slice(0, 200).trim(),
        location,
      };
    }

    const frontmatter = frontmatterMatch[1];
    const metadata: Partial<SkillMetadata> = { location };

    for (const line of frontmatter.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        switch (key) {
          case "name":
            metadata.name = value.replace(/^["']|["']$/g, "");
            break;
          case "description":
            metadata.description = value.replace(/^["']|["']$/g, "");
            break;
        }
      }
    }

    if (!metadata.name) {
      metadata.name = path.basename(path.dirname(location));
    }

    return metadata as SkillMetadata;
  }

  /**
   * Extract instructions from skill content (after frontmatter).
   */
  private extractInstructions(content: string): string {
    const frontmatterEnd = content.indexOf("---", 3);
    if (frontmatterEnd === -1) {
      return content.trim();
    }
    return content.slice(frontmatterEnd + 3).trim();
  }
}
