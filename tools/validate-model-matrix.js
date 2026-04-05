const fs = require("fs");
const path = require("path");
const { NexcodeOrchestrator } = require("../agent-core/dist");

const workspaceRoot = process.cwd();
const models = [
  "kimi-k2.5:cloud",
  "qwen3-coder:480b-cloud",
  "qwen2.5-coder:7b",
  "nemotron-mini:latest",
];

function safeName(input) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function readLongTermMemoryCount() {
  const memoryPath = path.join(
    workspaceRoot,
    "memory",
    "long-term-memory.json",
  );
  if (!fs.existsSync(memoryPath)) {
    return 0;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(memoryPath, "utf8"));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

async function runRequest(orchestrator, model, request) {
  let final = null;
  let error = null;

  for await (const event of orchestrator.stream({
    provider: "ollama",
    model,
    workspaceRoot,
    allowTools: true,
    ...request,
  })) {
    if (event.type === "final") {
      final = event.response;
    }
    if (event.type === "error") {
      error = event.message;
    }
  }

  if (error) {
    throw new Error(error);
  }

  if (!final) {
    throw new Error("No final response emitted");
  }

  return final;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runModelSuite(orchestrator, model) {
  const modelTag = safeName(model);
  const baseFileA = path.join(
    workspaceRoot,
    ".nexcode",
    `tool-${modelTag}-a.txt`,
  );
  const baseFileB = path.join(
    workspaceRoot,
    ".nexcode",
    `tool-${modelTag}-b.txt`,
  );
  const editFile = path.join(workspaceRoot, ".nexcode", `edit-${modelTag}.md`);

  fs.mkdirSync(path.join(workspaceRoot, ".nexcode"), { recursive: true });

  const caseResults = [];

  async function runCase(name, fn) {
    const startedAt = Date.now();
    try {
      await fn();
      caseResults.push({
        model,
        case: name,
        ok: true,
        durationMs: Date.now() - startedAt,
      });
      console.log(
        `PASS model=${model} case=${name} durationMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      caseResults.push({
        model,
        case: name,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: String(error),
      });
      console.log(
        `FAIL model=${model} case=${name} durationMs=${Date.now() - startedAt} error=${String(error)}`,
      );
    }
  }

  await runCase("real-world-auto", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt:
        "You are leading a production migration for an ecommerce checkout API. Provide an actionable implementation plan with reliability controls, idempotency strategy, observability, rollback strategy, and high-value test plan.",
    });

    assert((final.text || "").length > 120, "Auto response too short");
    assert((final.text || "").trim().length > 0, "Auto response is empty");
  });

  await runCase("tool-search", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt: "/tool search orchestrator",
    });

    assert(
      /tool execution/i.test(final.text || ""),
      "Search tool response missing execution header",
    );
  });

  await runCase("tool-read", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt: "/tool read README.md",
    });

    assert(
      /tool execution/i.test(final.text || ""),
      "Read tool response missing execution header",
    );
    assert((final.text || "").length > 100, "Read tool response too short");
  });

  await runCase("tool-web-search", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt:
        "/tool web-search VS Code extension webview performance best practices",
    });

    assert(
      /tool execution/i.test(final.text || ""),
      "Web search response missing execution header",
    );
    assert((final.text || "").length > 120, "Web search response too short");
  });

  await runCase("terminal-create-file", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt:
        "/tool terminal node -e \"const fs=require('fs');fs.mkdirSync('.nexcode',{recursive:true});fs.writeFileSync('.nexcode/tool-" +
        modelTag +
        "-a.txt','created');\"",
    });

    assert(
      /tool execution/i.test(final.text || ""),
      "Terminal create response missing execution header",
    );
    assert(
      fs.existsSync(baseFileA),
      "Create-file command did not create expected file",
    );
  });

  await runCase("terminal-move-file", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt:
        "/tool terminal node -e \"const fs=require('fs');fs.renameSync('.nexcode/tool-" +
        modelTag +
        "-a.txt','.nexcode/tool-" +
        modelTag +
        "-b.txt');\"",
    });

    assert(
      /tool execution/i.test(final.text || ""),
      "Terminal move response missing execution header",
    );
    assert(
      fs.existsSync(baseFileB),
      "Move-file command did not move expected file",
    );
  });

  await runCase("terminal-delete-file", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt:
        "/tool terminal node -e \"const fs=require('fs');fs.unlinkSync('.nexcode/tool-" +
        modelTag +
        "-b.txt');\"",
    });

    assert(
      /tool execution/i.test(final.text || ""),
      "Terminal delete response missing execution header",
    );
    assert(
      !fs.existsSync(baseFileB),
      "Delete-file command did not delete expected file",
    );
  });

  await runCase("terminal-security-block", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt: "/tool terminal rm -rf /",
    });

    assert(
      /blocked|not allowed|refused|denied/i.test(final.text || ""),
      "Dangerous command was not blocked",
    );
  });

  await runCase("edit-proposal-apply", async () => {
    const final = await runRequest(orchestrator, model, {
      mode: "auto",
      prompt:
        "/edit .nexcode/edit-" +
        modelTag +
        ".md :: Write a short status note mentioning model " +
        model,
    });

    assert(
      Array.isArray(final.proposedEdits) && final.proposedEdits.length > 0,
      "No proposed edit generated",
    );
    await orchestrator.applyProposedEdit(final.proposedEdits[0]);
    assert(fs.existsSync(editFile), "Expected edit file was not created");

    const text = fs.readFileSync(editFile, "utf8");
    assert(text.length > 0, "Edit output is empty");
  });

  if (fs.existsSync(editFile)) {
    fs.unlinkSync(editFile);
  }

  if (fs.existsSync(baseFileA)) {
    fs.unlinkSync(baseFileA);
  }

  if (fs.existsSync(baseFileB)) {
    fs.unlinkSync(baseFileB);
  }

  return caseResults;
}

(async () => {
  const orchestrator = new NexcodeOrchestrator({ workspaceRoot });
  const allResults = [];

  const memoryBefore = readLongTermMemoryCount();

  for (const model of models) {
    const results = await runModelSuite(orchestrator, model);
    allResults.push(...results);
  }

  const memoryAfter = readLongTermMemoryCount();
  const memoryDelta = memoryAfter - memoryBefore;

  const passed = allResults.filter((item) => item.ok).length;
  const failed = allResults.filter((item) => !item.ok).length;

  const summary = {
    models,
    total: allResults.length,
    passed,
    failed,
    memoryBefore,
    memoryAfter,
    memoryDelta,
  };

  console.log("SUMMARY " + JSON.stringify(summary));

  const reportPath = path.join(workspaceRoot, "docs", "VALIDATION_REPORT.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ summary, results: allResults }, null, 2),
    "utf8",
  );
  console.log("REPORT " + reportPath);

  if (failed > 0) {
    process.exitCode = 1;
  }
})();
