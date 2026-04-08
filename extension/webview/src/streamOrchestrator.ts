export interface TextRevealPlan {
  queue: string[];
  reset: boolean;
}

export function planTextReveal(
  previousText: string,
  nextText: string,
): TextRevealPlan {
  if (nextText === previousText) {
    return {
      queue: [],
      reset: false,
    };
  }

  if (nextText.startsWith(previousText)) {
    return {
      queue: Array.from(nextText.slice(previousText.length)),
      reset: false,
    };
  }

  return {
    queue: Array.from(nextText),
    reset: true,
  };
}

export function drainTextQueue(queue: string[], maxChars: number): string {
  if (queue.length === 0) {
    return "";
  }

  const chunkSize = Math.max(1, Math.min(maxChars, queue.length));
  return queue.splice(0, chunkSize).join("");
}
