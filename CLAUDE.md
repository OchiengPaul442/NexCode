# CLAUDE.md - NexCode Project Context for AI Assistants

## Project Overview

NexCode (NexCode-Kiboko) is a local-first, multi-agent AI coding assistant for VS Code. It connects to local LLM providers (Ollama) or cloud providers (OpenAI-compatible) to help developers write, debug, refactor, test, and understand code.

---

## Quick Start

```bash
# Install dependencies
npm install

# Build everything
npm run build

# Run tests
npm test

# Package extension
npx vsce package

# Install in VS Code
code --install-extension extension/nexcode-kiboko-extension-*.vsix --force
```

---

## Architecture

### Core Components

1. **agent-core** - The brain
   - `orchestrator.ts` - Routes requests to appropriate agents
   - `agents/` - Specialist agents (planner, coder, reviewer, qa, security)
   - `tools/` - Tool implementations (terminal, file ops, search, etc.)
   - `providers/` - LLM provider integrations (Ollama, OpenAI-compatible)

2. **extension** - The VS Code interface
   - `src/extension.ts` - Extension entry point
   - `src/sidebarViewProvider.ts` - Webview provider
   - `webview/src/main.tsx` - React UI (single file, ~4000 lines)

3. **prompts** - System prompts for each agent mode

---

## Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `agent-core/src/orchestrator.ts` | Main routing and execution | ~3300 |
| `agent-core/src/agents/agentLoop.ts` | Tool-use loop | ~320 |
| `agent-core/src/tools/toolRegistry.ts` | Tool execution | ~400 |
| `extension/webview/src/main.tsx` | Webview UI | ~4200 |

---

## Agent Modes

| Mode | Purpose | Model |
|------|---------|-------|
| `auto` | Routes to best agent automatically | primaryWorker |
| `planner` | Creates implementation plans | manager |
| `coder` | Writes and edits code | primaryWorker |
| `reviewer` | Reviews code for issues | reasoningReviewer |
| `qa` | Designs and runs tests | lightweightWorker |
| `security` | Security auditing | reasoningReviewer |

---

## Tools Available

| Tool | Description | Risk |
|------|-------------|------|
| `read` | Read file contents | Safe |
| `write` | Create/overwrite file | Low |
| `append` | Add to file | Low |
| `delete` | Delete file/directory | Destructive |
| `move` | Move/rename file | Destructive |
| `terminal` | Run shell command | Destructive |
| `search` | Search workspace | Safe |
| `git-status` | Git status | Safe |
| `git-diff` | Git diff | Safe |
| `batch_edit` | Edit multiple files | Destructive |

---

## Configuration

### VS Code Settings

```json
{
  "nexcodeKiboko.defaultProvider": "ollama",
  "nexcodeKiboko.defaultModel": "qwen2.5-coder:14b",
  "nexcodeKiboko.toolApproval": "ask",
  "nexcodeKiboko.agentModels": {
    "manager": "qwen3:8b",
    "primaryWorker": "qwen2.5-coder:14b",
    "lightweightWorker": "qwen2.5-coder:3b",
    "reasoningReviewer": "deepseek-r1:8b"
  }
}
```

### Available Ollama Models

- `qwen3:8b` - Good for planning/strategy
- `qwen2.5-coder:14b` - Best for coding
- `deepseek-r1:8b` - Good for reasoning/review

---

## Testing

### Test Structure

```
agent-core/tests/
├── orchestrator.test.ts          # Orchestrator integration
├── toolApprovalPolicy.test.ts    # Approval system
├── fileSystemTool.test.ts        # File operations
├── terminalBypasses.test.ts      # Terminal safety
├── terminalArbitraryExecution.test.ts # Code execution safety
├── batchEditSecurity.test.ts     # Batch edit safety
├── realWorldAgentFlow.test.ts    # End-to-end flows
└── ...more
```

### Running Tests

```bash
# All tests
npm test

# Specific file
npx vitest run agent-core/tests/orchestrator.test.ts

# With watch
npx vitest watch
```

---

## Build Process

```bash
# Build agent-core (TypeScript)
npm run -w agent-core build

# Build extension (webview + node)
npm run -w extension build

# Build webview only
npm run -w extension build:webview

# Build extension node code only
npm run -w extension build:node
```

---

## Commit Conventions

```
feat: add new feature        → minor bump (0.x.0)
fix: resolve bug             → patch bump (0.0.x)
breaking: change behavior    → major bump (x.0.0)
security: fix vulnerability  → patch bump
perf: optimize performance   → patch bump
docs: update documentation   → patch bump
```

---

## Auto-Versioning

```bash
node tools/auto-version.mjs
```

Analyzes git commits and:
1. Determines version bump type
2. Updates package.json
3. Updates CHANGELOG.md
4. Creates git tag

---

## Security Notes

1. **Approval system** - Destructive tools require user approval
2. **Terminal safety** - Denylist blocks dangerous commands
3. **Path validation** - Prevents directory traversal
4. **API keys** - Never sent to webview, only used in extension host

---

## Common Issues

### "Agent loop failed" errors
- Check Ollama is running: `ollama serve`
- Check model is pulled: `ollama pull qwen2.5-coder:14b`
- Check provider settings in VS Code

### Terminal commands fail
- Agent may be sending tool names instead of commands
- Use actual shell commands: `git status` not `git-status`

### Permission dialogs appear in autopilot mode
- Settings may not be applied
- Check `nexcodeKiboko.toolApproval` is set to `bypass`

---

## Development Tips

1. **Test before commit** - Always run `npm test`
2. **Build after changes** - Run `npm run build` before packaging
3. **Check types** - Run `npm run -w agent-core lint`
4. **Use conventional commits** - For auto-versioning to work
5. **Read AGENT.md** - Agent behavioral rules

---

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Ollama Documentation](https://ollama.com/library)
- [OpenCode/Crush](https://github.com/charmbracelet/crush) - Reference implementation
