import fs from "fs/promises";
import path from "path";

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

  const relative = path.relative(canonicalRoot, resolvedPath);
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

  const absolutePath = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.join(workspaceRoot, trimmed));

  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolutePath;
}
