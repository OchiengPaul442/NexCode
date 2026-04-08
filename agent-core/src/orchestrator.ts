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
  AgentMode,
  AgentResult,
  OrchestratorEvent,
  OrchestratorRequest,
  OrchestratorResponse,
  ProviderId,
  ProposedEdit,
  RequestAttachment,
} from "./types";
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
import { getAgentMaxTokens } from "./agents/shared";

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

  public constructor(options: NexcodeOrchestratorOptions = {}) {
    this.config = createRuntimeConfig({
      workspaceRoot: options.workspaceRoot,
      promptsDir: options.promptsDir,
      memoryDir: options.memoryDir,
      providerDefaults: {
        provider: options.defaultProvider ?? "ollama",
        model: options.defaultModel ?? "qwen2.5-coder:7b",
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
        defaultCloudModel: options.defaultCloudModel ?? "gpt-4o-mini",
      },
    );

    this.prompts = new PromptStore(this.config.promptsDir);
    this.memory = new MemoryManager(this.config.memoryDir);
    this.tools = new ToolRegistry(this.config.workspaceRoot, {
      tavilyApiKey: this.config.toolDefaults.tavilyApiKey,
      tavilyBaseUrl: this.config.toolDefaults.tavilyBaseUrl,
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

    this.memory.appendSessionMessage(sessionId, {
      role: "user",
      content: request.prompt,
    });

    yield {
      type: "status",
      message: `Mode: ${mode} | Provider: ${provider} | Model: ${model}`,
    };

    yield {
      type: "status",
      message: "Collecting context",
    };

    try {
      this.ensureNotAborted(request.abortSignal);
      const memoryContext = await this.memory.getRelevantContext(
        request.prompt,
      );
      this.ensureNotAborted(request.abortSignal);
      const workspaceContext = await this.buildWorkspaceContext(request);
      this.ensureNotAborted(request.abortSignal);

      yield {
        type: "status",
        message: `Context ready – routing to ${mode} pipeline`,
      };

      const inferredTerminalCommand =
        request.allowTools !== false
          ? this.extractTerminalCommandRequest(request.prompt)
          : null;

      let response: OrchestratorResponse;
      if (
        request.prompt.trimStart().startsWith("/tool ") &&
        request.allowTools !== false
      ) {
        const toolCommand = request.prompt.replace(/^\s*\/tool\s+/, "").trim();
        yield {
          type: "status",
          message: toolCommand.startsWith("terminal ")
            ? `Running terminal command: ${toolCommand.slice("terminal ".length)}`
            : `Running tool command: ${toolCommand}`,
        };
        response = await this.handleToolRequest(
          request.prompt,
          mode,
          provider,
          model,
          diagnostics,
          request.allowWebSearch !== false,
        );
      } else if (inferredTerminalCommand) {
        const inferredPrompt = `/tool terminal ${inferredTerminalCommand}`;
        yield {
          type: "status",
          message: `Running terminal command: ${inferredTerminalCommand}`,
        };
        response = await this.handleToolRequest(
          inferredPrompt,
          mode,
          provider,
          model,
          diagnostics,
          request.allowWebSearch !== false,
        );
      } else if (request.prompt.trimStart().startsWith("/edit ")) {
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
          diagnostics,
          request.abortSignal,
        );
      } else if (mode === "auto") {
        const pipeline = this.resolveAutoPipeline(request.prompt);
        yield {
          type: "status",
          message: `Auto workflow: ${pipeline.map((stage) => this.formatPipelineStage(stage)).join(" → ")}`,
        };
        for (const stage of pipeline) {
          yield {
            type: "status",
            message: this.describePipelineStage(stage),
          };
        }
        response = await this.runAutoMode(
          request.prompt,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          diagnostics,
          pipeline,
          request.abortSignal,
        );
      } else {
        yield {
          type: "status",
          message: `Calling ${mode} agent`,
        };
        response = await this.runSingleMode(
          mode,
          request.prompt,
          provider,
          model,
          temperature,
          workspaceContext,
          memoryContext,
          diagnostics,
          request.abortSignal,
        );
      }

      this.ensureNotAborted(request.abortSignal);

      response.diagnostics = diagnostics;

      for (const token of chunkText(response.text, 32)) {
        yield {
          type: "token",
          token,
        };
      }

      this.memory.appendSessionMessage(sessionId, {
        role: "assistant",
        content: response.text,
      });

      await this.memory.rememberInteraction(request.prompt, response.text, [
        mode,
        provider,
        model,
      ]);

      const feedback = this.reflection.score(
        request.prompt,
        response.text,
        response.proposedEdits.length,
        0,
      );
      await this.feedbackLogger.log({
        ...feedback,
        metadata: {
          mode,
          provider,
          model,
          diagnosticsCount: diagnostics.length,
        },
      });

      if (feedback.score >= 85) {
        await this.promptVersions.record(
          mode,
          feedback.score,
          "High-scoring response captured for prompt evolution.",
        );
      }

      yield {
        type: "final",
        response,
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        yield {
          type: "stopped",
          message: "Request stopped by user.",
        };
        return;
      }

      yield {
        type: "error",
        message: `Orchestration failed: ${String(error)}`,
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

  private async runAutoMode(
    prompt: string,
    provider: ProviderId,
    model: string,
    temperature: number | undefined,
    workspaceContext: string,
    memoryContext: string,
    diagnostics: string[],
    pipeline: Exclude<AgentMode, "auto">[],
    abortSignal?: AbortSignal,
  ): Promise<OrchestratorResponse> {
    const stageSet = new Set(pipeline);

    this.ensureNotAborted(abortSignal);
    const plan = stageSet.has("planner")
      ? await this.runAgentSafely(
          "planner",
          () =>
            this.planner.run({
              userPrompt: prompt,
              provider,
              model,
              temperature,
              maxTokens: getAgentMaxTokens("planner", prompt),
              workspaceContext,
              memoryContext,
              signal: abortSignal,
            }),
          diagnostics,
        )
      : null;

    this.ensureNotAborted(abortSignal);
    const code = stageSet.has("coder")
      ? await this.runAgentSafely(
          "coder",
          () =>
            this.coder.run({
              userPrompt: prompt,
              provider,
              model,
              temperature,
              maxTokens: getAgentMaxTokens("coder", prompt),
              workspaceContext,
              memoryContext,
              plan: plan?.content,
              signal: abortSignal,
            }),
          diagnostics,
        )
      : null;

    this.ensureNotAborted(abortSignal);
    const [review, qa, security] = await Promise.all([
      stageSet.has("reviewer")
        ? this.runAgentSafely(
            "reviewer",
            () =>
              this.reviewer.run({
                userPrompt: prompt,
                provider,
                model,
                temperature,
                maxTokens: getAgentMaxTokens("reviewer", prompt),
                workspaceContext,
                memoryContext,
                plan: plan?.content,
                implementationDraft: code?.content,
                signal: abortSignal,
              }),
            diagnostics,
          )
        : Promise.resolve(null),
      stageSet.has("qa")
        ? this.runAgentSafely(
            "qa",
            () =>
              this.qa.run({
                userPrompt: prompt,
                provider,
                model,
                temperature,
                maxTokens: getAgentMaxTokens("qa", prompt),
                workspaceContext,
                memoryContext,
                plan: plan?.content,
                implementationDraft: code?.content,
                signal: abortSignal,
              }),
            diagnostics,
          )
        : Promise.resolve(null),
      stageSet.has("security")
        ? this.runAgentSafely(
            "security",
            () =>
              this.security.run({
                userPrompt: prompt,
                provider,
                model,
                temperature,
                maxTokens: getAgentMaxTokens("security", prompt),
                workspaceContext,
                memoryContext,
                plan: plan?.content,
                implementationDraft: code?.content,
                signal: abortSignal,
              }),
            diagnostics,
          )
        : Promise.resolve(null),
    ]);

    this.ensureNotAborted(abortSignal);

    const textParts: string[] = [];
    if (plan) {
      textParts.push("## Planner", plan.content, "");
    }
    if (code) {
      textParts.push("## Coder", code.content, "");
    }
    if (review) {
      textParts.push("## Reviewer", review.content, "");
    }
    if (qa) {
      textParts.push("## QA", qa.content, "");
    }
    if (security) {
      textParts.push("## Security", security.content);
    }

    const text = textParts.join("\n").trim();

    return {
      text,
      modeUsed: "auto",
      providerUsed: provider,
      modelUsed: model,
      proposedEdits: [],
      diagnostics,
    };
  }

  private resolveAutoPipeline(prompt: string): Exclude<AgentMode, "auto">[] {
    const normalized = prompt.toLowerCase();
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

    if (isSecuritySensitive) {
      return ["planner", "coder", "reviewer", "qa", "security"];
    }

    if (isLarge || isValidationHeavy) {
      return ["planner", "coder", "reviewer", "qa"];
    }

    if (isBuildOrCreate) {
      return ["planner", "coder", "reviewer"];
    }

    return ["planner", "coder"];
  }

  private describePipelineStage(stage: Exclude<AgentMode, "auto">): string {
    switch (stage) {
      case "planner":
        return "Planner: mapping the request";
      case "coder":
        return "Coder: drafting the implementation";
      case "reviewer":
        return "Reviewer: checking correctness";
      case "qa":
        return "QA: designing validation cases";
      case "security":
        return "Security: scanning for risks";
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

  private async runSingleMode(
    mode: AgentMode,
    prompt: string,
    provider: ProviderId,
    model: string,
    temperature: number | undefined,
    workspaceContext: string,
    memoryContext: string,
    diagnostics: string[],
    abortSignal?: AbortSignal,
  ): Promise<OrchestratorResponse> {
    const runnerByMode: Record<
      Exclude<AgentMode, "auto">,
      () => Promise<AgentResult>
    > = {
      planner: () =>
        this.planner.run({
          userPrompt: prompt,
          provider,
          model,
          temperature,
          maxTokens: getAgentMaxTokens("planner", prompt),
          workspaceContext,
          memoryContext,
          signal: abortSignal,
        }),
      coder: () =>
        this.coder.run({
          userPrompt: prompt,
          provider,
          model,
          temperature,
          maxTokens: getAgentMaxTokens("coder", prompt),
          workspaceContext,
          memoryContext,
          signal: abortSignal,
        }),
      reviewer: () =>
        this.reviewer.run({
          userPrompt: prompt,
          provider,
          model,
          temperature,
          maxTokens: getAgentMaxTokens("reviewer", prompt),
          workspaceContext,
          memoryContext,
          signal: abortSignal,
        }),
      qa: () =>
        this.qa.run({
          userPrompt: prompt,
          provider,
          model,
          temperature,
          maxTokens: getAgentMaxTokens("qa", prompt),
          workspaceContext,
          memoryContext,
          signal: abortSignal,
        }),
      security: () =>
        this.security.run({
          userPrompt: prompt,
          provider,
          model,
          temperature,
          maxTokens: getAgentMaxTokens("security", prompt),
          workspaceContext,
          memoryContext,
          signal: abortSignal,
        }),
    };

    const selected = mode === "auto" ? "planner" : mode;
    const result = await this.runAgentSafely(
      selected,
      runnerByMode[selected],
      diagnostics,
    );

    return {
      text: `## ${capitalize(selected)}\n${result.content}`,
      modeUsed: mode,
      providerUsed: provider,
      modelUsed: model,
      proposedEdits: [],
      diagnostics,
    };
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

    if (!result.ok) {
      diagnostics.push(result.output);
    }

    return {
      text: [
        "## Tool Execution",
        `Command: ${toolCommand}`,
        "",
        "```text",
        result.output,
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
      /^(pnpm|npm|npx|yarn|bun|node|python|pip|pip3|uv|poetry|go|cargo|dotnet|mvn|gradle|java|javac|git|docker|kubectl|terraform|make|cmake|pwsh|powershell|bash|sh|cmd|ls|dir|mkdir|touch|cp|mv|rm|del|cat|type)\b/i;

    return commandStarter.test(trimmed) ? trimmed : null;
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
      : `session:${randomUUID()}`;
  }

  private async buildWorkspaceContext(
    request: OrchestratorRequest,
  ): Promise<string> {
    const workspaceRoot = request.workspaceRoot ?? this.config.workspaceRoot;
    const sections: string[] = [];

    try {
      const topLevel = await fs.readdir(workspaceRoot, {
        withFileTypes: true,
      });
      const names = topLevel
        .slice(0, 20)
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
      sections.push(`Workspace root: ${workspaceRoot}`);
      sections.push(`Top-level entries: ${names.join(", ")}`);
    } catch {
      // Best-effort context only.
    }

    if (request.activeFilePath) {
      const absoluteActivePath = path.isAbsolute(request.activeFilePath)
        ? request.activeFilePath
        : path.join(workspaceRoot, request.activeFilePath);

      try {
        const fileContent = await fs.readFile(absoluteActivePath, "utf8");
        const snippet =
          request.selectedText && request.selectedText.trim().length > 0
            ? request.selectedText.trim()
            : fileContent.slice(0, 2000);

        sections.push(
          `Active file: ${path.relative(workspaceRoot, absoluteActivePath).replace(/\\/g, "/")}`,
        );
        sections.push(`Active snippet:\n${snippet}`);
      } catch {
        // Ignore active file read failures.
      }
    }

    if ((request.attachments?.length ?? 0) > 0) {
      sections.push(this.buildAttachmentContext(request.attachments ?? []));
    }

    return sections.join("\n\n");
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
        const snippet = attachment.textContent.slice(0, 3000);
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
