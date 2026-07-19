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
- **Status:** pending
- **Phase:** 0
- **Dependencies:** NC-001 (provider endpoint trust)
- **Affected files:** `extension/src/sidebarViewProvider.ts:1103-1177,1200-1233,1256-1305,1405-1411`, `extension/package.json:184-186`
- **Verified:** unverified
- **Required tests:** workspace-controlled base URL cannot receive stored key; untrusted workspace blocks authenticated network calls; capabilities.untrustedWorkspaces declared correctly
- **Verification commands:** `npx vitest run agent-core/tests/workspaceTrust.test.ts`
- **Resolution evidence:** (none yet)

### NC-003 — API keys persisted in plaintext webview state
- **Severity:** Critical
- **Status:** pending
- **Phase:** 0
- **Dependencies:** none
- **Affected files:** `extension/webview/src/main.tsx:380-403,550-609,1217-1220,3982-3988,5033-5076`
- **Verified:** unverified
- **Required tests:** serialized webview state contains no key/token fields; migration strips legacy secret fields; write-only secret input pattern
- **Verification commands:** `npx vitest run agent-core/tests/webviewSecrets.test.ts`
- **Resolution evidence:** (none yet)

### NC-004 — Terminal policy accepts arbitrary unmatched shell commands
- **Severity:** Critical
- **Status:** pending
- **Phase:** 0 / E
- **Dependencies:** none
- **Affected files:** `agent-core/src/tools/terminalTool.ts:548-571,674-710`
- **Verified:** unverified
- **Required tests:** unknown terminal command fails closed; raw shell requires approval; untrusted workspace disables raw terminal; typed argv with shell:false for allowed commands
- **Verification commands:** `npx vitest run agent-core/tests/terminalSafety.test.ts`
- **Resolution evidence:** (none yet)

### NC-005 — Webview messages cross privilege boundary without runtime validation
- **Severity:** Critical
- **Status:** pending
- **Phase:** 0 / C
- **Dependencies:** none
- **Affected files:** `extension/src/sidebarViewProvider.ts:229-232,294-403,1425-1449`
- **Verified:** unverified
- **Required tests:** arbitrary webview message types rejected; unknown setting keys rejected; openFile cannot escape workspace root; runtime schema validation on inbound messages
- **Verification commands:** `npx vitest run agent-core/tests/webviewValidation.test.ts`
- **Resolution evidence:** (none yet)

### NC-006 — Reviewed edits can escape workspace or overwrite newer file
- **Severity:** Critical
- **Status:** pending
- **Phase:** 0 / F
- **Dependencies:** NC-020 (path containment)
- **Affected files:** `extension/src/editReviewService.ts:12-29,52-95`
- **Verified:** unverified
- **Required tests:** edit apply rejects traversal; edit apply rejects stale content; content hash/version precondition; multi-root workspace edit association
- **Verification commands:** `npx vitest run agent-core/tests/editReview.test.ts`
- **Resolution evidence:** (none yet)

### NC-007 — PowerShell search fallback is injection-prone
- **Severity:** Critical
- **Status:** pending
- **Phase:** 0 / E
- **Dependencies:** none
- **Affected files:** `agent-core/src/tools/searchTool.ts:117-149`
- **Verified:** unverified
- **Required tests:** search payloads cannot execute substitutions; ripgrep argv preferred; PowerShell fallback uses non-code channel
- **Verification commands:** `npx vitest run agent-core/tests/searchInjection.test.ts`
- **Resolution evidence:** (none yet)

### NC-008 — Auto/bypass approval modes undermine user consent
- **Severity:** Critical
- **Status:** pending
- **Phase:** 0
- **Dependencies:** none
- **Affected files:** `extension/package.json:147-160`, `extension/src/sidebarViewProvider.ts:972-995`, `extension/webview/src/main.tsx:5117-5126`
- **Verified:** unverified
- **Required tests:** bypass cannot be set persistently at workspace scope; write auto-approval fallback removed; one policy engine is source of truth
- **Verification commands:** `npx vitest run agent-core/tests/approvalPolicy.test.ts`
- **Resolution evidence:** (none yet)

---

## P1 — High-priority Correctness and Architecture Defects — NC-009 through NC-028

### NC-009 — MCP implementation is a disconnected custom stub, not full MCP
- **Severity:** High
- **Status:** pending
- **Phase:** H
- **Dependencies:** none (de-scoping decision first)
- **Affected files:** `agent-core/src/mcp/mcpRegistry.ts`, `agent-core/src/mcp/adapters/filesystemAdapter.ts`, `agent-core/src/orchestrator.ts:219-253`, `agent-core/src/tools/toolRegistry.ts:61-69`
- **Verified:** unverified
- **Required tests:** MCP features marked experimental/incomplete; built-in adapter deliberately registered and visible in UI; or renamed to InternalAdapterRegistry
- **Verification commands:** `npx vitest run agent-core/tests/mcpRegistry.test.ts`
- **Resolution evidence:** (none yet)

### NC-010 — Concurrent tasks share mutable orchestrator state
- **Severity:** High
- **Status:** pending
- **Phase:** 0 / G
- **Dependencies:** NC-011 (task state machine)
- **Affected files:** `extension/src/taskController.ts:20-32`, `extension/src/sidebarViewProvider.ts:406-536`, `agent-core/src/orchestrator.ts:135-140`
- **Verified:** unverified
- **Required tests:** max concurrency enforced at 1; concurrent tasks cannot share approvals, edits, memory buffers, or provider sessions
- **Verification commands:** `npx vitest run agent-core/tests/taskConcurrency.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** C / E
- **Dependencies:** NC-004 (terminal redesign)
- **Affected files:** `agent-core/src/tools/toolRegistry.ts:126-148`
- **Verified:** unverified
- **Required tests:** runStructuredToolCall is only internal API; JSON.parse failure rejects call; unknown fields rejected with strict schemas
- **Verification commands:** `npx vitest run agent-core/tests/toolValidation.test.ts`
- **Resolution evidence:** (none yet)

### NC-017 — Malformed model tool calls repaired into dangerous actions
- **Severity:** High
- **Status:** pending
- **Phase:** C
- **Dependencies:** NC-016 (schema validation)
- **Affected files:** `agent-core/src/agents/agentLoop.ts:442-470`
- **Verified:** unverified
- **Required tests:** malformed privileged call fails closed; repair limited to low-risk read-only tools; structured error returned to model
- **Verification commands:** `npx vitest run agent-core/tests/malformedToolCalls.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** 0
- **Dependencies:** none
- **Affected files:** `extension/src/sidebarViewProvider.ts` (orchestrator construction), `agent-core/src/prompts/promptStore.ts:20-41`
- **Verified:** unverified
- **Required tests:** workspace prompt overrides disabled by default; trusted workspace plus opt-in required; override source shown; security policy outside model prompts
- **Verification commands:** `npx vitest run agent-core/tests/promptStore.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** 0
- **Dependencies:** NC-003 (webview secrets)
- **Affected files:** `extension/src/secretService.ts:16-34`
- **Verified:** unverified
- **Required tests:** legacy value removed from config after migration; migration idempotent; one-time notice if plaintext remnants found
- **Verification commands:** `npx vitest run agent-core/tests/secretMigration.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** F
- **Dependencies:** none
- **Affected files:** `agent-core/src/orchestrator.ts:2161-2169,2233-2300+`
- **Verified:** unverified
- **Required tests:** blog fallback deleted; incomplete generation fails validation
- **Verification commands:** `npx vitest run agent-core/tests/orchestratorFallback.test.ts`
- **Resolution evidence:** (none yet)

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
- **Status:** pending
- **Phase:** C
- **Dependencies:** NC-005 (webview validation)
- **Affected files:** `extension/package.json` vs `sidebarViewProvider.ts`
- **Verified:** unverified
- **Required tests:** every supported setting declared in manifest; scope, validation, defaults, trust restrictions defined; no arbitrary keys accepted
- **Verification commands:** manifest audit, runtime key usage comparison
- **Resolution evidence:** (none yet)

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
1. NC-001 — provider key isolation
2. NC-002 — workspace trust / endpoint scope
3. NC-003 — webview secret removal
4. NC-004 — terminal deny-by-default
5. NC-005 — webview message validation
6. NC-006 — edit preconditions
7. NC-007 — search injection fix
8. NC-008 — approval mode hardening
9. NC-010 — concurrency limit to 1
10. NC-022 — workspace prompt overrides
11. NC-024 — secret migration cleanup
12. NC-028 — blog fallback removal
13. NC-009 — MCP marked experimental

**Phase C (runtime schema boundary):**
14. NC-016 — tool schema validation
15. NC-017 — malformed tool call rejection
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
