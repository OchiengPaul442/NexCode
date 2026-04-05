#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");
const extensionDir = path.join(workspaceRoot, "extension");
const extensionPackageJsonPath = path.join(extensionDir, "package.json");

const argv = process.argv.slice(2);
const installExtension = !argv.includes("--no-install");
const noBump = argv.includes("--no-bump");
const bumpOnly = argv.includes("--bump-only");
const bumpType = readArgValue("--bump-type") ?? "patch";

if (!["patch", "minor", "major"].includes(bumpType)) {
  console.error(`Unsupported bump type: ${bumpType}`);
  process.exit(1);
}

function readArgValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return undefined;
  }
  return argv[index + 1];
}

function run(command, args, cwd = workspaceRoot) {
  const result = spawnCommand(command, args, cwd, false);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function runCapture(command, args, cwd = workspaceRoot) {
  const result = spawnCommand(command, args, cwd, true);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout || "",
        result.stderr || "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function spawnCommand(command, args, cwd, capture) {
  if (
    process.platform === "win32" &&
    (command === "npm" || command === "npx")
  ) {
    const commandLine = [command, ...args.map(quoteForCmd)].join(" ");
    return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
      encoding: capture ? "utf8" : undefined,
    });
  }

  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    const commandLine = [`"${command}"`, ...args.map(quoteForCmd)].join(" ");
    return spawnSync("cmd.exe", ["/d", "/s", "/c", commandLine], {
      cwd,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: false,
      encoding: capture ? "utf8" : undefined,
    });
  }

  return spawnSync(command, args, {
    cwd,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
    encoding: capture ? "utf8" : undefined,
  });
}

function quoteForCmd(value) {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function bumpVersion(version, type) {
  const parsed = parseVersion(version);
  switch (type) {
    case "major":
      return `${parsed.major + 1}.0.0`;
    case "minor":
      return `${parsed.major}.${parsed.minor + 1}.0`;
    default:
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
}

async function bumpExtensionPackageVersion(type) {
  const raw = await fs.readFile(extensionPackageJsonPath, "utf8");
  const parsed = JSON.parse(raw);

  if (typeof parsed.version !== "string") {
    throw new Error(
      "extension/package.json does not contain a string version.",
    );
  }

  const nextVersion = bumpVersion(parsed.version, type);
  parsed.version = nextVersion;

  await fs.writeFile(
    extensionPackageJsonPath,
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf8",
  );

  return nextVersion;
}

async function findLatestVsix() {
  const entries = await fs.readdir(extensionDir, { withFileTypes: true });
  const vsixEntries = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".vsix"),
  );

  if (vsixEntries.length === 0) {
    throw new Error("No .vsix package found in extension/ after packaging.");
  }

  const withStats = await Promise.all(
    vsixEntries.map(async (entry) => {
      const filePath = path.join(extensionDir, entry.name);
      const stats = await fs.stat(filePath);
      return {
        filePath,
        mtimeMs: stats.mtimeMs,
      };
    }),
  );

  withStats.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return withStats[0].filePath;
}

async function preparePackagedAgentCoreDependency() {
  const packed = runCapture(
    "npm",
    ["pack", "./agent-core", "--pack-destination", extensionDir],
    workspaceRoot,
  );

  const tarballName = packed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);

  if (!tarballName) {
    throw new Error("npm pack did not produce a tarball name.");
  }

  const tarballPath = path.join(extensionDir, tarballName);

  await fs.rm(path.join(extensionDir, "node_modules"), {
    recursive: true,
    force: true,
  });

  run(
    "npm",
    [
      "install",
      "--workspaces=false",
      "--no-save",
      "--omit=dev",
      `./${tarballName}`,
    ],
    extensionDir,
  );

  return tarballPath;
}

function resolveCodeCommand() {
  if (process.platform !== "win32") {
    return "code";
  }

  const candidates = [
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "Microsoft VS Code",
      "bin",
      "code.cmd",
    ),
    path.join(
      process.env.ProgramFiles ?? "",
      "Microsoft VS Code",
      "bin",
      "code.cmd",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "",
      "Microsoft VS Code",
      "bin",
      "code.cmd",
    ),
  ];

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return "code";
}

function installVsixWithCode(codeCommand, vsixPath) {
  if (process.platform !== "win32") {
    run(codeCommand, ["--install-extension", vsixPath, "--force"]);
    return;
  }

  const script = [
    `& '${escapeSingleQuotedPowerShell(codeCommand)}'`,
    `--install-extension '${escapeSingleQuotedPowerShell(vsixPath)}'`,
    "--force",
  ].join(" ");

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      cwd: workspaceRoot,
      stdio: "inherit",
      shell: false,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Failed to install VSIX using ${codeCommand}.`);
  }
}

function escapeSingleQuotedPowerShell(value) {
  return value.replace(/'/g, "''");
}

async function main() {
  if (!noBump) {
    const newVersion = await bumpExtensionPackageVersion(bumpType);
    console.log(`Updated extension version to ${newVersion}`);
  }

  if (bumpOnly) {
    console.log("Bump-only mode complete.");
    return;
  }

  run("npm", ["run", "build"]);
  const tarballPath = await preparePackagedAgentCoreDependency();

  try {
    run("npm", ["run", "package"], extensionDir);
  } finally {
    await fs.rm(tarballPath, { force: true });
  }

  const vsixPath = await findLatestVsix();
  console.log(`Packaged extension: ${vsixPath}`);

  if (!installExtension) {
    console.log("Skipping install because --no-install was provided.");
    return;
  }

  const codeCommand = resolveCodeCommand();
  installVsixWithCode(codeCommand, vsixPath);
  console.log("Extension installed into VS Code successfully.");
}

main().catch((error) => {
  console.error(`Extension release failed: ${String(error)}`);
  process.exit(1);
});
