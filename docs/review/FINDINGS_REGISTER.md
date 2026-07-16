# FINDINGS REGISTER

**Project:** NEXCODE-KIBOKO
**Reviewed:** 2026-07-16
**Commit:** 56b71aa

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

## Rejected / Outdated Findings

### F-R01: Five near-identical agent classes
- **Original Assessment:** Low severity, suggested factory pattern
- **Status:** REJECTED as not worth changing
- **Reason:** The shared logic is correctly factored into `runSpecialistAgent`; the class wrapper adds negligible overhead and improves readability

### F-R02: Blog landing page fallback correlated with benchmark
- **Original Assessment:** Medium severity, possible test-teaching
- **Status:** REJECTED as unverified
- **Reason:** Cannot confirm from static review alone; requires runtime debugging to verify
