export type StreamCallbacks = {
  onStart?: () => void;
  onConnected?: () => void;
  onToken?: (token: string) => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
};

export type StreamController = {
  cancel: () => void;
};

export interface Provider {
  streamCompletion(
    prompt: string,
    model?: string | undefined,
    callbacks?: StreamCallbacks,
  ): StreamController;
}

export default Provider;
