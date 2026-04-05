# NEXCODE-KIBOKO

Local-first, multi-agent AI coding assistant for VS Code.

## What You Get

- VS Code sidebar extension with chat, streaming, attachments, and controlled edit approvals.
- Multi-agent core with `auto`, `planner`, `coder`, `reviewer`, `qa`, and `security` modes.
- Provider routing for local Ollama and OpenAI-compatible endpoints.
- Tooling layer for filesystem, terminal, git, tests, local code search, and online web search.
- Online web search through Tavily with DuckDuckGo and Wikipedia fallbacks.
- Persistent memory and feedback logs for iterative prompt refinement.

## Repository Layout

- `extension/`: VS Code extension.
- `agent-core/`: orchestration and tools runtime.
- `prompts/`: editable system prompts.
- `providers/`: provider templates and examples.
- `memory/`: runtime memory store (generated files are ignored).
- `tools/`: setup, cleanup, packaging, and release scripts.

## Prerequisites

- Node.js `>=18`
- npm `>=9`
- VS Code `>=1.95`
- Ollama installed and running for local model usage.

## Quick Start

1. Install dependencies:
   - `npm install`
2. Build all packages:
   - `npm run build`
3. Optional model pull for local inference:
   - `powershell -ExecutionPolicy Bypass -File .\tools\setup-ollama.ps1`
4. Launch extension host:
   - Open `extension/` in VS Code.
   - Press `F5`.
5. Open the sidebar:
   - Run command `NEXCODE: Open Sidebar`.

## Recommended Ollama Model

The sidebar model field is editable. For advanced runs, set model to:

- `gpt-oss:120b-cloud`

You can still use lighter models such as `qwen2.5-coder:7b` for faster local iteration.

## Chat Command Surface

- Standard prompt:
  - `Build auth middleware with tests`
- Local code search:
  - `/tool search orchestrator`
- Online search (Tavily + fallback):
  - `/tool web-search OWASP API Security Top 10`
- Terminal execution:
  - `/tool terminal npm run test`
- Git and tests:
  - `/tool git-status`
  - `/tool git-diff`
  - `/tool git-branch`
  - `/tool test npm test -- --runInBand`
- Read file:
  - `/tool read README.md`
- Propose code edit:
  - `/edit agent-core/src/orchestrator.ts :: add retry around provider call`

## Approval And Safety Flow

- Edit proposals are never auto-applied.
- Every proposal supports:
  - `Preview Diff`
  - `Apply Edit`
  - `Reject`
- Terminal commands can require explicit confirmation from the sidebar.
- High-risk destructive command patterns are blocked in `agent-core` terminal tool policy.

## Extension Settings

All settings are under `nexcodeKiboko.*`:

- `defaultProvider`
- `defaultModel`
- `defaultMode`
- `ollamaBaseUrl`
- `openAIBaseUrl`
- `openAIApiKey`
- `tavilyApiKey`
- `allowToolCommands`
- `requireTerminalApproval`

## Build, Test, Package

- Build:
  - `npm run build`
- Type/lint checks:
  - `npm run lint`
- Tests:
  - `npm run test`
- Raw VSIX package:
  - `npm run package:vsix`

## Extension Install And Auto Version Bump

Use the release script to bump version, package, and install into VS Code:

- Package and install:
  - `npm run extension:release`
- Package only:
  - `npm run extension:package`
- Bump only:
  - `npm run extension:bump`

You can choose version increment type:

- `node tools/extension-release.mjs --bump-type patch`
- `node tools/extension-release.mjs --bump-type minor --no-install`

## Maintenance And Cleanup

- Clean generated simulation/artifact files:
  - `npm run clean`
- Run full local checks:
  - `powershell -ExecutionPolicy Bypass -File .\tools\run-local-checks.ps1`

Ignored/generated content includes:

- `audit/`
- framework caches (`.next`, pytest cache, bytecode)
- runtime memory logs
- local VSIX outputs

## Runtime Memory Notes

Generated runtime memory files are written to `memory/` during use. These are intentionally excluded from source control to keep commits clean.
