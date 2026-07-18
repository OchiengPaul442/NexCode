import fs from "fs/promises";
import path from "path";

/**
 * Resolve a target path to an absolute path within the workspace root,
 * resolving symlinks to prevent path traversal via symlink attacks.
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

  let resolvedPath: string;
  try {
    resolvedPath = await fs.realpath(absolutePath);
  } catch {
    // Path doesn't exist yet - resolve parent directory to catch intermediate symlinks
    try {
      const parentResolved = await fs.realpath(path.dirname(absolutePath));
      resolvedPath = path.join(parentResolved, path.basename(absolutePath));
    } catch {
      // Parent doesn't exist yet - use normalized path (mkdir will create it)
      resolvedPath = absolutePath;
    }
  }

  const relative = path.relative(workspaceRoot, resolvedPath);
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
