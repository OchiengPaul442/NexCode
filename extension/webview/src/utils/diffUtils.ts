import { diffLines, type Change } from "diff";

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "del" | "ctx";
  oldNum: number | null;
  newNum: number | null;
  content: string;
}

export function computeGitDiff(oldText: string, newText: string): DiffHunk[] {
  const changes: Change[] = diffLines(oldText, newText);
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 1;
  let newLine = 1;

  for (const change of changes) {
    const lines = change.value.split("\n").filter((_, i, arr) =>
      i < arr.length - 1 || arr[i] !== "",
    );

    for (const line of lines) {
      if (change.added) {
        if (!currentHunk) {
          currentHunk = { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, lines: [] };
          hunks.push(currentHunk);
        }
        currentHunk.lines.push({ type: "add", oldNum: null, newNum: newLine++, content: line });
        currentHunk.newLines++;
      } else if (change.removed) {
        if (!currentHunk) {
          currentHunk = { oldStart: oldLine, oldLines: 0, newStart: newLine, newLines: 0, lines: [] };
          hunks.push(currentHunk);
        }
        currentHunk.lines.push({ type: "del", oldNum: oldLine++, newNum: null, content: line });
        currentHunk.oldLines++;
      } else {
        if (currentHunk) currentHunk = null;
        oldLine++;
        newLine++;
      }
    }
  }

  // Merge nearby hunks (within 3 lines)
  if (hunks.length <= 1) return hunks;
  const merged: DiffHunk[] = [hunks[0]];
  for (let i = 1; i < hunks.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = hunks[i];
    const gap = curr.oldStart - (prev.oldStart + prev.oldLines);
    if (gap <= 6) {
      prev.oldLines = (curr.oldStart + curr.oldLines) - prev.oldStart;
      prev.newLines = (curr.newStart + curr.newLines) - prev.newStart;
      prev.lines.push(...curr.lines);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

// Collapsed context: show only N lines of context around changes
export function collapseDiffContext(lines: DiffLine[], contextSize = 3): DiffLine[] {
  if (lines.length <= contextSize * 2 + 4) return lines;

  const changeIndices = new Set<number>();
  lines.forEach((l, i) => {
    if (l.type !== "ctx") {
      for (let k = Math.max(0, i - contextSize); k <= Math.min(lines.length - 1, i + contextSize); k++) {
        changeIndices.add(k);
      }
    }
  });

  const result: DiffLine[] = [];
  let lastIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (changeIndices.has(i)) {
      if (lastIdx >= 0 && i - lastIdx > 1) {
        const hiddenCount = i - lastIdx - 1;
        result.push({ type: "ctx", oldNum: null, newNum: null, content: `${hiddenCount} unmodified line${hiddenCount !== 1 ? "s" : ""}` });
      }
      result.push(lines[i]);
      lastIdx = i;
    }
  }

  return result;
}
