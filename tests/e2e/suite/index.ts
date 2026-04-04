import * as path from "path";
import Mocha from "mocha";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", timeout: 120000 });
  const testsRoot = __dirname;

  return new Promise((resolve, reject) => {
    try {
      mocha.addFile(path.join(testsRoot, "extension.test.js"));
      mocha.addFile(path.join(testsRoot, "webviewInteraction.test.js"));
      mocha.addFile(path.join(testsRoot, "webviewStreamCancel.test.js"));
      mocha.addFile(path.join(testsRoot, "webviewApplyPatch.test.js"));
      mocha.addFile(path.join(testsRoot, "webviewSuggestion.test.js"));
      mocha.addFile(path.join(testsRoot, "webviewMemory.test.js"));
      mocha.addFile(path.join(testsRoot, "webviewGutterClick.test.js"));
      mocha.addFile(path.join(testsRoot, "webviewScrollSync.test.js"));
      mocha.addFile(path.join(testsRoot, "commandApplyPatch.test.js"));
      mocha.run((failures) => {
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
