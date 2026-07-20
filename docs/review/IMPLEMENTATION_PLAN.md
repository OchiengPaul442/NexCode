> **⚠️ HISTORICAL SNAPSHOT — NOT CURRENT**
>
> This document was generated on **2026-07-16** and reflects the repository state at that
> time. Many items listed here have been completed in subsequent remediation iterations.
> See `docs/remediation/WORK_QUEUE.md` for current finding statuses.

# IMPLEMENTATION PLAN

**Project:** NEXCODE-KIBOKO
**Date:** 2026-07-16
**Status:** Historical snapshot — superseded by NC-029 remediation (2026-07-20)

---

## Completed Work

### P0 Security Fixes (All Completed)

1. **Backend-enforced tool approval policy**
   - Created `agent-core/src/tools/toolApprovalPolicy.ts`
   - Updated `ToolRegistry` to check policy before executing destructive tools
   - Added `ApprovalCallback` type for async approval flow
   - Updated orchestrator to use approval callback
   - Extension host shows `vscode.window.showWarningMessage` modal
   - Added 18 approval policy tests

2. **Fixed .gitignore memory tracking**
   - Corrected `memory/long-term-memory.json` → `memory/long-term-memory.jsonl`
   - Removed tracked file from git index

3. **Stopped sending raw API keys to webview**
   - Changed `openAIApiKey`/`tavilyApiKey` to `openAIApiKeyConfigured`/`tavilyApiKeyConfigured` (booleans)
   - Added `getRawApiKeys()` method for extension host use only

4. **Added webview tsconfig.json**
   - Created `extension/webview/tsconfig.json` with `noEmit: true`
   - Added `typecheck:webview` script to root package.json

5. **Fixed CSP nonce**
   - Replaced `Math.random()` with `crypto.randomBytes(16).toString("base64")`

6. **Fixed VSIX packaging**
   - Updated `.vscodeignore` to exclude `webview/src/**`, `tailwind.config.cjs`

### P0 Testing (All Completed)

7. **Approval policy tests** — `toolApprovalPolicy.test.ts` (18 tests)
8. **File system path safety tests** — `fileSystemTool.test.ts` (11 tests)
9. **Terminal bypass documentation tests** — `terminalBypasses.test.ts` (12 tests)

### CI Infrastructure (Completed)

10. **GitHub Actions CI workflow** — `.github/workflows/ci.yml`
    - Matrix testing: Node.js 18, 20, 22
    - Steps: install, type-check, build, test, audit
    - VSIX packaging job with artifact upload

---

## Deferred Work (P1/P2)

### P1 — Architecture
- Orchestrator decomposition (3,072 lines → multiple focused modules)
- Webview decomposition (3,638 lines → components by concern)
- Duplicated path resolution consolidation
- Allowlist-based terminal execution model

### P1 — Testing
- Extension-host integration tests (`@vscode/test-electron`)
- Webview component tests (React Testing Library)
- Security regression test suite
- End-to-end tests with mock providers

### P2 — Developer Experience
- ESLint configuration (real lint, not just type-check)
- Prettier configuration
- Pre-commit hooks
- Dependency vulnerability scanning in CI
- Automated release pipeline

### P2 — Documentation
- Architecture diagrams (Mermaid)
- Security model documentation
- Contribution guide
- Migration notes

---

## Test Results

| Test File | Tests | Status |
|-----------|-------|--------|
| `reviewerNormalization.test.ts` | 1 | PASS |
| `terminalCommandNormalization.test.ts` | 2 | PASS |
| `terminalBypasses.test.ts` | 12 | PASS |
| `contextBuilder.test.ts` | 7 | PASS |
| `fileSystemTool.test.ts` | 11 | PASS |
| `toolApprovalPolicy.test.ts` | 18 | PASS |
| `memorySearch.test.ts` | 3 | PASS |
| `orchestrator.test.ts` | 8 | PASS |
| **Total** | **62** | **ALL PASS** |

---

## Commands Run

```bash
npm ci                    # 523 packages, 17 vulnerabilities
npm run lint              # PASS (type-check only)
npm test                  # 62 tests, all passing
npm run build             # PASS (agent-core + webview + extension)
npx @vscode/vsce package  # VSIX created (5.81 MB)
```
