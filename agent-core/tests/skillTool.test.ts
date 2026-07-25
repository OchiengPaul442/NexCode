import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SkillTool } from "../src/tools/skillTool";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("SkillTool", () => {
  let tempDir: string;
  let skillTool: SkillTool;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-tool-test-"));
    skillTool = new SkillTool(tempDir);
    
    // Create a test skill
    const skillsDir = path.join(tempDir, ".opencode", "skills", "test-skill");
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, "SKILL.md"),
      `---
name: Test Skill
description: A test skill for testing
---

# Test Skill Instructions

This is a test skill that does test things.

## Steps
1. Do step 1
2. Do step 2
3. Do step 3
`
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should create skill tool", () => {
    expect(skillTool).toBeDefined();
  });

  it("should load skills from directory", async () => {
    await skillTool.loadSkills();
    const skills = skillTool.listSkills();
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("Test Skill");
  });

  it("should execute a skill", async () => {
    await skillTool.loadSkills();
    
    const result = await skillTool.executeSkill("test-skill", {
      param1: "value1",
    });
    
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Test Skill");
    expect(result.output).toContain("Test Skill Instructions");
    expect(result.output).toContain("param1: value1");
  });

  it("should return error for unknown skill", async () => {
    await skillTool.loadSkills();
    
    const result = await skillTool.executeSkill("unknown-skill", {});
    
    expect(result.ok).toBe(false);
    expect(result.output).toContain("not found");
  });

  it("should handle missing skills directory", async () => {
    const emptyDir = path.join(tempDir, "empty");
    await fs.mkdir(emptyDir, { recursive: true });
    
    const emptySkillTool = new SkillTool(emptyDir);
    await emptySkillTool.loadSkills();
    
    const skills = emptySkillTool.listSkills();
    expect(skills.length).toBe(0);
  });
});
