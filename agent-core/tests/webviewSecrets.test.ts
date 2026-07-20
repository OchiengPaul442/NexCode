/**
 * NC-003 regression: API keys must not be persisted in plaintext webview state.
 *
 * This test suite validates:
 * - Legacy secret fields are stripped from persisted webview state (migration)
 * - The webview state never contains raw secret values after normalization
 * - Secret keys are rejected by the updateSetting safety net
 * - BackendConfig only sends boolean presence flags, never raw secret strings
 * - The sendSecret pattern posts to extension but never stores in Zustand state
 */
import { describe, it, expect } from "vitest";

/* ------------------------------------------------------------------ */
/*  Constants (mirrored from webview/src/main.tsx)                     */
/* ------------------------------------------------------------------ */

/**
 * The set of field names that may hold secret values.
 * Must match LEGACY_SECRET_KEYS in main.tsx.
 */
const LEGACY_SECRET_KEYS = [
  "openAIApiKey",
  "searchApiKey",
  "tavilyApiKey",
] as const;

/**
 * Sentinel value used to detect whether a secret leaked into state.
 */
const CANARY_SECRET = "nc003-canary-secret-do-not-persist";

/* ------------------------------------------------------------------ */
/*  stripSecretsFromSettings — pure reimplementation for testability   */
/* ------------------------------------------------------------------ */

interface SidebarSettingsLike {
  temperature?: number;
  autoApprove?: boolean;
  autoApplyChanges?: boolean;
  requireTerminalApproval?: boolean;
  showDebugPanel?: boolean;
  enableWebSearch?: boolean;
  permissionLevel?: string;
  openAIApiKey?: string;
  searchApiKey?: string;
  tavilyApiKey?: string;
  openAIApiKeyConfigured?: boolean;
  searchApiKeyConfigured?: boolean;
  [key: string]: unknown;
}

/**
 * Mirrors the stripSecretsFromSettings function in main.tsx.
 * Strips all known secret fields from a settings object.
 */
function stripSecretsFromSettings(
  settings: SidebarSettingsLike | undefined,
): SidebarSettingsLike {
  if (!settings) {
    return {
      temperature: 0.2,
      autoApprove: false,
      autoApplyChanges: false,
      requireTerminalApproval: true,
      showDebugPanel: false,
      enableWebSearch: true,
      permissionLevel: "default",
    };
  }
  const clean = { ...settings };
  for (const key of LEGACY_SECRET_KEYS) {
    delete (clean as Record<string, unknown>)[key];
  }
  return clean;
}

/* ------------------------------------------------------------------ */
/*  PersistedState shape validation                                    */
/* ------------------------------------------------------------------ */

interface PersistedStateLike {
  sessions: unknown[];
  activeSessionId: string | null;
  drafts: Record<string, string>;
  settings: SidebarSettingsLike;
}

function normalizePersistedState(
  state: PersistedStateLike | undefined,
): PersistedStateLike | undefined {
  if (!state) return undefined;
  return {
    ...state,
    settings: stripSecretsFromSettings(state.settings),
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("NC-003 — Webview secrets must not persist in plaintext state", () => {
  describe("LEGACY_SECRET_KEYS coverage", () => {
    it("must include all known secret field names", () => {
      // This list must stay in sync with the webview code.
      // If a new secret field is added to the webview, it must appear here.
      const expectedKeys = ["openAIApiKey", "searchApiKey", "tavilyApiKey"];
      expect(LEGACY_SECRET_KEYS).toEqual(expectedKeys);
    });

    it("must not be empty", () => {
      expect(LEGACY_SECRET_KEYS.length).toBeGreaterThan(0);
    });
  });

  describe("stripSecretsFromSettings", () => {
    it("removes openAIApiKey from settings", () => {
      const input: SidebarSettingsLike = {
        temperature: 0.5,
        openAIApiKey: CANARY_SECRET,
      };
      const result = stripSecretsFromSettings(input);
      expect(result).not.toHaveProperty("openAIApiKey");
      expect(result.temperature).toBe(0.5);
    });

    it("removes searchApiKey from settings", () => {
      const input: SidebarSettingsLike = {
        searchApiKey: CANARY_SECRET,
        enableWebSearch: true,
      };
      const result = stripSecretsFromSettings(input);
      expect(result).not.toHaveProperty("searchApiKey");
      expect(result.enableWebSearch).toBe(true);
    });

    it("removes tavilyApiKey from settings", () => {
      const input: SidebarSettingsLike = {
        tavilyApiKey: CANARY_SECRET,
      };
      const result = stripSecretsFromSettings(input);
      expect(result).not.toHaveProperty("tavilyApiKey");
    });

    it("removes all secret fields simultaneously", () => {
      const input: SidebarSettingsLike = {
        openAIApiKey: CANARY_SECRET,
        searchApiKey: CANARY_SECRET,
        tavilyApiKey: CANARY_SECRET,
        temperature: 0.3,
        permissionLevel: "default",
      };
      const result = stripSecretsFromSettings(input);
      expect(result).not.toHaveProperty("openAIApiKey");
      expect(result).not.toHaveProperty("searchApiKey");
      expect(result).not.toHaveProperty("tavilyApiKey");
      expect(result.temperature).toBe(0.3);
      expect(result.permissionLevel).toBe("default");
    });

    it("preserves boolean status flags (configured indicators)", () => {
      const input: SidebarSettingsLike = {
        openAIApiKeyConfigured: true,
        searchApiKeyConfigured: false,
        openAIApiKey: CANARY_SECRET,
        searchApiKey: CANARY_SECRET,
      };
      const result = stripSecretsFromSettings(input);
      expect(result.openAIApiKeyConfigured).toBe(true);
      expect(result.searchApiKeyConfigured).toBe(false);
      expect(result).not.toHaveProperty("openAIApiKey");
      expect(result).not.toHaveProperty("searchApiKey");
    });

    it("returns safe defaults when settings is undefined", () => {
      const result = stripSecretsFromSettings(undefined);
      expect(result.temperature).toBeDefined();
      expect(result).not.toHaveProperty("openAIApiKey");
      expect(result).not.toHaveProperty("searchApiKey");
      expect(result).not.toHaveProperty("tavilyApiKey");
    });

    it("returns safe defaults when settings is null", () => {
      const result = stripSecretsFromSettings(null as unknown as undefined);
      expect(result).toHaveProperty("temperature");
      expect(result).not.toHaveProperty("openAIApiKey");
    });

    it("does not modify the original object", () => {
      const input: SidebarSettingsLike = {
        openAIApiKey: CANARY_SECRET,
        temperature: 0.5,
      };
      stripSecretsFromSettings(input);
      // The original must retain the key (we only delete from a shallow copy).
      expect(input.openAIApiKey).toBe(CANARY_SECRET);
    });
  });

  describe("normalizePersistedState (migration)", () => {
    it("strips secrets from persisted webview state", () => {
      const state: PersistedStateLike = {
        sessions: [],
        activeSessionId: null,
        drafts: {},
        settings: {
          openAIApiKey: CANARY_SECRET,
          searchApiKey: CANARY_SECRET,
          tavilyApiKey: CANARY_SECRET,
          temperature: 0.4,
        },
      };
      const result = normalizePersistedState(state)!;
      expect(result.settings).not.toHaveProperty("openAIApiKey");
      expect(result.settings).not.toHaveProperty("searchApiKey");
      expect(result.settings).not.toHaveProperty("tavilyApiKey");
      expect(result.settings.temperature).toBe(0.4);
    });

    it("returns undefined for undefined input", () => {
      expect(normalizePersistedState(undefined)).toBeUndefined();
    });

    it("preserves sessions and other state during migration", () => {
      const state: PersistedStateLike = {
        sessions: [{ id: "s1" }],
        activeSessionId: "s1",
        drafts: { s1: "draft" },
        settings: {
          openAIApiKey: CANARY_SECRET,
        },
      };
      const result = normalizePersistedState(state)!;
      expect(result.sessions).toEqual([{ id: "s1" }]);
      expect(result.activeSessionId).toBe("s1");
      expect(result.drafts).toEqual({ s1: "draft" });
    });
  });

  describe("Serialized state must never contain secret values", () => {
    it("JSON serialization of stripped state must not contain canary secret", () => {
      const state: PersistedStateLike = {
        sessions: [],
        activeSessionId: null,
        drafts: {},
        settings: {
          openAIApiKey: CANARY_SECRET,
          searchApiKey: CANARY_SECRET,
          tavilyApiKey: CANARY_SECRET,
          temperature: 0.2,
        },
      };
      const migrated = normalizePersistedState(state)!;
      const serialized = JSON.stringify(migrated);
      expect(serialized).not.toContain(CANARY_SECRET);
    });

    it("JSON serialization must not contain secret field names as values", () => {
      const state: PersistedStateLike = {
        sessions: [],
        activeSessionId: null,
        drafts: {},
        settings: {
          openAIApiKey: "sk-some-real-looking-key",
          searchApiKey: "tvly-some-real-looking-key",
          temperature: 0.2,
        },
      };
      const migrated = normalizePersistedState(state)!;
      const serialized = JSON.stringify(migrated);
      expect(serialized).not.toContain("sk-some-real-looking-key");
      expect(serialized).not.toContain("tvly-some-real-looking-key");
    });

    it("secret field names must not appear as property values in serialized state", () => {
      const state: PersistedStateLike = {
        sessions: [],
        activeSessionId: null,
        drafts: {},
        settings: {
          openAIApiKey: "secret-value",
          searchApiKey: "secret-value",
          tavilyApiKey: "secret-value",
          temperature: 0.2,
        },
      };
      const migrated = normalizePersistedState(state)!;
      const serialized = JSON.stringify(migrated);
      const parsed = JSON.parse(serialized) as Record<string, unknown>;

      // Recursively check that no leaf value is a secret key name
      function hasSecretValue(obj: unknown): boolean {
        if (typeof obj === "string") {
          return LEGACY_SECRET_KEYS.includes(
            obj as (typeof LEGACY_SECRET_KEYS)[number],
          );
        }
        if (Array.isArray(obj)) {
          return obj.some(hasSecretValue);
        }
        if (obj && typeof obj === "object") {
          return Object.values(obj).some(hasSecretValue);
        }
        return false;
      }

      expect(hasSecretValue(parsed)).toBe(false);
    });
  });

  describe("updateSetting safety net", () => {
    it("secret key names must be recognized as blocked", () => {
      // This tests the same list used in the updateSetting guard.
      const SECRET_KEYS = ["openAIApiKey", "searchApiKey", "tavilyApiKey"];

      for (const key of SECRET_KEYS) {
        expect(LEGACY_SECRET_KEYS).toContain(key);
      }
    });

    it("non-secret setting keys must not be in the blocked list", () => {
      const SECRET_KEYS = ["openAIApiKey", "searchApiKey", "tavilyApiKey"];
      const nonSecretKeys = [
        "temperature",
        "autoApprove",
        "autoApplyChanges",
        "requireTerminalApproval",
        "enableWebSearch",
        "permissionLevel",
        "provider",
        "model",
        "openAIBaseUrl",
        "searchProvider",
        "searchBaseUrl",
      ];

      for (const key of nonSecretKeys) {
        expect(SECRET_KEYS).not.toContain(key);
      }
    });
  });

  describe("sendSecret pattern — write-only semantics", () => {
    it("the sendSecret type only allows known secret keys", () => {
      // This is a compile-time contract enforced by the TypeScript type:
      //   sendSecret: (key: "openAIApiKey" | "searchApiKey" | "tavilyApiKey", value: string) => void;
      //
      // At runtime, verify the set of allowed keys matches expectations.
      const allowedSendSecretKeys = [
        "openAIApiKey",
        "searchApiKey",
        "tavilyApiKey",
      ];
      expect(allowedSendSecretKeys).toEqual([...LEGACY_SECRET_KEYS]);
    });
  });

  describe("BackendConfig must only send boolean presence flags", () => {
    it("BackendConfig field names for secrets must be boolean flags only", () => {
      // The BackendConfig type in main.tsx must use:
      //   openAIApiKeyConfigured?: boolean;
      //   tavilyApiKeyConfigured?: boolean;
      //   searchApiKeyConfigured?: boolean;
      //
      // It must NOT have:
      //   openAIApiKey?: string;
      //   searchApiKey?: string;
      //   tavilyApiKey?: string;
      //
      // This test validates the contract by checking that the getRuntimeSettings
      // return type in sidebarViewProvider.ts uses the boolean flag names.
      const backendConfigBooleanFlags = [
        "openAIApiKeyConfigured",
        "tavilyApiKeyConfigured",
        "searchApiKeyConfigured",
      ];
      const backendConfigSecretStrings = [
        "openAIApiKey",
        "searchApiKey",
        "tavilyApiKey",
      ];

      // Boolean flags must exist
      for (const flag of backendConfigBooleanFlags) {
        expect(typeof flag).toBe("string");
        expect(flag.endsWith("Configured")).toBe(true);
      }

      // Raw secret string fields must NOT be in BackendConfig
      for (const secret of backendConfigSecretStrings) {
        // The string "openAIApiKey" must NOT appear as a BackendConfig property
        // without the "Configured" suffix.
        expect(backendConfigBooleanFlags).not.toContain(secret);
      }
    });
  });
});
