# NEXCODE-KIBOKO Maintenance Guide

## 1) Daily Development Cycle

1. Pull latest code.
2. Run `npm install`.
3. Run `npm run build`.
4. Run `npm run lint`.
5. Run `npm run test`.
6. Run `npm run validate:models` for full multi-model regression.
7. Launch the extension host from `extension/` with `F5`.

## 2) Model And Provider Operations

### Ollama

- Ensure Ollama service is running.
- Set sidebar model to your target model, for example `gpt-oss:120b-cloud`.
- Keep `nexcodeKiboko.defaultProvider` as `ollama` for local-first workflows.

### OpenAI-Compatible

- Configure:
  - `nexcodeKiboko.openAIBaseUrl`
  - `nexcodeKiboko.openAIApiKey`
- Use only when cloud execution is desired.

### Tavily Online Search

- Configure `nexcodeKiboko.tavilyApiKey`.
- Use `/tool web-search <query>`.
- If Tavily is unavailable, the runtime falls back to DuckDuckGo and then Wikipedia.

## 3) Safety And Approvals

- Keep `nexcodeKiboko.requireTerminalApproval` enabled.
- Terminal tool blocks known destructive patterns.
- For generated edits, review every proposal via:
  - `Preview Diff`
  - `Apply Edit`
  - `Reject`

## 4) Clean Repository Policy

Before creating a PR, run:

- `npm run clean`
- `npm run build`
- `npm run lint`
- `npm run test`

This prevents accidental commits of generated artifacts (audit assets, caches, runtime memory logs, and VSIX outputs).

## 5) Extension Packaging And Installation

### Fast path

- `npm run extension:release`

This will:

1. Auto-bump extension version.
2. Build workspace packages.
3. Package extension VSIX.
4. Install the VSIX into VS Code.

### Alternatives

- Package only: `npm run extension:package`
- Bump only: `npm run extension:bump`
- Change bump type: `node tools/extension-release.mjs --bump-type minor --no-install`

## 6) Troubleshooting

### Build errors

- Run `npm install` again.
- Re-run `npm run build` from repo root.

### Extension not visible

- Confirm activation from Extension Development Host.
- Run command `NEXCODE: Open Sidebar`.

### Online search not returning Tavily results

- Confirm `nexcodeKiboko.tavilyApiKey` is set.
- Test with `/tool web-search latest TypeScript 5 release notes`.

### Terminal command blocked

- Check command for destructive patterns.
- Split complex commands and avoid shell nesting (`bash -c`, `cmd /c`, etc.).

## 7) Release Checklist

- [ ] `npm run clean`
- [ ] `npm run build`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run validate:models`
- [ ] `npm run extension:package`
- [ ] Manual smoke test in Extension Development Host
- [ ] Validate tool commands, edit approvals, and attachment flow
