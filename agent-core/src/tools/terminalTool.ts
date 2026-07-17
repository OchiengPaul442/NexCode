import { exec, spawn } from "child_process";
import { promisify } from "util";
import { ToolResult } from "../types";

const execAsync = promisify(exec);

const MAX_COMMAND_LENGTH = 2_000;

const IS_WINDOWS = process.platform === "win32";

// SAFE_COMMANDS - always allowed without approval
// Removed: npm run, npm install, npx, node, python, pip
// These can execute arbitrary code (node -e, python -c, npm postinstall scripts)
// They now require approval via the DESTRUCTIVE_TOOLS gate in toolApprovalPolicy.ts
export const SAFE_PATTERNS = [
  // Unix commands
  /^ls\b/,
  /^pwd\b/,
  /^echo\b/,
  /^cat\b/,
  /^head\b/,
  /^tail\b/,
  /^wc\b/,
  /^git\s+status\b/,
  /^git\s+diff\b/,
  /^git\s+log\b/,
  /^git\s+branch\b/,
  /^git\s+show\b/,
  /^npm\s+test\b/,
  /^cargo\s+(check|build|test|clippy|fmt)\b/,
  /^go\s+(build|test|fmt|vet)\b/,
  // PowerShell commands (Windows)
  /^Get-ChildItem\b/,
  /^Get-Content\b/,
  /^Get-Location\b/,
  /^Set-Location\b/,
  /^Select-String\b/,
  /^Test-Path\b/,
  /^New-Item\b/,
  /^Remove-Item\b/,
  /^Copy-Item\b/,
  /^Move-Item\b/,
  /^Write-Output\b/,
  /^Get-Command\b/,
  /^Compare-Object\b/,
  /^Measure-Object\b/,
  /^Get-PSDrive\b/,
  /^Get-Date\b/,
  /^Expand-Archive\b/,
  /^git\s+status\b/,
  /^git\s+diff\b/,
  /^git\s+log\b/,
  /^git\s+branch\b/,
  /^git\s+show\b/,
  /^npm\s+test\b/,
  // Windows commands
  /^dir\b/i,
  /^cd\b/i,
  /^type\b/i,
  /^where\b/i,
];

// SHELL_EXPANSION_PATTERNS - block command substitution and shell expansion
const SHELL_EXPANSION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\$\(/, reason: 'Command substitution $() is blocked.' },
  { pattern: /`[^`]+`/, reason: 'Backtick command substitution is blocked.' },
  { pattern: /\$\{/, reason: 'Parameter expansion ${} is blocked.' },
  { pattern: /;\s*(?:rm|del|format|mkfs|shutdown|reboot)/i, reason: 'Chained destructive command blocked.' },
  { pattern: /\bnode\s+-e\b/i, reason: 'Inline node execution (node -e) is blocked.' },
  { pattern: /\bpython\s+-c\b/i, reason: 'Inline python execution (python -c) is blocked.' },
  { pattern: /\bpython3\s+-c\b/i, reason: 'Inline python3 execution (python3 -c) is blocked.' },
];

// BLOCKED_COMMANDS - always blocked regardless of approval
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+-rf\s+\//,
    reason: "rm -rf on root is blocked.",
  },
  {
    pattern: /\brm\s+--recursive\s+--force\s+\//,
    reason: "rm --recursive --force on root is blocked.",
  },
  {
    pattern: /\bmkfs\b/,
    reason: "Filesystem formatting is blocked.",
  },
  {
    pattern: /\bformat\s+[a-z]:/i,
    reason: "Disk formatting is blocked.",
  },
  {
    pattern: /\bfork\s+bomb/i,
    reason: "Fork bomb is blocked.",
  },
  {
    pattern: /:(){ :\|:& };:/,
    reason: "Fork bomb syntax is blocked.",
  },
  {
    pattern: /\bcurl\b[^\n]*\|\s*(?:bash|sh|pwsh|powershell)\b/i,
    reason: "Piped download-and-execute commands are blocked.",
  },
  {
    pattern: /\b(?:bash|sh|pwsh|powershell|cmd)\s+(?:-c|\/c)\b/i,
    reason: "Nested shell execution is blocked.",
  },
  {
    pattern: /\bshutdown\b/i,
    reason: "System shutdown is blocked.",
  },
  {
    pattern: /\breboot\b/i,
    reason: "System reboot is blocked.",
  },
  {
    pattern: /\bdel\s+\/s\b/i,
    reason: "Recursive file deletion is blocked.",
  },
  // PowerShell-specific blocked patterns
  {
    pattern: /\bRemove-Item\s+-Recurse\s+-Force\s+[A-Z]:\\/i,
    reason: "Recursive file deletion on root drive is blocked.",
  },
  {
    pattern: /\bFormat-Volume\b/i,
    reason: "Volume formatting is blocked.",
  },
  {
    pattern: /\bStop-Computer\b/i,
    reason: "System shutdown is blocked.",
  },
  {
    pattern: /\bRestart-Computer\b/i,
    reason: "System restart is blocked.",
  },
  {
    pattern: /\bInvoke-WebRequest\b[^\n]*\|\s*(?:Invoke-Expression|IEX)\b/i,
    reason: "Piped download-and-execute is blocked.",
  },
];

const BLOCKED_GIT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "Destructive git reset is blocked.",
  },
  {
    pattern: /\bgit\s+clean\s+-f(?:d|x|fd|fx|fdx)?\b/i,
    reason: "Destructive git clean is blocked.",
  },
  {
    pattern: /\bgit\s+checkout\s+--\b/i,
    reason: "Discarding working tree changes is blocked.",
  },
  {
    pattern: /\bgit\s+restore\s+--source\b/i,
    reason: "Force restore from source is blocked.",
  },
];

function translateLinuxToPowerShell(command: string): string {
  if (!IS_WINDOWS) return command;

  let cmd = command.trim();

  // Handle complex find commands with multiple -iname and -o (OR) conditions
  // Pattern: find [path] -type f \( -iname "*.ext1" -o -iname "*.ext2" \)
  const findComplexMatch = cmd.match(
    /^find\s+(\S*)\s+-type\s+[fd]\s+\\\(\s*(.+?)\s*\\\)/is
  );
  if (findComplexMatch) {
    const searchPath = findComplexMatch[1] || '.';
    const conditions = findComplexMatch[2];
    const inameMatches = [...conditions.matchAll(/-iname\s+"([^"]+)"/gi)];
    if (inameMatches.length > 0) {
      const filters = inameMatches.map(m => m[1]);
      const isFile = cmd.includes('-type f');
      const pathArg = searchPath === '.' ? '' : `-Path "${searchPath}" -Recurse`;
      const filterStr = filters.length === 1 ? `-Filter "${filters[0]}"` : `-Include ${filters.map(f => `"${f}"`).join(',')}`;
      const typeFlag = isFile ? '-File' : '-Directory';
      return `Get-ChildItem ${pathArg} -Recurse ${filterStr} ${typeFlag} -ErrorAction SilentlyContinue`;
    }
  }

  // Simple find patterns
  cmd = cmd.replace(
    /^find\s+\.?\s+-type\s+f\s+-iname\s+"([^"]+)"/i,
    'Get-ChildItem -Recurse -Filter "$1" -File -ErrorAction SilentlyContinue'
  );
  cmd = cmd.replace(
    /^find\s+\.?\s+-type\s+f\s+-iname\s+(\S+)/i,
    'Get-ChildItem -Recurse -Filter $1 -File -ErrorAction SilentlyContinue'
  );
  cmd = cmd.replace(
    /^find\s+\.?\s+-type\s+d\s+-iname\s+"([^"]+)"/i,
    'Get-ChildItem -Recurse -Filter "$1" -Directory -ErrorAction SilentlyContinue'
  );
  cmd = cmd.replace(
    /^find\s+(\S+)\s+-type\s+f\s+-iname\s+"([^"]+)"/i,
    'Get-ChildItem -Path "$1" -Recurse -Filter "$2" -File -ErrorAction SilentlyContinue'
  );
  cmd = cmd.replace(
    /^find\s+(\S+)\s+-type\s+f\s+-iname\s+(\S+)/i,
    'Get-ChildItem -Path "$1" -Recurse -Filter $2 -File -ErrorAction SilentlyContinue'
  );
  cmd = cmd.replace(
    /^find\s+\.?\s+-type\s+f$/i,
    'Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue'
  );
  cmd = cmd.replace(
    /^find\s+\.?\s+-type\s+d$/i,
    'Get-ChildItem -Recurse -Directory -ErrorAction SilentlyContinue'
  );
  cmd = cmd.replace(
    /^find\s+\.?\s+-name\s+"([^"]+)"/i,
    'Get-ChildItem -Recurse -Filter "$1" -ErrorAction SilentlyContinue'
  );
  cmd = cmd.replace(
    /^find\s+(\S+)\s+-name\s+"([^"]+)"/i,
    'Get-ChildItem -Path "$1" -Recurse -Filter "$2" -ErrorAction SilentlyContinue'
  );
  // Generic find fallback - just list directory
  cmd = cmd.replace(/^find\b(.+)$/i, 'Get-ChildItem -Recurse -ErrorAction SilentlyContinue$1');

  // ls
  cmd = cmd.replace(/^ls\s+-la$/i, 'Get-ChildItem -Force');
  cmd = cmd.replace(/^ls\s+-l$/i, 'Get-ChildItem');
  cmd = cmd.replace(/^ls$/i, 'Get-ChildItem');
  cmd = cmd.replace(/^ls\s+-la\s+(.+)$/i, 'Get-ChildItem "$1" -Force');
  cmd = cmd.replace(/^ls\s+-l\s+(.+)$/i, 'Get-ChildItem "$1"');
  cmd = cmd.replace(/^ls\s+(.+)$/i, 'Get-ChildItem "$1"');

  // cat
  cmd = cmd.replace(/^cat\s+(.+)$/i, 'Get-Content $1');

  // head/tail
  cmd = cmd.replace(/^head\s+-n\s+(\d+)\s+(.+)$/i, 'Get-Content $2 -Head $1');
  cmd = cmd.replace(/^head\s+(\d+)\s+(.+)$/i, 'Get-Content $2 -Head $1');
  cmd = cmd.replace(/^head\s+(.+)$/i, 'Get-Content $1 -Head 10');
  cmd = cmd.replace(/^tail\s+-n\s+(\d+)\s+(.+)$/i, 'Get-Content $2 -Tail $1');
  cmd = cmd.replace(/^tail\s+(\d+)\s+(.+)$/i, 'Get-Content $2 -Tail $1');
  cmd = cmd.replace(/^tail\s+(.+)$/i, 'Get-Content $1 -Tail 10');

  // wc
  cmd = cmd.replace(/^wc\s+-l\s+(.+)$/i, '(Get-Content $1).Count');
  cmd = cmd.replace(/^wc\s+(.+)$/i, '(Get-Content $1).Count');

  // grep
  cmd = cmd.replace(/^grep\s+"([^"]+)"\s+(.+)$/i, 'Select-String -Pattern "$1" -Path $2');
  cmd = cmd.replace(/^grep\s+(\S+)\s+(.+)$/i, 'Select-String -Pattern $1 -Path $2');
  cmd = cmd.replace(/^grep\s+-r\s+"([^"]+)"\s+(.+)$/i, 'Select-String -Pattern "$1" -Path "$2\\*" -Recurse');
  cmd = cmd.replace(/^grep\s+-rn\s+"([^"]+)"\s+(.+)$/i, 'Select-String -Pattern "$1" -Path $2');

  // mkdir
  cmd = cmd.replace(/^mkdir\s+-p\s+(.+)$/i, 'New-Item -ItemType Directory -Path "$1" -Force');
  cmd = cmd.replace(/^mkdir\s+(.+)$/i, 'New-Item -ItemType Directory -Path "$1"');

  // rm
  cmd = cmd.replace(/^rm\s+-rf\s+(.+)$/i, 'Remove-Item "$1" -Recurse -Force');
  cmd = cmd.replace(/^rm\s+-r\s+(.+)$/i, 'Remove-Item "$1" -Recurse -Force');
  cmd = cmd.replace(/^rm\s+(.+)$/i, 'Remove-Item $1 -Force');

  // cp/mv
  cmd = cmd.replace(/^cp\s+-r\s+(.+)\s+(.+)$/i, 'Copy-Item $1 $2 -Recurse');
  cmd = cmd.replace(/^cp\s+(.+)\s+(.+)$/i, 'Copy-Item $1 $2');
  cmd = cmd.replace(/^mv\s+(.+)\s+(.+)$/i, 'Move-Item $1 $2');

  // touch
  cmd = cmd.replace(/^touch\s+(.+)$/i, 'New-Item -ItemType File -Path "$1" -Force');

  // pwd
  cmd = cmd.replace(/^pwd$/i, 'Get-Location');

  // echo
  cmd = cmd.replace(/^echo\s+(.+)$/i, 'Write-Output $1');

  // which/where
  cmd = cmd.replace(/^which\s+(.+)$/i, 'Get-Command $1');
  cmd = cmd.replace(/^where\s+(.+)$/i, 'Get-Command $1');

  // diff
  cmd = cmd.replace(/^diff\s+(.+)\s+(.+)$/i, 'Compare-Object (Get-Content $1) (Get-Content $2)');

  // du
  cmd = cmd.replace(/^du\s+-sh\s+(.+)$/i, 'Write-Output "$((Get-ChildItem $1 -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB) MB"');

  // df
  cmd = cmd.replace(/^df\s+-h$/i, 'Get-PSDrive');

  // env
  cmd = cmd.replace(/^env$/i, 'Get-ChildItem Env:');

  // date
  cmd = cmd.replace(/^date$/i, 'Get-Date');

  // whoami
  cmd = cmd.replace(/^whoami$/i, '$env:USERNAME');

  // chmod
  cmd = cmd.replace(/^chmod\s+\d+\s+(.+)$/i, 'icacls "$1" /grant Everyone:F');

  // tar
  cmd = cmd.replace(/^tar\s+-xzf\s+(.+)$/i, 'Expand-Archive -Path "$1" -DestinationPath .');
  cmd = cmd.replace(/^tar\s+-xf\s+(.+)$/i, 'Expand-Archive -Path "$1" -DestinationPath .');

  return cmd;
}

export function normalizeTerminalCommand(command: string): string {
  let cmd = command;

  if (IS_WINDOWS) {
    cmd = translateLinuxToPowerShell(cmd);
  }

  const trimmed = cmd.trim();
  const prefixMatch = trimmed.match(
    /^(?:pnpm\s+create\s+next-app(?:@latest)?|npx\s+create-next-app(?:@latest)?|npm\s+create-next-app(?:@latest)?)\s+/i,
  );

  if (!prefixMatch) {
    return cmd;
  }

  const prefix = prefixMatch[0];
  const remainder = trimmed.slice(prefix.length).trim();
  if (!remainder) {
    return cmd;
  }

  const segments = remainder.split(/\s+/);
  const project = segments[0]?.trim();
  if (
    !project ||
    project === "." ||
    project === ".." ||
    /[\\/]/.test(project)
  ) {
    return command;
  }

  const normalizedProject = project.toLowerCase();
  if (normalizedProject === project) {
    return command;
  }

  segments[0] = normalizedProject;
  return `${prefix}${segments.join(" ")}`.trim();
}

export class TerminalTool {
  public constructor(private readonly workspaceRoot: string) {}

  public async run(command: string, timeoutMs = 30_000): Promise<ToolResult> {
    const normalizedCommand = normalizeTerminalCommand(command);
    const validationError = this.validateCommand(normalizedCommand);
    if (validationError) {
      return {
        ok: false,
        output: `Command blocked by safety policy: ${validationError}`,
      };
    }

    try {
      const execOptions: import("child_process").ExecOptions = {
        cwd: this.workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
      };

      if (IS_WINDOWS) {
        execOptions.shell = "powershell.exe";
      }

      const { stdout, stderr } = await execAsync(normalizedCommand, execOptions);

      return {
        ok: true,
        output: `${stdout}${stderr}`.trim(),
      };
    } catch (error) {
      const typedError = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      return {
        ok: false,
        output:
          `${typedError.stdout ?? ""}${typedError.stderr ?? ""}${typedError.message ?? ""}`.trim(),
      };
    }
  }

  public async *stream(
    command: string,
    timeoutMs = 30_000,
  ): AsyncGenerator<string, ToolResult> {
    const normalizedCommand = normalizeTerminalCommand(command);
    const validationError = this.validateCommand(normalizedCommand);
    if (validationError) {
      return {
        ok: false,
        output: `Command blocked by safety policy: ${validationError}`,
      };
    }

    const spawnOptions: import("child_process").SpawnOptions = {
      cwd: this.workspaceRoot,
      env: process.env,
      shell: true,
    };

    if (IS_WINDOWS) {
      spawnOptions.shell = "powershell.exe";
    }

    const child = spawn(normalizedCommand, spawnOptions);

    const queue: string[] = [];
    let resolveNext: (() => void) | null = null;
    let settled = false;
    let timedOut = false;
    let exitCode: number | null = null;
    let output = "";

    const wake = () => {
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve();
      }
    };

    const pushChunk = (chunk: string) => {
      if (!chunk) {
        return;
      }

      output += chunk;
      queue.push(chunk);
      wake();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      pushChunk(`\n[command timed out after ${timeoutMs}ms]\n`);
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer | string) => {
      pushChunk(data.toString());
    });

    child.stderr?.on("data", (data: Buffer | string) => {
      pushChunk(data.toString());
    });

    child.on("error", (error) => {
      pushChunk(`\n${String(error)}\n`);
      settled = true;
      clearTimeout(timeout);
      wake();
    });

    child.on("close", (code) => {
      exitCode = code;
      if (!timedOut && typeof code === "number" && code !== 0) {
        pushChunk(`\n[process exited with code ${code}]\n`);
      }
      settled = true;
      clearTimeout(timeout);
      wake();
    });

    try {
      while (!settled || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }

        while (queue.length > 0) {
          const chunk = queue.shift();
          if (chunk) {
            yield chunk;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      if (!settled) {
        child.kill();
      }
    }

    const trimmedOutput = output.trim();
    return {
      ok: !timedOut && exitCode === 0,
      output:
        trimmedOutput.length > 0
          ? trimmedOutput
          : exitCode === 0
            ? "Command completed successfully."
            : "Command failed.",
    };
  }

  private validateCommand(command: string): string | null {
    const trimmed = command.trim();
    if (!trimmed) return "Command cannot be empty.";
    if (trimmed.length > MAX_COMMAND_LENGTH) return `Command exceeds ${MAX_COMMAND_LENGTH} characters.`;

    for (const blocked of SHELL_EXPANSION_PATTERNS) {
      if (blocked.pattern.test(trimmed)) {
        return blocked.reason;
      }
    }

    for (const blocked of BLOCKED_PATTERNS) {
      if (blocked.pattern.test(trimmed)) {
        return blocked.reason;
      }
    }

    for (const blocked of BLOCKED_GIT_PATTERNS) {
      if (blocked.pattern.test(trimmed)) {
        return blocked.reason;
      }
    }

    for (const safe of SAFE_PATTERNS) {
      if (safe.test(trimmed)) {
        return null;
      }
    }

    return null;
  }
}
