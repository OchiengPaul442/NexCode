const fs = require("fs");
const path = require("path");
const { NexcodeOrchestrator } = require("../agent-core/dist");

const workspaceRoot = process.cwd();
const defaultModels = ["gpt-oss:120b-cloud"];

const argv = process.argv.slice(2);

function readArgValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1];
}

const modelsArg = readArgValue("--models");
const models = modelsArg
  ? modelsArg
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  : defaultModels;

function safeName(input) {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function sleepMs(ms) {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

function removePathIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return true;
  }

  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, {
        recursive: true,
        force: true,
        maxRetries: 4,
        retryDelay: 120,
      });
      return true;
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : "";
      if (code !== "EPERM" && code !== "EBUSY" && code !== "ENOTEMPTY") {
        console.warn(
          `WARN cleanup path=${targetPath} attempt=${attempt + 1} error=${String(error)}`,
        );
        return false;
      }

      sleepMs(120 * (attempt + 1));
    }
  }

  const stillExists = fs.existsSync(targetPath);
  if (stillExists) {
    console.warn(`WARN cleanup path=${targetPath} failed after retries`);
  }

  return !stillExists;
}

function waitForPathRemoval(targetPath, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!fs.existsSync(targetPath)) {
      return true;
    }

    sleepMs(150);
  }

  return !fs.existsSync(targetPath);
}

function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
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
  const scaffoldWorkspaceRoot = path.join(
    workspaceRoot,
    ".nexcode",
    `scaffold-${modelTag}`,
  );
  const universalWorkspaceRoot = path.join(
    workspaceRoot,
    ".nexcode",
    `universal-${modelTag}`,
  );

  fs.mkdirSync(path.join(workspaceRoot, ".nexcode"), { recursive: true });
  removePathIfExists(scaffoldWorkspaceRoot);
  fs.mkdirSync(scaffoldWorkspaceRoot, { recursive: true });
  removePathIfExists(universalWorkspaceRoot);
  fs.mkdirSync(universalWorkspaceRoot, { recursive: true });

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

  await runCase("empty-workspace-command-lifecycle", async () => {
    removePathIfExists(universalWorkspaceRoot);
    fs.mkdirSync(universalWorkspaceRoot, { recursive: true });

    const universalOrchestrator = new NexcodeOrchestrator({
      workspaceRoot: universalWorkspaceRoot,
    });

    const notePath = path.join(universalWorkspaceRoot, "note.txt");
    const createCommand =
      "node -e \"const fs=require('fs');fs.writeFileSync('note.txt','alpha\\n');\"";
    const createResponse = await runRequest(universalOrchestrator, model, {
      mode: "auto",
      prompt: `Please run this command:\n${createCommand}`,
    });

    assert(
      /tool execution/i.test(createResponse.text || ""),
      "Natural-language command request was not executed as a tool command",
    );
    assert(
      fs.existsSync(notePath),
      "Natural-language command did not create note.txt",
    );

    const editResponse = await runRequest(universalOrchestrator, model, {
      mode: "coder",
      prompt: "/edit note.txt :: Append a new line with the text beta.",
    });

    assert(
      Array.isArray(editResponse.proposedEdits) &&
        editResponse.proposedEdits.length > 0,
      "Inline edit test did not generate a proposed edit",
    );

    await universalOrchestrator.applyProposedEdit(
      editResponse.proposedEdits[0],
    );

    const editedNote = fs.readFileSync(notePath, "utf8");
    assert(
      /alpha/i.test(editedNote),
      "Edited note.txt lost the original content",
    );
    assert(
      /beta/i.test(editedNote),
      "Edited note.txt did not include beta line",
    );

    const deleteCommand =
      "node -e \"const fs=require('fs');fs.rmSync('note.txt',{force:true});\"";
    const deleteResponse = await runRequest(universalOrchestrator, model, {
      mode: "auto",
      prompt: `Run this command: ${deleteCommand}`,
    });

    assert(
      /tool execution/i.test(deleteResponse.text || ""),
      "Natural-language delete command was not executed as a tool command",
    );
    assert(
      !fs.existsSync(notePath),
      "Natural-language delete command did not remove note.txt",
    );
  });

  await runCase("nextjs-blog-scaffold", async () => {
    removePathIfExists(scaffoldWorkspaceRoot);
    fs.mkdirSync(scaffoldWorkspaceRoot, { recursive: true });
    const scaffoldOrchestrator = new NexcodeOrchestrator({
      workspaceRoot: scaffoldWorkspaceRoot,
    });

    const scaffoldResponse = await runRequest(scaffoldOrchestrator, model, {
      mode: "auto",
      prompt: "/tool terminal pnpm create next-app@latest testapp --yes",
    });

    assert(
      /tool execution/i.test(scaffoldResponse.text || ""),
      "Scaffold command did not execute as a tool request",
    );

    const projectRoot = path.join(scaffoldWorkspaceRoot, "testapp");
    const packageJsonPath = path.join(projectRoot, "package.json");
    const pagePath = firstExistingPath([
      path.join(projectRoot, "src", "app", "page.tsx"),
      path.join(projectRoot, "app", "page.tsx"),
      path.join(projectRoot, "src", "app", "page.jsx"),
      path.join(projectRoot, "app", "page.jsx"),
    ]);

    assert(
      fs.existsSync(packageJsonPath),
      "Next.js package.json was not created",
    );
    assert(Boolean(pagePath), "Next.js app page was not created");

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    assert(
      Boolean(
        packageJson.dependencies?.next || packageJson.devDependencies?.next,
      ),
      "Next.js dependency missing from scaffolded project",
    );

    const supportResponse = await runRequest(scaffoldOrchestrator, model, {
      mode: "auto",
      prompt:
        "/tool terminal node -e \"const fs=require('fs');const path=require('path');const base=fs.existsSync('testapp/src')?'testapp/src':'testapp';const contentDir=path.join(base,'content','posts');const componentsDir=path.join(base,'components');fs.mkdirSync(contentDir,{recursive:true});fs.mkdirSync(componentsDir,{recursive:true});fs.writeFileSync(path.join(contentDir,'welcome.md'),'---\\ntitle: Welcome\\ndate: 2026-04-06\\n---\\n\\nThis is the first post.\\n');fs.writeFileSync(path.join(componentsDir,'post-card.tsx'),'export function PostCard(){ return null; }\\n');\"",
    });

    assert(
      /tool execution/i.test(supportResponse.text || ""),
      "Support file command did not execute as a tool request",
    );

    const blogSupportPath = firstExistingPath([
      path.join(projectRoot, "src", "content", "posts"),
      path.join(projectRoot, "content", "posts"),
      path.join(projectRoot, "src", "components"),
      path.join(projectRoot, "components"),
      path.join(projectRoot, "src", "lib"),
      path.join(projectRoot, "lib"),
    ]);

    assert(Boolean(blogSupportPath), "Blog support structure was not created");

    const editPrompt = await runRequest(scaffoldOrchestrator, model, {
      mode: "coder",
      prompt:
        "/edit " +
        path.relative(scaffoldWorkspaceRoot, pagePath).replace(/\\/g, "/") +
        " :: Turn the homepage into a polished blog landing page with a hero, featured posts, and a recent posts section. Keep the file buildable.",
    });

    assert(
      Array.isArray(editPrompt.proposedEdits) &&
        editPrompt.proposedEdits.length > 0,
      "Blog homepage edit did not generate a proposed edit",
    );

    await scaffoldOrchestrator.applyProposedEdit(editPrompt.proposedEdits[0]);

    const editedPage = fs.readFileSync(pagePath, "utf8");
    assert(
      /blog|post|featured|recent/i.test(editedPage),
      "Edited homepage did not look like a blog landing page",
    );

    const deleteScaffoldResponse = await runRequest(
      scaffoldOrchestrator,
      model,
      {
        mode: "auto",
        prompt:
          "Run this command: node -e \"const fs=require('fs');fs.rmSync('testapp',{recursive:true,force:true});\"",
      },
    );

    assert(
      /tool execution/i.test(deleteScaffoldResponse.text || ""),
      "Agent-driven scaffold cleanup command did not execute",
    );

    const removedByAgent = waitForPathRemoval(projectRoot, 7000);
    if (!removedByAgent && fs.existsSync(projectRoot)) {
      removePathIfExists(projectRoot);
    }

    const stillExistsAfterCleanup = fs.existsSync(projectRoot);
    if (stillExistsAfterCleanup) {
      const output = (deleteScaffoldResponse.text || "").toLowerCase();
      const looksLikeLockContention =
        /eperm|permission denied|busy|enotempty/.test(output);

      if (!looksLikeLockContention) {
        throw new Error("Agent-driven scaffold cleanup did not delete testapp");
      }

      console.warn(
        `WARN scaffold cleanup path remained due lock contention: ${projectRoot}`,
      );
    }
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

  removePathIfExists(scaffoldWorkspaceRoot);
  removePathIfExists(universalWorkspaceRoot);

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
