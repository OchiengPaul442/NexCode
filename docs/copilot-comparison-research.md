# GitHub Copilot Architecture & Capabilities Research

> Research date: 2026-07-25
> Sources: VS Code docs (code.visualstudio.com/docs/agents/*), GitHub features page
> Purpose: Comparison baseline for enhancing NexCode

---

## 1. Activation & VS Code Integration

**How Copilot activates:**
- Built-in VS Code extension, activated via sign-in with GitHub account
- Two main surfaces: **Agents window** (dedicated cross-workspace window, agent-first) and **Chat view** (sidebar panel, code-first, workspace-scoped)
- Both surfaces share the same agent session state
- Session configuration is per-session: agent type, agent persona, language model, permission level
- Supports "Bring your own API key" for models from any provider without a Copilot subscription

**Agent types:**
| Type | Description |
|---|---|
| Local agents | Interactive in VS Code, real-time |
| Copilot CLI | Background on local machine |
| Cloud agents | Remote on GitHub infrastructure |
| Third-party agents | Anthropic, OpenAI, etc. |

**Session handoff:** Sessions can be transferred between agent types (e.g., local Plan session to cloud agent for background execution).

---

## 2. Multi-File Editing

**Copilot's approach:**
- Agent examines available tools and autonomously decides which to call per step in the agent loop
- Built-in tools include `read`, `write`, `edit`, `patch` for file operations
- All file changes surface in a **diff view** with keep/undo decisions
- **Checkpoints** allow rolling back an entire session to a previous state
- The agent tracks which files need changes and works across the workspace
- Tool approval required before file modifications execute

**Key difference from NexCode:** Copilot uses VS Code's native diff UI for review. NexCode uses a batch_edit transaction model. Both are valid approaches.

---

## 3. Context & Memory Management

### Context System
Copilot's context is assembled automatically and can be augmented:

**Automatic context:**
- Workspace indexing to include relevant files based on conversation
- Other files open in editor
- Repository/file paths for additional context
- Code selection in editor
- Frameworks, languages, dependencies detected from workspace

**Explicit context (#-mentions):**
- `#file`, `#folder`, `#symbol` - reference specific code elements
- `#codebase` - explicitly use entire codebase
- `#fetch` - retrieve web content (with URL approval)
- `#problems` - reference VS Code problems panel
- Drag-and-drop files/folders from Explorer

**@-mentions (chat participants):**
- `@vscode` - VS Code domain questions
- `@terminal` - terminal domain questions
- Extensions contribute custom chat participants

**Vision:** Attach images (screenshots, UI sketches) as context.

**Browser context:** Integrated browser can share HTML elements, screenshots, console logs with chat.

### Memory System
Two complementary memory systems:

**Local Memory Tool (on-machine):**
| Scope | Path | Persists | Use for |
|---|---|---|---|
| User | `/memories/` | Cross-session, cross-workspace | Preferences, patterns |
| Repository | `/memories/repo/` | Cross-session, workspace-scoped | Codebase conventions |
| Session | `/memories/session/` | Current session only | Task-specific context |

- First 200 lines of user memory auto-loaded into context at session start
- Agent determines appropriate scope from natural language instructions
- Commands: "Chat: Show Memory Files", "Chat: Clear All Memory Files"

**Copilot Memory (GitHub-hosted):**
- Repository-scoped, cross-agent (cloud agent, code review, CLI)
- Automatically captured by Copilot agents as they work
- Verified against current codebase before use
- Auto-expired after 28 days
- Shared across all Copilot surfaces

### Context Window Management
- **Context compaction:** Automatic summarization when context window fills up
- **Manual compaction:** `/compact` command with optional focus instructions
- **Context window control:** Visual indicator showing token usage (e.g., 15K/128K)
- **Prompt caching:** Stable context enables provider-side token reuse, lowering cost/latency

---

## 4. Terminal Command Execution

**Built-in terminal tool:**
- Single terminal tool that can execute any command
- Commands run in VS Code's integrated terminal
- Shell integration provides visibility into command lifecycle (running, finished)
- Preferred shells: PowerShell (Windows), bash/zsh (macOS/Linux) - `cmd` and `sh` have limited integration

**Terminal command approval:**
- Default: safe commands auto-approved, risky commands (rm, del) always require approval
- Configurable via `chat.tools.terminal.autoApprove` setting with allow/deny lists
- Supports regex patterns for command matching
- Per-command approval (not per-tool) because terminal tool can run any command

**Background execution:**
- Long-running commands can be pushed to background
- Agent continues with other tasks while command runs
- Agent can specify timeout; returns partial output on timeout
- Background terminals auto-cleanup when command finishes

**Agent sandboxing (preview):**
- OS-level isolation for terminal commands (macOS Seatbelt, Linux bubblewrap)
- File system isolation: reads limited to workspace + temp, writes limited to cwd
- Network isolation: all outbound blocked unless domains explicitly allowed
- Child processes inherit all restrictions
- Commands attempt in sandbox first; elevation prompt only if sandbox blocks

---

## 5. Security & Permissions

### Permission Levels
| Level | Behavior |
|---|---|
| Default Approvals | Per-tool approval prompts, respects fine-grained settings |
| Bypass Approvals | Auto-approves all tool calls, no confirmation dialogs |
| Autopilot | Auto-approves + auto-responds to questions + continuous iteration |

### Tool Approval
- Confirmation dialog shows tool name + input parameters before execution
- Approval scopes: single use, current session, current workspace, all future invocations
- `chat.tools.eligibleForAutoApproval` (org-managed) controls which tools can be auto-approved
- Separate pre-approval (before run) and post-approval (review result content) for data tools

### URL Approval (Two-Step)
1. **Pre-approval:** Confirm trust in domain being contacted
2. **Post-approval:** Review fetched content before adding to context (prevents prompt injection)
- Respects VS Code's "Trusted Domains" feature for pre-approval
- Post-approval always requires manual review regardless of domain trust

### Sandbox Agent Commands
- macOS: Apple Seatbelt (built-in, no prerequisites)
- Linux/WSL2: bubblewrap + socat
- Configurable file system rules: `allowRead`, `allowWrite`, `denyRead`, `denyWrite`
- Configurable network rules: `allowedNetworkDomains`, `denyNetworkDomains`
- Deny rules always take precedence over allow rules
- Built-in commands (git, node, npm) get automatic per-command read paths

### Sensitive File Protection
- Files like `.env` can require explicit approval for edits
- Configurable per-file-type protection

### Organization Controls
- Admins can manage: agent capabilities, MCP servers, extensions, models
- Enterprise AI policies for governance
- Audit logs for Pro+ plans
- Budget controls for AI credit usage

---

## 6. Autonomous Coding Tasks

### Autopilot Mode
- Agent keeps working autonomously until task is complete
- Auto-approves all tools
- Auto-retries on errors
- Auto-responds to clarifying questions (doesn't stall)
- **Advanced Autopilot (preview):** Separate fast model evaluates task completion after each turn

### Planning Agent
- Dedicated Plan agent creates step-by-step implementation plans
- Generates: high-level plan summary, implementation steps, verification steps
- Plan saved to session memory (`/memories/session/plan.md`)
- Can hand off to implementation agent or background CLI session
- Customizable via custom planning agents and model selection

### Subagents
- Independent AI agents for focused subtasks
- Context-isolated from parent (keeps parent context clean)
- Supports synchronous and parallel execution
- Model selection: explicit > agent-configured > parent model
- Nested subagents supported (up to depth 5, opt-in)
- Custom agents can be used as subagents with restricted tool access
- Credit cost tracking per subagent visible in chat

**Orchestration patterns:**
- Coordinator-worker pattern (planner → architect → implementer → reviewer)
- Multi-perspective parallel review (security, performance, accessibility simultaneously)
- Multi-model consensus (different models review same code)
- Recursive divide-and-conquer

### Cloud Agents
- Run on GitHub infrastructure
- Can be assigned issues directly on GitHub
- Background execution without local resources
- Session handoff from local to cloud

---

## 7. Tools & Capabilities

### Tool Types
| Type | Source | Setup |
|---|---|---|
| Built-in tools | VS Code | Immediate availability |
| MCP tools | MCP servers (local/remote) | Install/configure server |
| Extension tools | VS Code extensions | Install extension |

### Built-in Tools
- `read` - Read files
- `write` - Create/replace files
- `edit` - Targeted edits
- `patch` - Patch-style changes
- `search` - Codebase search
- `runInTerminal` - Terminal commands
- `#web/fetch` - Web content retrieval
- `#problems` - VS Code problems panel
- `#codebase` - Full codebase context
- Browser tools (integrated browser interaction)

### Tool Management
- Max 128 tools per request
- Tools picker for per-request enable/disable
- Tool sets: group related tools as single reference (`#reader`, `#search`)
- Edit tool parameters before execution
- Tool call details collapsible in chat

### Extension Points
- **Custom Instructions:** Project-wide coding standards
- **Agent Skills:** Multi-step workflow packages
- **Custom Agents:** Specialized personas (reviewer, security expert, tester)
- **MCP Servers:** External tool/data source connections
- **Hooks:** Scripts at tool lifecycle events
- **Plugins:** Pre-packaged customization bundles from Marketplace
- **Prompt Files:** Reusable prompt templates

### Browser Integration
- Integrated browser for web app preview/testing
- "Add to Chat" for HTML elements, screenshots, console logs
- Agents can navigate, click, type, take screenshots in browser
- "Share with Agent" to give agent access to existing browser session

---

## 8. Key Architectural Differences: Copilot vs NexCode

| Aspect | GitHub Copilot | NexCode |
|---|---|---|
| **Extension type** | Built-in VS Code extension | Custom extension with webview |
| **Agent runtime** | VS Code native agent host | Custom agent-core runtime |
| **Multi-file editing** | Diff view + keep/undo per file | Batch edit transactions |
| **Context** | Workspace indexing + #-mentions | Custom context management |
| **Memory** | Local file-based + GitHub-hosted | Custom memory system |
| **Terminal** | VS Code integrated terminal | Custom terminal integration |
| **Security** | OS-level sandbox + approval layers | Custom permission/risk model |
| **MCP** | Native MCP support | Custom MCP registry/adapters |
| **Multi-agent** | Subagents with context isolation | Custom orchestrator |
| **Model selection** | Per-session model choice | Multi-model role mapping |
| **Customization** | .agent.md files, prompts, hooks | Custom configuration |

---

## 9. Enhancement Opportunities for NexCode

Based on this research, potential enhancements:

1. **Context compaction** - Implement automatic conversation summarization when context fills
2. **Tool sets** - Allow grouping related tools as single references
3. **Session checkpoints** - Add rollback capability for entire sessions
4. **Browser integration** - Add web page interaction and element capture
5. **Approval scoping** - Granular per-tool approval with session/workspace/user scopes
6. **Memory scopes** - Implement user/repo/session memory hierarchy
7. **Subagent orchestration** - Coordinator-worker and parallel review patterns
8. **URL approval** - Two-step pre/post approval for web content
9. **Planning agent** - Dedicated plan-then-execute workflow
10. **Advanced autopilot** - Completion-evaluation loop with fast model
