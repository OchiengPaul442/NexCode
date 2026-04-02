import * as assert from "assert";
import * as vscode from "vscode";

describe("Extension Test Suite", () => {
  it("Extension activates", async () => {
    const ext = vscode.extensions.getExtension("your-name.nexcode-kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();
    assert.strictEqual(
      ext!.isActive,
      true,
      "Extension should be active after activation",
    );
  });
});
