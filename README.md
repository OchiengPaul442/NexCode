# NexCode Kiboko

![CI](https://img.shields.io/badge/CI-passing-brightgreen?style=flat-square) ![Tests](https://img.shields.io/badge/tests-1476%20passing-brightgreen?style=flat-square) ![Version](https://img.shields.io/badge/version-0.1.47-blue?style=flat-square) ![License](https://img.shields.io/badge/license-MIT-green?style=flat-square) ![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.95.0-blueviolet?style=flat-square)

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

1476 tests passing across 59 test files:
- Provider key isolation and lazy construction
- Workspace trust and URL validation
- Webview secret removal and state migration
- Terminal deny-by-default policy
- Webview message runtime validation
- Edit path containment and stale content detection
- Search injection prevention (Node.js walker)
- Approval policy enforcement (no bypass mode)
- Workspace prompt override containment
- Secret migration with plaintext cleanup
- MCP in-process adapter registry
- Task concurrency and steering state machine
- Cancellation propagation through tools
- Model fallback and provider identity
- Model capability registry
- Tool schema validation and malformed call rejection
- Batch edit transactions with rollback
- Atomic file writes and unique patch matching
- Cross-platform path containment
- Symlink-safe directory operations
- Multi-root workspace support
- Task history bounds and cleanup
- Persistence reliability and error surfacing
- Secret redaction (multi-layer engine)
- Config schema alignment

## License

MIT

---

Created by PAUL
