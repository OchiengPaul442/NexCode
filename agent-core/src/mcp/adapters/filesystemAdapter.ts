import fs from "fs/promises";
import path from "path";
import { McpAdapter, McpToolCall, McpToolResult } from "../types";
import { checkPathWithinWorkspace } from "../../utils/pathContainment";

export class FilesystemAdapter implements McpAdapter {
  readonly id = "filesystem";

  constructor(private readonly workspaceRoot: string) {}

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const startTime = Date.now();

    try {
      switch (call.tool) {
        case "list_directory": {
          const targetPath = call.input.trim() || ".";
          const absolutePath = checkPathWithinWorkspace(this.workspaceRoot, targetPath);
          if (!absolutePath) {
            return { ok: false, output: "Path escapes workspace root", latencyMs: Date.now() - startTime };
          }

          const entries = await fs.readdir(absolutePath, { withFileTypes: true });
          const listing = entries
            .map(e => `${e.isDirectory() ? "[dir] " : "      "}${e.name}`)
            .join("\n");

          return { ok: true, output: `Contents of ${targetPath}:\n${listing}`, latencyMs: Date.now() - startTime };
        }

        case "file_info": {
          const targetPath = call.input.trim();
          if (!targetPath) {
            return { ok: false, output: "Path required", latencyMs: Date.now() - startTime };
          }
          const absolutePath = checkPathWithinWorkspace(this.workspaceRoot, targetPath);
          if (!absolutePath) {
            return { ok: false, output: "Path escapes workspace root", latencyMs: Date.now() - startTime };
          }

          const stat = await fs.stat(absolutePath);
          return {
            ok: true,
            output: `File: ${targetPath}\nSize: ${stat.size} bytes\nModified: ${stat.mtime.toISOString()}\nIs directory: ${stat.isDirectory()}`,
            latencyMs: Date.now() - startTime,
          };
        }

        default:
          return { ok: false, output: `Unknown filesystem tool: ${call.tool}. Available: list_directory, file_info`, latencyMs: Date.now() - startTime };
      }
    } catch (error) {
      return { ok: false, output: `Error: ${String(error)}`, latencyMs: Date.now() - startTime };
    }
  }

  async listTools(): Promise<string[]> {
    return ["list_directory", "file_info"];
  }
}
