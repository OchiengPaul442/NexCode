# NEXCODE-KIBOKO

NEXCODE-KIBOKO is a local-first, multi-agent coding assistant for VS Code.

## Features

- Copilot-style sidebar with session list, timestamps, and quick session switching.
- New Chat and Delete Session actions with confirmation flow.
- Sidebar chat interface with streaming responses and thinking indicator.
- Live provider status badge (connected/disconnected + latency).
- Dynamic model selector populated from provider endpoints (Ollama/OpenAI-compatible).
- Per-session provider/model/mode persistence.
- Multi-agent modes: `auto`, `planner`, `coder`, `reviewer`, `qa`, `security`.
- Attachment support for text/image/binary context.
- Drag-and-drop attachment support with preview chips.
- Safe edit workflow with `Preview Diff`, `Apply Edit`, and `Reject`.
- Tool command support for local search, web search, terminal, git, tests, and file reads.
- Online web search using Tavily with DuckDuckGo and Wikipedia fallbacks.
- Terminal command confirmation option in the chat UI.
- Settings panel with temperature, reasoning visibility, auto-apply, and debug toggles.

## Quick Start

1. Open the command palette and run `NEXCODE: Open Sidebar`.
2. Pick provider/model in the sidebar header.
3. Ask for implementation, review, QA, or security tasks.
4. Use `/tool` commands when needed.

## Example Prompts

- `Build an auth middleware with tests.`
- `/tool search orchestrator`
- `/tool web-search OWASP API Security Top 10`
- `/tool terminal npm run test`
- `/edit src/file.ts :: add validation and better error handling`

## Settings

All extension settings are under `nexcodeKiboko.*`:

- `defaultProvider`
- `defaultModel`
- `defaultMode`
- `ollamaBaseUrl`
- `openAIBaseUrl`
- `openAIApiKey`
- `tavilyApiKey`
- `allowToolCommands`
- `requireTerminalApproval`

## Requirements

- VS Code 1.95+
- Node.js 18+
- Ollama (for local or cloud Ollama model usage)

## Known Notes

- Edit proposals are never auto-applied; explicit approval is always required.
- High-risk terminal patterns are blocked by policy in the core runtime.
- Streaming updates are buffered to avoid excessive DOM churn on long responses.
