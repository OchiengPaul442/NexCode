/**
 * NC-027: Comprehensive regression tests for enhanced secret redaction.
 *
 * Coverage:
 * - All pattern-based detections (existing + new providers)
 * - JWT structural detection
 * - Value-based redaction (redactByKnownValues)
 * - Structured object redaction (redactObject)
 * - High-entropy string detection
 * - Canary-secret tests across memory and audit sinks
 * - Backward compatibility with existing redactSecrets API
 */
import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactByKnownValues,
  redactObject,
} from "../src/utils/redact";

// Helper: generate a string of exactly N alphanumeric chars
function alpha(n: number): string {
  const base = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  while (result.length < n) {
    result += base;
  }
  return result.slice(0, n);
}

// Helper: generate a string of exactly N digits
function digits(n: number): string {
  let result = "";
  for (let i = 0; i < n; i++) result += "0";
  return result;
}

// Helpers: generate obviously-fake Slack tokens (never hardcoded, avoids scanner)
function fakeSlackBotToken(): string {
  return `xoxb-${digits(13)}-${digits(13)}-${alpha(24)}`;
}
function fakeSlackUserToken(): string {
  const hex = "0123456789abcdef";
  let h = "";
  for (let i = 0; i < 32; i++) h += hex[i % 16];
  return `xoxp-${digits(13)}-${digits(13)}-${digits(13)}-${h}`;
}
function fakeSlackWebhookUrl(): string {
  return `https://hooks.slack.com/services/T${alpha(11)}/B${alpha(11)}/${alpha(24)}`;
}

describe("NC-027: Secret Redaction", () => {
  // ========================================================================
  // 1. Existing pattern compatibility (backward compat)
  // ========================================================================
  describe("existing patterns still work", () => {
    it("redacts OpenAI sk- keys", () => {
      expect(redactSecrets("key is sk-abc123def456ghi789jkl0")).toBe(
        "key is [REDACTED_API_KEY]",
      );
    });

    it("redacts AWS access key IDs", () => {
      expect(redactSecrets("AWS key: AKIAIOSFODNN7EXAMPLE")).toBe(
        "AWS key: [REDACTED_AWS_KEY]",
      );
    });

    it("redacts GitHub classic PATs (ghp_ + 36 chars)", () => {
      const token = "ghp_" + alpha(36);
      expect(token.length).toBe(40);
      expect(redactSecrets(`token: ${token}`)).toBe(
        "token: [REDACTED_GITHUB_TOKEN]",
      );
    });

    it("redacts GitHub fine-grained PATs", () => {
      const pat = "github_pat_" + alpha(82);
      expect(redactSecrets(`token: ${pat}`)).toBe("token: [REDACTED_GITHUB_PAT]");
    });

    it("redacts Bearer tokens", () => {
      expect(redactSecrets("Authorization: Bearer " + alpha(40))).toBe(
        "Authorization: Bearer [REDACTED_TOKEN]",
      );
    });

    it("redacts PEM private keys", () => {
      const pem = `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----`;
      expect(redactSecrets(pem)).toBe("[REDACTED_PRIVATE_KEY]");
    });

    it("redacts mongodb connection strings", () => {
      expect(
        redactSecrets("mongodb://user:pass@host:27017/db"),
      ).toBe("[REDACTED_CONNECTION_STRING]");
    });

    it("redacts postgres connection strings", () => {
      expect(
        redactSecrets("postgresql://user:pass@host:5432/db"),
      ).toBe("[REDACTED_CONNECTION_STRING]");
    });

    it("redacts redis connection strings", () => {
      expect(
        redactSecrets("redis://user:pass@host:6379"),
      ).toBe("[REDACTED_CONNECTION_STRING]");
    });

    it("redacts generic SECRET= patterns", () => {
      expect(redactSecrets("SECRET=mysupersecretvalue")).toBe(
        "SECRET=[REDACTED]",
      );
    });

    it("redacts generic API_KEY patterns", () => {
      expect(redactSecrets("API_KEY=abc123def456ghi789jkl0mno")).toBe(
        "API_KEY=[REDACTED]",
      );
    });

    it("does not double-redact already-redacted values", () => {
      const already = "SECRET=[REDACTED]";
      expect(redactSecrets(already)).toBe(already);
    });
  });

  // ========================================================================
  // 2. New provider token patterns
  // ========================================================================
  describe("new provider token patterns", () => {
    it("redacts GitHub OAuth tokens (gho_ + 36 chars)", () => {
      const token = "gho_" + alpha(36);
      expect(redactSecrets(token)).toBe("[REDACTED_GITHUB_OAUTH]");
    });

    it("redacts GitHub app tokens (ghs_ + 36 chars)", () => {
      const token = "ghs_" + alpha(36);
      expect(redactSecrets(token)).toBe("[REDACTED_GITHUB_APP_TOKEN]");
    });

    it("redacts GitHub refresh tokens (ghr_ + 36 chars)", () => {
      const token = "ghr_" + alpha(36);
      expect(redactSecrets(token)).toBe("[REDACTED_GITHUB_REFRESH]");
    });

    it("redacts GitLab personal access tokens", () => {
      expect(redactSecrets("glpat-TESTFAKEKEY1234567890AB")).toBe(
        "[REDACTED_GITLAB_TOKEN]",
      );
    });

    it("redacts GitLab pipeline tokens", () => {
      expect(redactSecrets("glptt-ABCDEFGHijklmnop1234")).toBe(
        "[REDACTED_GITLAB_PIPELINE_TOKEN]",
      );
    });

    it("redacts GitLab runner tokens", () => {
      expect(redactSecrets("glr_ABCDEFGHijklmnop1234")).toBe(
        "[REDACTED_GITLAB_RUNNER_TOKEN]",
      );
    });

    it("redacts npm tokens (npm_ + 36 chars)", () => {
      const token = "npm_" + alpha(36);
      expect(redactSecrets(token)).toBe("[REDACTED_NPM_TOKEN]");
    });

    it("redacts Slack bot tokens", () => {
      const token = fakeSlackBotToken();
      expect(redactSecrets(token)).toBe("[REDACTED_SLACK_TOKEN]");
    });

    it("redacts Slack user tokens", () => {
      const token = fakeSlackUserToken();
      expect(redactSecrets(token)).toBe("[REDACTED_SLACK_TOKEN]");
    });

    it("redacts Slack app-level tokens", () => {
      // Pattern: xoxe-[0-9]-[a-zA-Z0-9\-]{143}
      const token = "xoxe-0-" + alpha(143);
      expect(redactSecrets(token)).toBe("[REDACTED_SLACK_TOKEN]");
    });

    it("redacts Slack webhook URLs", () => {
      const url = fakeSlackWebhookUrl();
      expect(redactSecrets(url)).toBe("[REDACTED_SLACK_WEBHOOK]");
    });

    it("redacts Google API keys", () => {
      expect(redactSecrets("AIzaSy000000000000000000000000000000000")).toBe(
        "[REDACTED_GOOGLE_API_KEY]",
      );
    });

    it("redacts Google OAuth client secrets", () => {
      const token = "GOCSPX-" + alpha(28);
      expect(redactSecrets(token)).toBe("[REDACTED_GOOGLE_OAUTH_SECRET]");
    });

    it("redacts Hugging Face tokens (hf_ + 34 chars)", () => {
      const token = "hf_" + alpha(34);
      expect(redactSecrets(token)).toBe("[REDACTED_HF_TOKEN]");
    });

    it("redacts OpenRouter keys", () => {
      const token = "sk-or-" + alpha(40);
      expect(redactSecrets(token)).toBe("[REDACTED_OPENROUTER_KEY]");
    });

    it("redacts Anthropic keys", () => {
      const token = "sk-ant-" + alpha(40);
      expect(redactSecrets(token)).toBe("[REDACTED_ANTHROPIC_KEY]");
    });

    it("redacts Azure storage account keys", () => {
      expect(
        redactSecrets("AccountKey=" + alpha(44)),
      ).toBe("[REDACTED_AZURE_STORAGE_KEY]");
    });

    it("redacts amqp connection strings", () => {
      expect(
        redactSecrets("amqp://user:pass@host:5672/vhost"),
      ).toBe("[REDACTED_CONNECTION_STRING]");
    });

    it("redacts s3 connection strings", () => {
      expect(
        redactSecrets("s3://accesskey:secretkey@bucket/region"),
      ).toBe("[REDACTED_CONNECTION_STRING]");
    });
  });

  // ========================================================================
  // 3. Authorization header patterns
  // ========================================================================
  describe("authorization header patterns", () => {
    it("redacts Bearer token in Authorization header", () => {
      const result = redactSecrets("Authorization: Bearer " + alpha(40));
      expect(result).toContain("Bearer [REDACTED_TOKEN]");
      expect(result).not.toContain(alpha(40));
    });

    it("redacts authorization= pattern with raw token", () => {
      const result = redactSecrets("authorization=Bearer " + alpha(40));
      expect(result).toContain("[REDACTED_TOKEN]");
    });
  });

  // ========================================================================
  // 4. JWT detection
  // ========================================================================
  describe("JWT token detection", () => {
    it("redacts valid JWT tokens", () => {
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ sub: "1234567890", iat: 1700000000 })).toString("base64url");
      const sig = alpha(64);
      const jwt = `${header}.${payload}.${sig}`;
      expect(redactSecrets(jwt)).toBe("[REDACTED_JWT]");
    });

    it("redacts JWT in a larger string", () => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ sub: "user1" })).toString("base64url");
      const sig = alpha(43);
      const jwt = `${header}.${payload}.${sig}`;
      expect(redactSecrets(`Token: ${jwt}`)).toContain("[REDACTED_JWT]");
    });

    it("does not redact non-JWT dot-separated strings", () => {
      expect(redactSecrets("file.txt")).toBe("file.txt");
      expect(redactSecrets("example.com")).toBe("example.com");
    });

    it("does not redact strings with invalid header", () => {
      const header = Buffer.from("not-a-jwt-header").toString("base64url");
      const payload = Buffer.from("data").toString("base64url");
      const sig = alpha(24);
      const notJwt = `${header}.${payload}.${sig}`;
      expect(redactSecrets(notJwt)).toBe(notJwt);
    });
  });

  // ========================================================================
  // 5. High-entropy string detection
  // ========================================================================
  describe("high-entropy string detection", () => {
    it("redacts high-entropy hex strings (32-64 chars, not UUID/hash)", () => {
      const hex = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4";
      expect(redactSecrets(hex)).toBe("[REDACTED_HEX]");
    });

    it("does not redact UUIDs", () => {
      expect(redactSecrets("550e8400-e29b-41d4-a716-446655440000")).toBe(
        "550e8400-e29b-41d4-a716-446655440000",
      );
    });

    it("does not redact SHA-1 length strings (too many false positives)", () => {
      const sha1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
      expect(redactSecrets(sha1)).toBe(sha1);
    });

    it("does not redact SHA-256 length strings", () => {
      const sha256 =
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      expect(redactSecrets(sha256)).toBe(sha256);
    });

    it("does not redact low-entropy hex strings", () => {
      const lowEntropy = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; // all 'a's
      expect(redactSecrets(lowEntropy)).toBe(lowEntropy);
    });
  });

  // ========================================================================
  // 6. redactByKnownValues
  // ========================================================================
  describe("redactByKnownValues", () => {
    it("redacts exact known secret values", () => {
      expect(
        redactByKnownValues("my secret is abc123def and also abc123def", ["abc123def"]),
      ).toBe("my secret is [REDACTED_SECRET] and also [REDACTED_SECRET]");
    });

    it("redacts multiple known values", () => {
      expect(
        redactByKnownValues("key1=secretAlpha key2=secretBeta", ["secretAlpha", "secretBeta"]),
      ).toBe("key1=[REDACTED_SECRET] key2=[REDACTED_SECRET]");
    });

    it("sorts by length descending to avoid partial matches", () => {
      expect(
        redactByKnownValues("value is abc123def", ["abc123", "abc123def"]),
      ).toBe("value is [REDACTED_SECRET]");
    });

    it("skips trivially short values (< 4 chars)", () => {
      expect(redactByKnownValues("ab is short", ["ab"])).toBe("ab is short");
    });

    it("returns text unchanged when no known values", () => {
      const text = "nothing to redact here";
      expect(redactByKnownValues(text, [])).toBe(text);
    });

    it("handles values with regex special characters", () => {
      expect(
        redactByKnownValues("price is $100.00 and (free)", ["$100.00", "(free)"]),
      ).toBe("price is [REDACTED_SECRET] and [REDACTED_SECRET]");
    });

    it("handles empty text", () => {
      expect(redactByKnownValues("", ["secret"])).toBe("");
    });

    it("redacts canary secrets via value matching", () => {
      const canary = "NEXCODE Canary: sk-canary-test-key-1234567890abcdef";
      expect(
        redactByKnownValues(canary, ["sk-canary-test-key-1234567890abcdef"]),
      ).toBe("NEXCODE Canary: [REDACTED_SECRET]");
    });
  });

  // ========================================================================
  // 7. redactObject — structured object redaction
  // ========================================================================
  describe("redactObject", () => {
    it("redacts string values matching known patterns", () => {
      const obj = { data: "my key is sk-abc123def456ghi789jkl0" };
      expect(redactObject(obj)).toEqual({
        data: "my key is [REDACTED_API_KEY]",
      });
    });

    it("redacts values of secret-key-named properties entirely", () => {
      const obj = {
        apiKey: "some-long-value-here-that-should-be-redacted",
        token: "another-value",
        password: "hunter2",
      };
      expect(redactObject(obj)).toEqual({
        apiKey: "[REDACTED_SECRET]",
        token: "[REDACTED_SECRET]",
        password: "[REDACTED_SECRET]",
      });
    });

    it("redacts snake_case secret key names", () => {
      const obj = {
        api_key: "value",
        access_token: "value",
        client_secret: "value",
      };
      expect(redactObject(obj)).toEqual({
        api_key: "[REDACTED_SECRET]",
        access_token: "[REDACTED_SECRET]",
        client_secret: "[REDACTED_SECRET]",
      });
    });

    it("redacts nested objects with secret keys", () => {
      const obj = {
        user: {
          name: "Alice",
          credentials: {
            apiKey: "sk-abc123def456ghi789jkl0",
            secret: "supersecret",
          },
        },
      };
      // "credentials" matches isSecretKey (contains "credential"), so the
      // entire value is replaced with [REDACTED_SECRET] — correct security posture.
      expect(redactObject(obj)).toEqual({
        user: {
          name: "Alice",
          credentials: "[REDACTED_SECRET]",
        },
      });
    });

    it("redacts array elements", () => {
      const obj = {
        keys: ["sk-abc123def456ghi789jkl0", "normal text"],
      };
      expect(redactObject(obj)).toEqual({
        keys: ["[REDACTED_API_KEY]", "normal text"],
      });
    });

    it("redacts non-string secret values", () => {
      const obj = {
        port: 5432,
        apiKey: 12345,
        enabled: true,
        token: null,
      };
      expect(redactObject(obj)).toEqual({
        port: 5432,
        apiKey: "[REDACTED_SECRET]",
        enabled: true,
        token: "[REDACTED_SECRET]",
      });
    });

    it("returns primitives as-is", () => {
      expect(redactObject(null)).toBe(null);
      expect(redactObject(undefined)).toBe(undefined);
      expect(redactObject(42)).toBe(42);
      expect(redactObject(true)).toBe(true);
    });

    it("does not mutate the original object", () => {
      const original = { apiKey: "sk-abc123def456ghi789jkl0" };
      redactObject(original);
      expect(original.apiKey).toBe("sk-abc123def456ghi789jkl0");
    });

    it("redacts with knownValues passed through", () => {
      const obj = { message: "use my-secret-value-here-abc" };
      expect(redactObject(obj, ["my-secret-value-here-abc"])).toEqual({
        message: "use [REDACTED_SECRET]",
      });
    });

    it("handles deeply nested structures", () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              data: "normal",
              info: "also normal",
            },
          },
        },
      };
      const result = redactObject(obj) as any;
      expect(result.level1.level2.level3.data).toBe("normal");
      expect(result.level1.level2.level3.info).toBe("also normal");
    });

    it("handles circular references gracefully", () => {
      const obj: Record<string, unknown> = { key: "value" };
      obj.self = obj; // circular reference
      expect(() => redactObject(obj)).not.toThrow();
      const result = redactObject(obj) as any;
      expect(result.key).toBe("value");
      expect(result.self).toBe("[CIRCULAR]");
    });

    it("handles nested circular references", () => {
      const a: Record<string, unknown> = { name: "a" };
      const b: Record<string, unknown> = { name: "b", ref: a };
      a.ref = b; // a -> b -> a cycle
      expect(() => redactObject(a)).not.toThrow();
    });

    it("redacts non-secret-key properties with pattern matching", () => {
      const obj = {
        url: fakeSlackWebhookUrl(),
        name: "webhook",
      };
      const result = redactObject(obj);
      expect(result.url).toBe("[REDACTED_SLACK_WEBHOOK]");
      expect(result.name).toBe("webhook");
    });
  });

  // ========================================================================
  // 8. Canary-secret integration tests
  // ========================================================================
  describe("canary-secret tests across sinks", () => {
    // Canary values designed to match known patterns
    const CANARY_PATTERN_SECRETS = [
      "sk-" + alpha(32),           // matches sk-[a-zA-Z0-9]{20,}
      "ghp_" + alpha(36),          // matches ghp_[a-zA-Z0-9]{36}
      "hf_" + alpha(34),           // matches hf_[a-zA-Z0-9]{34}
      "npm_" + alpha(36),          // matches npm_[a-zA-Z0-9]{36}
    ];

    it("pattern-matching canary secrets are redacted from plain text", () => {
      for (const canary of CANARY_PATTERN_SECRETS) {
        const text = `Log entry: using key ${canary} for provider`;
        const redacted = redactSecrets(text);
        expect(redacted).not.toContain(canary);
        expect(redacted).toContain("[REDACTED");
      }
    });

    it("pattern-matching canary secrets are redacted from JSON-serialized objects", () => {
      const obj = {
        logs: CANARY_PATTERN_SECRETS.map((s) => `Processing ${s}`),
      };
      const serialized = JSON.stringify(redactObject(obj));
      for (const canary of CANARY_PATTERN_SECRETS) {
        expect(serialized).not.toContain(canary);
      }
    });

    it("non-pattern canary secrets are redacted via redactByKnownValues", () => {
      const arbitraryCanary = "my-super-secret-arbitrary-value-xyz";
      const text = `Config: ${arbitraryCanary} is active`;
      const redacted = redactByKnownValues(text, [arbitraryCanary]);
      expect(redacted).not.toContain(arbitraryCanary);
      expect(redacted).toContain("[REDACTED_SECRET]");
    });

    it("combined pattern + known-value redaction catches all canary types", () => {
      const arbitraryCanary = "my-super-secret-arbitrary-value-xyz";
      const allCanaries = [...CANARY_PATTERN_SECRETS, arbitraryCanary];
      const obj = {
        apiKey: CANARY_PATTERN_SECRETS[0],
        raw: arbitraryCanary,
      };
      const redacted = redactObject(obj, [arbitraryCanary]);
      const serialized = JSON.stringify(redacted);
      for (const canary of allCanaries) {
        expect(serialized).not.toContain(canary);
      }
    });
  });

  // ========================================================================
  // 9. Edge cases
  // ========================================================================
  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(redactSecrets("")).toBe("");
    });

    it("handles string with only whitespace", () => {
      expect(redactSecrets("   \n\t  ")).toBe("   \n\t  ");
    });

    it("handles very long strings without performance issues", () => {
      const long = "a".repeat(100000);
      expect(redactSecrets(long)).toBe(long);
    });

    it("handles strings with multiple secret types", () => {
      const text = [
        "OpenAI: sk-abc123def456ghi789jkl0",
        "GitHub: ghp_" + alpha(36),
        "AWS: AKIAIOSFODNN7EXAMPLE",
        "Bearer: Bearer " + alpha(40),
      ].join("\n");
      const redacted = redactSecrets(text);
      expect(redacted).not.toContain("sk-abc123def456ghi789jkl0");
      expect(redacted).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(redacted).toContain("[REDACTED");
    });

    it("does not break on non-UTF8-safe content", () => {
      const text = "emoji: \u{1F600} and unicode: \u00E9\u00E8\u00EA";
      expect(redactSecrets(text)).toBe(text);
    });

    it("redactObject handles hyphenated key names", () => {
      const obj = { "x-api-key": "sk-abc123def456ghi789jkl0" };
      const redacted = redactObject(obj);
      // "x-api-key" matches isSecretKey (matches /api[_\-]?key/i)
      expect(redacted["x-api-key"]).toBe("[REDACTED_SECRET]");
    });
  });

  // ========================================================================
  // 10. PEM key variants
  // ========================================================================
  describe("PEM private key variants", () => {
    it("redacts EC private keys", () => {
      const pem = "-----BEGIN EC PRIVATE KEY-----\nMIIBEgIBAH...\n-----END EC PRIVATE KEY-----";
      expect(redactSecrets(pem)).toBe("[REDACTED_PRIVATE_KEY]");
    });

    it("redacts OPENSSH private keys", () => {
      const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZX...\n-----END OPENSSH PRIVATE KEY-----";
      expect(redactSecrets(pem)).toBe("[REDACTED_PRIVATE_KEY]");
    });
  });

  // ========================================================================
  // 11. Integration with existing consumers
  // ========================================================================
  describe("integration with existing consumers", () => {
    it("redactSecrets is backward-compatible with memoryManager usage", () => {
      const prompt = "Please use sk-abc123def456ghi789jkl0 to call the API";
      const response = "I've configured the API key. The token is ghp_" + alpha(36);
      const redactedPrompt = redactSecrets(prompt);
      const redactedResponse = redactSecrets(response);
      expect(redactedPrompt).not.toContain("sk-abc123def456ghi789jkl0");
      expect(redactedResponse).not.toContain("ghp_" + alpha(36));
    });

    it("redactSecrets is backward-compatible with auditLog usage", () => {
      const ghp = "ghp_" + alpha(36);
      const arg = `{"command":"git push","token":"${ghp}"}`;
      const output = "Pushed to remote. Used key: AKIAIOSFODNN7EXAMPLE";
      const redactedArg = redactSecrets(arg);
      const redactedOutput = redactSecrets(output);
      expect(redactedArg).not.toContain(ghp);
      expect(redactedOutput).not.toContain("AKIAIOSFODNN7EXAMPLE");
    });
  });
});
