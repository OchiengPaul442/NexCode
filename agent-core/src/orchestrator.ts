import fs from "fs/promises";
import { randomUUID } from "crypto";
import { createRuntimeConfig, getTemperatureForMode, getModelForMode, type RuntimeConfig, type AgentModels } from "./config";

import { CoderAgent } from "./agents/coderAgent";
import { PlannerAgent } from "./agents/plannerAgent";
import { QaAgent } from "./agents/qaAgent";
import { ReviewerAgent } from "./agents/reviewerAgent";
import { SecurityAgent } from "./agents/securityAgent";
import {
  type ActivityFile,
  type ActivityStatus,
  type ActivityTodo,
  type AgentMode,
  type ChatMessage,
  type OrchestratorEvent,
  type OrchestratorRequest,
  type OrchestratorResponse,
  type ProviderId,
  type ProposedEdit,
  type ReasoningEffort,
  type ToolResult,
} from "./types";
import { type McpAdapter, type McpToolCall, type McpToolResult } from "./mcp";
import { McpRegistry } from "./mcp/mcpRegistry";
import { FilesystemAdapter } from "./mcp/adapters/filesystemAdapter";
import { MemoryManager } from "./memory/memoryManager";
import { PromptStore } from "./prompts/promptStore";
import { FeedbackLogger } from "./self-improve/feedbackLogger";
import { PromptVersionManager } from "./self-improve/promptVersionManager";
import { ReflectionEngine } from "./self-improve/reflectionEngine";
import { ModelRouter, detectModelCapabilities } from "./providers/modelRouter";
import { OllamaProvider } from "./providers/ollamaProvider";
import { OpenAICompatibleProvider } from "./providers/openAICompatibleProvider";
import { ToolRegistry } from "./tools/toolRegistry";
import { type ApprovalCallback, DefaultToolApprovalPolicy } from "./tools/toolApprovalPolicy";
import { TokenCounter } from "./utils/tokenCounter";
import { getModelCapabilityRegistry } from "./utils/modelCapabilityRegistry";
import { chunkText, extractFirstCodeBlock } from "./utils/text";
import { EfficiencyTracker } from "./utils/efficiencyMetrics";
import {
  buildGroundingNoteForMode,
  getAgentMaxTokens,
  normalizeAgentOutputForMode,
} from "./agents/shared";
import {
  buildWorkspaceContext as buildWorkspaceContextImpl,
  clampText,
} from "./orchestrator/contextBuilder";
import {
  inferNaturalLanguageEditRequest,
  extractToolCommandRequest as extractToolCommandRequestFn,
  extractWorkspaceStatsRequest as extractWorkspaceStatsRequestFn,
} from "./orchestrator/intentParser";
import {
  resolveAutoStrategy as resolveAutoStrategyFn,
  describePipelineStage as describePipelineStageFn,
  formatPipelineStage as formatPipelineStageFn,
  type AutoRoutingStrategy,
} from "./orchestrator/autoRouter";
import {
  buildActivityFilesFromProposedEdits as buildActivityFilesFromProposedEditsFn,
  inferActivityFilesFromToolCommand as inferActivityFilesFromToolCommandFn,
  inferActivityFilesFromPrompt as inferActivityFilesFromPromptFn,
  parseEditCommand as parseEditCommandFn,
} from "./orchestrator/activityFileBuilder";
import { formatUserFacingError as formatUserFacingErrorFn } from "./orchestrator/errorMapper";
import { parsePromptEnhancement as parsePromptEnhancementFn } from "./orchestrator/promptEnhancer";
import {
  isAbortError as isAbortErrorFn,
  ensureNotAborted as ensureNotAbortedFn,
  cleanupSubagentFiles as cleanupSubagentFilesFn,
  runAgentSafely as runAgentSafelyFn,
  isAppendStyleEdit as isAppendStyleEditFn,
  extractRequestedAppendText as extractRequestedAppendTextFn,
} from "./orchestrator/orchestratorHelpers";
import { ContextCompressor } from "./utils/contextCompressor";
import { SessionCompressor } from "./utils/sessionCompressor";
import { runAgentLoop, type AgentLoopConfig } from "./agents/agentLoop";
import { getToolDefinitionsForMode } from "./tools/toolDefinitions";
import { validateEditPreconditions } from "./utils/editValidation";
import { atomicWriteFile } from "./tools/fileSystemTool";
import { HookRegistry } from "./hooks/hookRegistry";
import { GitMcpAdapter } from "./mcp/adapters/gitAdapter";
import { SearchMcpAdapter } from "./mcp/adapters/searchAdapter";
import { PathScopedRuleManager } from "./rules/pathScopedRules";

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
  searchProvider?: string;
  searchApiKey?: string;
  searchBaseUrl?: string;
  tavilyApiKey?: string;
  tavilyBaseUrl?: string;
  approvalCallback?: ApprovalCallback;
  modeTemperatures?: Partial<Record<AgentMode, number>>;
  agentModels?: AgentModels;
  steeringProvider?: () => string | undefined;
  /** Whether workspace prompt files are allowed to override built-in defaults. */
  allowWorkspacePrompts?: boolean;
}



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

const MAX_WORKSPACE_CONTEXT_CHARS = 12_000;
const MAX_MEMORY_CONTEXT_CHARS = 4_000;
const MAX_SESSION_CONTEXT_CHARS = 3_000;
const MAX_TOOL_OUTPUT_CHARS = 16_000;

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
  private providerCheckPromise: Promise<Record<string, { ok: boolean; error?: string; models?: string[] }>> | null = null;
  private readonly mcpRegistry: McpRegistry;
  private readonly compressor = new ContextCompressor(8000);
  private readonly sessionCompressor = new SessionCompressor();
  private readonly ephemeralSessionId = randomUUID();
  private readonly approvalCallback?: ApprovalCallback;
  private readonly steeringProvider?: () => string | undefined;
  private readonly tokenCounter = new TokenCounter();
  private readonly efficiencyTracker = new EfficiencyTracker();
  private readonly hooks = new HookRegistry();
  private readonly pathScopedRules: PathScopedRuleManager | null;

  public constructor(options: NexcodeOrchestratorOptions = {}) {
    this.approvalCallback = options.approvalCallback;
    this.steeringProvider = options.steeringProvider;
    this.config = createRuntimeConfig({
      workspaceRoot: options.workspaceRoot,
      promptsDir: options.promptsDir,
      memoryDir: options.memoryDir,
      providerDefaults: {
        provider: options.defaultProvider ?? "ollama",
        model: options.defaultModel ?? "gpt-oss:120b-cloud",
        ollamaBaseUrl: options.ollamaBaseUrl ?? "http://localhost:11434",
        openAIBaseUrl: (options.openAIBaseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
        openAIApiKey: options.openAIApiKey ?? process.env.OPENAI_API_KEY,
      },
      toolDefaults: {
        searchProvider: options.searchProvider,
        searchApiKey: options.searchApiKey,
        searchBaseUrl: options.searchBaseUrl,
        tavilyApiKey: options.tavilyApiKey ?? process.env.TAVILY_API_KEY,
        tavilyBaseUrl: options.tavilyBaseUrl ?? "https://api.tavily.com/search",
      },
      modeTemperatures: options.modeTemperatures,
      agentModels: options.agentModels,
    });

    this.router = new ModelRouter(
      {
        ollama: new OllamaProvider(this.config.providerDefaults.ollamaBaseUrl),
        "openai-compatible": new OpenAICompatibleProvider(
          this.config.providerDefaults.openAIBaseUrl,
          this.config.providerDefaults.openAIApiKey,
          "openai-compatible",
        ),
        huggingface: new OpenAICompatibleProvider(
          "https://router.huggingface.co/v1",
          this.config.providerDefaults.openAIApiKey,
          "huggingface",
        ),
        openrouter: new OpenAICompatibleProvider(
          "https://openrouter.ai/api/v1",
          this.config.providerDefaults.openAIApiKey,
          "openrouter",
        ),
        together: new OpenAICompatibleProvider(
          "https://api.together.ai/v1",
          this.config.providerDefaults.openAIApiKey,
          "together",
        ),
        fireworks: new OpenAICompatibleProvider(
          "https://api.fireworks.ai/inference/v1",
          this.config.providerDefaults.openAIApiKey,
          "fireworks",
        ),
        groq: new OpenAICompatibleProvider(
          "https://api.groq.com/openai/v1",
          this.config.providerDefaults.openAIApiKey,
          "groq",
        ),
        nvidia: new OpenAICompatibleProvider(
          "https://integrate.api.nvidia.com/v1",
          this.config.providerDefaults.openAIApiKey,
          "nvidia",
        ),
        baseten: new OpenAICompatibleProvider(
          "https://inference.baseten.co/v1",
          this.config.providerDefaults.openAIApiKey,
          "baseten",
        ),
      },
      {
        defaultProvider: this.config.providerDefaults.provider,
        defaultModel: this.config.providerDefaults.model,
        defaultCloudModel: options.defaultCloudModel ?? "deepseek-v4-pro",
      },
    );

    this.prompts = new PromptStore({
      promptsDir: this.config.promptsDir,
      allowWorkspacePrompts: this.config.allowWorkspacePrompts,
    });
    this.memory = new MemoryManager(this.config.memoryDir);
    this.mcpRegistry = new McpRegistry();
    // Register the built-in filesystem adapter so MCP is not silently empty.
    // NOTE: This is an in-process adapter registry, not a real MCP protocol client.
    // Full MCP support requires the official @modelcontextprotocol/sdk.
    this.mcpRegistry.register(new FilesystemAdapter(this.config.workspaceRoot));
    
    // Register Git and Search MCP adapters
    this.tools = new ToolRegistry(this.config.workspaceRoot, {
      searchProvider: this.config.toolDefaults.searchProvider,
      searchApiKey: this.config.toolDefaults.searchApiKey,
      searchBaseUrl: this.config.toolDefaults.searchBaseUrl,
      tavilyApiKey: this.config.toolDefaults.tavilyApiKey,
      tavilyBaseUrl: this.config.toolDefaults.tavilyBaseUrl,
      mcpRegistry: this.mcpRegistry,
      approvalPolicy: new DefaultToolApprovalPolicy(),
    });
    
    // Register MCP adapters for Git and Search
    this.mcpRegistry.register(new GitMcpAdapter(this.tools.git));
    this.mcpRegistry.register(new SearchMcpAdapter(this.tools.search));
    
    // Initialize path-scoped rules if workspace root is available
    this.pathScopedRules = this.config.workspaceRoot
      ? new PathScopedRuleManager(this.config.workspaceRoot)
      : null;

    this.planner = new PlannerAgent(this.router, this.prompts);
    this.coder = new CoderAgent(this.router, this.prompts);
    this.reviewer = new ReviewerAgent(this.router, this.prompts);
    this.qa = new QaAgent(this.router, this.prompts);
    this.security = new SecurityAgent(this.router, this.prompts);

    this.feedbackLogger = new FeedbackLogger(this.config.memoryDir);
    this.reflection = new ReflectionEngine();
    this.promptVersions = new PromptVersionManager(this.config.memoryDir);
  }

  /**
   * Performs async initialization that must complete before the orchestrator
   * can be used. This includes loading persisted memory sessions from disk.
   *
   * Call this after construction and before using the orchestrator.
   * The orchestrator is safe to construct without calling initialize(),
   * but memory context will not be available until initialization completes.
   */
  public async initialize(): Promise<void> {
    try {
      await this.memory.initialize();
    } catch (err) {
      console.error("[nexcode] Memory initialization failed:", err);
    }
    
    // Initialize path-scoped rules
    if (this.pathScopedRules) {
      try {
        await this.pathScopedRules.load();
      } catch (err) {
        console.error("[nexcode] Path-scoped rules initialization failed:", err);
      }
    }
  }

  /**
   * Register a hook for tool execution.
   */
  public registerHook(hook: import("./hooks/hookRegistry").Hook): void {
    this.hooks.register(hook);
  }

  /**
   * Unregister a hook by name.
   */
  public unregisterHook(name: string): void {
    this.hooks.unregister(name);
  }

  /**
   * Get the MCP registry for registering additional adapters.
   */
  public getMcpRegistry(): McpRegistry {
    return this.mcpRegistry;
  }

  /**
   * Flushes pending persistence operations and releases resources.
   * Call this when the orchestrator is no longer needed (e.g., on
   * workspace close or deactivation).
   */
  public async dispose(): Promise<boolean> {
    const results = await Promise.all([
      this.memory.dispose(),
      this.feedbackLogger.dispose(),
    ]);
    return results.every(Boolean);
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

  public getToolApprovalPolicy() {
    return this.tools.getApprovalPolicy();
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
      this.buildWorkspaceContext(contextRequest).catch(
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

    const parsed = parsePromptEnhancementFn(response.text, originalPrompt);

    return {
      enhancedPrompt: parsed.enhancedPrompt,
      notes: parsed.notes,
      providerUsed: resolved.provider.id,
      modelUsed: resolved.model,
    };
  }

  private isSimpleQuestion(prompt: string): boolean {
    const lower = prompt.toLowerCase().trim();

    // Slash commands are never simple questions
    if (lower.startsWith("/")) return false;

    const actionVerbs = /\b(read|write|create|delete|edit|search|run|execute|test|build|install|fix|refactor|check|grep|find|git|npm|npx|node|python|pip|cargo|go|deploy|implement|debug|configure|setup|generate)\b/;
    if (actionVerbs.test(lower)) {
      return false;
    }

    if (lower.length < 30) return true;

    if (/^(hi|hello|hey|yo|sup|thanks|thank you|yes|no|ok|sure|please|help)\s*$/i.test(lower)) {
      return true;
    }

    // Catch conversational/opinion questions
    if (/\?/.test(lower) || /\b(can you|are you|do you|what is|what are|how do|how does|why|explain|tell me|describe)\b/.test(lower)) {
      return true;
    }

    return false;
  }

  public async getProviderStatus(): Promise<Record<string, { ok: boolean; error?: string; models?: string[] }>> {
    if (!this.providerCheckPromise) {
      this.providerCheckPromise = this.router.checkProviders().catch((err) => {
        console.error("[nexcode] Provider check failed:", err);
        return {};
      });
    }
    return this.providerCheckPromise;
  }

  public async *stream(
    request: OrchestratorRequest,
  ): AsyncGenerator<OrchestratorEvent> {
    this.tokenCounter.startNewTurn();
    const mode = request.mode ?? "auto";
    const provider = request.provider ?? this.config.providerDefaults.provider;
    const model = request.model ?? getModelForMode(mode, this.config.agentModels, this.config.providerDefaults.model);

    // NC-041: Set model-specific chars-per-token ratio from the capability registry
    const registry = getModelCapabilityRegistry();
    const modelCharsPerToken = registry.getCharsPerToken(provider, model);
    if (modelCharsPerToken != null) {
      this.tokenCounter.setCharsPerToken(modelCharsPerToken);
    }
    const temperature =
      typeof request.temperature === "number"
        ? Math.min(2, Math.max(0, request.temperature))
        : getTemperatureForMode(mode, this.config.modeTemperatures);
    const sessionId = this.getSessionId(request.workspaceRoot);
    const diagnostics: string[] = [];
    let streamedAnyToken = false;
    let latestActivityFiles: ActivityFile[] = [];
    let executedToolCommand: string | null = null;

    this.memory.appendSessionMessage(sessionId, {
      role: "user",
      content: request.prompt,
      attachmentFileNames: request.attachments?.map((a) => a.fileName),
    });

    yield {
      type: "status",
      message: `Using ${model} on ${provider} (${mode} mode)`,
    };

    yield {
      type: "status",
      message: "Collecting workspace and memory context",
    };

    try {
      ensureNotAbortedFn(request.abortSignal);
      const rawSessionMessages = this.memory.getSessionMessages(sessionId);
      const compressedSessionMessages = this.sessionCompressor.compressSession(
        rawSessionMessages.map((m) => ({ role: m.role, text: m.content })),
      );
      const compressedSessionContext = compressedSessionMessages
        .map((m) => {
          const prefix = m.role === "user" ? "User" : "Assistant";
          return `${prefix}: ${m.text}`;
        })
        .join("\n");

      let sessionContextRaw = compressedSessionContext ||
        this.memory.getSessionContext(sessionId, MAX_SESSION_CONTEXT_CHARS);

      const previousAttachmentNames: string[] = [];
      for (const msg of rawSessionMessages) {
        if (msg.role === "user" && msg.attachmentFileNames?.length) {
          for (const name of msg.attachmentFileNames) {
            if (!previousAttachmentNames.includes(name)) {
              previousAttachmentNames.push(name);
            }
          }
        }
      }

      const [memoryContextRaw, workspaceContextRaw] = await Promise.all([
        this.memory.getRelevantContext(request.prompt).catch(() => ""),
        this.buildWorkspaceContext(request).catch(
          () => "",
        ),
      ]);
      ensureNotAbortedFn(request.abortSignal);

      const memoryContext = clampText(
        memoryContextRaw,
        MAX_MEMORY_CONTEXT_CHARS,
        "Memory context trimmed",
      );
      const workspaceContext = clampText(
        this.compressor.compressContext(workspaceContextRaw),
        MAX_WORKSPACE_CONTEXT_CHARS,
        "Workspace context trimmed",
      );
      let sessionContext = clampText(
        sessionContextRaw,
        MAX_SESSION_CONTEXT_CHARS,
        "Session context trimmed",
      );

      if (previousAttachmentNames.length > 0) {
        const currentAttachmentNames = request.attachments?.map((a) => a.fileName) ?? [];
        const allAttachmentNames = [
          ...new Set([...previousAttachmentNames, ...currentAttachmentNames]),
        ];
        const attachmentContext = `Previously attached files: ${allAttachmentNames.join(", ")}`;
        sessionContext = sessionContext
          ? `${sessionContext}\n\n${attachmentContext}`
          : attachmentContext;
      }

      const toolDefs = getToolDefinitionsForMode(
        (mode === "auto" ? "coder" : mode),
      );
      const modelContextWindow = detectModelCapabilities(model, provider).contextWindow;
      const inputBudget = this.tokenCounter.calculateInputBudget(modelContextWindow);
      const contextTokenEstimate = this.tokenCounter.estimateRequestTokens(
        [
          { role: "system", content: JSON.stringify({ prompt: request.prompt, sessionContext, workspaceContext, memoryContext }) },
        ],
        toolDefs,
      );
      const compressionThreshold = inputBudget;
      if (contextTokenEstimate > compressionThreshold) {
        diagnostics.push(
          `[context-budget] approaching limit: estimated ${contextTokenEstimate} tokens, budget ${compressionThreshold} tokens, model context ${modelContextWindow} tokens`,
        );
        // Session was already compressed above. If still over budget,
        // further reduce session context by taking only the most recent messages.
        const sessionParts = sessionContextRaw.split("\n");
        const keepCount = Math.max(4, Math.floor(sessionParts.length * 0.5));
        sessionContextRaw = sessionParts.slice(-keepCount).join("\n");
        sessionContext = clampText(
          sessionContextRaw,
          MAX_SESSION_CONTEXT_CHARS,
          "Session context trimmed",
        );
      }

      yield {
        type: "status",
        message: "Context ready",
      };


      if (this.isSimpleQuestion(request.prompt)) {
        const contextParts: string[] = [];
        if (workspaceContext) {
          contextParts.push(`Workspace context:\n${workspaceContext}`);
        }
        contextParts.push(request.prompt);

        const messages: ChatMessage[] = [
          { role: "system", content: await this.prompts.getPrompt("coder") },
          { role: "user", content: contextParts.join("\n\n") },
        ];
        const response = await this.router.generate(messages, { maxTokens: 2048 });

        for (const token of chunkText(response.text, 32)) {
          yield { type: "token", token };
        }

        const finalResponse: OrchestratorResponse = {
          text: response.text,
          modeUsed: mode,
          providerUsed: provider,
          modelUsed: model,
          proposedEdits: [],
          diagnostics,
        };

        this.memory.appendSessionMessage(sessionId, {
          role: "assistant",
          content: response.text,
        });


        yield { type: "final", response: finalResponse };
        return;
      }

      const inferredToolCommand =
        request.allowTools !== false
          ? extractToolCommandRequestFn(
              request.prompt,
              request.workspaceRoot ?? this.config.workspaceRoot,
              request.activeFilePath,
            )
          : null;
      const inferredEditRequest = inferNaturalLanguageEditRequest(
        request.prompt,
        request.workspaceRoot ?? this.config.workspaceRoot,
        request.activeFilePath,
      );
      const workspaceStatsCommand =
        request.allowTools !== false
          ? extractWorkspaceStatsRequestFn(request.prompt)
          : null;

      let response: OrchestratorResponse | null = null;
      if (
        request.prompt.trimStart().startsWith("/tool ") &&
        request.allowTools !== false
      ) {
        const toolCommand = request.prompt.replace(/^\s*\/tool\s+/, "").trim();
        executedToolCommand = toolCommand;
        const toolFiles = inferActivityFilesFromToolCommandFn(toolCommand, this.config.workspaceRoot);
        latestActivityFiles = toolFiles;

        yield {
          type: "status",
          message: toolCommand.startsWith("terminal ")
            ? `Running terminal command: ${toolCommand.slice("terminal ".length)}`
            : `Running tool command: ${toolCommand}`,
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

      } else if (inferredToolCommand) {
        const inferredPrompt = `/tool ${inferredToolCommand}`;
        executedToolCommand = inferredToolCommand;
        const inferredStatus = inferredToolCommand.startsWith("terminal ")
          ? `Running terminal command: ${inferredToolCommand.slice("terminal ".length)}`
          : `Running inferred tool command: ${inferredToolCommand}`;
        const inferredFiles =
          inferActivityFilesFromToolCommandFn(inferredToolCommand, this.config.workspaceRoot);
        latestActivityFiles = inferredFiles;

        yield {
          type: "status",
          message: inferredStatus,
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

        // Emit toolExecuted for non-dangerous inferred tool commands
        const toolName = inferredToolCommand.split(/\s+/)[0] || "unknown";
        const isDangerous = /rm\s+-rf|format\s+[a-z]:|del\s+\/[qs]|Remove-Item\s+-Recurse/i.test(inferredToolCommand);
        if (!isDangerous && response) {
          yield {
            type: "toolExecuted",
            toolName,
            command: inferredToolCommand,
            status: response.diagnostics.length > 0 ? "error" : "success",
            message: response.text.substring(0, 200),
          };
        }

      } else if (workspaceStatsCommand) {
        executedToolCommand = workspaceStatsCommand;
        latestActivityFiles = [
          { path: "workspace", status: "viewed", summary: "Collecting workspace stats" },
        ];

        yield {
          type: "status",
          message: "Collecting workspace statistics...",
        };

        const result = await this.tools.runToolCall(workspaceStatsCommand, request.abortSignal);
        const boundedOutput = clampText(
          result.output,
          MAX_TOOL_OUTPUT_CHARS,
          "Tool output truncated",
        );

        if (!result.ok) {
          diagnostics.push(boundedOutput);
        }

        const finalText = `## Workspace Statistics\n\n\`\`\`\n${boundedOutput}\n\`\`\``;

        for (const token of chunkText(finalText, 32)) {
          yield { type: "token", token };
        }

        response = {
          text: finalText,
          modeUsed: mode,
          providerUsed: provider,
          modelUsed: model,
          proposedEdits: [],
          diagnostics,
        };

        this.memory.appendSessionMessage(sessionId, {
          role: "assistant",
          content: finalText,
        });

        yield { type: "final", response };
        return;

      } else if (request.prompt.trimStart().startsWith("/edit ")) {
        const parsedEdit = parseEditCommandFn(request.prompt);
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


        response = await this.handleEditRequest(
          request.prompt,
          mode,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          sessionContext,
          diagnostics,
          request.abortSignal,
        );

        latestActivityFiles =
          response.proposedEdits.length > 0
            ? buildActivityFilesFromProposedEditsFn(response.proposedEdits, this.config.workspaceRoot)
            : editFiles.map((file) => ({ ...file, status: "modified" }));

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


        response = await this.handleEditRequest(
          inferredEditPrompt,
          mode,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          sessionContext,
          diagnostics,
          request.abortSignal,
        );

        latestActivityFiles =
          response.proposedEdits.length > 0
            ? buildActivityFilesFromProposedEditsFn(response.proposedEdits, this.config.workspaceRoot)
            : editFiles.map((file) => ({ ...file, status: "modified" }));

      } else if (mode === "auto") {
        const strategy = resolveAutoStrategyFn(request.prompt);
        if (strategy.kind === "pipeline") {
          yield {
            type: "status",
            message: `Auto routing: multi-agent pipeline (${strategy.pipeline
              .map((stage) => formatPipelineStageFn(stage))
              .join(" → ")})`,
          };


          const iterator = this.runAutoModeStreaming(
            request.prompt,
            provider,
            model,
            temperature,
            workspaceContext,
            memoryContext,
            sessionContext,
            diagnostics,
            strategy.pipeline,
            request.abortSignal,
            request.reasoningEffort,
            request.steeringProvider,
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
              `Auto routing: ${formatPipelineStageFn(strategy.mode)} fast path`,
          };

          const inferredFiles = inferActivityFilesFromPromptFn(
            request.prompt,
            request.workspaceRoot ?? this.config.workspaceRoot,
            request.activeFilePath,
          );
          latestActivityFiles = inferredFiles;

          const iterator = this.runAgentLoopStreaming(
            "auto",
            request.prompt,
            provider,
            model,
            temperature,
            workspaceContext,
            memoryContext,
            sessionContext,
            diagnostics,
            request.abortSignal,
            request.reasoningEffort,
            request.steeringProvider,
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
        const inferredFiles = inferActivityFilesFromPromptFn(
          request.prompt,
          request.workspaceRoot ?? this.config.workspaceRoot,
          request.activeFilePath,
        );
        latestActivityFiles = inferredFiles;

        const iterator = this.runAgentLoopStreaming(
          mode,
          request.prompt,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          sessionContext,
          diagnostics,
          request.abortSignal,
          request.reasoningEffort,
          request.steeringProvider,
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

      ensureNotAbortedFn(request.abortSignal);

      if (!response) {
        throw new Error("No response produced by orchestrator pipeline.");
      }



      response.diagnostics = diagnostics;

      this.tokenCounter.trackRequest(
        request.prompt +
            (response.text ? response.text.slice(0, 200) : ""),
        response.text,
      );
      const stats = this.tokenCounter.getStats();
      const turnStats = this.tokenCounter.getTurnStats();
      response.tokenUsage = {
        input: stats.totalInput,
        output: stats.totalOutput,
        total: stats.total,
      };
      response.turnTokenUsage = {
        input: turnStats.input,
        output: turnStats.output,
        total: turnStats.total,
        requests: turnStats.requests,
      };

      const estimatedTokens = Math.ceil((request.prompt.length + (response.text?.length ?? 0)) / 4);
      this.efficiencyTracker.trackRequest(estimatedTokens);

      if (response.proposedEdits.length > 0) {
        for (let i = 0; i < response.proposedEdits.length; i++) {
          this.efficiencyTracker.trackEdit();
        }
      }

      response.efficiency = this.efficiencyTracker.getMetrics();

      if (!streamedAnyToken && response.proposedEdits.length === 0 && response.text.trim().length > 0) {
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
      ], {
        mode: response.modeUsed,
        provider: response.providerUsed,
        model: response.modelUsed,
        filesEdited: response.proposedEdits.map((e) => e.filePath),
        toolUsed: executedToolCommand ? [executedToolCommand] : [],
        attachmentsUsed: request.attachments?.map((a) => a.fileName),
      });

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
        diagnostics.length,
        diagnostics.some(d => d.toLowerCase().includes("error")),
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

      const responseFiles = buildActivityFilesFromProposedEditsFn(
        response.proposedEdits,
        this.config.workspaceRoot,
      );
      if (responseFiles.length > 0) {
        latestActivityFiles = responseFiles;
      }


      yield {
        type: "final",
        response,
      };
    } catch (error) {
      if (isAbortErrorFn(error)) {

        yield {
          type: "stopped",
          message: "Request stopped by user.",
        };
        return;
      }

      const errorMessage = formatUserFacingErrorFn(error);


      yield {
        type: "error",
        message: errorMessage,
      };
    }
  }

  public async applyProposedEdit(edit: ProposedEdit): Promise<void> {
    const absolutePath = await this.tools.filesystem.resolveWorkspacePathSafe(
      edit.filePath,
    );

    // Check for stale content: read current file and verify it matches edit.oldText.
    let currentContent: string | null = null;
    try {
      currentContent = await fs.readFile(absolutePath, "utf8");
    } catch {
      // File doesn't exist — currentContent stays null
    }

    const precondition = validateEditPreconditions(edit, this.config.workspaceRoot ?? "", currentContent);
    if (!precondition.ok) {
      throw new Error(
        precondition.error ?? "Edit precondition check failed"
      );
    }

    await atomicWriteFile(absolutePath, edit.newText);
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
    sessionContext: string,
    diagnostics: string[],
    abortSignal?: AbortSignal,
    options?: {
      statusLabel?: string;
      todoTitle?: string;
      files?: ActivityFile[];
    },
  ): AsyncGenerator<OrchestratorEvent, OrchestratorResponse> {
    const stageLabel = formatPipelineStageFn(selectedMode);

    yield {
      type: "status",
      message: options?.statusLabel ?? describePipelineStageFn(selectedMode),
    };


    const textChunks: string[] = [];

    try {
      for await (const token of this.streamAgentTokens(
        selectedMode,
        {
          userPrompt: prompt,
          workspaceContext,
          memoryContext,
          sessionContext,
        },
        provider,
        model,
        temperature,
        abortSignal,
      )) {
        ensureNotAbortedFn(abortSignal);
        if (!token) {
          continue;
        }

        textChunks.push(token);
        yield {
          type: "token",
          token,
        };
      }
    } catch (error) {
      if (isAbortErrorFn(error)) {
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
        textChunks.push(token);
        yield {
          type: "token",
          token,
        };
      }
    }

    const joinedText = textChunks.join("");
    const finalText = joinedText.trim().length
      ? normalizeAgentOutputForMode(selectedMode, joinedText.trim(), prompt)
      : `${stageLabel} agent returned an empty response.`;


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
    sessionContext: string,
    diagnostics: string[],
    pipeline: Exclude<AgentMode, "auto">[],
    abortSignal?: AbortSignal,
    reasoningEffort?: ReasoningEffort,
    steeringProvider?: () => string | undefined,
  ): AsyncGenerator<OrchestratorEvent, OrchestratorResponse> {
    const composedChunks: string[] = [];
    let planContent: string | undefined;
    let implementationDraft: string | undefined;
    let reviewerFeedback: string | undefined;
    const MAX_FEEDBACK_ITERATIONS = 2;
    let feedbackIteration = 0;
    const stageTodos: ActivityTodo[] = pipeline.map((stage, index) => ({
      id: `pipeline-${index + 1}-${stage}`,
      title: `${formatPipelineStageFn(stage)} stage`,
      status: index === 0 ? "in-progress" : "not-started",
      detail: index === 0 ? "Active" : "Queued",
    }));

    // Build a mutable pipeline we can extend with feedback iterations
    const effectivePipeline = [...pipeline];
    // Pre-allocate slots for potential feedback iterations (coder + reviewer re-runs)
    // We'll process the pipeline linearly and insert feedback loops after reviewer

    for (let stageIndex = 0; stageIndex < effectivePipeline.length; stageIndex += 1) {
      const stage = effectivePipeline[stageIndex];
      ensureNotAbortedFn(abortSignal);

      const stageLabel = formatPipelineStageFn(stage);
      stageTodos[stageIndex] = {
        ...stageTodos[stageIndex],
        status: "in-progress",
        detail: "Running",
      };

      yield {
        type: "status",
        message: describePipelineStageFn(stage),
      };


      const sectionPrefix = `${composedChunks.length > 0 ? "\n\n" : ""}## ${stageLabel}\n\n`;
      composedChunks.push(sectionPrefix);
      yield {
        type: "token",
        token: sectionPrefix,
      };

      let stageText = "";

      try {
        // Build stage-specific context (only stage additions, no duplication of workspace/memory/session)
        const stageContextParts = [
          planContent && stage !== "planner" ? `Plan:\n${planContent}` : "",
          implementationDraft && stage === "reviewer" ? `Implementation draft:\n${implementationDraft}` : "",
          reviewerFeedback && stage === "coder"
            ? `Reviewer feedback (address these issues):\n${reviewerFeedback}`
            : "",
        ].filter((part) => part.length > 0);

        const stagePrompt = stageContextParts.length > 0
          ? `${prompt}\n\n${stageContextParts.join("\n\n")}`
          : prompt;

        // Use agent loop for each pipeline stage
        const stageFiles: ActivityFile[] = [];
        for await (const event of this.runAgentLoopStreaming(
          stage,
          stagePrompt,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          sessionContext,
          diagnostics,
          abortSignal,
          reasoningEffort,
          steeringProvider,
        )) {
          ensureNotAbortedFn(abortSignal);
          if (event.type === "token") {
            stageText += event.token;
            composedChunks.push(event.token);
            yield event;
          } else if (event.type === "status") {
            yield event;
          } else if (event.type === "toolExecuted") {
            yield event;
            // Track files changed by tool execution
            if (event.filesChanged && event.status === "success") {
              for (const filePath of event.filesChanged) {
                if (filePath && !stageFiles.some(f => f.path === filePath)) {
                  stageFiles.push({
                    path: filePath,
                    status: "modified",
                    summary: `${event.toolName}: ${event.command.slice(0, 80)}`,
                  });
                }
              }
            }
          }
        }
        if (stageFiles.length > 0) {
          yield {
            type: "activity",
            files: stageFiles,
            note: `${stageLabel} modified ${stageFiles.length} file(s)`,
          };
        }
      } catch (error) {
        if (isAbortErrorFn(error)) {
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
          composedChunks.push(token);
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
        composedChunks.push(fallbackText);
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
        // Reset reviewer feedback for next iteration
        reviewerFeedback = undefined;
      }

      // Evaluator-optimizer loop: after reviewer, if issues found, loop back to coder
      if (stage === "reviewer" && feedbackIteration < MAX_FEEDBACK_ITERATIONS) {
        const reviewText = stageText.trim().toLowerCase();
        const hasBlockers = /\b(blocker|critical|must fix|must not|incorrect|wrong|bug|error|security issue|vulnerability)\b/.test(reviewText);
        const hasSuggestions = /\b(suggestion|improve|consider|could|should|recommend)\b/.test(reviewText);

        if (hasBlockers || hasSuggestions) {
          feedbackIteration++;
          reviewerFeedback = stageText.trim();

          yield {
            type: "status",
            message: `Evaluator-optimizer loop: reviewer found issues (iteration ${feedbackIteration}/${MAX_FEEDBACK_ITERATIONS}). Sending feedback to coder.`,
          };

          const feedbackPrefix = `\n\n---\n## Review Feedback (iteration ${feedbackIteration})\n\nThe reviewer identified the following issues. Address them in your revised implementation:\n\n${reviewerFeedback}\n`;
          composedChunks.push(feedbackPrefix);
          yield {
            type: "token",
            token: feedbackPrefix,
          };

          // Insert a coder re-run after the current position
          // We do this by pushing a "coder" stage back into the effective pipeline
          // This will be processed in the next loop iteration
          effectivePipeline.splice(stageIndex + 1, 0, "coder");
          stageTodos.splice(stageIndex + 1, 0, {
            id: `pipeline-feedback-${feedbackIteration}-coder`,
            title: `Coder (feedback iteration ${feedbackIteration})`,
            status: "not-started",
            detail: `Reworking based on review feedback`,
          });
        }
      }

      stageTodos[stageIndex] = {
        ...stageTodos[stageIndex],
        status: "completed",
        detail: feedbackIteration > 0 && stage === "coder" && reviewerFeedback
          ? `Reworked (${feedbackIteration} feedback iteration${feedbackIteration > 1 ? "s" : ""})`
          : "Completed",
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

    }

    if (feedbackIteration > 0) {
      composedChunks.push(`\n\n> Completed after ${feedbackIteration} review feedback iteration${feedbackIteration > 1 ? "s" : ""}.`);
    }

    return {
      text: composedChunks.join("").trim(),
      modeUsed: "auto",
      providerUsed: provider,
      modelUsed: model,
      proposedEdits: [],
      diagnostics,
    };
  }

  private async *runAgentLoopStreaming(
    mode: AgentMode,
    prompt: string,
    provider: ProviderId,
    model: string,
    temperature: number | undefined,
    workspaceContext: string,
    memoryContext: string,
    sessionContext: string,
    diagnostics: string[],
    abortSignal?: AbortSignal,
    reasoningEffort?: ReasoningEffort,
    steeringProvider?: () => string | undefined,
  ): AsyncGenerator<OrchestratorEvent, OrchestratorResponse> {
    const resolvedMode = (mode === "auto" ? "coder" : mode);
    const toolDefs = getToolDefinitionsForMode(resolvedMode);
    const systemPrompt = await this.prompts.getPrompt(resolvedMode);
    const groundingNote = buildGroundingNoteForMode(resolvedMode, prompt);

    const contextParts = [
      `User request:\n${prompt}`,
      groundingNote ? `Grounding note:\n${groundingNote}` : "",
      workspaceContext ? `Workspace context:\n${workspaceContext}` : "",
      memoryContext ? `Memory context:\n${memoryContext}` : "",
      sessionContext ? `Conversation history:\n${sessionContext}` : "",
    ].filter((part) => part.length > 0);

    const loopMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: contextParts.join("\n\n") },
    ];

    const config: AgentLoopConfig = {
      maxTurns: parseInt(process.env.NEXCODE_MAX_TURNS || "30", 10),
      maxTokensPerTurn: parseInt(process.env.NEXCODE_MAX_TOKENS || "4096", 10),
      timeoutMs: parseInt(process.env.NEXCODE_TIMEOUT_MS || "600000", 10),
      hooks: this.hooks,
    };

    yield {
      type: "status",
      message: `Agent loop starting (${resolvedMode} mode, up to ${config.maxTurns} turns)`,
    };

    try {
      for await (const event of runAgentLoop(
        loopMessages,
        this.router,
        this.tools,
        toolDefs,
        config,
        abortSignal,
        this.approvalCallback,
        reasoningEffort,
        steeringProvider ?? this.steeringProvider,
        model,
        provider,
        this.config.workspaceRoot,
      )) {
        yield event;
      }

      const lastMsg = loopMessages[loopMessages.length - 1];
      const responseText = lastMsg?.content ?? "";

      // Cleanup: remove any .agents/ directory files created during the loop
      await cleanupSubagentFilesFn(this.config.workspaceRoot);

      return {
        text: responseText.trim() || "Agent loop completed with no output.",
        modeUsed: resolvedMode,
        providerUsed: provider,
        modelUsed: model,
        proposedEdits: [],
        diagnostics,
      };
    } catch (error) {
      if (isAbortErrorFn(error)) {
        throw error;
      }

      // Cleanup on error too
      await cleanupSubagentFilesFn(this.config.workspaceRoot);

      const errorStr = String(error);
      diagnostics.push(`Agent loop error: ${errorStr}`);
      
      // Provide user-friendly error message
      let userMessage = "I could not complete this request due to an internal error. Please try again or rephrase your request.";
      if (errorStr.includes("malformed JSON") || errorStr.includes("can't find closing") || errorStr.includes("invalid response")) {
        userMessage = `The model "${model}" had trouble processing this request. This can happen when a model doesn't fully support tool calling. Try using a different model or simplifying your request.`;
      } else if (errorStr.includes("Context window overflow") || errorStr.includes("context length")) {
        userMessage = "Your request was too long for the model's context window. Try breaking it into smaller parts or using a model with a larger context window.";
      } else if (errorStr.includes("Provider returned no response") || errorStr.includes("ECONNREFUSED")) {
        userMessage = "Could not reach the model provider. Please check if it's running and accessible, then try again.";
      } else if (errorStr.includes("timeout") || errorStr.includes("timed out")) {
        userMessage = "The request timed out. Try a simpler task or a faster model.";
      } else if (errorStr.includes("401") || errorStr.includes("403") || errorStr.includes("unauthorized")) {
        userMessage = "Authentication failed. Check your API key in settings.";
      } else if (errorStr.includes("429") || errorStr.includes("rate limit")) {
        userMessage = "Rate limit reached. Wait a moment and try again.";
      } else if (errorStr.includes("All") && errorStr.includes("attempt(s) failed")) {
        // Extract the last error from the aggregated error message
        const lastErrMatch = errorStr.match(/:\s*(.+?)$/);
        const lastErr = lastErrMatch ? lastErrMatch[1].trim() : errorStr;
        userMessage = `All model attempts failed. Last error: ${lastErr.slice(0, 200)}`;
      }
      
      return {
        text: userMessage,
        modeUsed: mode,
        providerUsed: provider,
        modelUsed: model,
        proposedEdits: [],
        diagnostics,
      };
    }
  }

  private async *streamAgentTokens(
    mode: Exclude<AgentMode, "auto">,
    input: {
      userPrompt: string;
      workspaceContext: string;
      memoryContext: string;
      sessionContext?: string;
      plan?: string;
      implementationDraft?: string;
      reasoningEffort?: ReasoningEffort;
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
      reasoningEffort: input.reasoningEffort,
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
      sessionContext?: string;
      plan?: string;
      implementationDraft?: string;
    },
  ): Promise<ChatMessage[]> {
    const systemPrompt = await this.prompts.getPrompt(mode);
    const boundedWorkspaceContext = clampText(
      input.workspaceContext ?? "",
      MAX_WORKSPACE_CONTEXT_CHARS,
      "Workspace context trimmed",
    );
    const boundedMemoryContext = clampText(
      input.memoryContext ?? "",
      MAX_MEMORY_CONTEXT_CHARS,
      "Memory context trimmed",
    );
    const boundedSessionContext = clampText(
      input.sessionContext ?? "",
      MAX_SESSION_CONTEXT_CHARS,
      "Session context trimmed",
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
      boundedSessionContext
        ? `Conversation history:\n${boundedSessionContext}`
        : "",
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
    return resolveAutoStrategyFn(prompt);
  }

  private formatPipelineStage(stage: Exclude<AgentMode, "auto">): string {
    return formatPipelineStageFn(stage);
  }

  private describePipelineStage(stage: Exclude<AgentMode, "auto">): string {
    return describePipelineStageFn(stage);
  }

  private async handleToolRequest(
    prompt: string,
    mode: AgentMode,
    provider: ProviderId,
    model: string,
    diagnostics: string[],
    allowWebSearch: boolean,
    abortSignal?: AbortSignal,
  ): Promise<OrchestratorResponse> {
    const toolCommand = prompt.replace(/^\s*\/tool\s+/, "").trim();

    if (
      /^(web-search|search-web|online-search)\b/i.test(toolCommand) &&
      !allowWebSearch
    ) {
      return {
        text: [
          "### Tool Activity",
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

    const result = await this.tools.runToolCall(toolCommand, abortSignal);

    if (result.requiresApproval) {
      const toolName = result.toolName ?? "";
      const pendingArg = result.pendingArg ?? "";

      if (this.approvalCallback) {
        const approved = await this.approvalCallback(toolName, pendingArg);
        if (!approved) {
          return {
            text: [
              "### Tool Activity",
              `Command: ${toolCommand}`,
              "",
              "```text",
              "Command cancelled by user.",
              "```",
            ].join("\n"),
            modeUsed: mode,
            providerUsed: provider,
            modelUsed: model,
            proposedEdits: [],
            diagnostics,
          };
        }
        // Re-run the tool after approval
        this.tools.markApproved(toolName, pendingArg);
        const approvedResult = await this.tools.runToolCall(toolCommand, abortSignal);
        const boundedOutput = clampText(
          approvedResult.output,
          MAX_TOOL_OUTPUT_CHARS,
          "Tool output truncated",
        );
        if (!approvedResult.ok) {
          diagnostics.push(boundedOutput);
        }
        return {
          text: [
            "### Tool Activity",
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

      throw new Error(
        "Tool requires approval but no approvalCallback was provided — this is a wiring bug, not a user decision.",
      );
    }

    const boundedOutput = clampText(
      result.output,
      MAX_TOOL_OUTPUT_CHARS,
      "Tool output truncated",
    );

    if (!result.ok) {
      diagnostics.push(boundedOutput);
    }

    return {
      text: [
        "### Tool Activity",
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
          "### Tool Activity",
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
      const terminalArg = terminalMatch[1].trim();
      if (this.tools.requiresApproval("terminal", terminalArg)) {
        if (this.approvalCallback) {
          const approved = await this.approvalCallback("terminal", terminalArg);
          if (!approved) {
            return {
              text: [
                "### Tool Activity",
                `Command: ${toolCommand}`,
                "",
                "```text",
                "Command cancelled by user.",
                "```",
              ].join("\n"),
              modeUsed: mode,
              providerUsed: provider,
              modelUsed: model,
              proposedEdits: [],
              diagnostics,
            };
          }
          this.tools.markApproved("terminal", terminalArg);
        } else {
          throw new Error(
            "Tool requires approval but no approvalCallback was provided — this is a wiring bug, not a user decision.",
          );
        }
      }
      return yield* this.streamCommandToolResult(
        toolCommand,
        mode,
        provider,
        model,
        diagnostics,
        this.tools.terminal.stream(terminalMatch[1].trim(), 30_000, abortSignal),
        abortSignal,
      );
    }

    const testMatch = toolCommand.match(/^test(?:\s+([\s\S]+))?$/i);
    if (testMatch) {
      const testArg = testMatch[1]?.trim() ?? "";
      if (this.tools.requiresApproval("test", testArg)) {
        if (this.approvalCallback) {
          const approved = await this.approvalCallback("test", testArg);
          if (!approved) {
            return {
              text: [
                "### Tool Activity",
                `Command: ${toolCommand}`,
                "",
                "```text",
                "Command cancelled by user.",
                "```",
              ].join("\n"),
              modeUsed: mode,
              providerUsed: provider,
              modelUsed: model,
              proposedEdits: [],
              diagnostics,
            };
          }
          this.tools.markApproved("test", testArg);
        } else {
          throw new Error(
            "Tool requires approval but no approvalCallback was provided — this is a wiring bug, not a user decision.",
          );
        }
      }
      return yield* this.streamCommandToolResult(
        toolCommand,
        mode,
        provider,
        model,
        diagnostics,
        this.tools.test.stream(testArg),
        abortSignal,
      );
    }

    const batchEditMatch = toolCommand.match(/^batch_edit\s+([\s\S]+)$/i);
    if (batchEditMatch) {
      try {
        const batchArgs = JSON.parse(batchEditMatch[1].trim());
        const editCount = Array.isArray(batchArgs.edits) ? batchArgs.edits.length : 0;
        yield { type: "batchEditStarted", editCount };
      } catch {
        // Parse error handled by tool registry
      }

      if (this.tools.requiresApproval("batch_edit", batchEditMatch[1]?.trim() ?? "")) {
        if (this.approvalCallback) {
          const approved = await this.approvalCallback("batch_edit", batchEditMatch[1]?.trim() ?? "");
          if (!approved) {
            return {
              text: [
                "### Tool Activity",
                `Command: ${toolCommand}`,
                "",
                "```text",
                "Command cancelled by user.",
                "```",
              ].join("\n"),
              modeUsed: mode,
              providerUsed: provider,
              modelUsed: model,
              proposedEdits: [],
              diagnostics,
            };
          }
          this.tools.markApproved("batch_edit", batchEditMatch[1]?.trim() ?? "");
        } else {
          throw new Error(
            "Tool requires approval but no approvalCallback was provided — this is a wiring bug, not a user decision.",
          );
        }
      }

      const result = await this.tools.runToolCall(toolCommand, abortSignal);
      const boundedOutput = clampText(
        result.output,
        MAX_TOOL_OUTPUT_CHARS,
        "Tool output truncated",
      );

      if (!result.ok) {
        diagnostics.push(boundedOutput);
      }

      try {
        const batchArgs = JSON.parse(batchEditMatch[1].trim());
        const editCount = Array.isArray(batchArgs.edits) ? batchArgs.edits.length : 0;
        const successMatch = boundedOutput.match(/(\d+)\/(\d+) succeeded/);
        const successCount = successMatch ? parseInt(successMatch[1], 10) : (result.ok ? editCount : 0);
        yield { type: "batchEditCompleted", editCount, successCount };
      } catch {
        yield { type: "batchEditCompleted", editCount: 0, successCount: 0 };
      }

      return {
        text: [
          "### Tool Activity",
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

    const response = await this.handleToolRequest(
      prompt,
      mode,
      provider,
      model,
      diagnostics,
      allowWebSearch,
      abortSignal,
    );
    
    return response;
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
    let result!: ToolResult;

    while (true) {
      ensureNotAbortedFn(abortSignal);
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
    const boundedOutput = clampText(
      finalResult.output,
      MAX_TOOL_OUTPUT_CHARS,
      "Tool output truncated",
    );

    if (!finalResult.ok) {
      diagnostics.push(boundedOutput);
    }

    return {
      text: [
        "### Tool Activity",
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
    sessionContext: string,
    diagnostics: string[],
    abortSignal?: AbortSignal,
  ): Promise<OrchestratorResponse> {
    const parsed = parseEditCommandFn(prompt);
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

    const generated = await runAgentSafelyFn(
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
          sessionContext,
          signal: abortSignal,
        }),
      diagnostics,
    );

    const extracted = extractFirstCodeBlock(generated.content);
    let newText =
      extracted && extracted.length > 0 ? extracted : generated.content;
    const requestedAppendText = extractRequestedAppendTextFn(
      parsed.instruction,
    );

    if (
      isAppendStyleEditFn(parsed.instruction) &&
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
      isAppendStyleEditFn(parsed.instruction)
    ) {
      newText = `${oldText.trimEnd()}\n${requestedAppendText.trim()}`;
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

  private getSessionId(workspaceRoot?: string): string {
    return workspaceRoot
      ? `workspace:${workspaceRoot}`
      : `session:${this.ephemeralSessionId}`;
  }

  private async buildWorkspaceContext(
    request: OrchestratorRequest,
  ): Promise<string> {
    const modelContextWindow = detectModelCapabilities(
      this.config.providerDefaults.model,
      this.config.providerDefaults.provider,
    ).contextWindow;
    return buildWorkspaceContextImpl(request, this.config.workspaceRoot, modelContextWindow);
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
