import { ToolDefinition } from "./toolProtocol";

const stringSchema = (required: boolean = false): Record<string, unknown> => ({
  type: "object",
  properties: { value: { type: "string" } },
  required: required ? ["value"] : [],
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
    inputSchema: stringSchema(),
  },
  {
    name: "web-search",
    version: "1.0.0",
    title: "Search the web",
    description: "Search the web using Tavily for up-to-date information.",
    risk: "network-egress",
    timeoutMs: 15_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "terminal",
    version: "1.0.0",
    title: "Run terminal command",
    description: "Execute a shell command in the workspace.",
    risk: "terminal",
    timeoutMs: 120_000,
    inputSchema: stringSchema(true),
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
    name: "test",
    version: "1.0.0",
    title: "Run tests",
    description: "Execute the test runner with an optional filter.",
    risk: "terminal",
    timeoutMs: 300_000,
    inputSchema: stringSchema(),
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
