# NexCode Agent Improvement Plan

## Executive Summary

**Current State**: 43% (3/7) on benchmark tests for both gemma4:31b-cloud and qwen2.5-coder:14b

**Target State**: 80%+ (6/7) on benchmark tests with enhanced agent capabilities

**Root Causes of Failures**:
1. NC-017 privileged tool protection blocks write/terminal calls when JSON is malformed
2. Rehearsal guard checks for "name" which is too broad (blocks on package.json discussion)
3. Missing patterns for list files, edit operations, and search descriptions
4. Models produce malformed JSON that can't be repaired

---

## Phase 1: Fix Core Tool Execution (80%+ Score)

### Change 1: Soften NC-017 for Poor Tool-Calling Models

**File**: `agent-core/src/agents/agentLoop.ts` (lines 1327-1352)

**Problem**: Write and terminal tools fail closed on JSON parse errors for poor tool-calling models.

**Fix**: Allow heuristic recovery for `write` and `terminal` when the model is in `POOR_TOOL_CALLING_MODELS`.

```typescript
// Replace lines 1327-1352 with:
const isPrivileged = PRIVILEGED_TOOLS.has(toolCall.function.name);
const isPoorModel = model && isPoorToolCallingModel(model);
args = {};
parseError = `Invalid JSON in tool arguments: ${toolCall.function.arguments.slice(0, 200)}`;
if (isPrivileged && !isPoorModel) {
  // Fail closed for privileged tools on capable models
} else {
  // Allow heuristic recovery for poor tool-calling models
  const pathMatch = toolCall.function.arguments.match(/["']?(?:path|filePath|file)["']?\s*[:=]\s*["']([^"']+)["']/i);
  if (pathMatch) args.path = pathMatch[1];
  const contentMatch = toolCall.function.arguments.match(/["'](?:content|text)["']?\s*[:=]\s*"([\s\S]*?)"/i);
  if (contentMatch) args.content = contentMatch[1];
  const commandMatch = toolCall.function.arguments.match(/["'](?:command|cmd)["']?\s*[:=]\s*["']([^"']+)["']/i);
  if (commandMatch) args.command = commandMatch[1];
  const queryMatch = toolCall.function.arguments.match(/["'](?:query|search)["']?\s*[:=]\s*["']([^"']+)["']/i);
  if (queryMatch) args.query = queryMatch[1];
  
  // Clear parseError if we successfully extracted args
  if (Object.keys(args).length > 0) {
    parseError = null;
  }
}
```

**Impact**: Fixes Tests 2 (write), 3 (edit via write), and 6 (terminal/list files)

### Change 2: Fix Rehearsal Guard to Not Block on "name"

**File**: `agent-core/src/agents/agentLoop.ts` (lines 1155-1157)

**Problem**: The `"name"` check is too broad. A model discussing package.json's "name" field would falsely prevent the rehearsal.

**Fix**: Change to check for tool-call JSON pattern:

```typescript
// Replace lines 1155-1157 with:
!response.text.includes("TOOL:") &&
!response.text.includes("```json") &&
!/(?:\"name\"\s*:\s*\"(?:read|write|terminal|search|patch|delete|test|git-status|git-diff))/i.test(response.text);
```

**Impact**: Prevents the rehearsal from being skipped when the model discusses file contents

### Change 3: Add More Robust Terminal Command Detection

**File**: `agent-core/src/agents/agentLoop.ts` (lines 753-769)

**Add these patterns to terminalPatterns array:**

```typescript
// Without backticks — model just says the command
/(?:run|execute|launch|start)\s+(?:the\s+)?(?:command\s+)?(?:npm|npx|node|yarn|pnpm|pip|cargo|go|make|docker)\s+([^\n.]+)/i,
// List files without explicit "run command" prefix
/(?:list|show|display)\s+(?:all\s+)?(?:the\s+)?(?:files?|directory|folder|contents?)/i,
// "Let me try running"
/(?:try|attempt)\s+(?:running|executing)\s+(?:the\s+)?(?:command|shell)?\s*`([^`]+)`/i,
// "Now I'll run"
/(?:Now|Then|Next),?\s+(?:I(?:'ll| will)?)?\s+(?:run|execute)\s+`([^`]+)`/i,
// "Let's run"
/(?:Let(?:'s| us))\s+(?:run|execute)\s+`([^`]+)`/i,
```

**Add new listPatterns array:**

```typescript
// List files patterns
const listPatterns = [
  /(?:list|show|display)\s+(?:all\s+)?(?:the\s+)?(?:files?|directory|folder|contents?)\s+(?:in\s+)?(?:the\s+)?(?:workspace|directory|folder|project)/i,
  /(?:list|show|display)\s+(?:all\s+)?(?:the\s+)?(?:files?|directory|folder|contents?)/i,
];
for (const pattern of listPatterns) {
  const match = text.match(pattern);
  if (match && available.has("terminal")) {
    return { toolName: "terminal", args: { command: "ls" } };
  }
}
```

**Impact**: Helps Test 6 (list files) when the model describes the action without using tool-call format

### Change 4: Improve "Proposed Edit" Detection for Edit Tasks

**File**: `agent-core/src/agents/agentLoop.ts` (lines 365-408)

**Add these patterns to proposedEditPatterns array:**

```typescript
// Model says "I'll add X to file"
/(?:I(?:'ll| will)\s+)?(?:add|insert|append)\s+(?:a\s+)?(?:new\s+)?(?:script|entry|section|line)\s+(?:called\s+)?[`"']?([^\s`"']+)[`"']?\s+(?:to|in|into)\s+[`"']?([^\s`"']+)[`"']?/i,
// Model says "Add to package.json"
/(?:add|insert|append)\s+(?:a\s+)?(?:new\s+)?(?:script\s+)?(?:called\s+)?[`"']?([^\s`"']+)[`"']?\s+(?:to|in|into)\s+[`"']?([^\s`"']+)[`"']?/i,
// Model says "I'll update/modify file.ts"
/(?:I(?:'ll| will)|let me)\s+(?:update|modify|edit|change|replace)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
// "Edit file:"
/(?:Edit|Modify|Update)\s+(?:file|path)\s*:\s*[`"']?([^\s`"']+)[`"']?/i,
```

**Impact**: Helps Test 3 (edit package.json) when the model describes the edit instead of using a tool call

### Change 5: Improve Search Extraction from Text

**File**: `agent-core/src/agents/agentLoop.ts` (lines 821-831)

**Add these patterns to searchPatterns array:**

```typescript
// Search for file types
/(?:search|find|grep|look\s+for|scan)\s+(?:for\s+)?(?:any\s+)?(?:TypeScript|\.ts|\.js|\.py|\.java|\.go|\.rs)\s+(?:files?|code)\s+(?:in\s+)?(?:the\s+)?(?:workspace|directory)/i,
// Generic search mention
/(?:search|find|grep)\s+(?:for\s+)?[`"']?([^\s`"']+)[`"']?/i,
// "Find all X files"
/(?:find|locate)\s+(?:all\s+)?(?:the\s+)?(?:TypeScript|\.ts|\.js|\.py|\.java|\.go|\.rs)\s+(?:files?)/i,
```

**Impact**: Helps Test 7 (search for patterns)

### Change 6: Add Patch Patterns for Edit Operations

**File**: `agent-core/src/agents/agentLoop.ts` (after line 818)

**Add new patchPatterns array:**

```typescript
// Patch/edit file patterns
const patchPatterns = [
  // "update/modify/replace X by replacing Y with Z"
  /(?:update|modify|edit|change|replace|fix)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+(?:by\s+)?(?:replacing|changing|updating)\s+`([^`]+)`\s+(?:with|to)\s+`([^`]+)`/i,
  /(?:I(?:'ll| will)|let me)\s+(?:update|modify|edit|change|replace|fix)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+(?:by\s+)?(?:replacing|changing|updating)\s+`([^`]+)`\s+(?:with|to)\s+`([^`]+)`/i,
  // "replace X with Y in file"
  /(?:replace|change|update)\s+`([^`]+)`\s+(?:with|to)\s+`([^`]+)`\s+(?:in|inside|of)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  // "I'll update file" (without explicit old/new)
  /(?:I(?:'ll| will)|let me|now)\s+(?:update|modify|edit|change|fix)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  /(?:update|modify|edit|change|fix)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
];

for (const pattern of patchPatterns) {
  const match = text.match(pattern);
  if (match && available.has("patch")) {
    if (match[3]) {
      return {
        toolName: "patch",
        args: { path: match[1].trim(), oldText: match[2].trim(), newText: match[3].trim() },
      };
    }
    return { toolName: "patch", args: { path: match[1].trim(), oldText: "", newText: "" } };
  }
}
```

**Impact**: Enables patch tool detection for edit operations

### Change 7: Add Delete Patterns

**File**: `agent-core/src/agents/agentLoop.ts` (after patch patterns)

**Add new deletePatterns array:**

```typescript
// Delete file patterns
const deletePatterns = [
  /(?:delete|remove|trash|unlink)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  /(?:I(?:'ll| will)|let me)\s+(?:delete|remove|trash|unlink)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  /(?:now|then|next),?\s+(?:I(?:'ll| will)?)?\s+(?:delete|remove|trash|unlink)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
];

for (const pattern of deletePatterns) {
  const match = text.match(pattern);
  if (match && available.has("delete")) {
    return { toolName: "delete", args: { path: match[1].trim() } };
  }
}
```

**Impact**: Enables delete tool detection

### Change 8: Add Append Patterns

**File**: `agent-core/src/agents/agentLoop.ts` (after delete patterns)

**Add new appendPatterns array:**

```typescript
// Append to file patterns
const appendPatterns = [
  /(?:append|add)\s+(?:to\s+)?(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s*[:：]\s*`([^`]+)`/i,
  /(?:I(?:'ll| will)|let me)\s+(?:append|add)\s+(?:to\s+)?(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  /(?:append|add)\s+`([^`]+)`\s+to\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
];

for (const pattern of appendPatterns) {
  const match = text.match(pattern);
  if (match && available.has("append")) {
    if (pattern.source.includes("`([^`]+)`\\s+to")) {
      return { toolName: "append", args: { path: match[2].trim(), content: match[1].trim() } };
    }
    return { toolName: "append", args: { path: match[1].trim(), content: match[2]?.trim() ?? "" } };
  }
}
```

**Impact**: Enables append tool detection

### Change 9: Add Move Patterns

**File**: `agent-core/src/agents/agentLoop.ts` (after append patterns)

**Add new movePatterns array:**

```typescript
// Move/rename file patterns
const movePatterns = [
  /(?:move|rename)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+to\s+[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
  /(?:I(?:'ll| will)|let me)\s+(?:move|rename)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?\s+to\s+[`"']?([^\s`"'.]+(?:\.\w+)?)[`"']?/i,
];

for (const pattern of movePatterns) {
  const match = text.match(pattern);
  if (match && available.has("move")) {
    return { toolName: "move", args: { source: match[1].trim(), destination: match[2].trim() } };
  }
}
```

**Impact**: Enables move tool detection

### Change 10: Update guessSuggestedTool Keywords

**File**: `agent-core/src/agents/agentLoop.ts` (lines 715-727)

**Replace the keywordPatterns array:**

```typescript
const keywordPatterns: Array<{ keywords: string[]; tool: string }> = [
  // Read
  { keywords: ["read file", "read the file", "file contents", "show file", "open file", "what's in", "what is in", "view file", "cat "], tool: "read" },
  // Write
  { keywords: ["write file", "create file", "write to file", "make file", "generate file", "new file"], tool: "write" },
  // Terminal
  { keywords: ["run command", "execute command", "shell command", "terminal", "run `", "execute `", "let me run", "try running", "list files", "show files"], tool: "terminal" },
  // Search
  { keywords: ["search for", "find in", "grep", "search files", "look for", "find all", "find typescript", "find javascript"], tool: "search" },
  // Patch
  { keywords: ["patch file", "edit file", "modify file", "update file", "change file", "replace in", "replacing", "edit the", "modify the", "update the", "change the", "add script to", "add entry to"], tool: "patch" },
  // Delete
  { keywords: ["delete file", "remove file", "delete the", "remove the", "trash file"], tool: "delete" },
  // Append
  { keywords: ["append to", "add to file", "append to file", "add to the file"], tool: "append" },
  // Move
  { keywords: ["move file", "rename file", "move the", "rename the"], tool: "move" },
  // Git (maps to terminal)
  { keywords: ["git status", "git diff", "git log", "git show", "git branch", "check status", "show changes"], tool: "terminal" },
  // Test
  { keywords: ["run test", "execute test", "test suite", "run tests"], tool: "test" },
];
```

**Impact**: Ensures guessSuggestedTool and detectDescribedAction have matching capabilities

---

## Phase 2: Add Missing Agent Capabilities

### 2.1 Memory System

**Current State**: Basic `AgentNotesManager` writes to `NOTES.md`

**Enhancement**: Implement Claude Code-style auto memory

**Implementation**:
- Create `memory/MEMORY.md` as index file
- Add topic-specific memory files
- Implement memory indexing for fast retrieval
- Add memory pruning to keep under 200 lines

**Files to modify**:
- `agent-core/src/memory/memoryManager.ts`
- `agent-core/src/agents/agentLoop.ts`

### 2.2 Context Compaction

**Current State**: `ContextCompressor` exists but is basic

**Enhancement**: Implement automatic context compaction that preserves root instructions

**Implementation**:
- Detect when context window is approaching limit
- Compact older messages while preserving system prompt and recent context
- Re-inject root instructions after compaction
- Add `/compact` command for manual triggering

**Files to modify**:
- `agent-core/src/utils/contextCompressor.ts`
- `agent-core/src/agents/agentLoop.ts`

### 2.3 Path-Scoped Rules

**Current State**: Not implemented

**Enhancement**: Implement `.claude/rules/` style path-specific instructions

**Implementation**:
- Create `rules/` directory with YAML frontmatter
- Load rules only when matching files are accessed
- Support glob patterns for path matching
- Merge rules with system prompt contextually

**Files to create**:
- `agent-core/src/rules/ruleLoader.ts`
- `agent-core/src/rules/ruleEvaluator.ts`

### 2.4 Hooks System

**Current State**: Not implemented

**Enhancement**: Add PreToolUse/PostToolUse lifecycle hooks

**Implementation**:
- Define hook interface with before/after methods
- Allow hooks for tool validation, auto-formatting, logging
- Support hooks in `opencode.json` config
- Add hook execution in tool registry

**Files to create**:
- `agent-core/src/hooks/hookRegistry.ts`
- `agent-core/src/hooks/hookExecutor.ts`

---

## Phase 3: Implement MCP Protocol Support

### 3.1 Replace Adapter Pattern with Real MCP SDK

**Current State**: Custom `McpAdapter` interface (simplified)

**Enhancement**: Adopt `@modelcontextprotocol/sdk`

**Implementation**:
- Install `@modelcontextprotocol/sdk`
- Replace `McpAdapter` with MCP client
- Support stdio, http, sse transports
- Implement tool discovery via `tools/list`
- Add resource support via `resources/read`

**Files to modify**:
- `agent-core/src/mcp/mcpRegistry.ts`
- `agent-core/src/mcp/adapters/filesystemAdapter.ts`

### 3.2 MCP Server Management

**Enhancement**: Add MCP server lifecycle management

**Implementation**:
- Auto-discover MCP servers from config
- Start/stop servers on demand
- Handle server crashes and reconnection
- Add server health monitoring

**Files to create**:
- `agent-core/src/mcp/serverManager.ts`

---

## Phase 4: Add High-Value Plugins

### 4.1 Git MCP Server

**Priority**: High (essential for code agent)

**Implementation**:
- Implement Git operations via MCP
- Support commits, branches, PRs, staging
- Add git log, diff, show operations
- Integrate with existing GitTool

**Files to create**:
- `agent-core/src/mcp/servers/gitServer.ts`

### 4.2 Database MCP Server

**Priority**: High (enables data operations)

**Implementation**:
- Support PostgreSQL and SQLite
- Read-only queries with schema inspection
- Add query builder for safe queries
- Support connection pooling

**Files to create**:
- `agent-core/src/mcp/servers/databaseServer.ts`

### 4.3 Search MCP Server

**Priority**: High (enables web research)

**Implementation**:
- Integrate Tavily/Exa Search APIs
- Support web search with citations
- Add content extraction from URLs
- Support search filtering

**Files to create**:
- `agent-core/src/mcp/servers/searchServer.ts`

### 4.4 Browser Automation MCP Server

**Priority**: Medium (enables web interaction)

**Implementation**:
- Integrate Puppeteer for browser control
- Support page navigation, screenshots
- Add form filling and clicking
- Support headless and headed modes

**Files to create**:
- `agent-core/src/mcp/servers/browserServer.ts`

---

## Phase 5: Implement Advanced Features

### 5.1 Agent Teams

**Enhancement**: Implement task-based coordination between agents

**Implementation**:
- Add TaskCreate/TaskUpdate tools
- Support agent-to-agent messaging
- Implement task dependencies
- Add progress tracking

**Files to create**:
- `agent-core/src/agents/agentTeam.ts`
- `agent-core/src/agents/taskManager.ts`

### 5.2 Agent Isolation

**Enhancement**: Add `isolation: worktree` for subagents

**Implementation**:
- Create git worktree for each subagent
- Isolate file changes between agents
- Merge changes on completion
- Handle conflicts automatically

**Files to create**:
- `agent-core/src/agents/agentIsolation.ts`

### 5.3 Enhanced Permission Model

**Enhancement**: Adopt glob-pattern permission rules

**Implementation**:
- Define permissions in `opencode.json`
- Support `allow`/`ask`/`deny` per tool
- Add glob patterns for file access
- Implement doom loop detection

**Files to modify**:
- `agent-core/src/tools/toolApprovalPolicy.ts`

---

## Testing Strategy

### Unit Tests
- Add tests for all new regex patterns in `detectDescribedAction`
- Test NC-017 softening for poor tool-calling models
- Test rehearsal guard fix

### Integration Tests
- Run benchmark tests with gemma4:31b-cloud
- Run benchmark tests with qwen2.5-coder:14b
- Test MCP server integration
- Test memory system persistence

### Manual Testing
- Test with real coding tasks
- Verify tool execution flows
- Check context management
- Validate security boundaries

---

## Implementation Order

1. **Phase 1** (Week 1): Fix core tool execution
   - Change 1-10 from Phase 1
   - Run benchmark tests
   - Verify 80%+ score

2. **Phase 2** (Week 2): Add agent capabilities
   - Memory system
   - Context compaction
   - Path-scoped rules
   - Hooks system

3. **Phase 3** (Week 3): Implement MCP protocol
   - Replace adapter pattern
   - Add server management

4. **Phase 4** (Week 4): Add plugins
   - Git MCP server
   - Database MCP server
   - Search MCP server
   - Browser automation MCP server

5. **Phase 5** (Week 5): Advanced features
   - Agent teams
   - Agent isolation
   - Enhanced permissions

---

## Success Metrics

### Phase 1 Success
- [ ] gemma4:31b-cloud scores 80%+ (6/7 tests)
- [ ] qwen2.5-coder:14b scores 80%+ (6/7 tests)
- [ ] All existing tests continue to pass

### Phase 2 Success
- [ ] Memory system persists across sessions
- [ ] Context compaction reduces token usage by 50%
- [ ] Path-scoped rules load correctly
- [ ] Hooks execute before/after tools

### Phase 3 Success
- [ ] MCP SDK integrated successfully
- [ ] Tool discovery works via MCP
- [ ] Server lifecycle management functional

### Phase 4 Success
- [ ] Git MCP server operations work
- [ ] Database MCP server queries execute
- [ ] Search MCP server returns results
- [ ] Browser automation MCP server navigates pages

### Phase 5 Success
- [ ] Agent teams coordinate tasks
- [ ] Agent isolation prevents conflicts
- [ ] Permission model enforces rules

---

## Risk Assessment

### High Risk
- **NC-017 softening**: May allow malicious tool calls if regex extraction is too permissive
  - Mitigation: Validate extracted args against tool schema

### Medium Risk
- **MCP SDK integration**: May break existing MCP functionality
  - Mitigation: Gradual migration with fallback to adapter pattern

### Low Risk
- **New patterns**: May cause false positives in tool detection
  - Mitigation: Extensive testing with real model outputs

---

## Conclusion

This plan provides a comprehensive roadmap to:
1. Fix core tool execution to reach 80%+ scores
2. Add modern agent capabilities
3. Implement MCP protocol support
4. Add high-value plugins
5. Implement advanced features

The phased approach ensures each improvement is tested and validated before moving to the next phase. Success metrics provide clear targets for each phase.
