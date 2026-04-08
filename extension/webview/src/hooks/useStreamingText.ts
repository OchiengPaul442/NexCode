import { useEffect, useRef, useState } from "react";
import { drainTextQueue, planTextReveal } from "../streamOrchestrator";

export interface UseStreamingTextOptions {
  text: string;
  streaming: boolean;
  charsPerFrame?: number;
  onFrame?: () => void;
}

export interface UseStreamingTextResult {
  displayedText: string;
  isStreaming: boolean;
  isThinking: boolean;
}

export function useStreamingText({
  text,
  streaming,
  charsPerFrame = 2,
  onFrame,
}: UseStreamingTextOptions): UseStreamingTextResult {
  const [displayedText, setDisplayedText] = useState(text);
  const displayedTextRef = useRef(text);
  const sourceTextRef = useRef(text);
  const queueRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const streamingRef = useRef(streaming);
  const onFrameRef = useRef(onFrame);
  const charsPerFrameRef = useRef(charsPerFrame);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    charsPerFrameRef.current = charsPerFrame;
  }, [charsPerFrame]);

  const scheduleTick = () => {
    if (rafRef.current !== null) {
      return;
    }

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;

      if (queueRef.current.length === 0) {
        return;
      }

      const chunk = drainTextQueue(queueRef.current, charsPerFrameRef.current);
      if (chunk.length === 0) {
        return;
      }

      displayedTextRef.current += chunk;
      setDisplayedText(displayedTextRef.current);
      onFrameRef.current?.();

      if (queueRef.current.length > 0) {
        scheduleTick();
      }
    });
  };

  useEffect(() => {
    const nextText = text ?? "";
    const previousText = sourceTextRef.current;
    sourceTextRef.current = nextText;

    const plan = planTextReveal(previousText, nextText);
    if (plan.reset) {
      displayedTextRef.current = streaming ? "" : nextText;
      setDisplayedText(displayedTextRef.current);
      queueRef.current = plan.queue;
    } else if (plan.queue.length > 0) {
      queueRef.current.push(...plan.queue);
    } else if (!streaming) {
      displayedTextRef.current = nextText;
      setDisplayedText(nextText);
    }

    if (streaming || queueRef.current.length > 0) {
      scheduleTick();
    }

    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [text, streaming]);

  const isThinking = streaming && displayedText.trim().length === 0;
  const isStreaming = streaming || displayedText !== sourceTextRef.current;

  return {
    displayedText,
    isStreaming,
    isThinking,
  };
}
