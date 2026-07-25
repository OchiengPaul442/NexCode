# Changelog

All notable changes to NexCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-07-25

### Added

#### Subagent Fan-Out
- `WorkerPool` class for parallel agent execution with conflict isolation
- Git worktree-based workspace isolation for parallel agents
- Semaphore-based concurrency limiting
- Worker lifecycle events (started, completed, failed, cancelled)
- File set assignment for non-overlapping modifications

#### Background Workers
- `BackgroundWorker` class for long-running tasks
- Retry logic with exponential backoff (up to 3 retries)
- Cancellation via abort signals
- Progress tracking (tool calls, files modified)
- State machine: idle → running → completed/failed/cancelled

#### Code Interpreter
- Sandboxed JavaScript execution via Node.js
- Python execution support
- Timeout enforcement (configurable, default 30s)
- Minimal environment variables (no secrets leaked)
- Random temp file names to prevent TOCTOU races
- Code length limits

#### Skills as Tools
- `SkillTool` class for invoking skills from `.opencode/skills/`
- Automatic skill discovery from directory
- Skill metadata parsing from YAML frontmatter
- Structured skill execution output

#### Auto-Memory
- `AutoMemory` class for learning project conventions
- Persistent memory storage in `.opencode/memory/`
- Search functionality with relevance scoring
- Automatic pruning of old entries
- Learning from successful operations

#### Enhanced Permissions
- `EnhancedToolApprovalPolicy` with glob-pattern support
- Path-based restrictions for file operations
- Command-based restrictions for terminal operations
- Rule precedence (first match wins)

#### Path-Scoped Rules
- `PathScopedRuleManager` for context-specific instructions
- YAML frontmatter parsing for rule metadata
- Tool-specific rule filtering
- Priority-based rule ordering

### Fixed

- SQL injection vulnerability in database adapter (table name validation)
- Shell injection in hook registry (execFileSync instead of execSync)
- Shell injection in agent isolation (execFileAsync with array args)
- Windows-only xcopy replaced with cross-platform fs.cp
- Duplicated DefaultToolApprovalPolicy removed
- Test regression in mcpRegistry.test.ts
- CodeInterpreter: minimal environment variables, random temp files
- WorkerPool: merge result handling, cleanup error handling
- BackgroundWorker: error event handling (no more process crash)
- AutoMemory: ID collision fixed with randomUUID

### Changed

- Version bumped from 0.5.0 to 0.6.0
- Temperature forced to 0 for tool calls (deterministic outputs)
- Retry with exponential backoff for transient tool errors
- Verification hooks for post-execution validation
- Enhanced permission model as default
- MCP adapters (Git, Search) registered in orchestrator
- Path-scoped rules loaded and wired into agent loop

### Security

- CodeInterpreter: minimal environment variables (no secrets leaked)
- CodeInterpreter: random temp file names (TOCTOU prevention)
- CodeInterpreter: code length limits
- WorkerPool: agent ID sanitization
- AgentIsolation: cross-platform workspace copy
- All shell commands use execFile (no shell interpretation)

## [0.5.0] - 2026-07-20

### Added

- Enhanced memory system (MEMORY.md index)
- Hooks system (pre/post execution)
- Path-scoped rules
- MCP adapters (Git, Search, Database)
- Enhanced permission model with glob patterns
- Agent isolation with git worktrees
- Temperature 0 for tool calls
- Retry with exponential backoff
- Verification hooks

### Fixed

- NC-017 privileged tool protection
- Rehearsal guard for package.json content
- Terminal/search/patch/delete/append/move patterns
- JSON code block detection
- Auto-approve low-risk writes
- ToolExecuted events
- SQL injection in database adapter
- Shell injection in hook registry
- Shell injection in agent isolation
- Windows-only xcopy

### Security

- All critical vulnerabilities fixed
- SQL injection prevention
- Shell injection prevention
- Path traversal prevention
- Secret redaction

## [0.4.0] - 2026-07-15

### Added

- Initial VS Code extension
- Basic agent loop
- Tool registry
- Terminal tool with safety checks
- File system tool
- Search tool
- Git operations
- Memory system
- MCP registry

### Security

- Terminal command safety (3-layer defense)
- Path containment validation
- Secret redaction
- Approval policy

## [0.3.0] - 2026-07-10

### Added

- Basic agent capabilities
- Multi-provider support (Ollama, OpenAI-compatible)
- Context management
- Session persistence

## [0.2.0] - 2026-07-05

### Added

- VS Code extension structure
- Webview UI
- Configuration system

## [0.1.0] - 2026-07-01

### Added

- Initial project setup
- Package.json and build configuration
