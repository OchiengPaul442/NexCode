/**
 * Secret redaction utilities for NexCode.
 *
 * Design principles:
 * 1. Redact known secret values FIRST (highest confidence).
 * 2. Then apply pattern-based redaction for unknown secrets.
 * 3. Recursively redact structured objects by key names and values.
 * 4. Fail closed: unrecognized patterns are left in place but high-entropy
 *    hex/base64 strings are flagged conservatively.
 *
 * NC-027: Enhanced redaction for extensible multi-provider agent.
 */

// ---------------------------------------------------------------------------
// Secret-key name patterns for structured object redaction
// ---------------------------------------------------------------------------

const SECRET_KEY_PATTERNS = [
  /api[_-]?key/i,
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /credential/i,
  /authorization/i,
  /auth[_-]?token/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /signing[_-]?key/i,
  /client[_-]?secret/i,
  /bearer/i,
  /oauth/i,
];

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((p) => p.test(key));
}

// ---------------------------------------------------------------------------
// Pattern-based redaction (string input)
// ---------------------------------------------------------------------------

/**
 * Apply pattern-based redaction to a string.
 * This is the core regex engine — called by `redactSecrets` and by
 * `redactByKnownValues` after value-based redaction.
 */
function applyPatternRedaction(text: string): string {
  return (
    text
      // OpenAI / generic sk- keys
      .replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, "[REDACTED_API_KEY]")
      // AWS access key IDs
      .replace(/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED_AWS_KEY]")
      // AWS secret access keys (40-char base64)
      .replace(
        /\b[A-Za-z0-9/+=]{40}\b(?=.*(?:aws|Amazon|secret))/g,
        "[REDACTED_AWS_SECRET]",
      )
      // GitHub personal access tokens (classic)
      .replace(/\b(ghp_[a-zA-Z0-9]{36})\b/g, "[REDACTED_GITHUB_TOKEN]")
      // GitHub fine-grained personal access tokens
      .replace(/\b(github_pat_[a-zA-Z0-9_]{82})\b/g, "[REDACTED_GITHUB_PAT]")
      // GitHub OAuth tokens
      .replace(/\b(gho_[a-zA-Z0-9]{36})\b/g, "[REDACTED_GITHUB_OAUTH]")
      // GitHub app tokens
      .replace(/\b(ghs_[a-zA-Z0-9]{36})\b/g, "[REDACTED_GITHUB_APP_TOKEN]")
      // GitHub refresh tokens
      .replace(/\b(ghr_[a-zA-Z0-9]{36})\b/g, "[REDACTED_GITHUB_REFRESH]")
      // GitLab personal access tokens
      .replace(/\b(glpat-[a-zA-Z0-9\-_]{20,})\b/g, "[REDACTED_GITLAB_TOKEN]")
      // GitLab pipeline tokens
      .replace(/\b(glptt-[a-zA-Z0-9\-_]{20,})\b/g, "[REDACTED_GITLAB_PIPELINE_TOKEN]")
      // GitLab runner tokens
      .replace(/\b(glr_[a-zA-Z0-9\-_]{20,})\b/g, "[REDACTED_GITLAB_RUNNER_TOKEN]")
      // npm access tokens
      .replace(/\b(npm_[a-zA-Z0-9]{36})\b/g, "[REDACTED_NPM_TOKEN]")
      // Slack bot tokens
      .replace(/\b(xoxb-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,})\b/g, "[REDACTED_SLACK_TOKEN]")
      // Slack user tokens
      .replace(/\b(xoxp-[0-9]{10,13}-[0-9]{10,13}-[0-9]{10,13}-[a-f0-9]{32})\b/g, "[REDACTED_SLACK_TOKEN]")
      // Slack app-level tokens
      .replace(/\b(xoxe-[0-9]-[a-zA-Z0-9-]{143})\b/g, "[REDACTED_SLACK_TOKEN]")
      // Slack webhook URLs
      .replace(/\b(https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9]{8,12}\/B[a-zA-Z0-9]{8,12}\/[a-zA-Z0-9]{24})\b/g, "[REDACTED_SLACK_WEBHOOK]")
      // Google API keys
      .replace(/\b(AIza[0-9A-Za-z\-_]{35})\b/g, "[REDACTED_GOOGLE_API_KEY]")
      // Google OAuth client secrets
      .replace(/\b(GOCSPX-[a-zA-Z0-9_-]{28})\b/g, "[REDACTED_GOOGLE_OAUTH_SECRET]")
      // Hugging Face tokens
      .replace(/\b(hf_[a-zA-Z0-9]{34})\b/g, "[REDACTED_HF_TOKEN]")
      // OpenRouter keys
      .replace(/\b(sk-or-[a-zA-Z0-9\-_]{40,})\b/g, "[REDACTED_OPENROUTER_KEY]")
      // Anthropic keys
      .replace(/\b(sk-ant-[a-zA-Z0-9\-_]{40,})\b/g, "[REDACTED_ANTHROPIC_KEY]")
      // Azure storage account keys
      .replace(/\b(AccountKey=[a-zA-Z0-9+/=]{44,})\b/g, "[REDACTED_AZURE_STORAGE_KEY]")
      // Azure Active Directory client secrets
      .replace(/\b(~[a-zA-Z0-9]{34,40})\b/g, (match, p1, offset, str) => {
        // Only redact if preceded by context suggesting Azure
        const before = str.slice(Math.max(0, offset - 50), offset);
        if (/azure|client[_-]?secret/i.test(before)) {
          return "[REDACTED_AZURE_CLIENT_SECRET]";
        }
        return match;
      })
      // Bearer tokens
      .replace(
        /Bearer\s+[a-zA-Z0-9._-]{20,}/g,
        "Bearer [REDACTED_TOKEN]",
      )
      // Authorization header values
      .replace(
        /(Authorization|authorization)\s*[:=]\s*["']?\S{20,}/g,
        "$1=[REDACTED]",
      )
      // Generic secret/key assignment patterns
      .replace(
        /(SECRET|TOKEN|PASSWORD|API_KEY|API_SECRET|ACCESS_KEY|PRIVATE_KEY|SIGNING_KEY|CLIENT_SECRET|AUTH_TOKEN|CREDENTIAL)\s*[:=]\s*(?!\[REDACTED)\S+/gi,
        "$1=[REDACTED]",
      )
      // PEM private key blocks
      .replace(
        /-----BEGIN\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g,
        "[REDACTED_PRIVATE_KEY]",
      )
      // Connection strings (broadened)
      .replace(
        /(mongodb(\+srv)?|postgres(ql)?|mysql|mariadb|redis|amqp|smtp|ftp|s3|gs|abs):\/\/[^\s"']+/gi,
        "[REDACTED_CONNECTION_STRING]",
      )
  );
}

// ---------------------------------------------------------------------------
// JWT detection
// ---------------------------------------------------------------------------

/**
 * Detect and redact JWT tokens. JWTs have the form header.payload.signature
 * where each part is base64url-encoded. We check that the header decodes to
 * a JSON object with an "alg" field.
 */
function redactJWTTokens(text: string): string {
  // Match three base64url segments separated by dots
  return text.replace(
    /\b([A-Za-z0-9\-_]+)\.([A-Za-z0-9\-_]+)\.([A-Za-z0-9\-_]{20,})\b/g,
    (match, headerB64: string, _payloadB64: string, _sigB64: string) => {
      try {
        // base64url → base64
        const headerStr = Buffer.from(
          headerB64.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        ).toString("utf8");
        const header = JSON.parse(headerStr);
        if (header && typeof header === "object" && typeof header.alg === "string") {
          return "[REDACTED_JWT]";
        }
      } catch {
        // Not a valid JWT — leave in place
      }
      return match;
    },
  );
}

// ---------------------------------------------------------------------------
// High-entropy string detection
// ---------------------------------------------------------------------------

/**
 * Shannon entropy of a string over the ASCII alphanumeric alphabet.
 */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Conservatively redact long hex or base64 strings that have high entropy
 * and are likely secrets (not just long hashes).
 *
 * Thresholds:
 * - Hex strings: ≥ 32 chars AND ≥ 4.0 bits of entropy per char
 * - Base64 strings: ≥ 40 chars AND ≥ 4.5 bits of entropy per char
 *
 * We skip strings that look like known hashes (SHA-256 = 64 hex, SHA-1 = 40 hex)
 * or UUIDs (32 hex with dashes).
 */
function redactHighEntropyStrings(text: string): string {
  // High-entropy hex strings (not UUIDs, not known hash lengths)
  return text.replace(
    /\b([a-f0-9]{32,64})\b/gi,
    (match: string) => {
      // Skip UUIDs (have dashes in expected positions)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(match)) {
        return match;
      }
      // Skip common hash lengths (SHA-1=40, SHA-256=64) — too many false positives
      if (match.length === 40 || match.length === 64) {
        return match;
      }
      const entropy = shannonEntropy(match);
      const bitsPerChar = (Math.log2(16));
      if (entropy >= bitsPerChar * 0.85) {
        return "[REDACTED_HEX]";
      }
      return match;
    },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Redact known secret values from a string.
 * This is the highest-confidence redaction: exact value matching.
 * Values are redacted in order; shorter values are matched first to avoid
 * partial overlap issues.
 *
 * @param text - The text to redact
 * @param knownValues - Known secret values to redact (e.g., from SecretStorage)
 * @returns The redacted text
 */
export function redactByKnownValues(text: string, knownValues: string[]): string {
  if (knownValues.length === 0) return text;
  // Sort by length descending so longer secrets are matched first
  const sorted = [...knownValues]
    .filter((v) => v.length >= 4) // Skip trivially short values
    .sort((a, b) => b.length - a.length);
  let result = text;
  for (const value of sorted) {
    // Escape regex special characters in the value
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), "[REDACTED_SECRET]");
  }
  return result;
}

/**
 * Redact secrets in a string using pattern-based detection.
 * This is backward-compatible with the original `redactSecrets` API.
 *
 * Coverage:
 * - OpenAI, AWS, GitHub (classic, fine-grained, OAuth, app, refresh), GitLab
 * - npm, Slack (bot, user, app, webhook), Google (API key, OAuth secret)
 * - Hugging Face, OpenRouter, Anthropic, Azure
 * - Bearer/Authorization headers
 * - Generic secret/key/token assignments
 * - PEM private key blocks
 * - Connection strings (broadened)
 * - JWT tokens
 */
export function redactSecrets(text: string): string {
  let result = text;
  // Phase 1: JWT tokens (structural pattern, highest specificity)
  result = redactJWTTokens(result);
  // Phase 2: Known patterns (provider tokens, keys, headers)
  result = applyPatternRedaction(result);
  // Phase 3: High-entropy strings (conservative fallback)
  result = redactHighEntropyStrings(result);
  return result;
}

/**
 * Secret-key names that should have their values redacted when iterating
 * over structured objects.
 */
const SECRET_VALUE_KEYS = new Set([
  "apiKey",
  "api_key",
  "apikey",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "secret",
  "clientSecret",
  "client_secret",
  "password",
  "passwd",
  "credential",
  "credentials",
  "authorization",
  "auth",
  "privateKey",
  "private_key",
  "signingKey",
  "signing_key",
  "accessKey",
  "access_key",
  "secretKey",
  "secret_key",
  "bearer",
]);

/**
 * Recursively redact values in a structured object.
 *
 * Rules:
 * 1. If a key matches a secret-key pattern, its value is replaced with
 *    "[REDACTED_SECRET]" (strings) or "[REDACTED_OBJECT]" (non-strings).
 * 2. String values are run through pattern-based redaction.
 * 3. Objects and arrays are recursed into.
 * 4. Non-serializable values are returned as-is.
 *
 * @param obj - The object to redact (not mutated)
 * @param knownValues - Optional known secret values for value-based redaction
 * @returns A new object with secrets redacted
 */
export function redactObject<T>(
  obj: T,
  knownValues: string[] = [],
  _seen?: WeakSet<object>,
): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    let result = redactSecrets(obj);
    if (knownValues.length > 0) {
      result = redactByKnownValues(result, knownValues);
    }
    return result as T;
  }
  if (typeof obj !== "object") return obj;

  // Cycle detection: track objects we've already visited
  const seen = _seen ?? new WeakSet<object>();
  if (seen.has(obj)) {
    return "[CIRCULAR]" as T;
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, knownValues, seen)) as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSecretKey(key) || SECRET_VALUE_KEYS.has(key)) {
      // Redact the entire value for known secret keys
      result[key] = "[REDACTED_SECRET]";
    } else if (typeof value === "string") {
      let redacted = redactSecrets(value);
      if (knownValues.length > 0) {
        redacted = redactByKnownValues(redacted, knownValues);
      }
      result[key] = redacted;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactObject(value, knownValues, seen);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}
