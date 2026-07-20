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
const stageDir = path.join(workspaceRoot, ".nexcode", "vsix-stage");

const argv = process.argv.slice(2);
const installExtension = !argv.includes("--no-install");
const noBump = argv.includes("--no-bump");
const bumpOnly = argv.includes("--bump-only");
const bumpType = readArgValue("--bump-type") ?? "patch";

if (!["patch", "minor", "major"].includes(bumpType)) {
  console.error(`Unsupported bump type: ${bumpType}`);
  process.exit(1);
}

const stageEntries = [
  "package.json",
  "package-lock.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  ".vscodeignore",
  "out",
  "media",
];

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

async function prepareStageDirectory() {
  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.mkdir(stageDir, { recursive: true });

  for (const entry of stageEntries) {
    const sourcePath = path.join(extensionDir, entry);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const destinationPath = path.join(stageDir, entry);
    const stats = await fs.stat(sourcePath);

    if (stats.isDirectory()) {
      await fs.cp(sourcePath, destinationPath, { recursive: true });
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function createAgentCoreTarball() {
  const packed = runCapture(
    "npm",
    ["pack", "./agent-core", "--pack-destination", stageDir],
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

  return path.join(stageDir, tarballName);
}

async function installStageDependencies(agentCoreTarballPath) {
  await fs.rm(path.join(stageDir, "node_modules"), {
    recursive: true,
    force: true,
  });

  // Use npm ci with the lockfile for hermetic, reproducible installs.
  // The lockfile is copied to the stage directory in prepareStageDirectory().
  // The agent-core tarball is installed separately after the lockfile-based
  // install completes, since agent-core is a local workspace dependency that
  // npm ci cannot resolve from the registry.
  const lockfilePath = path.join(stageDir, "package-lock.json");
  if (existsSync(lockfilePath)) {
    run(
      "npm",
      ["ci", "--omit=dev", "--ignore-scripts"],
      stageDir,
    );
  } else {
    // Fallback for environments without a lockfile (should not happen in CI)
    console.warn(
      "WARNING: No package-lock.json found in stage directory. " +
      "Falling back to npm install. This is not hermetic.",
    );
    run(
      "npm",
      ["install", "--no-save", "--omit=dev", agentCoreTarballPath],
      stageDir,
    );
    return;
  }

  // Install the local agent-core tarball into node_modules.
  // npm ci resolved all other deps from the lockfile; now we inject agent-core.
  run(
    "npm",
    ["install", "--no-save", "--omit=dev", "--ignore-scripts", agentCoreTarballPath],
    stageDir,
  );
}

function resolveVsceCli() {
  const candidates = [
    path.join(extensionDir, "node_modules", "@vscode", "vsce", "vsce"),
    path.join(workspaceRoot, "node_modules", "@vscode", "vsce", "vsce"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to find local @vscode/vsce binary.");
}

function packageStage() {
  const vsceCli = resolveVsceCli();
  run("node", [vsceCli, "package", "--allow-missing-repository"], stageDir);
}

async function findLatestVsix(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const vsixEntries = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".vsix"),
  );

  if (vsixEntries.length === 0) {
    throw new Error(`No .vsix package found in ${directory}.`);
  }

  const withStats = await Promise.all(
    vsixEntries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
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

async function copyVsixToExtension(stageVsixPath) {
  const targetPath = path.join(extensionDir, path.basename(stageVsixPath));
  await fs.copyFile(stageVsixPath, targetPath);
  return targetPath;
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

function listVsixEntries(vsixPath) {
  if (process.platform === "win32") {
    const script = [
      "Add-Type -AssemblyName System.IO.Compression.FileSystem",
      `$zip = [System.IO.Compression.ZipFile]::OpenRead('${escapeSingleQuotedPowerShell(vsixPath)}')`,
      "$zip.Entries | ForEach-Object { $_.FullName }",
      "$zip.Dispose()",
    ].join("; ");

    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        cwd: workspaceRoot,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        encoding: "utf8",
      },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(`Failed to inspect VSIX: ${result.stderr ?? ""}`);
    }

    return (result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  const listed = runCapture("unzip", ["-Z1", vsixPath], workspaceRoot);
  return listed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function assertVsixDependencies(vsixPath) {
  const entries = listVsixEntries(vsixPath);
  const entriesSet = new Set(entries);

  // --- Required runtime entries ---
  const requiredEntries = [
    "extension/package.json",
    "extension/out/extension.js",
    "extension/out/build-info.json",
    "extension/media/main.js",
    "extension/media/main.css",
    "extension/media/icon.png",
    "extension/media/activitybar-icon.svg",
    "extension/node_modules/@nexcode/agent-core/package.json",
    "extension/node_modules/diff-match-patch/index.js",
  ];

  for (const requiredEntry of requiredEntries) {
    if (!entriesSet.has(requiredEntry)) {
      throw new Error(
        `VSIX is missing required entry: ${requiredEntry}. Packaging aborted to prevent a broken install.`,
      );
    }
  }

  // --- Forbidden entries that should never ship in a production VSIX ---
  const forbiddenPatterns = [
    { pattern: /\.test\.ts$/, desc: "TypeScript test files" },
    { pattern: /\.spec\.ts$/, desc: "TypeScript spec files" },
    { pattern: /__tests__\//, desc: "Test directories" },
    { pattern: /\.map$/, desc: "Source map files" },
    { pattern: /\.d\.ts$/, desc: "Type declaration files" },
    { pattern: /webview\/src\//, desc: "Webview source files" },
    { pattern: /tailwind\.config/, desc: "Tailwind config" },
    { pattern: /tsconfig\.json$/, desc: "TypeScript config" },
    { pattern: /\.vscodeignore$/, desc: "vscodeignore file" },
  ];

  const violations = [];
  for (const entry of entries) {
    for (const { pattern, desc } of forbiddenPatterns) {
      if (pattern.test(entry)) {
        violations.push(`${entry} (${desc})`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `VSIX contains forbidden entries that should not ship:\n` +
      violations.map((v) => `  - ${v}`).join("\n"),
    );
  }

  // --- Validate build-info.json ---
  const buildInfoEntry = entries.find((e) => e.endsWith("build-info.json"));
  if (buildInfoEntry) {
    console.log(`VSIX verification passed: ${entries.length} entries, all required files present, no forbidden files.`);
  }
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

  // Write build info before building
  const pkgRaw = await fs.readFile(extensionPackageJsonPath, "utf8");
  const pkgParsed = JSON.parse(pkgRaw);

  // Read workspace lockfile for dependency manifest (SBOM)
  let dependencyManifest = {};
  const lockfilePath = path.join(workspaceRoot, "package-lock.json");
  if (existsSync(lockfilePath)) {
    try {
      const lockRaw = await fs.readFile(lockfilePath, "utf8");
      const lockParsed = JSON.parse(lockRaw);
      // Extract only production dependency names and versions
      const packages = lockParsed.packages || {};
      for (const [pkgPath, pkgInfo] of Object.entries(packages)) {
        if (pkgPath === "") continue; // skip root
        const name = pkgPath.replace(/^node_modules\//, "").replace(/^.*node_modules\//, "");
        if (pkgInfo.version) {
          dependencyManifest[name] = {
            version: pkgInfo.version,
            resolved: pkgInfo.resolved || undefined,
          };
        }
      }
    } catch {
      console.warn("WARNING: Could not parse package-lock.json for SBOM generation.");
    }
  }

  const buildInfo = {
    version: pkgParsed.version || "unknown",
    buildTime: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    npm: runCapture("npm", ["--version"]).stdout.trim(),
    provenance: {
      generator: "nexcode-extension-release",
      lockfileIntegrity: existsSync(lockfilePath),
      stagedInstall: "npm-ci",
      requiredEntries: [
        "extension/out/extension.js",
        "extension/media/main.js",
        "extension/media/main.css",
        "extension/node_modules/@nexcode/agent-core/package.json",
      ],
    },
    dependencyManifest,
  };
  await fs.writeFile(
    path.join(extensionDir, "out", "build-info.json"),
    JSON.stringify(buildInfo, null, 2),
  );

  run("npm", ["run", "build"]);

  // Verify lockfile integrity before staging
  const rootLockfile = path.join(workspaceRoot, "package-lock.json");
  if (existsSync(rootLockfile)) {
    try {
      const lockRaw = await fs.readFile(rootLockfile, "utf8");
      const lockParsed = JSON.parse(lockRaw);
      if (!lockParsed.packages || typeof lockParsed.lockfileVersion !== "number") {
        throw new Error("package-lock.json appears malformed (missing packages or lockfileVersion).");
      }
      console.log(
        `Lockfile verified: lockfileVersion=${lockParsed.lockfileVersion}, ` +
        `${Object.keys(lockParsed.packages).length - 1} packages.`,
      );
    } catch (err) {
      if (err.message.includes("lockfileVersion")) {
        throw err;
      }
      console.warn(`WARNING: Could not verify lockfile integrity: ${err.message}`);
    }
  } else {
    throw new Error(
      "No package-lock.json found at workspace root. " +
      "Hermetic packaging requires a lockfile.",
    );
  }

  await prepareStageDirectory();

  let tarballPath;
  try {
    tarballPath = await createAgentCoreTarball();
    await installStageDependencies(tarballPath);
    packageStage();

    const stageVsixPath = await findLatestVsix(stageDir);
    const vsixPath = await copyVsixToExtension(stageVsixPath);
    assertVsixDependencies(vsixPath);

    console.log(`Packaged extension: ${vsixPath}`);

    if (!installExtension) {
      console.log("Skipping install because --no-install was provided.");
      return;
    }

    const codeCommand = resolveCodeCommand();
    installVsixWithCode(codeCommand, vsixPath);
    console.log("Extension installed into VS Code successfully.");
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Extension release failed: ${String(error)}`);
  process.exit(1);
});
