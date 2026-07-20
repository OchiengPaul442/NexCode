/**
 * NC-024 regression: Secret migration must delete plaintext settings after
 * copying to SecretStorage, and must be idempotent.
 *
 * This test suite validates:
 * - Legacy plaintext keys are cleaned up after migration
 * - Migration is idempotent (running twice is safe)
 * - Plaintext remnants are detected correctly
 * - Canary secrets do not survive migration into config
 * - The migration flag is set after completion
 * - SecretStorage receives the correct values
 * - Empty/whitespace values are not migrated
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Constants (mirrored from extension/src/secretService.ts)            */
/* ------------------------------------------------------------------ */

/**
 * The workspace configuration keys that hold legacy plaintext secrets.
 * Must match SECRET_KEYS in secretService.ts.
 */
const LEGACY_PLAINTEXT_KEYS = [
  "openAIApiKey",
  "searchApiKey",
  "tavilyApiKey",
] as const;

/**
 * SecretStorage key names. Must match SECRET_KEYS values in secretService.ts.
 */
const SECRET_STORAGE_KEYS = {
  openAIApiKey: "nexcode.openAIApiKey",
  searchApiKey: "nexcode.searchApiKey",
  tavilyApiKey: "nexcode.tavilyApiKey",
} as const;

const MIGRATION_FLAG = "nexcode.secrets.migrated";

/**
 * Sentinel value used to detect whether a secret leaked into config.
 */
const CANARY_SECRET = "nc024-canary-secret-do-not-remain";

/* ------------------------------------------------------------------ */
/*  Mock types                                                         */
/* ------------------------------------------------------------------ */

interface MockSecretStorage {
  store: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  onDidChange: ReturnType<typeof vi.fn>;
}

interface MockWorkspaceConfiguration {
  get: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

function createMockSecretStorage(
  initial: Record<string, string> = {},
): MockSecretStorage {
  const store = new Map(Object.entries(initial));
  return {
    store: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key: string) => {
      return store.get(key) ?? undefined;
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    onDidChange: vi.fn(),
  };
}

function createMockConfig(
  plaintextValues: Record<string, string> = {},
): MockWorkspaceConfiguration {
  const values = new Map(Object.entries(plaintextValues));
  return {
    get: vi.fn((key: string, defaultValue: string) => {
      return values.get(key) ?? defaultValue;
    }),
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value as string);
      }
    }),
  };
}

/* ------------------------------------------------------------------ */
/*  Migration logic (mirrored from secretService.ts for testability)   */
/* ------------------------------------------------------------------ */

/**
 * Mirrors the migration logic from SecretService.migrateFromSettings().
 *
 * This pure-logic version accepts injected dependencies so it can be
 * tested without VS Code APIs. The actual SecretService delegates to
 * the same algorithm.
 */
async function migrateFromSettingsLogic(
  secretStorage: MockSecretStorage,
  config: MockWorkspaceConfiguration,
): Promise<void> {
  let anyPlaintextCleaned = false;

  for (const [key, secretKey] of Object.entries(SECRET_STORAGE_KEYS)) {
    const value = config.get(key, "");
    if (value.trim()) {
      await secretStorage.store(secretKey, value);
      await config.update(key, undefined);
      anyPlaintextCleaned = true;
    }
  }

  if (!anyPlaintextCleaned) {
    for (const key of LEGACY_PLAINTEXT_KEYS) {
      const value = config.get(key, "");
      if (value.trim()) {
        await config.update(key, undefined);
      }
    }
  }

  await secretStorage.store(MIGRATION_FLAG, "true");
}

/**
 * Check whether any legacy plaintext secret values still exist in config.
 */
function hasPlaintextRemnants(
  config: MockWorkspaceConfiguration,
): boolean {
  for (const key of LEGACY_PLAINTEXT_KEYS) {
    const value = config.get(key, "");
    if (value.trim()) {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("NC-024 — Secret migration deletes plaintext settings", () => {
  describe("migrateFromSettings logic", () => {
    it("copies plaintext values to SecretStorage", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({
        openAIApiKey: "sk-test-123",
        searchApiKey: "search-key-456",
      });

      await migrateFromSettingsLogic(storage, config);

      expect(storage.store).toHaveBeenCalledWith(
        "nexcode.openAIApiKey",
        "sk-test-123",
      );
      expect(storage.store).toHaveBeenCalledWith(
        "nexcode.searchApiKey",
        "search-key-456",
      );
    });

    it("removes plaintext values from config after copying", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({
        openAIApiKey: "sk-test-123",
        searchApiKey: "search-key-456",
        tavilyApiKey: "tavily-789",
      });

      await migrateFromSettingsLogic(storage, config);

      // Each key should have been updated with undefined to remove it
      expect(config.update).toHaveBeenCalledWith("openAIApiKey", undefined);
      expect(config.update).toHaveBeenCalledWith("searchApiKey", undefined);
      expect(config.update).toHaveBeenCalledWith("tavilyApiKey", undefined);
    });

    it("sets migration flag after completion", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({ openAIApiKey: "sk-test" });

      await migrateFromSettingsLogic(storage, config);

      expect(storage.store).toHaveBeenCalledWith(MIGRATION_FLAG, "true");
    });

    it("does not migrate empty or whitespace-only values", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({
        openAIApiKey: "   ",
        searchApiKey: "",
      });

      await migrateFromSettingsLogic(storage, config);

      // Should not store empty values
      expect(storage.store).not.toHaveBeenCalledWith(
        "nexcode.openAIApiKey",
        expect.anything(),
      );
      expect(storage.store).not.toHaveBeenCalledWith(
        "nexcode.searchApiKey",
        expect.anything(),
      );
      // Only the migration flag should be stored
      expect(storage.store).toHaveBeenCalledTimes(1);
      expect(storage.store).toHaveBeenCalledWith(MIGRATION_FLAG, "true");
    });

    it("handles no plaintext values gracefully", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({});

      await migrateFromSettingsLogic(storage, config);

      // Only migration flag stored
      expect(storage.store).toHaveBeenCalledTimes(1);
      expect(storage.store).toHaveBeenCalledWith(MIGRATION_FLAG, "true");
      // No config updates needed
      expect(config.update).not.toHaveBeenCalled();
    });

    it("is idempotent — running twice does not cause issues", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({
        openAIApiKey: "sk-test-123",
      });

      // First migration
      await migrateFromSettingsLogic(storage, config);
      expect(storage.store).toHaveBeenCalledWith(
        "nexcode.openAIApiKey",
        "sk-test-123",
      );
      expect(config.update).toHaveBeenCalledWith("openAIApiKey", undefined);

      // Clear mock call counts
      storage.store.mockClear();
      config.update.mockClear();

      // Second migration — no plaintext to migrate
      await migrateFromSettingsLogic(storage, config);

      // No secret values stored (nothing to migrate)
      expect(storage.store).not.toHaveBeenCalledWith(
        "nexcode.openAIApiKey",
        expect.anything(),
      );
      // Only migration flag
      expect(storage.store).toHaveBeenCalledTimes(1);
      expect(storage.store).toHaveBeenCalledWith(MIGRATION_FLAG, "true");
      // No config updates needed
      expect(config.update).not.toHaveBeenCalled();
    });

    it("cleans up plaintext remnants even if migration was previously flagged", async () => {
      // Simulate: migration was previously marked complete but plaintext
      // was not removed (the pre-fix behavior).
      const storage = createMockSecretStorage({
        [MIGRATION_FLAG]: "true",
        "nexcode.openAIApiKey": "sk-old-key",
      });
      const config = createMockConfig({
        openAIApiKey: "sk-old-key-plaintext",
      });

      // The logic should detect plaintext and clean it up
      await migrateFromSettingsLogic(storage, config);

      // Plaintext should be removed
      expect(config.update).toHaveBeenCalledWith("openAIApiKey", undefined);
      // SecretStorage should have the value
      expect(storage.store).toHaveBeenCalledWith(
        "nexcode.openAIApiKey",
        "sk-old-key-plaintext",
      );
    });
  });

  describe("hasPlaintextRemnants", () => {
    it("returns true when plaintext secrets exist", () => {
      const config = createMockConfig({
        openAIApiKey: "sk-real-key",
      });
      expect(hasPlaintextRemnants(config)).toBe(true);
    });

    it("returns false when no plaintext secrets exist", () => {
      const config = createMockConfig({});
      expect(hasPlaintextRemnants(config)).toBe(false);
    });

    it("returns false for empty or whitespace values", () => {
      const config = createMockConfig({
        openAIApiKey: "   ",
        searchApiKey: "",
      });
      expect(hasPlaintextRemnants(config)).toBe(false);
    });

    it("returns true if any one key has a plaintext value", () => {
      const config = createMockConfig({
        openAIApiKey: "",
        searchApiKey: "real-key",
        tavilyApiKey: "",
      });
      expect(hasPlaintextRemnants(config)).toBe(true);
    });
  });

  describe("Canary secret safety", () => {
    it("canary secret does not survive migration into config", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({
        openAIApiKey: CANARY_SECRET,
      });

      await migrateFromSettingsLogic(storage, config);

      // Config should no longer have the canary
      expect(config.get("openAIApiKey", "")).toBe("");
      // Storage should have it
      expect(storage.store).toHaveBeenCalledWith(
        "nexcode.openAIApiKey",
        CANARY_SECRET,
      );
    });

    it("serialized post-migration config must not contain canary", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({
        openAIApiKey: CANARY_SECRET,
        searchApiKey: CANARY_SECRET,
        tavilyApiKey: CANARY_SECRET,
      });

      await migrateFromSettingsLogic(storage, config);

      // Simulate reading the config after migration
      const postMigrationKeys = LEGACY_PLAINTEXT_KEYS.map((key) =>
        config.get(key, ""),
      );
      const serialized = JSON.stringify(postMigrationKeys);

      expect(serialized).not.toContain(CANARY_SECRET);
    });
  });

  describe("LEGACY_PLAINTEXT_KEYS coverage", () => {
    it("covers all expected secret configuration keys", () => {
      expect(LEGACY_PLAINTEXT_KEYS).toContain("openAIApiKey");
      expect(LEGACY_PLAINTEXT_KEYS).toContain("searchApiKey");
      expect(LEGACY_PLAINTEXT_KEYS).toContain("tavilyApiKey");
      expect(LEGACY_PLAINTEXT_KEYS).toHaveLength(3);
    });

    it("SECRET_STORAGE_KEYS maps to correct SecretStorage names", () => {
      expect(SECRET_STORAGE_KEYS.openAIApiKey).toBe("nexcode.openAIApiKey");
      expect(SECRET_STORAGE_KEYS.searchApiKey).toBe("nexcode.searchApiKey");
      expect(SECRET_STORAGE_KEYS.tavilyApiKey).toBe("nexcode.tavilyApiKey");
    });
  });

  describe("Migration stores secrets before removing plaintext", () => {
    it("secret is in storage before config is cleaned", async () => {
      const callOrder: string[] = [];
      const storage = createMockSecretStorage();
      storage.store.mockImplementation(async (key: string) => {
        callOrder.push(`store:${key}`);
      });

      const config = createMockConfig({
        openAIApiKey: "sk-sequential-test",
      });
      config.update.mockImplementation(async (key: string) => {
        callOrder.push(`update:${key}`);
      });

      await migrateFromSettingsLogic(storage, config);

      // store must come before update for the same key
      const storeIdx = callOrder.indexOf("store:nexcode.openAIApiKey");
      const updateIdx = callOrder.indexOf("update:openAIApiKey");
      expect(storeIdx).toBeLessThan(updateIdx);
    });
  });

  describe("Partial migration recovery", () => {
    it("cleans up remaining plaintext keys if some were already cleaned", async () => {
      const storage = createMockSecretStorage();
      const config = createMockConfig({
        openAIApiKey: "sk-still-here",
        // searchApiKey and tavilyApiKey already cleaned
      });

      await migrateFromSettingsLogic(storage, config);

      expect(config.update).toHaveBeenCalledWith("openAIApiKey", undefined);
      expect(storage.store).toHaveBeenCalledWith(
        "nexcode.openAIApiKey",
        "sk-still-here",
      );
      expect(storage.store).toHaveBeenCalledWith(MIGRATION_FLAG, "true");
    });
  });
});
