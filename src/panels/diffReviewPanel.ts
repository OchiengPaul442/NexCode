import * as vscode from "vscode";
import { execFile as execFileCb, spawn } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import { runPreToolHooks, runPostToolHooks, ToolContext } from "../tools/hooks";
import {
  confirmAction,
  sessionAlwaysAllow,
  isAutoAllowed,
  persistAllow,
  computeHash,
} from "../tools/confirmation";
import { evaluatePolicy } from "../tools/policy";

// exported handle to allow tests to stub process spawning
export let spawnProc: typeof spawn = spawn;

const execFile = promisify(execFileCb as any);

type DiffLine = {
  type: "context" | "add" | "del";
  text: string;
  oldLine?: number;
  newLine?: number;
};

type Hunk = {
  id: string;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

type FileDiff = {
  filePath: string;
  hunks: Hunk[];
};

type SuggestionEntry = {
  raw?: string;
  explanation?: string;
  suggested_patch?: string;
  streaming?: boolean;
  controller?: any;
};

export function validateSuggestedPatch(
  filePath: string,
  h: Hunk,
  patch: string,
): { valid: boolean; error?: string } {
  if (!patch || patch.trim().length === 0) return { valid: true };

  // Collect referenced file paths in the patch (from ---/+++ or diff --git)
  const filePaths = new Set<string>();
  const fromMatch = patch.match(/^---\s+(?:a\/|b\/)?(.+)$/m);
  const toMatch = patch.match(/^\+\+\+\s+(?:a\/|b\/)?(.+)$/m);
  if (fromMatch && fromMatch[1])
    filePaths.add(fromMatch[1].replace(/\\/g, "/"));
  if (toMatch && toMatch[1]) filePaths.add(toMatch[1].replace(/\\/g, "/"));

  const diffGitRe = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let dg: RegExpExecArray | null;
  while ((dg = diffGitRe.exec(patch)) !== null) {
    if (dg[1]) filePaths.add(dg[1].replace(/\\/g, "/"));
    if (dg[2]) filePaths.add(dg[2].replace(/\\/g, "/"));
  }

  const normalize = (p: string) =>
    p
      .replace(/^\.?\/?/, "")
      .replace(/\\/g, "/")
      .replace(/^a\//, "")
      .replace(/^b\//, "");
  const target = normalize(filePath);
  if (filePaths.size > 0) {
    for (const p of filePaths) {
      const np = normalize(p);
      if (
        !(
          np === target ||
          np.endsWith("/" + target) ||
          target.endsWith("/" + np)
        )
      ) {
        return {
          valid: false,
          error: `Patch targets file '${p}', which does not match expected '${filePath}'`,
        };
      }
    }
  }

  // Parse hunk headers and ensure they are within the original hunk bounds
  const hunkRe = /@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/g;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = hunkRe.exec(patch)) !== null) {
    found = true;
    const oldStart = parseInt(m[1], 10);
    const oldCount = m[2] ? parseInt(m[2], 10) : 1;
    if (h.oldCount === 0) {
      // Untracked file hunk — be permissive about additions
      continue;
    }
    if (
      oldStart < h.oldStart ||
      oldStart + oldCount > h.oldStart + h.oldCount
    ) {
      return {
        valid: false,
        error: `Patch hunk -${oldStart},${oldCount} lies outside target hunk -${h.oldStart},${h.oldCount}`,
      };
    }
  }

  if (!found) {
    return {
      valid: false,
      error:
        "Patch contains no hunk headers (@@ ... @@); cannot safely validate",
    };
  }

  return { valid: true };
}

export class DiffReviewPanel {
  public static currentPanel: DiffReviewPanel | undefined;

  public static readonly viewType = "kiboko.diffReview";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _comments = new Map<
    string,
    Array<{ text: string; when: number }>
  >();
  private readonly _suggestions = new Map<string, SuggestionEntry>();

  public static createOrShow(
    extensionUri: vscode.Uri,
    context?: vscode.ExtensionContext,
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (DiffReviewPanel.currentPanel) {
      DiffReviewPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      DiffReviewPanel.viewType,
      "Kiboko Diff Review",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    DiffReviewPanel.currentPanel = new DiffReviewPanel(
      panel,
      extensionUri,
      context,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    _context?: vscode.ExtensionContext,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.type) {
          case "log":
            console.log("Diff Webview:", message.text);
            return;
          case "refresh":
            await this._sendDiffs();
            return;
          case "applyHunk":
            await this._handleApply(
              message.filePath,
              message.hunkId,
              false,
              false,
            );
            return;
          case "stageHunk":
            await this._handleApply(
              message.filePath,
              message.hunkId,
              true,
              false,
            );
            return;
          case "revertHunk":
            await this._handleApply(
              message.filePath,
              message.hunkId,
              false,
              true,
            );
            return;
          case "addComment":
            this._addComment(message.hunkId, message.text);
            this._panel.webview.postMessage({
              type: "commentAdded",
              hunkId: message.hunkId,
            });
            return;
          case "suggestHunk":
            await this._suggestHunk(
              message.filePath,
              message.hunkId,
              message.instruction || "Fix the code",
            );
            return;
          case "applySuggestion":
            await this._applySuggestion(
              message.filePath,
              message.hunkId,
              !!message.stage,
            );
            return;
          case "copySuggestion":
            await this._copySuggestion(message.filePath, message.hunkId);
            return;
          case "cancelSuggestion":
            this._cancelSuggestion(message.hunkId);
            return;
          case "regenerateSuggestion":
            await this._suggestHunk(
              message.filePath,
              message.hunkId,
              message.instruction || "Fix the code",
            );
            return;
          default:
            console.warn("Unknown message from webview", message);
        }
      } catch (e: any) {
        this._panel.webview.postMessage({
          type: "error",
          error: String(e && e.message ? e.message : e),
        });
      }
    }, undefined);

    this._panel.onDidDispose(() => this.dispose(), null);
  }

  public dispose() {
    DiffReviewPanel.currentPanel = undefined;
    this._panel.dispose();
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.webview.html = this._getHtmlForWebview(webview);
    // once ready, request diffs
    setTimeout(() => void this._sendDiffs(), 300);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();

    const style = `
      body{font-family:Segoe UI,Arial,sans-serif;padding:12px}
      .file{border:1px solid #ddd;padding:8px;margin-bottom:12px}
      .file h3{margin:0 0 8px 0;font-size:13px}
      .hunk{border-top:1px dashed #eee;padding-top:8px;margin-top:8px}
      .hunk .controls{margin-bottom:6px}
      .line{white-space:pre;font-family:monospace;padding:0 6px}
      .line.add{background:#e6ffed}
      .line.del{background:#ffeef0}
      .line.context{background:transparent}
      .btn{border:1px solid #888;padding:4px 8px;margin-right:6px;cursor:pointer}
      .comments{margin-top:6px;font-size:13px}
      .comment{background:#f7f7f7;padding:6px;border-radius:4px;margin-top:4px}
    `;

    const html = `<!DOCTYPE html>
      <html lang="en"><head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}';" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Diff Review</title>
        <style>${style}</style>
      </head>
      <body>
        <div style="display:flex;align-items:center;margin-bottom:8px">
          <button id="refresh" class="btn">Refresh diffs</button>
          <span id="status" style="margin-left:12px;color:#666">Loading...</span>
        </div>
        <div id="files"></div>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          document.getElementById('refresh').addEventListener('click', ()=>{
            document.getElementById('status').textContent = 'Refreshing...';
            vscode.postMessage({type:'refresh'});
          });

          window.addEventListener('message', event => {
            const msg = event.data;
            if(msg.type === 'diffs'){
              renderDiffs(msg.diffs || []);
              document.getElementById('status').textContent = 'Ready';
            } else if(msg.type === 'diffState'){
              document.getElementById('status').textContent = msg.state;
            } else if(msg.type === 'actionResult'){
              document.getElementById('status').textContent = msg.success ? 'OK' : ('Error: '+(msg.error||''));
              // refresh after action
              setTimeout(()=>vscode.postMessage({type:'refresh'}), 300);
            } else if(msg.type === 'commentAdded'){
              // refresh comments
              vscode.postMessage({type:'refresh'});
            } else if(msg.type === 'suggestStream'){
              const id = encodeURIComponent(msg.hunkId);
              const el = document.getElementById('sugg-patch-'+id);
              if(el) el.textContent = (el.textContent || '') + msg.token;
            } else if(msg.type === 'suggestComplete'){
              const id = encodeURIComponent(msg.hunkId);
              const patchEl = document.getElementById('sugg-patch-'+id);
              const explEl = document.getElementById('sugg-expl-'+id);
              if(patchEl) patchEl.textContent = msg.suggestion.suggested_patch || msg.suggestion.raw || '';
              if(explEl) explEl.textContent = 'Explanation: ' + (msg.suggestion.explanation || '');
            } else if(msg.type === 'suggestError'){
              const status = document.getElementById('status');
              if(status) status.textContent = 'AI Error: '+(msg.error||'');
            } else if(msg.type === 'suggestCancelled'){
              const id = encodeURIComponent(msg.hunkId);
              const el = document.getElementById('sugg-patch-'+id);
              if(el) el.textContent = (el.textContent || '') + '\n[CANCELLED]';
            } else if(msg.type === 'error'){
              document.getElementById('status').textContent = 'Error: '+(msg.error||'');
            }
          });

          function renderDiffs(diffs){
            const root = document.getElementById('files');
            root.innerHTML = '';
            if(!diffs.length){
              root.innerHTML = '<div>No changes detected</div>';
              return;
            }
            for(const f of diffs){
              const fileEl = document.createElement('div'); fileEl.className='file';
              const title = document.createElement('h3'); title.textContent = f.filePath; fileEl.appendChild(title);
              if(!f.hunks.length){
                const p = document.createElement('div'); p.textContent='(no hunks)'; fileEl.appendChild(p);
              }
              for(const h of f.hunks){
                const hEl = document.createElement('div'); hEl.className='hunk';
                const controls = document.createElement('div'); controls.className='controls';
                const applyBtn = document.createElement('button'); applyBtn.className='btn'; applyBtn.textContent='Apply Hunk';
                applyBtn.onclick = ()=>vscode.postMessage({type:'applyHunk', filePath:f.filePath, hunkId:h.id});
                const stageBtn = document.createElement('button'); stageBtn.className='btn'; stageBtn.textContent='Stage Hunk';
                stageBtn.onclick = ()=>vscode.postMessage({type:'stageHunk', filePath:f.filePath, hunkId:h.id});
                const revertBtn = document.createElement('button'); revertBtn.className='btn'; revertBtn.textContent='Revert Hunk';
                revertBtn.onclick = ()=>vscode.postMessage({type:'revertHunk', filePath:f.filePath, hunkId:h.id});
                const commentBtn = document.createElement('button'); commentBtn.className='btn'; commentBtn.textContent='Add Comment';
                commentBtn.onclick = ()=>{
                  const text = prompt('Add comment for this hunk:');
                  if(text) vscode.postMessage({type:'addComment', hunkId:h.id, text});
                };
                const aiBtn = document.createElement('button'); aiBtn.className='btn'; aiBtn.textContent='AI Suggest';
                aiBtn.onclick = ()=>{
                  const instr = prompt('Instruction (fix/explain/improve):', 'Fix the code in this hunk');
                  if(!instr) return;
                  const sid = encodeURIComponent(h.id);
                  const existing = document.getElementById('sugg-'+sid);
                  if(existing) existing.remove();
                  const suggDiv = document.createElement('div'); suggDiv.id = 'sugg-'+sid; suggDiv.className='suggestion';
                  const expl = document.createElement('div'); expl.id='sugg-expl-'+sid; expl.textContent = 'Explanation: (streaming)'; suggDiv.appendChild(expl);
                  const patchPre = document.createElement('pre'); patchPre.id='sugg-patch-'+sid; patchPre.textContent=''; patchPre.style.whiteSpace='pre-wrap'; suggDiv.appendChild(patchPre);
                  const applyBtn2 = document.createElement('button'); applyBtn2.className='btn'; applyBtn2.textContent='Apply Suggestion'; applyBtn2.onclick=()=>vscode.postMessage({type:'applySuggestion', filePath:f.filePath, hunkId:h.id, stage:false});
                  const copyBtn2 = document.createElement('button'); copyBtn2.className='btn'; copyBtn2.textContent='Copy Suggestion'; copyBtn2.onclick=()=>vscode.postMessage({type:'copySuggestion', filePath:f.filePath, hunkId:h.id});
                  const regenBtn2 = document.createElement('button'); regenBtn2.className='btn'; regenBtn2.textContent='Regenerate'; regenBtn2.onclick=()=>vscode.postMessage({type:'regenerateSuggestion', filePath:f.filePath, hunkId:h.id, instruction:instr});
                  const cancelBtn2 = document.createElement('button'); cancelBtn2.className='btn'; cancelBtn2.textContent='Cancel'; cancelBtn2.onclick=()=>vscode.postMessage({type:'cancelSuggestion', hunkId:h.id});
                  suggDiv.appendChild(applyBtn2); suggDiv.appendChild(copyBtn2); suggDiv.appendChild(regenBtn2); suggDiv.appendChild(cancelBtn2);
                  hEl.appendChild(suggDiv);
                  vscode.postMessage({type:'suggestHunk', filePath:f.filePath, hunkId:h.id, instruction: instr});
                };
                controls.appendChild(applyBtn); controls.appendChild(stageBtn); controls.appendChild(revertBtn); controls.appendChild(commentBtn);
                controls.appendChild(aiBtn);
                hEl.appendChild(controls);
                const pre = document.createElement('div');
                for(const ln of h.lines){
                  const div = document.createElement('div'); div.className='line '+(ln.type==='add'?'add':ln.type==='del'?'del':'context');
                  div.textContent = (ln.oldLine!==undefined? (ln.oldLine+' '):'   ') + (ln.newLine!==undefined? (ln.newLine+' '):'   ') + ' ' + ln.text;
                  pre.appendChild(div);
                }
                hEl.appendChild(pre);
                // comments placeholder
                const comments = document.createElement('div'); comments.className='comments';
                if(h.comments && h.comments.length){
                  for(const c of h.comments){
                    const ce = document.createElement('div'); ce.className='comment'; ce.textContent = c.text; comments.appendChild(ce);
                  }
                }
                hEl.appendChild(comments);
                // render suggestion if available
                if(h.suggestion){
                  const sid = encodeURIComponent(h.id);
                  const sdiv = document.createElement('div'); sdiv.id = 'sugg-'+sid; sdiv.className='suggestion';
                  const expl = document.createElement('div'); expl.id='sugg-expl-'+sid; expl.textContent = 'Explanation: ' + (h.suggestion.explanation||''); sdiv.appendChild(expl);
                  const patchPre = document.createElement('pre'); patchPre.id='sugg-patch-'+sid; patchPre.textContent = h.suggestion.suggested_patch || h.suggestion.raw || ''; patchPre.style.whiteSpace='pre-wrap'; sdiv.appendChild(patchPre);
                  const applyBtn3 = document.createElement('button'); applyBtn3.className='btn'; applyBtn3.textContent='Apply Suggestion'; applyBtn3.onclick=()=>vscode.postMessage({type:'applySuggestion', filePath:f.filePath, hunkId:h.id, stage:false});
                  const copyBtn3 = document.createElement('button'); copyBtn3.className='btn'; copyBtn3.textContent='Copy Suggestion'; copyBtn3.onclick=()=>vscode.postMessage({type:'copySuggestion', filePath:f.filePath, hunkId:h.id});
                  const regenBtn3 = document.createElement('button'); regenBtn3.className='btn'; regenBtn3.textContent='Regenerate'; regenBtn3.onclick=()=>{
                    const instr = prompt('Regenerate instruction:','Fix the code'); if(instr) vscode.postMessage({type:'regenerateSuggestion', filePath:f.filePath, hunkId:h.id, instruction:instr});
                  };
                  sdiv.appendChild(applyBtn3); sdiv.appendChild(copyBtn3); sdiv.appendChild(regenBtn3);
                  hEl.appendChild(sdiv);
                }
                fileEl.appendChild(hEl);
              }
              root.appendChild(fileEl);
            }
          }

          // initial load
          vscode.postMessage({type:'refresh'});
        </script>
      </body></html>`;

    return html;
  }

  private async _sendDiffs() {
    this._panel.webview.postMessage({ type: "diffState", state: "scanning" });
    const root = await this._getRepoRoot();
    const files = await this._listChangedFiles(root);
    const diffs: FileDiff[] = [];
    for (const f of files) {
      try {
        if (f.status === "??") {
          const fd = await this._buildDiffForUntracked(root, f.path);
          diffs.push(fd);
        } else {
          const text = await this._getDiffText(root, f.path);
          const parsed = this._parseUnifiedDiff(text);
          // filter for the file path
          const matched = parsed.filter((p) => p.filePath === f.path);
          if (matched.length) diffs.push(...matched);
        }
      } catch (e) {
        console.warn("failed diff for", f.path, e);
      }
    }

    // attach comments
    for (const df of diffs) {
      for (const h of df.hunks) {
        h.lines = h.lines || [];
        const c = this._comments.get(h.id) || [];
        // attach comments array for UI convenience
        (h as any).comments = c.slice();
        const s = this._suggestions.get(h.id);
        if (s) {
          (h as any).suggestion = {
            explanation: s.explanation,
            suggested_patch: s.suggested_patch,
            raw: s.raw,
            streaming: !!s.streaming,
          };
        } else {
          (h as any).suggestion = undefined;
        }
      }
    }

    this._panel.webview.postMessage({ type: "diffs", diffs });
    this._panel.webview.postMessage({ type: "diffState", state: "ready" });
  }

  private async _handleApply(
    filePath: string,
    hunkId: string,
    stage: boolean,
    reverse: boolean,
  ) {
    const root = await this._getRepoRoot();
    // recompute to find hunk
    const text = await this._getDiffText(root, filePath).catch(() => "");
    const parsed = this._parseUnifiedDiff(text);
    const file = parsed.find((p) => p.filePath === filePath);
    if (!file) {
      // maybe untracked
      const untracked = await this._buildDiffForUntracked(root, filePath);
      if (untracked && untracked.hunks.length) {
        const h = untracked.hunks.find((x) => x.id === hunkId);
        if (!h) throw new Error("Hunk not found");
        const patch = this._buildPatchForHunk(filePath, h);
        const res = await this._applyPatch(patch, root, stage, reverse);
        this._panel.webview.postMessage({
          type: "actionResult",
          success: res.success,
          error: res.error,
        });
        return;
      }
      throw new Error("File diff not found");
    }

    const h = file.hunks.find((x) => x.id === hunkId);
    if (!h) throw new Error("Hunk not found");

    const patch = this._buildPatchForHunk(filePath, h);
    const res = await this._applyPatch(patch, root, stage, reverse);
    this._panel.webview.postMessage({
      type: "actionResult",
      success: res.success,
      error: res.error,
    });
  }

  private _addComment(hunkId: string, text: string) {
    const arr = this._comments.get(hunkId) || [];
    arr.push({ text, when: Date.now() });
    this._comments.set(hunkId, arr);
  }

  private async _getRepoRoot(): Promise<string> {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) throw new Error("No workspace folder");
    return folders[0].uri.fsPath;
  }

  private async _listChangedFiles(
    root: string,
  ): Promise<Array<{ path: string; status: string }>> {
    try {
      const { stdout } = await execFile(
        "git",
        ["status", "--porcelain", "-z"],
        { cwd: root },
      );
      const out: Array<{ path: string; status: string }> = [];
      const parts = stdout.split("\0").filter(Boolean);
      for (const p of parts) {
        // format: XY <path>
        const status = p.slice(0, 2);
        let path = p.slice(3);
        // handle rename 'a -> b'
        const arrow = path.indexOf("->");
        if (arrow >= 0) {
          path = path.slice(arrow + 2).trim();
        }
        out.push({ path, status });
      }
      return out;
    } catch (e) {
      // no git or error
      return [];
    }
  }

  private async _getDiffText(root: string, filePath: string): Promise<string> {
    try {
      const args = [
        "diff",
        "--unified=3",
        "--no-color",
        "HEAD",
        "--",
        filePath,
      ];
      const { stdout } = await execFile("git", args, { cwd: root });
      return stdout.toString();
    } catch (e: any) {
      // fallback (no HEAD or other error)
      try {
        const { stdout } = await execFile(
          "git",
          ["diff", "--unified=3", "--no-color", "--", filePath],
          { cwd: root },
        );
        return stdout.toString();
      } catch (ee) {
        return "";
      }
    }
  }

  private async _buildDiffForUntracked(
    root: string,
    filePath: string,
  ): Promise<FileDiff> {
    // read file
    const abs = root + (filePath.startsWith("/") ? filePath : "/" + filePath);
    try {
      const buf = await fs.readFile(abs);
      const text = buf.toString();
      const lines = text.split(/\r?\n/);
      const hunk: Hunk = {
        id: `${filePath}:0`,
        header: "@ -0,0 +1," + Math.max(1, lines.length) + " @",
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: lines.length,
        lines: lines.map((l, i) => ({
          type: "add" as const,
          text: l,
          newLine: i + 1,
        })),
      };
      return { filePath, hunks: [hunk] };
    } catch (e) {
      return { filePath, hunks: [] };
    }
  }

  private _parseUnifiedDiff(diffText: string): FileDiff[] {
    const files: FileDiff[] = [];
    const lines = diffText.split(/\r?\n/);
    let i = 0;
    let currentFile: string | null = null;
    let hunks: Hunk[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("diff --git ")) {
        // flush previous
        if (currentFile && hunks.length)
          files.push({ filePath: currentFile, hunks });
        currentFile = null;
        hunks = [];
        i++;
        continue;
      }
      if (line.startsWith("+++ ")) {
        // +++ b/path
        const p = line.slice(4).replace(/^b\//, "");
        currentFile = p;
        i++;
        continue;
      }
      if (line.startsWith("@@ ")) {
        const m = line.match(
          /^@@ -(?<o>\d+)(?:,(?<oc>\d+))? \+(?<n>\d+)(?:,(?<nc>\d+))? @@/,
        );
        if (!m || !currentFile) {
          i++;
          continue;
        }
        const oldStart = parseInt((m.groups && m.groups.o) || "0", 10);
        const oldCount = parseInt((m.groups && m.groups.oc) || "1", 10);
        const newStart = parseInt((m.groups && m.groups.n) || "0", 10);
        const newCount = parseInt((m.groups && m.groups.nc) || "1", 10);
        const hunkLines: DiffLine[] = [];
        let oldLine = oldStart;
        let newLine = newStart;
        i++;
        while (
          i < lines.length &&
          !lines[i].startsWith("@@ ") &&
          !lines[i].startsWith("diff --git ") &&
          !lines[i].startsWith("+++ ")
        ) {
          const l = lines[i];
          if (l.startsWith("+")) {
            hunkLines.push({ type: "add", text: l.slice(1), newLine: newLine });
            newLine++;
          } else if (l.startsWith("-")) {
            hunkLines.push({ type: "del", text: l.slice(1), oldLine: oldLine });
            oldLine++;
          } else if (l.startsWith(" ")) {
            hunkLines.push({
              type: "context",
              text: l.slice(1),
              oldLine: oldLine,
              newLine: newLine,
            });
            oldLine++;
            newLine++;
          } else {
            // other metadata like \ No newline at end of file
            if (l.startsWith("\\ ")) {
              // ignore
            } else if (l.length === 0) {
              // empty line as context
              hunkLines.push({
                type: "context",
                text: "",
                oldLine: oldLine,
                newLine: newLine,
              });
              oldLine++;
              newLine++;
            }
          }
          i++;
        }
        const id = `${currentFile}:${hunks.length}`;
        hunks.push({
          id,
          header: line,
          oldStart,
          oldCount,
          newStart,
          newCount,
          lines: hunkLines,
        });
        continue;
      }
      i++;
    }
    if (currentFile && hunks.length)
      files.push({ filePath: currentFile, hunks });
    return files;
  }

  private _buildPatchForHunk(filePath: string, h: Hunk): string {
    const header = `diff --git a/${filePath} b/${filePath}\n`;
    const from = `--- a/${filePath}\n`;
    const to = `+++ b/${filePath}\n`;
    const hunkHeader = `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@\n`;
    let body = "";
    for (const ln of h.lines) {
      if (ln.type === "add") body += "+" + ln.text + "\n";
      else if (ln.type === "del") body += "-" + ln.text + "\n";
      else body += " " + ln.text + "\n";
    }
    return header + from + to + hunkHeader + body;
  }

  private async _applyPatch(
    patch: string,
    cwd: string,
    stage: boolean,
    reverse: boolean,
  ): Promise<{ success: boolean; error?: string }> {
    const args: string[] = ["apply", "--unidiff-zero", "-p0"];
    if (stage) args.splice(1, 0, "--cached");
    if (reverse) args.push("-R");

    const initialCtx: ToolContext = {
      toolId: "git.apply",
      command: "git",
      args: args.slice(),
      cwd,
      metadata: { stage, reverse },
      patch,
    };

    try {
      // Evaluate policy (denylist/risky rules) before running pre-hooks
      try {
        const policy = await evaluatePolicy(initialCtx);
        if (policy.decision === "deny") {
          const reason = policy.reason || "blocked by safety policy";
          await runPostToolHooks(initialCtx, { success: false, error: reason });
          return { success: false, error: reason };
        }
        if (policy.decision === "ask") {
          const cmdline =
            `${initialCtx.command} ${(initialCtx.args || []).join(" ")}`.trim();
          const toolKey = initialCtx.toolId || "git.apply";
          const hash = computeHash(cmdline, toolKey);
          const key = `${toolKey}::${hash}`;
          if (
            !isAutoAllowed(cmdline, toolKey) &&
            !sessionAlwaysAllow.has(key)
          ) {
            const decision = await confirmAction(
              cmdline,
              policy.askPayload as any,
            );
            if (decision === "deny") {
              const reason = "denied by user";
              await runPostToolHooks(initialCtx, {
                success: false,
                error: reason,
              });
              return { success: false, error: reason };
            }
            if (decision === "always_workspace") {
              sessionAlwaysAllow.add(key);
              try {
                await persistAllow(
                  cmdline,
                  toolKey,
                  "workspace",
                  policy.askPayload as any,
                );
              } catch (_) {}
            } else if (decision === "always_global") {
              sessionAlwaysAllow.add(key);
              try {
                await persistAllow(
                  cmdline,
                  toolKey,
                  "global",
                  policy.askPayload as any,
                );
              } catch (_) {}
            }
          }
        }
      } catch (e) {
        console.warn("policy evaluation error", e);
      }

      const pre = await runPreToolHooks(initialCtx);
      if (!pre.allowed) {
        if (pre.ask) {
          const cmdline =
            `${pre.ctx.command} ${(pre.ctx.args || []).join(" ")}`.trim();
          const toolKey = pre.ctx.toolId || "git.apply";
          const hash = computeHash(cmdline, toolKey);
          const key = `${toolKey}::${hash}`;
          if (
            !isAutoAllowed(cmdline, toolKey) &&
            !sessionAlwaysAllow.has(key)
          ) {
            const decision = await confirmAction(cmdline, pre.ask);
            if (decision === "deny") {
              const reason = "denied by user";
              await runPostToolHooks(pre.ctx, {
                success: false,
                error: reason,
              });
              return { success: false, error: reason };
            }
            if (decision === "always_workspace") {
              sessionAlwaysAllow.add(key);
              try {
                await persistAllow(cmdline, toolKey, "workspace", pre.ask);
              } catch (_) {}
            } else if (decision === "always_global") {
              sessionAlwaysAllow.add(key);
              try {
                await persistAllow(cmdline, toolKey, "global", pre.ask);
              } catch (_) {}
            }
            // approved -> continue
          }
        } else {
          // notify post hooks that the run was blocked
          await runPostToolHooks(pre.ctx, {
            success: false,
            error: pre.reason || "blocked by pre-hook",
          });
          return { success: false, error: pre.reason || "blocked by pre-hook" };
        }
      }

      const ctx = pre.ctx;
      const spawnArgs = (ctx.args || []).concat(["-"]);

      return await new Promise((resolve) => {
        const child = spawnProc(ctx.command || "git", spawnArgs, {
          cwd: ctx.cwd,
        });
        let stderr = "";
        let stdout = "";
        try {
          child.stdin.write(ctx.patch ?? patch);
          child.stdin.end();
        } catch (e) {
          // ignore
        }
        child.on("error", async (err) => {
          const result = { success: false, error: String(err) };
          try {
            await runPostToolHooks(ctx, result);
          } catch (e) {}
          resolve(result);
        });
        if (child.stdout)
          child.stdout.on("data", (d) => (stdout += d.toString()));
        if (child.stderr)
          child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("close", async (code) => {
          const result: any = {};
          if (code === 0) {
            result.success = true;
            result.exitCode = code;
            result.stdout = stdout;
            result.stderr = stderr;
          } else {
            result.success = false;
            result.exitCode = code;
            result.stdout = stdout;
            result.stderr = stderr;
            result.error = stderr || `git apply exited ${code}`;
          }
          try {
            await runPostToolHooks(ctx, result);
          } catch (e) {
            // swallow post-hook errors
            console.warn("post-hook failed", e);
          }
          resolve({ success: result.success, error: result.error });
        });
      });
    } catch (e: any) {
      const err = String(e && e.message ? e.message : e);
      try {
        await runPostToolHooks(initialCtx, { success: false, error: err });
      } catch (ee) {}
      return { success: false, error: err };
    }
  }

  private _validateSuggestedPatch(
    filePath: string,
    h: Hunk,
    patch: string,
  ): { valid: boolean; error?: string } {
    if (!patch || patch.trim().length === 0) return { valid: true };

    // Collect referenced file paths in the patch (from ---/+++ or diff --git)
    const filePaths = new Set<string>();
    const fromMatch = patch.match(/^---\s+(?:a\/|b\/)?(.+)$/m);
    const toMatch = patch.match(/^\+\+\+\s+(?:a\/|b\/)?(.+)$/m);
    if (fromMatch && fromMatch[1])
      filePaths.add(fromMatch[1].replace(/\\\\/g, "/"));
    if (toMatch && toMatch[1]) filePaths.add(toMatch[1].replace(/\\\\/g, "/"));

    const diffGitRe = /^diff --git a\/(.+?) b\/(.+?)$/gm;
    let dg: RegExpExecArray | null;
    while ((dg = diffGitRe.exec(patch)) !== null) {
      if (dg[1]) filePaths.add(dg[1].replace(/\\\\/g, "/"));
      if (dg[2]) filePaths.add(dg[2].replace(/\\\\/g, "/"));
    }

    const normalize = (p: string) =>
      p
        .replace(/^\.?\/?/, "")
        .replace(/\\\\/g, "/")
        .replace(/^a\//, "")
        .replace(/^b\//, "");
    const target = normalize(filePath);
    if (filePaths.size > 0) {
      for (const p of filePaths) {
        const np = normalize(p);
        if (
          !(
            np === target ||
            np.endsWith("/" + target) ||
            target.endsWith("/" + np)
          )
        ) {
          return {
            valid: false,
            error: `Patch targets file '${p}', which does not match expected '${filePath}'`,
          };
        }
      }
    }

    // Parse hunk headers and ensure they are within the original hunk bounds
    const hunkRe = /@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/g;
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = hunkRe.exec(patch)) !== null) {
      found = true;
      const oldStart = parseInt(m[1], 10);
      const oldCount = m[2] ? parseInt(m[2], 10) : 1;
      if (h.oldCount === 0) {
        // Untracked file hunk — be permissive about additions
        continue;
      }
      if (
        oldStart < h.oldStart ||
        oldStart + oldCount > h.oldStart + h.oldCount
      ) {
        return {
          valid: false,
          error: `Patch hunk -${oldStart},${oldCount} lies outside target hunk -${h.oldStart},${h.oldCount}`,
        };
      }
    }

    if (!found) {
      return {
        valid: false,
        error:
          "Patch contains no hunk headers (@@ ... @@); cannot safely validate",
      };
    }

    return { valid: true };
  }

  private async _suggestHunk(
    filePath: string,
    hunkId: string,
    instruction: string,
  ) {
    const root = await this._getRepoRoot();
    // find hunk
    const text = await this._getDiffText(root, filePath).catch(() => "");
    let parsed = this._parseUnifiedDiff(text);
    let file = parsed.find((p) => p.filePath === filePath);
    let h: Hunk | undefined = file
      ? file.hunks.find((x) => x.id === hunkId)
      : undefined;
    if (!h) {
      const untracked = await this._buildDiffForUntracked(root, filePath);
      h = untracked.hunks.find((x) => x.id === hunkId);
    }
    if (!h) throw new Error("Hunk not found");

    const patch = this._buildPatchForHunk(filePath, h);

    // read file content for context
    let fileContent = "";
    try {
      const abs = root + (filePath.startsWith("/") ? filePath : "/" + filePath);
      const buf = await fs.readFile(abs);
      fileContent = buf.toString();
    } catch (e) {
      fileContent = "";
    }

    // prepare context snippet (limit lines)
    const lines = fileContent.split(/\r?\n/);
    const before = Math.max(0, (h.newStart || 1) - 6);
    const after = Math.min(lines.length, (h.newStart || 1) + 6);
    const contextSnippet = lines.slice(before, after).join("\n");

    const prompt = `You are an expert code assistant. Output ONLY valid JSON with two fields: "explanation" (string) and "suggested_patch" (string). The "suggested_patch" must be a unified diff patch (git diff format) that applies ONLY to the provided hunk in file ${filePath}. Do NOT modify other files or hunks. If no change is needed, set "suggested_patch" to an empty string.

User instruction: ${instruction}

Original hunk patch:
${patch}

File context (around hunk):
${contextSnippet}

Return JSON only.`;

    // create provider
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const providerFactory = require("../providers/providerFactory");
    const provider: any = providerFactory.createProviderFromPulseConfig();

    const entry: SuggestionEntry = {
      raw: "",
      streaming: true,
      controller: undefined,
    };
    this._suggestions.set(h.id, entry);

    try {
      const controller = provider.streamCompletion(prompt, undefined, {
        onToken: (t: string) => {
          entry.raw += String(t);
          this._panel.webview.postMessage({
            type: "suggestStream",
            hunkId: h!.id,
            token: t,
          });
        },
        onEnd: () => {
          entry.streaming = false;
          // try to parse JSON from entry.raw
          let parsedJson: any = null;
          const rawText = entry.raw || "";
          try {
            parsedJson = JSON.parse(rawText.trim());
          } catch (e) {
            // try to extract last JSON object
            const idx = rawText.lastIndexOf("{");
            if (idx >= 0) {
              const last = rawText.substring(idx);
              try {
                parsedJson = JSON.parse(last);
              } catch (e2) {
                parsedJson = null;
              }
            } else {
              parsedJson = null;
            }
          }

          if (
            parsedJson &&
            (parsedJson.suggested_patch || parsedJson.explanation)
          ) {
            entry.suggested_patch = parsedJson.suggested_patch || "";
            entry.explanation = parsedJson.explanation || "";
          } else {
            // fallback: treat whole output as suggested_patch
            entry.suggested_patch = entry.raw;
            entry.explanation = "";
          }

          this._panel.webview.postMessage({
            type: "suggestComplete",
            hunkId: h!.id,
            suggestion: {
              explanation: entry.explanation,
              suggested_patch: entry.suggested_patch,
              raw: entry.raw,
            },
          });
        },
        onError: (err: any) => {
          entry.streaming = false;
          this._panel.webview.postMessage({
            type: "suggestError",
            hunkId: h!.id,
            error: String(err && err.message ? err.message : err),
          });
        },
      });

      entry.controller = controller;
      this._suggestions.set(h.id, entry);
    } catch (e: any) {
      entry.streaming = false;
      this._panel.webview.postMessage({
        type: "suggestError",
        hunkId: h.id,
        error: String(e && e.message ? e.message : e),
      });
    }
  }

  private async _applySuggestion(
    filePath: string,
    hunkId: string,
    stage: boolean,
  ) {
    const entry = this._suggestions.get(hunkId);
    if (!entry || !(entry.suggested_patch || entry.raw)) {
      this._panel.webview.postMessage({
        type: "actionResult",
        success: false,
        error: "No suggestion available",
      });
      return;
    }
    const patch = entry.suggested_patch || entry.raw || "";

    const root = await this._getRepoRoot();
    // locate the hunk for validation
    const text = await this._getDiffText(root, filePath).catch(() => "");
    let parsed = this._parseUnifiedDiff(text);
    let file = parsed.find((p) => p.filePath === filePath);
    let h: Hunk | undefined = file
      ? file.hunks.find((x) => x.id === hunkId)
      : undefined;
    if (!h) {
      const untracked = await this._buildDiffForUntracked(root, filePath);
      h = untracked.hunks.find((x) => x.id === hunkId);
    }
    if (!h) {
      this._panel.webview.postMessage({
        type: "actionResult",
        success: false,
        error: "Hunk not found for validation",
      });
      return;
    }

    const validation = this._validateSuggestedPatch(filePath, h, patch);
    if (!validation.valid) {
      this._panel.webview.postMessage({
        type: "actionResult",
        success: false,
        error: `Suggested patch validation failed: ${validation.error}`,
      });
      return;
    }

    const res = await this._applyPatch(patch, root, stage, false);
    this._panel.webview.postMessage({
      type: "actionResult",
      success: res.success,
      error: res.error,
    });
  }

  private async _copySuggestion(_filePath: string, hunkId: string) {
    const entry = this._suggestions.get(hunkId);
    if (!entry || !(entry.suggested_patch || entry.raw)) {
      this._panel.webview.postMessage({
        type: "actionResult",
        success: false,
        error: "No suggestion to copy",
      });
      return;
    }
    const text = entry.suggested_patch || entry.raw || "";
    await vscode.env.clipboard.writeText(text);
    this._panel.webview.postMessage({ type: "actionResult", success: true });
  }

  private _cancelSuggestion(hunkId: string) {
    const entry = this._suggestions.get(hunkId);
    if (entry && entry.controller && entry.streaming) {
      try {
        entry.controller.cancel();
      } catch (e) {}
      entry.streaming = false;
      entry.controller = undefined;
      this._panel.webview.postMessage({ type: "suggestCancelled", hunkId });
    }
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++)
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

export default DiffReviewPanel;

// Test helper: call internal _applyPatch logic directly (no instance required)
export async function applyPatchForTest(
  patch: string,
  cwd: string,
  stage: boolean,
  reverse: boolean,
): Promise<{ success: boolean; error?: string }> {
  // _applyPatch does not use `this`, so call it directly from the prototype.
  // @ts-ignore
  return await (DiffReviewPanel.prototype as any)._applyPatch.call(
    null,
    patch,
    cwd,
    stage,
    reverse,
  );
}
