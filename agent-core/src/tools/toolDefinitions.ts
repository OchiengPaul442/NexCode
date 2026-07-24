import { type ToolDefinition } from "./toolProtocol";

const stringSchema = (required: boolean = false): Record<string, unknown> => ({
  type: "object",
  properties: { value: { type: "string" } },
  required: required ? ["value"] : [],
});

const queryStringSchema = (required: boolean = false): Record<string, unknown> => ({
  type: "object",
  properties: { query: { type: "string", description: "The search query" } },
  required: required ? ["query"] : [],
});

const commandStringSchema = (required: boolean = false): Record<string, unknown> => ({
  type: "object",
  properties: { command: { type: "string", description: "The command to execute" } },
  required: required ? ["command"] : [],
});

const pathSchema = (required: boolean = false): Record<string, unknown> => ({
  type: "object",
  properties: {
    path: { type: "string", minLength: 1 },
  },
  required: required ? ["path"] : [],
});

const writeSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    path: { type: "string", minLength: 1 },
    content: { type: "string" },
  },
  required: ["path", "content"],
};

const moveSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    source: { type: "string", minLength: 1 },
    destination: { type: "string", minLength: 1 },
  },
  required: ["source", "destination"],
};

const mcpSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    server: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
    tool: { type: "string", pattern: "^[a-zA-Z0-9._-]+$" },
    input: { type: "string" },
  },
  required: ["server", "tool"],
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search",
    version: "1.0.0",
    title: "Search workspace files",
    description: "Search for files and content within the workspace using ripgrep.",
    risk: "read-only",
    timeoutMs: 30_000,
    inputSchema: queryStringSchema(),
  },
  {
    name: "web-search",
    version: "1.0.0",
    title: "Search the web",
    description: "Search the web using Tavily for up-to-date information.",
    risk: "network-egress",
    timeoutMs: 15_000,
    inputSchema: queryStringSchema(true),
  },
  {
    name: "terminal",
    version: "1.0.0",
    title: "Run terminal command",
    description: "Execute a shell command in the workspace.",
    risk: "terminal",
    timeoutMs: 120_000,
    inputSchema: commandStringSchema(true),
  },
  {
    name: "git-status",
    version: "1.0.0",
    title: "Git status",
    description: "Show the working tree status.",
    risk: "read-only",
    timeoutMs: 5_000,
    inputSchema: stringSchema(),
  },
  {
    name: "git-diff",
    version: "1.0.0",
    title: "Git diff",
    description: "Show unstaged changes in the working tree.",
    risk: "read-only",
    timeoutMs: 5_000,
    inputSchema: stringSchema(),
  },
  {
    name: "git-branch",
    version: "1.0.0",
    title: "Git branch",
    description: "List local branches.",
    risk: "read-only",
    timeoutMs: 5_000,
    inputSchema: stringSchema(),
  },
  {
    name: "git-stage",
    version: "1.0.0",
    title: "Git stage files",
    description: "Stage files for commit using git add.",
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "git-unstage",
    version: "1.0.0",
    title: "Git unstage files",
    description: "Unstage files using git reset.",
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "git-commit",
    version: "1.0.0",
    title: "Git commit",
    description: "Commit staged changes with a message.",
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "git-create-branch",
    version: "1.0.0",
    title: "Git create branch",
    description: "Create and switch to a new branch.",
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "git-log",
    version: "1.0.0",
    title: "Git log",
    description: "Show recent commit log.",
    risk: "read-only",
    timeoutMs: 5_000,
    inputSchema: stringSchema(),
  },
  {
    name: "git-show",
    version: "1.0.0",
    title: "Git show",
    description: "Show details of a commit or ref.",
    risk: "read-only",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "test",
    version: "1.0.0",
    title: "Run tests",
    description: "Execute the test runner with an optional filter.",
    risk: "terminal",
    timeoutMs: 300_000,
    inputSchema: {
      type: "object",
      properties: {
        runner: {
          type: "string",
          enum: ["npm", "vitest", "jest", "pytest", "go", "maven", "gradle", "cargo"],
          description: "The test runner to use",
        },
        filter: {
          type: "string",
          description: "Optional test name or pattern to filter tests",
        },
      },
      required: ["runner"],
    },
  },
  {
    name: "read",
    version: "1.0.0",
    title: "Read file",
    description: "Read the contents of a file.",
    risk: "read-only",
    timeoutMs: 10_000,
    inputSchema: pathSchema(true),
  },
  {
    name: "write",
    version: "1.0.0",
    title: "Write file",
    description: "Create or overwrite a file with new content.",
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: writeSchema,
  },
  {
    name: "append",
    version: "1.0.0",
    title: "Append to file",
    description: "Append content to an existing file.",
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: writeSchema,
  },
  {
    name: "move",
    version: "1.0.0",
    title: "Move/rename path",
    description: "Move or rename a file or directory.",
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: moveSchema,
  },
  {
    name: "patch",
    version: "1.0.0",
    title: "Patch file",
    description: "Apply a targeted edit to a file by replacing specific text. Only the first occurrence is replaced.",
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText"],
    },
  },
  {
    name: "delete",
    version: "1.0.0",
    title: "Delete path",
    description: "Delete a file or directory permanently.",
    risk: "destructive",
    timeoutMs: 10_000,
    inputSchema: pathSchema(true),
  },
  {
    name: "delete-contents",
    version: "1.0.0",
    title: "Clear directory",
    description: "Remove all contents of a directory.",
    risk: "destructive",
    timeoutMs: 10_000,
    inputSchema: pathSchema(true),
  },
  {
    name: "mcp",
    version: "1.0.0",
    title: "MCP server call",
    description: "Call a tool on an MCP server.",
    risk: "network-egress",
    timeoutMs: 30_000,
    inputSchema: mcpSchema,
  },
  {
    name: "batch_edit",
    version: "1.0.0",
    title: "Batch Edit Files",
    description: "Apply multiple edits to multiple files in one operation. Each edit specifies a file path and content.",
    risk: "reversible-write",
    timeoutMs: 30_000,
    inputSchema: {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              content: { type: "string" },
              operation: { type: "string", enum: ["create", "update", "delete"] },
            },
            required: ["filePath", "content", "operation"],
          },
        },
      },
      required: ["edits"],
    },
  },
  {
    name: "workspace-stats",
    version: "1.0.0",
    title: "Workspace statistics",
    description: "Get file and directory counts, extensions breakdown, and skipped directories for the workspace.",
    risk: "read-only",
    timeoutMs: 30_000,
    inputSchema: stringSchema(),
  },
];

const _byName = new Map<string, ToolDefinition>();
for (const def of TOOL_DEFINITIONS) {
  _byName.set(def.name, def);
}

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return _byName.get(name);
}

export function getAllToolDefinitions(): ToolDefinition[] {
  return [...TOOL_DEFINITIONS];
}

export function getToolDefinitionsForMode(mode: string): ToolDefinition[] {
  const modeToolMap: Record<string, string[]> = {
    coder: [
      "read", "write", "append", "patch", "move", "delete", "delete-contents",
      "terminal", "test", "search", "web-search",
      "git-status", "git-diff", "git-branch", "git-stage", "git-unstage", "git-commit", "git-create-branch", "git-log", "git-show",
      "batch_edit", "mcp", "workspace-stats",
    ],
    planner: [
      "read", "search", "web-search",
      "git-status", "git-diff", "git-log",
      "workspace-stats",
    ],
    reviewer: [
      "read", "search",
      "git-status", "git-diff", "git-log", "git-show",
      "workspace-stats",
    ],
    qa: [
      "read", "write", "append", "patch",
      "terminal", "test", "search",
      "git-status", "git-diff",
      "workspace-stats",
    ],
    security: [
      "read", "search",
      "git-status", "git-diff", "git-log", "git-show",
      "workspace-stats",
    ],
  };

  const toolNames = modeToolMap[mode] ?? modeToolMap["coder"];
  return TOOL_DEFINITIONS.filter((def) => toolNames.includes(def.name));
}
