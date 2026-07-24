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
  const bracketRepaired = addMissingClosingBrackets(trimmed);
  try {
    JSON.parse(bracketRepaired);
    return bracketRepaired;
  } catch {
    // Continue with other repair strategies
  }

  // Try to repair by adding missing commas
  const commaRepaired = addMissingCommas(bracketRepaired);
  try {
    JSON.parse(commaRepaired);
    return commaRepaired;
  } catch {
    // Continue with other repair strategies
  }

  // Try to repair by closing unclosed strings
  const stringRepaired = closeUnclosedStrings(commaRepaired);
  try {
    JSON.parse(stringRepaired);
    return stringRepaired;
  } catch {
    // Return original if all repairs fail
    return json;
  }
}

/**
 * Add missing commas between array elements and object properties.
 */
function addMissingCommas(json: string): string {
  let inString = false;
  let escaped = false;
  let result = "";

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    const prevChar = i > 0 ? json[i - 1] : "";

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      result += char;
      continue;
    }

    // Check for missing comma after } or ] before " or { or [
    if ((prevChar === "}" || prevChar === "]") && (char === '"' || char === "{" || char === "[")) {
      result += ",";
    }
    // Add missing commas between string values: " " or "] [ or } {
    else if (prevChar === '"' && (char === '"' || char === "[" || char === "{")) {
      result += ",";
    }

    result += char;
  }

  return result;
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
 * Extract a tool call from malformed JSON using regex.
 * Handles truncated JSON like `{"name":"read","arguments":{"path":"package.json"`
 * where closing braces are missing.
 *
 * Returns `{ name, arguments }` if found, null otherwise.
 */
export function extractToolCallFromMalformedJson(
  text: string,
): { name: string; arguments: Record<string, unknown> } | null {
  if (!text || typeof text !== "string") return null;

  // Extract the tool name
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
  if (!nameMatch) return null;
  const toolName = nameMatch[1];

  // Extract the arguments object — match from the first { after "arguments": to end
  const argsMatch = text.match(/"arguments"\s*:\s*(\{[\s\S]*$)/);
  if (!argsMatch) return null;

  let argsStr = argsMatch[1];

  // Try to repair the truncated arguments
  const repaired = repairTruncatedJson(argsStr);
  try {
    const parsed = JSON.parse(repaired);
    if (typeof parsed === "object" && parsed !== null) {
      return { name: toolName, arguments: parsed };
    }
  } catch {
    // Repair didn't produce valid JSON, try deeper extraction
  }

  // Extract individual key-value pairs from the arguments body
  const argsBody = argsStr.replace(/^\{/, "");
  const args: Record<string, unknown> = {};
  // Match "key": "value" patterns (handles escaped quotes and nested strings)
  const kvPattern = /"([^"]+)"\s*:\s*"([^"]*?)"/g;
  let kvMatch;
  while ((kvMatch = kvPattern.exec(argsBody)) !== null) {
    args[kvMatch[1]] = kvMatch[2];
  }

  // Also match "key": number/boolean patterns
  const kvNumPattern = /"([^"]+)"\s*:\s*(\d+(?:\.\d+)?|true|false)/g;
  while ((kvMatch = kvNumPattern.exec(argsBody)) !== null) {
    const val = kvMatch[2];
    args[kvMatch[1]] = val === "true" ? true : val === "false" ? false : Number(val);
  }

  return Object.keys(args).length > 0
    ? { name: toolName, arguments: args }
    : null;
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
