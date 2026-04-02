import * as path from "path";

// Bridge to include unit tests in the extension-suite runner.
// This file simply requires compiled unit test bundles so they are executed
// as part of the VS Code extension test run.
const unitInline = path.join(
  __dirname,
  "..",
  "unit",
  "inlineCompletion.unit.test.js",
);
try {
  require(unitInline);
} catch (e) {
  // if unit tests are not compiled yet, let the test runner fail later with clear error
  throw e;
}
