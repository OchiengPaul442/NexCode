import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

vi.mock("fs");

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build"]);

function countFiles(dir: string): { total: number; byExtension: Record<string, number> } {
  let total = 0;
  const byExtension: Record<string, number> = {};

  function walk(currentDir: string) {
    const entries = (fs as any).readdirSync(currentDir, { withFileTypes: true }) as fs.Dirent[];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(currentDir, entry.name));
      } else if (entry.isFile()) {
        total++;
        const ext = path.extname(entry.name).toLowerCase() || "(no ext)";
        byExtension[ext] = (byExtension[ext] || 0) + 1;
      }
    }
  }

  walk(dir);
  return { total, byExtension };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workspace-stats: countFiles", () => {
  it("returns correct file counts for a flat directory", () => {
    (fs.readdirSync as any).mockReturnValue([
      { name: "a.ts", isFile: () => true, isDirectory: () => false },
      { name: "b.ts", isFile: () => true, isDirectory: () => false },
      { name: "c.js", isFile: () => true, isDirectory: () => false },
    ]);

    const result = countFiles("/workspace");
    expect(result.total).toBe(3);
    expect(result.byExtension[".ts"]).toBe(2);
    expect(result.byExtension[".js"]).toBe(1);
  });

  it("skips node_modules directory", () => {
    (fs.readdirSync as any).mockImplementation((dir: string) => {
      if (dir === "/workspace") {
        return [
          { name: "index.ts", isFile: () => true, isDirectory: () => false },
          { name: "node_modules", isFile: () => false, isDirectory: () => true },
        ];
      }
      if (dir === "/workspace/node_modules") {
        throw new Error("should not be entered");
      }
      return [];
    });

    const result = countFiles("/workspace");
    expect(result.total).toBe(1);
    expect(result.byExtension[".ts"]).toBe(1);
  });

  it("skips .git directory", () => {
    (fs.readdirSync as any).mockImplementation((dir: string) => {
      if (dir === "/workspace") {
        return [
          { name: "readme.md", isFile: () => true, isDirectory: () => false },
          { name: ".git", isFile: () => false, isDirectory: () => true },
        ];
      }
      if (dir === "/workspace/.git") {
        throw new Error("should not be entered");
      }
      return [];
    });

    const result = countFiles("/workspace");
    expect(result.total).toBe(1);
    expect(result.byExtension[".md"]).toBe(1);
  });

  it("skips dist and build directories", () => {
    (fs.readdirSync as any).mockImplementation((dir: string) => {
      if (dir === "/workspace") {
        return [
          { name: "src.ts", isFile: () => true, isDirectory: () => false },
          { name: "dist", isFile: () => false, isDirectory: () => true },
          { name: "build", isFile: () => false, isDirectory: () => true },
        ];
      }
      return [];
    });

    const result = countFiles("/workspace");
    expect(result.total).toBe(1);
  });

  it("counts by extension correctly across nested directories", () => {
    const srcDir = path.join("/workspace", "src");
    const entries: Record<string, fs.Dirent[]> = {
      ["/workspace"]: [
        { name: "a.ts", isFile: () => true, isDirectory: () => false } as any,
        { name: "src", isFile: () => false, isDirectory: () => true } as any,
      ],
      [srcDir]: [
        { name: "b.ts", isFile: () => true, isDirectory: () => false } as any,
        { name: "c.tsx", isFile: () => true, isDirectory: () => false } as any,
        { name: "d.js", isFile: () => true, isDirectory: () => false } as any,
      ],
    };
    (fs.readdirSync as any).mockImplementation((dir: string) => entries[dir] ?? []);

    const result = countFiles("/workspace");
    expect(result.total).toBe(4);
    expect(result.byExtension[".ts"]).toBe(2);
    expect(result.byExtension[".tsx"]).toBe(1);
    expect(result.byExtension[".js"]).toBe(1);
  });

  it("handles files without extension", () => {
    (fs.readdirSync as any).mockReturnValue([
      { name: "Makefile", isFile: () => true, isDirectory: () => false },
      { name: "Dockerfile", isFile: () => true, isDirectory: () => false },
    ]);

    const result = countFiles("/workspace");
    expect(result.total).toBe(2);
    expect(result.byExtension["(no ext)"]).toBe(2);
  });

  it("returns 0 for empty directory", () => {
    (fs.readdirSync as any).mockReturnValue([]);

    const result = countFiles("/workspace");
    expect(result.total).toBe(0);
    expect(result.byExtension).toEqual({});
  });

  it("skips .next directory", () => {
    (fs.readdirSync as any).mockImplementation((dir: string) => {
      if (dir === "/workspace") {
        return [
          { name: "app.ts", isFile: () => true, isDirectory: () => false },
          { name: ".next", isFile: () => false, isDirectory: () => true },
        ];
      }
      if (dir === "/workspace/.next") {
        throw new Error("should not be entered");
      }
      return [];
    });

    const result = countFiles("/workspace");
    expect(result.total).toBe(1);
  });
});
