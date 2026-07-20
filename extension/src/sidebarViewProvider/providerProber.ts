import { type ProviderId } from "@nexcode/agent-core";
import {
  validateProviderUrl,
  getRuntimeSettings,
  getRawApiKeys,
} from "./runtimeSettings";
import { type SecretService } from "../secretService";

export type PostMessageFn = (message: unknown) => void;
export type CanProbeProviderEndpointFn = (isCustomUrl: boolean) => boolean;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshProviderStatus(
  secretService: SecretService,
  postMessage: PostMessageFn,
  canProbeProviderEndpoint: CanProbeProviderEndpointFn,
  providerOverride?: ProviderId,
): Promise<void> {
  const settings = await getRuntimeSettings(secretService);
  const provider = providerOverride ?? settings.provider;
  const startedAt = Date.now();

  try {
    if (provider === "ollama") {
      const response = await fetchWithTimeout(
        `${settings.ollamaBaseUrl.replace(/\/$/, "")}/api/tags`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        4000,
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } else {
      // NC-002: Validate the provider URL before sending credentials.
      // Reject non-HTTPS, private-IP, and malformed URLs.
      const defaultBaseUrl = "https://opencode.ai/zen/go/v1";
      const validatedBaseUrl = validateProviderUrl(
        settings.openAIBaseUrl,
      );

      // NC-002: In untrusted workspaces, block probing to custom endpoints.
      const isCustomUrl = validatedBaseUrl !== defaultBaseUrl;
      if (!canProbeProviderEndpoint(isCustomUrl)) {
        postMessage({
          type: "providerStatus",
          value: {
            provider,
            connected: false,
            latencyMs: Date.now() - startedAt,
            error: "Custom provider endpoints are blocked in untrusted workspaces.",
          },
        });
        return;
      }

      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      const rawKeys = await getRawApiKeys(secretService);
      if (rawKeys.openAIApiKey.trim()) {
        headers.Authorization = `Bearer ${rawKeys.openAIApiKey.trim()}`;
      }

      const response = await fetchWithTimeout(
        `${validatedBaseUrl}/models`,
        {
          method: "GET",
          headers,
        },
        5000,
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    }

    postMessage({
      type: "providerStatus",
      value: {
        provider,
        connected: true,
        latencyMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    postMessage({
      type: "providerStatus",
      value: {
        provider,
        connected: false,
        latencyMs: Date.now() - startedAt,
        error: String(error),
      },
    });
  }
}

export async function provideModelSuggestions(
  secretService: SecretService,
  postMessage: PostMessageFn,
  canProbeProviderEndpoint: CanProbeProviderEndpointFn,
  providerOverride?: ProviderId,
): Promise<void> {
  const settings = await getRuntimeSettings(secretService);
  const provider = providerOverride ?? settings.provider;

  try {
    let models: string[] = [];

    if (provider === "ollama") {
      const response = await fetchWithTimeout(
        `${settings.ollamaBaseUrl.replace(/\/$/, "")}/api/tags`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        },
        5000,
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        models?: Array<{ name?: string }>;
      };

      models = (payload.models ?? [])
        .map((model) => (typeof model.name === "string" ? model.name : ""))
        .filter((name) => name.length > 0);
    } else {
      // NC-002: Validate the provider URL before sending credentials.
      const defaultBaseUrl = "https://opencode.ai/zen/go/v1";
      const validatedBaseUrl = validateProviderUrl(
        settings.openAIBaseUrl,
      );

      // NC-002: In untrusted workspaces, block probing to custom endpoints.
      const isCustomUrl = validatedBaseUrl !== defaultBaseUrl;
      if (!canProbeProviderEndpoint(isCustomUrl)) {
        postMessage({
          type: "modelSuggestions",
          provider,
          models: [],
        });
        return;
      }

      const headers: Record<string, string> = {
        Accept: "application/json",
      };

      const rawKeys = await getRawApiKeys(secretService);
      if (rawKeys.openAIApiKey.trim()) {
        headers.Authorization = `Bearer ${rawKeys.openAIApiKey.trim()}`;
      }

      const response = await fetchWithTimeout(
        `${validatedBaseUrl}/models`,
        {
          method: "GET",
          headers,
        },
        6000,
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        data?: Array<{ id?: string }>;
      };

      models = (payload.data ?? [])
        .map((model) => (typeof model.id === "string" ? model.id : ""))
        .filter((id) => id.length > 0);
    }

    const uniqueModels = [...new Set(models)].slice(0, 40);
    postMessage({
      type: "modelSuggestions",
      provider,
      models: uniqueModels,
    });
  } catch {
    postMessage({
      type: "modelSuggestions",
      provider,
      models: [],
    });
  }
}
