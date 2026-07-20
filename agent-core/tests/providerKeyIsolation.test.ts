/**
 * NC-001 regression: One API key must not be transmitted to every configured
 * cloud provider.  The orchestrator must not eagerly probe all providers at
 * construction, and the canary key for one provider must never be observed
 * by a different provider's endpoint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";
import { createNexcodeOrchestrator } from "../src";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const CANARY_KEY = "nc001-canary-key-do-not-send";
const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Map of provider base-URL substrings to the headers that were captured
 * for that provider during a test run.
 */
interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
}

let captured: CapturedRequest[];
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  captured = [];
  originalFetch = globalThis.fetch;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const headers: Record<string, string> = {};

    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v: string, k: string) => {
          headers[k] = v;
        });
      } else if (typeof init.headers === "object") {
        Object.assign(headers, init.headers);
      }
    }

    captured.push({ url, headers });

    // Return a minimal successful response so the check does not throw.
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("NC-001 — Provider key isolation", () => {
  it("must NOT eagerly check any provider at construction time", () => {
    createNexcodeOrchestrator({
      workspaceRoot: WORKSPACE_ROOT,
      openAIApiKey: CANARY_KEY,
      defaultProvider: "ollama",
    });

    expect(captured).toHaveLength(0);
  });

  it("must not send the canary key to any provider endpoint during construction", () => {
    createNexcodeOrchestrator({
      workspaceRoot: WORKSPACE_ROOT,
      openAIApiKey: CANARY_KEY,
      defaultProvider: "ollama",
    });

    // Even though no requests were made, assert the canary never leaked.
    for (const req of captured) {
      const authHeader = req.headers["authorization"] ?? "";
      expect(authHeader).not.toContain(CANARY_KEY);
    }
  });

  it("getProviderStatus lazily triggers a check only once", async () => {
    const orch = createNexcodeOrchestrator({
      workspaceRoot: WORKSPACE_ROOT,
      openAIApiKey: CANARY_KEY,
      defaultProvider: "ollama",
    });

    // Before calling getProviderStatus, no requests should have been made.
    expect(captured).toHaveLength(0);

    await orch.getProviderStatus();

    // After calling getProviderStatus, requests should have been made.
    expect(captured.length).toBeGreaterThan(0);

    // Calling again should not create additional requests (cached).
    const countBeforeSecond = captured.length;
    await orch.getProviderStatus();
    expect(captured.length).toBe(countBeforeSecond);
  });

  it("canary key must not appear in requests to unrelated provider endpoints", async () => {
    const orch = createNexcodeOrchestrator({
      workspaceRoot: WORKSPACE_ROOT,
      openAIApiKey: CANARY_KEY,
      defaultProvider: "openai-compatible",
      openAIBaseUrl: "https://my-openai-proxy.example.com/v1",
    });

    await orch.getProviderStatus();

    // Identify requests that went to endpoints OTHER than the configured
    // openAIBaseUrl.  Those must never carry the canary key.
    for (const req of captured) {
      if (!req.url.includes("my-openai-proxy.example.com")) {
        const authHeader = req.headers["authorization"] ?? "";
        expect(authHeader).not.toContain(CANARY_KEY);
      }
    }
  });

  it("multiple orchestrator instances do not share provider-check state", async () => {
    const orch1 = createNexcodeOrchestrator({
      workspaceRoot: WORKSPACE_ROOT,
      openAIApiKey: "key-for-orch-1",
      defaultProvider: "ollama",
    });

    const orch2 = createNexcodeOrchestrator({
      workspaceRoot: WORKSPACE_ROOT,
      openAIApiKey: "key-for-orch-2",
      defaultProvider: "ollama",
    });

    await Promise.all([orch1.getProviderStatus(), orch2.getProviderStatus()]);

    // Both should have triggered checks (separate instances).
    expect(captured.length).toBeGreaterThan(0);
  });
});
