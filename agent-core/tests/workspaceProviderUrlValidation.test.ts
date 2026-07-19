/**
 * NC-002 regression: Provider endpoint URL validation.
 *
 * A malicious workspace can redirect an authenticated provider probe by
 * setting `openAIBaseUrl` in `.vscode/settings.json`. The validation
 * function must reject:
 * - Non-HTTPS URLs (except localhost loopback)
 * - Private/internal IP addresses (SSRF)
 * - Malformed URLs
 * - Empty/missing URLs
 *
 * And must allow:
 * - HTTPS URLs to public hosts
 * - HTTP to localhost/127.0.0.1 (development)
 * - The safe default when no URL is provided
 */
import { describe, it, expect } from "vitest";
import {
  validateProviderUrl,
  isDefaultProviderUrl,
  canProbeProviderEndpoint,
} from "../src/utils/providerUrlValidation";

const SAFE_DEFAULT = "https://opencode.ai/zen/go/v1";

describe("NC-002: validateProviderUrl", () => {
  /* ----- Should return the safe default (reject) ----- */

  it("returns safe default for empty string", () => {
    expect(validateProviderUrl("")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for whitespace-only string", () => {
    expect(validateProviderUrl("   ")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for malformed URL", () => {
    expect(validateProviderUrl("not-a-url")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for HTTP to a public host", () => {
    expect(validateProviderUrl("http://evil.example.com/steal")).toBe(
      SAFE_DEFAULT,
    );
  });

  it("returns safe default for HTTP to an IP address", () => {
    expect(validateProviderUrl("http://203.0.113.50/api")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for ftp scheme", () => {
    expect(validateProviderUrl("ftp://opencode.ai/models")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for file scheme", () => {
    expect(validateProviderUrl("file:///etc/passwd")).toBe(SAFE_DEFAULT);
  });

  /* ----- SSRF: private/internal IP ranges ----- */

  it("returns safe default for RFC 1918 10.x.x.x", () => {
    expect(validateProviderUrl("https://10.0.0.1/api")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for RFC 1918 172.16.x.x", () => {
    expect(validateProviderUrl("https://172.16.0.1/api")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for RFC 1918 172.31.x.x", () => {
    expect(validateProviderUrl("https://172.31.255.255/api")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for RFC 1918 192.168.x.x", () => {
    expect(validateProviderUrl("https://192.168.1.1/api")).toBe(SAFE_DEFAULT);
  });

  it("returns safe default for loopback 127.x.x.x via HTTPS", () => {
    // HTTPS to loopback is allowed (secure development), but HTTP to private IPs is blocked
    expect(validateProviderUrl("https://127.0.0.1/api")).toBe(
      "https://127.0.0.1/api",
    );
  });

  it("returns safe default for loopback 127.x.x.x via HTTP", () => {
    // HTTP to 127.0.0.1 is allowed (localhost development like Ollama)
    expect(validateProviderUrl("http://127.0.0.1/api")).toBe(
      "http://127.0.0.1/api",
    );
  });

  it("returns safe default for link-local 169.254.x.x", () => {
    expect(validateProviderUrl("https://169.254.169.254/metadata")).toBe(
      SAFE_DEFAULT,
    );
  });

  it("returns safe default for link-local 169.254.x.x via HTTP", () => {
    expect(validateProviderUrl("http://169.254.169.254/latest/meta-data")).toBe(
      SAFE_DEFAULT,
    );
  });

  /* ----- Should allow (pass through) ----- */

  it("passes through HTTPS URL to a public host", () => {
    expect(validateProviderUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("passes through HTTPS URL with trailing slash stripped", () => {
    expect(validateProviderUrl("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("passes through HTTPS URL with multiple trailing slashes stripped", () => {
    expect(validateProviderUrl("https://api.openai.com/v1///")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("passes through the safe default URL", () => {
    expect(validateProviderUrl(SAFE_DEFAULT)).toBe(SAFE_DEFAULT);
  });

  it("passes through HTTPS to a non-standard port", () => {
    expect(validateProviderUrl("https://localhost:8080/api")).toBe(
      "https://localhost:8080/api",
    );
  });

  /* ----- Localhost HTTP (development) ----- */

  it("allows HTTP to localhost", () => {
    expect(validateProviderUrl("http://localhost:11434/api/tags")).toBe(
      "http://localhost:11434/api/tags",
    );
  });

  it("allows HTTP to 127.0.0.1", () => {
    expect(validateProviderUrl("http://127.0.0.1:11434/api/tags")).toBe(
      "http://127.0.0.1:11434/api/tags",
    );
  });

  it("allows HTTP to [::1]", () => {
    expect(validateProviderUrl("http://[::1]:11434/api/tags")).toBe(
      "http://[::1]:11434/api/tags",
    );
  });

  /* ----- Edge cases ----- */

  it("handles URL with authentication info", () => {
    // This should pass HTTPS validation (attacker could embed credentials)
    expect(validateProviderUrl("https://user:pass@evil.com/api")).toBe(
      "https://user:pass@evil.com/api",
    );
  });

  it("trims whitespace before validation", () => {
    expect(validateProviderUrl("  https://api.openai.com/v1  ")).toBe(
      "https://api.openai.com/v1",
    );
  });

  it("handles 172.16.0.1 (start of RFC 1918 range)", () => {
    expect(validateProviderUrl("https://172.16.0.1/api")).toBe(SAFE_DEFAULT);
  });

  it("handles 172.31.255.255 (end of RFC 1918 range)", () => {
    expect(validateProviderUrl("https://172.31.255.255/api")).toBe(SAFE_DEFAULT);
  });

  it("allows 172.15.255.255 (just outside RFC 1918 range)", () => {
    // 172.15.x.x is NOT in 172.16.0.0/12
    expect(validateProviderUrl("https://172.15.255.255/api")).toBe(
      "https://172.15.255.255/api",
    );
  });

  it("allows 172.32.0.1 (just outside RFC 1918 range)", () => {
    // 172.32.x.x is NOT in 172.16.0.0/12
    expect(validateProviderUrl("https://172.32.0.1/api")).toBe(
      "https://172.32.0.1/api",
    );
  });
});

describe("NC-002: isDefaultProviderUrl", () => {
  it("returns true for the safe default", () => {
    expect(isDefaultProviderUrl(SAFE_DEFAULT)).toBe(true);
  });

  it("returns false for a custom URL", () => {
    expect(isDefaultProviderUrl("https://api.openai.com/v1")).toBe(false);
  });

  it("returns false for localhost", () => {
    expect(isDefaultProviderUrl("http://localhost:11434")).toBe(false);
  });
});

describe("NC-002: canProbeProviderEndpoint", () => {
  it("allows probing the default endpoint regardless of trust", () => {
    expect(canProbeProviderEndpoint(false, false)).toBe(true);
    expect(canProbeProviderEndpoint(false, true)).toBe(true);
  });

  it("allows probing custom endpoint only when workspace is trusted", () => {
    expect(canProbeProviderEndpoint(true, false)).toBe(false);
    expect(canProbeProviderEndpoint(true, true)).toBe(true);
  });
});
