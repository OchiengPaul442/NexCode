# Changelog

## 0.1.22

- Rebuilt sidebar UX to a Copilot-style layout with session list, model/provider/mode top bar, and cleaner chat composition flow.
- Added dynamic model dropdown sourced from provider model APIs and persisted model/provider/mode per session.
- Added live provider connectivity badge with latency and refresh actions.
- Added settings panel with temperature, reasoning visibility, auto-apply toggle, and terminal approval toggle.
- Added drag-and-drop attachments and attachment preview chips.
- Added smoother streaming experience with thinking indicator and buffered token rendering.
- Added structured markdown rendering for assistant responses and collapsible reasoning/debug panels.
- Added robust staging-based release packaging to guarantee runtime dependencies are present in VSIX installs.

## 0.1.13

- Added sidebar chat experience with streaming, attachments, and approval workflow.
- Added web search (`/tool web-search`) with Tavily and fallback engines.
- Added reasoning trace and terminal confirmation controls.
- Improved packaging scripts and maintenance docs.
