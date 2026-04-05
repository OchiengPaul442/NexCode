# Tooling Scripts

## `setup-ollama.ps1`

Pulls default local coding models into Ollama.

## `run-local-checks.ps1`

Runs install, build, and tests for this workspace.

## `clean-workspace.mjs`

Removes simulation artifacts, generated caches, and runtime memory logs that should not be committed.

## `extension-release.mjs`

Builds, packages, and optionally installs the VS Code extension.

This script now uses a staging directory to avoid npm workspace duplication issues during VSIX packaging and verifies that runtime dependencies are present before install.

Examples:

- `node tools/extension-release.mjs`
- `node tools/extension-release.mjs --no-install`
- `node tools/extension-release.mjs --bump-type minor`

## `validate-model-matrix.js`

Runs a full model/tool regression matrix across configured Ollama models (real-world prompts, tool commands, filesystem operations, edit/apply flow, and security-block checks).

Examples:

- `node tools/validate-model-matrix.js`
- `npm run validate:models`

## Agent Tool Commands In Chat

From the sidebar chat, these commands are supported:

- `/tool search <query>`
- `/tool web-search <query>`
- `/tool terminal <command>`
- `/tool git-status`
- `/tool git-diff`
- `/tool git-branch`
- `/tool test [command]`
- `/tool read <path>`

## Edit Workflow

Use `/edit <path> :: <instruction>` to generate a proposed patch, then click `Apply Edit` in the UI.
