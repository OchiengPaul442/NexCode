export type ToolRisk =
  | "read-only"
  | "low-risk-write"
  | "reversible-write"
  | "destructive"
  | "network-egress"
  | "terminal";

export interface ToolDefinition {
  name: string;
  version: string;
  title: string;
  description: string;
  risk: ToolRisk;
  timeoutMs: number;
  inputSchema: Record<string, unknown>;
}

export interface ToolResultError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolResultMetadata {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  affectedFiles?: string[];
}

export interface StructuredToolResult {
  ok: boolean;
  data?: unknown;
  summary: string;
  error?: ToolResultError;
  metadata: ToolResultMetadata;
}

export interface InputValidationError {
  field: string;
  message: string;
}

export function validateInput(
  input: Record<string, unknown>,
  schema: Record<string, unknown>,
): InputValidationError[] {
  const errors: InputValidationError[] = [];
  const required = schema.required as string[] | undefined;
  const properties = (schema.properties ?? {}) as Record<
    string,
    { type?: string; pattern?: string; minLength?: number; maxLength?: number }
  >;

  if (required) {
    for (const field of required) {
      if (input[field] === undefined || input[field] === null || input[field] === "") {
        errors.push({ field, message: `${field} is required` });
      }
    }
  }

  for (const [field, rules] of Object.entries(properties)) {
    const value = input[field];
    if (value === undefined || value === null) continue;

    if (rules.type === "string" && typeof value !== "string") {
      errors.push({ field, message: `${field} must be a string` });
      continue;
    }

    if (rules.minLength !== undefined && typeof value === "string" && value.length < rules.minLength) {
      errors.push({ field, message: `${field} must be at least ${rules.minLength} characters` });
    }

    if (rules.maxLength !== undefined && typeof value === "string" && value.length > rules.maxLength) {
      errors.push({ field, message: `${field} must be at most ${rules.maxLength} characters` });
    }

    if (rules.pattern !== undefined && typeof value === "string") {
      const re = new RegExp(rules.pattern);
      if (!re.test(value)) {
        errors.push({ field, message: `${field} does not match pattern ${rules.pattern}` });
      }
    }
  }

  return errors;
}

export function createStructuredResult(
  ok: boolean,
  summary: string,
  startTime: number,
  data?: unknown,
  error?: ToolResultError,
  affectedFiles?: string[],
): StructuredToolResult {
  const completedAt = new Date();
  return {
    ok,
    data,
    summary,
    error,
    metadata: {
      startedAt: new Date(startTime).toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startTime,
      affectedFiles,
    },
  };
}
