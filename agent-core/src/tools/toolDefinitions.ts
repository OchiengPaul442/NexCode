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
    description: [
      "Search for files and content within the workspace using ripgrep.",
      "Use for: finding files by name, locating code patterns, grep-style content search.",
      "Example queries: 'TODO', 'function handleEvent', 'src/**/*.ts'.",
      "Use before: reading files (to find the right path), editing (to locate code to change).",
      "Do NOT use when: you already know the exact file path (use read instead), or for web searches (use web-search).",
      "Returns file paths with line numbers and matching content.",
    ].join(" "),
    risk: "read-only",
    timeoutMs: 30_000,
    inputSchema: queryStringSchema(),
  },
  {
    name: "web-search",
    version: "1.0.0",
    title: "Search the web",
    description: [
      "Search the web using Tavily for up-to-date information.",
      "Use for: current documentation, library versions, recent error messages, external APIs.",
      "Example queries: 'react 19 breaking changes', 'node.js ECONNRESET fix'.",
      "Do NOT use when: the answer is in the workspace (use search/read instead), or for non-public information.",
      "Returns relevant web pages with summaries.",
    ].join(" "),
    risk: "network-egress",
    timeoutMs: 15_000,
    inputSchema: queryStringSchema(true),
  },
  {
    name: "terminal",
    version: "1.0.0",
    title: "Run terminal command",
    description: [
      "Execute a shell command in the workspace. Use for build, install, test, git, and other CLI operations.",
      "Use for: running package managers (npm, pip, cargo), git commands, build tools, compilers, linters.",
      "Example: 'npm install', 'git status', 'cargo build', 'python -m pytest'.",
      "Do NOT use when: you can use a dedicated tool instead (use read/write/patch for files, search for grep).",
      "Commands are sandboxed to the workspace. Dangerous commands require user approval.",
      "Tip: use '&&' to chain dependent commands. Use '; ' (semicolon-space) for independent commands.",
    ].join(" "),
    risk: "terminal",
    timeoutMs: 120_000,
    inputSchema: commandStringSchema(true),
  },
  {
    name: "git-status",
    version: "1.0.0",
    title: "Git status",
    description: [
      "Show the working tree status — modified, staged, untracked files.",
      "Use before: committing (to check what changed), staging (to see what needs staging).",
      "Do NOT use when: you just want to see a specific file's content (use read).",
    ].join(" "),
    risk: "read-only",
    timeoutMs: 5_000,
    inputSchema: stringSchema(),
  },
  {
    name: "git-diff",
    version: "1.0.0",
    title: "Git diff",
    description: [
      "Show unstaged changes in the working tree. Reveals exact code changes not yet staged.",
      "Use for: reviewing what changed before committing, understanding recent modifications.",
      "Use before: git-stage (to decide what to stage), git-commit (to verify content).",
      "Do NOT use when: you want staged changes (use 'git diff --staged' via terminal).",
    ].join(" "),
    risk: "read-only",
    timeoutMs: 5_000,
    inputSchema: stringSchema(),
  },
  {
    name: "git-branch",
    version: "1.0.0",
    title: "Git branch",
    description: [
      "List local branches. Shows current branch and available branches.",
      "Use before: git-create-branch (to avoid name collisions), switching context.",
    ].join(" "),
    risk: "read-only",
    timeoutMs: 5_000,
    inputSchema: stringSchema(),
  },
  {
    name: "git-stage",
    version: "1.0.0",
    title: "Git stage files",
    description: [
      "Stage files for commit using git add. Accepts space-separated paths.",
      "Use after: git-diff (to stage reviewed changes). Use before: git-commit.",
      "Example: 'src/index.ts src/utils.ts'. Use '.' to stage all changes.",
      "Do NOT use when: you want to commit directly (use git-commit which stages automatically).",
    ].join(" "),
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "git-unstage",
    version: "1.0.0",
    title: "Git unstage files",
    description: [
      "Unstage files using git reset. Reverses staging without losing changes.",
      "Use when: you accidentally staged files, or want to re-stage selectively.",
      "Example: 'src/temp.ts'. Use '.' to unstage all.",
    ].join(" "),
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "git-commit",
    version: "1.0.0",
    title: "Git commit",
    description: [
      "Commit staged changes with a descriptive message. Use conventional commit format.",
      "Format: 'type(scope): description' — e.g. 'fix(auth): handle expired tokens'.",
      "Use after: git-stage (to stage changes first), or git-diff (to review first).",
      "Do NOT use when: nothing is staged (check git-status first).",
      "Commit prefixes: feat:, fix:, docs:, perf:, refactor:, test:, chore:, security:.",
    ].join(" "),
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "git-create-branch",
    version: "1.0.0",
    title: "Git create branch",
    description: [
      "Create and switch to a new branch. Use descriptive names like 'feat/user-auth' or 'fix/memory-leak'.",
      "Use before: starting work on a new feature or bugfix.",
      "Do NOT use when: you want to stay on the current branch (use terminal for git checkout).",
    ].join(" "),
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "git-log",
    version: "1.0.0",
    title: "Git log",
    description: [
      "Show recent commit log with hashes, authors, and messages.",
      "Use for: understanding recent changes, finding specific commits, reviewing history.",
      "Pass a number to limit results (e.g. '10' for last 10 commits).",
    ].join(" "),
    risk: "read-only",
    timeoutMs: 5_000,
    inputSchema: stringSchema(),
  },
  {
    name: "git-show",
    version: "1.0.0",
    title: "Git show",
    description: [
      "Show details of a commit or ref — diff, author, date, message.",
      "Use for: inspecting a specific commit's changes, viewing a tag, checking a branch point.",
      "Accepts: commit hash, branch name, tag, or HEAD~N syntax.",
    ].join(" "),
    risk: "read-only",
    timeoutMs: 10_000,
    inputSchema: stringSchema(true),
  },
  {
    name: "test",
    version: "1.0.0",
    title: "Run tests",
    description: [
      "Execute the test runner with an optional filter. Use 'filter' to run specific tests.",
      "Use for: running unit tests, integration tests, validation suites.",
      "Use after: making code changes (to verify correctness), before committing.",
      "Do NOT use when: you want to run a build (use terminal with npm run build).",
      "Available runners: npm, vitest, jest, pytest, go, maven, gradle, cargo.",
      "Example: runner='vitest', filter='src/auth.test.ts' to run auth tests only.",
    ].join(" "),
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
    description: [
      "Read the contents of a file. Returns the full file text.",
      "Use for: understanding code, reviewing content before editing, inspecting configs.",
      "Use before: patch or write (to see current content first).",
      "Do NOT use when: you want to search for content across files (use search).",
      "Tip: Use with search to find files first, then read the relevant ones.",
    ].join(" "),
    risk: "read-only",
    timeoutMs: 10_000,
    inputSchema: pathSchema(true),
  },
  {
    name: "write",
    version: "1.0.0",
    title: "Write file",
    description: [
      "Create or overwrite a file with new content. Use for new files or complete rewrites.",
      "Use for: creating new files, replacing entire file contents.",
      "Use after: reading the file first (to understand what exists). Use before: verifying with read.",
      "Do NOT use when: you only want to change part of a file (use patch instead — it's safer and produces smaller diffs).",
      "Do NOT use when: you want to add to the end of a file (use append instead).",
      "WARNING: This overwrites the entire file. Always read first to avoid data loss.",
    ].join(" "),
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: writeSchema,
  },
  {
    name: "append",
    version: "1.0.0",
    title: "Append to file",
    description: [
      "Append content to the end of an existing file without overwriting.",
      "Use for: adding new functions, imports, test cases, or entries to existing files.",
      "Use after: reading the file (to know where to append and avoid duplicates).",
      "Do NOT use when: you need to insert content in the middle (use patch instead).",
      "Do NOT use when: the file doesn't exist yet (use write instead).",
    ].join(" "),
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: writeSchema,
  },
  {
    name: "move",
    version: "1.0.0",
    title: "Move/rename path",
    description: [
      "Move or rename a file or directory. Both source and destination must be provided.",
      "Use for: renaming files, moving files between directories, reorganizing project structure.",
      "Do NOT use when: you want to copy a file (use read + write instead).",
      "Tip: After moving, update any imports that reference the old path.",
    ].join(" "),
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: moveSchema,
  },
  {
    name: "patch",
    version: "1.0.0",
    title: "Patch file",
    description: [
      "Apply a targeted edit to a file by replacing specific text. Only the FIRST occurrence is replaced.",
      "Use for: making small, precise edits — changing a function, fixing a bug, updating a value.",
      "Use after: read (to find the exact oldText to replace). Use before: read (to verify the change).",
      "Do NOT use when: you're replacing the entire file (use write instead).",
      "Do NOT use when: oldText might match multiple locations (add more surrounding context).",
      "Tip: Include 2-3 lines of context around the change for uniqueness. The oldText must match EXACTLY.",
    ].join(" "),
    risk: "reversible-write",
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        oldText: { type: "string", minLength: 1 },
        newText: { type: "string" },
      },
      required: ["path", "oldText"],
    },
  },
  {
    name: "delete",
    version: "1.0.0",
    title: "Delete path",
    description: [
      "Delete a file or directory permanently. This cannot be undone.",
      "Use for: removing files that are no longer needed, cleaning up generated artifacts.",
      "Do NOT use when: you want to clear a directory's contents (use delete-contents instead).",
      "Always verify the path is correct — check git-status or search first.",
      "WARNING: This is destructive. Prefer git operations for tracked files.",
    ].join(" "),
    risk: "destructive",
    timeoutMs: 10_000,
    inputSchema: pathSchema(true),
  },
  {
    name: "delete-contents",
    version: "1.0.0",
    title: "Clear directory",
    description: [
      "Remove ALL contents of a directory. The directory itself remains.",
      "Use for: clearing build output directories, resetting temp folders.",
      "Do NOT use when: you want to delete the directory itself (use delete instead).",
      "WARNING: Destructive. Verify the directory path before use.",
    ].join(" "),
    risk: "destructive",
    timeoutMs: 10_000,
    inputSchema: pathSchema(true),
  },
  {
    name: "mcp",
    version: "1.0.0",
    title: "MCP server call",
    description: [
      "Call a tool on a registered MCP (Model Context Protocol) server.",
      "Use for: accessing external capabilities like databases, APIs, or specialized services.",
      "Format: server name, tool name, and optional input separated by '|||'.",
      "Do NOT use when: a built-in tool can accomplish the task (prefer built-in tools).",
    ].join(" "),
    risk: "network-egress",
    timeoutMs: 30_000,
    inputSchema: mcpSchema,
  },
  {
    name: "batch_edit",
    version: "1.0.0",
    title: "Batch Edit Files",
    description: [
      "Apply multiple edits to multiple files in one atomic operation. All-or-nothing: if any edit fails, all are rolled back.",
      "Use for: multi-file refactors, large-scale changes, atomic cross-file updates.",
      "Use after: reading all affected files (to get current content for updates).",
      "Do NOT use when: you're editing a single file (use patch or write instead — simpler and faster).",
      "Each edit specifies: filePath, content, and operation (create/update/delete).",
      "Tip: Use 'update' for existing files, 'create' for new files, 'delete' for removal.",
    ].join(" "),
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
              filePath: { type: "string", minLength: 1 },
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
    description: [
      "Get file and directory counts, extensions breakdown, and skipped directories for the workspace.",
      "Use for: understanding project structure, identifying dominant file types, checking workspace health.",
      "Do NOT use when: you need specific file contents (use read) or search results (use search).",
    ].join(" "),
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
