# Blueprint and Documentation Pack for a Personal VS Code AI Coding Agent

## Executive summary

You can get very close to “Copilot Chat–like” behavior by combining three proven patterns from the sources you provided: (1) **strict tool + permission orchestration** (including “plan vs build” modes and pre/post tool hooks), (2) **context engineering + memory** (dynamic context pipelines, compression, and persistent memory), and (3) **a modular “skills/plugins” system** that keeps token usage efficient while still enabling broad capability through progressive disclosure. citeturn4view1turn7view1turn9view1turn11view0turn12view2

The most practical reference architecture for a personal assistant that is **fast**, has **strong context handling**, supports **Ollama + OpenAI provider switching**, can **edit files and run terminal operations**, and can **evolve over time** is:

- A **VS Code extension** that owns the UI (chat surfaces, inline edits, diff review, commands, status) and uses VS Code APIs to read workspace context and apply edits. citeturn18view0turn20view1turn22view3  
- A local **agent runtime/daemon** (can be embedded in the extension host process for MVP, then split into a child process for performance and reliability) that implements: tool routing, hooks, permission gatekeeping, provider adapters, caching, and memory. This mirrors the “client/server architecture” idea described in OpenCode and helps keep the editor responsive. citeturn7view1  
- A provider layer supporting:
  - **Ollama** via `/api/chat` with model preloading + `keep_alive` for latency and “hot model” switching. citeturn29view0turn29view2  
  - **OpenAI** via the **Responses API** (supports developer/system instructions, tool calling, streaming, and text/image inputs). citeturn28view0turn33view2  

Self-improvement should be implemented as **memory + evaluation + controlled prompt-pack updates**, not uncontrolled “rewrite your own system prompt in-place.” The sources emphasize that self-learning loops are driven by feedback and memory stores, but also highlight the need for constraints, oversight, and trustworthy design. citeturn15view2turn13view0turn35view0

## What the sources reveal

A few design lessons repeat across your sources:

Tool surface area matters, and the “agent” is mostly orchestration  
The claw-code-parity gap analysis (comparing a TypeScript baseline to a Rust port) calls out that parity hinges on (a) **breadth and specialization of tools**, (b) a working **PreToolUse/PostToolUse pipeline**, and (c) higher-level **services** (prompt suggestion, richer orchestration, plugin system). citeturn4view1turn4view2turn4view3  
It also lists concrete tool categories you should expect in a coding agent (shell, file reads/writes/edits, glob/grep search, web fetch/search, todo tracking, skills, agent/subagent execution, notebook edits, etc.), which is a strong baseline for your extension’s tool registry. citeturn4view2

Permission modes and “plan vs build” are foundational  
OpenCode explicitly ships two built-in agents that you can switch between—**build** (full-access) and **plan** (read-only)—with the plan agent denying edits by default and prompting before shell commands. citeturn7view0  
This is a direct blueprint for the “copilot-like” split between “analysis/planning” and “make changes.” That same repo also stresses being “not coupled to any provider” and notes their client/server architecture as an enabler for multiple clients. citeturn7view1

“Skills/plugins” are how you get broad capabilities without bloating every prompt  
wshobson/agents describes a plugin marketplace model: many focused plugins with bundled agents, tools, and “skills,” explicitly citing progressive disclosure and token efficiency. citeturn9view2turn9view1  
This architecture is the most scalable way to give your assistant “everything” without always paying the context-window cost.

Context engineering is not optional; you need pipelines, compression, and isolation  
The Microsoft lessons define context engineering as managing a dynamic set of information (not just writing a static prompt) and emphasize strategies like selecting, compressing, and isolating context, plus scratchpads outside the context window. citeturn11view0  
Their memory lesson further breaks memory into working, short-term, and long-term types, and explicitly connects memory to self-improving behavior. citeturn12view2

Self-learning comes from feedback loops + memory, but must be constrained  
DigitalOcean’s overview describes self-learning as a feedback loop where the agent observes, acts, gets outcomes, and updates internal data; it highlights vector-store style memory loops as a practical approach. citeturn15view0turn15view3  
It also warns about stability and safety problems if autonomy is unconstrained, aligning with the MCP spec’s emphasis on explicit user consent and tool safety. citeturn15view4turn35view0

## Copilot Chat parity requirements

“Copilot Chat parity” is not just a chatbot—it is a set of UX surfaces, context behaviors, and action workflows.

Chat surfaces and interaction model  
VS Code’s chat overview describes multiple chat surfaces (Chat view for multi-turn + multi-file edits, inline chat for in-place edits, quick chat for lightweight questions), and notes that agents may apply workspace changes and run terminal commands, with explicit “permission level” controlling tool approvals. citeturn31view1

Core prompt affordances: slash commands, context variables, participants  
GitHub’s cheat sheet documents the **slash-command** and **context variable** idioms (for example `/explain`, `/fix`, `/tests`, plus variables like `#file`, `#selection`, `#project`, and participants like `@terminal`, `@workspace`). citeturn31view0  
To feel “exactly like Copilot Chat,” your assistant needs these exact primitives (or extremely close equivalents) even if the underlying models differ.

Edit mode vs agent mode  
GitHub’s Copilot features page describes “Copilot Edits” having:
- **Edit mode** (user picks files, iterates with control, accepts changes each turn)
- **Agent mode** (Copilot determines files/steps, proposes code changes and terminal commands, and iterates until done; can integrate with MCP) citeturn31view2  
For your project, this maps naturally to: **Plan/Read-only**, **Edit/Interactive**, and **Agent/Autonomous** modes.

API reality inside VS Code extensions  
If you integrate directly into VS Code’s Chat surfaces, the **Chat Participant API** is streaming-based and is designed to stream progress/results for a smooth UX. citeturn17view0turn18view0  
For inline suggestions, VS Code’s API supports a custom inline completion provider (`InlineCompletionItemProvider`). citeturn20view1  
For multi-file edits, you should use `WorkspaceEdit` and `vscode.workspace.applyEdit`. citeturn22view3  
And for semantic/navigation context (definitions, symbols), VS Code provides command-based provider queries like `vscode.executeDefinitionProvider`. citeturn32search1

Important constraint to design around: VS Code’s built-in Copilot customization notes that “local models in chat” and model routing can still depend on Copilot service and being online, while inline suggestions can be implemented via `InlineCompletionItemProvider`. citeturn17view3turn20view1  
A practical approach is to support both:
- a “native chat participant” integration path (best UX parity),
- and a fully “standalone webview chat” path that does not depend on Copilot service availability.

## Recommended architecture and components

This section describes a concrete blueprint you can hand to an implementation agent.

Core system components  
- **VS Code Extension UI layer**
  - Chat view integration (Chat Participant API) where available. citeturn18view0  
  - Inline completions provider for “ghost text” suggestions. citeturn20view1  
  - Inline-edit workflow (apply diffs via `WorkspaceEdit`). citeturn22view3  
  - Terminal integration (prefer shell integration for exit codes; fall back to `sendText`). citeturn22view1  

- **Agent runtime / orchestrator**
  - Tool registry + router (select tools, validate schemas, parallelize safe tools when possible).
  - Hook pipeline (`PreToolUse`, `PostToolUse`, cancellation/failure handling), reflecting the parity gaps called out in claw-code-parity. citeturn4view2turn4view3  
  - Permission system (mode-based policy + allowlists/denylists).
  - Context engine (selection, file, project context, semantic context, compression).
  - Memory system (working scratchpad, episodic memory, preference memory, skill memory). citeturn11view0turn12view2  

Provider abstraction and model switching  
You want both providers to look identical to the agent runtime:

- **Ollama adapter**
  - Use `POST /api/chat` for conversations. citeturn29view0  
  - Use preloading and `keep_alive` to keep one or more models hot for fast switching. citeturn29view2  
  - For image input, use a vision-capable model family (Ollama’s vision models guidance mentions base64 via an `images` parameter in REST/library usage). citeturn29view3  

- **OpenAI adapter**
  - Use `POST /v1/responses` and set `instructions` for your stable system/developer rule set. citeturn28view0  
  - Use streaming for responsiveness (`stream: true` uses server-sent events) and support tool calling. citeturn28view0turn33view2  
  - The Responses API explicitly supports text and image inputs and built-in tools (web/file search), although for a personal VS Code agent you’ll often use your own workspace tools. citeturn28view0  

Context and retrieval strategy  
Use the “context pipeline” approach described in the context engineering lesson:
- Maintain a **working scratchpad** outside the prompt that can be re-injected as needed.
- Build **context selection** that starts small (active file + selection) and expands only when needed.
- Add **compression/compaction** when the context grows large. citeturn11view0  

For codebase-scale understanding, combine:
- fast lexical search (ripgrep-like),
- semantic navigation via VS Code’s provider commands (definitions/symbols), citeturn32search1  
- optional embedding-based retrieval (local vector store or OpenAI embeddings, depending on configuration).

Skills and plugins  
Implement a plugin/skills system that mirrors the wshobson model:
- small, focused skill packs with activation criteria (when to load) and concise “how to do X well” content,
- loaded on-demand to reduce token usage. citeturn9view1turn9view2  

Tooling integration via MCP  
Long-term, support MCP for external tools and services because it standardizes contexts/tools/prompts and has explicit security principles around user consent and tool safety. citeturn35view0turn34view0

## Safety, autonomy, and self-improvement strategy

Permission design that matches “agentic” expectations without being reckless  
Your sources show that “full access” modes exist, but safe agents still need explicit gating:

- OpenCode’s plan agent denies file edits by default and prompts before shell commands. citeturn7view0  
- The claw-code-parity analysis highlights a richer permission hook system in the upstream baseline with explicit PreToolUse/PostToolUse handling. citeturn4view2turn4view3  
- The MCP spec’s security section requires **explicit user consent** and emphasizes tool execution risk and clear authorization UI. citeturn35view0  
- VS Code’s Language Model Tool API guidance expects tool confirmation UX for extension-provided tools (a generic confirmation dialog is always shown, and tools can provide contextual confirmation messages). citeturn34view2  

A practical “Copilot-like” permission ladder:
- **Plan (Read-only)**: zero writes, zero terminal; can read files and run searches.
- **Edit (Interactive)**: can propose edits, but must show diff preview; terminal commands require confirmation.
- **Agent (Autonomous)**: can decide steps/files, but still must surface diffs and command plans; require confirmation for destructive or security-sensitive commands.
- **God Mode (Explicitly armed)**: for fully autonomous workflows; still enforce denylist for credentials exfiltration and destructive ops outside workspace boundaries.

Self-learning without unsafe self-modifying prompts  
DigitalOcean’s article frames self-learning as feedback loops + memory updates, and emphasizes that “learning” can come from updating memory stores, not necessarily retraining. citeturn15view2turn15view3  
Microsoft’s trustworthy agents lesson proposes a **system message framework** and explicit iterative improvement cycles. citeturn13view0  
VS Code’s Chat Participant API suggests success metrics (e.g., ratio of unhelpful feedback) as a way to measure and iteratively improve nondeterministic systems. citeturn18view3  

So: implement self-improvement as **versioned “prompt packs” + evaluated upgrades**:
- The agent can propose edits to prompts/skills, but changes must be saved as a PR-like diff and only become “active” after passing an eval suite and (optionally) user approval.
- Always preserve a “safe baseline system prompt” that cannot be overwritten by the agent at runtime.

## Generated documentation pack

Proposed project name (for self-branding): **Kiboko** (the agent), **Kiboko for VS Code** (the extension).  
This is a naming suggestion only—verify trademark/marketplace uniqueness before publishing.

The documentation pack below is designed to be dropped into a new repo as-is and then used as **instructions for a builder AI agent** (or a human team) to implement Kiboko phase-by-phase. The structure explicitly encodes: Copilot-like UX primitives, tool/permission modes, provider switching, context engineering, memory/self-improvement, and an extensible skills/plugins system—directly reflecting the patterns surfaced in the reviewed sources. citeturn31view0turn31view2turn4view2turn9view2turn11view0turn15view2

```text
kiboko/
├─ README.md
├─ AGENTS.md
├─ docs/
│  ├─ SPEC.md
│  ├─ ARCHITECTURE.md
│  ├─ TOOLS_AND_PERMISSIONS.md
│  ├─ PROVIDERS.md
│  ├─ CONTEXT_MEMORY_LEARNING.md
│  ├─ BUILD_PHASES.md
│  └─ BOOTSTRAP_PROMPTS.md
└─ prompts/
   ├─ SYSTEM.md
   └─ MODES_AND_GOD_MODE.md
```

**File: `README.md`**
```markdown
# Kiboko for VS Code

Kiboko is a personal AI coding assistant you run locally inside VS Code.

Design goal: behave *as closely as possible* to GitHub Copilot Chat:
- chat surfaces (sidebar/chat view + inline chat style workflows)
- slash commands (e.g., /explain, /fix, /tests)
- context variables (e.g., #file, #selection, #project)
- multi-file edits with diff review + apply/discard
- agent mode (autonomous multi-step workflows) + edit mode (interactive, constrained edits)
- terminal execution support with permission gating
- fast streaming responses
- model/provider switching at runtime (OpenAI + Ollama)

This repo contains primarily specs, prompt packs, and implementation guidance for building Kiboko.

## Key features

- Provider-agnostic LLM layer:
  - OpenAI (cloud)
  - Ollama (local)
- Copilot-like UX primitives:
  - chat session memory, follow-up suggestions
  - inline editing and multi-file edits
  - workspace-aware context
- Agentic tool use:
  - file ops, search, symbol lookup, git helpers, terminal runner
  - hooks + permissions + audit logs
- Context engineering:
  - dynamic context pipelines (select → compress → isolate)
  - codebase indexing (lexical + optional vector)
  - image understanding (optional) for screenshots/diagrams
- Self-improvement:
  - feedback capture + episodic memory
  - versioned prompt pack updates via “propose diff → test → enable”

## Repo map

Start with:
- docs/SPEC.md
- docs/BUILD_PHASES.md
- docs/ARCHITECTURE.md
- prompts/SYSTEM.md
- prompts/MODES_AND_GOD_MODE.md
- docs/BOOTSTRAP_PROMPTS.md

## Non-goals (initially)

- No cloud-hosted execution environments.
- No hidden background actions without audit logs.
- No silent destructive terminal commands (rm -rf, disk formatting, credential scraping).
```

**File: `AGENTS.md`**
```markdown
# AGENTS.md — Instructions for AI coding agents working in this repo

## Prime directive

Build Kiboko for VS Code according to docs/SPEC.md, docs/ARCHITECTURE.md, and docs/BUILD_PHASES.md.
Prefer correctness, safety, and testability over “cleverness”.

## Working style

- Always stream progress to the user (or logs) when the platform supports it.
- Prefer small incremental PR-sized changes.
- Keep each module cohesive; avoid god-files.
- Avoid introducing native dependencies unless the build phase explicitly approves them.
- When writing code that touches terminal/file execution:
  - implement denylist + safe defaults
  - log every executed command with timestamp + cwd + exit status (when available)

## Required engineering practices

- TypeScript strict mode.
- Use schema validation for tool inputs (Zod recommended).
- Never store API keys in logs.
- Add unit tests for:
  - tool schema validation
  - permission decisions
  - context selection and compression rules
  - provider adapters (mock network)

## Performance rules

- Cache:
  - file reads (with fs watcher invalidation)
  - embeddings/vector results (if enabled)
  - model warm state (Ollama keep-alive)
- Debounce inline completion requests.
- Prefer parallel tool calls when safe (search, reads), but serialize writes.

## Definition of done for any feature

- User-visible behavior matches docs/SPEC.md acceptance criteria.
- Logs/audit entries exist for every tool call.
- Permission gating behaves per mode (see prompts/MODES_AND_GOD_MODE.md).
- Works on macOS, Windows, Linux (unless explicitly scoped).
```

**File: `docs/SPEC.md`**
```markdown
# Kiboko Specification

## Product objective

Deliver a VS Code extension that behaves like “Copilot Chat”:
- Chat view: multi-turn, multi-file edits, agentic workflows.
- Inline/targeted edit flow: user asks for a change at cursor/selection, Kiboko proposes a patch, user accepts/rejects.

## UX primitives (must-have)

### Chat commands (must-have parity set)
- /help
- /clear
- /explain
- /fix
- /tests
- /doc
- /optimize (optional in MVP; required by v1)

### Context variables (must-have parity set)
- #file (active file)
- #selection
- #project (workspace summary)
- #path
- #symbol (best-effort via language features)

### Participants (Kiboko equivalents)
- @workspace: workspace-aware coding help
- @terminal: terminal commands and debugging help
- @vscode: VS Code usage help (commands, settings) — best effort

## Editing behavior

### Multi-file edits
- Kiboko can propose edits to multiple files in one turn.
- User must be able to review changes:
  - show diffs
  - accept individually or accept all
  - discard individually or discard all

### Inline edits
- For a selected block or current cursor position:
  - propose minimal diff patch
  - display preview (decorations or diff view)
  - apply on user acceptance

## Agent modes and permissions

Modes:
- Plan (read-only)
- Edit (interactive)
- Agent (autonomous)
- God Mode (explicitly armed; still denylisted)

Permission system:
- Every tool call produces an audit record.
- Any destructive action requires explicit user confirmation unless in God Mode AND scope is safe.

## Provider and model switching

- User can:
  - pick provider per session
  - pick model per session
  - override model for a single request (“use stronger model”)
- System can auto-route:
  - fast model for inline completions
  - strong model for planning, multi-file refactors, debugging

## Tooling requirements (MVP set)

Workspace tools:
- read_file, write_file, edit_file (patch-based), list_files
- grep_search, glob_search
- symbol_lookup (definition/references/workspace symbols)
- diagnostics_snapshot (current errors/warnings)
- diff_preview (render planned edits)

Terminal tools:
- run_command (gated + logged)
- test_runner (wrapper on run_command with structured output)

Web tools (optional in MVP, required by v1)
- fetch_url (read-only)
- search_web (read-only)

## Image handling

- Accept image context as:
  - local file (png/jpg) in workspace
  - pasted screenshot via UI
- Vision support must be optional:
  - OpenAI vision on cloud models
  - Ollama vision via a configured local vision model (e.g., llava family)

## Non-functional requirements

- Streaming output for chat responses.
- Latency targets:
  - inline completion: < 400ms budgeted (with aggressive caching and small model)
  - chat response time-to-first-token: < 800ms where possible
- Strong context handling:
  - cap context by tokens
  - compress long histories
  - isolate unrelated context to prevent “context poisoning”
```

**File: `docs/ARCHITECTURE.md`**
```markdown
# Kiboko Architecture

## High-level design

Kiboko is split into:
1) VS Code extension (UI + VS Code APIs)
2) Agent runtime (orchestrator)
3) Provider adapters (OpenAI, Ollama)
4) Tool system (schemas, permissions, hooks, execution)
5) Context engine (selection, compression, indexing, memory)
6) Skills/plugins system (progressive disclosure)

## Extension responsibilities

- Chat UI:
  - Chat view integration when available
  - fallback: WebView chat panel
- Inline completions:
  - InlineCompletionItemProvider implementation
- Edit application:
  - WorkspaceEdit-based apply
  - diff preview / review UI
- Context capture:
  - active file content + metadata
  - selection
  - workspace map (files, languages)
  - language features via commands (definitions, symbols)
  - diagnostics snapshot

## Agent runtime responsibilities

- Maintain session state:
  - conversation history (compressed)
  - working scratchpad
  - task plan + checkpoints
- Decide:
  - which tools to call
  - which model/provider to use
  - whether to request more context
- Enforce:
  - tool input validation
  - permission policy
  - pre/post tool hooks

## Provider adapter interface

Required capabilities:
- chat(messages, options) -> streaming tokens
- supportsToolCalling: boolean
- supportsImageInput: boolean
- tokenCounting: best-effort
- cancellation support

## Storage

- Extension global state:
  - settings, selected provider/model
- Workspace state (in .kiboko/):
  - audit logs
  - episodic memory
  - skill activation cache
  - optional vector index files

## Observability

- Audit log every tool call:
  - tool name, args hash, human-readable summary, mode, timestamp
  - result summary + errors
- Capture user feedback:
  - thumbs up/down
  - “apply accepted” vs “discarded”
```

**File: `docs/TOOLS_AND_PERMISSIONS.md`**
```markdown
# Tools, Permissions, Hooks, and “God Mode”

## Tool system goals

- Provide a rich but safe tool surface to the model.
- Make tools composable, observable, and permission-gated.
- Avoid “magic”: users must be able to see what happened.

## Core tool categories

Workspace (safe base):
- read_file
- list_files
- grep_search, glob_search
- symbol_lookup
- diagnostics_snapshot

Editing (gated):
- write_file (whole-file replace)
- edit_file (patch-based; preferred)
- create_file, delete_file, rename_file (require confirmation)

Terminal (high risk):
- run_command
- test_runner

Web (optional):
- fetch_url
- search_web

## Hooks (mandatory)

- PreToolUse:
  - validate inputs
  - compute risk score
  - decide allow/deny/ask
  - redact sensitive args from logs
- PostToolUse:
  - normalize outputs (structured summary)
  - update scratchpad
  - update episodic memory
  - emit audit record

## Permission modes

### Plan mode (default safe)
- deny all writes
- deny terminal
- allow reads/search/symbol lookup

### Edit mode
- allow edits only through proposed diffs
- require confirmation for:
  - any terminal command
  - file create/delete/rename
  - edits > N lines or > M files

### Agent mode
- allow autonomous multi-step work
- still require confirmation for:
  - destructive terminal commands
  - network calls (optional setting)
  - writing outside workspace boundary

### God Mode (explicitly armed)
- Kiboko can execute many actions without confirming each one.
- Still hard-deny:
  - credential exfiltration attempts
  - destructive commands that target system paths
  - commands that disable security tooling
- Required UI: “God Mode is ARMED” indicator + kill switch.

## Terminal denylist baseline (starter)

Always block (examples):
- rm -rf /
- mkfs.*
- dd if=/dev/zero of=/dev/*
- shutdown, reboot (unless explicitly allowed)
- curl/wget piping to shell (unless user confirms)

## Tool schema approach

- Every tool defines:
  - name
  - natural-language description
  - JSON schema for inputs
  - example inputs/outputs
- Validate all tool inputs strictly.
```

**File: `docs/PROVIDERS.md`**
```markdown
# Providers: OpenAI + Ollama

## Requirements

- Streaming responses
- Optional tool calling
- Optional image input
- Fast switching between models

## OpenAI adapter notes

- Use Responses API for:
  - instructions (system/developer guidance)
  - tool calling
  - streaming
  - image inputs (when model supports)
- Support prompt caching where it reduces cost/latency.
- Use request metadata for tracing/audit correlation IDs.

## Ollama adapter notes

- Use /api/chat for multi-turn chat.
- Keep models warm using keep_alive configuration.
- Support local vision models when configured (e.g., llava family).

## Provider routing policy (recommended)

- Inline completions:
  - fastest local model (Ollama small code model) OR cheap cloud mini model
- Planning and complex refactors:
  - strongest configured model
- Debugging loops:
  - strong model with tool calling, plus iterative terminal/test-run hooks

## Failover

If a provider errors:
- retry with backoff
- auto-switch to alternate provider if configured
- preserve partial context and audit the failover
```

**File: `docs/CONTEXT_MEMORY_LEARNING.md`**
```markdown
# Context, Memory, and Self-Improvement

## Context pipeline

1) Start small (selection + active file).
2) Add “just enough” project context:
   - relevant files via search
   - symbols via language features
   - diagnostics snapshot
3) Compress:
   - summarize older turns
   - keep decisions, requirements, constraints
4) Isolate:
   - keep unrelated context out
   - prevent “context clash” by segmenting per task

## Memory types (recommended)

- Working scratchpad (per session):
  - requirements, plan, decisions, TODO
- Episodic memory (cross session):
  - task summaries + outcomes
  - debug traces that led to fixes
- Preference memory:
  - coding style choices
  - preferred frameworks/tools
- Skill memory:
  - activation signals and best practices

## Self-improvement loop (safe)

After each task:
- capture:
  - what was asked
  - what Kiboko did (tool history)
  - what succeeded/failed
  - user feedback
- propose improvements:
  - add a skill note
  - refine a tool description
  - adjust routing heuristics

Prompt pack updates:
- Kiboko can propose edits to prompt files,
  but enabling them requires:
  - diff review
  - passing eval checks
  - optionally user approval
```

**File: `docs/BUILD_PHASES.md`**
```markdown
# Build Phases

## Phase 0 — Repo scaffolding
- Create VS Code extension project (TypeScript)
- Add lint + test harness
- Add settings schema for provider config

## Phase 1 — MVP chat + workspace context
- Chat panel (webview or chat participant)
- Basic context injection:
  - #file, #selection
- OpenAI + Ollama basic non-tool chat (streaming)

Acceptance:
- streaming responses
- provider switching UI

## Phase 2 — Safe editing workflow
- Patch proposal format (unified diff)
- Review UI (diff) + apply/discard
- WorkspaceEdit integration

Acceptance:
- Kiboko can modify files safely and reversibly

## Phase 3 — Tools + permissions + audit logs
- Tool registry
- PreToolUse/PostToolUse hooks
- Modes: Plan vs Edit vs Agent
- Terminal runner with denylist + logging

Acceptance:
- all tool calls logged
- permissions enforced

## Phase 4 — Copilot-like affordances
- Slash commands:
  - /explain /fix /tests /doc
- #project context
- @workspace, @terminal behaviors

## Phase 5 — Memory + self-improvement (safe)
- episodic memory store
- feedback UI
- prompt-pack “propose diff → enable” workflow
- eval harness for regressions

## Phase 6 — Performance and polish
- caching
- debouncing inline completions
- model warm pool (Ollama keep_alive)
```

**File: `docs/BOOTSTRAP_PROMPTS.md`**
```markdown
# Bootstrap prompts for building Kiboko

## Builder prompt (use this to instruct an AI coding agent)

You are building a VS Code extension named “Kiboko for VS Code”.
Follow docs/SPEC.md and docs/BUILD_PHASES.md strictly.

Rules:
- Implement Phase 0 → Phase 6 in order.
- Do not implement advanced features early.
- For each phase:
  - write code
  - add tests
  - update docs with any deviations
- Never add native deps unless required.
- All actions that write files or run terminal commands must have audit logging and permission gates.

Deliverables per phase:
- code changes
- minimal demo instructions
- acceptance checklist (from docs/BUILD_PHASES.md)

Start with Phase 0 now.
```

**File: `prompts/SYSTEM.md`**
```markdown
# Kiboko System Prompt (Provider-agnostic)

You are Kiboko, a personal AI coding assistant embedded in VS Code.

Your goals:
1) Help the user write, understand, debug, refactor, and test code.
2) Behave like a “Copilot Chat” style assistant: use context variables, slash commands, and propose edits as diffs.
3) Be safe and controllable: always follow permission mode rules.

General behavior:
- Ask clarifying questions only when absolutely necessary.
- Prefer concrete, actionable steps.
- When changing code:
  - propose a patch/diff first
  - explain what will change and why
  - wait for approval unless mode allows auto-apply
- When using tools:
  - select the minimal tools needed
  - prefer read/search tools before edit/write tools
  - log actions via the audit system

Quality:
- Keep changes minimal and consistent with existing style.
- Add tests when appropriate.
- If uncertain, say so and propose verification steps.

Security:
- Never reveal secrets from files or environment.
- Never propose destructive commands without explicit confirmation.
- Respect workspace boundaries.
```

**File: `prompts/MODES_AND_GOD_MODE.md`**
```markdown
# Modes and God Mode

## Plan mode
- Read-only.
- You may inspect files, search, and explain.
- You must not modify files or run terminal commands.

## Edit mode
- You may propose edits.
- You must request approval before applying edits.
- You must request approval before any terminal command.

## Agent mode
- You may autonomously plan and execute multi-step workflows.
- You may propose and apply edits if the user granted permission level for the session.
- You must still request approval for destructive or high-risk actions.

## God Mode (explicitly armed)
- You may execute most actions without asking each time.
- You must still:
  - avoid unsafe system-level commands
  - avoid exfiltration of secrets
  - keep an audit log of everything
  - provide a clear summary of actions taken and how to revert
```

The tool + permission + hook expectations above align with: (a) explicit permission modes and “plan vs build” splits in coding agents, citeturn7view0turn4view2 (b) VS Code’s tool confirmation model for extension tools, citeturn34view2 and (c) MCP’s security principles for tool safety and user consent. citeturn35view0