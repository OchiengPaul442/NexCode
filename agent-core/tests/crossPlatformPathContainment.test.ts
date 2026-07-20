/**
 * NC-020: Cross-platform path containment tests.
 *
 * On POSIX, `path.isAbsolute("C:\\Windows\\...")` returns false, so Windows
 * absolute paths can be treated as workspace-relative and bypass containment.
 * These tests verify that the path containment utilities reject dangerous
 * path forms from both platforms regardless of host OS.
 */
import { describe, it, expect } from "vitest";
import path from "path";
import {
  isPathAbsoluteCrossPlatform,
  containsNullBytes,
  isPathSafeCrossPlatform,
  checkPathWithinWorkspace,
  resolveWorkspacePath,
} from "../src/utils/pathContainment";

// Use a fake workspace root that definitely exists for resolveWorkspacePath
const WORKSPACE = process.platform === "win32" ? "C:\\workspace" : "/home/user/workspace";

// ─── isPathAbsoluteCrossPlatform ─────────────────────────────────────

describe("isPathAbsoluteCrossPlatform", () => {
  // POSIX absolute paths (detected by host path.isAbsolute)
  it("rejects POSIX absolute path /etc/passwd", () => {
    expect(isPathAbsoluteCrossPlatform("/etc/passwd")).toBe(true);
  });

  it("rejects POSIX absolute path /tmp/evil.ts", () => {
    expect(isPathAbsoluteCrossPlatform("/tmp/evil.ts")).toBe(true);
  });

  // Windows absolute paths (drive letter + separator)
  it("rejects Windows absolute path C:\\Windows\\System32", () => {
    expect(isPathAbsoluteCrossPlatform("C:\\Windows\\System32")).toBe(true);
  });

  it("rejects Windows absolute path D:\\data\\file.txt", () => {
    expect(isPathAbsoluteCrossPlatform("D:\\data\\file.txt")).toBe(true);
  });

  it("rejects Windows forward-slash path C:/Windows/System32", () => {
    expect(isPathAbsoluteCrossPlatform("C:/Windows/System32")).toBe(true);
  });

  it("rejects lowercase drive letter c:\\windows\\system32", () => {
    expect(isPathAbsoluteCrossPlatform("c:\\windows\\system32")).toBe(true);
  });

  // Drive-relative paths (C:foo — no separator after colon)
  it("rejects drive-relative path C:foo", () => {
    expect(isPathAbsoluteCrossPlatform("C:foo")).toBe(true);
  });

  it("rejects drive-relative path D:relative\\path", () => {
    expect(isPathAbsoluteCrossPlatform("D:relative\\path")).toBe(true);
  });

  // UNC paths
  it("rejects UNC path \\\\server\\share", () => {
    expect(isPathAbsoluteCrossPlatform("\\\\server\\share")).toBe(true);
  });

  it("rejects UNC path \\\\192.168.1.1\\c$", () => {
    expect(isPathAbsoluteCrossPlatform("\\\\192.168.1.1\\c$")).toBe(true);
  });

  // Device / extended-length paths
  it("rejects device path \\\\.\\COM1", () => {
    expect(isPathAbsoluteCrossPlatform("\\\\.\\COM1")).toBe(true);
  });

  it("rejects extended-length path \\\\?\\C:\\long\\path", () => {
    expect(isPathAbsoluteCrossPlatform("\\\\?\\C:\\long\\path")).toBe(true);
  });

  // Safe relative paths
  it("allows relative path src/file.ts", () => {
    expect(isPathAbsoluteCrossPlatform("src/file.ts")).toBe(false);
  });

  it("allows relative path ../sibling/file.ts", () => {
    expect(isPathAbsoluteCrossPlatform("../sibling/file.ts")).toBe(false);
  });

  it("allows simple filename file.ts", () => {
    expect(isPathAbsoluteCrossPlatform("file.ts")).toBe(false);
  });

  it("allows dot-path ./file.ts", () => {
    expect(isPathAbsoluteCrossPlatform("./file.ts")).toBe(false);
  });

  it("allows deeply nested relative path a/b/c/d.ts", () => {
    expect(isPathAbsoluteCrossPlatform("a/b/c/d.ts")).toBe(false);
  });

  // Edge cases
  it("allows empty string (caller should reject separately)", () => {
    expect(isPathAbsoluteCrossPlatform("")).toBe(false);
  });

  it("rejects Z: drive letter", () => {
    expect(isPathAbsoluteCrossPlatform("Z:\\test")).toBe(true);
  });

  it("rejects only two backslashes (empty UNC server)", () => {
    // \\ alone is not a valid UNC but two backslashes is suspicious
    // The regex /^\\\\[^\\]/ requires a non-backslash after \\, so \\foo matches
    expect(isPathAbsoluteCrossPlatform("\\\\foo")).toBe(true);
  });
});

// ─── containsNullBytes ───────────────────────────────────────────────

describe("containsNullBytes", () => {
  it("detects null byte in middle", () => {
    expect(containsNullBytes("file\x00.ts")).toBe(true);
  });

  it("detects null byte at start", () => {
    expect(containsNullBytes("\x00file.ts")).toBe(true);
  });

  it("detects null byte at end", () => {
    expect(containsNullBytes("file.ts\x00")).toBe(true);
  });

  it("allows normal path", () => {
    expect(containsNullBytes("src/file.ts")).toBe(false);
  });

  it("allows empty string", () => {
    expect(containsNullBytes("")).toBe(false);
  });
});

// ─── isPathSafeCrossPlatform ─────────────────────────────────────────

describe("isPathSafeCrossPlatform", () => {
  it("rejects null bytes", () => {
    const result = isPathSafeCrossPlatform("file\x00.ts");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("null bytes");
  });

  it("rejects Windows absolute path on any platform", () => {
    const result = isPathSafeCrossPlatform("C:\\Windows\\System32\\config\\SAM");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("absolute");
  });

  it("rejects POSIX absolute path", () => {
    const result = isPathSafeCrossPlatform("/etc/passwd");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("absolute");
  });

  it("rejects UNC path", () => {
    const result = isPathSafeCrossPlatform("\\\\server\\share\\file");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("absolute");
  });

  it("rejects device path", () => {
    const result = isPathSafeCrossPlatform("\\\\.\\pipe\\my-pipe");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("absolute");
  });

  it("allows safe relative path", () => {
    const result = isPathSafeCrossPlatform("src/file.ts");
    expect(result.safe).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("allows traversal (caller handles separately)", () => {
    const result = isPathSafeCrossPlatform("../etc/passwd");
    expect(result.safe).toBe(true);
  });
});

// ─── checkPathWithinWorkspace cross-platform ─────────────────────────

describe("checkPathWithinWorkspace — cross-platform", () => {
  it("allows relative path within workspace", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "src/file.ts");
    expect(result).toBe(path.join(WORKSPACE, "src/file.ts"));
  });

  it("rejects traversal with ../", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "../etc/passwd");
    expect(result).toBeNull();
  });

  // Windows absolute paths — these must be rejected on ALL platforms
  it("rejects C:\\Windows\\System32 on any platform", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "C:\\Windows\\System32");
    expect(result).toBeNull();
  });

  it("rejects C:\\Windows\\System32\\config\\SAM", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "C:\\Windows\\System32\\config\\SAM");
    expect(result).toBeNull();
  });

  it("rejects D:\\data\\file.txt", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "D:\\data\\file.txt");
    expect(result).toBeNull();
  });

  it("rejects C:/Windows/System32 (forward slash)", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "C:/Windows/System32");
    expect(result).toBeNull();
  });

  it("rejects drive-relative C:foo", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "C:foo");
    expect(result).toBeNull();
  });

  it("rejects UNC path \\\\server\\share", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "\\\\server\\share\\file");
    expect(result).toBeNull();
  });

  it("rejects device path \\\\.\\COM1", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "\\\\.\\COM1");
    expect(result).toBeNull();
  });

  it("rejects extended-length path \\\\?\\C:\\long", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "\\\\?\\C:\\long\\path");
    expect(result).toBeNull();
  });

  // POSIX absolute paths
  it("rejects POSIX absolute /etc/passwd", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "/etc/passwd");
    expect(result).toBeNull();
  });

  it("rejects POSIX absolute /tmp/evil.ts", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "/tmp/evil.ts");
    expect(result).toBeNull();
  });

  // Null bytes
  it("rejects path with null byte", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "file\x00.ts");
    expect(result).toBeNull();
  });

  it("rejects path with null byte in traversal", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "../etc/pass\x00wd");
    expect(result).toBeNull();
  });

  // Backslash traversal (Windows-style)
  it("rejects backslash traversal ..\\..\\etc\\passwd", () => {
    const result = checkPathWithinWorkspace(WORKSPACE, "..\\..\\etc\\passwd");
    expect(result).toBeNull();
  });

  // Edge cases
  it("rejects empty path", () => {
    expect(checkPathWithinWorkspace(WORKSPACE, "")).toBeNull();
  });

  it("rejects whitespace-only path", () => {
    expect(checkPathWithinWorkspace(WORKSPACE, "   ")).toBeNull();
  });

  it("rejects single-quote wrapped path", () => {
    expect(checkPathWithinWorkspace(WORKSPACE, "'../etc/passwd'")).toBeNull();
  });

  it("rejects backtick-wrapped path", () => {
    expect(checkPathWithinWorkspace(WORKSPACE, "`../etc/passwd`")).toBeNull();
  });

  // Multiple traversal segments
  it("rejects deep traversal src/../../etc/passwd", () => {
    expect(checkPathWithinWorkspace(WORKSPACE, "src/../../etc/passwd")).toBeNull();
  });

  it("rejects complex traversal a/b/../../c/../../../etc/passwd", () => {
    expect(checkPathWithinWorkspace(WORKSPACE, "a/b/../../c/../../../etc/passwd")).toBeNull();
  });
});

// ─── resolveWorkspacePath cross-platform ─────────────────────────────

describe("resolveWorkspacePath — cross-platform", () => {
  // On Windows, these are host-absolute and caught by containment ("Path escapes workspace root").
  // On Linux/macOS, Windows paths are caught by cross-platform check ("Path rejected").
  // Either error is a valid rejection.

  it("rejects Windows absolute path C:\\Windows\\System32", async () => {
    await expect(
      resolveWorkspacePath(WORKSPACE, "C:\\Windows\\System32")
    ).rejects.toThrow();
  });

  it("rejects Windows absolute path C:/Windows/System32", async () => {
    await expect(
      resolveWorkspacePath(WORKSPACE, "C:/Windows/System32")
    ).rejects.toThrow();
  });

  it("rejects drive-relative C:foo", async () => {
    await expect(
      resolveWorkspacePath(WORKSPACE, "C:foo")
    ).rejects.toThrow();
  });

  it("rejects UNC path \\\\server\\share", async () => {
    await expect(
      resolveWorkspacePath(WORKSPACE, "\\\\server\\share\\file")
    ).rejects.toThrow();
  });

  it("rejects device path \\\\.\\pipe\\test", async () => {
    await expect(
      resolveWorkspacePath(WORKSPACE, "\\\\.\\pipe\\test")
    ).rejects.toThrow();
  });

  it("rejects POSIX absolute /etc/passwd", async () => {
    await expect(
      resolveWorkspacePath(WORKSPACE, "/etc/passwd")
    ).rejects.toThrow();
  });

  it("rejects path with null byte", async () => {
    await expect(
      resolveWorkspacePath(WORKSPACE, "file\x00.ts")
    ).rejects.toThrow();
  });

  it("rejects traversal ../etc/passwd", async () => {
    await expect(
      resolveWorkspacePath(WORKSPACE, "../etc/passwd")
    ).rejects.toThrow();
  });
});
