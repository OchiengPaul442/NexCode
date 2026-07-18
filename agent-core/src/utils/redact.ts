export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, "[REDACTED_API_KEY]")
    .replace(/\b(AKIA[0-9A-Z]{16})\b/g, "[REDACTED_AWS_KEY]")
    .replace(/\b(ghp_[a-zA-Z0-9]{36})\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\b(github_pat_[a-zA-Z0-9_]{82})\b/g, "[REDACTED_GITHUB_PAT]")
    .replace(/Bearer\s+[a-zA-Z0-9._\-]{20,}/g, "Bearer [REDACTED_TOKEN]")
    .replace(
      /(SECRET|TOKEN|PASSWORD|API_KEY|API_SECRET|ACCESS_KEY|PRIVATE_KEY)\s*[:=]\s*(?!\[REDACTED)\S+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(
      /(mongodb|postgres|mysql|redis):\/\/[^\s]+/g,
      "[REDACTED_CONNECTION_STRING]",
    );
}
