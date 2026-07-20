import path from "path";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { type RequestAttachment } from "@nexcode/agent-core";
import { MAX_ATTACHMENT_BYTES } from "./webviewMessageTypes";

export function guessMimeType(fileName: string): string {
  const lowered = fileName.toLowerCase();
  if (lowered.endsWith(".png")) {
    return "image/png";
  }
  if (lowered.endsWith(".jpg") || lowered.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lowered.endsWith(".gif")) {
    return "image/gif";
  }
  if (lowered.endsWith(".webp")) {
    return "image/webp";
  }
  if (lowered.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lowered.endsWith(".md")) {
    return "text/markdown";
  }
  if (
    lowered.endsWith(".ts") ||
    lowered.endsWith(".tsx") ||
    lowered.endsWith(".js") ||
    lowered.endsWith(".jsx") ||
    lowered.endsWith(".json") ||
    lowered.endsWith(".yml") ||
    lowered.endsWith(".yaml") ||
    lowered.endsWith(".py") ||
    lowered.endsWith(".java") ||
    lowered.endsWith(".go") ||
    lowered.endsWith(".rs") ||
    lowered.endsWith(".txt")
  ) {
    return "text/plain";
  }
  return "application/octet-stream";
}

export function isTextLike(mimeType: string, fileName: string): boolean {
  const lowered = fileName.toLowerCase();
  return (
    mimeType.startsWith("text/") ||
    lowered.endsWith(".md") ||
    lowered.endsWith(".json") ||
    lowered.endsWith(".yaml") ||
    lowered.endsWith(".yml") ||
    lowered.endsWith(".ts") ||
    lowered.endsWith(".tsx") ||
    lowered.endsWith(".js") ||
    lowered.endsWith(".jsx") ||
    lowered.endsWith(".py") ||
    lowered.endsWith(".csv") ||
    lowered.endsWith(".txt") ||
    lowered.endsWith(".xml") ||
    lowered.endsWith(".html") ||
    lowered.endsWith(".css") ||
    lowered.endsWith(".java") ||
    lowered.endsWith(".go") ||
    lowered.endsWith(".rs")
  );
}

export async function readAttachment(uri: vscode.Uri): Promise<RequestAttachment> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const fileName = path.basename(uri.fsPath);
  const mimeType = guessMimeType(fileName);
  const byteSize = bytes.byteLength;
  const id = randomUUID();

  if (byteSize > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment is too large (${byteSize} bytes, max 3MB).`);
  }

  if (isTextLike(mimeType, fileName) && byteSize <= 250_000) {
    const textContent = new TextDecoder("utf-8", { fatal: false }).decode(
      bytes,
    );
    return {
      id,
      fileName,
      mimeType,
      kind: "text",
      textContent,
      byteSize,
    };
  }

  const base64Data = Buffer.from(bytes).toString("base64");
  return {
    id,
    fileName,
    mimeType,
    kind: mimeType.startsWith("image/") ? "image" : "binary",
    base64Data,
    byteSize,
  };
}
