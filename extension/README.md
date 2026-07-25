# NexCode Kiboko - AI Coding Assistant for VS Code

**The local-first, multi-agent AI coding assistant that works like GitHub Copilot Chat.**

NexCode Kiboko is a powerful VS Code extension that brings AI-powered coding assistance directly to your editor. Unlike cloud-based solutions, NexCode runs entirely locally with Ollama, keeping your code private and secure.

## Why NexCode Kiboko?

- **Local-First Privacy**: Your code never leaves your machine. Works with Ollama, OpenAI-compatible APIs, and other providers.
- **Multi-Agent Intelligence**: Specialized agents for planning, coding, reviewing, QA, and security analysis.
- **Real Tool Execution**: Not just chat - actually reads, writes, edits files, runs commands, and searches code.
- **Security Built-In**: 3-layer terminal safety, path containment, secret redaction, and approval policies.
- **Memory That Learns**: Remembers project conventions and coding patterns across sessions.

## Key Features

### Core Capabilities
- Copilot-style sidebar with session list, timestamps, and quick session switching.
- New Chat and Delete Session actions with confirmation flow.
- Sidebar chat interface with streaming responses and thinking indicator.
- Live provider status badge (connected/disconnected + latency).
- Dynamic model selector populated from provider endpoints (Ollama/OpenAI-compatible).
- Per-session provider/model/mode persistence.

### Multi-Agent Support
- Multi-agent modes: `auto`, `planner`, `coder`, `reviewer`, `qa`, `security`.
- Subagent fan-out with conflict isolation via git worktrees.
- Background workers for long-running tasks with retry and cancellation.

### Tool Integration
- Attachment support for text/image/binary context.
- Drag-and-drop attachment support with preview chips.
- Safe edit workflow with `Preview Diff`, `Apply Edit`, and `Reject`.
- Tool command support for local search, web search, terminal, git, tests, and file reads.
- Online web search using Tavily with DuckDuckGo and Wikipedia fallbacks.
- Terminal command confirmation option in the chat UI.

### Skills & Memory
- Invokable skills from `.opencode/skills/` directory.
- Auto-memory system that learns project conventions across sessions.
- Path-scoped rules for context-specific instructions.

### Security
- Enhanced permission model with glob-pattern support.
- Code interpreter with sandboxed execution.
- Agent isolation via git worktrees.

## Quick Start

1. Install the extension from the VS Code Marketplace.
2. Open the command palette and run `NexCode: Open Sidebar`.
3. Pick your provider and model in the sidebar header.
4. Start coding with AI assistance!

## Example Prompts

- `Build an auth middleware with tests.`
- `/tool search orchestrator`
- `/tool web-search OWASP API Security Top 10`
- `/tool terminal npm run test`
- `/edit src/file.ts :: add validation and better error handling`
- `Explain how this function works and suggest improvements.`
- `Find and fix the bug in the login flow.`

## Supported Models

| Provider | Models |
|----------|--------|
| **Ollama** | Any model (qwen2.5-coder, gemma4, llama3, etc.) |
| **OpenAI** | GPT-4, GPT-4o, GPT-3.5-turbo |
| **OpenRouter** | Claude, Llama, Mistral, and more |
| **Groq** | Llama, Mixtral |
| **Together AI** | Various open-source models |

## Settings

All extension settings are under `nexcodeKiboko.*`:

- `defaultProvider` - Default AI provider
- `defaultModel` - Default model to use
- `defaultMode` - Default agent mode
- `ollamaBaseUrl` - Ollama server URL
- `openAIBaseUrl` - OpenAI API base URL
- `openAIApiKey` - OpenAI API key
- `tavilyApiKey` - Tavily search API key
- `allowToolCommands` - Enable tool commands
- `requireTerminalApproval` - Require approval for terminal commands

## Security Features

- **3-Layer Terminal Safety**: Safe patterns, shell expansion blocking, dangerous command blocking.
- **Path Containment**: Prevents file access outside workspace.
- **Secret Redaction**: Automatically redacts API keys, tokens, and passwords.
- **Approval Policies**: Configurable tool approval with risk levels.
- **Agent Isolation**: Git worktree-based workspace isolation for parallel agents.

## Commands

| Command | Description |
|---------|-------------|
| `NexCode: Open Sidebar` | Open the NexCode sidebar |
| `NexCode: Pick Model` | Select AI model |
| `NexCode: Clear Conversation` | Clear chat history |
| `NexCode: Explain Selection` | Explain selected code |
| `NexCode: Open in Tab` | Open chat in a tab |
| `NexCode: Show Version Info` | Show version information |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  VS Code Extension              │
├─────────────────────────────────────────────────┤
│  Sidebar Webview (React)                        │
│  ├── Chat Interface                             │
│  ├── Session Management                         │
│  └── Settings Panel                             │
├─────────────────────────────────────────────────┤
│  Extension Host                                 │
│  ├── Orchestrator                               │
│  │   ├── Auto Router                            │
│  │   ├── Agent Loop                             │
│  │   └── Context Builder                        │
│  ├── Tool Registry                              │
│  │   ├── File System                            │
│  │   ├── Terminal                               │
│  │   ├── Search                                 │
│  │   ├── Git                                    │
│  │   └── MCP                                    │
│  ├── Memory System                              │
│  │   ├── Short-term (Session)                   │
│  │   ├── Long-term (Persistent)                 │
│  │   └── Enhanced (Auto-learning)               │
│  └── Security Layer                             │
│      ├── Path Containment                       │
│      ├── Secret Redaction                       │
│      └── Approval Policies                      │
├─────────────────────────────────────────────────┤
│  Provider Layer                                 │
│  ├── Ollama (Local)                             │
│  ├── OpenAI Compatible                          │
│  └── Multi-provider Router                      │
└─────────────────────────────────────────────────┘
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE.txt) for details.

## Support

- [GitHub Issues](https://github.com/nexcode/nexcode-kiboko/issues)
- [Documentation](https://nexcode.dev/docs)
- [Discord Community](https://nexcode.dev/discord)

---

**Keywords**: ai coding assistant, copilot alternative, local ai, ollama, code generation, code review, terminal commands, git integration, multi-agent, vscode extension, code completion, pair programming, ai pair programmer, code automation, developer tools, coding assistant, ai assistant, llm, gpt, claude, open source, privacy-first, local-first

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

## Installation

1. Install from the VS Code Marketplace or by running `code --install-extension nexcode.nexcode-kiboko`.
2. Open the NexCode sidebar from the activity bar.
3. Select a provider and model in the sidebar header.
4. Start chatting.

## Development

```bash
npm install
npm run build
npm run package:vsix
```

## Known Notes

- Edit proposals are never auto-applied; explicit approval is always required.
- High-risk terminal patterns are blocked by policy in the core runtime.
- Streaming updates are buffered to avoid excessive DOM churn on long responses.
