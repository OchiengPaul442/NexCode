import { describe, it, expect, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import {
  buildWorkspaceContext,
  clampText,
  extractLikelyFileReferences,
  buildAttachmentContext,
  normalizeActivityPath,
  getWorkspaceFileTree,
  detectProjectManifest,
  getRecentlyModifiedFiles,
} from "../src/orchestrator/contextBuilder";
import { RequestAttachment } from "../src/types";

// Mock fs
vi.mock("fs/promises");

const mockedFs = vi.mocked(fs);

describe("contextBuilder", () => {
  describe("clampText", () => {
    it("returns text if under limit", () => {
      const result = clampText("hello", 10, "trimmed");
      expect(result).toBe("hello");
    });

    it("clamps text over limit", () => {
      const result = clampText("hello world", 5, "trimmed");
      expect(result).toBe("hello\n\n[trimmed; 6 characters omitted]");
    });
  });

  describe("extractLikelyFileReferences", () => {
    it("extracts file paths", () => {
      const result = extractLikelyFileReferences(
        "Check src/index.ts and test.js",
      );
      expect(result).toEqual(["src/index.ts", "test.js"]);
    });

    it("filters short matches", () => {
      const result = extractLikelyFileReferences("a.b");
      expect(result).toEqual(["a.b"]);
    });
  });

  describe("buildAttachmentContext", () => {
    it("builds context for text attachment", () => {
      const attachments: RequestAttachment[] = [
        {
          fileName: "test.txt",
          kind: "text",
          mimeType: "text/plain",
          byteSize: 100,
          textContent: "hello world",
        },
      ];
      const result = buildAttachmentContext(attachments);
      expect(result).toContain("test.txt");
      expect(result).toContain("hello world");
    });
  });

  describe("normalizeActivityPath", () => {
    it("normalizes path", () => {
      const result = normalizeActivityPath("src\\file.ts", "/workspace");
      expect(result).toBe("src/file.ts");
    });
  });

  describe("buildWorkspaceContext", () => {
    it("builds context", async () => {
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (String(dir) === "/workspace") {
          return [
            { name: "src", isDirectory: () => true },
            { name: "package.json", isDirectory: () => false },
          ] as any;
        }
        return [] as any;
      });
      mockedFs.readFile.mockImplementation(async (p: any) => {
        if (String(p).includes("index.ts")) {
          return "content";
        }
        throw new Error("ENOENT");
      });
      mockedFs.stat.mockRejectedValue(new Error("ENOENT"));

      const request = {
        workspaceRoot: "/workspace",
        activeFilePath: "src/index.ts",
        selectedText: "selected",
        prompt: "prompt",
        attachments: [] as RequestAttachment[],
      };

      const result = await buildWorkspaceContext(request, "/default");

      expect(result).toContain("Workspace root: /workspace");
      expect(result).toContain("Project files");
      expect(result).toContain("package.json");
      expect(result).toContain("Active file: src/index.ts");
    });
  });

  describe("getWorkspaceFileTree", () => {
    it("lists files recursively", async () => {
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (String(dir) === "/workspace-tree") {
          return [
            { name: "src", isDirectory: () => true },
            { name: "node_modules", isDirectory: () => true },
            { name: "package.json", isDirectory: () => false },
          ] as any;
        }
        if (String(dir).includes("src")) {
          return [
            { name: "index.ts", isDirectory: () => false },
          ] as any;
        }
        return [] as any;
      });

      const files = await getWorkspaceFileTree("/workspace-tree");
      expect(files).toContain("package.json");
      expect(files).toContain("src/index.ts");
      expect(files).not.toContain("node_modules/something.js");
    });
  });

  describe("detectProjectManifest", () => {
    it("detects package.json", async () => {
      mockedFs.readFile.mockImplementation(async (p: any) => {
        if (String(p).includes("package.json")) {
          return JSON.stringify({
            name: "test-project",
            dependencies: { a: "1", b: "2" },
            devDependencies: { c: "1" },
            scripts: { build: "tsc", test: "vitest" },
          });
        }
        throw new Error("ENOENT");
      });

      const result = await detectProjectManifest("/workspace-manifest");
      expect(result).toContain("test-project");
      expect(result).toContain("Node.js");
      expect(result).toContain("3 dependencies");
      expect(result).toContain("2 scripts");
    });

    it("detects pyproject.toml for Python projects", async () => {
      mockedFs.readFile.mockImplementation(async (p: any) => {
        const sp = String(p);
        if (sp.includes("pyproject.toml")) {
          return 'name = "my-python-app"\n[project]\ndependencies = ["requests>=2.28"]\nrequires = ["setuptools"]';
        }
        throw new Error("ENOENT");
      });

      const result = await detectProjectManifest("/ws-py");
      expect(result).toContain("my-python-app");
      expect(result).toContain("Python");
    });

    it("detects go.mod for Go projects", async () => {
      mockedFs.readFile.mockImplementation(async (p: any) => {
        const sp = String(p);
        if (sp.includes("go.mod")) {
          return "module github.com/example/mygoapp\n\ngo 1.21\n";
        }
        throw new Error("ENOENT");
      });

      const result = await detectProjectManifest("/ws-go");
      expect(result).toContain("github.com/example/mygoapp");
      expect(result).toContain("Go");
    });

    it("detects Cargo.toml for Rust projects", async () => {
      mockedFs.readFile.mockImplementation(async (p: any) => {
        const sp = String(p);
        if (sp.includes("Cargo.toml")) {
          return '[package]\nname = "my-rust-crate"\nversion = "0.1.0"\n';
        }
        throw new Error("ENOENT");
      });

      const result = await detectProjectManifest("/ws-rust");
      expect(result).toContain("my-rust-crate");
      expect(result).toContain("Rust");
    });

    it("detects .sln for C#/.NET projects", async () => {
      mockedFs.readFile.mockImplementation(async () => {
        throw new Error("ENOENT");
      });
      mockedFs.readdir.mockResolvedValue(["MySolution.sln", "src"] as any);

      const result = await detectProjectManifest("/ws-dotnet");
      expect(result).toContain("MySolution");
      expect(result).toContain("C#/.NET");
    });

    it("detects .csproj for C#/.NET projects", async () => {
      mockedFs.readFile.mockImplementation(async () => {
        throw new Error("ENOENT");
      });
      mockedFs.readdir.mockResolvedValue(["MyApp.csproj", "Program.cs"] as any);

      const result = await detectProjectManifest("/ws-csproj");
      expect(result).toContain("MyApp");
      expect(result).toContain("C#/.NET");
    });

    it("detects build.gradle for Java/Gradle projects", async () => {
      mockedFs.readFile.mockImplementation(async () => {
        throw new Error("ENOENT");
      });
      mockedFs.readdir.mockResolvedValue(["build.gradle", "src"] as any);

      const result = await detectProjectManifest("/ws-gradle");
      expect(result).toContain("Java/Gradle");
    });

    it("detects pom.xml for Java/Maven projects", async () => {
      mockedFs.readFile.mockImplementation(async () => {
        throw new Error("ENOENT");
      });
      mockedFs.readdir.mockResolvedValue(["pom.xml", "src"] as any);

      const result = await detectProjectManifest("/ws-maven");
      expect(result).toContain("Java/Maven");
    });

    it("returns null when no manifest found", async () => {
      mockedFs.readFile.mockRejectedValue(new Error("ENOENT"));
      mockedFs.readdir.mockRejectedValue(new Error("ENOENT"));

      const result = await detectProjectManifest("/ws-empty");
      expect(result).toBeNull();
    });
  });

  describe("getWorkspaceFileTree - ignore patterns", () => {
    it("skips node_modules directory", async () => {
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (String(dir) === "/ws-ignore") {
          return [
            { name: "src", isDirectory: () => true },
            { name: "node_modules", isDirectory: () => true },
            { name: "package.json", isDirectory: () => false },
          ] as any;
        }
        if (String(dir).includes("src")) {
          return [{ name: "index.ts", isDirectory: () => false }] as any;
        }
        if (String(dir).includes("node_modules")) {
          return [{ name: "pkg", isDirectory: () => true }] as any;
        }
        return [] as any;
      });

      const files = await getWorkspaceFileTree("/ws-ignore");
      expect(files).toContain("package.json");
      expect(files).toContain("src/index.ts");
      expect(files).not.toContain("node_modules/pkg");
    });

    it("skips .git directory", async () => {
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (String(dir) === "/ws-git") {
          return [
            { name: ".git", isDirectory: () => true },
            { name: "src", isDirectory: () => true },
            { name: "README.md", isDirectory: () => false },
          ] as any;
        }
        if (String(dir).includes("src")) {
          return [{ name: "main.ts", isDirectory: () => false }] as any;
        }
        return [] as any;
      });

      const files = await getWorkspaceFileTree("/ws-git");
      expect(files).toContain("README.md");
      expect(files).toContain("src/main.ts");
      expect(files.every((f) => !f.startsWith(".git/"))).toBe(true);
    });

    it("skips dist, build, __pycache__, .next, coverage directories", async () => {
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (String(dir) === "/ws-skips") {
          return [
            { name: "dist", isDirectory: () => true },
            { name: "build", isDirectory: () => true },
            { name: "__pycache__", isDirectory: () => true },
            { name: ".next", isDirectory: () => true },
            { name: "coverage", isDirectory: () => true },
            { name: "src", isDirectory: () => true },
            { name: "app.ts", isDirectory: () => false },
          ] as any;
        }
        if (String(dir).includes("src")) {
          return [{ name: "index.ts", isDirectory: () => false }] as any;
        }
        return [] as any;
      });

      const files = await getWorkspaceFileTree("/ws-skips");
      expect(files).toContain("app.ts");
      expect(files).toContain("src/index.ts");
      expect(files).not.toContain("dist/bundle.js");
      expect(files).not.toContain("build/output.js");
      expect(files).not.toContain("__pycache__/module.pyc");
      expect(files).not.toContain(".next/server.js");
      expect(files).not.toContain("coverage/lcov.info");
    });

    it("skips .vscode, .idea, .cache, out, .turbo, .vercel, .netlify directories", async () => {
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (String(dir) === "/ws-extra-skips") {
          return [
            { name: ".vscode", isDirectory: () => true },
            { name: ".idea", isDirectory: () => true },
            { name: ".cache", isDirectory: () => true },
            { name: "out", isDirectory: () => true },
            { name: ".turbo", isDirectory: () => true },
            { name: ".vercel", isDirectory: () => true },
            { name: ".netlify", isDirectory: () => true },
            { name: "src", isDirectory: () => true },
            { name: "app.ts", isDirectory: () => false },
          ] as any;
        }
        if (String(dir).includes("src")) {
          return [{ name: "index.ts", isDirectory: () => false }] as any;
        }
        return [] as any;
      });

      const files = await getWorkspaceFileTree("/ws-extra-skips");
      expect(files).toContain("app.ts");
      expect(files).toContain("src/index.ts");
      expect(files).not.toContain(".vscode/settings.json");
      expect(files).not.toContain(".idea/workspace.xml");
    });

    it("includes allowed hidden files like .gitignore, .env.example", async () => {
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (String(dir) === "/ws-allowed") {
          return [
            { name: ".gitignore", isDirectory: () => false },
            { name: ".env.example", isDirectory: () => false },
            { name: ".eslintrc", isDirectory: () => false },
            { name: ".prettierrc", isDirectory: () => false },
            { name: "app.ts", isDirectory: () => false },
          ] as any;
        }
        return [] as any;
      });

      const files = await getWorkspaceFileTree("/ws-allowed");
      expect(files).toContain(".gitignore");
      expect(files).toContain(".env.example");
      expect(files).toContain(".eslintrc");
      expect(files).toContain(".prettierrc");
      expect(files).toContain("app.ts");
    });

    it("skips hidden dirs in SKIP_DIRS like .git, .vscode, .idea, .cache", async () => {
      mockedFs.readdir.mockImplementation(async (dir: any) => {
        if (String(dir) === "/ws-hidden") {
          return [
            { name: ".git", isDirectory: () => true },
            { name: ".vscode", isDirectory: () => true },
            { name: ".idea", isDirectory: () => true },
            { name: ".cache", isDirectory: () => true },
            { name: ".env", isDirectory: () => false },
            { name: ".DS_Store", isDirectory: () => false },
            { name: "src", isDirectory: () => true },
            { name: "app.ts", isDirectory: () => false },
          ] as any;
        }
        if (String(dir).includes("src")) {
          return [{ name: "index.ts", isDirectory: () => false }] as any;
        }
        if (String(dir).includes(".git")) {
          return [{ name: "config", isDirectory: () => false }] as any;
        }
        return [] as any;
      });

      const files = await getWorkspaceFileTree("/ws-hidden");
      expect(files).toContain("app.ts");
      expect(files).toContain("src/index.ts");
      expect(files).toContain(".env");
      expect(files).toContain(".DS_Store");
      expect(files).not.toContain(".git/config");
      expect(files).not.toContain(".vscode/settings.json");
    });
  });
});
