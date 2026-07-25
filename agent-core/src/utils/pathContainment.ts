import fs from "fs/promises";
import path from "path";

/**
 * Check if a path is absolute using both Windows and POSIX rules.
 * On POSIX, `C:\\Windows\\...` is NOT detected as absolute by `path.isAbsolute`,
 * which allows cross-platform path traversal bypass. This function catches
 * both POSIX and Windows absolute paths, plus UNC, device, and drive-relative forms.
 */
export function isPathAbsoluteCrossPlatform(p: string): boolean {
  // Host-platform check
  if (path.isAbsolute(p)) {
    return true;
  }

  // Windows drive letter: C:\, D:\, etc.
  if (/^[A-Za-z]:[\\/]/.test(p)) {
    return true;
  }

  // Drive-relative (no backslash after colon): C:foo
  if (/^[A-Za-z]:[^\\/]/.test(p)) {
    return true;
  }

  // UNC paths: \\server\share
  if (/^\\\\[^\\]/.test(p)) {
    return true;
  }

  // Device/extended-length paths: \\.\, \\?\
  if (/^\\\\[.?]\\/.test(p)) {
    return true;
  }

  return false;
}

/**
 * Validate that a path does not contain null bytes, which are invalid
 * on all platforms and can be used to truncate paths in C-level fs calls.
 */
export function containsNullBytes(p: string): boolean {
  return p.includes("\x00");
}

/**
 * Reject cross-platform dangerous path forms:
 * - Null bytes
 * - Windows absolute paths on any platform
 * - UNC, device, extended-length paths
 *
 * Returns true if the path is safe to proceed with, false if it should be rejected.
 */
export function isPathSafeCrossPlatform(p: string): { safe: boolean; reason?: string } {
  if (containsNullBytes(p)) {
    return { safe: false, reason: "Path contains null bytes" };
  }
  if (isPathAbsoluteCrossPlatform(p)) {
    return { safe: false, reason: "Path is absolute (cross-platform check detected Windows or POSIX absolute path)" };
  }
  return { safe: true };
}

/**
 * Resolve a target path to an absolute path within the workspace root,
 * resolving symlinks to prevent path traversal via symlink attacks.
 *
 * Walks upward to the nearest existing ancestor, resolves that ancestor
 * with realpath, then reconstructs and re-checks the remaining path segments.
 *
 * @throws {Error} if the resolved path escapes the workspace root.
 */
export async function resolveWorkspacePath(
  workspaceRoot: string,
  targetPath: string,
): Promise<string> {
  // Cross-platform safety check: reject paths that look absolute on the OTHER
  // platform but not on the host. Host-platform absolute paths are handled by
  // the containment check below (path.relative + ".." prefix).
  if (!path.isAbsolute(targetPath)) {
    const crossCheck = isPathSafeCrossPlatform(targetPath);
    if (!crossCheck.safe) {
      throw new Error(`Path rejected: ${crossCheck.reason} — ${targetPath}`);
    }
  } else {
    // Host says it's absolute — still reject null bytes
    if (containsNullBytes(targetPath)) {
      throw new Error(`Path rejected: Path contains null bytes — ${targetPath}`);
    }
  }

  const absolutePath = path.isAbsolute(targetPath)
    ? path.normalize(targetPath)
    : path.normalize(path.join(workspaceRoot, targetPath));

  // Canonicalize the workspace root once
  let canonicalRoot: string;
  try {
    canonicalRoot = await fs.realpath(workspaceRoot);
  } catch {
    // Workspace root doesn't exist yet — use normalized path
    canonicalRoot = path.normalize(workspaceRoot);
  }

  // Check if the path exists directly
  let resolvedPath: string;
  try {
    resolvedPath = await fs.realpath(absolutePath);
  } catch {
    // Path doesn't exist — walk upward to the nearest existing ancestor
    const segments: string[] = [];
    let current = absolutePath;

    // Collect path segments from target up to filesystem root
    while (current !== path.dirname(current)) {
      segments.unshift(path.basename(current));
      current = path.dirname(current);
    }
    // current is now the filesystem root (e.g., "/" or "C:\")

    // Find the nearest existing ancestor by trying progressively shorter paths
    let existingAncestor = current;
    let ancestorSegments: string[] = [];
    for (let i = segments.length; i > 0; i--) {
      const candidate = path.join(current, ...segments.slice(0, i));
      try {
        await fs.realpath(candidate);
        existingAncestor = candidate;
        ancestorSegments = segments.slice(i);
        break;
      } catch {
        // This ancestor doesn't exist, keep walking up
        continue;
      }
    }

    // If we found an existing ancestor, resolve it and reconstruct
    if (ancestorSegments.length < segments.length) {
      try {
        const ancestorResolved = await fs.realpath(existingAncestor);
        resolvedPath = path.join(ancestorResolved, ...ancestorSegments);
      } catch {
        // Ancestor resolution failed — use the absolute path (will be checked below)
        resolvedPath = absolutePath;
      }
    } else {
      // No existing ancestor found — use the absolute path
      resolvedPath = absolutePath;
    }
  }

  // Normalize both paths to consistent form before comparison (handles Windows
  // drive-letter casing, mixed separators, and trailing separators).
  const normalizedRoot = path.resolve(canonicalRoot);
  const normalizedResolved = path.resolve(resolvedPath);
  const relative = path.relative(normalizedRoot, normalizedResolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${targetPath}`);
  }

  return resolvedPath;
}

/**
 * Check whether a target path resolves to a location within the workspace root,
 * WITHOUT resolving symlinks (used for read-only context where the path is not
 * passed to fs operations).
 *
 * Returns the absolute path if contained, or null if it escapes.
 */
export function checkPathWithinWorkspace(
  workspaceRoot: string,
  targetPath: string,
): string | null {
  const trimmed = targetPath.trim().replace(/^['"`]|['"`]$/g, "");
  if (!trimmed) {
    return null;
  }

  // Cross-platform safety check: reject paths that look absolute on the OTHER
  // platform but not on the host. Host-platform absolute paths are handled by
  // the containment check below (path.relative + ".." prefix).
  if (!path.isAbsolute(trimmed)) {
    const crossCheck = isPathSafeCrossPlatform(trimmed);
    if (!crossCheck.safe) {
      return null;
    }
  } else {
    // Host says it's absolute — still reject null bytes
    if (containsNullBytes(trimmed)) {
      return null;
    }
  }

  const absolutePath = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.join(workspaceRoot, trimmed));

  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolutePath;
}
