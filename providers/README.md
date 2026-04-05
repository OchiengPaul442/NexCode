# Provider Configuration

NEXCODE-KIBOKO supports local and remote model routing through a unified interface.

## Supported Providers

- `ollama`
- `openai-compatible`

## Quick Setup

1. Copy `providers/providers.example.json` to `providers/providers.local.json`.
2. Update model names and endpoints.
3. Configure VS Code settings under `nexcodeKiboko.*` to match your chosen provider.

## Notes

- Local-first mode uses Ollama at `http://localhost:11434`.
- Remote mode requires an API key (`OPENAI_API_KEY` or `nexcodeKiboko.openAIApiKey`).
