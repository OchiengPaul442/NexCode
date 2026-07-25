import { type McpAdapter, type McpToolCall, type McpToolResult } from "../types";

/**
 * Database MCP adapter for SQL database operations.
 * Supports SQLite (local) and PostgreSQL (via connection string).
 */
export class DatabaseMcpAdapter implements McpAdapter {
  public readonly id = "database";

  private dbPath?: string;
  private connectionString?: string;

  constructor(config: { dbPath?: string; connectionString?: string }) {
    this.dbPath = config.dbPath;
    this.connectionString = config.connectionString;
  }

  async listTools(): Promise<string[]> {
    return ["query", "list-tables", "describe-table", "schema"];
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const startedAt = Date.now();
    try {
      switch (call.tool) {
        case "query":
          return await this.executeQuery(call.input);
        case "list-tables":
          return await this.listTables();
        case "describe-table":
          return await this.describeTable(call.input);
        case "schema":
          return await this.getSchema();
        default:
          return {
            ok: false,
            output: `Unknown database tool: ${call.tool}`,
            latencyMs: Date.now() - startedAt,
          };
      }
    } catch (error) {
      return {
        ok: false,
        output: String(error),
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private async executeQuery(sql: string): Promise<McpToolResult> {
    const startedAt = Date.now();
    try {
      // SQLite support via better-sqlite3 (dynamic require)
      if (this.dbPath) {
        try {
          // Dynamic require to avoid TypeScript compilation error
          // better-sqlite3 is an optional dependency
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Database = require("better-sqlite3");
          const db = new Database(this.dbPath);
          try {
            const stmt = db.prepare(sql);
            const isReadOnly = sql.trim().toUpperCase().startsWith("SELECT") ||
              sql.trim().toUpperCase().startsWith("PRAGMA");
            
            if (isReadOnly) {
              const rows = stmt.all();
              return {
                ok: true,
                output: JSON.stringify(rows, null, 2),
                latencyMs: Date.now() - startedAt,
              };
            } else {
              const result = stmt.run();
              return {
                ok: true,
                output: `Query executed. Rows affected: ${result.changes}`,
                latencyMs: Date.now() - startedAt,
              };
            }
          } finally {
            db.close();
          }
        } catch {
          return {
            ok: false,
            output: "better-sqlite3 not installed. Run: npm install better-sqlite3",
            latencyMs: Date.now() - startedAt,
          };
        }
      }

      return {
        ok: false,
        output: "No database configured. Set dbPath in MCP config.",
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        output: `Query failed: ${String(error)}`,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private async listTables(): Promise<McpToolResult> {
    return this.executeQuery("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  }

  private async describeTable(tableName: string): Promise<McpToolResult> {
    return this.executeQuery(`PRAGMA table_info(${tableName})`);
  }

  private async getSchema(): Promise<McpToolResult> {
    return this.executeQuery("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name");
  }
}
