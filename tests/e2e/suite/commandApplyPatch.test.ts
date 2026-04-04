import * as assert from "assert";
import * as vscode from "vscode";

suite("Command Apply Patch", () => {
  test("applies patch via command with provided text", async () => {
    const ext = vscode.extensions.getExtension("your-name.kiboko");
    assert.ok(ext, "Extension not found");
    await ext!.activate();

    const initial = "alpha beta gamma";
    const doc = await vscode.workspace.openTextDocument({ content: initial });
    await vscode.window.showTextDocument(doc);

    const replacement = "alpha brave new gamma";
    await vscode.commands.executeCommand("kiboko.applyPatch", replacement);

    // allow edit to apply
    await new Promise((r) => setTimeout(r, 50));
    const updated = doc.getText();
    assert.strictEqual(updated, replacement);
  }).timeout(10000);
});
