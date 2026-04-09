export function chunkText(input: string, size = 24): string[] {
  if (!input) {
    return [];
  }

  const chunks: string[] = [];
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size));
  }
  return chunks;
}

export function extractFirstCodeBlock(markdown: string): string | null {
  const match = markdown.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/);
  if (!match) {
    return null;
  }
  return match[1].trimEnd();
}

export function scoreKeywordOverlap(a: string, b: string): number {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));

  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / aTokens.size;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}
