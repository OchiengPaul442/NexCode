# Tooling Scripts

## `setup-ollama.ps1`

Pulls default local coding models into Ollama.

## `run-local-checks.ps1`

Runs install, build, and tests for this workspace.

## Agent Tool Commands In Chat

From the sidebar chat, these commands are supported:

- `/tool search <query>`
- `/tool terminal <command>`
- `/tool git-status`
- `/tool git-diff`
- `/tool git-branch`
- `/tool test [command]`
- `/tool read <path>`

## Edit Workflow

Use `/edit <path> :: <instruction>` to generate a proposed patch, then click `Apply Edit` in the UI.
