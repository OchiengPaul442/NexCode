/**
 * NC-005: Runtime validation for inbound webview messages.
 *
 * The TypeScript type system only provides compile-time guarantees.
 * A compromised or buggy webview can send arbitrary objects.
 * This module validates the message type discriminator and basic shape
 * at runtime before the extension host acts on the message.
 */

import * as path from "path";

// --- Valid message type discriminators ---

const VALID_MESSAGE_TYPES = [
  "sendPrompt",
  "cancelPrompt",
  "applyEdit",
  "previewEdit",
  "rejectEdit",
  "clearConversation",
  "taskCompleted",
  "refreshProviderStatus",
  "requestModelSuggestions",
  "enhancePrompt",
  "listMcpServers",
  "listMcpTools",
  "invokeMcpToolQuick",
  "pickAttachments",
  "openInTab",
  "openSettings",
  "openShortcuts",
  "openDocs",
  "openFile",
  "updateSetting",
  "addAttachment",
  "removeAttachment",
  "steerTask",
  "cancelTask",
  "listTasks",
  "toolApprovalResponse",
] as const;

const VALID_MESSAGE_TYPE_SET = new Set<string>(VALID_MESSAGE_TYPES);

export type ValidMessageType = (typeof VALID_MESSAGE_TYPES)[number];

// --- Setting key allowlist ---

/**
 * Only these setting keys may be written via the webview updateSetting message.
 * The webview must never be able to send an arbitrary configuration key.
 */
const ALLOWED_SETTING_KEYS = new Set([
  "openAIBaseUrl",
  "ollamaBaseUrl",
  "defaultModel",
  "defaultProvider",
  "toolApproval",
  "showReasoning",
  "searchProvider",
  "searchBaseUrl",
  "allowWorkspacePrompts",
]);

// --- Size limits ---

const MAX_MESSAGE_SIZE = 1024 * 1024; // 1 MB
const MAX_STRING_LENGTH = 100_000;
const MAX_PROMPT_LENGTH = 500_000;
const MAX_FILE_PATH_LENGTH = 4096;
const MAX_SETTING_KEY_LENGTH = 256;
const MAX_SETTING_VALUE_SIZE = 1024 * 100; // 100 KB

// --- Validation result ---

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitizedType?: ValidMessageType;
}

/**
 * Validate that a raw inbound message from the webview has a recognized
 * type discriminator and basic shape. This is a pure function with no
 * side effects, making it easy to test.
 */
export function validateWebviewMessage(
  raw: unknown,
): ValidationResult {
  // Null/undefined check
  if (raw === null || raw === undefined) {
    return { valid: false, error: "Message is null or undefined" };
  }

  // Must be a plain object
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, error: "Message must be a plain object" };
  }

  // Rough size check (serialize and measure)
  let serialized: string;
  try {
    serialized = JSON.stringify(raw);
  } catch {
    return { valid: false, error: "Message is not JSON-serializable" };
  }
  if (serialized.length > MAX_MESSAGE_SIZE) {
    return {
      valid: false,
      error: `Message exceeds maximum size of ${MAX_MESSAGE_SIZE} bytes`,
    };
  }

  const obj = raw as Record<string, unknown>;

  // Type discriminator required
  if (typeof obj.type !== "string") {
    return { valid: false, error: "Message missing string 'type' field" };
  }

  // Type must be recognized
  if (!VALID_MESSAGE_TYPE_SET.has(obj.type)) {
    return {
      valid: false,
      error: `Unknown message type: ${obj.type}`,
    };
  }

  const msgType = obj.type as ValidMessageType;

  // Type-specific field validation
  const fieldResult = validateMessageFields(msgType, obj);
  if (!fieldResult.valid) {
    return fieldResult;
  }

  return { valid: true, sanitizedType: msgType };
}

/**
 * Validate the fields of a message based on its type.
 */
function validateMessageFields(
  msgType: ValidMessageType,
  obj: Record<string, unknown>,
): ValidationResult {
  switch (msgType) {
    case "sendPrompt":
      if (typeof obj.prompt !== "string" || !obj.prompt.trim()) {
        return { valid: false, error: "sendPrompt requires non-empty 'prompt' string" };
      }
      if (obj.prompt.length > MAX_PROMPT_LENGTH) {
        return { valid: false, error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}` };
      }
      break;

    case "enhancePrompt":
      if (typeof obj.prompt !== "string" || !obj.prompt.trim()) {
        return { valid: false, error: "enhancePrompt requires non-empty 'prompt' string" };
      }
      if (obj.prompt.length > MAX_PROMPT_LENGTH) {
        return { valid: false, error: `Prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}` };
      }
      break;

    case "applyEdit":
    case "previewEdit":
    case "rejectEdit":
      if (typeof obj.editId !== "string" || !obj.editId.trim()) {
        return { valid: false, error: `${msgType} requires non-empty 'editId' string` };
      }
      break;

    case "openFile":
      if (typeof obj.filePath !== "string" || !obj.filePath.trim()) {
        return { valid: false, error: "openFile requires non-empty 'filePath' string" };
      }
      if (obj.filePath.length > MAX_FILE_PATH_LENGTH) {
        return { valid: false, error: `filePath exceeds maximum length of ${MAX_FILE_PATH_LENGTH}` };
      }
      // Reject obviously dangerous paths
      if (obj.filePath.includes("\0")) {
        return { valid: false, error: "filePath contains null bytes" };
      }
      break;

    case "updateSetting":
      if (typeof obj.key !== "string" || !obj.key.trim()) {
        return { valid: false, error: "updateSetting requires non-empty 'key' string" };
      }
      if (obj.key.length > MAX_SETTING_KEY_LENGTH) {
        return { valid: false, error: `Setting key exceeds maximum length of ${MAX_SETTING_KEY_LENGTH}` };
      }
      if (!ALLOWED_SETTING_KEYS.has(obj.key)) {
        return {
          valid: false,
          error: `Setting key '${obj.key}' is not in the allowed list`,
        };
      }
      // Value size check
      if (obj.value !== undefined && obj.value !== null) {
        const valueStr = typeof obj.value === "string" ? obj.value : JSON.stringify(obj.value);
        if (valueStr.length > MAX_SETTING_VALUE_SIZE) {
          return { valid: false, error: `Setting value exceeds maximum size of ${MAX_SETTING_VALUE_SIZE}` };
        }
      }
      // NC-008: Reject 'bypass' for toolApproval — bypass/autopilot mode removed for security.
      if (obj.key === "toolApproval" && obj.value === "bypass") {
        return { valid: false, error: "Bypass/autopilot mode has been removed. Use 'auto' or 'ask'." };
      }
      break;

    case "steerTask":
      if (typeof obj.taskId !== "string" || !obj.taskId.trim()) {
        return { valid: false, error: "steerTask requires non-empty 'taskId' string" };
      }
      if (typeof obj.message !== "string" || !obj.message.trim()) {
        return { valid: false, error: "steerTask requires non-empty 'message' string" };
      }
      if (obj.message.length > MAX_STRING_LENGTH) {
        return { valid: false, error: `Steer message exceeds maximum length of ${MAX_STRING_LENGTH}` };
      }
      break;

    case "cancelTask":
      if (typeof obj.taskId !== "string" || !obj.taskId.trim()) {
        return { valid: false, error: "cancelTask requires non-empty 'taskId' string" };
      }
      break;

    case "toolApprovalResponse":
      if (typeof obj.requestId !== "string" || !obj.requestId.trim()) {
        return { valid: false, error: "toolApprovalResponse requires non-empty 'requestId' string" };
      }
      if (typeof obj.approved !== "boolean") {
        return { valid: false, error: "toolApprovalResponse requires boolean 'approved'" };
      }
      break;

    case "listMcpTools":
      if (typeof obj.server !== "string" || !obj.server.trim()) {
        return { valid: false, error: "listMcpTools requires non-empty 'server' string" };
      }
      break;

    case "invokeMcpToolQuick":
      if (typeof obj.server !== "string" || !obj.server.trim()) {
        return { valid: false, error: "invokeMcpToolQuick requires non-empty 'server' string" };
      }
      if (typeof obj.tool !== "string" || !obj.tool.trim()) {
        return { valid: false, error: "invokeMcpToolQuick requires non-empty 'tool' string" };
      }
      break;

    case "addAttachment": {
      // The webview sends { type: "addAttachment", attachment: { fileName, mimeType, ... } }
      const attachment = obj.attachment as Record<string, unknown> | undefined;
      if (!attachment || typeof attachment !== "object") {
        return { valid: false, error: "addAttachment requires 'attachment' object" };
      }
      if (typeof attachment.fileName !== "string" || !attachment.fileName.trim()) {
        return { valid: false, error: "addAttachment requires non-empty 'attachment.fileName' string" };
      }
      if (attachment.fileName.length > 256) {
        return { valid: false, error: "Attachment name exceeds maximum length of 256" };
      }
      break;
    }

    case "removeAttachment":
      if (typeof obj.attachmentId !== "string" || !obj.attachmentId.trim()) {
        return { valid: false, error: "removeAttachment requires non-empty 'attachmentId' string" };
      }
      break;

    // No-field-required messages: validated by type discriminator only
    case "cancelPrompt":
    case "clearConversation":
    case "taskCompleted":
    case "refreshProviderStatus":
    case "requestModelSuggestions":
    case "listMcpServers":
    case "pickAttachments":
    case "openInTab":
    case "openSettings":
    case "openShortcuts":
    case "openDocs":
    case "listTasks":
      break;
  }

  return { valid: true };
}

/**
 * Validate that a file path is within a workspace folder.
 * This is a pure synchronous check — no filesystem access.
 *
 * @param workspaceRoot The absolute path to the workspace root.
 * @param filePath The file path from the webview message.
 * @returns The normalized absolute path if contained, or null if it escapes.
 */
export function validateOpenFilePath(
  workspaceRoot: string,
  filePath: string,
): string | null {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return null;
  }

  // Normalize the path
  const absolutePath = path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.join(workspaceRoot, trimmed));

  // Check containment
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolutePath;
}

/**
 * Check whether a setting key is in the allowed list.
 */
export function isAllowedSettingKey(key: string): boolean {
  return ALLOWED_SETTING_KEYS.has(key);
}

/**
 * Get the set of allowed setting keys (for testing/documentation).
 */
export function getAllowedSettingKeys(): ReadonlySet<string> {
  return ALLOWED_SETTING_KEYS;
}
