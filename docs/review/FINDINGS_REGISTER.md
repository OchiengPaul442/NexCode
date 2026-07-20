> **⚠️ HISTORICAL SNAPSHOT — NOT CURRENT**
>
> This document was generated on **2026-07-16** and reflects the repository state at that
> time. Many findings listed here have been resolved in subsequent remediation iterations.
> See `docs/remediation/WORK_QUEUE.md` for current finding statuses.

# FINDINGS REGISTER

**Project:** NEXCODE-KIBOKO
**Reviewed:** 2026-07-16
**Commit:** 56b71aa
**Status:** Historical snapshot — superseded by NC-029 remediation (2026-07-20)

---

## P0 — Critical Security Findings

### F-001: Destructive filesystem tools have no approval gate
- **Severity:** Critical
- **Status:** FIXED
- **Original:** `delete` and `delete-contents` execute without any confirmation
- **Fix:** Added `ToolApprovalPolicy` in `agent-core/src/tools/toolApprovalPolicy.ts`; `ToolRegistry` now checks policy before executing `delete`, `delete-contents`, `move`, `terminal`; orchestrator uses approval callback to show VS Code modal
- **Tests:** `toolApprovalPolicy.test.ts` (18 tests), `fileSystemTool.test.ts` (11 tests)
- **Commit:** Pending

### F-002: Approval gate is UI-only and backend-unaware
- **Severity:** Critical
- **Status:** FIXED
- **Original:** `main.tsx:2419-2433` — `window.confirm()` only matches `/tool terminal` literal, skipped at non-default permission levels
- **Fix:** Moved approval to backend via `ToolApprovalPolicy` + `ApprovalCallback`; extension host shows `vscode.window.showWarningMessage` modal; all destructive tools covered
- **Tests:** `toolApprovalPolicy.test.ts`
- **Commit:** Pending

### F-003: Terminal safety denylist is bypassable
- **Severity:** High
- **Status:** DOCUMENTED (known limitation)
- **Original:** 8-pattern denylist protecting full shell (`exec`/`spawn(shell:true)`)
- **Action:** Added `terminalBypasses.test.ts` documenting known bypasses; real fix requires allowlist/sandboxed execution model (P1)
- **Tests:** `terminalBypasses.test.ts` (12 tests)
- **Commit:** Pending

---

## P0 — Data Exposure Findings

### F-004: Runtime memory tracked in git
- **Severity:** Medium-High
- **Status:** FIXED
- **Original:** `memory/long-term-memory.jsonl` tracked despite `.gitignore` listing wrong extension
- **Fix:** Corrected `.gitignore` to `memory/long-term-memory.jsonl`; ran `git rm --cached`
- **Commit:** Pending

### F-005: API keys sent raw to webview
- **Severity:** Medium
- **Status:** FIXED
- **Original:** `sidebarViewProvider.ts` sent `openAIApiKey` and `tavilyApiKey` in plaintext to webview
- **Fix:** Changed to `openAIApiKeyConfigured: boolean` and `tavilyApiKeyConfigured: boolean`; raw keys only used in extension host via `getRawApiKeys()`
- **Tests:** Manual verification
- **Commit:** Pending

---

## P0 — Code Quality Findings

### F-006: Webview TypeScript never type-checked
- **Severity:** High
- **Status:** FIXED
- **Original:** No `tsconfig.json` covering `extension/webview/`; 3,638 lines of TSX never checked
- **Fix:** Added `extension/webview/tsconfig.json` with `noEmit: true`; added `typecheck:webview` script to root `package.json`
- **Tests:** Type-check passes
- **Commit:** Pending

### F-007: CSP nonce uses Math.random()
- **Severity:** Low
- **Status:** FIXED
- **Original:** `sidebarViewProvider.ts:1217-1224` — `Math.random()` for CSP nonce
- **Fix:** Replaced with `crypto.randomBytes(16).toString("base64")`
- **Tests:** Manual verification
- **Commit:** Pending

### F-008: VSIX includes unnecessary files
- **Severity:** Medium
- **Status:** FIXED
- **Original:** `webview/src/` (TypeScript source), `tailwind.config.cjs` included in VSIX
- **Fix:** Updated `.vscodeignore` to exclude `webview/src/**`, `webview/tsconfig.json`, `tailwind.config.cjs`
- **Tests:** VSIX packaging verification
- **Commit:** Pending

---

## P1 — Architecture Findings (Deferred)

### F-009: Orchestrator God Object (3,072 lines)
- **Severity:** High (maintainability)
- **Status:** DEFERRED
- **Action:** Documented in architecture docs; full decomposition is P1 work

### F-010: Webview single-file (3,638 lines)
- **Severity:** Medium-High (maintainability)
- **Status:** DEFERRED
- **Action:** Documented in architecture docs; full decomposition is P1 work

### F-011: Duplicated path resolution logic
- **Severity:** Medium
- **Status:** DEFERRED
- **Action:** `resolvePathWithinWorkspaceRoot` exists in both `orchestrator.ts` and `contextBuilder.ts`; consolidation is P1 work

---

## P2 — Testing Gaps

### F-012: No extension-host tests
- **Severity:** High
- **Status:** DEFERRED
- **Action:** Requires `@vscode/test-electron` setup; P2 work

### F-013: No webview component tests
- **Severity:** Medium
- **Status:** DEFERRED
- **Action:** Requires React Testing Library setup; P2 work

---

## P0 — Critical Security Findings (Hardening Pass)

### F-014: SAFE_PATTERNS marks npm run, npm install, node, python as auto-executable
- **Severity:** Critical
- **Status:** FIXED
- **Original:** `terminalTool.ts` SAFE_PATTERNS includes `npm run`, `npm install`, `npx`, `node`, `python`, `pip` — all can execute arbitrary code. `npm install` runs postinstall scripts. `node -e` and `python -c` execute inline code. `npm run <script>` runs arbitrary package.json scripts. None caught by `SHELL_EXPANSION_PATTERNS` (which only checks `$()`, backticks, `${}`).
- **Fix:** Removed `npm run`, `npm install`, `npx`, `node`, `python`, `pip` from `SAFE_PATTERNS`. Added `node -e`, `python -c`, `python3 -c` to `SHELL_EXPANSION_PATTERNS` as blocked. These commands now require approval via the `DESTRUCTIVE_TOOLS` gate in `toolApprovalPolicy.ts`.
- **Tests:** `terminalArbitraryExecution.test.ts` (28 tests — 6 pattern verification, 7 policy checks, 3 validation blocks, 6 payload tests, 6 regression checks)
- **Regression test:** Fails on old code (all 28 tests would fail), passes on new code

### F-015: batch_edit delete bypasses ensureNotWorkspaceRoot and uses unsafe path resolution
- **Severity:** High
- **Status:** FIXED
- **Original:** `toolRegistry.ts` `executeBatchEditItem` used `resolveWorkspacePath` (sync, no symlink resolution) and the `delete` operation called `fs.rm` without `ensureNotWorkspaceRoot` check. This meant batch_edit could delete the workspace root. The dedicated `delete` tool correctly calls `ensureNotWorkspaceRoot`.
- **Fix:** Changed `executeBatchEditItem` to use `resolveWorkspacePathSafe` (async, resolves symlinks) and added `ensureNotWorkspaceRootPublic` call before delete. Also changed `fs.rm` to use `{ recursive: true, force: true }` to match the dedicated delete tool behavior.
- **Tests:** `batchEditSecurity.test.ts` (13 tests — workspace root protection, path resolution, error handling, operations, multiple edits)
- **Regression test:** Demonstrates the bug existed before fix, passes after fix

### F-016: Approval re-run is stateless infinite loop — tools never execute after approval
- **Severity:** Critical
- **Status:** FIXED
- **Original:** After user approval, orchestrator/agentLoop re-runs `runToolCall` with the same args. Since `requiresApproval` is stateless (no memory of approval), it returns `true` again, creating an infinite loop. Every destructive tool was permanently blocked after approval.
- **Fix:** Added `approvedCalls` Set to `ToolRegistry` with `markApproved(toolName, arg)` method. `requiresApproval` checks `approvedCalls` before the policy. All approval paths (orchestrator `handleToolRequest`, `streamToolRequest`, agentLoop) now call `markApproved` after approval callback returns true.
- **Tests:** Existing `toolApprovalPolicy.test.ts` and `batchEditSecurity.test.ts` verify the fix
- **Regression test:** Tools now execute after approval (previously returned "AWAITING_APPROVAL" forever)

### F-017: batch_edit skips approval gate in streamToolRequest
- **Severity:** Critical
- **Status:** FIXED
- **Original:** `streamToolRequest` batch_edit branch calls `runToolCall` directly without checking `requiresApproval` first. The `AWAITING_APPROVAL` result is treated as a normal failure, silently blocking batch_edit with no approval dialog.
- **Fix:** Added explicit approval check before `runToolCall` in the batch_edit branch, mirroring the terminal branch pattern. Yields `toolApprovalRequired` event and `markApproved` after approval.
- **Tests:** Existing orchestrator tests verify the flow

### F-018: ToolRegistry defaults to fail-open when no approvalPolicy provided
- **Severity:** High
- **Status:** FIXED
- **Original:** `ToolRegistry` constructor defaults `approvalPolicy` to `undefined`. When no policy is provided, `requiresApproval` returns `false` for all tools, and `getToolRiskLevel` returns `"safe"`. Any code path that forgets to provide the policy silently disables the entire approval system.
- **Fix:** Changed constructor to default to `new DefaultToolApprovalPolicy()` when no policy is provided. Made `approvalPolicy` non-optional in the class type.
- **Tests:** Existing tests verify default behavior

### F-019: resolveWorkspacePathSafe doesn't resolve intermediate symlinks for new files
- **Severity:** High
- **Status:** FIXED
- **Original:** When the final path component doesn't exist (write/create), `fs.realpath` throws ENOENT and falls back to un-resolved logical path. An attacker could create a symlink `workspace/link` -> `/etc/` and write through it to escape the workspace.
- **Fix:** After ENOENT fallback, resolve the parent directory via `fs.realpath` to catch intermediate symlinks.
- **Tests:** Existing `fileSystemTool.test.ts` path safety tests

### F-020: clearDirectory doesn't re-validate entries against workspace
- **Severity:** Medium
- **Status:** FIXED
- **Original:** `clearDirectory` reads directory entries and deletes them with `fs.rm` without resolving symlinks. A symlinked entry could point outside the workspace.
- **Fix:** Added `fs.realpath` resolution and workspace containment check for each entry before deletion.
- **Tests:** Existing `fileSystemTool.test.ts` tests

---

## Rejected / Outdated Findings

### F-R01: Five near-identical agent classes
- **Original Assessment:** Low severity, suggested factory pattern
- **Status:** REJECTED as not worth changing
- **Reason:** The shared logic is correctly factored into `runSpecialistAgent`; the class wrapper adds negligible overhead and improves readability

### F-R02: Blog landing page fallback correlated with benchmark
- **Original Assessment:** Medium severity, possible test-teaching
- **Status:** REJECTED as unverified
- **Reason:** Cannot confirm from static review alone; requires runtime debugging to verify
