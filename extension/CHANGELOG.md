# Changelog

## 0.2.0

### Security Hardening
- Fixed SAFE_PATTERNS allowing arbitrary code execution via npm run, npm install, node, python, npx, pip
- Added node -e, python -c, python3 -c to blocked patterns
- Fixed batch_edit to use ensureNotWorkspaceRoot and resolveWorkspacePathSafe
- Added approvedCalls Set to ToolRegistry for persistent approval state
- Fixed symlink parent escape in resolveWorkspacePathSafe
- Fixed clearDirectory to validate entries against workspace

### Agent Improvements
- Made agent loop universal across all modes (pipeline stages now use agent loop)
- Added schema validation with errors fed back to model
- Added retry logic with exponential backoff for provider errors
- Fixed Ollama malformed JSON handling
- Broadened isSimpleQuestion to catch conversational questions
- Updated system prompts to tell model when NOT to use tools
- Added slash command detection to skip simple question logic

### Permission Modes
- Fixed autopilot mode to read current settings each time (not captured in closure)
- Both approval paths (callback and event) check permission mode correctly
- Added auto/ask/bypass permission modes with proper descriptions
- Terminal tool rejects tool names (git-status, git-diff, etc.) as shell commands

### Multi-Agent Model Configuration
- Added agentModels config with manager, primaryWorker, lightweightWorker, reasoningReviewer
- Added getModelForMode() function for per-mode model selection
- Added VS Code settings for per-mode model selection
- Available models: qwen3:8b, deepseek-r1:8b, qwen2.5-coder:14b

### UI Improvements
- Collapsible/expandable todo list (OpenCode-style)
- Collapsible tool execution cards with left-border grouping
- Work summary component showing files, duration, success/fail count
- Auto-expanding textarea (32px min, 180px max)
- Both send and stop buttons visible simultaneously
- Queue only shows when items are genuinely pending
- Auto-clear finished queue items after 3 seconds
- Removed layout animation on prompt submit

### Web Search
- Replaced DuckDuckGo Instant Answer API with HTML lite endpoint
- Returns actual search results (title, URL, snippet)
- No API key required for basic web search

### Build System
- Switched from tsc to esbuild for extension bundling
- Extension.js now bundles all dependencies

### Testing
- Added 41 new tests (terminalArbitraryExecution, batchEditSecurity, realWorldAgentFlow)
- All 165 tests passing
- Platform-aware tests for Windows/Linux

### Project Cleanup
- Deleted useless outside-1784301654103/ directory
- Deleted placeholder ui/ folder

## 0.1.47

- Added CI workflow badge and status indicators to README.
- Added test count badge (62 tests across 8 files).
- Added version and license badges.
- Restructured README with streamlined features, configuration, and quick start sections.
- Added configuration examples for Ollama, OpenCode Go, and HuggingFace providers.

## 0.1.22

- Rebuilt sidebar UX to a Copilot-style layout with session list, model/provider/mode top bar, and cleaner chat composition flow.
- Added dynamic model dropdown sourced from provider model APIs and persisted model/provider/mode per session.
- Added live provider connectivity badge with latency and refresh actions.
- Added settings panel with temperature, reasoning visibility, auto-apply toggle, and terminal approval toggle.
- Added drag-and-drop attachments and attachment preview chips.
- Added smoother streaming experience with thinking indicator and buffered token rendering.
- Added structured markdown rendering for assistant responses and collapsible reasoning/debug panels.
- Added robust staging-based release packaging to guarantee runtime dependencies are present in VSIX installs.

## 0.1.13

- Added sidebar chat experience with streaming, attachments, and approval workflow.
- Added web search (`/tool web-search`) with Tavily and fallback engines.
- Added reasoning trace and terminal confirmation controls.
- Improved packaging scripts and maintenance docs.
