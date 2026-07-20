import { createHash } from "crypto";
import { ProposedEdit } from "../types";
import { checkPathWithinWorkspace, resolveWorkspacePath } from "./pathContainment";

/**
 * Compute a deterministic SHA-256 content hash for a string.
 * Used as a fast pre-check and for audit logging.
 */
export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Result of edit precondition validation.
 */
export interface EditValidationResult {
  ok: boolean;
  error?: string;
  /** The resolved absolute path if validation passed. */
  absolutePath?: string;
  /** Content hash of the current file at apply time. */
  currentContentHash?: string;
  /** Content hash of the proposed oldText. */
  expectedContentHash?: string;
}

/**
 * Validate that an edit can be safely applied:
 * 1. Path must be contained within the workspace (symlink-aware).
 * 2. If the file exists, its current content must match edit.oldText exactly.
 *    This prevents a stale edit from silently overwriting a newer file.
 *
 * @param edit - The proposed edit to validate.
 * @param workspaceRoot - The canonical workspace root path.
 * @param currentContent - The current content of the target file, or null if
 *   the file does not exist (new file creation).
 * @returns EditValidationResult with ok=true if all preconditions pass.
 */
export function validateEditPreconditions(
  edit: ProposedEdit,
  workspaceRoot: string,
  currentContent: string | null,
): EditValidationResult {
  // 1. Validate path containment using the synchronous check.
  //    This prevents directory traversal via "../" in filePath.
  const absolutePath = checkPathWithinWorkspace(workspaceRoot, edit.filePath);
  if (absolutePath === null) {
    return {
      ok: false,
      error: `Edit path escapes workspace root: ${edit.filePath}`,
    };
  }

  // 2. Validate that the file has not changed since the edit was proposed.
  //    If currentContent is null, the file does not exist — that's fine for
  //    new file creation (oldText should be "").
  if (currentContent !== null) {
    if (currentContent !== edit.oldText) {
      const currentHash = computeContentHash(currentContent);
      const expectedHash = computeContentHash(edit.oldText);
      return {
        ok: false,
        error:
          `File has been modified since this edit was proposed. ` +
          `Edit expects content hash ${expectedHash.slice(0, 12)}… but current ` +
          `content hash is ${currentHash.slice(0, 12)}… ` +
          `(${edit.filePath}). Please request a new edit.`,
        currentContentHash: currentHash,
        expectedContentHash: expectedHash,
        absolutePath,
      };
    }
  } else {
    // File doesn't exist — oldText must be empty for new file creation
    if (edit.oldText !== "") {
      return {
        ok: false,
        error:
          `Edit targets a file that does not exist, but oldText is not empty. ` +
          `Cannot apply edit to non-existent file: ${edit.filePath}`,
      };
    }
  }

  return {
    ok: true,
    absolutePath,
    currentContentHash: currentContent !== null ? computeContentHash(currentContent) : undefined,
    expectedContentHash: computeContentHash(edit.oldText),
  };
}

/**
 * Async variant that reads the file to get current content and validates.
 * Use this when you need the resolved absolute path for subsequent operations.
 */
export async function validateEditPreconditionsAsync(
  edit: ProposedEdit,
  workspaceRoot: string,
  fileReader: (absolutePath: string) => Promise<string | null>,
): Promise<EditValidationResult> {
  // Resolve path with symlink awareness
  let absolutePath: string;
  try {
    absolutePath = await resolveWorkspacePath(workspaceRoot, edit.filePath);
  } catch (error) {
    return {
      ok: false,
      error: `Path validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Read current content
  let currentContent: string | null;
  try {
    currentContent = await fileReader(absolutePath);
  } catch {
    currentContent = null;
  }

  // Run synchronous validation with the resolved path
  const syncResult = validateEditPreconditions(edit, workspaceRoot, currentContent);
  if (!syncResult.ok) {
    return syncResult;
  }

  // Override absolutePath with the symlink-resolved version
  return { ...syncResult, absolutePath };
}
