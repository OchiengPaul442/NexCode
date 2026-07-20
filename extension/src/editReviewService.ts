import path from "path";
import * as vscode from "vscode";
import {
  type ProposedEdit,
  validateEditPreconditions,
  checkPathWithinWorkspace,
} from "@nexcode/agent-core";

export class EditReviewService {
  private postMessage: (message: unknown) => void;

  constructor(postMessage: (message: unknown) => void) {
    this.postMessage = postMessage;
  }

  public async applyEdit(
    edit: ProposedEdit,
    workspaceRoot: string,
  ): Promise<boolean> {
    // 1. Validate path containment — reject traversal via "../" or absolute paths.
    const absolutePath = checkPathWithinWorkspace(workspaceRoot, edit.filePath);
    if (absolutePath === null) {
      this.postMessage({
        type: "error",
        message: `Edit path escapes workspace root: ${edit.filePath}`,
      });
      return false;
    }

    const targetUri = vscode.Uri.file(absolutePath);

    // 2. Read current content and check for staleness.
    let currentContent: string | null = null;
    if (await this.fileExists(targetUri)) {
      const document = await vscode.workspace.openTextDocument(targetUri);
      currentContent = document.getText();
    }

    const precondition = validateEditPreconditions(edit, workspaceRoot, currentContent);
    if (!precondition.ok) {
      this.postMessage({
        type: "error",
        message: precondition.error ?? "Edit precondition check failed.",
      });
      return false;
    }

    // 3. Apply the edit using the validated absolute path.
    const workspaceEdit = new vscode.WorkspaceEdit();

    if (currentContent !== null) {
      const document = await vscode.workspace.openTextDocument(targetUri);
      const fullRange = this.fullDocumentRange(document);
      workspaceEdit.replace(targetUri, fullRange, edit.newText);
    } else {
      workspaceEdit.createFile(targetUri, { ignoreIfExists: true });
      workspaceEdit.insert(targetUri, new vscode.Position(0, 0), edit.newText);
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (!applied) {
      this.postMessage({
        type: "error",
        message: "VS Code rejected the workspace edit.",
      });
      return false;
    }

    this.postMessage({
      type: "editApplied",
      editId: edit.id,
      filePath: edit.filePath,
    });

    const opened = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(opened, {
      preview: false,
      preserveFocus: false,
    });

    return true;
  }

  public async previewEdit(
    edit: ProposedEdit,
    workspaceRoot: string,
  ): Promise<void> {
    // Validate path containment — reject traversal via "../" or absolute paths.
    const absolutePath = checkPathWithinWorkspace(workspaceRoot, edit.filePath);
    if (absolutePath === null) {
      this.postMessage({
        type: "error",
        message: `Edit path escapes workspace root: ${edit.filePath}`,
      });
      return;
    }

    const targetUri = vscode.Uri.file(absolutePath);
    const previewsDir = vscode.Uri.file(
      path.join(workspaceRoot, ".nexcode", "edit-previews"),
    );
    await vscode.workspace.fs.createDirectory(previewsDir);

    const extension = path.extname(edit.filePath) || ".txt";
    const safeBaseName = path
      .basename(edit.filePath)
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    const beforeUri = vscode.Uri.file(
      path.join(
        previewsDir.fsPath,
        `${edit.id}-${safeBaseName}.before${extension}`,
      ),
    );
    const afterUri = vscode.Uri.file(
      path.join(
        previewsDir.fsPath,
        `${edit.id}-${safeBaseName}.after${extension}`,
      ),
    );

    const targetExists = await this.fileExists(targetUri);
    if (!targetExists) {
      await vscode.workspace.fs.writeFile(beforeUri, Buffer.from("", "utf8"));
    }

    await vscode.workspace.fs.writeFile(
      afterUri,
      Buffer.from(edit.newText, "utf8"),
    );

    await vscode.commands.executeCommand(
      "vscode.diff",
      targetExists ? targetUri : beforeUri,
      afterUri,
      `NEXCODE Review: ${edit.filePath}`,
    );

    this.postMessage({
      type: "editPreviewOpened",
      editId: edit.id,
      filePath: edit.filePath,
    });
  }

  public rejectEdit(editId: string): void {
    this.postMessage({
      type: "editRejected",
      editId,
    });
  }

  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private fullDocumentRange(document: vscode.TextDocument): vscode.Range {
    const lastLineIndex = Math.max(0, document.lineCount - 1);
    const lastLine = document.lineAt(lastLineIndex);
    return new vscode.Range(0, 0, lastLineIndex, lastLine.text.length);
  }
}
