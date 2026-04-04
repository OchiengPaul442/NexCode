let vscode: any;
try {
  // runtime require to avoid needing @types/vscode in test environments
  // where the VS Code API is not present.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscode = require("vscode");
} catch (e) {
  vscode = undefined;
}

export class ConfigManager {
  static get<T>(key: string): T | undefined {
    // Accept either full key like 'kiboko.provider' or short key like 'provider'
    const cfgKey = key.startsWith("kiboko.")
      ? key.substring("kiboko.".length)
      : key;
    try {
      if (!vscode) return undefined;
      const cfg = vscode.workspace.getConfiguration("kiboko");
      const val = cfg.get(cfgKey);
      return val as T | undefined;
    } catch (e) {
      return undefined;
    }
  }

  static async getSecret(context: any, key: string) {
    if (!vscode) return undefined;
    return await context.secrets.get(key);
  }

  static async setSecret(context: any, key: string, value: string) {
    if (!vscode) return;
    return await context.secrets.store(key, value);
  }
}
