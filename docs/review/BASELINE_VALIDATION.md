# BASELINE VALIDATION

**Project:** NEXCODE-KIBOKO
**Repository:** https://github.com/OchiengPaul442/NexCode
**Branch:** main
**Commit:** 56b71aa
**Tag:** 56b71aa (no semantic tags)
**Package version:** 0.1.47 (extension), 0.1.0 (agent-core)
**Node.js:** v24.14.0
**npm:** 11.15.0
**OS:** win32

## Commands Run (Unmodified)

| Command | Result | Notes |
|---------|--------|-------|
| `npm ci` | PASS | 523 packages installed, 17 vulnerabilities (10 moderate, 6 high, 1 critical) |
| `npm run lint` | PASS | Type-check only (tsc --noEmit), no ESLint |
| `npm test` | PASS | 21 tests, 5 files, all passing |
| `npm run build` | PASS | agent-core tsc + webview esbuild + extension tsc |
| `npx @vscode/vsce package` | PASS | VSIX created: 5.81 MB, 98 files |

## Key Findings from Baseline

1. **`memory/long-term-memory.jsonl` tracked in git** despite `.gitignore` listing `memory/long-term-memory.json` (wrong extension)
2. **No webview `tsconfig.json`** — 3,638 lines of webview TSX never type-checked
3. **`requireTerminalApproval` not present in agent-core** — approval gate is webview-only
4. **Approval gate in `main.tsx:2419-2433`** — only matches `/tool terminal` literal, skipped at non-default permission levels
5. **`delete`/`delete-contents` have zero approval** anywhere in the stack
6. **CSP nonce uses `Math.random()`** instead of CSPRNG
7. **API keys sent raw to webview** at `sidebarViewProvider.ts:953-954`
8. **VSIX includes `webview/src/`** TypeScript source and `tailwind.config.cjs`
9. **Duplicated `resolvePathWithinWorkspaceRoot`** in `orchestrator.ts:2929-2948` and `contextBuilder.ts:142-161`
10. **No ESLint, no CI, no security tests**
