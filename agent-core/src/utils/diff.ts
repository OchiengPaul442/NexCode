// diff-match-patch does not ship stable TypeScript definitions across versions.
// We use a narrow typed wrapper to keep the rest of the code strongly typed.
const DiffMatchPatch: any = require("diff-match-patch");

export function createPatch(oldText: string, newText: string): string {
  const dmp = new DiffMatchPatch();
  const patches = dmp.patch_make(oldText, newText);
  return dmp.patch_toText(patches);
}
