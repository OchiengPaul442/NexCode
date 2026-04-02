import * as path from "path";
import Mocha = require("mocha");

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "bdd", color: true });
  const testsRoot = path.resolve(__dirname);

  try {
    const files = await collectTestFiles(testsRoot);
    files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

    await new Promise<void>((resolve, reject) => {
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
  } catch (err) {
    return Promise.reject(err);
  }
}

import * as fs from "fs";

async function collectTestFiles(dir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const nested = await collectTestFiles(full);
      results.push(...nested);
    } else if (ent.isFile() && /\.test\.js$/.test(ent.name)) {
      results.push(full);
    }
  }
  return results;
}
