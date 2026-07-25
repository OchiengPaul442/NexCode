# Changelog

All notable changes to NexCode Kiboko will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project follows semantic versioning for published extension releases.

## [0.7.0] - 2026-07-25

### Added

- Marketplace-ready extension README with clearer setup, privacy, provider, command, and settings documentation.
- Packaged extension changelog for VS Code Marketplace release notes.
- Version information command for checking the installed extension build.
- Sidebar support for provider status, model selection, persistent sessions, attachments, and edit review.

### Changed

- Refined public package metadata for a private-source Marketplace release.
- Clarified that local privacy applies to Ollama usage, while remote providers and web search send data to the configured service.
- Reduced Marketplace categories and removed public source-code positioning from extension metadata.

### Security

- Documented SecretStorage usage for provider and search keys.
- Documented workspace trust restrictions for network and tool-related settings.
- Documented approval controls for terminal and file-changing tools.

## [0.6.0] - 2026-07-25

### Added

- Multi-agent runtime support for planning, coding, reviewing, QA, and security-oriented work.
- Worker pool, background worker, skill tool, auto-memory, enhanced approval policy, and path-scoped rule infrastructure.
- Web search tool support with configurable providers.

### Fixed

- Hardened command execution, path containment, secret redaction, and tool approval behavior.
- Improved cross-platform file handling and agent isolation behavior.

### Security

- Added stronger protections around shell execution, workspace containment, and sensitive environment handling.

## [0.5.0] - 2026-07-20

### Added

- Enhanced memory, hooks, path-scoped rules, MCP adapters, and permission policy infrastructure.
- Git, search, database adapter, and workspace tool improvements.

### Fixed

- Tool execution event reporting, JSON code block handling, approval behavior, and security regression issues.

## [0.4.0] - 2026-07-15

### Added

- Initial VS Code extension, sidebar webview, agent loop, tool registry, terminal tool, file tools, search, Git operations, and memory system.

### Security

- Initial terminal safety, path containment, secret redaction, and approval policy support.

## [0.3.0] - 2026-07-10

### Added

- Basic agent capabilities, multi-provider support, context management, and session persistence.

## [0.2.0] - 2026-07-05

### Added

- VS Code extension structure, webview UI, and configuration system.

## [0.1.0] - 2026-07-01

### Added

- Initial project setup and build configuration.
