# UI Notes

The extension uses a custom VS Code Webview sidebar to provide:

- Chat thread rendering (user, status, assistant, error)
- Provider/model/mode controls
- Streaming output updates
- Proposed edit cards with one-click apply
- Prompt history shortcuts

The implementation files are:

- `extension/media/main.css`
- `extension/media/main.js`
- `extension/src/sidebarViewProvider.ts`
