export type DiffOp = {
  type: "equal" | "insert" | "delete";
  a?: string;
  b?: string;
};

export function computeLineDiff(a: string, b: string): DiffOp[] {
  const aLines = String(a || "").split(/\n/);
  const bLines = String(b || "").split(/\n/);
  const n = aLines.length,
    m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ type: "equal", a: aLines[i], b: bLines[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", a: aLines[i] });
      i++;
    } else {
      ops.push({ type: "insert", b: bLines[j] });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "delete", a: aLines[i++] });
  }
  while (j < m) {
    ops.push({ type: "insert", b: bLines[j++] });
  }
  return ops;
}

export function renderUnifiedDiffHtml(
  before: string,
  after: string,
  escapeHtml?: (s: string) => string,
) {
  if (!escapeHtml) {
    escapeHtml = function (s: string) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    };
  }
  const ops = computeLineDiff(before, after);
  const beforeLines: Array<{ text: string; cls: string }> = [];
  const afterLines: Array<{ text: string; cls: string }> = [];
  for (const op of ops) {
    if (op.type === "equal") {
      beforeLines.push({ text: op.a ?? "", cls: "unchanged" });
      afterLines.push({ text: op.b ?? "", cls: "unchanged" });
    } else if (op.type === "delete") {
      beforeLines.push({ text: "- " + (op.a ?? ""), cls: "del" });
      afterLines.push({ text: "", cls: "unchanged" });
    } else if (op.type === "insert") {
      beforeLines.push({ text: "", cls: "unchanged" });
      afterLines.push({ text: "+ " + (op.b ?? ""), cls: "add" });
    }
  }

  const render = (arr: Array<{ text: string; cls: string }>) =>
    arr
      .map((l) => {
        if (!l.text) return '<div class="diff-line unchanged">&nbsp;</div>';
        const cls =
          l.cls === "add"
            ? "diff-line add"
            : l.cls === "del"
              ? "diff-line del"
              : "diff-line unchanged";
        return '<div class="' + cls + '">' + escapeHtml!(l.text) + "</div>";
      })
      .join("");

  return { beforeHtml: render(beforeLines), afterHtml: render(afterLines) };
}

// Token-level diff for inline highlighting
export function computeTokenDiff(a: string, b: string): DiffOp[] {
  function tokenize(s: string) {
    if (!s) return [] as string[];
    // Tokenize into words, punctuation, and whitespace tokens.
    // This preserves whitespace while separating punctuation from words.
    // Examples: "hello, world!" -> ["hello", ",", " ", "world", "!"]
    const tokens =
      String(s).match(/(\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]+)/g) || [];
    return tokens;
  }

  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  const n = aTokens.length,
    m = bTokens.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aTokens[i] === bTokens[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (aTokens[i] === bTokens[j]) {
      ops.push({ type: "equal", a: aTokens[i], b: bTokens[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "delete", a: aTokens[i] });
      i++;
    } else {
      ops.push({ type: "insert", b: bTokens[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "delete", a: aTokens[i++] });
  while (j < m) ops.push({ type: "insert", b: bTokens[j++] });
  return ops;
}

export function renderInlineUnifiedDiffHtml(
  before: string,
  after: string,
  escapeHtml?: (s: string) => string,
) {
  if (!escapeHtml) {
    escapeHtml = function (s: string) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    };
  }

  const ops = computeLineDiff(before, after);
  const beforeParts: string[] = [];
  const afterParts: string[] = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.type === "equal") {
      beforeParts.push(escapeHtml(op.a ?? ""));
      afterParts.push(escapeHtml(op.b ?? ""));
    } else if (
      op.type === "delete" &&
      k + 1 < ops.length &&
      ops[k + 1].type === "insert"
    ) {
      // pair delete+insert -> compute token diff
      const del = op.a ?? "";
      const ins = ops[k + 1].b ?? "";
      const tokenOps = computeTokenDiff(del, ins);
      let beforeLine = "";
      let afterLine = "";
      for (const t of tokenOps) {
        if (t.type === "equal") {
          beforeLine += escapeHtml(t.a ?? "");
          afterLine += escapeHtml(t.b ?? "");
        } else if (t.type === "delete") {
          beforeLine +=
            '<span class="inline-del">- ' + escapeHtml(t.a ?? "") + "</span>";
        } else if (t.type === "insert") {
          afterLine +=
            '<span class="inline-add">+ ' + escapeHtml(t.b ?? "") + "</span>";
        }
      }
      beforeParts.push(beforeLine);
      afterParts.push(afterLine);
      k++; // skip paired insert
    } else if (op.type === "delete") {
      beforeParts.push(
        '<span class="inline-del">- ' + escapeHtml(op.a ?? "") + "</span>",
      );
      afterParts.push("");
    } else if (op.type === "insert") {
      beforeParts.push("");
      afterParts.push(
        '<span class="inline-add">+ ' + escapeHtml(op.b ?? "") + "</span>",
      );
    }
  }

  // wrap each part in line divs and assign a class based on presence
  const beforeHtml = beforeParts
    .map((t) => {
      const cls = t.includes("inline-add")
        ? "diff-line add"
        : t.includes("inline-del")
          ? "diff-line del"
          : "diff-line unchanged";
      return '<div class="' + cls + '">' + t + "</div>";
    })
    .join("");

  const afterHtml = afterParts
    .map((t) => {
      const cls = t.includes("inline-add")
        ? "diff-line add"
        : t.includes("inline-del")
          ? "diff-line del"
          : "diff-line unchanged";
      return '<div class="' + cls + '">' + t + "</div>";
    })
    .join("");

  return { beforeHtml, afterHtml };
}
