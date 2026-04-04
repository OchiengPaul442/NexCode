import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
  test("extension activates", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();
    assert.ok(ext!.isActive, "Extension did not activate");
  });
});
