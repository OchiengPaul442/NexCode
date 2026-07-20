import { extractFirstCodeBlock } from "../utils/text";

/**
 * Parse a prompt-enhancement response into an enhanced prompt and notes.
 * Tries JSON first, then falls back to plain-text parsing.
 */
export function parsePromptEnhancement(
  responseText: string,
  fallbackPrompt: string,
): { enhancedPrompt: string; notes: string[] } {
  const candidates = [responseText, extractFirstCodeBlock(responseText)]
    .filter(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    )
    .map((candidate) => candidate.trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        enhancedPrompt?: unknown;
        notes?: unknown;
      };

      if (typeof parsed.enhancedPrompt !== "string") {
        continue;
      }

      const enhancedPrompt = parsed.enhancedPrompt.trim();
      if (!enhancedPrompt) {
        continue;
      }

      const notes = Array.isArray(parsed.notes)
        ? parsed.notes
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0)
            .slice(0, 5)
        : [];

      return {
        enhancedPrompt,
        notes,
      };
    } catch {
      // Try next candidate.
    }
  }

  const plainText = parsePlainPromptEnhancement(responseText);
  if (plainText.enhancedPrompt) {
    return {
      enhancedPrompt: plainText.enhancedPrompt,
      notes:
        plainText.notes.length > 0
          ? plainText.notes
          : ["Model returned a plain text rewrite."],
    };
  }

  return {
    enhancedPrompt: fallbackPrompt,
    notes: ["Model returned empty output; original prompt was preserved."],
  };
}

/**
 * Fallback parser for plain-text prompt enhancement responses.
 */
function parsePlainPromptEnhancement(responseText: string): {
  enhancedPrompt: string;
  notes: string[];
} {
  const text = responseText.trim();
  if (!text) {
    return {
      enhancedPrompt: "",
      notes: [],
    };
  }

  const lines = text.split(/\r?\n/);
  const promptLines: string[] = [];
  const noteLines: string[] = [];
  let inNotes = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (inNotes) {
        noteLines.push("");
      } else {
        promptLines.push("");
      }
      continue;
    }

    const headingMatch = line.match(
      /^(enhanced|rewritten|revised|optimized)\s+prompt\s*:\s*(.*)$/i,
    );
    if (headingMatch) {
      const rest = headingMatch[2].trim();
      if (rest) {
        promptLines.push(rest);
      }
      continue;
    }

    if (/^notes\s*:\s*$/i.test(line)) {
      inNotes = true;
      continue;
    }

    const inlineNotesMatch = line.match(/^notes\s*:\s*(.*)$/i);
    if (inlineNotesMatch) {
      inNotes = true;
      const rest = inlineNotesMatch[1].trim();
      if (rest) {
        noteLines.push(rest);
      }
      continue;
    }

    if (inNotes) {
      noteLines.push(line.replace(/^[-*]\s*/, ""));
    } else {
      promptLines.push(rawLine);
    }
  }

  const enhancedPrompt = promptLines.join("\n").trim();
  const notes = noteLines
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 5);

  return {
    enhancedPrompt,
    notes,
  };
}
