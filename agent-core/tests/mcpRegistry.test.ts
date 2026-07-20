/**
 * NC-009 — MCP implementation is a disconnected custom stub, not full MCP
 *
 * The MCP implementation is an in-process adapter registry, not a real MCP
 * protocol client. It has no JSON-RPC transport, capability negotiation,
 * lifecycle, server configuration, authentication, notifications, resource/prompt
 * support, timeouts, or protocol-version handling.
 *
 * Additionally, the orchestrator previously created an empty McpRegistry and
 * passed it to ToolRegistry, causing the default FilesystemAdapter to be skipped.
 * The webview's MCP server list was therefore always empty.
 *
 * Containment fix:
 * - Register the built-in FilesystemAdapter in the orchestrator's McpRegistry.
 * - MCP is in-process only; not a real MCP protocol client.
 *
 * Regression tests:
 * - Orchestrator registers FilesystemAdapter by default
 * - MCP server list includes "filesystem" by default
 * - FilesystemAdapter lists its tools (list_directory, file_info)
 * - McpRegistry is an in-process adapter registry (no real MCP protocol)
 * - Custom adapters can be registered and listed
 * - McpRegistry rejects calls to unregistered servers
 * - FilesystemAdapter enforces workspace containment
 */

import path from "path";
import fs from "fs/promises";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createNexcodeOrchestrator } from "../src";
import { McpRegistry } from "../src/mcp/mcpRegistry";
import { FilesystemAdapter } from "../src/mcp/adapters/filesystemAdapter";
import { McpAdapter, McpToolCall, McpToolResult } from "../src/mcp/types";

describe("NC-009 — MCP in-process adapter registry", () => {
  const workspaceRoot = path.resolve(__dirname, "..", "..");

  describe("Orchestrator MCP registration", () => {
    it("orchestrator lists 'filesystem' as a default MCP server", () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
      const servers = orchestrator.listMcpServers();
      expect(servers).toContain("filesystem");
    });

    it("orchestrator does not list any non-built-in servers by default", () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
      const servers = orchestrator.listMcpServers();
      expect(servers).toEqual(["filesystem"]);
    });

    it("orchestrator can list tools for the filesystem server", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
      const tools = await orchestrator.listMcpTools("filesystem");
      expect(tools).toContain("list_directory");
      expect(tools).toContain("file_info");
    });

    it("orchestrator returns empty tools for unknown server", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
      const tools = await orchestrator.listMcpTools("nonexistent");
      expect(tools).toEqual([]);
    });

    it("orchestrator can invoke filesystem MCP tool", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
      const result = await orchestrator.invokeMcpTool({
        server: "filesystem",
        tool: "list_directory",
        input: "agent-core/src/mcp",
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("Contents of agent-core/src/mcp");
    });
  });

  describe("McpRegistry as in-process adapter registry", () => {
    it("McpRegistry stores adapters by ID", () => {
      const registry = new McpRegistry();
      const adapter: McpAdapter = {
        id: "test-adapter",
        async callTool(call: McpToolCall): Promise<McpToolResult> {
          return { ok: true, output: "test", latencyMs: 0 };
        },
      };

      registry.register(adapter);
      expect(registry.has("test-adapter")).toBe(true);
      expect(registry.listServers()).toContain("test-adapter");
    });

    it("McpRegistry unregisters adapters", () => {
      const registry = new McpRegistry();
      const adapter: McpAdapter = {
        id: "test-adapter",
        async callTool(): Promise<McpToolResult> {
          return { ok: true, output: "test", latencyMs: 0 };
        },
      };

      registry.register(adapter);
      expect(registry.has("test-adapter")).toBe(true);

      registry.unregister("test-adapter");
      expect(registry.has("test-adapter")).toBe(false);
    });

    it("McpRegistry returns error for calls to unregistered servers", async () => {
      const registry = new McpRegistry();
      const result = await registry.call({
        server: "nonexistent",
        tool: "any",
        input: "",
      });
      expect(result.ok).toBe(false);
      expect(result.output).toContain("not registered");
    });

    it("McpRegistry is an in-process registry with no MCP protocol support", () => {
      const registry = new McpRegistry();
      const proto = Object.getPrototypeOf(registry);
      const methodNames = Object.getOwnPropertyNames(proto).filter(
        (n) => n !== "constructor",
      );

      // McpRegistry should NOT have MCP protocol methods
      const mcpProtocolMethods = [
        "initialize",
        "connect",
        "disconnect",
        "negotiate",
        "ping",
        "listResources",
        "readResource",
        "listPrompts",
        "getPrompt",
        "subscribe",
        "unsubscribe",
        "sendNotification",
        "setTransport",
        "getTransport",
      ];

      for (const method of mcpProtocolMethods) {
        expect(methodNames).not.toContain(method);
      }

      // McpRegistry SHOULD have in-process adapter methods
      const expectedMethods = ["register", "unregister", "has", "listServers", "listTools", "call"];
      for (const method of expectedMethods) {
        expect(methodNames).toContain(method);
      }
    });

    it("McpRegistry does not support transports, lifecycle, or auth", () => {
      const registry = new McpRegistry();
      // Should not have any transport, lifecycle, or auth properties
      expect((registry as Record<string, unknown>)["transport"]).toBeUndefined();
      expect((registry as Record<string, unknown>)["stdio"]).toBeUndefined();
      expect((registry as Record<string, unknown>)["http"]).toBeUndefined();
      expect((registry as Record<string, unknown>)["version"]).toBeUndefined();
      expect((registry as Record<string, unknown>)["auth"]).toBeUndefined();
    });
  });

  describe("FilesystemAdapter workspace containment", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = path.join(__dirname, "..", "__tmp_mcp_test_" + Date.now());
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(path.join(tmpDir, "test.txt"), "hello world");
      await fs.mkdir(path.join(tmpDir, "subdir"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "subdir", "nested.txt"),
        "nested content",
      );
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("list_directory works within workspace", async () => {
      const adapter = new FilesystemAdapter(tmpDir);
      const result = await adapter.callTool({
        server: "filesystem",
        tool: "list_directory",
        input: "subdir",
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("nested.txt");
    });

    it("list_directory rejects traversal outside workspace", async () => {
      const adapter = new FilesystemAdapter(tmpDir);
      const result = await adapter.callTool({
        server: "filesystem",
        tool: "list_directory",
        input: "../..",
      });
      expect(result.ok).toBe(false);
      expect(result.output).toContain("escapes workspace");
    });

    it("file_info works within workspace", async () => {
      const adapter = new FilesystemAdapter(tmpDir);
      const result = await adapter.callTool({
        server: "filesystem",
        tool: "file_info",
        input: "test.txt",
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("File: test.txt");
      expect(result.output).toContain("11 bytes");
    });

    it("file_info rejects traversal outside workspace", async () => {
      const adapter = new FilesystemAdapter(tmpDir);
      const result = await adapter.callTool({
        server: "filesystem",
        tool: "file_info",
        input: "../../etc/passwd",
      });
      expect(result.ok).toBe(false);
      expect(result.output).toContain("escapes workspace");
    });

    it("file_info rejects empty path", async () => {
      const adapter = new FilesystemAdapter(tmpDir);
      const result = await adapter.callTool({
        server: "filesystem",
        tool: "file_info",
        input: "",
      });
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Path required");
    });

    it("unknown tool returns error with available tools", async () => {
      const adapter = new FilesystemAdapter(tmpDir);
      const result = await adapter.callTool({
        server: "filesystem",
        tool: "write_file",
        input: "test.txt",
      });
      expect(result.ok).toBe(false);
      expect(result.output).toContain("Unknown filesystem tool");
      expect(result.output).toContain("list_directory");
      expect(result.output).toContain("file_info");
    });

    it("listTools returns expected tools", async () => {
      const adapter = new FilesystemAdapter(tmpDir);
      const tools = await adapter.listTools!();
      expect(tools).toEqual(["list_directory", "file_info"]);
    });
  });

  describe("FilesystemAdapter registered in orchestrator", () => {
    it("orchestrator can call filesystem:list_directory via MCP", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
      const result = await orchestrator.invokeMcpTool({
        server: "filesystem",
        tool: "list_directory",
        input: "agent-core/src/mcp",
      });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("mcpRegistry.ts");
    });

    it("orchestrator MCP call to unknown server returns error", async () => {
      const orchestrator = createNexcodeOrchestrator({ workspaceRoot });
      const result = await orchestrator.invokeMcpTool({
        server: "nonexistent",
        tool: "any",
        input: "",
      });
      expect(result.ok).toBe(false);
      expect(result.output).toContain("not registered");
    });
  });
});
