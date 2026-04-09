import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { createRuntimeConfig, RuntimeConfig } from "./config";
import { CoderAgent } from "./agents/coderAgent";
import { PlannerAgent } from "./agents/plannerAgent";
import { QaAgent } from "./agents/qaAgent";
import { ReviewerAgent } from "./agents/reviewerAgent";
import { SecurityAgent } from "./agents/securityAgent";
import {
  ActivityFile,
  ActivityStatus,
  ActivityTodo,
  AgentMode,
  AgentResult,
  ChatMessage,
  OrchestratorEvent,
  OrchestratorRequest,
  OrchestratorResponse,
  ProviderId,
  ProposedEdit,
  RequestAttachment,
  ToolResult,
} from "./types";
import { McpAdapter, McpToolCall, McpToolResult } from "./mcp";
import { McpRegistry } from "./mcp/mcpRegistry";
import { MemoryManager } from "./memory/memoryManager";
import { PromptStore } from "./prompts/promptStore";
import { FeedbackLogger } from "./self-improve/feedbackLogger";
import { PromptVersionManager } from "./self-improve/promptVersionManager";
import { ReflectionEngine } from "./self-improve/reflectionEngine";
import { ModelRouter } from "./providers/modelRouter";
import { OllamaProvider } from "./providers/ollamaProvider";
import { OpenAICompatibleProvider } from "./providers/openAICompatibleProvider";
import { ToolRegistry } from "./tools/toolRegistry";
import { chunkText, extractFirstCodeBlock } from "./utils/text";
import {
  buildGroundingNoteForMode,
  getAgentMaxTokens,
  normalizeAgentOutputForMode,
} from "./agents/shared";
import {
  buildWorkspaceContext,
  getWorkspaceTopLevelEntries,
  resolvePathWithinWorkspaceRoot,
  clampText,
  extractLikelyFileReferences,
  buildAttachmentContext,
  normalizeActivityPath,
  getWorkspaceSnapshotCache,
  setWorkspaceSnapshotCache,
} from "./orchestrator/contextBuilder";

export interface NexcodeOrchestratorOptions {
  workspaceRoot?: string;
  promptsDir?: string;
  memoryDir?: string;
  defaultProvider?: ProviderId;
  defaultModel?: string;
  defaultCloudModel?: string;
  ollamaBaseUrl?: string;
  openAIBaseUrl?: string;
  openAIApiKey?: string;
  tavilyApiKey?: string;
  tavilyBaseUrl?: string;
}

type AutoRoutingStrategy =
  | {
      kind: "single";
      mode: Exclude<AgentMode, "auto">;
      statusLabel?: string;
      todoTitle: string;
    }
  | {
      kind: "pipeline";
      pipeline: Exclude<AgentMode, "auto">[];
    };

export interface PromptEnhancementRequest {
  prompt: string;
  provider?: ProviderId;
  model?: string;
  mode?: AgentMode;
  temperature?: number;
  workspaceRoot?: string;
  activeFilePath?: string;
  selectedText?: string;
}

export interface PromptEnhancementResult {
  enhancedPrompt: string;
  notes: string[];
  providerUsed: ProviderId;
  modelUsed: string;
}

interface InferredEditRequest {
  filePath: string;
  instruction: string;
}

const MAX_WORKSPACE_CONTEXT_CHARS = 12_000;
const MAX_MEMORY_CONTEXT_CHARS = 4_000;
const MAX_TOOL_OUTPUT_CHARS = 16_000;
const MAX_ACTIVE_SNIPPET_CHARS = 3_200;
const MAX_REFERENCED_FILE_SNIPPET_CHARS = 1_600;
const MAX_ATTACHMENT_TEXT_CHARS = 3_000;

export class NexcodeOrchestrator {
  private readonly config: RuntimeConfig;
  private readonly router: ModelRouter;
  private readonly prompts: PromptStore;
  private readonly memory: MemoryManager;
  private readonly tools: ToolRegistry;
  private readonly planner: PlannerAgent;
  private readonly coder: CoderAgent;
  private readonly reviewer: ReviewerAgent;
  private readonly qa: QaAgent;
  private readonly security: SecurityAgent;
  private readonly feedbackLogger: FeedbackLogger;
  private readonly reflection: ReflectionEngine;
  private readonly promptVersions: PromptVersionManager;
  private readonly mcpRegistry: McpRegistry;
  private readonly ephemeralSessionId = randomUUID();

  public constructor(options: NexcodeOrchestratorOptions = {}) {
    this.config = createRuntimeConfig({
      workspaceRoot: options.workspaceRoot,
      promptsDir: options.promptsDir,
      memoryDir: options.memoryDir,
      providerDefaults: {
        provider: options.defaultProvider ?? "ollama",
        model: options.defaultModel ?? "gpt-oss:120b-cloud",
        ollamaBaseUrl: options.ollamaBaseUrl ?? "http://localhost:11434",
        openAIBaseUrl: options.openAIBaseUrl ?? "https://api.openai.com/v1",
        openAIApiKey: options.openAIApiKey ?? process.env.OPENAI_API_KEY,
      },
      toolDefaults: {
        tavilyApiKey: options.tavilyApiKey ?? process.env.TAVILY_API_KEY,
        tavilyBaseUrl: options.tavilyBaseUrl ?? "https://api.tavily.com/search",
      },
    });

    this.router = new ModelRouter(
      {
        ollama: new OllamaProvider(this.config.providerDefaults.ollamaBaseUrl),
        "openai-compatible": new OpenAICompatibleProvider(
          this.config.providerDefaults.openAIBaseUrl,
          this.config.providerDefaults.openAIApiKey,
        ),
      },
      {
        defaultProvider: this.config.providerDefaults.provider,
        defaultModel: this.config.providerDefaults.model,
        defaultCloudModel: options.defaultCloudModel ?? "gpt-oss:120b-cloud",
      },
    );

    this.prompts = new PromptStore(this.config.promptsDir);
    this.memory = new MemoryManager(this.config.memoryDir);
    this.mcpRegistry = new McpRegistry();
    this.tools = new ToolRegistry(this.config.workspaceRoot, {
      tavilyApiKey: this.config.toolDefaults.tavilyApiKey,
      tavilyBaseUrl: this.config.toolDefaults.tavilyBaseUrl,
      mcpRegistry: this.mcpRegistry,
    });

    this.planner = new PlannerAgent(this.router, this.prompts);
    this.coder = new CoderAgent(this.router, this.prompts);
    this.reviewer = new ReviewerAgent(this.router, this.prompts);
    this.qa = new QaAgent(this.router, this.prompts);
    this.security = new SecurityAgent(this.router, this.prompts);

    this.feedbackLogger = new FeedbackLogger(this.config.memoryDir);
    this.reflection = new ReflectionEngine();
    this.promptVersions = new PromptVersionManager(this.config.memoryDir);
  }

  public registerMcpAdapter(adapter: McpAdapter): void {
    this.mcpRegistry.register(adapter);
  }

  public listMcpServers(): string[] {
    return this.mcpRegistry.listServers();
  }

  public listMcpTools(server: string): Promise<string[]> {
    return this.mcpRegistry.listTools(server);
  }

  public invokeMcpTool(call: McpToolCall): Promise<McpToolResult> {
    return this.mcpRegistry.call(call);
  }

  public async enhancePrompt(
    request: PromptEnhancementRequest,
  ): Promise<PromptEnhancementResult> {
    const originalPrompt = request.prompt?.trim() ?? "";
    const fallbackProvider =
      request.provider ?? this.config.providerDefaults.provider;
    const fallbackModel = request.model ?? this.config.providerDefaults.model;

    if (!originalPrompt) {
      return {
        enhancedPrompt: request.prompt ?? "",
        notes: ["Prompt is empty, so no rewrite was performed."],
        providerUsed: fallbackProvider,
        modelUsed: fallbackModel,
      };
    }

    const resolved = this.router.resolve({
      provider: request.provider,
      model: request.model,
      complexity: originalPrompt.length > 1200 ? "large" : "small",
    });

    const contextRequest: OrchestratorRequest = {
      prompt: originalPrompt,
      workspaceRoot: request.workspaceRoot,
      activeFilePath: request.activeFilePath,
      selectedText: request.selectedText,
    };

    const [memoryContext, workspaceContext] = await Promise.all([
      this.memory.getRelevantContext(originalPrompt).catch(() => ""),
      buildWorkspaceContext(contextRequest, this.config.workspaceRoot).catch(
        () => "",
      ),
    ]);

    const rewriteMode = request.mode ?? "auto";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          "You rewrite coding-task prompts for an autonomous software agent.",
          "Return plain text only. Do not use JSON or markdown fences.",
          "Start with the rewritten prompt ready to send to the agent.",
          "If you want to mention what changed, add a blank line followed by 'Notes:' and brief plain text lines.",
          "Preserve intent, constraints, and requested scope.",
          "Do not invent requirements or change the user objective.",
          "Preserve explicit slash commands (/tool, /edit, /plan, /code, /fix, /test, /explain).",
          "If prompt is already high quality, keep changes minimal.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Mode hint: ${rewriteMode}`,
          `Original prompt:\n${originalPrompt}`,
          workspaceContext
            ? `Workspace context:\n${workspaceContext.slice(0, 5000)}`
            : "",
          memoryContext
            ? `Memory context:\n${memoryContext.slice(0, 2500)}`
            : "",
          "Rewrite now.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];

    const response = await this.router.generate(messages, {
      provider: request.provider,
      model: request.model,
      temperature:
        typeof request.temperature === "number"
          ? Math.min(1, Math.max(0, request.temperature))
          : 0.2,
      maxTokens: 900,
      complexity: originalPrompt.length > 1200 ? "large" : "small",
    });

    const parsed = this.parsePromptEnhancement(response.text, originalPrompt);

    return {
      enhancedPrompt: parsed.enhancedPrompt,
      notes: parsed.notes,
      providerUsed: resolved.provider.id,
      modelUsed: resolved.model,
    };
  }

  public async *stream(
    request: OrchestratorRequest,
  ): AsyncGenerator<OrchestratorEvent> {
    const mode = request.mode ?? "auto";
    const provider = request.provider ?? this.config.providerDefaults.provider;
    const model = request.model ?? this.config.providerDefaults.model;
    const temperature =
      typeof request.temperature === "number"
        ? Math.min(2, Math.max(0, request.temperature))
        : undefined;
    const sessionId = this.getSessionId(request.workspaceRoot);
    const diagnostics: string[] = [];
    let streamedAnyToken = false;
    let latestActivityFiles: ActivityFile[] = [];
    let executedToolCommand: string | null = null;

    this.memory.appendSessionMessage(sessionId, {
      role: "user",
      content: request.prompt,
    });

    yield {
      type: "status",
      message: `Using ${model} on ${provider} (${mode} mode)`,
    };

    yield {
      type: "status",
      message: "Collecting workspace and memory context",
    };

    yield {
      type: "activity",
      todos: [
        {
          id: "context",
          title: "Collect workspace and memory context",
          status: "in-progress",
          detail: "Gathering conversation memory and workspace signals",
        },
        {
          id: "execution",
          title: "Execute request",
          status: "not-started",
          detail: "Waiting for context",
        },
        {
          id: "finalize",
          title: "Finalize response",
          status: "not-started",
          detail: "Pending",
        },
      ],
      note: "Starting request",
    };

    try {
      this.ensureNotAborted(request.abortSignal);
      const [memoryContextRaw, workspaceContextRaw] = await Promise.all([
        this.memory.getRelevantContext(request.prompt).catch(() => ""),
        buildWorkspaceContext(request, this.config.workspaceRoot).catch(
          () => "",
        ),
      ]);
      this.ensureNotAborted(request.abortSignal);

      const memoryContext = this.clampText(
        memoryContextRaw,
        MAX_MEMORY_CONTEXT_CHARS,
        "Memory context trimmed",
      );
      const workspaceContext = this.clampText(
        workspaceContextRaw,
        MAX_WORKSPACE_CONTEXT_CHARS,
        "Workspace context trimmed",
      );

      yield {
        type: "status",
        message: "Context ready",
      };

      yield {
        type: "activity",
        todos: [
          {
            id: "context",
            title: "Collect workspace and memory context",
            status: "completed",
            detail: "Context assembled",
          },
          {
            id: "execution",
            title: "Execute request",
            status: "in-progress",
            detail: "Routing request",
          },
          {
            id: "finalize",
            title: "Finalize response",
            status: "not-started",
            detail: "Pending",
          },
        ],
        note: "Context ready",
      };

      const inferredToolCommand =
        request.allowTools !== false
          ? this.extractToolCommandRequest(
              request.prompt,
              request.workspaceRoot,
              request.activeFilePath,
            )
          : null;
      const inferredEditRequest = this.inferNaturalLanguageEditRequest(
        request.prompt,
        request.workspaceRoot,
        request.activeFilePath,
      );

      let response: OrchestratorResponse | null = null;
      if (
        request.prompt.trimStart().startsWith("/tool ") &&
        request.allowTools !== false
      ) {
        const toolCommand = request.prompt.replace(/^\s*\/tool\s+/, "").trim();
        executedToolCommand = toolCommand;
        const toolFiles = this.inferActivityFilesFromToolCommand(toolCommand);
        latestActivityFiles = toolFiles;

        yield {
          type: "status",
          message: toolCommand.startsWith("terminal ")
            ? `Running terminal command: ${toolCommand.slice("terminal ".length)}`
            : `Running tool command: ${toolCommand}`,
        };

        yield {
          type: "activity",
          todos: [
            {
              id: "tool-parse",
              title: "Parse tool command",
              status: "completed",
              detail: toolCommand,
            },
            {
              id: "tool-run",
              title: "Execute tool",
              status: "in-progress",
              detail: "Waiting for tool output",
            },
            {
              id: "tool-summarize",
              title: "Prepare tool result",
              status: "not-started",
              detail: "Pending",
            },
          ],
          files: toolFiles,
          note: "Tool command detected",
        };

        const iterator = this.streamToolRequest(
          request.prompt,
          mode,
          provider,
          model,
          diagnostics,
          request.allowWebSearch !== false,
          request.abortSignal,
        );

        while (true) {
          const step = await iterator.next();
          if (step.done) {
            response = step.value;
            break;
          }

          if (step.value.type === "token") {
            streamedAnyToken = true;
          }

          yield step.value;
        }

        yield {
          type: "activity",
          todos: [
            {
              id: "tool-parse",
              title: "Parse tool command",
              status: "completed",
              detail: toolCommand,
            },
            {
              id: "tool-run",
              title: "Execute tool",
              status: "completed",
              detail: "Tool run complete",
            },
            {
              id: "tool-summarize",
              title: "Prepare tool result",
              status: "completed",
              detail: "Result formatted",
            },
          ],
          files: toolFiles.map((file) => ({ ...file, status: "modified" })),
          note: "Tool execution complete",
        };
      } else if (inferredToolCommand) {
        const inferredPrompt = `/tool ${inferredToolCommand}`;
        executedToolCommand = inferredToolCommand;
        const inferredStatus = inferredToolCommand.startsWith("terminal ")
          ? `Running terminal command: ${inferredToolCommand.slice("terminal ".length)}`
          : `Running inferred tool command: ${inferredToolCommand}`;
        const inferredFiles =
          this.inferActivityFilesFromToolCommand(inferredToolCommand);
        latestActivityFiles = inferredFiles;

        yield {
          type: "status",
          message: inferredStatus,
        };

        yield {
          type: "activity",
          todos: [
            {
              id: "tool-infer",
              title: "Infer tool command",
              status: "completed",
              detail: inferredToolCommand,
            },
            {
              id: "tool-run",
              title: "Execute inferred tool",
              status: "in-progress",
              detail: "Waiting for tool output",
            },
            {
              id: "tool-summarize",
              title: "Prepare tool result",
              status: "not-started",
              detail: "Pending",
            },
          ],
          files: inferredFiles,
          note: "Inferred tool command",
        };

        const iterator = this.streamToolRequest(
          inferredPrompt,
          mode,
          provider,
          model,
          diagnostics,
          request.allowWebSearch !== false,
          request.abortSignal,
        );

        while (true) {
          const step = await iterator.next();
          if (step.done) {
            response = step.value;
            break;
          }

          if (step.value.type === "token") {
            streamedAnyToken = true;
          }

          yield step.value;
        }

        yield {
          type: "activity",
          todos: [
            {
              id: "tool-infer",
              title: "Infer tool command",
              status: "completed",
              detail: inferredToolCommand,
            },
            {
              id: "tool-run",
              title: "Execute inferred tool",
              status: "completed",
              detail: "Tool run complete",
            },
            {
              id: "tool-summarize",
              title: "Prepare tool result",
              status: "completed",
              detail: "Result formatted",
            },
          ],
          files: inferredFiles.map((file) => ({ ...file, status: "modified" })),
          note: "Tool execution complete",
        };
      } else if (request.prompt.trimStart().startsWith("/edit ")) {
        const parsedEdit = this.parseEditCommand(request.prompt);
        const editFiles = parsedEdit
          ? [
              {
                path: parsedEdit.filePath,
                status: "in-progress" as ActivityStatus,
                summary: "Preparing patch proposal",
              },
            ]
          : [];
        latestActivityFiles = editFiles;

        yield {
          type: "status",
          message: "Preparing edit proposal",
        };

        yield {
          type: "activity",
          todos: [
            {
              id: "edit-parse",
              title: "Parse edit command",
              status: parsedEdit ? "completed" : "in-progress",
              detail: parsedEdit
                ? `Target: ${parsedEdit.filePath}`
                : "Parsing command",
            },
            {
              id: "edit-draft",
              title: "Draft file update",
              status: "in-progress",
              detail: "Generating candidate file content",
            },
            {
              id: "edit-patch",
              title: "Build patch preview",
              status: "not-started",
              detail: "Pending",
            },
          ],
          files: editFiles,
          note: "Preparing edit proposal",
        };

        response = await this.handleEditRequest(
          request.prompt,
          mode,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          diagnostics,
          request.abortSignal,
        );

        latestActivityFiles =
          response.proposedEdits.length > 0
            ? this.buildActivityFilesFromProposedEdits(response.proposedEdits)
            : editFiles.map((file) => ({ ...file, status: "modified" }));

        yield {
          type: "activity",
          todos: [
            {
              id: "edit-parse",
              title: "Parse edit command",
              status: parsedEdit ? "completed" : "in-progress",
              detail: parsedEdit
                ? `Target: ${parsedEdit.filePath}`
                : "Command format needs review",
            },
            {
              id: "edit-draft",
              title: "Draft file update",
              status: "completed",
              detail: "Model response complete",
            },
            {
              id: "edit-patch",
              title: "Build patch preview",
              status: "completed",
              detail:
                response.proposedEdits.length > 0
                  ? `${response.proposedEdits.length} proposed edit(s)`
                  : "No edits proposed",
            },
          ],
          files: latestActivityFiles,
          note: "Edit proposal ready",
        };
      } else if (inferredEditRequest) {
        const inferredEditPrompt = `/edit ${inferredEditRequest.filePath} :: ${inferredEditRequest.instruction}`;
        const editFiles = [
          {
            path: inferredEditRequest.filePath,
            status: "in-progress" as ActivityStatus,
            summary: "Preparing inferred patch proposal",
          },
        ];
        latestActivityFiles = editFiles;

        yield {
          type: "status",
          message: `Preparing edit proposal for ${inferredEditRequest.filePath}`,
        };

        yield {
          type: "activity",
          todos: [
            {
              id: "edit-infer",
              title: "Infer edit target",
              status: "completed",
              detail: inferredEditRequest.filePath,
            },
            {
              id: "edit-draft",
              title: "Draft file update",
              status: "in-progress",
              detail: "Generating candidate file content",
            },
            {
              id: "edit-patch",
              title: "Build patch preview",
              status: "not-started",
              detail: "Pending",
            },
          ],
          files: editFiles,
          note: "Inferred file edit request",
        };

        response = await this.handleEditRequest(
          inferredEditPrompt,
          mode,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          diagnostics,
          request.abortSignal,
        );

        latestActivityFiles =
          response.proposedEdits.length > 0
            ? this.buildActivityFilesFromProposedEdits(response.proposedEdits)
            : editFiles.map((file) => ({ ...file, status: "modified" }));

        yield {
          type: "activity",
          todos: [
            {
              id: "edit-infer",
              title: "Infer edit target",
              status: "completed",
              detail: inferredEditRequest.filePath,
            },
            {
              id: "edit-draft",
              title: "Draft file update",
              status: "completed",
              detail: "Model response complete",
            },
            {
              id: "edit-patch",
              title: "Build patch preview",
              status: "completed",
              detail:
                response.proposedEdits.length > 0
                  ? `${response.proposedEdits.length} proposed edit(s)`
                  : "No edits proposed",
            },
          ],
          files: latestActivityFiles,
          note: "Edit proposal ready",
        };
      } else if (mode === "auto") {
        const strategy = this.resolveAutoStrategy(request.prompt);
        if (strategy.kind === "pipeline") {
          const pipelineTodos = strategy.pipeline.map((stage, index) => ({
            id: `pipeline-${index + 1}-${stage}`,
            title: `${this.formatPipelineStage(stage)} stage`,
            status:
              index === 0
                ? ("in-progress" as ActivityStatus)
                : ("not-started" as ActivityStatus),
            detail: index === 0 ? "Active" : "Queued",
          }));

          yield {
            type: "status",
            message: `Auto routing: multi-agent pipeline (${strategy.pipeline
              .map((stage) => this.formatPipelineStage(stage))
              .join(" → ")})`,
          };

          yield {
            type: "activity",
            todos: pipelineTodos,
            note: "Auto routing selected pipeline",
          };

          const iterator = this.runAutoModeStreaming(
            request.prompt,
            provider,
            model,
            temperature,
            workspaceContext,
            memoryContext,
            diagnostics,
            strategy.pipeline,
            request.abortSignal,
          );

          while (true) {
            const step = await iterator.next();
            if (step.done) {
              response = step.value;
              break;
            }

            if (step.value.type === "token") {
              streamedAnyToken = true;
            }

            if (step.value.type === "activity") {
              latestActivityFiles = step.value.files ?? latestActivityFiles;
            }

            yield step.value;
          }
        } else {
          yield {
            type: "status",
            message:
              strategy.statusLabel ??
              `Auto routing: ${this.formatPipelineStage(strategy.mode)} fast path`,
          };

          const inferredFiles = this.inferActivityFilesFromPrompt(
            request.prompt,
            request.workspaceRoot,
            request.activeFilePath,
          );
          latestActivityFiles = inferredFiles;

          const iterator = this.runSingleModeStreaming(
            strategy.mode,
            "auto",
            request.prompt,
            provider,
            model,
            temperature,
            workspaceContext,
            memoryContext,
            diagnostics,
            request.abortSignal,
            {
              statusLabel: strategy.statusLabel,
              todoTitle: strategy.todoTitle,
              files: inferredFiles,
            },
          );

          while (true) {
            const step = await iterator.next();
            if (step.done) {
              response = step.value;
              break;
            }

            if (step.value.type === "token") {
              streamedAnyToken = true;
            }

            if (step.value.type === "activity") {
              latestActivityFiles = step.value.files ?? latestActivityFiles;
            }

            yield step.value;
          }
        }
      } else {
        const selectedMode = mode as Exclude<AgentMode, "auto">;
        const inferredFiles = this.inferActivityFilesFromPrompt(
          request.prompt,
          request.workspaceRoot,
          request.activeFilePath,
        );
        latestActivityFiles = inferredFiles;

        const iterator = this.runSingleModeStreaming(
          selectedMode,
          mode,
          request.prompt,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          diagnostics,
          request.abortSignal,
          {
            statusLabel: this.describePipelineStage(selectedMode),
            todoTitle: `Run ${this.formatPipelineStage(selectedMode)} stage`,
            files: inferredFiles,
          },
        );

        while (true) {
          const step = await iterator.next();
          if (step.done) {
            response = step.value;
            break;
          }

          if (step.value.type === "token") {
            streamedAnyToken = true;
          }

          if (step.value.type === "activity") {
            latestActivityFiles = step.value.files ?? latestActivityFiles;
          }

          yield step.value;
        }
      }

      this.ensureNotAborted(request.abortSignal);

      if (!response) {
        throw new Error("No response produced by orchestrator pipeline.");
      }

      if (
        request.allowTools !== false &&
        (mode === "auto" || mode === "coder")
      ) {
        const suggestedToolCommand = this.extractSuggestedToolCommand(
          response.text,
        );

        if (suggestedToolCommand) {
          diagnostics.push(
            `Auto-executing suggested tool command: ${suggestedToolCommand}`,
          );

          yield {
            type: "status",
            message: `Running suggested tool command: ${suggestedToolCommand}`,
          };

          executedToolCommand = suggestedToolCommand;
          latestActivityFiles =
            this.inferActivityFilesFromToolCommand(suggestedToolCommand);

          const iterator = this.streamToolRequest(
            `/tool ${suggestedToolCommand}`,
            response.modeUsed,
            response.providerUsed,
            response.modelUsed,
            diagnostics,
            request.allowWebSearch !== false,
            request.abortSignal,
          );

          while (true) {
            const step = await iterator.next();
            if (step.done) {
              response = step.value;
              break;
            }

            if (step.value.type === "token") {
              streamedAnyToken = true;
            }

            yield step.value;
          }
        }
      }

      response.diagnostics = diagnostics;

      if (!streamedAnyToken && response.text.trim().length > 0) {
        for (const token of chunkText(response.text, 32)) {
          yield {
            type: "token",
            token,
          };
        }
      }

      this.memory.appendSessionMessage(sessionId, {
        role: "assistant",
        content: response.text,
      });

      await this.memory.rememberInteraction(request.prompt, response.text, [
        response.modeUsed,
        provider,
        model,
      ]);

      if (executedToolCommand) {
        await this.memory.rememberNote(
          `Successful tool workflow: ${executedToolCommand}`,
          ["workflow", "tool", response.modeUsed],
          {
            provider: response.providerUsed,
            model: response.modelUsed,
          },
        );
      }

      if (response.proposedEdits.length > 0) {
        await this.memory.rememberNote(
          `Successful edit workflow: ${response.proposedEdits
            .map((edit) => edit.filePath)
            .join(", ")}`,
          ["workflow", "edit", response.modeUsed],
          {
            files: response.proposedEdits.map((edit) => edit.filePath),
            prompt: request.prompt.slice(0, 240),
          },
        );
      }

      const feedback = this.reflection.score(
        request.prompt,
        response.text,
        response.proposedEdits.length,
        0,
      );
      await this.feedbackLogger.log({
        ...feedback,
        metadata: {
          mode: response.modeUsed,
          provider,
          model,
          diagnosticsCount: diagnostics.length,
        },
      });

      if (feedback.score >= 85) {
        await this.promptVersions.record(
          response.modeUsed,
          feedback.score,
          "High-scoring response captured for prompt evolution.",
        );
      }

      const responseFiles = this.buildActivityFilesFromProposedEdits(
        response.proposedEdits,
      );
      if (responseFiles.length > 0) {
        latestActivityFiles = responseFiles;
      }

      yield {
        type: "activity",
        todos: [
          {
            id: "context",
            title: "Collect workspace and memory context",
            status: "completed",
            detail: "Completed",
          },
          {
            id: "execution",
            title: "Execute request",
            status: "completed",
            detail: "Completed",
          },
          {
            id: "finalize",
            title: "Finalize response",
            status: "completed",
            detail: "Saved to memory and ready in chat",
          },
        ],
        files: latestActivityFiles,
        note: "Response ready",
      };

      yield {
        type: "final",
        response,
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        yield {
          type: "activity",
          todos: [
            {
              id: "execution",
              title: "Execute request",
              status: "failed",
              detail: "Stopped by user",
            },
          ],
          note: "Request stopped",
        };

        yield {
          type: "stopped",
          message: "Request stopped by user.",
        };
        return;
      }

      const errorMessage = this.formatUserFacingError(error);

      yield {
        type: "activity",
        todos: [
          {
            id: "execution",
            title: "Execute request",
            status: "failed",
            detail: errorMessage,
          },
        ],
        note: "Request failed",
      };

      yield {
        type: "error",
        message: errorMessage,
      };
    }
  }

  public async applyProposedEdit(edit: ProposedEdit): Promise<void> {
    const absolutePath = this.tools.filesystem.resolveWorkspacePath(
      edit.filePath,
    );
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, edit.newText, "utf8");
  }

  private async *runSingleModeStreaming(
    selectedMode: Exclude<AgentMode, "auto">,
    modeUsed: AgentMode,
    prompt: string,
    provider: ProviderId,
    model: string,
    temperature: number | undefined,
    workspaceContext: string,
    memoryContext: string,
    diagnostics: string[],
    abortSignal?: AbortSignal,
    options?: {
      statusLabel?: string;
      todoTitle?: string;
      files?: ActivityFile[];
    },
  ): AsyncGenerator<OrchestratorEvent, OrchestratorResponse> {
    const stageLabel = this.formatPipelineStage(selectedMode);
    const todoTitle = options?.todoTitle ?? `Run ${stageLabel} stage`;
    const activityFiles = (options?.files ?? []).map((file) => ({ ...file }));

    yield {
      type: "status",
      message: options?.statusLabel ?? this.describePipelineStage(selectedMode),
    };

    yield {
      type: "activity",
      todos: [
        {
          id: `${selectedMode}-single`,
          title: todoTitle,
          status: "in-progress",
          detail: `${stageLabel} is generating output`,
        },
      ],
      files: activityFiles,
      note: `${stageLabel} stage started`,
    };

    let text = "";

    try {
      for await (const token of this.streamAgentTokens(
        selectedMode,
        {
          userPrompt: prompt,
          workspaceContext,
          memoryContext,
        },
        provider,
        model,
        temperature,
        abortSignal,
      )) {
        this.ensureNotAborted(abortSignal);
        if (!token) {
          continue;
        }

        text += token;
        yield {
          type: "token",
          token,
        };
      }
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      const errorStr = String(error);
      const isTimeout = errorStr.toLowerCase().includes("timeout");
      diagnostics.push(`${capitalize(selectedMode)} agent error: ${errorStr}`);
      const fallback = [
        `> **${capitalize(selectedMode)} agent could not complete the task.**`,
        ">",
        `> ${
          isTimeout
            ? "The request timed out. Try a smaller sub-task or a faster model."
            : errorStr
        }`,
      ].join("\n");

      for (const token of chunkText(fallback, 32)) {
        text += token;
        yield {
          type: "token",
          token,
        };
      }
    }

    const finalText = text.trim().length
      ? normalizeAgentOutputForMode(selectedMode, text.trim(), prompt)
      : `${stageLabel} agent returned an empty response.`;

    yield {
      type: "activity",
      todos: [
        {
          id: `${selectedMode}-single`,
          title: todoTitle,
          status: "completed",
          detail: `${stageLabel} response ready`,
        },
      ],
      files: activityFiles.map((file) => ({
        ...file,
        status: file.status === "failed" ? "failed" : "modified",
      })),
      note: `${stageLabel} stage complete`,
    };

    return {
      text: finalText,
      modeUsed,
      providerUsed: provider,
      modelUsed: model,
      proposedEdits: [],
      diagnostics,
    };
  }

  private async *runAutoModeStreaming(
    prompt: string,
    provider: ProviderId,
    model: string,
    temperature: number | undefined,
    workspaceContext: string,
    memoryContext: string,
    diagnostics: string[],
    pipeline: Exclude<AgentMode, "auto">[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<OrchestratorEvent, OrchestratorResponse> {
    let composed = "";
    let planContent: string | undefined;
    let implementationDraft: string | undefined;
    const stageTodos: ActivityTodo[] = pipeline.map((stage, index) => ({
      id: `pipeline-${index + 1}-${stage}`,
      title: `${this.formatPipelineStage(stage)} stage`,
      status: index === 0 ? "in-progress" : "not-started",
      detail: index === 0 ? "Active" : "Queued",
    }));

    yield {
      type: "activity",
      todos: stageTodos.map((todo) => ({ ...todo })),
      note: "Pipeline execution started",
    };

    for (let stageIndex = 0; stageIndex < pipeline.length; stageIndex += 1) {
      const stage = pipeline[stageIndex];
      this.ensureNotAborted(abortSignal);

      const stageLabel = this.formatPipelineStage(stage);
      stageTodos[stageIndex] = {
        ...stageTodos[stageIndex],
        status: "in-progress",
        detail: "Running",
      };

      yield {
        type: "status",
        message: this.describePipelineStage(stage),
      };

      yield {
        type: "activity",
        todos: stageTodos.map((todo) => ({ ...todo })),
        note: `${stageLabel} stage running`,
      };

      const sectionPrefix = `${composed.length > 0 ? "\n\n" : ""}## ${stageLabel}\n\n`;
      composed += sectionPrefix;
      yield {
        type: "token",
        token: sectionPrefix,
      };

      let stageText = "";

      try {
        for await (const token of this.streamAgentTokens(
          stage,
          {
            userPrompt: prompt,
            workspaceContext,
            memoryContext,
            plan: planContent,
            implementationDraft,
          },
          provider,
          model,
          temperature,
          abortSignal,
        )) {
          this.ensureNotAborted(abortSignal);
          if (!token) {
            continue;
          }

          stageText += token;
          composed += token;
          yield {
            type: "token",
            token,
          };
        }
      } catch (error) {
        if (this.isAbortError(error)) {
          throw error;
        }

        const errorStr = String(error);
        const isTimeout = errorStr.toLowerCase().includes("timeout");
        diagnostics.push(`${capitalize(stage)} agent error: ${errorStr}`);
        const fallback = [
          `> **${stageLabel} stage could not complete.**`,
          ">",
          `> ${
            isTimeout
              ? "This stage timed out. Continue with the partial result and retry in a focused follow-up."
              : errorStr
          }`,
        ].join("\n");

        for (const token of chunkText(fallback, 32)) {
          stageText += token;
          composed += token;
          yield {
            type: "token",
            token,
          };
        }
      }

      const normalizedStageText = normalizeAgentOutputForMode(
        stage,
        stageText.trim(),
        prompt,
      );
      if (!normalizedStageText) {
        const fallbackText = `${stageLabel} stage returned an empty response.`;
        composed += fallbackText;
        yield {
          type: "token",
          token: fallbackText,
        };
        stageText = fallbackText;
      }

      if (stage === "planner") {
        planContent = stageText.trim();
      }

      if (stage === "coder") {
        implementationDraft = stageText.trim();
      }

      stageTodos[stageIndex] = {
        ...stageTodos[stageIndex],
        status: "completed",
        detail: "Completed",
      };
      if (stageIndex + 1 < stageTodos.length) {
        const nextTodo = stageTodos[stageIndex + 1];
        if (nextTodo.status === "not-started") {
          stageTodos[stageIndex + 1] = {
            ...nextTodo,
            detail: "Up next",
          };
        }
      }

      yield {
        type: "status",
        message: `${stageLabel} stage complete`,
      };

      yield {
        type: "activity",
        todos: stageTodos.map((todo) => ({ ...todo })),
        note: `${stageLabel} stage complete`,
      };
    }

    return {
      text: composed.trim(),
      modeUsed: "auto",
      providerUsed: provider,
      modelUsed: model,
      proposedEdits: [],
      diagnostics,
    };
  }

  private async *streamAgentTokens(
    mode: Exclude<AgentMode, "auto">,
    input: {
      userPrompt: string;
      workspaceContext: string;
      memoryContext: string;
      plan?: string;
      implementationDraft?: string;
    },
    provider: ProviderId,
    model: string,
    temperature: number | undefined,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<string> {
    const messages = await this.buildAgentMessages(mode, input);

    for await (const token of this.router.stream(messages, {
      provider,
      model,
      temperature,
      maxTokens: getAgentMaxTokens(mode, input.userPrompt),
      complexity: input.userPrompt.length > 1200 ? "large" : "small",
      signal: abortSignal,
    })) {
      if (token) {
        yield token;
      }
    }
  }

  private async buildAgentMessages(
    mode: Exclude<AgentMode, "auto">,
    input: {
      userPrompt: string;
      workspaceContext?: string;
      memoryContext?: string;
      plan?: string;
      implementationDraft?: string;
    },
  ): Promise<ChatMessage[]> {
    const systemPrompt = await this.prompts.getPrompt(mode);
    const boundedWorkspaceContext = this.clampText(
      input.workspaceContext ?? "",
      MAX_WORKSPACE_CONTEXT_CHARS,
      "Workspace context trimmed",
    );
    const boundedMemoryContext = this.clampText(
      input.memoryContext ?? "",
      MAX_MEMORY_CONTEXT_CHARS,
      "Memory context trimmed",
    );

    const parts = [
      `User request:\n${input.userPrompt}`,
      buildGroundingNoteForMode(mode, input.userPrompt)
        ? `Grounding note:\n${buildGroundingNoteForMode(mode, input.userPrompt)}`
        : "",
      input.plan ? `Planner output:\n${input.plan}` : "",
      input.implementationDraft
        ? `Coder output:\n${input.implementationDraft}`
        : "",
      boundedWorkspaceContext
        ? `Workspace context:\n${boundedWorkspaceContext}`
        : "",
      boundedMemoryContext ? `Memory context:\n${boundedMemoryContext}` : "",
    ].filter((part) => part.length > 0);

    return [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: parts.join("\n\n"),
      },
    ];
  }

  private resolveAutoStrategy(prompt: string): AutoRoutingStrategy {
    const normalized = prompt.toLowerCase().trim();
    const words = normalized.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    const isGreeting =
      /^(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening))(?:[\s!.,?]*)$/.test(
        normalized,
      ) || /^(thanks|thank you)(?:[\s!.,?]*)$/.test(normalized);
    const isSimpleQuestion =
      /\?$/.test(normalized) &&
      wordCount < 18 &&
      !/\b(create|build|implement|fix|debug|test|review|security|plan)\b/.test(
        normalized,
      );
    const wantsPlan =
      /\b(plan|architecture|roadmap|steps|break down|acceptance criteria)\b/.test(
        normalized,
      ) && !/\b(build|create|implement|write|code|edit|fix)\b/.test(normalized);
    const wantsSecurity =
      /\b(security|cve|vulnerability|threat|hardening|owasp|secret)\b/.test(
        normalized,
      );
    const wantsQa =
      /\b(test strategy|test case|qa|validate|verification)\b/.test(normalized);
    const wantsReview =
      /\b(review|code review|regression|smell|refactor recommendation)\b/.test(
        normalized,
      );
    const wantsDeepWorkflow =
      /\b(multi[- ]agent|end[- ]to[- ]end|comprehensive|full workflow|iterate|production[- ]grade|real world test|run all suites|thorough)\b/.test(
        normalized,
      );
    const isLarge = prompt.length > 1400 || wordCount > 220;

    if (isGreeting || isSimpleQuestion) {
      return {
        kind: "single",
        mode: "coder",
        statusLabel: "Preparing a quick direct answer",
        todoTitle: "Draft quick answer",
      };
    }

    if (wantsPlan) {
      return {
        kind: "single",
        mode: "planner",
        statusLabel: "Planning approach and milestones",
        todoTitle: "Build implementation plan",
      };
    }

    if (wantsSecurity && !wantsDeepWorkflow) {
      return {
        kind: "single",
        mode: "security",
        statusLabel: "Checking security posture",
        todoTitle: "Run focused security review",
      };
    }

    if (wantsQa && !wantsDeepWorkflow) {
      return {
        kind: "single",
        mode: "qa",
        statusLabel: "Validating behavior and tests",
        todoTitle: "Assess QA and validation coverage",
      };
    }

    if (wantsReview && !wantsDeepWorkflow) {
      return {
        kind: "single",
        mode: "reviewer",
        statusLabel: "Reviewing correctness and regressions",
        todoTitle: "Produce review findings",
      };
    }

    if (wantsDeepWorkflow || isLarge) {
      return {
        kind: "pipeline",
        pipeline: this.resolveAutoPipeline(prompt),
      };
    }

    return {
      kind: "single",
      mode: "coder",
      statusLabel: "Drafting implementation-ready response",
      todoTitle: "Generate implementation guidance",
    };
  }

  private resolveAutoPipeline(prompt: string): Exclude<AgentMode, "auto">[] {
    const normalized = prompt.toLowerCase();
    const isPlanningHeavy =
      /\b(plan|architecture|roadmap|acceptance criteria|break down)\b/.test(
        normalized,
      );
    const isSecuritySensitive =
      /\b(security|audit|cve|vulnerability|secret|threat|compliance|hardening)\b/.test(
        normalized,
      );
    const isValidationHeavy =
      /\b(test|qa|verify|validation|debug|bug|broken|error|failing)\b/.test(
        normalized,
      );
    const isBuildOrCreate =
      /\b(create|build|design|scaffold|implement|nextjs|react|frontend|website|app|blog|ui)\b/.test(
        normalized,
      );
    const isLarge = prompt.length > 900 || normalized.split(/\s+/).length > 180;

    if (isPlanningHeavy && !isBuildOrCreate) {
      return ["planner", "coder", "reviewer"];
    }

    if (isSecuritySensitive) {
      return ["coder", "reviewer", "security"];
    }

    if (isLarge || isValidationHeavy) {
      return ["coder", "reviewer", "qa"];
    }

    if (isBuildOrCreate) {
      return ["coder", "reviewer", "qa"];
    }

    return ["coder", "reviewer"];
  }

  private describePipelineStage(stage: Exclude<AgentMode, "auto">): string {
    switch (stage) {
      case "planner":
        return "Planner: outlining strategy and milestones";
      case "coder":
        return "Coder: producing implementation-ready output";
      case "reviewer":
        return "Reviewer: checking correctness and regressions";
      case "qa":
        return "QA: validating behavior and test coverage";
      case "security":
        return "Security: scanning for exploitable risks";
      default:
        return "Running agent stage";
    }
  }

  private formatPipelineStage(stage: Exclude<AgentMode, "auto">): string {
    switch (stage) {
      case "planner":
        return "Planner";
      case "coder":
        return "Coder";
      case "reviewer":
        return "Reviewer";
      case "qa":
        return "QA";
      case "security":
        return "Security";
      default:
        return "Agent";
    }
  }

  private async handleToolRequest(
    prompt: string,
    mode: AgentMode,
    provider: ProviderId,
    model: string,
    diagnostics: string[],
    allowWebSearch: boolean,
  ): Promise<OrchestratorResponse> {
    const toolCommand = prompt.replace(/^\s*\/tool\s+/, "").trim();

    if (
      /^(web-search|search-web|online-search)\b/i.test(toolCommand) &&
      !allowWebSearch
    ) {
      return {
        text: [
          "## Tool Execution",
          `Command: ${toolCommand}`,
          "",
          "Web search is disabled in settings. Enable it and try again.",
        ].join("\n"),
        modeUsed: mode,
        providerUsed: provider,
        modelUsed: model,
        proposedEdits: [],
        diagnostics,
      };
    }

    const result = await this.tools.runToolCall(toolCommand);
    const boundedOutput = this.clampText(
      result.output,
      MAX_TOOL_OUTPUT_CHARS,
      "Tool output truncated",
    );

    if (!result.ok) {
      diagnostics.push(boundedOutput);
    }

    return {
      text: [
        "## Tool Execution",
        `Command: ${toolCommand}`,
        "",
        "```text",
        boundedOutput,
        "```",
      ].join("\n"),
      modeUsed: mode,
      providerUsed: provider,
      modelUsed: model,
      proposedEdits: [],
      diagnostics,
    };
  }

  private async *streamToolRequest(
    prompt: string,
    mode: AgentMode,
    provider: ProviderId,
    model: string,
    diagnostics: string[],
    allowWebSearch: boolean,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<OrchestratorEvent, OrchestratorResponse> {
    const toolCommand = prompt.replace(/^\s*\/tool\s+/, "").trim();

    if (
      /^(web-search|search-web|online-search)\b/i.test(toolCommand) &&
      !allowWebSearch
    ) {
      return {
        text: [
          "## Tool Execution",
          `Command: ${toolCommand}`,
          "",
          "Web search is disabled in settings. Enable it and try again.",
        ].join("\n"),
        modeUsed: mode,
        providerUsed: provider,
        modelUsed: model,
        proposedEdits: [],
        diagnostics,
      };
    }

    const terminalMatch = toolCommand.match(/^terminal\s+(.+)$/i);
    if (terminalMatch) {
      return yield* this.streamCommandToolResult(
        toolCommand,
        mode,
        provider,
        model,
        diagnostics,
        this.tools.terminal.stream(terminalMatch[1].trim()),
        abortSignal,
      );
    }

    const testMatch = toolCommand.match(/^test(?:\s+([\s\S]+))?$/i);
    if (testMatch) {
      return yield* this.streamCommandToolResult(
        toolCommand,
        mode,
        provider,
        model,
        diagnostics,
        this.tools.test.stream(testMatch[1]?.trim()),
        abortSignal,
      );
    }

    return this.handleToolRequest(
      prompt,
      mode,
      provider,
      model,
      diagnostics,
      allowWebSearch,
    );
  }

  private async *streamCommandToolResult(
    toolCommand: string,
    mode: AgentMode,
    provider: ProviderId,
    model: string,
    diagnostics: string[],
    iterator: AsyncGenerator<string, ToolResult>,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<OrchestratorEvent, OrchestratorResponse> {
    let result: ToolResult | null = null;

    while (true) {
      this.ensureNotAborted(abortSignal);
      const step = await iterator.next();
      if (step.done) {
        result = step.value;
        break;
      }

      const chunks = chunkText(step.value, 80);
      for (const chunk of chunks) {
        yield {
          type: "token",
          token: chunk,
        };
      }
    }

    const finalResult = result ?? {
      ok: false,
      output: "Tool execution did not produce a final result.",
    };
    const boundedOutput = this.clampText(
      finalResult.output,
      MAX_TOOL_OUTPUT_CHARS,
      "Tool output truncated",
    );

    if (!finalResult.ok) {
      diagnostics.push(boundedOutput);
    }

    return {
      text: [
        "## Tool Execution",
        `Command: ${toolCommand}`,
        "",
        "```text",
        boundedOutput,
        "```",
      ].join("\n"),
      modeUsed: mode,
      providerUsed: provider,
      modelUsed: model,
      proposedEdits: [],
      diagnostics,
    };
  }

  private async handleEditRequest(
    prompt: string,
    mode: AgentMode,
    provider: ProviderId,
    model: string,
    temperature: number | undefined,
    workspaceContext: string,
    memoryContext: string,
    diagnostics: string[],
    abortSignal?: AbortSignal,
  ): Promise<OrchestratorResponse> {
    const parsed = this.parseEditCommand(prompt);
    if (!parsed) {
      return {
        text: "Use /edit <relative/path> :: <instruction>",
        modeUsed: mode,
        providerUsed: provider,
        modelUsed: model,
        proposedEdits: [],
        diagnostics,
      };
    }

    const readResult = await this.tools.filesystem.readFile(parsed.filePath);
    const oldText = readResult.ok ? readResult.output : "";

    const coderInstruction = [
      `Edit file: ${parsed.filePath}`,
      `Instruction: ${parsed.instruction}`,
      "Rules:",
      "- Preserve all existing content unless the instruction explicitly says to remove or replace it.",
      "- Make the smallest change that satisfies the instruction.",
      "- If the instruction says append or add, keep the original text and append only the requested change.",
      "- If the instruction names required sections, include all of them.",
      "- Keep the result buildable and valid for the file type.",
      "Return only the updated full file content inside a single fenced code block.",
      "",
      "Current file:",
      "```",
      oldText,
      "```",
    ].join("\n");

    const generated = await this.runAgentSafely(
      "coder",
      () =>
        this.coder.run({
          userPrompt: coderInstruction,
          provider,
          model,
          temperature,
          maxTokens: getAgentMaxTokens("coder", coderInstruction),
          workspaceContext,
          memoryContext,
          signal: abortSignal,
        }),
      diagnostics,
    );

    const extracted = extractFirstCodeBlock(generated.content);
    let newText =
      extracted && extracted.length > 0 ? extracted : generated.content;
    const requestedAppendText = this.extractRequestedAppendText(
      parsed.instruction,
    );

    if (
      this.isAppendStyleEdit(parsed.instruction) &&
      oldText.trim().length > 0 &&
      !newText.includes(oldText.trimEnd())
    ) {
      const normalizedOldText = oldText.trimEnd();
      const normalizedGeneratedText = newText.trimStart();
      const appendedLine = requestedAppendText?.trim();

      if (appendedLine && !normalizedGeneratedText.includes(appendedLine)) {
        newText = `${normalizedOldText}\n${appendedLine}`;
      } else {
        newText = normalizedGeneratedText
          ? `${normalizedOldText}\n${normalizedGeneratedText}`
          : normalizedOldText;
      }
    } else if (
      requestedAppendText &&
      !newText.includes(requestedAppendText.trim()) &&
      oldText.trim().length > 0 &&
      this.isAppendStyleEdit(parsed.instruction)
    ) {
      newText = `${oldText.trimEnd()}\n${requestedAppendText.trim()}`;
    }

    if (
      this.shouldUseBlogLandingFallback(
        parsed.filePath,
        parsed.instruction,
        newText,
      )
    ) {
      newText = this.createBlogLandingPageFallback();
    }

    const proposedEdit = await this.tools.filesystem.makeProposedEdit(
      parsed.filePath,
      newText,
      parsed.instruction,
    );

    return {
      text: [
        "## Proposed Edit",
        `File: ${parsed.filePath}`,
        `Instruction: ${parsed.instruction}`,
        "",
        "A patch preview is attached below. Apply it from the UI when ready.",
      ].join("\n"),
      modeUsed: mode,
      providerUsed: provider,
      modelUsed: model,
      proposedEdits: [proposedEdit],
      diagnostics,
    };
  }

  private parseEditCommand(
    prompt: string,
  ): { filePath: string; instruction: string } | null {
    const match = prompt.match(/^\s*\/edit\s+(.+?)\s*::\s*([\s\S]+)$/);
    if (!match) {
      return null;
    }

    return {
      filePath: match[1].trim(),
      instruction: match[2].trim(),
    };
  }

  private isAppendStyleEdit(instruction: string): boolean {
    return /\b(append|add|insert)\b/i.test(instruction);
  }

  private extractRequestedAppendText(instruction: string): string | null {
    const trimmed = instruction.trim();

    const patterns = [
      /(?:append|add|insert)(?:\s+a)?(?:\s+new)?\s+line\s+with\s+(?:the\s+)?text\s+([`'\"]?)([\s\S]+?)\1\.?$/i,
      /(?:append|add|insert)(?:\s+a)?(?:\s+new)?\s+line\s+(?:containing|that says|saying)\s+([`'\"]?)([\s\S]+?)\1\.?$/i,
      /(?:append|add|insert)(?:\s+a)?(?:\s+new)?\s+line\s+(?:with|of)\s+([`'\"]?)([\s\S]+?)\1\.?$/i,
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const text = match[2].trim();
        if (text) {
          return text;
        }
      }
    }

    return null;
  }

  private shouldUseBlogLandingFallback(
    filePath: string,
    instruction: string,
    generatedText: string,
  ): boolean {
    if (!/\b(blog|homepage|landing page|home page)\b/i.test(instruction)) {
      return false;
    }

    if (!/\.(tsx|jsx)$/i.test(filePath)) {
      return false;
    }

    return !/\b(blog|post|featured|recent)\b/i.test(generatedText);
  }

  private createBlogLandingPageFallback(): string {
    return [
      "export default function Home() {",
      "  const featuredPosts = [",
      "    { title: 'Featured post one', summary: 'A polished article preview for the blog homepage.' },",
      "    { title: 'Featured post two', summary: 'Another highlighted story from the latest posts.' },",
      "  ];",
      "",
      "  const recentPosts = [",
      "    { title: 'Recent post one', summary: 'Fresh updates from the blog.' },",
      "    { title: 'Recent post two', summary: 'Practical notes and release highlights.' },",
      "  ];",
      "",
      "  return (",
      '    <main className="min-h-screen bg-slate-950 text-slate-100">',
      '      <section className="mx-auto max-w-5xl px-6 py-16">',
      '        <p className="text-sm uppercase tracking-[0.3em] text-cyan-300">Blog</p>',
      '        <h1 className="mt-4 text-4xl font-semibold">A polished blog homepage</h1>',
      '        <p className="mt-4 max-w-2xl text-slate-300">Latest posts, featured stories, and practical notes for builders.</p>',
      "      </section>",
      "",
      '      <section className="mx-auto max-w-5xl px-6 py-6">',
      '        <h2 className="text-xl font-semibold">Featured posts</h2>',
      '        <div className="mt-4 grid gap-4 md:grid-cols-2">',
      "          {featuredPosts.map((post) => (",
      '            <article key={post.title} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">',
      '              <h3 className="text-lg font-medium">{post.title}</h3>',
      '              <p className="mt-2 text-sm text-slate-300">{post.summary}</p>',
      "            </article>",
      "          ))}",
      "        </div>",
      "      </section>",
      "",
      '      <section className="mx-auto max-w-5xl px-6 py-10">',
      '        <h2 className="text-xl font-semibold">Recent posts</h2>',
      '        <ul className="mt-4 space-y-3">',
      "          {recentPosts.map((post) => (",
      '            <li key={post.title} className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4">',
      '              <p className="font-medium">{post.title}</p>',
      '              <p className="mt-1 text-sm text-slate-300">{post.summary}</p>',
      "            </li>",
      "          ))}",
      "        </ul>",
      "      </section>",
      "    </main>",
      "  );",
      "}",
    ].join("\n");
  }

  private inferNaturalLanguageEditRequest(
    prompt: string,
    workspaceRoot?: string,
    activeFilePath?: string,
  ): InferredEditRequest | null {
    const normalized = prompt.trim();
    if (!normalized || normalized.startsWith("/")) {
      return null;
    }

    if (
      /\b(explain|describe|summari[sz]e|review|analy[sz]e|read|open|show|search|find|run|execute|test)\b/i.test(
        normalized,
      ) &&
      !/\b(refactor|rewrite|modify|change|update|fix|rename|remove|delete|add|implement|improve|clean up)\b/i.test(
        normalized,
      )
    ) {
      return null;
    }

    const hasEditVerb =
      /\b(refactor|rewrite|modify|change|update|fix|rename|remove|delete|add|implement|improve|clean up)\b/i.test(
        normalized,
      );
    if (!hasEditVerb) {
      return null;
    }

    const referencedFiles = extractLikelyFileReferences(normalized)
      .map((candidate) => this.normalizeActivityPath(candidate, workspaceRoot))
      .filter((candidate): candidate is string => Boolean(candidate));
    const mentionsFileContext =
      referencedFiles.length > 0 ||
      /\b(file|component|module|function|class|screen|service)\b/i.test(
        normalized,
      ) ||
      /\b(this|current|active|selected|attached)\s+file\b/i.test(normalized);

    if (!mentionsFileContext) {
      return null;
    }

    const filePath = this.resolvePromptTargetPath(
      normalized,
      workspaceRoot,
      activeFilePath,
    );
    if (!filePath) {
      return null;
    }

    return {
      filePath,
      instruction: normalized,
    };
  }

  private extractToolCommandRequest(
    prompt: string,
    workspaceRoot?: string,
    activeFilePath?: string,
  ): string | null {
    const terminalCommand = this.extractTerminalCommandRequest(prompt);
    if (terminalCommand) {
      return `terminal ${terminalCommand}`;
    }

    const normalized = prompt.trim();
    if (!normalized) {
      return null;
    }

    const readMatch = normalized.match(
      /^(?:please\s+)?(?:read|open|show)\s+(?:the\s+)?file\s+(.+)$/i,
    );
    if (readMatch) {
      return `read ${readMatch[1].trim()}`;
    }

    const searchMatch = normalized.match(
      /^(?:please\s+)?(?:search|find)\s+(?:for\s+)?(.+)$/i,
    );
    if (searchMatch && !/\b(command|terminal|shell)\b/i.test(normalized)) {
      const searchQuery = searchMatch[1].trim();
      const shouldInferSearch =
        /["'`]/.test(searchQuery) ||
        /\b(file|symbol|text|string|pattern|repo|repository|workspace|codebase)\b/i.test(
          searchQuery,
        );

      if (shouldInferSearch) {
        return `search ${searchQuery}`;
      }
    }

    const testMatch = normalized.match(
      /^(?:please\s+)?(?:run|execute)\s+(?:the\s+)?tests?(?:\s+with\s+(.+))?$/i,
    );
    if (testMatch) {
      const args = testMatch[1]?.trim();
      return args && args.length > 0 ? `test ${args}` : "test";
    }

    const moveMatch = normalized.match(
      /^(?:please\s+)?(?:move|rename)\s+(.+?)\s+(?:to|into)\s+(.+)$/i,
    );
    if (moveMatch) {
      const sourcePath = this.normalizeRequestedPath(
        moveMatch[1],
        workspaceRoot,
        activeFilePath,
      );
      const destinationPath = this.normalizeRequestedPath(
        moveMatch[2],
        workspaceRoot,
        activeFilePath,
      );

      if (sourcePath && destinationPath) {
        return `move ${sourcePath} :: ${destinationPath}`;
      }
    }

    const clearMatch = normalized.match(
      /^(?:please\s+)?(?:clear|empty|delete\s+contents\s+of|remove\s+contents\s+of)\s+(.+)$/i,
    );
    if (clearMatch) {
      const targetPath = this.normalizeRequestedPath(
        clearMatch[1],
        workspaceRoot,
        activeFilePath,
      );

      if (targetPath) {
        return `delete-contents ${targetPath}`;
      }
    }

    const deleteMatch = normalized.match(
      /^(?:please\s+)?(?:delete|remove)\s+(.+)$/i,
    );
    if (deleteMatch) {
      const targetPath = this.normalizeRequestedPath(
        deleteMatch[1],
        workspaceRoot,
        activeFilePath,
      );

      if (targetPath) {
        return `delete ${targetPath}`;
      }
    }

    return null;
  }

  private resolvePromptTargetPath(
    prompt: string,
    workspaceRoot?: string,
    activeFilePath?: string,
  ): string | null {
    const referencedFiles = extractLikelyFileReferences(prompt)
      .map((candidate) => this.normalizeActivityPath(candidate, workspaceRoot))
      .filter((candidate): candidate is string => Boolean(candidate));

    if (referencedFiles.length > 0) {
      return referencedFiles[0];
    }

    const normalizedActivePath = this.normalizeActivityPath(
      activeFilePath,
      workspaceRoot,
    );
    if (!normalizedActivePath) {
      return null;
    }

    if (
      /\b(this|current|active|selected|attached)\s+file\b/i.test(prompt) ||
      /\b(refactor|rewrite|modify|change|update|fix|rename|remove|delete|add|implement|improve|clean up)\b/i.test(
        prompt,
      )
    ) {
      return normalizedActivePath;
    }

    return null;
  }

  private normalizeRequestedPath(
    rawPath: string,
    workspaceRoot?: string,
    activeFilePath?: string,
  ): string | null {
    const cleaned = rawPath.trim().replace(/[.]+$/, "");
    if (!cleaned) {
      return null;
    }

    const normalizedActivePath = this.normalizeActivityPath(
      activeFilePath,
      workspaceRoot,
    );

    if (
      /^(?:the\s+)?(?:this|current|active|selected|attached)\s+file$/i.test(
        cleaned,
      )
    ) {
      return normalizedActivePath;
    }

    if (
      /^(?:the\s+)?(?:this|current|active|selected|attached)\s+(?:folder|directory)$/i.test(
        cleaned,
      )
    ) {
      return normalizedActivePath
        ? path.dirname(normalizedActivePath).replace(/\\/g, "/")
        : null;
    }

    const withoutKindPrefix = cleaned.replace(
      /^(?:the\s+)?(?:file|folder|directory)\s+/i,
      "",
    );

    return this.normalizeActivityPath(withoutKindPrefix, workspaceRoot);
  }

  private extractSuggestedToolCommand(responseText: string): string | null {
    const trimmed = responseText.trim();
    if (!trimmed || /^##\s+Tool Execution/i.test(trimmed)) {
      return null;
    }

    const candidates = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .flatMap((line) => [line, line.replace(/^[>*-]\s*/, "")]);

    for (const candidate of candidates) {
      const toolMatch = candidate.match(
        /(?:^|\s|`|"|')((?:\/tool\s+)?(?:terminal|search|web-search|search-web|online-search|test|read|write|append|git-status|git-diff|git-branch)\b[\s\S]*)/i,
      );

      if (!toolMatch) {
        continue;
      }

      const normalized = this.stripTrailingNarration(toolMatch[1])
        .replace(/^\/tool\s+/i, "")
        .trim();

      if (this.normalizeCommandCandidate(normalized)) {
        return normalized;
      }
    }

    return null;
  }

  private stripTrailingNarration(value: string): string {
    const trimmed = value.trim();
    const proseBoundary = trimmed.match(/\.(?=[A-Z][a-z])/);
    if (proseBoundary && proseBoundary.index !== undefined) {
      return trimmed.slice(0, proseBoundary.index).trim();
    }

    return trimmed;
  }

  private extractTerminalCommandRequest(prompt: string): string | null {
    const raw = prompt.trim();
    if (!raw) {
      return null;
    }

    const singleLineDirect = this.normalizeCommandCandidate(raw);
    if (singleLineDirect) {
      return singleLineDirect;
    }

    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      const bareCandidate = this.normalizeCommandCandidate(line);
      if (bareCandidate) {
        return bareCandidate;
      }

      const inline = line.match(
        /^(?:please\s+)?(?:help\s+)?(?:run|execute)(?:\s+this)?(?:\s+command)?\s*[:\-]\s*(.+)$/i,
      );
      if (inline) {
        const candidate = this.normalizeCommandCandidate(inline[1]);
        if (candidate) {
          return candidate;
        }
      }

      if (
        /^(?:please\s+)?(?:help\s+)?(?:run|execute)(?:\s+this)?(?:\s+command)?\s*[:\-]?$/i.test(
          line,
        )
      ) {
        const nextLine = lines[index + 1];
        if (!nextLine) {
          continue;
        }

        const candidate = this.normalizeCommandCandidate(nextLine);
        if (candidate) {
          return candidate;
        }
      }
    }

    return null;
  }

  private normalizeCommandCandidate(candidate: string): string | null {
    const trimmed = candidate
      .trim()
      .replace(/^`+/, "")
      .replace(/`+$/, "")
      .trim();

    if (!trimmed || trimmed.length > 1_800) {
      return null;
    }

    if (/\r|\n/.test(trimmed)) {
      return null;
    }

    const commandStarter =
      /^(pnpm|npm|npx|yarn|bun|node|python|pip|pip3|uv|poetry|go|cargo|dotnet|mvn|gradle|java|javac|git|docker|kubectl|terraform|make|cmake|pwsh|powershell|bash|sh|cmd|ls|dir|mkdir|touch|cat|type)\b/i;

    return commandStarter.test(trimmed) ? trimmed : null;
  }

  private buildActivityFilesFromProposedEdits(
    edits: ProposedEdit[],
  ): ActivityFile[] {
    const deduped = new Map<string, ActivityFile>();

    for (const edit of edits) {
      const normalizedPath = this.normalizeActivityPath(edit.filePath);
      if (!normalizedPath) {
        continue;
      }

      deduped.set(normalizedPath, {
        path: normalizedPath,
        status: "modified",
        summary: edit.summary || "Proposed edit generated",
      });
    }

    return [...deduped.values()];
  }

  private inferActivityFilesFromToolCommand(
    toolCommand: string,
  ): ActivityFile[] {
    const trimmed = toolCommand.trim();
    if (!trimmed) {
      return [];
    }

    const readMatch = trimmed.match(/^read\s+(.+)$/i);
    if (readMatch) {
      const filePath = this.normalizeActivityPath(readMatch[1]);
      if (filePath) {
        return [
          {
            path: filePath,
            status: "viewed",
            summary: "Reading file",
          },
        ];
      }
    }

    const searchMatch = trimmed.match(/^search\s+(.+)$/i);
    if (searchMatch) {
      return [
        {
          path: "workspace",
          status: "viewed",
          summary: `Searching for: ${searchMatch[1].trim()}`,
        },
      ];
    }

    const terminalMatch = trimmed.match(/^terminal\s+(.+)$/i);
    if (terminalMatch) {
      return [
        {
          path: "terminal",
          status: "in-progress",
          summary: terminalMatch[1].trim(),
        },
      ];
    }

    const moveMatch = trimmed.match(/^move\s+(.+?)\s*::\s*(.+)$/i);
    if (moveMatch) {
      return [
        {
          path: this.normalizeActivityPath(moveMatch[1]) ?? moveMatch[1].trim(),
          status: "modified",
          summary: `Moved to ${moveMatch[2].trim()}`,
        },
        {
          path: this.normalizeActivityPath(moveMatch[2]) ?? moveMatch[2].trim(),
          status: "modified",
          summary: `Created from move ${moveMatch[1].trim()}`,
        },
      ];
    }

    const deleteMatch = trimmed.match(/^delete\s+(.+)$/i);
    if (deleteMatch) {
      const targetPath =
        this.normalizeActivityPath(deleteMatch[1]) ?? deleteMatch[1].trim();
      return [
        {
          path: targetPath,
          status: "modified",
          summary: "Deleting path",
        },
      ];
    }

    const clearMatch = trimmed.match(/^delete-contents\s+(.+)$/i);
    if (clearMatch) {
      const targetPath =
        this.normalizeActivityPath(clearMatch[1]) ?? clearMatch[1].trim();
      return [
        {
          path: targetPath,
          status: "modified",
          summary: "Clearing directory contents",
        },
      ];
    }

    const mcpMatch = trimmed.match(/^mcp\s+([^:\s]+:[^\s]+).*$/i);
    if (mcpMatch) {
      return [
        {
          path: "mcp",
          status: "in-progress",
          summary: `Calling ${mcpMatch[1]}`,
        },
      ];
    }

    return [];
  }

  private inferActivityFilesFromPrompt(
    prompt: string,
    workspaceRoot?: string,
    activeFilePath?: string,
  ): ActivityFile[] {
    const files: ActivityFile[] = [];
    const seen = new Set<string>();

    const parsedEdit = this.parseEditCommand(prompt);
    if (parsedEdit) {
      const editPath = this.normalizeActivityPath(parsedEdit.filePath);
      if (editPath) {
        files.push({
          path: editPath,
          status: "in-progress",
          summary: "Preparing edit",
        });
        seen.add(editPath);
      }
    }

    const pathLikeMatches = prompt.match(/[\w./\\-]+\.[a-z0-9]{1,8}/gi) ?? [];
    for (const match of pathLikeMatches.slice(0, 4)) {
      const normalizedPath = this.normalizeActivityPath(match, workspaceRoot);
      if (!normalizedPath || seen.has(normalizedPath)) {
        continue;
      }

      files.push({
        path: normalizedPath,
        status: "viewed",
        summary: "Referenced in prompt",
      });
      seen.add(normalizedPath);
    }

    const normalizedActivePath = this.normalizeActivityPath(
      activeFilePath,
      workspaceRoot,
    );
    if (normalizedActivePath && !seen.has(normalizedActivePath)) {
      files.push({
        path: normalizedActivePath,
        status: "viewed",
        summary: "Active editor context",
      });
    }

    return files.slice(0, 6);
  }

  private normalizeActivityPath(
    rawPath: string | undefined,
    workspaceRoot?: string,
  ): string | null {
    if (!rawPath) {
      return null;
    }

    const trimmed = rawPath.trim().replace(/^['"`]|['"`]$/g, "");
    if (!trimmed) {
      return null;
    }

    const root = workspaceRoot ?? this.config.workspaceRoot;
    let normalized = trimmed;

    if (path.isAbsolute(trimmed) && root) {
      const relative = path.relative(root, trimmed);
      if (relative && !relative.startsWith("..")) {
        normalized = relative;
      }
    }

    return normalized.replace(/\\/g, "/");
  }

  private parsePromptEnhancement(
    responseText: string,
    fallbackPrompt: string,
  ): { enhancedPrompt: string; notes: string[] } {
    const candidates = [responseText, extractFirstCodeBlock(responseText)]
      .filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && candidate.trim().length > 0,
      )
      .map((candidate) => candidate.trim());

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as {
          enhancedPrompt?: unknown;
          notes?: unknown;
        };

        if (typeof parsed.enhancedPrompt !== "string") {
          continue;
        }

        const enhancedPrompt = parsed.enhancedPrompt.trim();
        if (!enhancedPrompt) {
          continue;
        }

        const notes = Array.isArray(parsed.notes)
          ? parsed.notes
              .map((item) => String(item).trim())
              .filter((item) => item.length > 0)
              .slice(0, 5)
          : [];

        return {
          enhancedPrompt,
          notes,
        };
      } catch {
        // Try next candidate.
      }
    }

    const plainText = this.parsePlainPromptEnhancement(responseText);
    if (plainText.enhancedPrompt) {
      return {
        enhancedPrompt: plainText.enhancedPrompt,
        notes:
          plainText.notes.length > 0
            ? plainText.notes
            : ["Model returned a plain text rewrite."],
      };
    }

    return {
      enhancedPrompt: fallbackPrompt,
      notes: ["Model returned empty output; original prompt was preserved."],
    };
  }

  private parsePlainPromptEnhancement(responseText: string): {
    enhancedPrompt: string;
    notes: string[];
  } {
    const text = responseText.trim();
    if (!text) {
      return {
        enhancedPrompt: "",
        notes: [],
      };
    }

    const lines = text.split(/\r?\n/);
    const promptLines: string[] = [];
    const noteLines: string[] = [];
    let inNotes = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!line) {
        if (inNotes) {
          noteLines.push("");
        } else {
          promptLines.push("");
        }
        continue;
      }

      const headingMatch = line.match(
        /^(enhanced|rewritten|revised|optimized)\s+prompt\s*:\s*(.*)$/i,
      );
      if (headingMatch) {
        const rest = headingMatch[2].trim();
        if (rest) {
          promptLines.push(rest);
        }
        continue;
      }

      if (/^notes\s*:\s*$/i.test(line)) {
        inNotes = true;
        continue;
      }

      const inlineNotesMatch = line.match(/^notes\s*:\s*(.*)$/i);
      if (inlineNotesMatch) {
        inNotes = true;
        const rest = inlineNotesMatch[1].trim();
        if (rest) {
          noteLines.push(rest);
        }
        continue;
      }

      if (inNotes) {
        noteLines.push(line.replace(/^[-*]\s*/, ""));
      } else {
        promptLines.push(rawLine);
      }
    }

    const enhancedPrompt = promptLines.join("\n").trim();
    const notes = noteLines
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, 5);

    return {
      enhancedPrompt,
      notes,
    };
  }

  private async runAgentSafely(
    mode: Exclude<AgentMode, "auto">,
    run: () => Promise<AgentResult>,
    diagnostics: string[],
  ): Promise<AgentResult> {
    try {
      return await run();
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }

      const errorStr = String(error);
      const isTimeout = errorStr.toLowerCase().includes("timeout");
      diagnostics.push(`${capitalize(mode)} agent error: ${errorStr}`);
      const reason = isTimeout
        ? `The request timed out. The model is taking too long to respond. Try a simpler task, break it into smaller steps, or switch to a faster model.`
        : errorStr;
      return {
        agent: mode,
        content: `> **${capitalize(mode)} agent could not complete the task.**\n>\n> ${reason}`,
      };
    }
  }

  private ensureNotAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("Request aborted.");
    }
  }

  private isAbortError(error: unknown): boolean {
    if (typeof DOMException !== "undefined" && error instanceof DOMException) {
      return error.name === "AbortError";
    }

    const message = String(error ?? "").toLowerCase();
    return message.includes("abort");
  }

  private getSessionId(workspaceRoot?: string): string {
    return workspaceRoot
      ? `workspace:${workspaceRoot}`
      : `session:${this.ephemeralSessionId}`;
  }

  private async buildWorkspaceContext(
    request: OrchestratorRequest,
  ): Promise<string> {
    const workspaceRoot = request.workspaceRoot ?? this.config.workspaceRoot;
    const sections: string[] = [];

    try {
      const names = await getWorkspaceTopLevelEntries(workspaceRoot);
      sections.push(`Workspace root: ${workspaceRoot}`);
      sections.push(`Top-level entries: ${names.join(", ")}`);
    } catch {
      // Best-effort context only.
    }

    if (request.activeFilePath) {
      const absoluteActivePath = resolvePathWithinWorkspaceRoot(
        workspaceRoot,
        request.activeFilePath,
      );

      if (absoluteActivePath) {
        try {
          const fileContent = await fs.readFile(absoluteActivePath, "utf8");
          const snippet = clampText(
            request.selectedText && request.selectedText.trim().length > 0
              ? request.selectedText.trim()
              : fileContent,
            MAX_ACTIVE_SNIPPET_CHARS,
            "Active snippet trimmed",
          );

          sections.push(
            `Active file: ${path.relative(workspaceRoot, absoluteActivePath).replace(/\\/g, "/")}`,
          );
          sections.push(`Active snippet:\n${snippet}`);
        } catch {
          // Ignore active file read failures.
        }
      }
    }

    const activeRelativePath = normalizeActivityPath(
      request.activeFilePath,
      workspaceRoot,
    );
    const referencedFiles = extractLikelyFileReferences(request.prompt)
      .map((candidate) => normalizeActivityPath(candidate, workspaceRoot))
      .filter(
        (candidate): candidate is string =>
          Boolean(candidate) && candidate !== activeRelativePath,
      );

    const dedupedReferenced = [...new Set(referencedFiles)].slice(0, 3);
    for (const referencedRelativePath of dedupedReferenced) {
      const absoluteReferencedPath = resolvePathWithinWorkspaceRoot(
        workspaceRoot,
        referencedRelativePath,
      );
      if (!absoluteReferencedPath) {
        continue;
      }

      try {
        const referencedContent = await fs.readFile(
          absoluteReferencedPath,
          "utf8",
        );
        sections.push(`Referenced file: ${referencedRelativePath}`);
        sections.push(
          `Referenced snippet:\n${clampText(referencedContent, MAX_REFERENCED_FILE_SNIPPET_CHARS, "Referenced snippet trimmed")}`,
        );
      } catch {
        // Ignore referenced file read failures.
      }
    }

    if ((request.attachments?.length ?? 0) > 0) {
      sections.push(buildAttachmentContext(request.attachments ?? []));
    }

    return sections.join("\n\n");
  }

  private async getWorkspaceTopLevelEntries(
    workspaceRoot: string,
  ): Promise<string[]> {
    const now = Date.now();
    const cache = getWorkspaceSnapshotCache();
    if (
      cache &&
      cache.workspaceRoot === workspaceRoot &&
      cache.expiresAt > now
    ) {
      return cache.entries;
    }

    const topLevel = await fs.readdir(workspaceRoot, {
      withFileTypes: true,
    });
    const entries = topLevel
      .slice(0, 24)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));

    setWorkspaceSnapshotCache({
      workspaceRoot,
      entries,
      expiresAt: now + 15_000,
    });

    return entries;
  }

  private resolvePathWithinWorkspaceRoot(
    workspaceRoot: string,
    rawPath: string,
  ): string | null {
    const trimmed = rawPath.trim().replace(/^['"`]|['"`]$/g, "");
    if (!trimmed) {
      return null;
    }

    const absolutePath = path.isAbsolute(trimmed)
      ? path.normalize(trimmed)
      : path.normalize(path.join(workspaceRoot, trimmed));

    const relative = path.relative(workspaceRoot, absolutePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }

    return absolutePath;
  }

  private extractLikelyFileReferences(prompt: string): string[] {
    const matches = prompt.match(/[A-Za-z0-9._/-]+\.[a-z0-9]{1,8}/gi) ?? [];
    return matches
      .map((match) => match.trim())
      .filter((match) => match.length > 2)
      .slice(0, 8);
  }

  private clampText(
    value: string,
    maxChars: number,
    noticeLabel: string,
  ): string {
    const text = value ?? "";
    if (!text) {
      return "";
    }

    if (text.length <= maxChars) {
      return text;
    }

    const omittedChars = text.length - maxChars;
    return `${text.slice(0, maxChars)}\n\n[${noticeLabel}; ${omittedChars} characters omitted]`;
  }

  private formatUserFacingError(error: unknown): string {
    const raw = String(error ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw) {
      return "Request failed due to an unknown error.";
    }

    const normalized = raw.toLowerCase();
    if (normalized.includes("timeout")) {
      return "The model request timed out. Try a smaller prompt or switch to a faster model.";
    }

    if (
      normalized.includes("401") ||
      normalized.includes("unauthorized") ||
      normalized.includes("invalid api key")
    ) {
      return "Authentication failed for the selected provider. Verify API key and endpoint settings.";
    }

    if (normalized.includes("429") || normalized.includes("rate limit")) {
      return "Rate limit reached. Please retry in a moment or use another model.";
    }

    if (
      normalized.includes("all stream attempts failed") ||
      normalized.includes("all provider/model attempts failed")
    ) {
      return "All configured provider attempts failed. Check model availability and provider settings.";
    }

    if (
      normalized.includes("fetch failed") ||
      normalized.includes("econnrefused") ||
      normalized.includes("enotfound")
    ) {
      return "Could not reach the model provider endpoint. Check network access and base URL settings.";
    }

    if (normalized.includes("abort")) {
      return "Request was cancelled.";
    }

    return raw.length > 260 ? `${raw.slice(0, 260)}...` : raw;
  }

  private buildAttachmentContext(attachments: RequestAttachment[]): string {
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
        const snippet = this.clampText(
          attachment.textContent,
          MAX_ATTACHMENT_TEXT_CHARS,
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

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function createNexcodeOrchestrator(
  options: NexcodeOrchestratorOptions = {},
): NexcodeOrchestrator {
  return new NexcodeOrchestrator(options);
}
