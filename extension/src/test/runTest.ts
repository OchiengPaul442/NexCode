import * as path from "path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../..");
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    // Use the extension directory itself as the workspace folder for tests
    const workspacePath = path.resolve(__dirname, "../../..");

    // Download VS Code if needed, then run tests
    const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");

    const exitCode = await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath, // Open workspace folder
        "--disable-extensions",
        "--disable-gpu",
        "--no-sandbox",
      ],
    });

    process.exit(exitCode);
  } catch (err) {
    console.error("Failed to run integration tests:", err);
    process.exit(1);
  }
}

main();
