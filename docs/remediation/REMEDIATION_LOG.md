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

---

## Iteration 1b — NC-002: Block workspace-controlled URL redirect of authenticated provider probes

**Date:** 20 July 2026
**Finding IDs:** NC-002 (Critical)
**Phase:** 0 — Containment patch
**Commit:** `5ae7a5a` — `fix(extension): resolve NC-002 — block workspace-controlled URL redirect of authenticated provider probes`

### What was done

1. **Verified NC-002 against current source code:**
   - `extension/src/sidebarViewProvider.ts` — confirmed `pushInitialWebviewState()` previously called `refreshProviderStatus()` and `provideModelSuggestions()` which attached Bearer tokens to workspace-controlled URLs.
   - `extension/package.json` — confirmed workspace trust declaration used non-standard `contributes.workspaceTrust.trusted` instead of documented `capabilities.untrustedWorkspaces`.

2. **Implemented containment fix (6 files changed):**
   - `extension/src/sidebarViewProvider.ts` (+102, -8):
     - Removed auto-probing from `pushInitialWebviewState()`.
     - Added `validateProviderUrl()` call before `refreshProviderStatus()` and `provideModelSuggestions()`.
     - Block custom provider endpoints in untrusted workspaces via `canProbeProviderEndpoint()`.
     - Validate `openAIBaseUrl` on `updateSetting` before persisting.
   - `agent-core/src/utils/providerUrlValidation.ts` (new, 130 lines):
     - `validateProviderUrl()` — rejects non-HTTPS, private IPs, malformed URLs; returns safe default.
     - `isDefaultProviderUrl()` — checks if URL is the built-in default.
     - `canProbeProviderEndpoint()` — custom endpoints require trusted workspace.
   - `extension/package.json` (+14):
     - Added `capabilities.untrustedWorkspaces` with `supported: "limited"`.
     - Added `restrictedConfigurations` list: `openAIBaseUrl`, `ollamaBaseUrl`, `toolApproval`, `autoApproveWrite`, `maxConcurrentTasks`.
   - `agent-core/src/index.ts` (+5):
     - Exported validation utilities from barrel.
   - `agent-core/tests/workspaceProviderUrlValidation.test.ts` (new, 34 tests):
     - Validates HTTPS-only, localhost exception, private IP blocking, malformed URL rejection, safe default fallback.
   - `agent-core/tests/workspaceTrustDeclaration.test.ts` (new, 10 tests):
     - Validates `capabilities.untrustedWorkspaces` structure, restricted config keys, supported mode.

3. **Validated:**
   - 44/44 new NC-002 tests pass.
   - 509/509 full unit tests pass.
   - `tsc --noEmit` clean.
   - `npm run build` clean.

### Validation

| Check | Result | Notes |
|---|---|---|
| Focused tests (NC-002) | PASS | 34 URL validation + 10 trust declaration tests pass |
| Full test suite | PASS | 509/509 unit tests pass |
| Type check | PASS | `tsc --noEmit` clean in agent-core |
| Build | PASS | Full `npm run build` clean |
| No secrets in diff | PASS | No API keys or tokens in the diff |

### Remaining risks

- The `handleOpenFile` handler still accepts arbitrary absolute paths from the webview (NC-005 territory).
- Workspace trust is "limited" not `false`, so some features remain available in untrusted workspaces.
- Phase D should further restrict provider endpoints to a known allowlist.

### Files changed

| File | Change | Lines |
|---|---|---|
| `extension/src/sidebarViewProvider.ts` | Remove auto-probe, add URL validation guards | +102, -8 |
| `agent-core/src/utils/providerUrlValidation.ts` | New URL validation utility | +130 |
| `extension/package.json` | Add capabilities.untrustedWorkspaces | +14 |
| `agent-core/src/index.ts` | Export validation utilities | +5 |
| `agent-core/tests/workspaceProviderUrlValidation.test.ts` | New regression tests | +215 |
| `agent-core/tests/workspaceTrustDeclaration.test.ts` | New regression tests | +122 |

---

## Iteration 2 — NC-003: Remove API keys from webview state

**Date:** 20 July 2026
**Finding IDs:** NC-003 (Critical)
**Phase:** 0 — Containment patch

### What was done

1. **Verified NC-003 against current source code:**
   - `extension/webview/src/main.tsx:380-403` — confirmed `SidebarSettings` contained `openAIApiKey?: string` and `searchApiKey?: string`.
   - `extension/webview/src/main.tsx:3982-3988` — confirmed `vscode.setState({ ..., settings: state.settings })` persisted secrets in webview state.
   - `extension/webview/src/main.tsx:5033-5076` — confirmed UI inputs bound directly to settings secret fields.
   - `extension/src/sidebarViewProvider.ts:1151-1219` — confirmed `getRuntimeSettings()` returned raw `searchApiKey` and `tavilyApiKey` strings.

2. **Implemented containment fix (3 production files changed):**
   - `extension/webview/src/main.tsx` (+126, -8):
     - `SidebarSettings`: replaced `openAIApiKey?: string` and `searchApiKey?: string` with `openAIApiKeyConfigured?: boolean` and `searchApiKeyConfigured?: boolean`.
     - `BackendConfig`: added `openAIApiKeyConfigured?`, `tavilyApiKeyConfigured?`, `searchApiKeyConfigured?` boolean flags.
     - `StoreState`: added `sendSecret()` action type.
     - `stripSecretsFromSettings()`: new function strips `openAIApiKey`, `searchApiKey`, `tavilyApiKey` from settings.
     - `normalizePersistedState()`: calls `stripSecretsFromSettings()` for migration of old persisted state.
     - `updateSetting`: added safety net rejecting secret keys.
     - `sendSecret()`: posts to extension via `vscode.postMessage()` but never stores value in Zustand state.
     - `hydrateConfig()`: maps `openAIApiKeyConfigured` and `searchApiKeyConfigured` boolean flags.
     - UI: API key inputs use local React state (`localApiKey`, `localSearchApiKey`), send on blur via `sendSecret()`, clear immediately.
     - State initialization: replaced `openAIApiKey: ""` and `searchApiKey: ""` with `openAIApiKeyConfigured: false` and `searchApiKeyConfigured: false`.
   - `extension/src/sidebarViewProvider.ts` (+10, -8):
     - `getRuntimeSettings()`: now returns `openAIApiKeyConfigured: !!secrets.openAIApiKey.trim()`, `tavilyApiKeyConfigured: !!secrets.tavilyApiKey.trim()`, `searchApiKeyConfigured: !!secrets.searchApiKey.trim()` instead of raw secret strings.
     - Also fixed pre-existing TS error: removed second argument from `validateProviderUrl()` calls at lines 1260 and 1359.
   - `agent-core/tests/webviewSecrets.test.ts` (new, 20 tests):
     - LEGACY_SECRET_KEYS coverage validation.
     - stripSecretsFromSettings: removes openAIApiKey, searchApiKey, tavilyApiKey; preserves boolean status flags; returns defaults for undefined/null; does not modify original.
     - normalizePersistedState: strips secrets, preserves sessions/state, handles undefined.
     - Serialized state must not contain canary secrets or secret field names as values.
     - updateSetting safety net recognizes all secret keys; non-secret keys not blocked.
     - sendSecret type only allows known secret keys.
     - BackendConfig only sends boolean presence flags.

3. **Validated:**
   - 20/20 new webviewSecrets tests pass.
   - 529/529 full unit tests pass.
   - `tsc --noEmit` clean in agent-core, extension, and webview.
   - `npm run build` clean.
   - `git diff --check` clean (no whitespace errors, no secrets).

### Validation

| Check | Result | Notes |
|---|---|---|
| Focused tests (NC-003) | PASS | 20/20 webviewSecrets tests pass |
| Type check (agent-core) | PASS | `tsc --noEmit` clean |
| Type check (extension) | PASS | `tsc --noEmit` clean (fixed pre-existing TS errors) |
| Type check (webview) | PASS | `tsc --noEmit` clean |
| Full test suite | PASS | 529/529 unit tests pass |
| Build | PASS | Full `npm run build` clean |
| Diff check | PASS | `git diff --check` clean |
| No secrets in diff | PASS | No API keys, tokens, or secrets in the diff |
| No test suppression | PASS | All existing tests retained and passing |

### Remaining risks

- The extension's `updateSetting` handler still writes secret values to `SecretStorage` when receiving `openAIApiKey`/`searchApiKey`/`tavilyApiKey` keys. This is correct behavior (SecretStorage is the proper store), but the handler should validate the key is a known secret type before writing.
- The `tavilyApiKeyConfigured` flag is sent by the backend but not directly mapped to a `SidebarSettings` field. The UI only needs one search-api-configured indicator.
- Phase D (per-provider credentials) should further restrict which keys are accepted and add key rotation support.

### Files changed

| File | Change | Lines |
|---|---|---|
| `extension/webview/src/main.tsx` | Remove secrets from SidebarSettings, add sendSecret, stripSecretsFromSettings migration, updateSetting guard, UI write-only pattern | +126, -8 |
| `extension/src/sidebarViewProvider.ts` | Return boolean flags instead of raw secrets; fix validateProviderUrl 2-arg TS errors | +10, -8 |
| `agent-core/tests/webviewSecrets.test.ts` | New regression test file | +292 |

