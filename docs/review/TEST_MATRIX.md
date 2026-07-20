> **⚠️ HISTORICAL SNAPSHOT — NOT CURRENT**
>
> This document was generated on **2026-07-16** and reflects the repository state at that
> time (21 unit tests across 8 files). The current repository has **1459+ tests across 58+
> test files**. Do not use this document for release decisions. Run `npm test` for current
> counts and see CI artifacts for authoritative test evidence.

# TEST MATRIX

**Project:** NEXCODE-KIBOKO
**Date:** 2026-07-16
**Status:** Historical snapshot — superseded by NC-029 remediation (2026-07-20)

---

## Unit Tests

| ID | Layer | Scenario | Risk | Test File | Result | Evidence |
|----|-------|----------|------|-----------|--------|----------|
| U-001 | Approval Policy | Delete requires approval | Critical | toolApprovalPolicy.test.ts | PASS | 18 tests |
| U-002 | Approval Policy | Delete-contents requires approval | Critical | toolApprovalPolicy.test.ts | PASS | |
| U-003 | Approval Policy | Move requires approval | High | toolApprovalPolicy.test.ts | PASS | |
| U-004 | Approval Policy | Terminal requires approval | High | toolApprovalPolicy.test.ts | PASS | |
| U-005 | Approval Policy | Read does NOT require approval | Medium | toolApprovalPolicy.test.ts | PASS | |
| U-006 | Approval Policy | Search does NOT require approval | Medium | toolApprovalPolicy.test.ts | PASS | |
| U-007 | Approval Policy | Write does NOT require approval | Medium | toolApprovalPolicy.test.ts | PASS | |
| U-008 | Approval Policy | Bypass tools skip approval | High | toolApprovalPolicy.test.ts | PASS | |
| U-009 | File System | Rejects ../ traversal | Critical | fileSystemTool.test.ts | PASS | 11 tests |
| U-010 | File System | Rejects absolute outside-workspace path | Critical | fileSystemTool.test.ts | PASS | |
| U-011 | File System | Rejects workspace root deletion | High | fileSystemTool.test.ts | PASS | |
| U-012 | File System | Can delete file within workspace | Medium | fileSystemTool.test.ts | PASS | |
| U-013 | File System | Can clear directory contents | Medium | fileSystemTool.test.ts | PASS | |
| U-014 | Terminal | Documents rm -rf bypass | High | terminalBypasses.test.ts | PASS | 12 tests |
| U-015 | Terminal | Documents find -delete bypass | High | terminalBypasses.test.ts | PASS | |
| U-016 | Terminal | Documents PowerShell bypass | High | terminalBypasses.test.ts | PASS | |
| U-017 | Terminal | Documents exfiltration bypass | High | terminalBypasses.test.ts | PASS | |
| U-018 | Terminal | Confirms nested shell IS blocked | Medium | terminalBypasses.test.ts | PASS | |
| U-019 | Context Builder | Workspace context building | Low | contextBuilder.test.ts | PASS | 7 tests |
| U-020 | Memory | Memory search | Low | memorySearch.test.ts | PASS | 3 tests |
| U-021 | Orchestrator | Auto mode routing | Medium | orchestrator.test.ts | PASS | 8 tests |
| U-022 | Orchestrator | Tool command handling | Medium | orchestrator.test.ts | PASS | |
| U-023 | Normalization | Terminal command normalization | Low | terminalCommandNormalization.test.ts | PASS | 2 tests |
| U-024 | Normalization | Reviewer output normalization | Low | reviewerNormalization.test.ts | PASS | 1 test |
| U-025 | Terminal | F-012: npm run requires approval | Critical | terminalArbitraryExecution.test.ts | PASS | 28 tests |
| U-026 | Terminal | F-012: node -e blocked | Critical | terminalArbitraryExecution.test.ts | PASS | |
| U-027 | Terminal | F-012: python -c blocked | Critical | terminalArbitraryExecution.test.ts | PASS | |
| U-028 | Terminal | F-012: npm install requires approval | High | terminalArbitraryExecution.test.ts | PASS | |
| U-029 | Terminal | F-012: npx requires approval | High | terminalArbitraryExecution.test.ts | PASS | |
| U-030 | Terminal | F-012: npm test still safe | Medium | terminalArbitraryExecution.test.ts | PASS | |
| U-031 | Batch Edit | F-015: delete on workspace root blocked | High | batchEditSecurity.test.ts | PASS | 13 tests |
| U-032 | Batch Edit | F-015: uses resolveWorkspacePathSafe | High | batchEditSecurity.test.ts | PASS | |
| U-033 | Batch Edit | F-015: create/update/delete operations | Medium | batchEditSecurity.test.ts | PASS | |
| U-034 | Batch Edit | F-015: malformed JSON handling | Low | batchEditSecurity.test.ts | PASS | |

## Security Regression Tests

| ID | Scenario | Risk | Status |
|----|----------|------|--------|
| S-001 | Destructive file actions require backend approval | Critical | FIXED — F-001 |
| S-002 | Natural-language inference cannot bypass approval | Critical | FIXED — F-002 |
| S-003 | Streaming and non-streaming enforce same policy | High | PARTIAL — terminal path covered |
| S-004 | Unknown actions fail closed | High | PASS — default case returns error |
| S-005 | Path traversal is rejected | High | PASS — U-009 |
| S-006 | Symlink escape is rejected | High | KNOWN LIMITATION — logical path only |
| S-007 | Shell bypass variants documented | High | DOCUMENTED — U-014 through U-017 |
| S-008 | Upload/exfiltration commands not blocked | High | DOCUMENTED — U-017 |
| S-009 | Raw secrets never reach webview | Medium | FIXED — F-005 |
| S-010 | Runtime memory not committed | Medium | FIXED — F-004 |
| S-011 | npm run/install/node/python require approval | Critical | FIXED — F-014 |
| S-012 | node -e / python -c inline execution blocked | Critical | FIXED — F-014 |
| S-013 | npm test still does NOT require approval | Medium | PASS — U-026 |

## Type-Check Results

| Component | Command | Result |
|-----------|---------|--------|
| agent-core | `tsc -p tsconfig.json --noEmit` | PASS |
| extension | `tsc -p . --noEmit` | PASS |
| webview | `tsc -p webview/tsconfig.json` | Not yet integrated into CI |

## Build Results

| Step | Command | Result |
|------|---------|--------|
| agent-core build | `tsc -p tsconfig.json` | PASS |
| webview JS | `esbuild --bundle --minify` | PASS (749.8 KB) |
| webview CSS | `tailwindcss --minify` | PASS (59 KB) |
| extension build | `tsc -p .` | PASS |
| VSIX package | `vsce package` | PASS (5.78 MB, 90 files) |
