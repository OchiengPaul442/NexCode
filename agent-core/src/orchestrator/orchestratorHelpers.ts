import type { AgentResult, AgentMode } from "../types";

/**
 * Check if an error is an AbortError.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError";
  }

  return false;
}

/**
 * Throw an AbortError if the signal has been aborted.
 */
export function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const reason = signal.reason ?? "Request aborted.";
    const err = new Error(typeof reason === "string" ? reason : String(reason));
    err.name = "AbortError";
    throw err;
  }
}

/**
 * Clean up temporary subagent files.
 */
export async function cleanupSubagentFiles(workspaceRoot: string): Promise<void> {
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const agentsDir = path.join(workspaceRoot, ".agents");
    const exists = await fs.access(agentsDir).then(() => true).catch(() => false);
    if (exists) {
      await fs.rm(agentsDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors - not critical
  }
}

/**
 * Run an agent call with safe error handling.
 */
export async function runAgentSafely(
  mode: Exclude<AgentMode, "auto">,
  run: () => Promise<AgentResult>,
  diagnostics: string[],
): Promise<AgentResult> {
  try {
    return await run();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const errorStr = String(error);
    const isTimeout = errorStr.toLowerCase().includes("timeout");
    diagnostics.push(`${capitalize(mode)} agent error: ${errorStr}`);
    const reason = isTimeout
      ? `The request timed out. The model is taking too long to respond. Try a simpler task, break it into smaller steps, or switch to a faster model.`
      : errorStr;
    return {
      agent: mode,
      content: `> **${capitalize(mode)} agent could not complete the task.**\n>\n> ${reason}`,
    };
  }
}

/**
 * Test whether an edit instruction is append/add/insert style.
 */
export function isAppendStyleEdit(instruction: string): boolean {
  return /\b(append|add|insert)\b/i.test(instruction);
}

/**
 * Extract the text to append from an append-style instruction.
 */
export function extractRequestedAppendText(instruction: string): string | null {
  const trimmed = instruction.trim();

  const patterns = [
    /(?:append|add|insert)(?:\s+a)?(?:\s+new)?\s+line\s+with\s+(?:the\s+)?text\s+([`'"]?)([\s\S]+?)\1\.?$/i,
    /(?:append|add|insert)(?:\s+a)?(?:\s+new)?\s+line\s+(?:containing|that says|saying)\s+([`'"]?)([\s\S]+?)\1\.?$/i,
    /(?:append|add|insert)(?:\s+a)?(?:\s+new)?\s+line\s+(?:with|of)\s+([`'"]?)([\s\S]+?)\1\.?$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const text = match[2].trim();
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
