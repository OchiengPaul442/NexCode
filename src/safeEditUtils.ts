export type ReplacementPatch = {
  start: number;
  endExclusive: number;
  newText: string;
};

/**
 * Compute a simple replacement patch that transforms oldText into newText.
 * This returns the minimal contiguous replacement region (start..endExclusive)
 * and the replacement text. Returns null if texts are identical.
 */
export function computeReplacementPatch(
  oldText: string,
  newText: string,
): ReplacementPatch | null {
  if (oldText === newText) return null;
  const oldLen = oldText.length;
  const newLen = newText.length;
  let start = 0;
  while (
    start < oldLen &&
    start < newLen &&
    oldText[start] === newText[start]
  ) {
    start++;
  }

  let endOld = oldLen - 1;
  let endNew = newLen - 1;
  while (
    endOld >= start &&
    endNew >= start &&
    oldText[endOld] === newText[endNew]
  ) {
    endOld--;
    endNew--;
  }

  const replacement = newText.substring(start, endNew + 1);
  return { start, endExclusive: endOld + 1, newText: replacement };
}

export function applyReplacementPatch(
  oldText: string,
  patch: ReplacementPatch | null,
): string {
  if (!patch) return oldText;
  return (
    oldText.substring(0, patch.start) +
    patch.newText +
    oldText.substring(patch.endExclusive)
  );
}

export default { computeReplacementPatch, applyReplacementPatch };

export function offsetToPosition(text: string, offset: number) {
  if (offset < 0) offset = 0;
  if (offset > text.length) offset = text.length;
  let line = 0;
  let char = 0;
  for (let i = 0; i < offset; i++) {
    const ch = text[i];
    if (ch === "\n") {
      line++;
      char = 0;
    } else {
      char++;
    }
  }
  return { line, character: char };
}

export function patchOffsetsToRange(text: string, patch: ReplacementPatch) {
  return {
    start: offsetToPosition(text, patch.start),
    end: offsetToPosition(text, patch.endExclusive),
  };
}
