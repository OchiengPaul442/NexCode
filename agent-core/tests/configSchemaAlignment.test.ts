/**
 * NC-035: Configuration schema alignment tests.
 *
 * Validates that:
 * 1. Every setting key read at runtime is declared in extension/package.json.
 * 2. Every setting key in the webview allowlist is declared in package.json.
 * 3. No dead/phantom keys exist in the allowlist without package.json declaration.
 * 4. Restricted configurations are a subset of declared properties.
 */

import { describe, it, expect } from "vitest";
import {
  isAllowedSettingKey,
  getAllowedSettingKeys,
} from "../src/utils/webviewMessageValidation";
import * as fs from "fs";
import * as path from "path";

// --- Load package.json configuration properties ---

function loadPackageJsonSettings(): Record<string, unknown> {
  const pkgPath = path.resolve(
    __dirname,
    "../../extension/package.json",
  );
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const props =
    pkg?.contributes?.configuration?.properties ?? {};
  // Strip the "nexcodeKiboko." prefix to get bare setting names
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const bare = key.replace(/^nexcodeKiboko\./, "");
    result[bare] = value;
  }
  return result;
}

function loadRestrictedConfigurations(): string[] {
  const pkgPath = path.resolve(
    __dirname,
    "../../extension/package.json",
  );
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const restricted: string[] =
    pkg?.contributes?.capabilities?.untrustedWorkspaces
      ?.restrictedConfigurations ?? [];
  // Strip the "nexcodeKiboko." prefix
  return restricted.map((k: string) =>
    k.replace(/^nexcodeKiboko\./, ""),
  );
}

// --- Settings read at runtime in sidebarViewProvider.ts getRuntimeSettings() ---
// This is the authoritative list from source inspection.
const RUNTIME_READ_KEYS = [
  "defaultProvider",
  "defaultModel",
  "defaultMode",
  "ollamaBaseUrl",
  "openAIBaseUrl",
  "allowToolCommands",
  "requireTerminalApproval",
  "toolApproval",
  "temperature",
  "modeTemperatures",
  "agentModels.manager",
  "agentModels.primaryWorker",
  "agentModels.lightweightWorker",
  "agentModels.reasoningReviewer",
  "showReasoning",
  "autoApplyChanges",
  "allowWebSearch",
  "searchProvider",
  "searchBaseUrl",
  "allowWorkspacePrompts",
];

describe("NC-035: Configuration schema alignment", () => {
  const packageJsonSettings = loadPackageJsonSettings();
  const restrictedConfigs = loadRestrictedConfigurations();
  const allowedKeys = getAllowedSettingKeys();

  // ---- 1. Runtime reads must be declared in package.json ----

  it("every runtime-read setting is declared in package.json", () => {
    const missing = RUNTIME_READ_KEYS.filter(
      (key) => !(key in packageJsonSettings),
    );
    expect(missing).toEqual([]);
  });

  // ---- 2. ALLOWED_SETTING_KEYS must be declared in package.json ----

  it("every webview-writable key is declared in package.json", () => {
    const missing = [...allowedKeys].filter(
      (key) => !(key in packageJsonSettings),
    );
    expect(missing).toEqual([]);
  });

  // ---- 3. No dead keys in ALLOWED_SETTING_KEYS ----

  it("no dead/phantom keys in allowlist without package.json declaration", () => {
    // These keys previously existed in ALLOWED_SETTING_KEYS but had no
    // package.json declaration and no runtime reads. They were removed in NC-035.
    const deadKeys = [
      "autoApproveWrite",
      "maxConcurrentTasks",
      "theme",
      "mcpServers",
    ];
    for (const key of deadKeys) {
      expect(isAllowedSettingKey(key)).toBe(false);
    }
  });

  // ---- 4. Restricted configurations must be declared ----

  it("every restricted configuration is declared in package.json", () => {
    const missing = restrictedConfigs.filter(
      (key) => !(key in packageJsonSettings),
    );
    expect(missing).toEqual([]);
  });

  // ---- 5. Security-sensitive endpoint keys are restricted ----

  it("provider endpoint URLs are in restrictedConfigurations", () => {
    expect(restrictedConfigs).toContain("openAIBaseUrl");
    expect(restrictedConfigs).toContain("ollamaBaseUrl");
    expect(restrictedConfigs).toContain("searchProvider");
    expect(restrictedConfigs).toContain("searchBaseUrl");
  });

  // ---- 6. Secret keys are never in the allowlist ----

  it("secret keys are excluded from the webview allowlist", () => {
    const secretKeys = [
      "openAIApiKey",
      "searchApiKey",
      "tavilyApiKey",
      "apiKey",
      "secret",
      "token",
    ];
    for (const key of secretKeys) {
      expect(isAllowedSettingKey(key)).toBe(false);
    }
  });

  // ---- 7. Package.json has expected types for new declarations ----

  it("openAIBaseUrl is declared as string type", () => {
    const setting = packageJsonSettings["openAIBaseUrl"] as any;
    expect(setting).toBeDefined();
    expect(setting.type).toBe("string");
    expect(typeof setting.default).toBe("string");
  });

  it("ollamaBaseUrl is declared as string type", () => {
    const setting = packageJsonSettings["ollamaBaseUrl"] as any;
    expect(setting).toBeDefined();
    expect(setting.type).toBe("string");
    expect(setting.default).toBe("http://localhost:11434");
  });

  it("searchProvider is declared with enum values", () => {
    const setting = packageJsonSettings["searchProvider"] as any;
    expect(setting).toBeDefined();
    expect(setting.type).toBe("string");
    expect(Array.isArray(setting.enum)).toBe(true);
    expect(setting.enum).toContain("tavily");
  });

  it("searchBaseUrl is declared as string type", () => {
    const setting = packageJsonSettings["searchBaseUrl"] as any;
    expect(setting).toBeDefined();
    expect(setting.type).toBe("string");
  });

  // ---- 8. Every declared property has required fields ----

  it("every declared setting has type and description", () => {
    for (const [key, value] of Object.entries(packageJsonSettings)) {
      const setting = value as Record<string, unknown>;
      expect(
        setting.type,
        `Setting "${key}" missing "type"`,
      ).toBeDefined();
      expect(
        setting.description,
        `Setting "${key}" missing "description"`,
      ).toBeDefined();
    }
  });
});
