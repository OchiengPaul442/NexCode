import * as vscode from "vscode";

const SECRET_KEYS = {
  openAIApiKey: "nexcode.openAIApiKey",
  tavilyApiKey: "nexcode.tavilyApiKey",
} as const;

type SecretKey = keyof typeof SECRET_KEYS;

export class SecretService {
  private static readonly MIGRATION_FLAG = "nexcode.secrets.migrated";

  public constructor(private readonly secretStorage: vscode.SecretStorage) {}

  public async migrateFromSettings(): Promise<void> {
    const alreadyMigrated = await this.secretStorage.get(
      SecretService.MIGRATION_FLAG,
    );
    if (alreadyMigrated) {
      return;
    }

    const config = vscode.workspace.getConfiguration("nexcodeKiboko");

    for (const [key, secretKey] of Object.entries(SECRET_KEYS)) {
      const value = config.get<string>(key, "");
      if (value.trim()) {
        await this.secretStorage.store(secretKey, value);
      }
    }

    await this.secretStorage.store(SecretService.MIGRATION_FLAG, "true");
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
    return result as Record<SecretKey, string>;
  }
}
