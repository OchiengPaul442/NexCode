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
