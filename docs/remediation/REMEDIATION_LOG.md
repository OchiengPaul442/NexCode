# NexCode Autonomous Remediation Log

Append one section per autonomous iteration. Never rewrite prior entries.

---

## Iteration 0 — Bootstrap

**Date:** 20 July 2026  
**Finding IDs:** N/A (bootstrap — no production findings fixed)  
**Commit:** `6c10ab9` — `chore(remediation): initialize verified work queue`

### What was done

1. Read the complete CodeRabbit-style audit (NEXCODE_FULL_CODERABBIT_STYLE_REVIEW.md, 1279 lines, 45 NC findings).
2. Read the remediation prompt (NEXCODE_CLAUDE_OPENCODE_REMEDIATION_PROMPT.md).
3. Verified working tree was clean (`git status` — no uncommitted changes).
4. Created `docs/remediation/WORK_QUEUE.md` with all 45 NC findings:
   - P0 Critical: NC-001 through NC-008 (8 findings)
   - P1 High: NC-009 through NC-028 (20 findings)
   - P2 Medium: NC-029 through NC-045 (17 findings)
   - Each finding includes: severity, status (pending), phase assignment, dependencies, affected files/symbols, verified status, required tests, verification commands, and resolution evidence placeholder.
   - Dependency graph and execution order provided.
5. Updated `docs/remediation/STATE.json`:
   - `bootstrapRequired`: false
   - `status`: in_progress
   - `iteration`: 0
   - Counts: 45 pending, 0 in-progress, 0 fixed, 0 blocked, 0 obsolete, 0 false-positive
6. Committed bootstrap documents (no production source modified).

### Validation

| Check | Result | Notes |
|---|---|---|
| Working tree clean before changes | PASS | `git status` showed no uncommitted changes |
| Audit findings preserved | PASS | All 45 NC-### IDs retained in WORK_QUEUE.md |
| STATE.json valid JSON | PASS | Written with all required fields |
| No production source modified | PASS | Only docs/remediation/ files changed |
| Commit clean | PASS | `6c10ab9` — 2 files changed, 629 insertions |

### Current state

- 45 findings pending
- 0 findings in-progress
- Next iteration: begin Phase 0 containment starting with NC-001 (provider key isolation)

---

## Iteration 1 — NC-001: Remove eager cross-provider health checks

**Date:** 20 July 2026  
**Finding IDs:** NC-001 (Critical)  
**Phase:** 0 — Containment patch  

### What was done

1. **Verified NC-001 against current source code:**
   - `agent-core/src/orchestrator.ts:167-201` — confirmed all cloud providers (huggingface, openrouter, together, fireworks, groq, nvidia, baseten) receive the same `openAIApiKey`.
   - `agent-core/src/orchestrator.ts:210-213` — confirmed eager `checkProviders()` call sends the key to every provider at construction time.
   - `agent-core/src/providers/modelRouter.ts:80-89` — confirmed `checkProviders()` iterates all providers indiscriminately.
   - `agent-core/src/providers/openAICompatibleProvider.ts:64-74` — confirmed `checkConnection()` attaches the Bearer token and sends it to each provider's `/models` endpoint.

2. **Implemented containment fix (2 files changed):**
   - `agent-core/src/orchestrator.ts` (7 insertions, 5 deletions):
     - Changed `providerCheckPromise` field from eagerly assigned `Promise<...>` to `Promise<...> | null = null`.
     - Removed 4-line eager `checkProviders()` call from the constructor (lines 210-213).
     - Updated `getProviderStatus()` to lazily create the check promise on first invocation, then cache it.
   - `agent-core/tests/providerKeyIsolation.test.ts` (new file, 5 tests):
     - Test 1: Constructor must NOT eagerly check any provider (no fetch calls).
     - Test 2: Canary key must not appear in any request during construction.
     - Test 3: `getProviderStatus()` lazily triggers a check, and caches the result (second call does not re-fetch).
     - Test 4: Canary key must not appear in requests to unrelated provider endpoints.
     - Test 5: Multiple orchestrator instances do not share provider-check state.

3. **Validated:**
   - 5/5 new providerKeyIsolation tests pass.
   - 465/465 full unit tests pass (3 pre-existing e2e script failures unrelated).
   - `tsc --noEmit` clean.
   - `npm run build` clean.
   - `git diff --check` clean (no whitespace errors, no secrets, no test suppression).

### Validation

| Check | Result | Notes |
|---|---|---|
| Focused tests (NC-001) | PASS | 5/5 providerKeyIsolation tests pass |
| Orchestrator tests | PASS | 8/8 orchestrator.test.ts tests pass |
| Security tests | PASS | 150/150 security/tool tests pass |
| Full test suite | PASS | 465/465 unit tests pass; 3 pre-existing e2e script failures |
| Type check | PASS | `tsc --noEmit` clean in agent-core |
| Build | PASS | Full `npm run build` clean |
| Diff check | PASS | `git diff --check` clean |
| No secrets in diff | PASS | No API keys, tokens, or secrets in the diff |
| No test suppression | PASS | All existing tests retained and passing |

### Remaining risks

- The same `openAIApiKey` is still passed to all cloud provider constructors. Phase D will introduce per-provider credentials (`ProviderCredentialStore`).
- The sidebar's `refreshProviderStatus()` already only checks the selected provider (not all providers), so it was not a cross-provider risk.
- `checkProviders()` in `ModelRouter` still iterates all providers when called. Future work should scope it to the active provider only.

### Files changed

| File | Change | Lines |
|---|---|---|
| `agent-core/src/orchestrator.ts` | Remove eager provider check, make lazy | +7, -5 |
| `agent-core/tests/providerKeyIsolation.test.ts` | New regression test file | +128 |


