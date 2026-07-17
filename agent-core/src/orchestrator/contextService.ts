import { OrchestratorRequest, RequestAttachment } from "../types";
import {
  buildWorkspaceContext,
  clampText,
  extractLikelyFileReferences,
  normalizeActivityPath,
} from "./contextBuilder";

const MAX_MEMORY_CONTEXT_CHARS = 4_000;
const MAX_SESSION_CONTEXT_CHARS = 3_000;

export interface ContextServiceConfig {
  workspaceRoot: string;
}

export interface MemoryContext {
  longTermMemory: string;
  sessionHistory: string;
}

export interface ToolOutputContext {
  toolName: string;
  output: string;
  truncated: boolean;
}

export class ContextService {
  private readonly config: ContextServiceConfig;

  constructor(config: ContextServiceConfig) {
    this.config = config;
  }

  public async buildWorkspaceContext(
    request: OrchestratorRequest,
  ): Promise<string> {
    return buildWorkspaceContext(request, this.config.workspaceRoot);
  }

  public buildMemoryContext(
    longTermMemory: string,
    sessionHistory: string,
  ): MemoryContext {
    return {
      longTermMemory: clampText(
        longTermMemory,
        MAX_MEMORY_CONTEXT_CHARS,
        "Long-term memory trimmed",
      ),
      sessionHistory: clampText(
        sessionHistory,
        MAX_SESSION_CONTEXT_CHARS,
        "Session history trimmed",
      ),
    };
  }

  public truncateToolOutput(
    toolName: string,
    output: string,
    maxChars: number = 16_000,
  ): ToolOutputContext {
    const truncated = output.length > maxChars;
    return {
      toolName,
      output: clampText(output, maxChars, "Tool output truncated"),
      truncated,
    };
  }

  public extractFileReferences(prompt: string): string[] {
    return extractLikelyFileReferences(prompt);
  }

  public normalizePath(
    rawPath: string | undefined,
  ): string | undefined {
    if (!rawPath) {
      return undefined;
    }
    return normalizeActivityPath(rawPath, this.config.workspaceRoot);
  }

  public buildAttachmentContext(attachments: RequestAttachment[]): string {
    if (attachments.length === 0) {
      return "";
    }

    const lines: string[] = ["User attachments:"];
    const bounded = attachments.slice(0, 8);

    for (const attachment of bounded) {
      const sizeLabel = attachment.byteSize
        ? ` (${attachment.byteSize} bytes)`
        : "";
      lines.push(
        `- ${attachment.fileName} [${attachment.kind}, ${attachment.mimeType}]${sizeLabel}`,
      );

      if (attachment.kind === "text" && attachment.textContent) {
        const snippet = clampText(
          attachment.textContent,
          3_000,
          "Attachment snippet trimmed",
        );
        lines.push(`  Text snippet:\n${snippet}`);
      } else if (attachment.kind === "image" && attachment.base64Data) {
        const preview = attachment.base64Data.slice(0, 320);
        lines.push(
          `  Image base64 preview (first 320 chars): ${preview}${attachment.base64Data.length > 320 ? "..." : ""}`,
        );
      } else if (attachment.base64Data) {
        lines.push(
          `  Binary base64 preview (first 160 chars): ${attachment.base64Data.slice(0, 160)}${attachment.base64Data.length > 160 ? "..." : ""}`,
        );
      }
    }

    if (attachments.length > bounded.length) {
      lines.push(
        `- ... ${attachments.length - bounded.length} more attachment(s) omitted`,
      );
    }

    return lines.join("\n");
  }
}
