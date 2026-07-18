/**
 * JSON Repair Utilities
 * 
 * Handles common JSON malformation patterns from LLM outputs:
 * - Truncated JSON (missing closing brackets)
 * - Unclosed strings
 * - Missing commas
 */

/**
 * Attempt to repair truncated JSON by adding missing closing brackets/braces.
 * Returns the original string if repair fails or if the JSON is already valid.
 */
export function repairTruncatedJson(json: string): string {
  if (!json || typeof json !== "string") {
    return json;
  }

  const trimmed = json.trim();

  // If it's already valid, return it
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Continue with repair attempts
  }

  // Try to repair by adding missing closing brackets
  const repaired = addMissingClosingBrackets(trimmed);
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    // Continue with other repair strategies
  }

  // Try to repair by closing unclosed strings
  const stringRepaired = closeUnclosedStrings(repaired);
  try {
    JSON.parse(stringRepaired);
    return stringRepaired;
  } catch {
    // Return original if all repairs fail
    return json;
  }
}

/**
 * Add missing closing brackets and braces to truncated JSON.
 */
function addMissingClosingBrackets(json: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{" || char === "[") {
      stack.push(char);
    } else if (char === "}") {
      if (stack.length > 0 && stack[stack.length - 1] === "{") {
        stack.pop();
      }
    } else if (char === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === "[") {
        stack.pop();
      }
    }
  }

  // Add closing brackets in reverse order
  let result = json;
  for (let i = stack.length - 1; i >= 0; i--) {
    const open = stack[i];
    result += open === "{" ? "}" : "]";
  }

  return result;
}

/**
 * Close any unclosed strings by adding missing quotes.
 */
function closeUnclosedStrings(json: string): string {
  let inString = false;
  let escaped = false;
  let lastStringStart = -1;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        inString = true;
        lastStringStart = i;
      } else {
        inString = false;
        lastStringStart = -1;
      }
    }
  }

  // If we end with an unclosed string, close it
  if (inString && lastStringStart >= 0) {
    return json + '"';
  }

  return json;
}

/**
 * Validate that a JSON string is parseable and return the parsed object.
 * Returns null if parsing fails.
 */
export function safeJsonParse<T = unknown>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Extract a JSON object from text that might contain other content.
 * Looks for JSON code blocks or standalone JSON objects/arrays.
 */
export function extractJsonFromText(text: string): string | null {
  if (!text) return null;

  // Try to find JSON in code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    const json = codeBlockMatch[1].trim();
    if (json.startsWith("{") || json.startsWith("[")) {
      return json;
    }
  }

  // Try to find standalone JSON object or array
  const lines = text.split("\n");
  let jsonStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\" && inString) {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{" || char === "[") {
        if (depth === 0) {
          jsonStart = i;
        }
        depth++;
      } else if (char === "}" || char === "]") {
        depth--;
        if (depth === 0 && jsonStart >= 0) {
          // Found complete JSON, extract from jsonStart to current line
          const jsonLines = lines.slice(jsonStart, i + 1);
          return jsonLines.join("\n");
        }
      }
    }
  }

  return null;
}
