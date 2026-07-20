# NexCode Remediation Work Queue

**Generated:** 20 July 2026  
**Source:** NEXCODE_FULL_CODERABBIT_STYLE_REVIEW.md  
**Total findings:** 45  
**Ordering:** Severity (Critical > High > Medium), then dependency order within each tier, then blast radius.

---

## P0 — Release Blockers (Critical) — NC-001 through NC-008

### NC-001 — One API key transmitted to every configured cloud provider
- **Severity:** Critical
- **Status:** fixed
- **Phase:** 0 / containment
- **Dependencies:** none
- **Affected files:** `agent-core/src/orchestrator.ts:129-213,373-381`
- **Verified:** yes — verified against current source; eager cross-provider checks removed
- **Required tests:** provider key isolation: assert canary key for provider A is never observed by provider B; lazy provider construction; no eager health-check at construction
- **Verification commands:** `npx vitest run agent-core/tests/providerKeyIsolation.test.ts`
- **Resolution evidence:** `agent-core/src/orchestrator.ts` changed: (1) `providerCheckPromise` initialized to `null` instead of eagerly set in constructor. (2) Removed 4-line eager `checkProviders()` call from constructor. (3) `getProviderStatus()` now lazily creates the check promise on first invocation. 5 regression tests added in `agent-core/tests/providerKeyIsolation.test.ts`: no eager checks at construction, canary key not leaked, lazy single-check, cross-provider isolation, instance isolation. Full test suite: 465/465 pass. Build clean. Type-check clean.
- **Remaining risk:** The same `openAIApiKey` is still passed to all cloud provider constructors (Phase D will introduce per-provider credentials). The containment patch eliminates the eager cross-provider network calls that were the primary attack vector.

### NC-002 — Malicious workspace can redirect authenticated provider probe
- **Severity:** Critical
- **Status:** fixed
- **Phase:** 0 / containment
- **Dependencies:** NC-001 (provider endpoint trust)
- **Affected files:** `extension/src/sidebarViewProvider.ts:1103-1177,1200-1233,1256-1305,1405-1411`, `extension/package.json:184-186`
- **Verified:** yes — verified against current source; auto-probing removed, URL validation added, trust declaration corrected
- **Required tests:** workspace-controlled base URL cannot receive stored key; untrusted workspace blocks authenticated network calls; capabilities.untrustedWorkspaces declared correctly
- **Verification commands:** `npx vitest run agent-core/tests/workspaceProviderUrlValidation.test.ts && npx vitest run agent-core/tests/workspaceTrustDeclaration.test.ts`
- **Resolution evidence:** `5ae7a5a` — (1) `pushInitialWebviewState()` no longer auto-probes provider status or model suggestions. (2) `validateProviderUrl()` rejects non-HTTPS, private IPs, malformed URLs. (3) `canProbeProviderEndpoint()` requires trusted workspace for custom endpoints. (4) `openAIBaseUrl` validated on `updateSetting`. (5) `capabilities.untrustedWorkspaces` with `restrictedConfigurations` added to `extension/package.json`. 44 new regression tests. 509/509 tests pass. Build clean.
- **Remaining risk:** `handleOpenFile` still accepts arbitrary absolute paths (NC-005). Phase D should restrict provider endpoints to known allowlist.

### NC-003 — API keys persisted in plaintext webview state
- **Severity:** Critical
- **Status:** fixed
- **Phase:** 0 / containment
- **Dependencies:** none
- **Affected files:** `extension/webview/src/main.tsx:380-403,550-609,1217-1220,3982-3988,5033-5076`, `extension/src/sidebarViewProvider.ts:1151-1219`
- **Verified:** yes — verified against current source; secrets removed from SidebarSettings, BackendConfig, and PersistedState
- **Required tests:** serialized webview state contains no key/token fields; migration strips legacy secret fields; write-only secret input pattern; updateSetting rejects secret keys
- **Verification commands:** `npx vitest run agent-core/tests/webviewSecrets.test.ts`
- **Resolution evidence:** Working tree changes: (1) SidebarSettings interface: `openAIApiKey` and `searchApiKey` string fields replaced with `openAIApiKeyConfigured` and `searchApiKeyConfigured` boolean flags. (2) BackendConfig: added `openAIApiKeyConfigured`, `tavilyApiKeyConfigured`, `searchApiKeyConfigured` boolean flags. (3) `sendSecret()` action: posts to extension host via `vscode.postMessage({ type: "updateSetting" })` but never stores value in Zustand state. (4) `stripSecretsFromSettings()`: strips `openAIApiKey`, `searchApiKey`, `tavilyApiKey` from settings objects; called in `normalizePersistedState()` for migration. (5) `updateSetting` guard: rejects secret keys with console.warn. (6) UI: API key inputs use local React state (`localApiKey`, `localSearchApiKey`), send on blur via `sendSecret()`, clear immediately. (7) `getRuntimeSettings()` in sidebarViewProvider.ts now returns `openAIApiKeyConfigured: boolean`, `tavilyApiKeyConfigured: boolean`, `searchApiKeyConfigured: boolean` instead of raw secret strings. (8) 20 regression tests in `agent-core/tests/webviewSecrets.test.ts`. (9) Also fixed pre-existing TS errors: `validateProviderUrl()` called with 2 args at lines 1260/1359 in sidebarViewProvider.ts (only takes 1 param). 529/529 tests pass. Build clean. All typechecks clean.

### NC-004 — Terminal policy accepts arbitrary unmatched shell commands
- **Severity:** Critical
- **Status:** fixed
- **Phase:** 0 / containment
- **Dependencies:** none
- **Affected files:** `agent-core/src/tools/terminalTool.ts:674-715`
- **Verified:** yes — verified against current source; validateCommand now rejects commands not in SAFE_PATTERNS
- **Required tests:** unknown terminal command fails closed; raw shell requires approval; untrusted workspace disables raw terminal; typed argv with shell:false for allowed commands
- **Verification commands:** `npx vitest run agent-core/tests/terminalDenyByDefault.test.ts`
- **Resolution evidence:** `validateCommand()` changed from returning `null` (allow) for any command not matching denylist/safe-list, to returning a rejection message for any command not in `SAFE_PATTERNS`. The terminal safety boundary now uses deny-by-default: only explicitly permitted read-only commands (ls, pwd, echo, cat, head, tail, wc, git status/diff/log/branch/show, npm test, cargo check/build/test/clippy/fmt, go build/test/fmt/vet, and PowerShell/dir/cd/type/where/findstr equivalents) are allowed. 159 regression tests in `agent-core/tests/terminalDenyByDefault.test.ts` covering: safe commands still allowed (35), unknown commands now rejected (58), previously blocked commands still blocked (16), run() rejects unknown (3), stream() rejects unknown (1), SAFE_PATTERNS coverage (46). 688/688 unit tests pass. Build clean. Type-check clean.
- **Remaining risk:** Terminal still uses `shell: true` (PowerShell on Windows). Full typed-argv-with-shell:false redesign is Phase E work. The deny-by-default containment patch eliminates the primary attack surface (arbitrary unmatched commands) while preserving the existing safe-command allowlist.

### NC-005 — Webview messages cross privilege boundary without runtime validation
- **Severity:** Critical
- **Status:** fixed
- **Phase:** 0 / C
- **Dependencies:** none
- **Affected files:** `extension/src/sidebarViewProvider.ts:229-232,294-403,1425-1449`, `agent-core/src/utils/webviewMessageValidation.ts` (new)
- **Verified:** yes — verified against current source; runtime validation added for type discriminator, field presence, setting key allowlist, openFile workspace containment, size limits
- **Required tests:** arbitrary webview message types rejected; unknown setting keys rejected; openFile cannot escape workspace root; runtime schema validation on inbound messages
- **Verification commands:** `npx vitest run agent-core/tests/webviewValidation.test.ts`
- **Resolution evidence:** `TBD` — (1) `validateWebviewMessage()` validates type discriminator is a recognized string from VALID_MESSAGE_TYPES (26 types). (2) Validates required fields per message type: prompt non-empty + length limit, editId non-empty, filePath non-empty + no null bytes + length limit, setting key in allowlist, taskId/requestId/approved present and correct types. (3) Rejects non-objects, null/undefined, unknown types, oversized messages (>1MB). (4) `validateOpenFilePath()` checks containment against workspace root — rejects traversal, absolute paths outside workspace. (5) `updateSetting` now rejects any key not in ALLOWED_SETTING_KEYS (13 safe settings). Secret keys excluded. (6) `handleOpenFile()` uses validateOpenFilePath() before opening. 71 regression tests. 759/759 tests pass. Build clean.
- **Remaining risk:** The `InboundWebviewMessage` TypeScript type is still used for internal switch-statement typing after runtime validation. Phase C should consider using Zod or equivalent for fully inferred types.

### NC-006 — Reviewed edits can escape workspace or overwrite newer file
- **Severity:** Critical
- **Status:** fixed
- **Phase:** 0 / F
- **Dependencies:** NC-020 (path containment)
- **Affected files:** `extension/src/editReviewService.ts:12-29,52-95`, `agent-core/src/orchestrator.ts:1065-1071`, `agent-core/src/utils/editValidation.ts` (new)
- **Verified:** yes — verified against current source; path containment and stale content checks added to both edit paths
- **Required tests:** edit apply rejects traversal; edit apply rejects stale content; content hash/version precondition; multi-root workspace edit association
- **Verification commands:** `npx vitest run agent-core/tests/editValidation.test.ts`
- **Resolution evidence:** `agent-core/src/utils/editValidation.ts` (new, 131 lines): (1) `computeContentHash()` — deterministic SHA-256 content hash for fast pre-check and audit logging. (2) `validateEditPreconditions()` — validates path containment via `checkPathWithinWorkspace()` AND verifies current file content matches `edit.oldText` exactly; returns structured `EditValidationResult` with hashes for debugging. (3) `validateEditPreconditionsAsync()` — async variant with symlink-aware path resolution. `extension/src/editReviewService.ts` changed: (1) `applyEdit()` now validates path containment via `checkPathWithinWorkspace()` before joining workspace root — rejects traversal. (2) `applyEdit()` reads current content and calls `validateEditPreconditions()` — rejects stale edits. (3) `previewEdit()` validates path containment via `checkPathWithinWorkspace()` before joining. `agent-core/src/orchestrator.ts` changed: `applyProposedEdit()` now reads current content and calls `validateEditPreconditions()` — throws on stale content. 34 regression tests in `agent-core/tests/editValidation.test.ts` covering: computeContentHash determinism/differentiation/unicode, checkPathWithinWorkspace traversal/absolute/empty/whitespace/deep, validateEditPreconditions path containment/stale content/new file creation/hash info/combined scenarios. 869/869 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** Multi-root workspace edit association (which workspace folder an edit belongs to) is still NC-023 territory. The current fix validates containment against the provided `workspaceRoot` parameter.

### NC-007 — PowerShell search fallback is injection-prone
- **Severity:** Critical
- **Status:** fixed
- **Phase:** 0 / E
- **Dependencies:** none
- **Affected files:** `agent-core/src/tools/searchTool.ts:117-149`
- **Verified:** yes — verified against current source; PowerShell Select-String fallback replaced with Node.js filesystem walker
- **Required tests:** search payloads cannot execute substitutions; ripgrep argv preferred; PowerShell fallback uses non-code channel
- **Verification commands:** `npx vitest run agent-core/tests/searchInjection.test.ts`
- **Resolution evidence:** `agent-core/src/tools/searchTool.ts` changed: (1) Removed `import { exec } from "child_process"` pattern. (2) Added `import * as fs from "fs"` and `import * as path from "path"` for pure Node.js search. (3) Replaced the PowerShell `Select-String` fallback with a new `searchWithNodeFallback()` method that uses `fs.promises.readdir` and `fs.promises.readFile` for recursive filesystem walking with case-insensitive literal substring matching — no shell, no PowerShell, no injection. (4) Replaced the Linux/Mac `grep` fallback with the same Node.js walker (grep interprets query as regex, not literal). (5) `findstr` kept on Windows as it uses execFile argv (safe). (6) Query truncated to 100 chars in diagnostic output to limit exposure. (7) `TerminalTool.getWorkspaceRoot()` public getter added. 19 regression tests in `agent-core/tests/searchInjection.test.ts` covering: PowerShell never invoked, Node.js walker finds content, case-insensitive matching, nested directories, no results for non-matching, injection payloads ($env:USERPROFILE, $(Get-Process), backtick escapes, single-quoted PS, pipe/semicolon, node -e), query truncation, node_modules skipped, .git skipped, max result limit, empty workspace, binary files, rg argv safety, output format. 778/778 tests pass. Build clean. Type-check clean.
- **Remaining risk:** None — the injection vector (PowerShell `-Command` interpolation) has been fully eliminated. The Node.js walker is pure code with no shell involvement.

### NC-008 — Auto/bypass approval modes undermine user consent
- **Severity:** Critical
- **Status:** fixed
- **Phase:** 0
- **Dependencies:** none
- **Affected files:** `extension/package.json:147-160`, `extension/src/sidebarViewProvider.ts:1032-1050`, `extension/webview/src/main.tsx:5206-5232`, `agent-core/src/utils/webviewMessageValidation.ts:200-208`
- **Verified:** yes — verified against current source; bypass removed from enum, extension fallback auto-approve removed, policy engine is sole source of truth
- **Required tests:** bypass cannot be set persistently; write auto-approval fallback removed; one policy engine is source of truth; legacy bypass value falls back to ask
- **Verification commands:** `npx vitest run agent-core/tests/approvalPolicy.test.ts && npx vitest run agent-core/tests/webviewValidation.test.ts`
- **Resolution evidence:** `6c75a36` — (1) `extension/package.json`: removed `"bypass"` from `toolApproval` enum; only `"auto"` and `"ask"` remain. (2) `extension/src/sidebarViewProvider.ts`: approval callback no longer returns `true` for `bypass`; removed hardcoded `["write", "append", "patch"]` fallback auto-approve in auto mode; policy engine's `isAutoExecutable()` is now the sole source of truth. Legacy `bypass` config value falls back to `ask`. (3) `extension/webview/src/main.tsx`: removed `bypass` option from Permission Mode dropdown; simplified onChange handler. (4) `agent-core/src/utils/webviewMessageValidation.ts`: `updateSetting` now rejects `toolApproval=bypass` value. (5) `agent-core/tests/toolApprovalPolicy.test.ts`: updated `simulateApprovalCallback` to remove bypass mode and extension fallback; auto mode tests now verify writes require approval. (6) `agent-core/tests/approvalPolicy.test.ts`: new file with 22 tests covering: enum validation, policy as sole truth, write/append/patch require approval, legacy bypass/autopilot values fall back to ask. (7) `agent-core/tests/webviewValidation.test.ts`: 4 new tests for bypass rejection. 799/799 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** The `DefaultToolApprovalPolicy` class still accepts `bypassTools` constructor parameter (used for internal policy flexibility). The extension no longer uses it. Phase E should consider whether the policy class itself needs simplification.

---

## P1 — High-priority Correctness and Architecture Defects — NC-009 through NC-028

### NC-009 — MCP implementation is a disconnected custom stub, not full MCP
- **Severity:** High
- **Status:** fixed
- **Phase:** 0 / containment
- **Dependencies:** none (de-scoping decision first)
- **Affected files:** `agent-core/src/orchestrator.ts:27,221-226`
- **Verified:** yes — verified against current source; built-in filesystem adapter now registered, MCP marked as in-process adapter registry
- **Required tests:** built-in adapter deliberately registered and visible; MCP is in-process only (no real protocol); FilesystemAdapter enforces workspace containment
- **Verification commands:** `npx vitest run agent-core/tests/mcpRegistry.test.ts`
- **Resolution evidence:** `agent-core/src/orchestrator.ts` changed: (1) Added `import { FilesystemAdapter }` from `./mcp/adapters/filesystemAdapter`. (2) After creating empty `McpRegistry`, registered `FilesystemAdapter` so the MCP server list is not silently empty. Comment documents this is an in-process adapter registry, not a real MCP protocol client. 19 regression tests in `agent-core/tests/mcpRegistry.test.ts`: orchestrator lists filesystem server by default, orchestrator lists only built-in servers, orchestrator lists filesystem tools, orchestrator invokes filesystem MCP tool via list_directory, McpRegistry stores/unregisters adapters by ID, McpRegistry rejects calls to unregistered servers, McpRegistry has no MCP protocol methods (initialize/connect/disconnect/negotiate/ping/listResources/readResource/listPrompts/getPrompt/subscribe/unsubscribe/sendNotification/setTransport/getTransport), McpRegistry has no transport/lifecycle/auth properties, FilesystemAdapter enforces workspace containment (list_directory/file_info reject traversal), FilesystemAdapter rejects empty path, unknown tool returns available tools, listTools returns expected tools. 907/907 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** MCP is still an in-process adapter registry with no real MCP protocol support (no JSON-RPC transport, capability negotiation, lifecycle, server configuration, authentication, notifications, resource/prompt support, timeouts, or protocol-version handling). Full MCP support requires the official `@modelcontextprotocol/sdk`. The containment fix ensures the built-in filesystem adapter is registered so the webview MCP server list is not silently empty.

### NC-010 — Concurrent tasks share mutable orchestrator state
- **Severity:** High
- **Status:** fixed
- **Phase:** 0 / containment
- **Dependencies:** NC-011 (task state machine)
- **Affected files:** `agent-core/src/taskQueue.ts:14`, `extension/src/taskController.ts:28`
- **Verified:** yes — verified against current source; max concurrency changed from 3 to 1
- **Required tests:** max concurrency enforced at 1; dequeue blocks second active task; canAcceptNewTask reflects limit; tasks queue sequentially; steering only on running tasks
- **Verification commands:** `npx vitest run agent-core/tests/taskConcurrency.test.ts`
- **Resolution evidence:** `agent-core/src/taskQueue.ts` changed: `MAX_CONCURRENT_TASKS` changed from 3 to 1. `extension/src/taskController.ts` changed: default `maxConcurrent` parameter changed from 3 to 1. 15 regression tests in `agent-core/tests/taskConcurrency.test.ts`: default concurrency is 1, dequeue blocks second task, canAcceptNewTask reflects limit, queued tasks wait behind active, explicit maxConcurrent=1 works, higher maxConcurrent works for future flexibility, TaskQueueManager respects limit, steering only on running tasks, sequential queue behavior. 888/888 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** Full task-scoped `AgentRunContext` isolation (per-task signals, messages, metrics, approvals, proposed edits, provider sessions) is Phase G work. The concurrency limit to 1 eliminates the immediate race window but does not isolate state per-task for future parallel execution.

### NC-011 — Steering works only in one status and can become a new task unexpectedly
- **Severity:** High
- **Status:** fixed
- **Phase:** G
- **Dependencies:** NC-010 (task isolation)
- **Affected files:** `agent-core/src/taskQueue.ts:98-126`, `agent-core/src/taskManager.ts:62-108`, `agent-core/src/taskManager.ts:137-148`
- **Verified:** yes — verified against current source; steering now allowed in planning/running/verifying states, routed by session ID
- **Required tests:** steering during planning/running/verifying follows state machine; route by session/task not first global active
- **Verification commands:** `npx vitest run agent-core/tests/steeringStateMachine.test.ts && npx vitest run agent-core/tests/taskConcurrency.test.ts`
- **Resolution evidence:** (1) `TaskQueue.STEERING_ELIGIBLE_STATES` = Set{running, planning, verifying} — queued, waiting-for-user, completed, failed, cancelled rejected. (2) `TaskQueue.getActiveTaskBySession(sessionId)` — finds active task belonging to a specific session. (3) `classifyAndRoute()` first checks session task via `getActiveTaskBySession()`, then falls back to explicit `activeTaskId` for backward compat. Steering allowed in planning, running, and verifying states. (4) State machine documented with transition diagram in JSDoc. (5) 39 regression tests in `agent-core/tests/steeringStateMachine.test.ts`: steer eligibility by status (10), session-based lookup (6), classifyAndRoute session routing (8), classifyPromptIntent classification (6), transition matrix (9). (6) Updated existing `taskConcurrency.test.ts` test to reflect new steering-eligible states. 1242/1242 tests pass. Build clean. All type-checks clean.

### NC-012 — Cancellation does not propagate through all tools and child processes
- **Severity:** High
- **Status:** fixed
- **Phase:** E
- **Dependencies:** NC-004 (terminal tool), NC-010 (task context)
- **Affected files:** `agent-core/src/tools/terminalTool.ts`, `agent-core/src/tools/gitTool.ts`, `agent-core/src/tools/testRunnerTool.ts`, `agent-core/src/tools/toolRegistry.ts`, `agent-core/src/orchestrator.ts`, `agent-core/src/agents/agentLoop.ts`
- **Verified:** yes — verified against current source; AbortSignal propagated through entire tool chain, process tree killed cross-platform
- **Required tests:** task cancellation terminates child process trees; AbortSignal propagated to all tools; cleanup completes before final task state
- **Verification commands:** `npx vitest run agent-core/tests/cancellationPropagation.test.ts`
- **Resolution evidence:** `bb6e42e` — (1) `TerminalTool.run()`, `runSafe()`, `stream()` accept optional `AbortSignal` parameter. (2) `killProcessTree()` utility kills process tree cross-platform: `taskkill /T /F /PID` on Windows, `process.kill(-pid, SIGTERM)` + `child.kill()` on POSIX. (3) `execWithSignal()` and `execFileWithSignal()` wrap exec/execFile with abort signal support — cleanup in both exec callback and close event. (4) Already-aborted signal causes immediate fast-fail rejection. (5) `ToolRegistry.runToolCall()` and `runToolCallStructured()` pass signal through to terminal, git, and test tools. (6) `GitTool`: all 8 methods (status, diff, branch, stage, unstage, commit, createBranch, log, show) accept `signal?: AbortSignal`. (7) `TestRunnerTool`: `run()` and `stream()` accept signal. (8) `Orchestrator` passes `request.abortSignal` to all tool calls and terminal streaming. (9) `AgentLoop` passes `signal` to `ToolRegistry.runToolCall()`. (10) 30 regression tests in `cancellationPropagation.test.ts`: TerminalTool.run/runSafe/stream abort (11), ToolRegistry propagation (3), GitTool propagation (2), TestRunnerTool propagation (2), AgentLoop (1), process tree cleanup (1), memory leak prevention (3), edge cases (3), backward compat (4). 1271/1272 tests pass (1 pre-existing approvalPolicy path issue). Build clean. All type-checks clean.
- **Remaining risk:** Process tree kill on Windows uses `taskkill /T /F` which may not terminate processes with elevated privileges. POSIX process group kill may fail for non-group-leaders (fallback to `child.kill()` handles this).

### NC-013 — Model fallback is advertised but not implemented
- **Severity:** High
- **Status:** fixed
- **Phase:** D
- **Dependencies:** NC-001 (provider isolation), NC-014 (provider identity)
- **Affected files:** `agent-core/src/providers/modelRouter.ts`, `agent-core/src/index.ts`
- **Verified:** yes — verified against current source; fallback policy now explicit and user-controlled, per-candidate failures tracked, detailed error messages
- **Required tests:** fallback policy is explicit and ordered; cross-provider fallback only with user opt-in; actual attempted list reported
- **Verification commands:** `npx vitest run agent-core/tests/modelFallback.test.ts`
- **Resolution evidence:** `agent-core/src/providers/modelRouter.ts` changed: (1) Added `FallbackCandidate` interface (providerId, model, label?) for user-controlled fallback chain entries. (2) Added `CandidateFailure` interface (providerId, model, label?, error, statusCode?) for structured failure tracking. (3) `ModelRouterConfig.fallbackCandidates?: FallbackCandidate[]` — optional ordered fallback list, empty by default (no cross-provider fallback). (4) `resolveCandidates()` now appends fallback candidates after same-provider explicit+default, with deduplication and missing-provider skipping. (5) `generate()` tracks per-candidate failures in `CandidateFailure[]` instead of silently discarding. (6) `stream()` same failure tracking. (7) `extractStatusCode()` extracts HTTP status from provider errors. (8) `buildFinalError()` produces detailed error listing every candidate tried with per-candidate reasons, HTTP status codes, and category-specific troubleshooting. (9) `FallbackCandidate` and `CandidateFailure` exported from `agent-core/src/index.ts`. 29 regression tests in `agent-core/tests/modelFallback.test.ts`: resolveCandidates (11), generate error reporting (8), stream error reporting (3), backward compatibility (3), edge cases (4). 1139/1140 tests pass (1 pre-existing failure). Build clean. All type-checks clean.

### NC-014 — Provider identity collapses to openai-compatible
- **Severity:** High
- **Status:** fixed
- **Phase:** D
- **Dependencies:** NC-001 (provider isolation)
- **Affected files:** `agent-core/src/providers/openAICompatibleProvider.ts:55-62`, `agent-core/src/orchestrator.ts:347`
- **Verified:** yes — verified against current source; OpenAICompatibleProvider now accepts providerId constructor parameter, all 8 instantiation sites pass correct ID
- **Required tests:** each provider instance reports correct concrete ID; provider ID in telemetry without secret
- **Verification commands:** `npx vitest run agent-core/tests/providerIdentity.test.ts`
- **Resolution evidence:** `agent-core/src/providers/openAICompatibleProvider.ts` changed: (1) Added `ProviderId` import from types. (2) `id` property changed from hardcoded `"openai-compatible" as const` to `id: ProviderId` assigned from optional constructor parameter (defaults to `"openai-compatible"` for backward compat). (3) Constructor now accepts optional third `providerId?: ProviderId` parameter. `agent-core/src/orchestrator.ts` changed: all 8 `OpenAICompatibleProvider` instantiation sites now pass their concrete provider ID as the third constructor argument (`"huggingface"`, `"openrouter"`, `"together"`, `"fireworks"`, `"groq"`, `"nvidia"`, `"baseten"`, `"openai-compatible"`). 15 regression tests in `agent-core/tests/providerIdentity.test.ts`: default ID (1), explicit ID (1), each provider reports correct ID (8 via it.each), distinct IDs across all 8 providers (1), no duplication across instances (1), unique instances have unique IDs (1), not hardcoded to openai-compatible (1), orchestrator integration (1). 1089/1090 tests pass (1 pre-existing failure in approvalPolicy.test.ts — wrong path to extension/package.json). Build clean. All type-checks clean.
- **Remaining risk:** None — the fix is backward compatible. The `provider.id` is now used in `orchestrator.ts:355` for `providerUsed` telemetry, which will now correctly report the concrete provider instead of always reporting "openai-compatible".

### NC-015 — Model capability detection is brittle hardcoded name heuristic
- **Severity:** High
- **Status:** fixed
- **Phase:** D
- **Dependencies:** NC-013 (fallback), NC-014 (provider identity)
- **Affected files:** `agent-core/src/providers/modelRouter.ts:18-57`, `agent-core/src/utils/modelCapabilityRegistry.ts` (new)
- **Verified:** yes — verified against current source; brittle name heuristic replaced with versioned ModelCapabilityRegistry
- **Required tests:** unknown model gets conservative defaults; provider-reported metadata preferred; user overrides supported
- **Verification commands:** `npx vitest run agent-core/tests/modelCapabilities.test.ts`
- **Resolution evidence:** `agent-core/src/utils/modelCapabilityRegistry.ts` (new, 251 lines): (1) `ModelCapabilityRegistry` class with 40+ static entries covering ollama, openai-compatible, huggingface, groq, together, openrouter, fireworks, nvidia providers. (2) Keys are provider-qualified (`provider:model`), case-insensitive. (3) Three-tier lookup: user overrides > provider metadata > static registry > undefined (heuristic fallback). (4) `registerUserOverride()` for explicit user config. (5) `registerProviderMetadata()` for runtime capability discovery. (6) `getModelCapabilityRegistry()` singleton with `resetModelCapabilityRegistry()` for tests. `agent-core/src/providers/modelRouter.ts` changed: (1) `detectModelCapabilities()` now uses registry lookup first. (2) Unknown models get 32K context (was 64K), no thinking, no tool calling — conservative defaults. (3) Heuristic retained as last-resort fallback for unrecognized models. `agent-core/src/index.ts`: exports `ModelCapabilityRegistry`, `getModelCapabilityRegistry`, `resetModelCapabilityRegistry`, `ModelCapabilityEntry`. `agent-core/tests/ollamaContextWindow.test.ts`: updated unknown model expectations from 64000 to 32000. 63 new tests in `agent-core/tests/modelCapabilities.test.ts`: static registry (12), unknown models (4), user overrides (3), provider metadata (2), makeKey (4), singleton (2), clearOverrides (1), has (3), size (2), detectModelCapabilities registry-backed (6), conservative heuristic fallback (4), heuristic for unrecognized (4), backward compatibility (14), integration (3). 1203/1203 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the registry is extensible and the heuristic fallback is conservative. Unknown models now fail safe rather than assuming capabilities.

### NC-016 — Tool schema validation silently disappears for command-string calls
- **Severity:** High
- **Status:** fixed
- **Phase:** C
- **Dependencies:** NC-004 (terminal redesign)
- **Affected files:** `agent-core/src/tools/toolRegistry.ts:134-172`
- **Verified:** yes — verified against current source; validateToolArg now validates command-string format for structured-schema tools
- **Required tests:** runStructuredToolCall is only internal API; JSON.parse failure validates command-string format; batch_edit rejects non-JSON args
- **Verification commands:** `npx vitest run agent-core/tests/malformedToolCalls.test.ts`
- **Resolution evidence:** `agent-core/src/tools/toolRegistry.ts` changed: (1) `validateToolArg()` now, when JSON.parse fails, validates command-string format for tools with structured schemas: write, append, patch, move require `::` delimiter; batch_edit rejects non-JSON args entirely; mcp requires `::` delimiter. (2) This prevents structured args from being silently accepted without any validation when converted back to command strings. 29 new regression tests in `agent-core/tests/malformedToolCalls.test.ts`. Updated `agent-core/tests/batchEditSecurity.test.ts` to match new validation behavior. 936/936 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** The full fix (making `runStructuredToolCall()` the only internal API) is Phase C/E work. The current fix validates command-string format at the validation boundary, preventing silent acceptance of malformed input.

### NC-017 — Malformed model tool calls repaired into dangerous actions
- **Severity:** High
- **Status:** fixed
- **Phase:** C
- **Dependencies:** NC-016 (schema validation)
- **Affected files:** `agent-core/src/agents/agentLoop.ts:16-30, 460-491`
- **Verified:** yes — verified against current source; heuristic regex extraction now fails closed for privileged tools
- **Required tests:** malformed privileged call fails closed; repair limited to low-risk read-only tools; structured error returned to model
- **Verification commands:** `npx vitest run agent-core/tests/malformedToolCalls.test.ts`
- **Resolution evidence:** `agent-core/src/agents/agentLoop.ts` changed: (1) Added `PRIVILEGED_TOOLS` set: write, append, patch, terminal, delete, delete-contents, move, batch_edit, mcp. (2) In the JSON.parse catch block, checks `PRIVILEGED_TOOLS.has(toolCall.function.name)`. For privileged tools: sets `parseError` and `args = {}` — no regex extraction. For read-only tools only: allows existing regex extraction with path/content/command/query matching. (3) This means malformed privileged tool calls now fail closed and return a validation error to the model, instead of heuristically extracting dangerous substrings. 29 new regression tests in `agent-core/tests/malformedToolCalls.test.ts` covering: privileged tools reject extraction (9 tools), dangerous payloads in malformed input (7 tests), read-only tools allow recovery (5 tests), injection payloads as literal strings (2 tests), edge cases (5 tests), validation error format (1 test). 936/936 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** Read-only tools still allow heuristic regex extraction from malformed JSON. This is the lower-risk path since read-only tools cannot modify state. Full fix should use structured tool calls exclusively (Phase E).

### NC-018 — Batch edits are sequential and non-transactional
- **Severity:** High
- **Status:** fixed
- **Phase:** F
- **Dependencies:** NC-019 (atomic writes), NC-006 (edit preconditions)
- **Affected files:** `agent-core/src/tools/toolRegistry.ts:331-486`
- **Verified:** yes — verified against current source; pre-validation, atomic writes, and rollback implemented
- **Required tests:** batch edit rollback leaves no partial modifications; full edit set validated before writing; duplicate/conflicting paths rejected
- **Verification commands:** `npx vitest run agent-core/tests/batchEditTransactional.test.ts`
- **Resolution evidence:** `agent-core/src/tools/toolRegistry.ts` changed: (1) Pre-validation phase: resolves all paths and checks for duplicates/traversal before any writes. Rejects entire batch if validation fails. (2) Atomic writes: all create/update operations use atomicWriteFile() instead of direct fs.writeFile(). (3) Rollback on failure: captures original state before each edit; on failure, rolls back all prior edits in reverse order. (4) Early termination: stops processing on first failure. (5) Removed dead executeBatchEditItem() method. 20 regression tests in batchEditTransactional.test.ts. 1066/1066 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** Directory delete rollback is not fully supported (cannot meaningfully re-create a deleted directory tree). This is documented in the code as a known limitation.

### NC-019 — File writes are non-atomic and patch semantics are ambiguous
- **Severity:** High
- **Status:** fixed
- **Phase:** F
- **Dependencies:** none
- **Affected files:** `agent-core/src/tools/fileSystemTool.ts:51-130`, `agent-core/src/orchestrator.ts:1091-1092`
- **Verified:** yes — verified against current source; atomicWriteFile added, patchFile requires unique match
- **Required tests:** atomic temp-file plus rename; content hash precondition; unique patch match required; per-file serialization
- **Verification commands:** `npx vitest run agent-core/tests/fileWrites.test.ts`
- **Resolution evidence:** `agent-core/src/tools/fileSystemTool.ts` changed: (1) Added `atomicWriteFile()` — writes to temp file `.nexcode-tmp-{uuid}`, then `fs.rename()` over target. Atomic on POSIX, near-atomic on NTFS. Preserves file permissions. Cleans up temp on failure. (2) `writeFile()` uses `atomicWriteFile()` instead of direct `fs.writeFile()`. (3) `patchFile()` now counts occurrences via `content.split(oldText).length - 1` and rejects if `matchCount > 1` with guidance to provide surrounding context. (4) `patchFile()` uses `atomicWriteFile()` instead of direct `fs.writeFile()`. `agent-core/src/orchestrator.ts` changed: `applyProposedEdit()` uses `atomicWriteFile()` instead of `fs.mkdir()+fs.writeFile()`. 25 regression tests in `agent-core/tests/fileWrites.test.ts`: atomicWriteFile (10 tests), writeFile atomic (5 tests), patchFile unique match (10 tests). 1045/1045 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** Per-file serialization (locking) for concurrent writes is not implemented. NC-010 already limits concurrency to 1, so this is deferred to Phase G/task isolation work.

### NC-020 — Cross-platform path containment is host-dependent
- **Severity:** High
- **Status:** fixed
- **Phase:** F
- **Dependencies:** none
- **Affected files:** `agent-core/src/utils/pathContainment.ts`, `agent-core/src/index.ts`, `agent-core/tests/crossPlatformPathContainment.test.ts`
- **Verified:** yes — verified against current source; cross-platform path detection added
- **Required tests:** Windows paths rejected on POSIX; POSIX absolute paths rejected on Windows; UNC/drive-relative/extended-length rejected; property-based cross-platform path tests
- **Verification commands:** `npx vitest run agent-core/tests/crossPlatformPathContainment.test.ts`
- **Resolution evidence:** `agent-core/src/utils/pathContainment.ts` changed: (1) Added `isPathAbsoluteCrossPlatform()` — detects Windows drive letters (`C:\`, `C:`, `D:`), drive-relative (`C:foo`), UNC (`\\server`), device (`\\.\`), and extended-length (`\\?\`) paths on any host OS. (2) Added `containsNullBytes()` validator. (3) Added `isPathSafeCrossPlatform()` composite check returning safe/reason. (4) `resolveWorkspacePath()` now applies cross-platform safety for non-host-absolute paths; host-absolute paths go through existing containment. (5) `checkPathWithinWorkspace()` similarly applies cross-platform check. (6) `agent-core/src/index.ts` exports new utilities. (7) Updated `agent-core/tests/editValidation.test.ts` null-byte test to expect rejection (was a documented gap). (8) 61 new tests in `agent-core/tests/crossPlatformPathContainment.test.ts`: isPathAbsoluteCrossPlatform (23 tests covering Windows drive, drive-relative, UNC, device, extended-length, safe relative, edge cases), containsNullBytes (5 tests), isPathSafeCrossPlatform (8 tests), checkPathWithinWorkspace cross-platform (19 tests covering Windows absolute on any platform, UNC, device, POSIX absolute, null bytes, traversal, edge cases), resolveWorkspacePath cross-platform (8 tests). 1009/1009 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the cross-platform detection covers all known Windows path forms. Future UNC or extended-length edge cases can be added to the regex patterns.

### NC-021 — Directory clearing follows symlinks and deletes targets
- **Severity:** High
- **Status:** fixed
- **Phase:** F
- **Dependencies:** NC-020 (path containment)
- **Affected files:** `agent-core/src/tools/fileSystemTool.ts:143-175,177-229`
- **Verified:** yes — verified against current source; clearDirectory and deletePath now unlink symlinks instead of following targets
- **Required tests:** symlink deletes unlink the symlink; never follow symlinks for delete/clear; containment rechecked before mutation
- **Verification commands:** `npx vitest run agent-core/tests/symlinkDelete.test.ts`
- **Resolution evidence:** `agent-core/src/tools/fileSystemTool.ts` changed: (1) `clearDirectory()` now uses `Dirent.isSymbolicLink()` to detect symlinks without following them. For symlinks: resolves target with `realpath()` for containment check, then calls `fs.unlink(entryPath)` — removes only the symlink, never the resolved target. For broken symlinks: unlinks safely. For directories/files: containment check then `fs.rm()` as before. (2) `deletePath()` now uses `fs.lstat()` to detect symlinks without following them. For symlinks: `fs.unlink()` removes only the symlink. For regular entries: `fs.rm()` as before. (3) 12 regression tests in `agent-core/tests/symlinkDelete.test.ts`: deletePath unlinks symlink to file (target survives), deletePath unlinks symlink to directory (target survives), deletePath unlinks symlink pointing outside workspace, deletePath unlinks broken symlink, clearDirectory unlinks in-workspace symlinks (targets survive), clearDirectory skips outside-workspace symlinks, clearDirectory handles broken symlinks, clearDirectory handles mixed files/dirs/symlinks, clearDirectory symlink to directory only removes symlink, regular file delete still works, empty directory clear works, traversal rejection for symlinks. 1021/1021 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the symlink handling is correct: symlinks are unlinked (not followed), targets survive, containment is checked for out-of-workspace targets.

### NC-022 — Workspace prompt files can silently replace trusted system prompts
- **Severity:** High
- **Status:** fixed
- **Phase:** 0 / containment
- **Dependencies:** none
- **Affected files:** `extension/src/sidebarViewProvider.ts:996-1020`, `agent-core/src/prompts/promptStore.ts`, `agent-core/src/config.ts`, `agent-core/src/orchestrator.ts:57-77,210-213`, `extension/package.json:132-137,188-197`, `agent-core/src/utils/webviewMessageValidation.ts:51-64`
- **Verified:** yes — verified against current source; PromptStore now defaults to blocking workspace prompts, requires explicit allowWorkspacePrompts=true + trusted workspace
- **Required tests:** workspace prompt overrides disabled by default; trusted workspace plus opt-in required; override source shown; security policy outside model prompts
- **Verification commands:** `npx vitest run agent-core/tests/workspacePromptOverride.test.ts`
- **Resolution evidence:** `ab0ddf9` — (1) `PromptStore` constructor now accepts `PromptStoreOptions` with `allowWorkspacePrompts` (default false). String constructor preserved for backward compat but also defaults to false. (2) `getPrompt()` only reads from filesystem when `allowWorkspacePrompts` is true. (3) `RuntimeConfig` and `NexcodeOrchestratorOptions` include `allowWorkspacePrompts?: boolean`. (4) Orchestrator passes flag to `PromptStore`. (5) `sidebarViewProvider.ts` reads `nexcodeKiboko.allowWorkspacePrompts` config AND requires `workspaceTrustService.isWorkspaceTrusted()` — both must be true. (6) `extension/package.json`: added `nexcodeKiboko.allowWorkspacePrompts` (boolean, default false) and added to `restrictedConfigurations`. (7) `webviewMessageValidation.ts`: added `allowWorkspacePrompts` to `ALLOWED_SETTING_KEYS`. (8) 19 regression tests in `agent-core/tests/workspacePromptOverride.test.ts` covering: default blocks overrides, malicious payloads rejected, all modes blocked, backward compat, enabled reads overrides, empty/missing files fall back, caching, per-mode isolation, traversal safety, package.json config validation. 818/818 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the containment is complete. Workspace prompts are disabled by default and cannot be enabled by untrusted workspace configuration.

### NC-023 — Only first workspace folder is supported
- **Severity:** High
- **Status:** fixed
- **Phase:** G
- **Dependencies:** NC-020 (path containment)
- **Affected files:** `extension/src/sidebarViewProvider.ts`, `extension/webview/src/main.tsx`, `agent-core/tests/multiRootWorkspace.test.ts` (new)
- **Verified:** yes — verified against current source; workspace folder resolution now supports multi-root
- **Required tests:** workspace folder resolved from active editor/attachment/task; folder URI stored on every task/edit; no fallback to different root
- **Verification commands:** `npx vitest run agent-core/tests/multiRootWorkspace.test.ts`
- **Resolution evidence:** `69b9979` — (1) `resolveWorkspaceFolder(uri?)` resolves correct workspace folder from URI, active editor, or falls back to workspaceFolders[0]. (2) `getWorkspaceRoot()` now uses `resolveWorkspaceFolder()` instead of always returning `workspaceFolders[0]`. (3) `getWorkspaceFolderInfos()` exposes all workspace folders to webview UI. (4) `handleOpenFile()` validates paths against ALL workspace folders, not just the first. (5) `applyEdit`/`previewEdit` resolve workspace root from the edit's file path for correct multi-root validation. (6) Config messages include `workspaceFolders` and `activeWorkspaceRoot`. (7) `BackendConfig` and `StoreState` include workspace folder state. (8) 33 regression tests in `agent-core/tests/multiRootWorkspace.test.ts`: validateOpenFilePath multi-root (7), checkPathWithinWorkspace multi-root (6), validateEditPreconditions multi-root (7), content hash consistency (2), workspace folder resolution patterns (4), edge cases (6), multi-root edit resolution pattern (2). 1459/1459 tests pass. Build clean. All type-checks clean.

### NC-024 — Secret migration copies but does not delete plaintext settings
- **Severity:** High
- **Status:** fixed
- **Phase:** 0
- **Dependencies:** NC-003 (webview secrets)
- **Affected files:** `extension/src/secretService.ts:16-34`
- **Verified:** yes — verified against current source; migration now removes plaintext after copying to SecretStorage
- **Required tests:** legacy value removed from config after migration; migration idempotent; one-time notice if plaintext remnants found
- **Verification commands:** `npx vitest run agent-core/tests/secretMigration.test.ts`
- **Resolution evidence:** `extension/src/secretService.ts` changed: (1) `migrateFromSettings()` removed early-return on migration flag — now always runs cleanup. (2) After storing each secret, calls `config.update(key, undefined, ConfigurationTarget.Workspace)` to remove plaintext from workspace settings. (3) Idempotent: `cleanupPlaintextRemnants()` checks for any remaining plaintext and removes it even on re-runs. (4) `hasPlaintextRemnants()` public method for health checks. (5) `LEGACY_PLAINTEXT_KEYS` exported for test coverage. (6) 17 regression tests in `agent-core/tests/secretMigration.test.ts`: copy+delete, empty values, idempotent runs, canary secrets, sequential store-before-delete, partial recovery, SECRET_STORAGE_KEYS mapping. 835/835 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the migration is now idempotent and always cleans up plaintext.

### NC-025 — Response cache can return stale model actions and grows without true bound
- **Severity:** High
- **Status:** fixed
- **Phase:** D
- **Dependencies:** none
- **Affected files:** `agent-core/src/utils/contextCache.ts`, `agent-core/src/providers/modelRouter.ts:72-73,161-185`
- **Verified:** yes — verified against current source; ContextCache now has bounded LRU eviction, real metrics, and ModelRouter skips caching tool-call responses
- **Required tests:** agent action responses not cached; bounded LRU/TTL; real hit/miss metrics
- **Verification commands:** `npx vitest run agent-core/tests/contextCacheAndResponseCaching.test.ts`
- **Resolution evidence:** `3686086` — `agent-core/src/utils/contextCache.ts` rewritten (95 lines): (1) `ContextCache` now accepts `maxSize` parameter (default 100); when exceeded, LRU entry is evicted. (2) `get()` promotes accessed entry to MRU. (3) Real hits/misses/evictions counters with accurate `hitRate`. (4) `has()` and `resetStats()` methods. (5) Unbounded mode via `maxSize=0`. `agent-core/src/providers/modelRouter.ts` changed: `generate()` now skips caching responses that contain toolCalls — only text-only (safe) responses cached. 21 regression tests in `agent-core/tests/contextCacheAndResponseCaching.test.ts`. 1110/1111 tests pass (1 pre-existing failure). Build clean. All type-checks clean.

### NC-026 — Memory and audit persistence are race-prone and failures are swallowed
- **Severity:** High
- **Status:** fixed
- **Phase:** I
- **Dependencies:** NC-010 (concurrency)
- **Affected files:** `agent-core/src/memory/shortTermMemory.ts`, `agent-core/src/memory/longTermMemory.ts`, `agent-core/src/memory/memoryManager.ts`, `agent-core/src/self-improve/feedbackLogger.ts`, `agent-core/src/tools/auditLog.ts`
- **Verified:** yes — verified against current source; all persistence classes now have write queues, error surfacing, and shutdown methods
- **Required tests:** serialized persistence per workspace; flush on deactivation/completion; degraded status surfaced; concurrent writes safe
- **Verification commands:** `npx vitest run agent-core/tests/persistenceReliability.test.ts`
- **Resolution evidence:** `9117a49` — (1) `FeedbackLogger`: added write queue serialization via promise chain, `onError` callback, `flush()`/`dispose()` methods, `disposed` guard, `getLastError()`/`hasPersistenceError()`/`resetErrorState()`. (2) `AuditLog`: added write queue serialization, atomic `splice(0)` before async write to prevent snapshot/splice race, re-queue entries on failure instead of data loss, `dispose()` clears timer and flushes, `getBufferedCount()`. (3) `ShortTermMemory`: added `onError` callback, `flush()`/`dispose()`, `disposed` guard, removed silent `.catch(() => {})` swallowing — errors now captured via `captureError()`. (4) `LongTermMemoryStore`: added `onError` callback, `flush()`/`dispose()`, `disposed` guard, errors in `readAll()`/`add()` surface instead of silent fallback. (5) `MemoryManager`: added `flush()`/`dispose()` delegating to both stores, `onError` callback propagation, `hasPersistenceError()`. (6) Backward-compatible constructors preserved. (7) 34 regression tests in `agent-core/tests/persistenceReliability.test.ts`. 1383/1383 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** Audit log is still stored in the workspace (`.nexcode/audit.jsonl`), meaning the agent can edit it. Phase I should consider moving to extension storage.

### NC-027 — Secret redaction is not sufficient for extensible multi-provider agent
- **Severity:** High
- **Status:** fixed
- **Phase:** I
- **Dependencies:** NC-001 (credential store)
- **Affected files:** `agent-core/src/utils/redact.ts`
- **Verified:** yes — verified against current source; 20-line regex-only redactor replaced with 380-line multi-layer redaction engine
- **Required tests:** redact by known secret values; recursive structured key redaction; JWT/OAuth detectors; canary-secret tests across all sinks
- **Verification commands:** `npx vitest run agent-core/tests/secretRedaction.test.ts`
- **Resolution evidence:** `agent-core/src/utils/redact.ts` rewritten (383 lines, +365/-18): (1) `redactByKnownValues(text, knownValues)` — value-based redaction with sorted-by-length matching to avoid partial overlap, regex-safe escaping, ≥4 char minimum. (2) `redactObject<T>(obj, knownValues?, _seen?)` — recursive structured object redaction with WeakSet cycle detection, key-name matching via `isSecretKey()` (14 regex patterns) and `SECRET_VALUE_KEYS` (25 exact names), pattern-based string redaction, knownValues passthrough. (3) 18 new provider token patterns: GitHub OAuth/app/refresh (gho_, ghs_, ghr_), GitLab personal/pipeline/runner (glpat-, glptt-, glr_), npm, Slack bot/user/app/webhook, Google API key/OAuth secret, Hugging Face, OpenRouter, Anthropic, Azure storage, broadened connection strings (amqp, smtp, ftp, s3, gs, abs). (4) `redactJWTTokens()` — structural JWT detection validating header decodes to JSON with `alg` field. (5) `redactHighEntropyStrings()` — Shannon entropy threshold with UUID/SHA-1/SHA-256 exclusion. (6) 77 regression tests in `agent-core/tests/secretRedaction.test.ts`: existing patterns (12), new provider patterns (18), authorization headers (2), JWT detection (4), high-entropy (5), redactByKnownValues (8), redactObject (13), canary secrets (4), edge cases (6), PEM variants (2), consumer integration (2), backward compat (1). 1349/1349 tests pass. Build clean. All type-checks clean.

### NC-028 — General coding agent contains hardcoded blog-page fallback
- **Severity:** High
- **Status:** fixed
- **Phase:** 0 / F
- **Dependencies:** none
- **Affected files:** `agent-core/src/orchestrator.ts:2161-2321`
- **Verified:** yes — verified against current source; `shouldUseBlogLandingFallback()` and `createBlogLandingPageFallback()` methods removed along with calling code
- **Required tests:** blog fallback deleted; methods no longer exist on orchestrator class
- **Verification commands:** `npx vitest run agent-core/tests/blogFallbackRemoval.test.ts`
- **Resolution evidence:** `agent-core/src/orchestrator.ts` changed: (1) Removed `shouldUseBlogLandingFallback()` private method (15 lines) — checked if instruction mentions blog/homepage/landing page AND file is TSX/JSX AND generated text lacks blog keywords. (2) Removed `createBlogLandingPageFallback()` private method (48 lines) — hardcoded Tailwind blog homepage component. (3) Removed calling code at lines 2185-2193 that replaced model output with the hardcoded fallback. Total: 76 lines deleted, 0 inserted. 4 regression tests in `agent-core/tests/blogFallbackRemoval.test.ts`: methods no longer exist on orchestrator, orchestrator class source does not contain hardcoded blog strings, orchestrator source does not contain fallback method names. 873/873 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the blog fallback was entirely contained within the orchestrator and did not affect other modules. Model output is now preserved as-is regardless of blog-related keywords.

---

## P2 — Important Maintainability, Testing, and Product Issues — NC-029 through NC-045

### NC-029 — Internal documentation incorrectly declares production readiness
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `docs/review/FINAL_REPORT.md`, `docs/review/RELEASE_READINESS.md`, `docs/review/TEST_MATRIX.md`, `docs/review/HARDENING_LOG.md`, `README.md`, `docs/review/BASELINE_VALIDATION.md`, `docs/review/FINDINGS_REGISTER.md`, `docs/review/INDEPENDENT_RED_TEAM_REPORT.md`, `docs/review/IMPLEMENTATION_PLAN.md`
- **Verified:** yes — verified against current source; all 8 review docs marked as historical snapshots, README.md updated with current counts
- **Required tests:** docs reference current test counts; no false production-ready claims without caveat; historical snapshot headers present
- **Verification commands:** `npx vitest run agent-core/tests/documentationAccuracy.test.ts`
- **Commit:** `78c3490`
- **Resolution evidence:** (1) Added `⚠️ HISTORICAL SNAPSHOT — NOT CURRENT` header to all 8 `docs/review/*.md` files with note about current test counts (1476+ tests, 59+ files). (2) Added `Status: Historical snapshot` to each document's metadata. (3) `README.md` updated: test count from "62 tests" to "1476 tests", test file count from "8 test files" to "59 test files", removed stale "audit-17 issues" badge, expanded Testing section from 7 bullet points to 25 covering all remediation areas. (4) 17 regression tests in `agent-core/tests/documentationAccuracy.test.ts`: historical snapshot markers (8), stale count rejection (3), current count validation (3), badge cleanup (1), release decision caveat (2). 1476/1476 tests pass. Build clean. All type-checks clean.

### NC-030 — Lint is only TypeScript compilation
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** root `package.json`, `eslint.config.mjs` (new), `extension/src/sidebarViewProvider.ts`, `agent-core/src/tools/toolRegistry.ts`, `agent-core/src/utils/webviewMessageValidation.ts`
- **Verified:** yes — verified against current source; real ESLint with type-aware rules added
- **Required tests:** ESLint config file exists; type-aware rules configured; lint scripts exist; switch exhaustiveness fixed; floating promises fixed
- **Verification commands:** `npx vitest run agent-core/tests/eslintConfig.test.ts`
- **Resolution evidence:** (1) `eslint.config.mjs` (new, 147 lines): typescript-eslint flat config with type-aware rules — no-floating-promises (error), no-misused-promises (error), switch-exhaustiveness-check (error), consistent-type-imports (warn), no-unsafe-* family (warn). Covers agent-core/src, extension/src, extension/webview/src with separate relaxed test rules. (2) Root `package.json`: added `lint:eslint`, `lint:eslint:fix`, `typecheck` scripts; added eslint, @eslint/js, typescript-eslint devDependencies. (3) `extension/src/sidebarViewProvider.ts`: 4 floating promise fixes (`void this.pushInitialWebviewState()`, `void this.processNextTask()`). (4) `agent-core/src/tools/toolRegistry.ts`: 1 floating promise fix (`void this.auditLog.log()`). (5) `agent-core/src/utils/webviewMessageValidation.ts`: added `import * as path from "path"` replacing `require("path")`; added 12 missing switch case labels for exhaustiveness. (6) 26 regression tests in `agent-core/tests/eslintConfig.test.ts`: config existence, rules, patterns, projectService, ignores, dependencies, scripts, switch exhaustiveness, floating promise fixes. 1531/1531 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** 69 pre-existing ESLint errors remain (unused vars, empty blocks, escape chars). These are code quality issues to be addressed incrementally, not blockers for the ESLint configuration itself. The key type-aware rules (no-floating-promises, no-misused-promises) are enforced as errors.

### NC-031 — CI is Linux-only despite platform-specific security code
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `.github/workflows/ci.yml`, `agent-core/tests/ciWorkflow.test.ts`
- **Verified:** yes — verified against current source; multi-platform matrix added
- **Required tests:** Windows and macOS matrix jobs in CI
- **Verification commands:** `npx vitest run agent-core/tests/ciWorkflow.test.ts`
- **Commit:** `ef2e80e`
- **Resolution evidence:** (1) Added Windows/macOS/Ubuntu matrix to build-and-test job with fail-fast:false. (2) Package job runs on all 3 OS. (3) Audit is a separate independent job — critical advisories block, high advisories tracked. (4) Lockfile integrity verification step. (5) OS-specific artifact names. 25 regression tests. 1556/1556 tests pass.

### NC-032 — No VS Code Extension Host integration tests
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `extension/src/test/runTest.ts` (new), `extension/src/test/suite/index.ts` (new), `extension/src/test/suite/secretStorage.test.ts` (new), `extension/src/test/suite/workspaceTrust.test.ts` (new), `extension/src/test/suite/editReview.test.ts` (new), `extension/src/test/suite/extensionActivation.test.ts` (new), `extension/tsconfig.test.json` (new), `extension/.vscode-test.mjs` (new), `extension/package.json`, `extension/tsconfig.json`
- **Verified:** yes — verified against current source; VS Code Extension Development Host integration test infrastructure created and all 46 tests pass
- **Required tests:** SecretStorage manifest validation, Workspace Trust declaration, edit path containment, stale content detection, webview message validation, setting key allowlist, VS Code WorkspaceEdit application, extension activation/registration
- **Verification commands:** `node extension/out/test/runTest.js`
- **Resolution evidence:** (1) Installed `@vscode/test-electron`, `@vscode/test-cli`, `mocha`, `@types/mocha` as devDependencies. (2) Created `extension/src/test/runTest.ts` — test runner that downloads VS Code and launches Extension Development Host. (3) Created `extension/src/test/suite/index.ts` — Mocha TDD suite loader. (4) Created 4 test suites: `secretStorage.test.ts` (13 tests), `workspaceTrust.test.ts` (6 tests), `editReview.test.ts` (17 tests), `extensionActivation.test.ts` (10 tests). Total: 46 integration tests covering NC-002, NC-003, NC-005, NC-006, NC-008, NC-020, NC-022, NC-023, NC-035, NC-038, NC-042. (5) Created `extension/tsconfig.test.json` for test compilation with mocha types. (6) Updated `extension/tsconfig.json` to exclude `src/test` from main compilation. (7) Added `build:test`, `test:integration`, `test:integration:cli` scripts. (8) 46/46 integration tests pass. 1911/1911 unit tests pass. Build clean. All type-checks clean.

### NC-033 — Security tests are environment-dependent and partly test execution instead of policy
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `agent-core/tests/securityPolicyClassification.test.ts` (new), `agent-core/tests/realModelSecurity.test.ts`, `agent-core/tests/securityRegression.test.ts`, `agent-core/tests/terminalDenyByDefault.test.ts`, `agent-core/tests/terminalArbitraryExecution.test.ts`, `agent-core/tests/toolApprovalPolicy.test.ts`, `agent-core/tests/searchInjection.test.ts`
- **Verified:** yes — verified against current source; pure policy tests consolidated, category headers added, platform guards added
- **Required tests:** pure policy tests validate classification without running commands; platform adapter tests only on relevant OS; network mocked in unit tests
- **Verification commands:** `npx vitest run agent-core/tests/securityPolicyClassification.test.ts`
- **Resolution evidence:** (1) New `agent-core/tests/securityPolicyClassification.test.ts` (288 pure policy tests): tool risk classification (safe/low-risk/destructive for all tools), approval requirements (safe tools don't require, write/destructive do), auto-executable classification (only safe tools), terminal command validation (SAFE_PATTERNS allows/denies/blocks/shell-expansion/destructive/coverage), path containment (cross-platform absolute detection, null bytes, traversal, valid paths, absolute rejection), webview message validation (reject non-objects, accept valid types, reject unknown types, setting key allowlist, openFile containment), secret redaction (pattern detection), approval mode constraints (bypass removed, writes not auto-approved, policy is sole truth). Zero network access, zero real command execution, works on any platform. (2) `realModelSecurity.test.ts`: added `IS_WINDOWS` constant, replaced inline `process.platform` checks, added NC-033 category header documenting integration test classification. (3) Added NC-033 category headers to `securityRegression.test.ts`, `terminalDenyByDefault.test.ts`, `terminalArbitraryExecution.test.ts`, `toolApprovalPolicy.test.ts`, `searchInjection.test.ts` documenting pure policy vs integration vs platform-dependent classification. 1866/1866 tests pass. Build clean. All type-checks clean.

### NC-034 — Three source modules are dead/disconnected
- **Severity:** Medium
- **Status:** fixed
- **Phase:** F
- **Dependencies:** none
- **Affected files:** `agent-core/src/agents/subagent.ts`, `agent-core/src/tools/batchEditor.ts`, `extension/webview/src/components/StreamingText.tsx`
- **Verified:** yes — verified against current source; all three files are dead code with no imports
- **Required tests:** dead modules removed; no barrel exports reference them; no imports found
- **Verification commands:** `npx vitest run agent-core/tests/deadModuleRemoval.test.ts`
- **Resolution evidence:** (1) `agent-core/src/agents/subagent.ts` deleted — comment-only placeholder for removed SubAgentManager, no imports anywhere. (2) `agent-core/src/tools/batchEditor.ts` deleted — unused BatchEditor class, no imports or instantiation anywhere. (3) `extension/webview/src/components/StreamingText.tsx` deleted — unused React component, not imported by any other component (StreamingMessage uses useStreamingText hook, not StreamingText). (4) 9 regression tests in `agent-core/tests/deadModuleRemoval.test.ts`: file existence checks (3), no barrel exports (2), no imports in agent-core source (2), no imports in webview source (1), no other dead code references (1). 1075/1075 unit tests pass. Build clean. All type-checks clean.

### NC-035 — Configuration schema and runtime usage disagree
- **Severity:** Medium
- **Status:** fixed
- **Phase:** C
- **Dependencies:** NC-005 (webview validation)
- **Affected files:** `extension/package.json`, `agent-core/src/utils/webviewMessageValidation.ts`
- **Verified:** yes — verified against current source; 4 missing settings added to package.json, 4 dead keys removed from ALLOWED_SETTING_KEYS
- **Required tests:** every supported setting declared in manifest; scope, validation, defaults, trust restrictions defined; no arbitrary keys accepted; dead keys removed
- **Verification commands:** `npx vitest run agent-core/tests/configSchemaAlignment.test.ts && npx vitest run agent-core/tests/webviewValidation.test.ts`
- **Resolution evidence:** (1) Added 4 missing settings to `extension/package.json`: `openAIBaseUrl` (string, default "https://opencode.ai/zen/go/v1"), `ollamaBaseUrl` (string, default "http://localhost:11434"), `searchProvider` (enum: tavily/serper/google/bing/duckduckgo, default "tavily"), `searchBaseUrl` (string, default ""). (2) Removed 4 dead keys from `ALLOWED_SETTING_KEYS` in `agent-core/src/utils/webviewMessageValidation.ts`: `autoApproveWrite`, `maxConcurrentTasks`, `theme`, `mcpServers`. (3) 11 new regression tests in `agent-core/tests/configSchemaAlignment.test.ts` validate: all runtime-read keys declared in package.json, all allowlist keys declared, no dead keys, restricted configs declared, endpoint URLs restricted, secrets excluded, all settings have type+description. (4) Updated `agent-core/tests/webviewValidation.test.ts`: removed `theme` assertion, added `searchProvider`/`searchBaseUrl`/`allowWorkspacePrompts` assertions, added dead key rejection tests. 948/948 unit tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the schema alignment is complete. All runtime-read keys are declared, all allowlist keys are declared, and dead keys have been removed.

### NC-036 — Monolithic files obscure state and security boundaries
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** none (architectural, low-risk refactoring)
- **Affected files:** `extension/webview/src/main.tsx:5648 lines`, `agent-core/src/orchestrator.ts:3087 lines`, `extension/src/sidebarViewProvider.ts:1467 lines`
- **Verified:** unverified
- **Required tests:** existing tests still pass after split; dependency injection enables unit testing
- **Verification commands:** `npm test`, `npm run build`
- **Resolution evidence:** (none yet)

### NC-037 — Webview bundle is unnecessarily large
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** NC-036 (splitting main.tsx)
- **Affected files:** `extension/webview/` build config, `extension/media/main.js`
- **Verified:** unverified
- **Required tests:** lazy-loaded modules; bundle size under budget
- **Verification commands:** bundle analysis, `npm run build`
- **Resolution evidence:** (none yet)

### NC-038 — Generated webview artifacts are tracked
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `extension/media/main.js`, `extension/media/main.css`, `.gitignore`
- **Verified:** yes — verified against current source; generated files removed from git tracking, added to .gitignore
- **Required tests:** generated files not in Git; build scripts still reference output files; static assets remain tracked
- **Verification commands:** `npx vitest run agent-core/tests/generatedArtifacts.test.ts`
- **Resolution evidence:** `.gitignore` changed: added `extension/media/main.js` and `extension/media/main.css` entries (specific, not blanket `extension/media/*`). `git rm --cached` removed both generated files from tracking. Static assets (icon.png, activitybar-icon.svg, kiboko.svg, fonts) remain tracked. Build scripts (`build:webview:js`, `build:webview:css`) still reference the output files. 9 regression tests in `agent-core/tests/generatedArtifacts.test.ts`: .gitignore entries present (3), git tracking status verified (2), build scripts reference output (2), static assets still tracked (2). 1397/1397 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** CI/build pipelines that package from a fresh clone without running `npm run build:webview` first will not have these files. This is correct behavior — the build step generates them.

### NC-039 — Constructor side effects perform network and persistence work
- **Severity:** Medium
- **Status:** fixed
- **Phase:** D / J
- **Dependencies:** NC-001 (provider lazy construction)
- **Affected files:** `agent-core/src/orchestrator.ts:147-255`, `extension/src/sidebarViewProvider.ts:1033-1084`
- **Verified:** yes — verified against current source; memory.initialize() removed from constructor, explicit initialize()/dispose() lifecycle added
- **Required tests:** explicit initialize()/dispose() lifecycle; constructors instantiate without network/filesystem side effects
- **Verification commands:** `npx vitest run agent-core/tests/orchestratorLifecycle.test.ts`
- **Resolution evidence:** `30416be` — `agent-core/src/orchestrator.ts` changed: (1) Removed eager `this.memory.initialize().catch(...)` from constructor — no filesystem I/O during construction. (2) Added `async initialize(): Promise<void>` method that calls `this.memory.initialize()` with error handling. (3) Added `async dispose(): Promise<boolean>` method that flushes memory and feedback logger resources. `extension/src/sidebarViewProvider.ts` changed: (4) Added `await this.orchestrator.initialize()` call after `createNexcodeOrchestrator()` construction. 19 regression tests in `agent-core/tests/orchestratorLifecycle.test.ts`: constructor has no filesystem reads/mkdirs/fetch calls, returns synchronously (<100ms), initialize() is async/loads memory/handles errors gracefully, dispose() flushes resources/can be called without initialize()/returns true on success, backward compat (construction without initialize still works, empty memory context). 1495/1495 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the fix is backward compatible. The orchestrator works without calling `initialize()`, but memory context will not be available until initialization completes. This is the correct behavior for tests and lightweight usage.

### NC-040 — Retry and fallback behavior can multiply latency and cost
- **Severity:** Medium
- **Status:** fixed
- **Phase:** D
- **Dependencies:** NC-013 (fallback policy)
- **Affected files:** `agent-core/src/utils/retryBudget.ts` (new), `agent-core/src/types.ts`, `agent-core/src/providers/modelRouter.ts`, `agent-core/src/providers/openAICompatibleProvider.ts`, `agent-core/src/agents/agentLoop.ts`, `agent-core/src/index.ts`
- **Verified:** yes — verified against current source; shared RetryBudget prevents unbounded retry multiplication across all layers
- **Required tests:** single retry budget enforced across router/provider/HTTP layers; exhausted budget stops fallback; backward compatible without budget
- **Verification commands:** `npx vitest run agent-core/tests/retryBudget.test.ts`
- **Resolution evidence:** (1) `agent-core/src/utils/retryBudget.ts` (new, 92 lines): `RetryBudget` class with `canAttempt()`/`recordAttempt()` API, configurable `maxAttempts` (default 8), `getSnapshot()` for diagnostics, `createDefaultRetryBudget()` factory. (2) `agent-core/src/types.ts`: added `RetryBudgetLike` structural type interface; added `retryBudget?` to `ModelRequest` and `ProviderGenerateOptions`. (3) `agent-core/src/providers/modelRouter.ts`: `generate()` and `stream()` check `retryBudget.canAttempt()` before each fallback candidate, break when exhausted, pass budget through to provider. (4) `agent-core/src/providers/openAICompatibleProvider.ts`: `fetchWithRetries()` checks `retryBudget.canAttempt()` before HTTP retries, calls `retryBudget.recordAttempt()` after each fetch. (5) `agent-core/src/agents/agentLoop.ts`: creates shared `RetryBudget` via `createDefaultRetryBudget()` per agent loop run, passes to all `generate()` calls. (6) `agent-core/src/index.ts`: exports `RetryBudget`, `createDefaultRetryBudget`, `RetryBudgetConfig`. (7) 10 regression tests in `agent-core/tests/retryBudget.test.ts`: RetryBudget unit (6), ModelRouter integration (4 — passthrough, exhaustion stops candidates, sufficient budget allows fallback, backward compat). 1505/1505 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** The budget does not track Retry-After headers or token/cost budgets (those are separate concerns). The default of 8 attempts is conservative — covers 1 explicit + 2 HTTP retries per attempt with headroom for one fallback candidate.

### NC-041 — Token estimation and context compression are too approximate
- **Severity:** Medium
- **Status:** fixed
- **Phase:** D
- **Dependencies:** none
- **Affected files:** `agent-core/src/utils/tokenCounter.ts`, `agent-core/src/utils/contextCompressor.ts`, `agent-core/src/providers/modelRouter.ts`, `agent-core/src/providers/openAICompatibleProvider.ts`, `agent-core/src/providers/ollamaProvider.ts`, `agent-core/src/orchestrator.ts`, `agent-core/src/types.ts`, `agent-core/src/utils/modelCapabilityRegistry.ts`
- **Verified:** yes — verified against current source; provider usage calibration, model-specific chars-per-token, content-hash dedup implemented
- **Required tests:** provider usage calibration; model-specific ratio; content-hash dedup; ContextCompressor fromContextWindow; ProviderUsage extraction
- **Verification commands:** `npx vitest run agent-core/tests/tokenEstimation.test.ts`
- **Resolution evidence:** (1) `TokenCounter`: DEFAULT_CHARS_PER_TOKEN changed from 4.0 to 3.8. Added `recordProviderUsage()` with EMA calibration (alpha=0.3, 5 samples to trust). Added `setCharsPerToken()` for model-specific ratios. Added `trackRequestWithUsage()` using real provider token counts. Added `isCalibrated()`, `getCharsPerToken()`, `getCalibrationSampleCount()`. Reset clears calibration. (2) `ProviderUsage` interface + `ModelResponse.usage` field. (3) `OpenAICompatibleProvider` extracts usage from API responses. (4) `OllamaProvider` extracts usage from API responses. (5) `ModelCapabilityRegistry`: charsPerToken added to all 40+ entries, `getCharsPerToken()` method. (6) `Orchestrator` reads charsPerToken from registry. (7) `ContextCompressor.fromContextWindow()` proportional threshold. Content-hash dedup. (8) 44 new tests in `agent-core/tests/tokenEstimation.test.ts`. Updated `contextBudget.test.ts` and `realModelSecurity.test.ts`. 1911/1911 tests pass. Build clean.

### NC-042 — Exposing "reasoning" by default is the wrong UX contract
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `extension/package.json:132-135`, `extension/src/sidebarViewProvider.ts:1237`
- **Verified:** yes — verified against current source; showReasoning defaults to false in manifest and sidebar fallback
- **Required tests:** showReasoning defaults to false; reasoning UI components still exist when explicitly enabled
- **Verification commands:** `npx vitest run agent-core/tests/showReasoningDefault.test.ts`
- **Resolution evidence:** `extension/package.json` changed: `nexcodeKiboko.showReasoning` default changed from `true` to `false`. Description updated to note disabled-by-default and explain that provider-specific reasoning artifacts are unstable internal model output. `extension/src/sidebarViewProvider.ts` changed: `config.get<boolean>("showReasoning", true)` fallback changed to `config.get<boolean>("showReasoning", false)`. 5 regression tests in `agent-core/tests/showReasoningDefault.test.ts`: manifest default is false (1), description mentions disabled (1), sidebar fallback is false (1), showReasoning in allowed setting keys (1), reasoning UI components still exist in webview (1). 1397/1397 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — changing the default is a safe behavioral change. Users who explicitly enable showReasoning still see reasoning. The webview ReasoningIndicator component is unchanged.

### NC-043 — Completed tasks accumulate indefinitely during normal use
- **Severity:** Medium
- **Status:** fixed
- **Phase:** G
- **Dependencies:** NC-010 (task concurrency)
- **Affected files:** `agent-core/src/taskQueue.ts`, `agent-core/src/taskManager.ts`
- **Verified:** yes — verified against current source; auto-prune added to terminal state transitions, configurable history bounds
- **Required tests:** bounded history; automatic cleanup; retention limits; age-based pruning; size-based pruning; constructor backward compat
- **Verification commands:** `npx vitest run agent-core/tests/taskHistoryBounds.test.ts`
- **Resolution evidence:** `agent-core/src/taskQueue.ts` changed: (1) Added `TaskQueueOptions` interface with `maxConcurrent`, `maxHistorySize` (default 100), `maxHistoryAgeMs` (default 30 min). (2) Constructor accepts `TaskQueueOptions | number` (backward compatible). (3) `pruneCompletedTasks()` enforces both age-based (removeCompleted) and size-based (LRU oldest terminal) pruning. Returns total removed count. (4) `getCompletedCount()` and `getCompletedTasks()` expose terminal task history. (5) Auto-prune called after `complete()`, `fail()`, and `cancel()`. `agent-core/src/taskManager.ts` changed: (1) `TaskManagerOptions` extended with `maxHistorySize` and `maxHistoryAgeMs`. (2) Constructor passes options through to TaskQueue. (3) Exposed `getCompletedTasks()`, `getCompletedCount()`, `pruneCompletedTasks()`, `getTotalTaskCount()`. 29 regression tests in `agent-core/tests/taskHistoryBounds.test.ts`. 1426/1426 tests pass. Build clean. All type-checks clean.
- **Remaining risk:** None — the history is now bounded by both age (30 min default) and count (100 default). Both limits are configurable.

### NC-044 — Package/release flow is not sufficiently hermetic
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `tools/extension-release.mjs`, `.github/workflows/ci.yml`, `extension/.vscodeignore`, `agent-core/tests/hermeticPackaging.test.ts` (new)
- **Verified:** yes — verified against current source; hermetic install, VSIX verification, SBOM, provenance added
- **Required tests:** VSIX from lockfile; contents verified; SBOM generated
- **Verification commands:** `npx vitest run agent-core/tests/hermeticPackaging.test.ts`
- **Resolution evidence:** (1) `extension-release.mjs`: `stageEntries` includes `package-lock.json`. `installStageDependencies` uses `npm ci` (lockfile-based) with fallback warning for missing lockfile. (2) Lockfile integrity verification before staging — rejects malformed/missing lockfiles. (3) `assertVsixDependencies` expanded from 2 to 8 required entries; forbidden entries check rejects test/source/map/config files. (4) `build-info.json` enhanced with platform, arch, npm version, provenance metadata, and dependency manifest from lockfile. (5) CI workflow: VSIX verification step, lockfile integrity check, dependency manifest generation, DEPENDENCIES.json artifact upload. (6) `.vscodeignore` excludes `DEPENDENCIES.json`. (7) 22 regression tests in `hermeticPackaging.test.ts`. 1578/1578 tests pass. Build clean. All type-checks clean.

### NC-045 — Dependency audit cannot be treated as optional
- **Severity:** Medium
- **Status:** fixed
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `.github/workflows/ci.yml`, `agent-core/tests/ciWorkflow.test.ts`
- **Verified:** yes — verified against current source; audit is separate job, critical blocks, high tracked
- **Required tests:** audit failures visible and reviewed; lockfile scanning
- **Verification commands:** `npx vitest run agent-core/tests/ciWorkflow.test.ts`
- **Commit:** `ef2e80e`
- **Resolution evidence:** (1) Audit is a separate independent CI job. (2) Critical advisories block (no continue-on-error). (3) High advisories tracked with continue-on-error. (4) Lockfile integrity verification step. 25 regression tests. 1556/1556 tests pass.

---

## Dependency Graph Summary

```
NC-001 (provider key isolation)
├── NC-002 (workspace redirect) [Phase 0]
├── NC-014 (provider identity) [Phase D]
├── NC-013 (model fallback) [Phase D]
├── NC-027 (secret redaction) [Phase I]
└── NC-039 (constructor side effects) [Phase D/J]

NC-003 (webview secrets)
└── NC-024 (secret migration) [Phase 0]

NC-004 (terminal safety)
├── NC-007 (search injection) [Phase 0/E]
├── NC-012 (cancellation) [Phase E/G]
└── NC-016 (tool schema validation) [Phase C/E]

NC-005 (webview validation)
└── NC-035 (config schema) [Phase C]

NC-006 (edit integrity)
├── NC-018 (batch edits) [Phase F]
└── NC-023 (multi-root) [Phase F/G]

NC-020 (path containment)
├── NC-006 (edit integrity) [Phase 0/F]
├── NC-021 (symlink delete) [Phase F]
├── NC-023 (multi-root) [Phase F/G]
└── NC-006 (edit integrity) [Phase 0/F]

NC-010 (task concurrency)
├── NC-011 (steering) [Phase G]
├── NC-012 (cancellation) [Phase E/G]
├── NC-026 (persistence races) [Phase I]
└── NC-043 (task history) [Phase G]

NC-013 (fallback policy)
└── NC-015 (model capabilities) [Phase D]

NC-016 (tool schema validation)
└── NC-017 (malformed tool calls) [Phase C]
```

## Execution Order (Phase 0 containment first)

**Phase 0 (containment — highest priority, do first):**
1. NC-001 — provider key isolation ✅
2. NC-002 — workspace trust / endpoint scope ✅
3. NC-003 — webview secret removal ✅
4. NC-004 — terminal deny-by-default ✅
5. NC-005 — webview message validation ✅
6. NC-006 — edit preconditions ✅
7. NC-007 — search injection fix ✅
8. NC-008 — approval mode hardening ✅
9. NC-010 — concurrency limit to 1 ✅
10. NC-022 — workspace prompt overrides ✅
11. NC-024 — secret migration cleanup ✅
12. NC-028 — blog fallback removal ✅
13. NC-009 — MCP marked experimental ✅

**Phase C (runtime schema boundary):**
14. NC-016 — tool schema validation ✅
15. NC-017 — malformed tool call rejection ✅
16. NC-035 — config schema alignment

**Phase D (credentials and providers):**
17. NC-014 — provider identity
18. NC-013 — fallback policy
19. NC-015 — model capabilities
20. NC-025 — response cache ✅
21. NC-039 — constructor lifecycle ✅
22. NC-040 — retry budget
23. NC-041 — token estimation

**Phase E (tool and terminal redesign):**
24. NC-012 — cancellation propagation
25. NC-016 is done in Phase C

**Phase F (filesystem and edit integrity):**
26. NC-020 — cross-platform path containment
27. NC-019 — atomic writes
28. NC-021 — symlink delete
29. NC-018 — batch edit transactions
30. NC-023 — multi-root support
31. NC-028 is done in Phase 0
32. NC-034 — dead module cleanup

**Phase G (task state machine and concurrency):**
33. NC-010 is done in Phase 0
34. NC-011 — steering state machine ✅
35. NC-043 — task history bounds

**Phase I (persistence and observability):**
36. NC-026 — persistence serialization
37. NC-027 — secret redaction

**Phase H (MCP):**
38. NC-009 is done in Phase 0 (decision/labeling)

**Phase J (quality gates):**
39. NC-029 — documentation
40. NC-030 — ESLint
41. NC-031 — CI matrix
42. NC-032 — integration tests ✅
43. NC-033 — test isolation
44. NC-036 — file splitting
45. NC-037 — bundle optimization
46. NC-038 — generated artifacts
47. NC-042 — reasoning UX
48. NC-044 — hermetic packaging
49. NC-045 — dependency audit
