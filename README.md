# Kiboko for VS Code (Scaffold)

This workspace contains an early scaffold for the Kiboko VS Code extension.

## Quick start (Phase 0)

1. Install dependencies:

```bash
npm install
```

2. Compile TypeScript:

```bash
npm run compile
```

3. Run in Extension Development Host:

- Open this folder in VS Code
- Press F5 to launch an Extension Development Host

## Files added in Phase 0

- `package.json` — extension manifest + dev scripts
- `tsconfig.json` — TypeScript config
- `src/extension.ts` — minimal activate/deactivate and a sample command

## Next steps

- Add linting, tests, and CI
- Implement Chat UI (Phase 1)

## Inline completion settings

The extension exposes tunable settings under the `pulse` namespace to control inline completions:

- `pulse.inlineDebounceMs` (number, default: 200) — Debounce window (ms) used to coalesce rapid keystrokes.
- `pulse.inlineMaxCompletionChars` (number, default: 2000) — Maximum number of characters returned by inline completion (responses are truncated).
- `pulse.inlinePrefixChars` (number, default: 800) — Number of characters before the cursor included as prefix context.
- `pulse.inlineSuffixChars` (number, default: 400) — Number of characters after the cursor included as suffix context.

Tuning tips:

- Lower `pulse.inlineDebounceMs` for more reactive suggestions (more requests).
- Reduce prefix/suffix counts to lower prompt size and latency.

Configuration examples

Recommended starting values (tweak to taste):

- `pulse.inlineDebounceMs`: 200
- `pulse.inlinePrefixChars`: 800
- `pulse.inlineSuffixChars`: 400
- `pulse.inlineMaxCompletionChars`: 2000

Example `settings.json` snippet:

```json
{
  "pulse.inlineDebounceMs": 200,
  "pulse.inlinePrefixChars": 800,
  "pulse.inlineSuffixChars": 400,
  "pulse.inlineMaxCompletionChars": 2000
}
```

Quick examples

- For very low-latency inline suggestions on small files:

```json
{
  "pulse.inlineDebounceMs": 120,
  "pulse.inlinePrefixChars": 400,
  "pulse.inlineSuffixChars": 200
}
```

- For more conservative prompts preserving more context (larger models / offline LLMs):

```json
{
  "pulse.inlineDebounceMs": 300,
  "pulse.inlinePrefixChars": 2000,
  "pulse.inlineSuffixChars": 800,
  "pulse.inlineMaxCompletionChars": 4000
}
```

Diff review UI

Use the command `Kiboko: Open Diff Review` (Command Palette) to open the scaffolded Diff Review panel. It's a placeholder UI for now — the panel will be extended to show repository diffs, inline comments, and AI-suggested fixes.
