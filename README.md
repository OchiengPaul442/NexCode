# NEXCODE-KIBOKO

Local-first, multi-agent AI coding assistant for VS Code.

This repository contains:

- A VS Code sidebar extension (Copilot-like chat UX, independent from Copilot)
- A modular orchestration core with planner/coder/reviewer/qa/security agents
- Provider routing (Ollama by default, OpenAI-compatible optional)
- Tool layer (filesystem, terminal, git, test, search)
- Memory + reflection loop for self-improving prompts

## Project Structure

- `extension/` VS Code extension package
- `agent-core/` orchestration/runtime package
- `prompts/` editable system prompts by role
- `providers/` provider templates
- `tools/` helper scripts
- `memory/` runtime memory store
- `ui/` UI notes/assets

## Requirements

- Node.js 18+
- npm 9+
- VS Code 1.95+
- Ollama (recommended for local inference)

## Quick Start

1. Install dependencies:
   - `npm install`
2. Build all packages:
   - `npm run build`
3. Optional: pull local models:
   - PowerShell: `./tools/setup-ollama.ps1`
4. Run extension in VS Code:
   - Open `extension/` in VS Code and press `F5` to launch an Extension Development Host.
5. Open sidebar:
   - Run command `NEXCODE: Open Sidebar`

## Sidebar Usage

- Standard prompt: type request and send
- Tool command: `/tool <command>`
- Edit flow: `/edit <path> :: <instruction>` then click `Apply Edit`

Examples:

- `Build auth middleware with tests`
- `/tool search orchestrator`
- `/edit agent-core/src/orchestrator.ts :: add retry logic around provider calls`

## Provider Configuration

Extension settings (`nexcodeKiboko.*`) control runtime behavior:

- `defaultProvider`: `ollama` or `openai-compatible`
- `defaultModel`
- `defaultMode`
- `ollamaBaseUrl`
- `openAIBaseUrl`
- `openAIApiKey`
- `allowToolCommands`

## Build And Test

- Build: `npm run build`
- Lint type-check: `npm run lint`
- Tests: `npm run test`
- Package extension: `npm run package:vsix`

## Notes On Self-Improvement

`agent-core` logs interaction quality and prompt versions to `memory/`:

- `feedback-log.jsonl`
- `long-term-memory.json`
- `prompt-versions.json`

This enables iterative prompt refinement over time.
