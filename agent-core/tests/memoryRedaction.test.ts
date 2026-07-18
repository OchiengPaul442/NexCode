import { describe, it, expect } from "vitest";
import { redactSecrets } from "../src/memory/memoryManager";

const redact = redactSecrets;

describe("Memory secret redaction (N3)", () => {
  it("redacts OpenAI API keys (sk-...)", () => {
    const input = "Using key sk-abc123def456ghi789jkl012mno";
    const result = redact(input);
    expect(result).not.toContain("sk-abc123def456ghi789jkl012mno");
    expect(result).toContain("[REDACTED_API_KEY]");
  });

  it("redacts AWS access keys (AKIA...)", () => {
    const input = "AWS key: AKIA1234567890ABCDEF";
    const result = redact(input);
    expect(result).not.toContain("AKIA1234567890ABCDEF");
    expect(result).toContain("[REDACTED_AWS_KEY]");
  });

  it("redacts GitHub tokens (ghp_...)", () => {
    const input = "Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const result = redact(input);
    expect(result).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234567890");
    expect(result).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
    const result = redact(input);
    expect(result).not.toContain("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test");
    expect(result).toContain("Bearer [REDACTED_TOKEN]");
  });

  it("redacts env-style SECRET assignments", () => {
    const input = "DATABASE_SECRET=supersecretvalue123";
    const result = redact(input);
    expect(result).not.toContain("supersecretvalue123");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts env-style API_KEY assignments", () => {
    const input = "API_KEY=abc123def456";
    const result = redact(input);
    expect(result).not.toContain("abc123def456");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts private keys", () => {
    const input = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
    const result = redact(input);
    expect(result).not.toContain("MIIEpAIBAAKCAQEA");
    expect(result).toContain("[REDACTED_PRIVATE_KEY]");
  });

  it("redacts connection strings", () => {
    const input = "Connect to postgres://user:pass@host:5432/db";
    const result = redact(input);
    expect(result).not.toContain("postgres://user:pass@host:5432/db");
    expect(result).toContain("[REDACTED_CONNECTION_STRING]");
  });

  it("does not redact normal text", () => {
    const input = "The function reads the config file and parses the JSON.";
    const result = redact(input);
    expect(result).toBe(input);
  });

  it("preserves surrounding text when redacting", () => {
    const input = "API key is sk-abc123def456ghi789jkl012mno for the service";
    const result = redact(input);
    expect(result).toContain("API key is");
    expect(result).toContain("for the service");
  });
});
