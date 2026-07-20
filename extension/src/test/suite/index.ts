import * as path from "path";

// Use dynamic import to avoid TypeScript constructor issues with Mocha
export async function run(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Mocha = require("mocha");
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 30_000,
    reporter: "spec",
  });

  const testsRoot = path.resolve(__dirname, ".");

  return new Promise<void>((resolve, reject) => {
    // Use Node.js fs to find test files
    const fs = require("fs");
    const testFiles: string[] = [];

    function findTestFiles(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findTestFiles(fullPath);
        } else if (entry.name.endsWith(".test.js")) {
          testFiles.push(fullPath);
        }
      }
    }

    findTestFiles(testsRoot);

    for (const file of testFiles) {
      mocha.addFile(file);
    }

    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
