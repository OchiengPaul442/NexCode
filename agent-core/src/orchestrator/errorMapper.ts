export function formatUserFacingError(error: unknown): string {
  const raw = String(error ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) {
    return "Request failed due to an unknown error.";
  }

  const normalized = raw.toLowerCase();

  if (normalized.includes("timeout")) {
    return "The model request timed out. Try a smaller prompt or switch to a faster model.";
  }

  if (
    normalized.includes("invalid_request_error") ||
    normalized.includes("400")
  ) {
    return "The model could not process this request. Try a different model or simplify your prompt.";
  }

  if (
    normalized.includes("401") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid api key")
  ) {
    return "Authentication failed. Check your API key in settings.";
  }

  if (normalized.includes("429") || normalized.includes("rate limit")) {
    return "Rate limit reached. Please wait a moment and try again.";
  }

  if (
    normalized.includes("all stream attempts failed") ||
    normalized.includes("all provider/model attempts failed")
  ) {
    if (normalized.includes("ollama") && normalized.includes("econnrefused")) {
      return "Ollama is not running. Start it with: `ollama serve`. Or switch to OpenCode Go in settings (nexcodeKiboko.defaultProvider = openai-compatible).";
    }
    if (normalized.includes("ollama") && normalized.includes("model")) {
      return "Ollama model not found. Pull it with: `ollama pull <model-name>`. Check available models with: `ollama list`.";
    }
    if (normalized.includes("opencode") || normalized.includes("openai-compatible")) {
      return "OpenCode Go API failed. Check your API key in settings (nexcodeKiboko.openAIApiKey) and ensure the model is valid (e.g., deepseek-v4-flash, mimo-v2.5).";
    }
    if (normalized.includes("upstream request failed")) {
      return "Provider upstream request failed. For Ollama: ensure it's running. For OpenCode Go: check your API key and model name in settings.";
    }
    return "All configured provider attempts failed. For Ollama: ensure it's running (`ollama serve`). For OpenCode Go: set a valid API key in settings.";
  }

  if (
    normalized.includes("fetch failed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("enotfound")
  ) {
    if (normalized.includes("ollama") || normalized.includes("11434")) {
      return "Cannot reach Ollama. Start it with: `ollama serve`. Then pull your model: `ollama pull <model-name>`.";
    }
    return "Could not reach the model provider endpoint. Check network access and base URL settings.";
  }

  if (normalized.includes("abort")) {
    return "Request was cancelled.";
  }

  return raw.length > 300 ? `${raw.slice(0, 300)}...` : raw;
}
