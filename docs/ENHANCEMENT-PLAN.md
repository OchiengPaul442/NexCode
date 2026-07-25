# NexCode Enhancement Plan: Meeting Helios Control Plane Benchmark

## Executive Summary

NexCode is a VS Code extension for AI coding assistance. To meet the Helios Control Plane benchmark, it needs significant enhancements to support autonomous application development. This plan outlines 8 phases of enhancements based on research from GitHub Copilot, Claude Code, and modern autonomous coding agents.

---

## Current State Analysis

### What NexCode Has

| Capability | Status | Quality |
|------------|--------|---------|
| File operations | ✅ Implemented | Strong |
| Terminal commands | ✅ Implemented | Strong |
| Git operations | ✅ Implemented | Strong |
| Search operations | ✅ Implemented | Strong |
| Security controls | ✅ Implemented | Strong (2145 tests) |
| Memory system | ✅ Implemented | Good |
| MCP adapters | ✅ Implemented | Basic |

### What NexCode Lacks (Required by Benchmark)

| Capability | Status | Priority |
|------------|--------|----------|
| Subagent fan-out | ❌ Missing | P0 |
| Background workers | ❌ Missing | P0 |
| Database operations | ⚠️ Basic MCP only | P1 |
| Concurrent execution | ❌ Sequential only | P1 |
| Permission profiles | ⚠️ Basic only | P1 |
| Code interpreter | ❌ Missing | P2 |
| Skills as tools | ⚠️ Basic only | P2 |
| Auto-memory | ⚠️ Basic only | P2 |
| Browser automation | ❌ Missing | P3 |

---

## Enhancement Phases

### Phase 1: Subagent Fan-Out with Conflict Isolation (P0)

**Goal**: Enable parallel execution of multiple agents with conflict isolation.

**Implementation**:

1. **WorkerPool class** (`agent-core/src/agents/workerPool.ts`):
   - Manage concurrent agent execution
   - Unique agent IDs per run
   - Cancellation tokens per agent
   - Structured result aggregation
   - Conflict isolation via worktrees

2. **Agent-as-tool pattern**:
   - Wrap agents as tools for other agents
   - Support fan-out (parallel subagents)
   - Support fan-in (result merging)

3. **Conflict isolation**:
   - Git worktree per agent (already implemented in `agentIsolation.ts`)
   - File locking for shared resources
   - Non-overlapping file sets

**Files to create/modify**:
- `agent-core/src/agents/workerPool.ts` (new)
- `agent-core/src/agents/agentLoop.ts` (modify)
- `agent-core/src/orchestrator.ts` (modify)

---

### Phase 2: Background Worker Lifecycle Management (P0)

**Goal**: Enable long-running background tasks with proper lifecycle management.

**Implementation**:

1. **BackgroundWorker class** (`agent-core/src/agents/backgroundWorker.ts`):
   - Spawn agents with persistent state
   - Support cancellation via abort signals
   - Emit progress events for UI consumption
   - Store intermediate results in evidenceStore
   - Timeout with graceful shutdown (SIGTERM then SIGKILL)

2. **Worker states**:
   - `idle` → `running` → `completed`/`failed`/`cancelled`
   - Visibility timeouts for job claiming
   - Retry with exponential backoff

3. **Integration with extension**:
   - Webview displays worker status via message passing
   - Progress events streamed to UI
   - Worker logs accessible through sidebar

**Files to create/modify**:
- `agent-core/src/agents/backgroundWorker.ts` (new)
- `extension/src/sidebarViewProvider.ts` (modify)

---

### Phase 3: Database Adapter Tool (P1)

**Goal**: Provide first-class database operations for the agent.

**Implementation**:

1. **Enhanced DatabaseAdapter** (`agent-core/src/mcp/adapters/databaseAdapter.ts`):
   - Support PostgreSQL via `pg` library
   - Support SQLite via `better-sqlite3`
   - Structured queries with read-only vs write risk levels
   - Connection pooling
   - Automatic transaction rollback on failure

2. **Risk classification**:
   - Read-only queries → `read-only` (auto-approved)
   - Writes → `destructive` (require approval)
   - DDL → `destructive` (require approval)

3. **MCP integration**:
   - Register as MCP server
   - Tool discovery via `tools/list`
   - Schema inspection via `describe-table`

**Files to create/modify**:
- `agent-core/src/mcp/adapters/databaseAdapter.ts` (enhance)
- `agent-core/src/tools/toolDefinitions.ts` (add database tools)

---

### Phase 4: Enhanced Permission Profiles (P1)

**Goal**: Granular control over tool execution per task type.

**Implementation**:

1. **Permission profiles**:
   - `suggest` mode: Only read operations, no writes
   - `auto-edit` mode: Auto-approve safe writes, ask for destructive
   - `full-auto` mode: Auto-approve all operations
   - Custom profiles per tool

2. **Per-tool permissions**:
   - Allow/deny lists per tool
   - Path-based restrictions
   - Command-based restrictions
   - Time-based restrictions

3. **Integration with approval policy**:
   - EnhancedToolApprovalPolicy supports profiles
   - Profiles can be set per agent or per task

**Files to create/modify**:
- `agent-core/src/tools/enhancedApprovalPolicy.ts` (enhance)
- `extension/src/sidebarViewProvider.ts` (add profile selector)

---

### Phase 5: Code Interpreter (Sandboxed) (P2)

**Goal**: Enable safe code execution for calculations and data processing.

**Implementation**:

1. **CodeInterpreter tool** (`agent-core/src/tools/codeInterpreter.ts`):
   - Execute JavaScript/TypeScript in sandboxed VM
   - Execute Python via child process
   - Input/output capture
   - Timeout enforcement
   - Resource limits (memory, CPU)

2. **Sandboxing**:
   - Node.js `vm` module for JS execution
   - Restricted filesystem access
   - No network access by default
   - Process isolation for Python

3. **Use cases**:
   - Financial calculations with exact precision
   - Data transformation
   - Test execution
   - Script generation

**Files to create/modify**:
- `agent-core/src/tools/codeInterpreter.ts` (new)
- `agent-core/src/tools/toolDefinitions.ts` (add code_interpreter tool)

---

### Phase 6: Skills as Invokable Tools (P2)

**Goal**: Make skills callable as tools, not just loaded as context.

**Implementation**:

1. **Skill-as-tool pattern**:
   - Each skill becomes a tool in the registry
   - Skills can be invoked with parameters
   - Skills can compose other skills

2. **Skill registry**:
   - Auto-discover skills from `.opencode/skills/`
   - Register as tools in ToolRegistry
   - Skill metadata (name, description, parameters)

3. **Skill execution**:
   - Load skill instructions
   - Execute skill workflow
   - Return structured results

**Files to create/modify**:
- `agent-core/src/tools/skillTool.ts` (new)
- `agent-core/src/tools/toolRegistry.ts` (modify)

---

### Phase 7: Auto-Memory Across Sessions (P2)

**Goal**: Agent learns project conventions without explicit configuration.

**Implementation**:

1. **Auto-memory system**:
   - Track file patterns, coding conventions, project structure
   - Learn from successful operations
   - Store in `.opencode/memory/` directory
   - Index for fast retrieval

2. **Memory types**:
   - File patterns (imports, exports, naming)
   - Coding conventions (style, patterns)
   - Project structure (directories, configs)
   - Successful workflows (tool sequences)

3. **Memory injection**:
   - Load relevant memory at session start
   - Update memory after successful operations
   - Prune old or low-value memories

**Files to create/modify**:
- `agent-core/src/memory/autoMemory.ts` (new)
- `agent-core/src/agents/agentLoop.ts` (modify)

---

### Phase 8: Browser Automation (P3)

**Goal**: Enable web interaction for testing and research.

**Implementation**:

1. **BrowserTool** (`agent-core/src/tools/browserTool.ts`):
   - Navigate to URLs
   - Click elements
   - Fill forms
   - Take screenshots
   - Extract text/HTML

2. **Integration**:
   - Use Puppeteer or Playwright
   - Headless mode by default
   - Screenshot capture for verification
   - Console log capture

3. **Security**:
   - URL allowlisting
   - No credential exposure
   - Sandbox mode

**Files to create/modify**:
- `agent-core/src/tools/browserTool.ts` (new)
- `agent-core/src/tools/toolDefinitions.ts` (add browser tools)

---

## Implementation Timeline

| Phase | Duration | Dependencies | Risk |
|-------|----------|--------------|------|
| Phase 1: Subagent fan-out | 2 weeks | AgentIsolation | Medium |
| Phase 2: Background workers | 2 weeks | Phase 1 | Medium |
| Phase 3: Database adapter | 1 week | None | Low |
| Phase 4: Permission profiles | 1 week | None | Low |
| Phase 5: Code interpreter | 2 weeks | None | Medium |
| Phase 6: Skills as tools | 1 week | None | Low |
| Phase 7: Auto-memory | 1 week | Memory system | Low |
| Phase 8: Browser automation | 2 weeks | None | Medium |
| **Total** | **12 weeks** | | |

---

## Expected Impact on Benchmark

### Before Enhancements

| Benchmark Requirement | NexCode Status |
|-----------------------|----------------|
| Multi-tenant isolation | ❌ Not applicable |
| Authentication/Authorization | ❌ Not applicable |
| Database operations | ⚠️ Basic MCP |
| Concurrent processing | ❌ Sequential only |
| Background workers | ❌ Missing |
| Financial calculations | ❌ No domain logic |
| Web dashboard | ❌ No React/Next.js |
| Audit logging | ⚠️ Basic only |
| Reconciliation | ❌ Missing |

### After Enhancements

| Benchmark Requirement | NexCode Status |
|-----------------------|----------------|
| Multi-tenant isolation | ⚠️ Via workspace isolation |
| Authentication/Authorization | ⚠️ Via approval policy |
| Database operations | ✅ Enhanced MCP adapter |
| Concurrent processing | ✅ Subagent fan-out |
| Background workers | ✅ BackgroundWorker class |
| Financial calculations | ✅ Code interpreter |
| Web dashboard | ⚠️ Via webview |
| Audit logging | ✅ Enhanced audit |
| Reconciliation | ⚠️ Via code interpreter |

---

## Testing Strategy

### Unit Tests
- Add tests for each new module
- Test error handling and edge cases
- Test security boundaries

### Integration Tests
- Test subagent fan-out with conflict isolation
- Test background worker lifecycle
- Test database operations
- Test permission profiles

### Benchmark Tests
- Run against Helios Control Plane benchmark
- Measure score improvement
- Identify remaining gaps

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Benchmark score | 80%+ |
| Unit test coverage | 90%+ |
| Security test coverage | 95%+ |
| Integration test coverage | 80%+ |
| Documentation completeness | 90%+ |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Architecture complexity | Incremental implementation, thorough testing |
| Performance impact | Benchmark each phase, optimize hot paths |
| Security regressions | Security tests for every change |
| Breaking changes | Backward compatibility checks |
| Timeline slippage | Prioritize P0 phases, defer P3 if needed |

---

## Conclusion

This enhancement plan transforms NexCode from a VS Code coding assistant into a more capable autonomous coding agent. The key additions are:

1. **Subagent fan-out** for parallel execution
2. **Background workers** for long-running tasks
3. **Database adapter** for data operations
4. **Permission profiles** for granular control
5. **Code interpreter** for calculations
6. **Skills as tools** for reusable workflows
7. **Auto-memory** for learning conventions
8. **Browser automation** for web interaction

With these enhancements, NexCode should be able to handle the Helios Control Plane benchmark requirements while maintaining its existing strengths in security, testing, and code quality.
