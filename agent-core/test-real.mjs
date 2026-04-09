import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNexcodeOrchestrator } from "./dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const model = process.env.NEXCODE_REAL_MODEL ?? "qwen2.5-coder:7b";
const memoryDir = path.join(os.tmpdir(), "nexcode-real-test-memory");
const legacyWorkspaceMemoryDir = path.join(
  repoRoot,
  ".tmp",
  "real-test-memory",
);

const cases = [
  {
    name: "coder-basic",
    mode: "coder",
    prompt:
      "Write a TypeScript function named sumEvenNumbers that returns the sum of even integers in an array.",
    mustInclude: ["sumEvenNumbers"],
  },
  {
    name: "planner-retry",
    mode: "planner",
    prompt:
      "Create a concise implementation plan for adding retry and timeout logic to a TypeScript fetch client.",
    mustInclude: ["Summary", "retry", "timeout"],
  },
  {
    name: "reviewer-code-smell",
    mode: "reviewer",
    prompt: [
      "Review this TypeScript and list concrete issues only:",
      "```ts",
      "function formatUser(user: any) {",
      '  return user.name.toUpperCase() + " " + user.age.toFixed(0);',
      "}",
      "```",
    ].join("\n"),
    mustInclude: ["provided snippet"],
    mustNotInclude: ["Assuming this is the file path"],
  },
  {
    name: "qa-tests",
    mode: "qa",
    prompt: [
      "Suggest focused tests for this function:",
      "```ts",
      "export function divide(a: number, b: number) {",
      "  return a / b;",
      "}",
      "```",
    ].join("\n"),
    mustInclude: ["Test Strategy"],
  },
  {
    name: "tool-search",
    mode: "auto",
    prompt: "/tool search orchestrator",
    mustInclude: ["Tool Execution"],
  },
];

function validateOutput(testCase, finalText) {
  const failures = [];
  const normalized = finalText.trim();

  if (!normalized) {
    failures.push("output was empty");
  }

  if (/status note/i.test(normalized)) {
    failures.push("output contained unrelated status-note content");
  }

  if (/reply with the mode name/i.test(normalized)) {
    failures.push("output leaked internal prompt instructions");
  }

  for (const value of testCase.mustInclude ?? []) {
    if (!normalized.toLowerCase().includes(String(value).toLowerCase())) {
      failures.push(`missing required content: ${value}`);
    }
  }

  for (const value of testCase.mustNotInclude ?? []) {
    if (normalized.toLowerCase().includes(String(value).toLowerCase())) {
      failures.push(`contained forbidden content: ${value}`);
    }
  }

  return failures;
}

async function runCase(orchestrator, testCase) {
  const startedAt = Date.now();
  const statuses = [];
  let streamedText = "";
  let finalResponse;

  const request = {
    prompt: testCase.prompt,
    mode: testCase.mode,
    provider: "ollama",
    model,
    temperature: 0.2,
    abortSignal: new AbortController().signal,
    workspaceRoot: repoRoot,
  };

  console.log(`\n=== ${testCase.name} (${testCase.mode}) ===`);
  console.log(`Prompt: ${testCase.prompt.split("\n")[0]}`);

  for await (const event of orchestrator.stream(request)) {
    if (event.type === "status") {
      statuses.push(event.message);
      continue;
    }

    if (event.type === "token") {
      streamedText += event.token;
      continue;
    }

    if (event.type === "final") {
      finalResponse = event.response;
    }
  }

  const durationMs = Date.now() - startedAt;
  const finalText = String(finalResponse?.text ?? streamedText ?? "").trim();
  const preview = finalText.replace(/\s+/g, " ").slice(0, 220);
  const failures = validateOutput(testCase, finalText);
  const passed = failures.length === 0;

  console.log(`Statuses: ${statuses.slice(-4).join(" | ")}`);
  console.log(`Duration: ${durationMs}ms`);
  console.log(`Output preview: ${preview || "<empty>"}`);
  if (failures.length > 0) {
    console.log(`Validation issues: ${failures.join(" | ")}`);
  }

  return {
    name: testCase.name,
    passed,
    durationMs,
    outputLength: finalText.length,
    failures,
  };
}

async function main() {
  await fs.rm(memoryDir, { recursive: true, force: true });
  await fs.rm(legacyWorkspaceMemoryDir, { recursive: true, force: true });
  await fs.mkdir(memoryDir, { recursive: true });

  const orchestrator = createNexcodeOrchestrator({
    workspaceRoot: repoRoot,
    promptsDir: path.join(repoRoot, "prompts"),
    memoryDir,
    defaultProvider: "ollama",
    defaultModel: model,
  });

  const results = [];

  for (const testCase of cases) {
    try {
      results.push(await runCase(orchestrator, testCase));
    } catch (error) {
      console.error(`Case failed: ${testCase.name}`, error);
      results.push({
        name: testCase.name,
        passed: false,
        durationMs: 0,
        outputLength: 0,
        failures: [String(error)],
      });
    }
  }

  const failed = results.filter((result) => !result.passed);

  console.log("\n=== Summary ===");
  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.name} | ${result.durationMs}ms | output ${result.outputLength}`,
    );
    if (!result.passed) {
      console.log(`  Reasons: ${result.failures.join(" | ")}`);
    }
  }

  if (failed.length > 0) {
    await fs.rm(memoryDir, { recursive: true, force: true });
    await fs.rm(legacyWorkspaceMemoryDir, { recursive: true, force: true });
    console.error(`\n${failed.length} case(s) failed.`);
    process.exitCode = 1;
    return;
  }

  await fs.rm(memoryDir, { recursive: true, force: true });
  await fs.rm(legacyWorkspaceMemoryDir, { recursive: true, force: true });
  console.log(
    `\nAll ${results.length} real-model cases passed using ${model}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
