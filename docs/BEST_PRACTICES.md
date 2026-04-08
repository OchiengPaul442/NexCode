# Extension Best Practices (Implemented)

This document captures the concrete practices applied in NEXCODE-KIBOKO to improve reliability, performance, and security.

## Sources Reviewed

- VS Code Webview API guidance (`code.visualstudio.com/api/extension-guides/webview`)
- VS Code webview communication patterns (message request/response discipline)
- Webview performance guidance (reduce churn, profile memory/CPU, avoid unnecessary re-renders)
- Ollama API docs for model discovery (`/api/tags`)

## Reliability Practices

- Package dependencies inside VSIX.
  - The release flow verifies `@nexcode/agent-core` and `diff-match-patch` are bundled.
  - This prevents runtime activation errors (`Cannot find module ...`).
- Stage packaging in an isolated directory.
  - Avoids npm workspace duplication collisions during VSIX creation.
- Health checks for providers.
  - Sidebar can verify provider reachability and show status quickly.

## Performance Practices

- Buffered token rendering in webview.
  - Streaming tokens are batched via `requestAnimationFrame`.
  - Reduces DOM update frequency for long responses.
- Chat history size bounds.
  - Message list is trimmed to avoid unbounded growth and memory pressure.
- Non-blocking startup checks.
  - Provider health and model discovery run asynchronously after UI render.

## Orchestration Architecture (2026-04 Refresh)

- Dynamic auto routing.
  - Auto mode now chooses between fast-path single-agent execution and multi-agent pipelines.
  - Simple conversational prompts no longer default to planner behavior.
- Live token streaming from agent stages.
  - Responses stream directly from model providers during execution instead of replaying full text at completion.
  - Multi-agent pipeline stages stream incrementally with stage-level status updates.
- Deterministic tool intent inference.
  - High-confidence natural language requests (read/search/test/run command) map to the tool surface.
  - Added direct tool commands for `write` and `append` to improve file-operation reliability.

## Sidebar UX Responsiveness (2026-04 Refresh)

- Response-first streaming.
  - Assistant output area remains primary while reasoning/activity stays secondary.
- Collapsible reasoning panel.
  - Reasoning is open during active streaming and collapses when complete to reduce clutter.
- Input ergonomics improvements.
  - Input area spacing increased and textarea scrolling enabled with visible scrollbar.
- Token visibility improvements.
  - Token ring now shows explicit `used/max` context values with model-aware context window estimates.

## Security Practices

- Strict CSP in webview HTML.
  - `default-src 'none'` and nonce-scoped script execution.
- Restricted `localResourceRoots`.
  - Only extension media directory is webview-readable.
- Terminal command safety policy in core tooling.
  - Blocks destructive/high-risk command patterns.
  - Keeps command execution inside safer constraints.
- Explicit approval for risky actions.
  - Edit proposals require manual apply/reject.
  - Terminal execution can require user confirmation.

## Model Selection Practices

- Model input supports provider-backed suggestions.
  - For Ollama: models discovered from `/api/tags`.
  - For OpenAI-compatible: model IDs discovered from `/models`.
- User can still enter custom model names manually.

## Operational Recommendation

- Run before release:
  - `npm run lint`
  - `npm run test`
  - `npm run validate:models`
  - `npm run extension:release`
