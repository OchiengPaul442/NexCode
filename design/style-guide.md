# Kiboko Design Tokens & Style Guide

## Colors (dark theme)

- --bg: #1e1e1e
- --panel: #252526
- --surface: #151515
  -- --accent: #334155
- --muted: #9aa2a6
- --text: #e6eef3
- --chip: #2a2a2a

## Typography

- Primary: Inter, system-ui, -apple-system, 'Segoe UI', Roboto
- Sizes: 12px (small), 14px (body), 16px (base), 20px (title)

## Spacing

- base grid: 8px increments
- sidebar width: 260px
- main content gutter: 24px

## Component notes (for TypeScript + React)

- Use CSS variables for theming and provide a `theme.css` file.
- Prefer lightweight component library or plain React + CSS modules.
- Keep interactions keyboard-first and accessible.

## Visual affordances

- Show streaming state with subtle skeletons or token-by-token reveal.
- Show diffs using a side-by-side or inline gutter with `accept` / `reject` actions.
- Mode indicator: small shield icon + label (Plan / Edit / Agent / God Mode).

## Assets

- SVG-first icons for crispness on all display densities.
- Provide both compact (sidebar) and expanded (panel) layouts.

## Implementation note

- All front-end work should be TypeScript + React (or Preact) inside the VS Code WebView.
- Use the Chat Participant API when available and fall back to a webview React app.
