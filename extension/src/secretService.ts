import * as vscode from "vscode";

const SECRET_KEYS = {
  openAIApiKey: "nexcode.openAIApiKey",
  searchApiKey: "nexcode.searchApiKey",
  tavilyApiKey: "nexcode.tavilyApiKey",
} as const;

type SecretKey = keyof typeof SECRET_KEYS;

/**
 * The workspace configuration keys that hold legacy plaintext secrets.
 * Used both for migration and for cleanup/removal after migration.
 */
export const LEGACY_PLAINTEXT_KEYS = Object.keys(SECRET_KEYS);

export class SecretService {
  private static readonly MIGRATION_FLAG = "nexcode.secrets.migrated";

  public constructor(private readonly secretStorage: vscode.SecretStorage) {}

  /**
   * Migrate legacy plaintext secrets from workspace configuration into
   * SecretStorage, then remove the plaintext values from the config.
   *
   * This method is idempotent: if the migration flag is already set but
   * plaintext remnants still exist in the configuration, they will be
   * cleaned up. The flag is set only after all cleanup completes.
   */
  public async migrateFromSettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration("nexcodeKiboko");
    let anyPlaintextCleaned = false;

    for (const [key, secretKey] of Object.entries(SECRET_KEYS)) {
      const value = config.get<string>(key, "");
      if (value.trim()) {
        // Copy plaintext value into encrypted SecretStorage.
        await this.secretStorage.store(secretKey, value);

        // Remove the plaintext value from workspace configuration.
        // config.update(key, undefined) removes the key from the settings file.
        await config.update(
          key,
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
        anyPlaintextCleaned = true;
      }
    }

    // Also clean up any plaintext remnants even if migration was previously
    // marked complete. This handles the case where the first migration stored
    // the flag but failed to remove the plaintext (the pre-fix behavior).
    if (!anyPlaintextCleaned) {
      await this.cleanupPlaintextRemnants(config);
    }

    await this.secretStorage.store(SecretService.MIGRATION_FLAG, "true");
  }

  /**
   * Check whether any legacy plaintext secret values still exist in the
   * workspace configuration. Used for migration health checks and UI notices.
   */
  public async hasPlaintextRemnants(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration("nexcodeKiboko");
    for (const key of Object.keys(SECRET_KEYS)) {
      const value = config.get<string>(key, "");
      if (value.trim()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Remove any remaining legacy plaintext secret values from the workspace
   * configuration without reading or modifying the stored secrets.
   */
  private async cleanupPlaintextRemnants(
    config: vscode.WorkspaceConfiguration,
  ): Promise<void> {
    for (const key of Object.keys(SECRET_KEYS)) {
      const value = config.get<string>(key, "");
      if (value.trim()) {
        await config.update(
          key,
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
      }
    }
  }

  public async getSecret(key: SecretKey): Promise<string> {
    const secretKey = SECRET_KEYS[key];
    const value = await this.secretStorage.get(secretKey);
    return value ?? "";
  }

  public async setSecret(key: SecretKey, value: string): Promise<void> {
    const secretKey = SECRET_KEYS[key];
    if (value.trim()) {
      await this.secretStorage.store(secretKey, value);
    } else {
      await this.secretStorage.delete(secretKey);
    }
  }

  public async deleteSecret(key: SecretKey): Promise<void> {
    const secretKey = SECRET_KEYS[key];
    await this.secretStorage.delete(secretKey);
  }

  public async hasSecret(key: SecretKey): Promise<boolean> {
    const secretKey = SECRET_KEYS[key];
    const value = await this.secretStorage.get(secretKey);
    return !!value?.trim();
  }

  public async getAllSecrets(): Promise<Record<SecretKey, string>> {
    const result: Record<string, string> = {};
    for (const key of Object.keys(SECRET_KEYS) as SecretKey[]) {
      result[key] = await this.getSecret(key);
    }
    return result;
  }
}
