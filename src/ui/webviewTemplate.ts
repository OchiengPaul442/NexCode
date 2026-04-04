import {
  computeLineDiff,
  renderUnifiedDiffHtml,
  renderInlineUnifiedDiffHtml,
} from "./diffUtils";

export function getChatWebviewHtml(): string {
  const computeLineDiffSrc = computeLineDiff.toString();
  const renderUnifiedDiffHtmlSrc = renderUnifiedDiffHtml.toString();
  const renderInlineUnifiedDiffHtmlSrc = renderInlineUnifiedDiffHtml.toString();
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Kiboko Chat</title>
    <style>
      :root {
        --bg: #0f1720;
        --panel: #0b1220;
        --muted: #94a3b8;
        --text: #e6eef8;
        --accent: #7c3aed;
        --user-bg: #1f2937;
        --assistant-bg: #022c36;
        --success: #10b981;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f6f8fb;
          --panel: #ffffff;
          --muted: #475569;
          --text: #0f1720;
          --accent: #6d28d9;
          --user-bg: #e6eef8;
          --assistant-bg: #eef2ff;
        }
      }
      html,body { height:100%; margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; background:var(--bg); color:var(--text); }
      .container { display:flex; flex-direction:column; height:100vh; gap:12px; padding:12px; box-sizing:border-box; }
      .header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .brand { display:flex; gap:12px; align-items:center; }
      .logo { width:36px; height:36px; border-radius:8px; background:linear-gradient(135deg,var(--accent),#4f46e5); display:flex; align-items:center; justify-content:center; color:white; font-weight:700; }
      .title { font-size:14px; font-weight:600; }
      .controls { display:flex; gap:8px; align-items:center; }
      select, button { background:var(--panel); color:var(--text); border:1px solid rgba(255,255,255,0.04); padding:6px 8px; border-radius:6px; }
      .panel { background:var(--panel); border-radius:10px; padding:12px; display:flex; flex-direction:column; height:calc(100vh - 160px); }
      .messages { flex:1; overflow:auto; padding:8px; display:flex; flex-direction:column; gap:8px; }
      .bubble { max-width:78%; padding:10px 12px; border-radius:12px; line-height:1.4; white-space:pre-wrap; word-break:break-word; }
      .bubble.user { align-self:flex-end; background:var(--user-bg); color:var(--text); border-bottom-right-radius:6px; }
      .bubble.assistant { align-self:flex-start; background:var(--assistant-bg); color:var(--text); border-bottom-left-radius:6px; }
      .meta { font-size:11px; color:var(--muted); margin-bottom:6px; }
      .inputBar { display:flex; gap:8px; align-items:flex-end; margin-top:8px; }
      textarea { flex:1; min-height:44px; max-height:200px; resize:none; padding:8px; border-radius:8px; border:1px solid rgba(255,255,255,0.04); background:transparent; color:var(--text); }
      .small { font-size:12px; color:var(--muted); }
      .toolbar { display:flex; gap:6px; }
      .assistant.loading::after { content:' •••'; opacity:0.7; }
      /* Diff preview styles */
      .diff-line { padding:2px 6px; border-radius:4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Helvetica Neue', monospace; font-size:12px; }
      .diff-line.add { background: rgba(16,185,129,0.06); color: var(--success); }
      .diff-line.del { background: rgba(239,68,68,0.04); color: #ff7b7b; }
      .diff-line.unchanged { color: var(--muted); }
      .inline-add { background: rgba(16,185,129,0.12); color: var(--success); padding:0 4px; border-radius:4px; }
      .inline-del { background: rgba(239,68,68,0.06); color: #ff7b7b; padding:0 4px; border-radius:4px; text-decoration:line-through; }
      .preview-gutter { background: transparent; }
      .gutter-line { padding:2px 4px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', 'Helvetica Neue', monospace; font-size:12px; color:var(--muted); }
      .gutter-line.changed { color: var(--accent); font-weight:600; }
      .gutter-line:focus { outline: 2px solid rgba(124,58,237,0.32); outline-offset:2px; border-radius:4px; }
      .gutter-line:hover::after { content: ' ⎘'; color: var(--muted); font-size:11px; margin-left:6px; opacity:0.9; }
      /* Suggestion card focus and spacing */
      .suggestion-card:focus { outline: 2px solid rgba(124,58,237,0.32); outline-offset:2px; }
      .suggestion-card button { margin-right:8px; }
      .message-row { display:flex; gap:8px; align-items:flex-start; }
      .message-row.user { flex-direction: row-reverse; }
      .message-row.user .message-wrap { text-align: right; }
      .avatar { width:28px; height:28px; border-radius:6px; background:linear-gradient(135deg,var(--accent),#4f46e5); display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:12px; flex:0 0 28px; }
      .message-wrap { display:block; }
      .suggestion-card { background: rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.04); padding:8px; margin-top:8px; border-radius:8px; }
      .suggestion-text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, 'Roboto Mono', monospace; font-size:13px; white-space:pre-wrap; word-break:break-word; color:var(--text); }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="brand">
          <div class="logo">K</div>
          <div>
            <div class="title">Kiboko Chat</div>
            <div class="small">Prototype conversation UI</div>
          </div>
        </div>
        <div class="controls">
          <label class="small" for="providerSelect">Provider</label>
          <select id="providerSelect">
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI</option>
          </select>
          <button id="memoriesBtn" title="Memories">Memories</button>
          <button id="clearBtn" title="Clear conversation">Clear</button>
        </div>
      </div>

      <div class="panel">
        <div id="messages" class="messages" role="log" aria-live="polite"></div>

        <div class="inputBar">
          <textarea id="input" placeholder="Ask a question or type a prompt..."></textarea>
          <div class="toolbar">
            <button id="stopBtn" title="Stop" disabled>Stop</button>
            <button id="previewBtn" title="Preview">Preview</button>
            <button id="suggestBtn" title="Suggest">Suggest</button>
            <button id="send">Send</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Preview modal / panel -->
    <div id="previewPanel" role="dialog" aria-modal="true" aria-label="Patch preview" tabindex="0" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9999; align-items:center; justify-content:center;">
      <div style="background:var(--panel); color:var(--text); width:85%; max-width:1100px; border-radius:10px; padding:12px; box-shadow:0 8px 30px rgba(0,0,0,0.6);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
          <div style="font-weight:600">Patch Preview</div>
          <div style="display:flex; gap:8px;">
            <button id="applyPreviewBtn">Apply Patch</button>
            <button id="closePreviewBtn">Close</button>
          </div>
        </div>
        <div style="display:flex; gap:12px;">
          <div style="flex:1;">
            <div class="small">Before</div>
            <div style="display:flex; gap:8px; align-items:flex-start;">
              <div id="beforeGutter" class="preview-gutter" style="width:56px; text-align:right; padding:8px 6px; overflow:auto; max-height:480px; color:var(--muted);"></div>
              <pre id="beforeBlock" style="flex:1; white-space:pre-wrap; word-break:break-word; margin:6px 0; padding:8px; border-radius:6px; background:rgba(255,255,255,0.02); max-height:480px; overflow:auto;"></pre>
            </div>
          </div>
          <div style="width:12px; align-self:center; color:var(--muted);">→</div>
          <div style="flex:1;">
            <div class="small">After</div>
            <div style="display:flex; gap:8px; align-items:flex-start;">
              <div id="afterGutter" class="preview-gutter" style="width:56px; text-align:right; padding:8px 6px; overflow:auto; max-height:480px; color:var(--muted);"></div>
              <pre id="afterBlock" style="flex:1; white-space:pre-wrap; word-break:break-word; margin:6px 0; padding:8px; border-radius:6px; background:rgba(255,255,255,0.02); max-height:480px; overflow:auto;"></pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Memories modal / panel -->
    <div id="memoriesPanel" role="dialog" aria-modal="true" aria-label="Memories" tabindex="0" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9999; align-items:center; justify-content:center;">
      <div style="background:var(--panel); color:var(--text); width:70%; max-width:900px; border-radius:10px; padding:12px; box-shadow:0 8px 30px rgba(0,0,0,0.6);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px;">
          <div style="font-weight:600">Memories</div>
          <div style="display:flex; gap:8px;">
            <button id="closeMemoriesBtn">Close</button>
          </div>
        </div>
        <div style="margin-bottom:8px;"><input id="memSearch" placeholder="Filter memories..." style="width:100%; padding:8px; border-radius:6px; background:transparent; border:1px solid rgba(255,255,255,0.04); color:var(--text);" /></div>
        <div id="memoriesList" style="max-height:480px; overflow:auto; display:flex; flex-direction:column; gap:8px;"></div>
      </div>
    </div>

    <script>
      const vscode = acquireVsCodeApi();
      const messagesEl = document.getElementById('messages');
      const inputEl = document.getElementById('input');
      const sendBtn = document.getElementById('send');
      const stopBtn = document.getElementById('stopBtn');
      const providerSelect = document.getElementById('providerSelect');
      const clearBtn = document.getElementById('clearBtn');
      const previewBtn = document.getElementById('previewBtn');
      const suggestBtn = document.getElementById('suggestBtn');
      const previewPanel = document.getElementById('previewPanel');
      const applyPreviewBtn = document.getElementById('applyPreviewBtn');
      const closePreviewBtn = document.getElementById('closePreviewBtn');
      const beforeBlock = document.getElementById('beforeBlock');
      const afterBlock = document.getElementById('afterBlock');
      const beforeGutter = document.getElementById('beforeGutter');
      const afterGutter = document.getElementById('afterGutter');
      let lastPreviewNewText = null;

      // minimal HTML escape
      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      // Very small markdown-to-html implementation supporting code fences, inline code, bold, italic, links, and line breaks.
      function mdToHtml(text) {
        if (!text) return '';
        // extract code fences
        const codeBlocks = [];
        text = text.replace(/\`\`\`(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)\`\`\`/g, function (_, code) {
          codeBlocks.push('<pre><code>' + escapeHtml(code) + '</code></pre>');
          return '___CODEBLOCK_' + (codeBlocks.length - 1) + '___';
        });

        // extract inline code
        const inlineBlocks = [];
        text = text.replace(/\`([^\`\n]+)\`/g, function (_, code) {
          inlineBlocks.push('<code>' + escapeHtml(code) + '</code>');
          return '___INLINE_' + (inlineBlocks.length - 1) + '___';
        });

        // escape rest
        text = escapeHtml(text);

        // headings
        text = text.replace(/^###### (.*)$/gm, '<h6>$1</h6>');
        text = text.replace(/^##### (.*)$/gm, '<h5>$1</h5>');
        text = text.replace(/^#### (.*)$/gm, '<h4>$1</h4>');
        text = text.replace(/^### (.*)$/gm, '<h3>$1</h3>');
        text = text.replace(/^## (.*)$/gm, '<h2>$1</h2>');
        text = text.replace(/^# (.*)$/gm, '<h1>$1</h1>');

        // links
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // bold and italic
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

        // restore inline code
        text = text.replace(/___INLINE_(\d+)___/g, function (_, idx) {
          return inlineBlocks[Number(idx)];
        });

        // paragraphs: double newline -> paragraph break
        text = text.split(/\n\s*\n/).map(function (para) {
          return para.replace(/\n/g, '<br>');
        }).join('<p></p>');

        // restore code blocks
        text = text.replace(/___CODEBLOCK_(\d+)___/g, function (_, idx) {
          return codeBlocks[Number(idx)];
        });

        return '<div class="markdown-body">' + text + '</div>';
      }

      function createBubble(role, text, opts = {}) {
        try {
          const last = messagesEl.lastElementChild;
          let row = null;
          if (last && last.classList && last.classList.contains('message-row') && last.dataset && last.dataset.role === role) {
            row = last;
          }
          if (!row) {
            row = document.createElement('div');
            row.className = 'message-row ' + (role === 'user' ? 'user' : 'assistant');
            row.dataset.role = role;

            const avatar = document.createElement('div');
            avatar.className = 'avatar';
            avatar.textContent = role === 'user' ? 'Y' : 'K';

            const wrap = document.createElement('div');
            wrap.className = 'message-wrap';
            const meta = document.createElement('div');
            meta.className = 'meta small';
            meta.textContent = role === 'user' ? 'You' : 'Kiboko';
            wrap.appendChild(meta);

            row.appendChild(avatar);
            row.appendChild(wrap);
            messagesEl.appendChild(row);
          }

          const wrap = row.querySelector('.message-wrap');
          const bubble = document.createElement('div');
          bubble.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
          if (role === 'assistant') bubble.innerHTML = mdToHtml(text || '');
          else bubble.innerText = text || '';
          if (opts.streaming) {
            bubble.dataset.streaming = '1';
            bubble.dataset.streamText = text || '';
          }
          wrap.appendChild(bubble);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          try { persistMessagesToHost(); } catch (e) {}
          return bubble;
        } catch (e) {
          const wrap = document.createElement('div');
          const meta = document.createElement('div');
          meta.className = 'meta small';
          meta.textContent = role === 'user' ? 'You' : 'Kiboko';
          const bubble = document.createElement('div');
          bubble.className = 'bubble ' + (role === 'user' ? 'user' : 'assistant');
          if (role === 'assistant') bubble.innerHTML = mdToHtml(text || '');
          else bubble.innerText = text || '';
          wrap.appendChild(meta);
          wrap.appendChild(bubble);
          messagesEl.appendChild(wrap);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          try { persistMessagesToHost(); } catch (e) {}
          return bubble;
        }
      }

      function persistMessagesToHost() {
        try {
          const msgs = [];
          const wraps = Array.from(messagesEl.children || []);
          wraps.forEach((w) => {
            try {
              const meta = w.querySelector && w.querySelector('.meta');
              const bubble = w.querySelector && w.querySelector('.bubble');
              const role = meta && meta.textContent && meta.textContent.trim() === 'You' ? 'user' : 'assistant';
              const text = bubble && ((bubble.dataset && bubble.dataset.streamText) ? bubble.dataset.streamText : (bubble.innerText || ''));
              msgs.push({ role, text });
            } catch (e) {}
          });
          try { vscode.postMessage({ type: 'persistMessages', messages: msgs }); } catch (e) {}
        } catch (e) {}
      }

      function appendToStreaming(text) {
        const last = Array.from(messagesEl.querySelectorAll('.bubble.assistant')).reverse().find(b => b.dataset.streaming === '1');
        if (last) {
          last.dataset.streamText = (last.dataset.streamText || '') + String(text || '');
          last.innerHTML = mdToHtml(last.dataset.streamText);
        } else {
          const b = createBubble('assistant', text, { streaming: true });
          b.dataset.streaming = '1';
          b.dataset.streamText = String(text || '');
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      window.addEventListener('message', event => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'provider') {
          try { providerSelect.value = msg.value || 'ollama'; } catch(e) {}
          return;
        }
        if (msg.type === 'history') {
          try {
            const items = Array.isArray(msg.messages) ? msg.messages : [];
            messagesEl.innerHTML = '';
            items.forEach((m) => {
              try { createBubble(m.role === 'user' ? 'user' : 'assistant', m.text || ''); } catch (e) {}
            });
          } catch (e) {}
          return;
        }
        if (msg.type === 'memoriesList') {
          try {
            const list = Array.isArray(msg.memories) ? msg.memories : [];
            try { renderMemories(list); } catch (e) {}
            try { if (memoriesPanel) { memoriesPanel.style.display = 'flex'; memoriesPanel.focus && memoriesPanel.focus(); } } catch (e) {}
          } catch (e) {}
          return;
        }
        if (msg.type === 'patchPreview') {
          if (msg.status === 'no-change') {
            createBubble('assistant', 'No changes detected vs current file.');
            return;
          }
          // show unified diff preview for the changed segment
          const before = msg.oldTextSegment ?? '';
          const afterSeg = msg.patch && typeof msg.patch.newText === 'string' ? msg.patch.newText : (typeof msg.newText === 'string' ? msg.newText : '');
          try {
            const baseLine = (msg && msg.range && msg.range.start && typeof msg.range.start.line === 'number') ? (msg.range.start.line + 1) : 1;
            showUnifiedDiff(before, afterSeg, baseLine);
            lastPreviewNewText = msg.newText ?? (msg.patch && msg.patch.newText) ?? '';
            previewPanel.style.display = 'flex';
            try { previewPanel.focus(); } catch (e) {}
            try { vscode.postMessage({ type: 'e2e_patch_received' }); } catch (e) {}
          } catch (e) {
            // fallback: simple text set
            try { beforeBlock.textContent = before; afterBlock.textContent = afterSeg; } catch (er) {}
          }
          return;
        }
        // E2E: run a scroll probe inside the webview and report positions back to extension
        if (msg.type === 'e2e_run_scroll_probe') {
          try {
            const ratio = typeof msg.ratio === 'number' ? msg.ratio : (msg.offset ? Number(msg.offset) : 0.5);
            if (beforeBlock && afterBlock) {
              const srcMax = Math.max(0, beforeBlock.scrollHeight - beforeBlock.clientHeight);
              const target = Math.round((isFinite(ratio) ? ratio : 0.5) * srcMax);
              try { beforeBlock.scrollTop = target; } catch (e) {}
              try { beforeBlock.dispatchEvent(new Event('scroll')); } catch (e) {}
              // give the scroll handlers a moment to run and sync
              // Increase delay to reduce e2e timing flakiness on CI/Dev Host
              setTimeout(() => {
                try {
                  const beforeTop = beforeBlock.scrollTop || 0;
                  const afterTop = afterBlock.scrollTop || 0;
                  const afterMax = Math.max(0, afterBlock.scrollHeight - afterBlock.clientHeight);
                  vscode.postMessage({ type: 'e2e_scroll_report', beforeTop, afterTop, beforeMax: srcMax, afterMax });
                } catch (e) {}
              }, 250);
            }
          } catch (e) {}
          return;
        }
        if (msg.type === 'patchApplied') {
          if (msg.status === 'applied') {
            createBubble('assistant', 'Patch applied to workspace.');
          } else if (msg.status === 'no-change') {
            createBubble('assistant', 'No changes to apply.');
          } else {
            createBubble('assistant', 'Patch application failed.');
          }
          try { previewPanel.style.display = 'none'; } catch (e) {}
          return;
        }
        if (msg.type === 'suggestionApplied') {
          try {
            if (msg.status === 'applied') createBubble('assistant', 'Suggestion applied to editor.');
            else createBubble('assistant', 'Suggestion application failed.');
            try { Array.from(document.querySelectorAll('.suggestion-card')).forEach(c => c.remove()); } catch (e) {}
          } catch (e) {}
          return;
        }
        if (msg.type === 'output') {
          appendToStreaming(String(msg.text || ''));
          return;
        }
        if (msg.type === 'done') {
          const last = Array.from(messagesEl.querySelectorAll('.bubble.assistant')).reverse().find(b => b.dataset.streaming === '1');
          if (last) delete last.dataset.streaming;
          stopBtn.disabled = true;
          sendBtn.disabled = false;
          return;
        }
        if (msg.type === 'error') {
          createBubble('assistant', 'Error: ' + String(msg.text || ''));
          stopBtn.disabled = true;
          sendBtn.disabled = false;
          return;
        }
      });

      // keyboard shortcuts: Ctrl+Enter to send, Shift+Enter for newline
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          sendBtn.click();
        }
      });

      // Global suggestion shortcut: Ctrl/Cmd + Shift + S opens suggestion and focuses it
      document.addEventListener('keydown', (e) => {
        try {
          const key = e && e.key ? String(e.key).toLowerCase() : '';
          const isMac = navigator && navigator.platform && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
          const isMod = isMac ? !!e.metaKey : !!e.ctrlKey;
          if (isMod && e.shiftKey && key === 's') {
            try { e.preventDefault(); } catch (err) {}
            if (suggestBtn && typeof suggestBtn.click === 'function') {
              try { suggestBtn.click(); } catch (err) {}
              // focus the created suggestion card, if any
              setTimeout(() => {
                try {
                  const lastAssistant = Array.from(messagesEl.querySelectorAll('.bubble.assistant')).reverse().find(b => !!(b.dataset && (b.dataset.streamText || b.innerText)));
                  if (lastAssistant) {
                    const wrap = lastAssistant.parentElement;
                    const card = wrap && wrap.querySelector && wrap.querySelector('.suggestion-card');
                    if (card && card.focus) try { card.focus(); } catch (er) {}
                  }
                } catch (er) {}
              }, 120);
            }
          } else if (isMod && e.shiftKey && key === 'm') {
            try { e.preventDefault(); } catch (err) {}
            if (memoriesBtn && typeof memoriesBtn.click === 'function') {
              try { memoriesBtn.click(); } catch (err) {}
              // focus search input after panel opens
              setTimeout(() => { try { const s = document.getElementById('memSearch'); if (s && (s as any).focus) (s as any).focus(); } catch (e) {} }, 160);
            }
          }
        } catch (e) {}
      });

      ${computeLineDiffSrc}

      ${renderUnifiedDiffHtmlSrc}

      ${renderInlineUnifiedDiffHtmlSrc}

      function showUnifiedDiff(before, after, baseLine) {
        if (typeof baseLine !== 'number') baseLine = baseLine ? Number(baseLine) : 1;
        try {
          // prefer inline/token-aware renderer when available
          if (typeof renderInlineUnifiedDiffHtml === 'function') {
            const r = renderInlineUnifiedDiffHtml(before, after);
            if (r && r.beforeHtml != null) {
              beforeBlock.innerHTML = r.beforeHtml;
              afterBlock.innerHTML = r.afterHtml;
              // update gutters if present
              try {
                if (beforeGutter && afterGutter) {
                  const bChildren = Array.from(beforeBlock.querySelectorAll('.diff-line'));
                  const aChildren = Array.from(afterBlock.querySelectorAll('.diff-line'));
                  beforeGutter.innerHTML = bChildren.map((_, idx) => '<div class="gutter-line">' + (baseLine + idx) + '</div>').join('');
                  afterGutter.innerHTML = aChildren.map((_, idx) => '<div class="gutter-line">' + (baseLine + idx) + '</div>').join('');
                  // mark changed lines
                  bChildren.forEach((el, idx) => {
                    const gutterEl = beforeGutter.children[idx];
                    if (!gutterEl) return;
                    if (el.classList.contains('del') || el.querySelector('.inline-del')) gutterEl.classList.add('changed');
                  });
                  aChildren.forEach((el, idx) => {
                    const gutterEl = afterGutter.children[idx];
                    if (!gutterEl) return;
                    if (el.classList.contains('add') || el.querySelector('.inline-add')) gutterEl.classList.add('changed');
                  });
                  // make gutters focusable and interactive
                  try {
                    beforeGutter.innerHTML = bChildren.map((_, idx) => '<div class="gutter-line" tabindex="0" data-line="' + (baseLine + idx) + '">' + (baseLine + idx) + '</div>').join('');
                    afterGutter.innerHTML = aChildren.map((_, idx) => '<div class="gutter-line" tabindex="0" data-line="' + (baseLine + idx) + '">' + (baseLine + idx) + '</div>').join('');
                    const attachGutterHandlers = (gutter) => {
                      Array.from(gutter.querySelectorAll('.gutter-line')).forEach((el) => {
                        el.addEventListener('click', (ev) => {
                          try {
                            const lineVal = Number(el.dataset.line || el.textContent);
                            if (ev && (ev.ctrlKey || ev.metaKey)) {
                              try {
                                if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                                  navigator.clipboard.writeText(String(el.dataset.line || el.textContent));
                                  el.setAttribute('title', 'Copied');
                                  setTimeout(() => { try { el.removeAttribute('title'); } catch(e){} }, 1400);
                                } else if (document && document.execCommand) {
                                  const ta = document.createElement('textarea');
                                  ta.value = String(el.dataset.line || el.textContent);
                                  document.body.appendChild(ta);
                                  ta.select();
                                  document.execCommand('copy');
                                  ta.remove();
                                  el.setAttribute('title', 'Copied');
                                  setTimeout(() => { try { el.removeAttribute('title'); } catch(e){} }, 1400);
                                }
                              } catch (e) {}
                            } else {
                              try { vscode.postMessage({ type: 'gutterClick', line: lineVal }); } catch (e) {}
                            }
                          } catch (e) {}
                        });
                        el.addEventListener('keydown', (ev) => {
                          if (ev.key === 'Enter') {
                            try { vscode.postMessage({ type: 'gutterClick', line: Number(el.dataset.line || el.textContent) }); } catch (e) {}
                          } else if (ev.key === 'ArrowDown') {
                            const next = el.nextElementSibling;
                            if (next && next.focus) { next.focus(); ev.preventDefault(); }
                          } else if (ev.key === 'ArrowUp') {
                            const prev = el.previousElementSibling;
                            if (prev && prev.focus) { prev.focus(); ev.preventDefault(); }
                          }
                        });
                      });
                    };
                    if (beforeGutter) attachGutterHandlers(beforeGutter);
                    if (afterGutter) attachGutterHandlers(afterGutter);
                  } catch (e) {}
                }
              } catch (e) {}
              return;
            }
          }
        } catch (e) {
          // fall through to unified renderer
        }
        try {
          const r = renderUnifiedDiffHtml(before, after);
          beforeBlock.innerHTML = r.beforeHtml;
          afterBlock.innerHTML = r.afterHtml;
          // update gutters when using unified renderer
          try {
            if (beforeGutter && afterGutter) {
              const bChildren = Array.from(beforeBlock.querySelectorAll('.diff-line'));
              const aChildren = Array.from(afterBlock.querySelectorAll('.diff-line'));
              beforeGutter.innerHTML = bChildren.map((_, idx) => '<div class="gutter-line" tabindex="0" data-line="' + (baseLine + idx) + '">' + (baseLine + idx) + '</div>').join('');
              afterGutter.innerHTML = aChildren.map((_, idx) => '<div class="gutter-line" tabindex="0" data-line="' + (baseLine + idx) + '">' + (baseLine + idx) + '</div>').join('');
              bChildren.forEach((el, idx) => {
                const gutterEl = beforeGutter.children[idx];
                if (!gutterEl) return;
                if (el.classList.contains('del') || el.querySelector('.inline-del')) gutterEl.classList.add('changed');
              });
              aChildren.forEach((el, idx) => {
                const gutterEl = afterGutter.children[idx];
                if (!gutterEl) return;
                if (el.classList.contains('add') || el.querySelector('.inline-add')) gutterEl.classList.add('changed');
              });
              try {
                const attachGutterHandlers = (gutter) => {
                  Array.from(gutter.querySelectorAll('.gutter-line')).forEach((el) => {
                    el.addEventListener('click', (ev) => {
                      try {
                        const lineVal = Number(el.dataset.line || el.textContent);
                        if (ev && (ev.ctrlKey || ev.metaKey)) {
                          try {
                            if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                              navigator.clipboard.writeText(String(el.dataset.line || el.textContent));
                              el.setAttribute('title', 'Copied');
                              setTimeout(() => { try { el.removeAttribute('title'); } catch(e){} }, 1400);
                            } else if (document && document.execCommand) {
                              const ta = document.createElement('textarea');
                              ta.value = String(el.dataset.line || el.textContent);
                              document.body.appendChild(ta);
                              ta.select();
                              document.execCommand('copy');
                              ta.remove();
                              el.setAttribute('title', 'Copied');
                              setTimeout(() => { try { el.removeAttribute('title'); } catch(e){} }, 1400);
                            }
                          } catch (e) {}
                        } else {
                          try { vscode.postMessage({ type: 'gutterClick', line: lineVal }); } catch (e) {}
                        }
                      } catch (e) {}
                    });
                    el.addEventListener('keydown', (ev) => {
                      if (ev.key === 'Enter') {
                        try { vscode.postMessage({ type: 'gutterClick', line: Number(el.dataset.line || el.textContent) }); } catch (e) {}
                      } else if (ev.key === 'ArrowDown') {
                        const next = el.nextElementSibling;
                        if (next && next.focus) { next.focus(); ev.preventDefault(); }
                      } else if (ev.key === 'ArrowUp') {
                        const prev = el.previousElementSibling;
                        if (prev && prev.focus) { prev.focus(); ev.preventDefault(); }
                      }
                    });
                  });
                };
                if (beforeGutter) attachGutterHandlers(beforeGutter);
                if (afterGutter) attachGutterHandlers(afterGutter);
              } catch (e) {}
            }
          } catch (e) {}
        } catch (e) {
          try { beforeBlock.textContent = before; afterBlock.textContent = after; } catch (er) {}
        }
      }

      // synchronized scrolling between before/after preview panes
      (function() {
        let isSyncing = false;
        function syncScroll(src, tgt) {
          if (!src || !tgt) return;
          if (isSyncing) return;
          try {
            isSyncing = true;
            const srcTop = src.scrollTop;
            const srcMax = Math.max(0, src.scrollHeight - src.clientHeight);
            const ratio = srcMax > 0 ? srcTop / srcMax : 0;
            const tgtMax = Math.max(0, tgt.scrollHeight - tgt.clientHeight);
            tgt.scrollTop = Math.round(ratio * tgtMax);
          } finally {
            isSyncing = false;
          }
        }
        try {
          if (beforeBlock && afterBlock) {
            beforeBlock.addEventListener('scroll', function() { syncScroll(beforeBlock, afterBlock); });
            afterBlock.addEventListener('scroll', function() { syncScroll(afterBlock, beforeBlock); });
          }
        } catch (e) {}

        // Escape key closes preview when open
        try {
          document.addEventListener('keydown', function(ev) {
            if (ev.key === 'Escape') {
              try {
                if (previewPanel && previewPanel.style && previewPanel.style.display === 'flex') {
                  previewPanel.style.display = 'none';
                  try { previewPanel.blur && previewPanel.blur(); } catch (e) {}
                }
              } catch (e) {}
            }
          });
          // allow Enter to apply when preview panel is focused
          try {
            if (previewPanel && applyPreviewBtn) {
              previewPanel.addEventListener('keydown', function(ev) {
                try {
                  if (ev.key === 'Enter') {
                    const active = document.activeElement;
                    // only trigger when focus is on the panel itself (not inside code blocks)
                    if (active === previewPanel) {
                      try { applyPreviewBtn.click(); } catch (e) {}
                      ev.preventDefault();
                    }
                  }
                } catch (e) {}
              });
            }
          } catch (e) {}
        } catch (e) {}
      })();

      sendBtn.addEventListener('click', () => {
        const txt = inputEl.value.trim();
        if (!txt) return;
        createBubble('user', txt);
        inputEl.value = '';
        sendBtn.disabled = true;
        stopBtn.disabled = false;
        // start a new streaming assistant bubble
        createBubble('assistant', '', { streaming: true });
        // post to extension
        vscode.postMessage({ type: 'send', text: txt });
      });

      stopBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
        stopBtn.disabled = true;
        sendBtn.disabled = false;
      });

      providerSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'setProvider', value: providerSelect.value });
      });

      // Preview button: send last assistant output as full-file newText for preview
      previewBtn.addEventListener('click', () => {
        const lastAssistant = Array.from(messagesEl.querySelectorAll('.bubble.assistant')).reverse().find(b => !!(b.dataset && (b.dataset.streamText || b.innerText)));
        if (!lastAssistant) {
          createBubble('assistant', 'No assistant output to preview.');
          return;
        }
        const newText = lastAssistant.dataset.streamText ?? lastAssistant.innerText ?? '';
        if (!newText) {
          createBubble('assistant', 'No assistant output to preview.');
          return;
        }
        vscode.postMessage({ type: 'previewPatch', newText });
      });

      if (suggestBtn) {
        suggestBtn.addEventListener('click', () => {
          const lastAssistant = Array.from(messagesEl.querySelectorAll('.bubble.assistant')).reverse().find(b => !!(b.dataset && (b.dataset.streamText || b.innerText)));
          if (!lastAssistant) {
            createBubble('assistant', 'No assistant output to suggest.');
            return;
          }
          const suggestionText = lastAssistant.dataset.streamText ?? lastAssistant.innerText ?? '';
          if (!suggestionText) {
            createBubble('assistant', 'No assistant output to suggest.');
            return;
          }
          try {
            const wrap = lastAssistant.parentElement;
            if (!wrap) return;
            const existing = wrap.querySelector('.suggestion-card');
            if (existing) existing.remove();
            const card = document.createElement('div');
            card.className = 'suggestion-card';
            card.setAttribute('role','group');
            card.setAttribute('aria-label','Assistant suggestion');
            card.tabIndex = 0;
            const txt = document.createElement('div'); txt.className = 'suggestion-text'; txt.textContent = suggestionText;
            const controls = document.createElement('div'); controls.style.marginTop = '8px';
            const insertBtn = document.createElement('button'); insertBtn.type = 'button'; insertBtn.textContent = 'Insert'; insertBtn.setAttribute('aria-label','Insert suggestion');
            const copyBtn = document.createElement('button'); copyBtn.type = 'button'; copyBtn.textContent = 'Copy'; copyBtn.setAttribute('aria-label','Copy suggestion');
            const saveBtn = document.createElement('button'); saveBtn.type = 'button'; saveBtn.textContent = 'Save'; saveBtn.setAttribute('aria-label','Save suggestion as memory');
            controls.appendChild(insertBtn);
            controls.appendChild(copyBtn);
            controls.appendChild(saveBtn);
            card.appendChild(txt);
            card.appendChild(controls);
            wrap.appendChild(card);

            const doCopy = () => {
              try {
                if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(suggestionText);
                } else if (document && document.execCommand) {
                  const ta = document.createElement('textarea'); ta.value = suggestionText; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
                }
              } catch (e) {}
            };

            insertBtn.addEventListener('click', () => {
              try { vscode.postMessage({ type: 'applySuggestion', snippet: suggestionText }); insertBtn.disabled = true; } catch (e) {}
            });
            copyBtn.addEventListener('click', () => { doCopy(); });

            const doSave = () => {
              try {
                try { vscode.postMessage({ type: 'saveMemory', memoryText: suggestionText }); } catch (e) {}
                saveBtn.disabled = true;
              } catch (e) {}
            };

            saveBtn.addEventListener('click', () => { doSave(); });

            card.addEventListener('keydown', (ev) => {
              try {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault();
                  try { vscode.postMessage({ type: 'applySuggestion', snippet: suggestionText }); insertBtn.disabled = true; } catch (e) {}
                } else if (ev.key && ev.key.toLowerCase() === 'c') {
                  ev.preventDefault(); doCopy();
                } else if (ev.key && ev.key.toLowerCase() === 'm') {
                  ev.preventDefault(); doSave();
                } else if (ev.key === 'Escape') {
                  ev.preventDefault(); try { card.remove(); } catch (e) {}
                }
              } catch (e) {}
            });

            try { persistMessagesToHost(); } catch (e) {}
          } catch (e) {}
        });
      }

      applyPreviewBtn.addEventListener('click', () => {
        if (!lastPreviewNewText) {
          createBubble('assistant', 'Nothing to apply.');
          return;
        }
        vscode.postMessage({ type: 'applyPatch', newText: lastPreviewNewText });
      });

      closePreviewBtn.addEventListener('click', () => {
        try { previewPanel.style.display = 'none'; } catch (e) {}
      });

      clearBtn.addEventListener('click', () => {
        messagesEl.innerHTML = '';
        inputEl.focus();
      });

      window.addEventListener('load', () => {
        vscode.postMessage({ type: 'getProvider' });
        inputEl.focus();
      });

      // Memories panel interactions
      const memoriesBtn = document.getElementById('memoriesBtn');
      const memoriesPanel = document.getElementById('memoriesPanel');
      const closeMemoriesBtn = document.getElementById('closeMemoriesBtn');
      const memoriesList = document.getElementById('memoriesList');
      const memSearch = document.getElementById('memSearch');

      function renderMemories(list) {
        try {
          if (!memoriesList) return;
          memoriesList.innerHTML = '';
          (list || []).forEach((m) => {
            try {
              const item = document.createElement('div');
              item.style.display = 'flex';
              item.style.gap = '8px';
              item.style.alignItems = 'flex-start';
              item.style.padding = '8px';
              item.style.border = '1px solid rgba(255,255,255,0.02)';
              item.style.borderRadius = '8px';
              const txt = document.createElement('div');
              txt.style.flex = '1';
              txt.style.whiteSpace = 'pre-wrap';
              txt.style.wordBreak = 'break-word';
              txt.textContent = String(m.text || '');
              const actions = document.createElement('div');
              actions.style.display = 'flex';
              actions.style.flexDirection = 'column';
              actions.style.gap = '6px';
              const insert = document.createElement('button'); insert.type = 'button'; insert.textContent = 'Insert';
              const del = document.createElement('button'); del.type = 'button'; del.textContent = 'Delete';
              actions.appendChild(insert);
              actions.appendChild(del);
              item.appendChild(txt);
              item.appendChild(actions);
              memoriesList.appendChild(item);

              insert.addEventListener('click', () => {
                try { vscode.postMessage({ type: 'insertMemory', memoryText: m.text }); } catch (e) {}
              });
              del.addEventListener('click', () => {
                try { vscode.postMessage({ type: 'deleteMemory', id: m.id }); } catch (e) {}
                try { item.remove(); } catch (e) {}
              });
            } catch (e) {}
          });
        } catch (e) {}
      }

      if (memoriesBtn) memoriesBtn.addEventListener('click', () => {
        try { vscode.postMessage({ type: 'listMemories' }); } catch (e) {}
      });
      if (closeMemoriesBtn) closeMemoriesBtn.addEventListener('click', () => { try { memoriesPanel.style.display = 'none'; } catch (e) {} });
      if (memSearch) memSearch.addEventListener('input', (ev) => {
        try {
          const q = (ev && ev.target && ev.target.value) ? String((ev.target as any).value).toLowerCase() : '';
          const items = Array.from((memoriesList && memoriesList.children) || []);
          items.forEach((it: any) => {
            try {
              const txt = (it.querySelector && it.querySelector('div')) ? it.querySelector('div').textContent || '' : '';
              const show = !q || String(txt || '').toLowerCase().includes(q);
              it.style.display = show ? 'flex' : 'none';
            } catch (e) {}
          });
        } catch (e) {}
      });

    </script>
  </body>
</html>`;
}
