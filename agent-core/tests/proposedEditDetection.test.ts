/**
 * Tests for "Proposed Edit" format detection in ollamaProvider and agentLoop.
 *
 * When models generate "Proposed Edit" format instead of using the write tool,
 * the agent should detect this and automatically create a write tool call.
 */

import { describe, it, expect } from "vitest";

// Re-implement the extraction logic from ollamaProvider.ts for testing
function extractProposedEditFromText(text: string): { filePath: string; content: string } | null {
  const proposedEditPatterns = [
    // Standard: ## Proposed Edit\nFile: ...\nInstruction: ...
    /##\s*Proposed\s*Edit\s*\n\s*(?:File|Path|FilePath)\s*:\s*(.+?)\s*\n\s*(?:Instruction|Change|Edit|Description)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
    // With content block: ## Proposed Edit\nFile: ...\n\n```\n...\n```
    /##\s*Proposed\s*Edit\s*\n\s*(?:File|Path|FilePath)\s*:\s*(.+?)\s*\n\s*(?:```[\s\S]*?```)/i,
    // Alternative formats: "Edit File:", "Modify File:"
    /##\s*(?:Edit|Modify)\s*(?:File|Path)\s*:\s*(.+?)\s*\n\s*(?:Change|Edit|Description|Content)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
    // Inline format: "Proposed Edit to <file>"
    /(?:Proposed|Suggested)\s+(?:Edit|Change)\s+(?:to|for)\s+[`"']?([^\s`"']+)[`"']?\s*:\s*(.+?)(?:\n\n|\n|$)/i,
    // H3 format: ### Edit\nFile: ...\nInstruction: ...
    /###\s*(?:Edit|Proposed\s*Edit)\s*\n\s*(?:File|Path|FilePath)\s*:\s*(.+?)\s*\n\s*(?:Instruction|Change|Edit|Description|Content)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
    // "Proposed change to file" format
    /Proposed\s+change\s+to\s+(?:file\s+)?[`"']?([^\s`"']+)[`"']?\s*(?::\s*\n|\n)\s*(?:Instruction|Change|Edit|Description|Content)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
    // "Edit file:" format (no heading)
    /(?:Edit|Modify|Update)\s+(?:file|path)\s*:\s*[`"']?([^\s`"']+)[`"']?\s*\n\s*(?:Instruction|Change|Edit|Description|Content|New)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
    // "File: ...\nEdit:" format (no heading)
    /(?:File|Path)\s*:\s*[`"']?([^\s`"']+)[`"']?\s*\n\s*(?:Edit|Change|Instruction|Description|Content|New)\s*:\s*(.+?)(?:\n\n|\n|$)/i,
  ];

  for (const pattern of proposedEditPatterns) {
    const match = text.match(pattern);
    if (match) {
      const filePath = match[1].trim();
      const instruction = match[2]?.trim() ?? "";
      
      // Try to extract content from code blocks (prefer actual code over instruction)
      const codeBlockMatch = text.match(/```[\s\S]*?```/);
      const content = codeBlockMatch 
        ? codeBlockMatch[0].replace(/```\w*\n?/g, '').replace(/```/g, '').trim() 
        : instruction;
      
      if (filePath && content) {
        return { filePath, content };
      }
    }
  }
  
  return null;
}

describe("Proposed Edit format detection", () => {
  describe("Standard patterns", () => {
    it("detects '## Proposed Edit' with File and Instruction", () => {
      const text = `## Proposed Edit
File: package.json
Instruction: Add a new script called "lint" to package.json that runs echo linting`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("package.json");
      expect(result!.content).toContain("Add a new script called \"lint\"");
    });

    it("detects '## Proposed Edit' with Path and Change", () => {
      const text = `## Proposed Edit
Path: src/index.ts
Change: Add error handling for the main function`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/index.ts");
      expect(result!.content).toContain("Add error handling");
    });

    it("detects '## Proposed Edit' with FilePath and Description", () => {
      const text = `## Proposed Edit
FilePath: lib/utils.js
Description: Export the helper function`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("lib/utils.js");
      expect(result!.content).toContain("Export the helper function");
    });
  });

  describe("Code block patterns", () => {
    it("extracts content from code block when available", () => {
      const text = `## Proposed Edit
File: src/app.ts

\`\`\`typescript
export function newFunction() {
  return "hello";
}
\`\`\``;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/app.ts");
      expect(result!.content).toContain("export function newFunction()");
    });
  });

  describe("Alternative heading patterns", () => {
    it("detects '## Edit File:' with Change", () => {
      const text = `## Edit File:
src/config.ts
Change: Update the database configuration`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/config.ts");
      expect(result!.content).toContain("Update the database configuration");
    });

    it("detects '## Modify File:' with Edit", () => {
      const text = `## Modify File:
README.md
Edit: Add installation instructions`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("README.md");
      expect(result!.content).toContain("Add installation instructions");
    });
  });

  describe("Inline patterns", () => {
    it("detects 'Proposed Edit to <file>'", () => {
      const text = `Proposed Edit to src/main.ts: Add error handling for the API calls`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/main.ts");
      expect(result!.content).toContain("Add error handling");
    });

    it("detects 'Suggested Change for <file>'", () => {
      const text = `Suggested Change for lib/helpers.ts: Refactor the utility functions`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("lib/helpers.ts");
      expect(result!.content).toContain("Refactor the utility functions");
    });
  });

  describe("H3 heading patterns", () => {
    it("detects '### Edit' with File and Instruction", () => {
      const text = `### Edit
File: src/types.ts
Instruction: Add new interface for API response`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/types.ts");
      expect(result!.content).toContain("Add new interface");
    });

    it("detects '### Proposed Edit' with Path and Content", () => {
      const text = `### Proposed Edit
Path: test/unit.test.ts
Content: Add test case for the new function`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("test/unit.test.ts");
      expect(result!.content).toContain("Add test case");
    });
  });

  describe("Natural language patterns", () => {
    it("detects 'Proposed change to file'", () => {
      const text = `Proposed change to file config.json
Instruction: Add the new feature flag`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("config.json");
      expect(result!.content).toContain("Add the new feature flag");
    });
  });

  describe("No-heading patterns", () => {
    it("detects 'Edit file:' without heading", () => {
      const text = `Edit file: src/utils.ts
Instruction: Add a new helper function`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/utils.ts");
      expect(result!.content).toContain("Add a new helper function");
    });

    it("detects 'Modify path:' without heading", () => {
      const text = `Modify path: lib/constants.ts
Description: Update the API endpoints`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("lib/constants.ts");
      expect(result!.content).toContain("Update the API endpoints");
    });

    it("detects 'Update file:' without heading", () => {
      const text = `Update file: docs/readme.md
New: Add troubleshooting section`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("docs/readme.md");
      expect(result!.content).toContain("Add troubleshooting section");
    });

    it("detects 'File: ...\nEdit:' format", () => {
      const text = `File: package.json
Edit: Add a new dependency`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("package.json");
      expect(result!.content).toContain("Add a new dependency");
    });

    it("detects 'Path: ...\nChange:' format", () => {
      const text = `Path: src/index.ts
Change: Fix the memory leak`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/index.ts");
      expect(result!.content).toContain("Fix the memory leak");
    });
  });

  describe("Case insensitivity", () => {
    it("detects 'PROPOSED EDIT' (uppercase)", () => {
      const text = `## PROPOSED EDIT
File: src/app.ts
Instruction: Add logging`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/app.ts");
    });

    it("detects 'proposed edit' (lowercase)", () => {
      const text = `## proposed edit
File: src/app.ts
Instruction: Add logging`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/app.ts");
    });
  });

  describe("Edge cases", () => {
    it("returns null for text without proposed edit format", () => {
      const text = `Here is my response about the code.`;
      
      const result = extractProposedEditFromText(text);
      expect(result).toBeNull();
    });

    it("returns null for empty text", () => {
      const result = extractProposedEditFromText("");
      expect(result).toBeNull();
    });

    it("handles file paths without spaces", () => {
      const text = `## Proposed Edit
File: src/app.ts
Instruction: Fix the bug`;
      
      const result = extractProposedEditFromText(text);
      expect(result).not.toBeNull();
      expect(result!.filePath).toBe("src/app.ts");
    });
  });
});
