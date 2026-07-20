/**
 * NC-002: Provider endpoint URL validation.
 *
 * Validates that a provider base URL is safe to receive credentials.
 * Designed to prevent workspace-controlled URL redirect attacks where a
 * malicious `.vscode/settings.json` redirects authenticated requests to
 * an attacker-controlled host.
 *
 * Rules:
 * - Must be a parseable URL with a known scheme.
 * - Must use HTTPS unless the host is localhost/127.0.0.1 (development loopback).
 * - Must not point to private/internal IP ranges (RFC 1918, loopback, link-local).
 * - Must not be empty (falls back to the safe default).
 */

const SAFE_DEFAULT = "https://opencode.ai/zen/go/v1";

/**
 * Check if a hostname is a loopback / localhost address.
 */
function isLocalhost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]"
  );
}

/**
 * Check if a dotted-quad IPv4 address is in a private/reserved range
 * that should never be the target of an authenticated request.
 */
function isPrivateOrReservedIP(hostname: string): boolean {
  const match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  );
  if (!match) return false;

  const [, aStr, bStr, cStr, dStr] = match;
  const a = Number(aStr);
  const b = Number(bStr);
  const c = Number(cStr);
  const d = Number(dStr);

  // Basic octet validation
  if (a > 255 || b > 255 || c > 255 || d > 255) return true;

  // RFC 1918: 10.0.0.0/8
  if (a === 10) return true;
  // RFC 1918: 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // RFC 1918: 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // Loopback: 127.0.0.0/8
  if (a === 127) return true;
  // Link-local: 169.254.0.0/16
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Validate a provider endpoint URL and return a safe URL string.
 *
 * @param rawUrl - The raw URL string from configuration.
 * @param isCustom - Whether this is a custom (non-default) endpoint.
 * @returns A validated URL string. If validation fails, returns the safe default.
 */
export function validateProviderUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return SAFE_DEFAULT;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Malformed URL — reject and use default
    return SAFE_DEFAULT;
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  const hostname = parsed.hostname.toLowerCase();

  // Allow HTTPS always.
  // Allow HTTP only for localhost loopback (development).
  const localhost = isLocalhost(hostname);
  if (scheme !== "https" && !(scheme === "http" && localhost)) {
    // NC-002: Non-HTTPS non-loopback URL — reject
    return SAFE_DEFAULT;
  }

  // Block private/internal IP ranges to prevent SSRF
  if (!localhost && isPrivateOrReservedIP(hostname)) {
    return SAFE_DEFAULT;
  }

  return trimmed.replace(/\/+$/, "");
}

/**
 * Determine whether a validated base URL is the built-in safe default
 * (as opposed to a user/workspace-configured custom endpoint).
 */
export function isDefaultProviderUrl(validatedUrl: string): boolean {
  return validatedUrl === SAFE_DEFAULT;
}

/**
 * NC-002: Check whether the current workspace is trusted enough to allow
 * authenticated provider probing to a custom (non-default) endpoint.
 *
 * @param isCustomUrl - Whether the URL is a custom endpoint (not the default).
 * @param isWorkspaceTrusted - Whether the current workspace is trusted.
 * @returns true if probing is allowed.
 */
export function canProbeProviderEndpoint(
  isCustomUrl: boolean,
  isWorkspaceTrusted: boolean,
): boolean {
  if (!isCustomUrl) {
    // Always allow probing the built-in default endpoint
    return true;
  }
  // Custom endpoints require workspace trust
  return isWorkspaceTrusted;
}
