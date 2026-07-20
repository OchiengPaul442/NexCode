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
- **Status:** pending
- **Phase:** G
- **Dependencies:** NC-010 (task isolation)
- **Affected files:** `agent-core/src/taskQueue.ts:98-106,109-125`, `agent-core/src/taskManager.ts:62-89`
- **Verified:** unverified
- **Required tests:** steering during planning/running/verifying follows state machine; route by session/task not first global active
- **Verification commands:** `npx vitest run agent-core/tests/steering.test.ts`
- **Resolution evidence:** (none yet)

### NC-012 — Cancellation does not propagate through all tools and child processes
- **Severity:** High
- **Status:** pending
- **Phase:** E / G
- **Dependencies:** NC-004 (terminal tool), NC-010 (task context)
- **Affected files:** `extension/src/sidebarViewProvider.ts:508-517`, `agent-core/src/tools/terminalTool.ts:548-653`, `agent-core/src/agents/agentLoop.ts`
- **Verified:** unverified
- **Required tests:** task cancellation terminates child process trees; AbortSignal propagated to all tools; cleanup completes before final task state
- **Verification commands:** `npx vitest run agent-core/tests/cancellation.test.ts`
- **Resolution evidence:** (none yet)

### NC-013 — Model fallback is advertised but not implemented
- **Severity:** High
- **Status:** pending
- **Phase:** D
- **Dependencies:** NC-001 (provider isolation), NC-014 (provider identity)
- **Affected files:** `agent-core/src/providers/modelRouter.ts:115-159`
- **Verified:** unverified
- **Required tests:** fallback policy is explicit and ordered; cross-provider fallback only with user opt-in; actual attempted list reported
- **Verification commands:** `npx vitest run agent-core/tests/modelRouter.test.ts`
- **Resolution evidence:** (none yet)

### NC-014 — Provider identity collapses to openai-compatible
- **Severity:** High
- **Status:** pending
- **Phase:** D
- **Dependencies:** NC-001 (provider isolation)
- **Affected files:** `agent-core/src/providers/openAICompatibleProvider.ts:55-62`, `agent-core/src/orchestrator.ts:347`
- **Verified:** unverified
- **Required tests:** each provider instance reports correct concrete ID; provider ID in telemetry without secret
- **Verification commands:** `npx vitest run agent-core/tests/providerIdentity.test.ts`
- **Resolution evidence:** (none yet)

### NC-015 — Model capability detection is brittle hardcoded name heuristic
- **Severity:** High
- **Status:** pending
- **Phase:** D
- **Dependencies:** NC-013 (fallback), NC-014 (provider identity)
- **Affected files:** `agent-core/src/providers/modelRouter.ts:18-57`
- **Verified:** unverified
- **Required tests:** unknown model gets conservative defaults; provider-reported metadata preferred; user overrides supported
- **Verification commands:** `npx vitest run agent-core/tests/modelCapabilities.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** F
- **Dependencies:** NC-019 (atomic writes), NC-006 (edit preconditions)
- **Affected files:** `agent-core/src/tools/toolRegistry.ts` batch-edit execution paths
- **Verified:** unverified
- **Required tests:** batch edit rollback leaves no partial modifications; full edit set validated before writing; duplicate/conflicting paths rejected
- **Verification commands:** `npx vitest run agent-core/tests/batchEdit.test.ts`
- **Resolution evidence:** (none yet)

### NC-019 — File writes are non-atomic and patch semantics are ambiguous
- **Severity:** High
- **Status:** pending
- **Phase:** F
- **Dependencies:** none
- **Affected files:** `agent-core/src/tools/fileSystemTool.ts:51-130`
- **Verified:** unverified
- **Required tests:** atomic temp-file plus rename; content hash precondition; unique patch match required; per-file serialization
- **Verification commands:** `npx vitest run agent-core/tests/fileWrites.test.ts`
- **Resolution evidence:** (none yet)

### NC-020 — Cross-platform path containment is host-dependent
- **Severity:** High
- **Status:** pending
- **Phase:** F
- **Dependencies:** none
- **Affected files:** `agent-core/src/utils/pathContainment.ts`
- **Verified:** unverified
- **Required tests:** Windows paths rejected on POSIX; POSIX absolute paths rejected on Windows; UNC/drive-relative/extended-length rejected; property-based cross-platform path tests
- **Verification commands:** `npx vitest run agent-core/tests/pathContainment.test.ts`
- **Resolution evidence:** (none yet)

### NC-021 — Directory clearing follows symlinks and deletes targets
- **Severity:** High
- **Status:** pending
- **Phase:** F
- **Dependencies:** NC-020 (path containment)
- **Affected files:** `agent-core/src/tools/fileSystemTool.ts:160-183`
- **Verified:** unverified
- **Required tests:** symlink deletes unlink the symlink; never follow symlinks for delete/clear; containment rechecked before mutation
- **Verification commands:** `npx vitest run agent-core/tests/symlinkDelete.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** F / G
- **Dependencies:** NC-020 (path containment)
- **Affected files:** `extension/src/sidebarViewProvider.ts:1103-1110`
- **Verified:** unverified
- **Required tests:** workspace folder resolved from active editor/attachment/task; folder URI stored on every task/edit; no fallback to different root
- **Verification commands:** `npx vitest run agent-core/tests/multiRoot.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** D
- **Dependencies:** none
- **Affected files:** `agent-core/src/providers/modelRouter.ts:72-73,161-185`, `agent-core/src/utils/contextCache.ts`
- **Verified:** unverified
- **Required tests:** agent action responses not cached; cache partitioned by provider/model/workspace/task/content hash; bounded LRU/TTL
- **Verification commands:** `npx vitest run agent-core/tests/contextCache.test.ts`
- **Resolution evidence:** (none yet)

### NC-026 — Memory and audit persistence are race-prone and failures are swallowed
- **Severity:** High
- **Status:** pending
- **Phase:** I
- **Dependencies:** NC-010 (concurrency)
- **Affected files:** `agent-core/src/memory/shortTermMemory.ts`, `agent-core/src/memory/longTermMemory.ts`, `agent-core/src/self-improve/feedbackLogger.ts`, `agent-core/src/tools/auditLog.ts:25-53`
- **Verified:** unverified
- **Required tests:** serialized persistence per workspace; flush on deactivation/completion; degraded status surfaced; audit logs in extension storage
- **Verification commands:** `npx vitest run agent-core/tests/persistence.test.ts`
- **Resolution evidence:** (none yet)

### NC-027 — Secret redaction is not sufficient for extensible multi-provider agent
- **Severity:** High
- **Status:** pending
- **Phase:** I
- **Dependencies:** NC-001 (credential store)
- **Affected files:** `agent-core/src/utils/redact.ts`
- **Verified:** unverified
- **Required tests:** redact by known secret values; recursive structured key redaction; JWT/OAuth detectors; canary-secret tests across all sinks
- **Verification commands:** `npx vitest run agent-core/tests/redaction.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `docs/review/FINAL_REPORT.md`, `RELEASE_READINESS.md`, `TEST_MATRIX.md`, `HARDENING_LOG.md`, `README.md`
- **Verified:** unverified
- **Required tests:** docs reference current test counts; no false production-ready claims
- **Verification commands:** manual review of documentation
- **Resolution evidence:** (none yet)

### NC-030 — Lint is only TypeScript compilation
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** root, `agent-core`, and `extension` package scripts
- **Verified:** unverified
- **Required tests:** ESLint with typescript-eslint type-aware rules configured; no-floating-promises, no-misused-promises enabled
- **Verification commands:** `npm run lint` (after adding ESLint)
- **Resolution evidence:** (none yet)

### NC-031 — CI is Linux-only despite platform-specific security code
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `.github/workflows/ci.yml`
- **Verified:** unverified
- **Required tests:** Windows and macOS matrix jobs in CI
- **Verification commands:** CI workflow inspection
- **Resolution evidence:** (none yet)

### NC-032 — No VS Code Extension Host integration tests
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** (test infrastructure to be created)
- **Verified:** unverified
- **Required tests:** SecretStorage, Workspace Trust, webview messaging, multi-root, WorkspaceEdit integration tests
- **Verification commands:** `npx @vscode/test-cli` (after setup)
- **Resolution evidence:** (none yet)

### NC-033 — Security tests are environment-dependent and partly test execution instead of policy
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `agent-core/tests/` (multiple test files)
- **Verified:** unverified
- **Required tests:** pure policy tests validate classification without running commands; platform adapter tests only on relevant OS; network mocked in unit tests
- **Verification commands:** `npm test`
- **Resolution evidence:** (none yet)

### NC-034 — Three source modules are dead/disconnected
- **Severity:** Medium
- **Status:** pending
- **Phase:** F
- **Dependencies:** none
- **Affected files:** `agent-core/src/agents/subagent.ts`, `agent-core/src/tools/batchEditor.ts`, `extension/webview/src/components/StreamingText.tsx`
- **Verified:** unverified
- **Required tests:** dead modules removed or connected with tests
- **Verification commands:** import graph analysis, `npx vitest run`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `extension/media/main.js`, `extension/media/main.css`, `.gitignore`
- **Verified:** unverified
- **Required tests:** generated files not in Git; CI enforces clean regeneration
- **Verification commands:** `.gitignore` inspection, `git status` after build
- **Resolution evidence:** (none yet)

### NC-039 — Constructor side effects perform network and persistence work
- **Severity:** Medium
- **Status:** pending
- **Phase:** D / J
- **Dependencies:** NC-001 (provider lazy construction)
- **Affected files:** `agent-core/src/orchestrator.ts` constructor
- **Verified:** unverified
- **Required tests:** explicit initialize()/dispose() lifecycle; constructors instantiate without network/filesystem side effects
- **Verification commands:** `npx vitest run agent-core/tests/orchestrator.test.ts`
- **Resolution evidence:** (none yet)

### NC-040 — Retry and fallback behavior can multiply latency and cost
- **Severity:** Medium
- **Status:** pending
- **Phase:** D
- **Dependencies:** NC-013 (fallback policy)
- **Affected files:** provider and agent-loop retry paths
- **Verified:** unverified
- **Required tests:** single retry budget; Retry-After honored; total deadline/token/cost budget enforced
- **Verification commands:** `npx vitest run agent-core/tests/retryBudget.test.ts`
- **Resolution evidence:** (none yet)

### NC-041 — Token estimation and context compression are too approximate
- **Severity:** Medium
- **Status:** pending
- **Phase:** D
- **Dependencies:** none
- **Affected files:** token counting utilities, context compression
- **Verified:** unverified
- **Required tests:** provider usage data preferred; structure-aware code selection
- **Verification commands:** `npx vitest run agent-core/tests/tokenEstimation.test.ts`
- **Resolution evidence:** (none yet)

### NC-042 — Exposing "reasoning" by default is the wrong UX contract
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `extension/package.json:132-135`
- **Verified:** unverified
- **Required tests:** showReasoning defaults to false; structured progress shown instead
- **Verification commands:** manifest inspection
- **Resolution evidence:** (none yet)

### NC-043 — Completed tasks accumulate indefinitely during normal use
- **Severity:** Medium
- **Status:** pending
- **Phase:** G
- **Dependencies:** NC-010 (task concurrency)
- **Affected files:** task queue/history management
- **Verified:** unverified
- **Required tests:** bounded history; automatic cleanup; retention limits
- **Verification commands:** `npx vitest run agent-core/tests/taskHistory.test.ts`
- **Resolution evidence:** (none yet)

### NC-044 — Package/release flow is not sufficiently hermetic
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** release/packaging scripts
- **Verified:** unverified
- **Required tests:** VSIX from lockfile; contents verified; SBOM generated
- **Verification commands:** `npm run extension:package` (after fix)
- **Resolution evidence:** (none yet)

### NC-045 — Dependency audit cannot be treated as optional
- **Severity:** Medium
- **Status:** pending
- **Phase:** J
- **Dependencies:** none
- **Affected files:** `.github/workflows/ci.yml`, `package.json`
- **Verified:** unverified
- **Required tests:** audit failures visible and reviewed; lockfile scanning
- **Verification commands:** `npm audit`
- **Resolution evidence:** (none yet)

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
20. NC-025 — response cache
21. NC-039 — constructor lifecycle
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
34. NC-011 — steering state machine
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
42. NC-032 — integration tests
43. NC-033 — test isolation
44. NC-036 — file splitting
45. NC-037 — bundle optimization
46. NC-038 — generated artifacts
47. NC-042 — reasoning UX
48. NC-044 — hermetic packaging
49. NC-045 — dependency audit
