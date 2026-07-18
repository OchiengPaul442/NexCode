import * as vscode from "vscode";

export class WorkspaceTrustService {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public isWorkspaceTrusted(): boolean {
    return vscode.workspace.isTrusted;
  }

  public canRunTool(toolName: string): boolean {
    if (this.isWorkspaceTrusted()) {
      return true;
    }

    const restrictedTools = [
      "terminal",
      "test",
      "write",
      "append",
      "delete",
      "delete-contents",
      "move",
      "batch_edit",
      "mcp",
      "web-search",
      "search-web",
      "online-search",
      "search",
      "git-stage",
      "git-unstage",
      "git-commit",
      "git-create-branch",
    ];

    return !restrictedTools.includes(toolName);
  }

  public getToolRestrictionReason(toolName: string): string | null {
    if (this.isWorkspaceTrusted()) {
      return null;
    }

    const restrictions: Record<string, string> = {
      terminal: "Terminal commands are restricted in untrusted workspaces.",
      test: "Test execution is restricted in untrusted workspaces.",
      write: "File writes are restricted in untrusted workspaces.",
      append: "File appends are restricted in untrusted workspaces.",
      delete: "File deletion is restricted in untrusted workspaces.",
      "delete-contents": "Directory clearing is restricted in untrusted workspaces.",
      move: "File moves are restricted in untrusted workspaces.",
      batch_edit: "Batch edits are restricted in untrusted workspaces.",
      mcp: "MCP server calls are restricted in untrusted workspaces.",
      "web-search": "Web search is restricted in untrusted workspaces.",
      "search-web": "Web search is restricted in untrusted workspaces.",
      "online-search": "Online search is restricted in untrusted workspaces.",
      search: "Search (executes rg/grep) is restricted in untrusted workspaces.",
      "git-stage": "Git staging is restricted in untrusted workspaces.",
      "git-unstage": "Git unstaging is restricted in untrusted workspaces.",
      "git-commit": "Git commits are restricted in untrusted workspaces.",
      "git-create-branch": "Git branch creation is restricted in untrusted workspaces.",
    };

    return restrictions[toolName] ?? null;
  }
}
