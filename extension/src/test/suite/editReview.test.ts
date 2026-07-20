/**
 * NC-032: VS Code Extension Host Integration Tests — EditReviewService
 *
 * These tests validate edit review and apply behavior through the real VS Code API,
 * specifically testing path containment and stale content detection that requires
 * actual workspace filesystem access.
 *
 * Tests that need a workspace folder are skipped when none is available.
 */
import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";

suite("EditReviewService Integration", () => {
  // agent-core functions available via the bundled extension dependency
  let checkPathWithinWorkspace: (workspaceRoot: string, filePath: string) => string | null;
  let validateEditPreconditions: (
    edit: { id: string; filePath: string; oldText: string; newText: string },
    workspaceRoot: string,
    currentContent: string | null,
  ) => { ok: boolean; error?: string; hash?: string };
  let computeContentHash: (content: string) => string;
  let validateWebviewMessage: (message: unknown) => { valid: boolean; error?: string };
  let isAllowedSettingKey: (key: string) => boolean;

  suiteSetup(() => {
    const agentCore = require("@nexcode/agent-core");
    checkPathWithinWorkspace = agentCore.checkPathWithinWorkspace;
    validateEditPreconditions = agentCore.validateEditPreconditions;
    computeContentHash = agentCore.computeContentHash;
    validateWebviewMessage = agentCore.validateWebviewMessage;
    isAllowedSettingKey = agentCore.isAllowedSettingKey;
  });

  // --- Path containment tests (pure logic, no workspace needed) ---

  test("path traversal is rejected by checkPathWithinWorkspace (NC-006, NC-020)", () => {
    const workspaceRoot = "C:\\Users\\test\\workspace";
    assert.strictEqual(checkPathWithinWorkspace(workspaceRoot, "../etc/passwd"), null);
    assert.strictEqual(checkPathWithinWorkspace(workspaceRoot, "../../secret.txt"), null);
    assert.strictEqual(checkPathWithinWorkspace(workspaceRoot, "..\\..\\secret.txt"), null);
  });

  test("absolute path outside workspace is rejected (NC-006, NC-020)", () => {
    const workspaceRoot = "C:\\Users\\test\\workspace";
    assert.strictEqual(checkPathWithinWorkspace(workspaceRoot, "C:\\Windows\\System32\\config\\sam"), null);
    assert.strictEqual(checkPathWithinWorkspace(workspaceRoot, "/etc/passwd"), null);
  });

  test("valid relative path is accepted (NC-006)", () => {
    const workspaceRoot = "C:\\Users\\test\\workspace";
    const result = checkPathWithinWorkspace(workspaceRoot, "src/utils/helper.ts");
    assert.ok(result !== null, "Valid relative path should be accepted");
    // Path may use OS separators, so check the last segment
    const normalized = result.replace(/\\/g, "/");
    assert.ok(
      normalized.endsWith("src/utils/helper.ts"),
      `Should resolve to expected path, got: ${result}`,
    );
  });

  test("empty path is rejected (NC-020)", () => {
    const workspaceRoot = "C:\\Users\\test\\workspace";
    assert.strictEqual(checkPathWithinWorkspace(workspaceRoot, ""), null);
    assert.strictEqual(checkPathWithinWorkspace(workspaceRoot, "  "), null);
  });

  test("null bytes in path are rejected (NC-020)", () => {
    const workspaceRoot = "C:\\Users\\test\\workspace";
    assert.strictEqual(checkPathWithinWorkspace(workspaceRoot, "src/file.ts\0/etc/passwd"), null);
  });

  // --- Validate edit preconditions tests ---

  test("validateEditPreconditions detects stale content (NC-006)", () => {
    const edit = {
      id: "test-edit-1",
      filePath: "test-file.ts",
      oldText: "original content",
      newText: "new content",
    };
    const workspaceRoot = "C:\\Users\\test\\workspace";

    // When current content matches oldText, precondition should pass
    const passResult = validateEditPreconditions(edit, workspaceRoot, "original content");
    assert.strictEqual(passResult.ok, true, "Matching content should pass");

    // When current content differs from oldText, precondition should fail
    const failResult = validateEditPreconditions(edit, workspaceRoot, "modified content");
    assert.strictEqual(failResult.ok, false, "Stale content should be rejected");
    assert.ok(failResult.error, "Error message should be provided");
  });

  test("validateEditPreconditions allows new file creation (NC-006)", () => {
    const edit = {
      id: "test-edit-new",
      filePath: "new-file.ts",
      oldText: "",
      newText: "console.log('new');",
    };
    const workspaceRoot = "C:\\Users\\test\\workspace";
    const result = validateEditPreconditions(edit, workspaceRoot, null);
    assert.strictEqual(result.ok, true, "New file creation should pass");
  });

  test("validateEditPreconditions rejects path traversal (NC-006)", () => {
    const edit = {
      id: "test-edit-traversal",
      filePath: "../escape.ts",
      oldText: "",
      newText: "malicious",
    };
    const workspaceRoot = "C:\\Users\\test\\workspace";
    const result = validateEditPreconditions(edit, workspaceRoot, null);
    assert.strictEqual(result.ok, false, "Traversal path should be rejected");
  });

  // --- Content hash tests ---

  test("content hash is deterministic (NC-006)", () => {
    const hash1 = computeContentHash("hello world");
    const hash2 = computeContentHash("hello world");
    assert.strictEqual(hash1, hash2, "Same content should produce same hash");

    const hash3 = computeContentHash("hello world!");
    assert.notStrictEqual(hash1, hash3, "Different content should produce different hash");
  });

  test("content hash is SHA-256 format (NC-006)", () => {
    const hash = computeContentHash("test");
    assert.ok(/^[a-f0-9]{64}$/.test(hash), "Hash should be 64-char hex SHA-256");
  });

  // --- Webview message validation tests ---

  test("webview message validation rejects unknown types (NC-005)", () => {
    const result = validateWebviewMessage({ type: "unknownMessageType" });
    assert.strictEqual(result.valid, false, "Unknown message type should be rejected");
  });

  test("webview message validation accepts valid types (NC-005)", () => {
    const result = validateWebviewMessage({ type: "sendPrompt", prompt: "Hello, world!" });
    assert.strictEqual(result.valid, true, "Valid sendPrompt should be accepted");
  });

  test("webview message validation rejects non-objects (NC-005)", () => {
    assert.strictEqual(validateWebviewMessage(null).valid, false, "null rejected");
    assert.strictEqual(validateWebviewMessage("string").valid, false, "string rejected");
    assert.strictEqual(validateWebviewMessage(42).valid, false, "number rejected");
    assert.strictEqual(validateWebviewMessage(undefined).valid, false, "undefined rejected");
    assert.strictEqual(validateWebviewMessage([]).valid, false, "array rejected");
  });

  test("webview message validation rejects empty prompt (NC-005)", () => {
    const result = validateWebviewMessage({ type: "sendPrompt", prompt: "" });
    assert.strictEqual(result.valid, false, "Empty prompt should be rejected");
  });

  test("setting key allowlist rejects secret keys (NC-003, NC-005)", () => {
    assert.strictEqual(isAllowedSettingKey("openAIApiKey"), false, "openAIApiKey must be rejected");
    assert.strictEqual(isAllowedSettingKey("searchApiKey"), false, "searchApiKey must be rejected");
    assert.strictEqual(isAllowedSettingKey("tavilyApiKey"), false, "tavilyApiKey must be rejected");
    assert.strictEqual(isAllowedSettingKey("defaultModel"), true, "defaultModel should be allowed");
    assert.strictEqual(isAllowedSettingKey("toolApproval"), true, "toolApproval should be allowed");
    assert.strictEqual(isAllowedSettingKey("allowWorkspacePrompts"), true, "allowWorkspacePrompts should be allowed");
    assert.strictEqual(isAllowedSettingKey("__proto__"), false, "Prototype pollution rejected");
    assert.strictEqual(isAllowedSettingKey("eval"), false, "eval key rejected");
  });

  // --- VS Code WorkspaceEdit tests (require workspace) ---

  test("VS Code WorkspaceEdit applies to a file when workspace is available", async function () {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.skip();
      return;
    }

    const testDir = workspaceFolders[0].uri.fsPath;
    const testFile = vscode.Uri.file(path.join(testDir, ".nexcode-test-file.ts"));
    const content = "// NC-032 integration test\nconsole.log('hello');\n";

    // Write test file
    await vscode.workspace.fs.writeFile(testFile, Buffer.from(content, "utf8"));

    // Open and verify
    const doc = await vscode.workspace.openTextDocument(testFile);
    assert.ok(doc.getText().includes("hello"), "File should contain 'hello'");

    // Apply a workspace edit
    const workspaceEdit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      new vscode.Position(0, 0),
      doc.lineAt(doc.lineCount - 1).range.end,
    );
    workspaceEdit.replace(testFile, fullRange, "// Updated by NC-032 test\nconsole.log('updated');\n");
    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    assert.strictEqual(applied, true, "WorkspaceEdit should apply successfully");

    // Verify the edit was applied
    const updatedDoc = await vscode.workspace.openTextDocument(testFile);
    assert.ok(updatedDoc.getText().includes("updated"), "File should contain 'updated'");

    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test("multi-root workspace folder info is accessible (NC-023)", () => {
    // Verify that workspace folder information is accessible
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      assert.ok(Array.isArray(workspaceFolders), "workspaceFolders should be an array");
      for (const folder of workspaceFolders) {
        assert.ok(folder.uri, "Each folder should have a URI");
        assert.ok(folder.name, "Each folder should have a name");
        assert.strictEqual(typeof folder.index, "number", "Each folder should have an index");
      }
    }
    // This test passes whether or not workspace folders exist — it validates the API shape
  });
});
