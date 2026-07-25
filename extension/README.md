# NexCode Kiboko

[![Version](https://img.shields.io/visual-studio-marketplace/v/nexcode.nexcode-kiboko-extension?label=Version&style=flat-square)](https://marketplace.visualstudio.com/items?itemName=nexcode.nexcode-kiboko-extension)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/nexcode.nexcode-kiboko-extension?label=Downloads&style=flat-square)](https://marketplace.visualstudio.com/items?itemName=nexcode.nexcode-kiboko-extension)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/nexcode.nexcode-kiboko-extension?label=Rating&style=flat-square)](https://marketplace.visualstudio.com/items?itemName=nexcode.nexcode-kiboko-extension)
[![License](https://img.shields.io/github/license/nexcode/nexcode-kiboko?style=flat-square)](https://github.com/nexcode/nexcode-kiboko/blob/main/LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/nexcode/nexcode-kiboko/ci.yml?branch=main&label=Build&style=flat-square)](https://github.com/nexcode/nexcode-kiboko/actions)

NexCode Kiboko is a local-first AI coding assistant for VS Code. It gives you a dedicated sidebar for asking questions, planning changes, reviewing code, running approved tools, and working with local or OpenAI-compatible models without leaving your editor.

Use it as a practical coding agent for private repositories, existing codebases, and everyday engineering tasks where you want clear control over model providers, tool access, and file changes.

## Highlights

- Local-first workflow with Ollama support for keeping code and prompts on your machine.
- OpenAI-compatible provider support for hosted models and private gateways.
- Agent modes for automatic routing, planning, coding, review, QA, and security-focused work.
- Workspace-aware chat that can read files, search code, inspect Git state, run tests, and propose edits.
- Safe edit review with preview, apply, and reject flows before generated changes land.
- Tool approval controls for terminal, write, delete, patch, and other higher-risk actions.
- VS Code SecretStorage integration for provider and search API keys.
- Workspace Trust restrictions for settings that could affect network or tool behavior.
- Persistent chat sessions, attachments, provider status, and model selection from the sidebar.

## Privacy Model

NexCode is designed for private codebases, but the privacy boundary depends on how you configure it:

- With local Ollama, model requests are sent to your local Ollama server.
- With an OpenAI-compatible remote provider, prompts and selected context are sent to that provider.
- With web search enabled, search queries are sent to the configured search provider.
- API keys are stored through VS Code SecretStorage, not plain extension settings.
- Tool execution is gated by approval settings and workspace trust controls.

Review your provider, model, tool, and web-search settings before using NexCode with sensitive repositories.

## Quick Start

1. Install NexCode Kiboko from the VS Code Marketplace.
2. Open the NexCode activity-bar icon or run `NEXCODE: Open Sidebar`.
3. Choose a provider and model in the sidebar.
4. For local use, start Ollama and select an installed model.
5. Ask NexCode to explain code, plan a change, implement a fix, review a diff, or run an approved tool.

## Common Workflows

### Understand a Codebase

- `Explain how this repository is structured.`
- `Find the authentication flow and summarize the main files.`
- `Explain the selected code and point out edge cases.`

### Implement and Refactor

- `Build input validation for this route and include focused tests.`
- `Refactor this module to reduce duplication without changing behavior.`
- `Find and fix the bug in the login flow.`

### Review and Validate

- `Review the current Git diff for correctness and missing tests.`
- `Run the relevant test command after checking package scripts.`
- `Check this change for security risks around path handling.`

### Use Tools Directly

- `/tool search orchestrator`
- `/tool git-status`
- `/tool git-diff`
- `/tool terminal npm test`
- `/tool web-search OWASP API Security Top 10`

## Agent Modes

| Mode | Best for |
| --- | --- |
| `auto` | Let NexCode route the request to the right behavior. |
| `planner` | Break down complex work before editing. |
| `coder` | Implement focused code changes. |
| `reviewer` | Review diffs, commits, and generated changes. |
| `qa` | Test planning, validation, and regression checks. |
| `security` | Security-focused review of tools, paths, commands, and secrets. |

## Providers

NexCode supports two provider modes from VS Code settings:

| Provider setting | Use case |
| --- | --- |
| `ollama` | Local Ollama models such as Qwen, Llama, DeepSeek, Gemma, and other installed models. |
| `openai-compatible` | Hosted or self-hosted OpenAI-compatible APIs, including private gateways and compatible model routers. |

Provider API keys are configured from the sidebar and stored securely with VS Code SecretStorage.

## Commands

| Command | Description |
| --- | --- |
| `NEXCODE: Open Sidebar` | Open the NexCode sidebar. |
| `NEXCODE: Pick Model` | Set the workspace default model. |
| `NEXCODE: Clear Conversation` | Clear the active conversation. |
| `NEXCODE: Open In Tab` | Open NexCode in an editor tab. |
| `NEXCODE: Explain Selection` | Send the selected editor text to NexCode for explanation. |
| `NexCode: Show Version Info` | Show installed version and build information. |

## Settings

All extension settings use the `nexcodeKiboko.*` namespace.

| Setting | Purpose |
| --- | --- |
| `nexcodeKiboko.defaultProvider` | Default provider: `ollama` or `openai-compatible`. |
| `nexcodeKiboko.defaultModel` | Default model name used for new requests. |
| `nexcodeKiboko.defaultMode` | Default agent mode. |
| `nexcodeKiboko.ollamaBaseUrl` | Local Ollama server URL. |
| `nexcodeKiboko.openAIBaseUrl` | OpenAI-compatible API base URL. |
| `nexcodeKiboko.temperature` | Default model temperature. |
| `nexcodeKiboko.modeTemperatures` | Per-mode temperature overrides. |
| `nexcodeKiboko.showReasoning` | Show provider-specific reasoning details when available. |
| `nexcodeKiboko.allowToolCommands` | Enable slash-command tool execution. |
| `nexcodeKiboko.requireTerminalApproval` | Require confirmation before terminal tool commands. |
| `nexcodeKiboko.toolApproval` | Approval mode for tools. |
| `nexcodeKiboko.autoApplyChanges` | Automatically apply edit proposals when enabled. |
| `nexcodeKiboko.allowWebSearch` | Enable web-search tool commands. |
| `nexcodeKiboko.searchProvider` | Search provider for web-search commands. |
| `nexcodeKiboko.searchBaseUrl` | Custom search provider endpoint. |
| `nexcodeKiboko.allowWorkspacePrompts` | Allow trusted workspaces to override built-in prompts. |
| `nexcodeKiboko.agentModels.*` | Optional model overrides for manager, worker, QA, review, and security roles. |

## Requirements

- VS Code 1.95 or newer.
- Ollama for local model usage, or an OpenAI-compatible API endpoint for hosted model usage.
- Optional search provider key for `/tool web-search`.

## Security Notes

- Edit proposals can be reviewed before they are applied.
- High-risk terminal patterns are blocked by the runtime policy.
- File operations are constrained to the active workspace.
- Secrets are redacted from logs and stored outside plain settings.
- Network-affecting settings are restricted in untrusted workspaces.
- Workspace prompt overrides are disabled by default.

## Release Notes

Release history is included in the packaged changelog.

## Support

NexCode Kiboko is distributed as a packaged VS Code extension. For support, use the support channel listed by the publisher on the Marketplace page.

## License

MIT License.
