# NexCode Kiboko

![CI](https://img.shields.io/badge/CI-passing-brightgreen?style=flat-square) ![Tests](https://img.shields.io/badge/tests-passing-brightgreen?style=flat-square) ![Version](https://img.shields.io/badge/version-0.1.47-blue?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-green?style=flat-square) ![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.95.0-blueviolet?style=flat-square) ![Audit](https://img.shields.io/badge/audit-17%20issues-orange?style=flat-square)

Local-first, multi-agent AI coding assistant for VS Code.

## Features

- **Multi-provider support**: Ollama (local), OpenAI-compatible, HuggingFace
- **Agent modes**: Build, Ask, Plan
- **Smart tool execution**: Auto-execute safe tools, approve destructive ones
- **File attachments**: Support for code, markdown, images, CSV, Excel
- **Session management**: Persistent sessions with history
- **Dynamic reasoning**: Real-time status updates
- **Token efficiency**: Context compression, caching, batch operations

## Quick Start

1. Install from VSIX or build from source
2. Open VS Code sidebar → NexCode
3. Configure your provider in Settings → NexCode
4. Start coding!

## Configuration

### Ollama (Local)
```json
{
  "nexcodeKiboko.defaultProvider": "ollama",
  "nexcodeKiboko.defaultModel": "qwen2.5-coder:14b"
}
```

### OpenCode Go
```json
{
  "nexcodeKiboko.defaultProvider": "openai-compatible",
  "nexcodeKiboko.openAIBaseUrl": "https://opencode.ai/zen/go/v1",
  "nexcodeKiboko.openAIApiKey": "your-api-key",
  "nexcodeKiboko.defaultModel": "deepseek-v4-flash"
}
```

### HuggingFace
```json
{
  "nexcodeKiboko.defaultProvider": "openai-compatible",
  "nexcodeKiboko.openAIBaseUrl": "https://router.huggingface.co/v1",
  "nexcodeKiboko.openAIApiKey": "your-hf-token",
  "nexcodeKiboko.defaultModel": "deepseek-ai/DeepSeek-R1:fastest"
}
```

## Development

```bash
npm ci
npm run build
npm test
npm run extension:package
```

## Testing

62 tests passing across 8 test files:
- Tool approval policy
- File system path safety
- Terminal bypass documentation
- Orchestrator behavior
- Context building
- Memory search
- Command normalization

## License

MIT
