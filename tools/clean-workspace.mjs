#!/usr/bin/env node
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");

const removableTargets = [
  "audit",
  "agent-core/dist",
  "extension/out",
  ".nexcode",
  "memory/feedback-log.jsonl",
  "memory/long-term-memory.json",
  "memory/prompt-versions.json",
];

async function removeTarget(relativeTarget) {
  const absoluteTarget = path.join(workspaceRoot, relativeTarget);
  if (!existsSync(absoluteTarget)) {
    return false;
  }

  await fs.rm(absoluteTarget, {
    recursive: true,
    force: true,
  });
  return true;
}

async function removeVsixPackages() {
  const extensionDir = path.join(workspaceRoot, "extension");
  if (!existsSync(extensionDir)) {
    return 0;
  }

  const entries = await fs.readdir(extensionDir, { withFileTypes: true });
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".vsix")) {
      continue;
    }

    await fs.rm(path.join(extensionDir, entry.name), { force: true });
    removed += 1;
  }

  return removed;
}

async function main() {
  const removed = [];
  for (const target of removableTargets) {
    if (await removeTarget(target)) {
      removed.push(target);
    }
  }

  const vsixRemoved = await removeVsixPackages();
  if (vsixRemoved > 0) {
    removed.push(
      `extension/*.vsix (${vsixRemoved} file${vsixRemoved === 1 ? "" : "s"})`,
    );
  }

  if (removed.length === 0) {
    console.log("Workspace cleanup completed. Nothing to remove.");
    return;
  }

  console.log("Workspace cleanup completed. Removed:");
  for (const item of removed) {
    console.log(`- ${item}`);
  }
}

main().catch((error) => {
  console.error(`Cleanup failed: ${String(error)}`);
  process.exit(1);
});
