# Changelog

## 0.3.0

**Date:** 2026-07-25
**Previous version:** 0.2.1

### Tool Calling Reliability
- Improved Ollama provider error recovery for malformed JSON responses
- Added "Proposed Edit" format detection in text-to-tool-call extraction
- Fixed tool argument separator from `::` to `|||` for write/append/move/patch operations
- Added blocked command detection with proper refusal messages
- Improved JSON parse error handling with retry limits

### Prompt Engineering
- Added few-shot examples to coder system prompt for better tool calling
- Improved tool schema parameter names to match runtime expectations
- Added explicit JSON format instructions for models with weak tool calling

### Agent Loop Improvements
- Never drop tools on retry - always pass tool schemas to the model
- Added `fallbackToText` detection to prevent infinite retry loops
- Improved nudge messages with specific JSON format examples
- Better validation error messages with expected schema information

### Model Compatibility
- Added support for models with poor tool calling (qwen2.5-coder, gpt-oss)
- Improved text-to-tool-call extraction for multiple output formats
- Better handling of models that generate malformed JSON

### Project Cleanup
- Removed agent-bench-workspace (embedded benchmark repository)
- Removed dead extensibility scaffolding
- Removed redundant test files
- Updated documentation and changelogs

## 0.2.1

**Date:** 2026-07-17
**Previous version:** 0.2.0

### Documentation
- Added AGENT.md, CLAUDE.md, and auto-version script

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

### Added
- Backend-enforced tool approval policy
- Dynamic reasoning display
- File attachment support
- Multi-agent subagent capability
- Token efficiency tracking
- Context compression
- Batch edit operations
- Mode selector (Build/Ask/Plan)
- Response summary with stats
- CI workflow badge and status indicators
- Test count badge (62 tests across 8 files)
- Version and license badges

### Changed
- Improved input component design
- Removed bulky execution trace panel
- Cleaned up project structure
- Updated documentation
- Restructured README with streamlined features, configuration, and quick start sections
- Added configuration examples for Ollama, OpenCode Go, and HuggingFace providers

### Fixed
- API keys no longer sent to webview
- CSP nonce uses crypto.randomBytes
- Memory files excluded from git
- VSIX size reduced to 6 MB

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
