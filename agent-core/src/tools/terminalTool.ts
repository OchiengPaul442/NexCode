import { exec, execFile, execSync, spawn, type ChildProcess } from "child_process";
import { type ToolResult } from "../types";

/**
 * Kill a child process tree cross-platform.
 * On POSIX, sends SIGTERM to the process group (negative PID) when detached.
 * On Windows, uses taskkill /T to terminate the tree.
 * Falls back to child.kill() if tree kill fails.
 */
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    child.kill();
    return;
  }

  try {
    if (IS_WINDOWS) {
      // taskkill /T /F /PID terminates the entire process tree on Windows
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
    } else {
      // On POSIX, kill the process group (negative PID) to catch all children.
      // If the child was spawned with detached:true, it has its own process group.
      // Otherwise, try killing -pid anyway — it may fail silently, and child.kill() is the fallback.
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        // Process group kill failed (not a group leader, or already exited)
      }
      // Also kill the direct child as fallback
      child.kill("SIGTERM");
    }
  } catch {
    // Fallback: kill the direct child process
    child.kill();
  }
}

/**
 * Execute a command with abort signal support.
 * Returns a promise that resolves with stdout/stderr or rejects on error.
 * When the signal fires, the child process is killed.
 */
function execWithSignal(
  command: string,
  options: import("child_process").ExecOptions & { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let onAbort: (() => void) | undefined;
    let listenerAdded = false;

    const cleanup = () => {
      if (listenerAdded && options.signal && onAbort) {
        options.signal.removeEventListener("abort", onAbort);
        listenerAdded = false;
      }
    };

    const child = exec(command, options, (error, stdout, stderr) => {
      // Clean up abort listener in the callback path (close event may not fire for failed commands)
      cleanup();
      if (error) {
        // Attach stdout/stderr to the error for callers that need them
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout: stdout as string, stderr: stderr as string });
      }
    });

    if (options.signal) {
      if (options.signal.aborted) {
        killProcessTree(child);
        return;
      }
      onAbort = () => {
        killProcessTree(child);
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      listenerAdded = true;
      // Also clean up on close (backup path; safe to call twice)
      child.on("close", () => {
        cleanup();
      });
    }
  });
}

/**
 * Execute a file with abort signal support.
 * Returns a promise that resolves with stdout/stderr or rejects on error.
 * When the signal fires, the child process is killed.
 */
function execFileWithSignal(
  command: string,
  args: string[],
  options: import("child_process").ExecFileOptions & { signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let onAbort: (() => void) | undefined;
    let listenerAdded = false;

    const cleanup = () => {
      if (listenerAdded && options.signal && onAbort) {
        options.signal.removeEventListener("abort", onAbort);
        listenerAdded = false;
      }
    };

    const child = execFile(command, args, options, (error, stdout, stderr) => {
      // Clean up abort listener in the callback path (close event may not fire for failed commands)
      cleanup();
      if (error) {
        (error as any).stdout = stdout;
        (error as any).stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout: stdout as string, stderr: stderr as string });
      }
    });

    if (options.signal) {
      if (options.signal.aborted) {
        killProcessTree(child);
        return;
      }
      onAbort = () => {
        killProcessTree(child);
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
      listenerAdded = true;
      // Also clean up on close (backup path; safe to call twice)
      child.on("close", () => {
        cleanup();
      });
    }
  });
}

const MAX_COMMAND_LENGTH = 2_000;

const IS_WINDOWS = process.platform === "win32";

// Map of common Unix commands to their Windows/PowerShell equivalents
const UNIX_TO_WINDOWS_HINTS: Array<{ pattern: RegExp; suggestion: string }> = [
  { pattern: /\bfind\b/, suggestion: "Use Get-ChildItem -Recurse on Windows (PowerShell)" },
  { pattern: /\bgrep\b/, suggestion: "Use Select-String on Windows (PowerShell)" },
  { pattern: /\bawk\b/, suggestion: "Use PowerShell filtering or ForEach-Object instead" },
  { pattern: /\bsed\b/, suggestion: "Use PowerShell -replace operator instead" },
  { pattern: /\bchmod\b/, suggestion: "Use icacls on Windows" },
  { pattern: /\bchown\b/, suggestion: "Use icacls or Takeown on Windows" },
  { pattern: /\bcat\b/, suggestion: "Use Get-Content on Windows (PowerShell)" },
  { pattern: /\bln\b/, suggestion: "Use New-Item -ItemType SymbolicLink on Windows" },
  { pattern: /\bwhich\b/, suggestion: "Use Get-Command on Windows (PowerShell)" },
  { pattern: /\bcurl\b/, suggestion: "Use Invoke-WebRequest or Invoke-RestMethod on Windows (PowerShell)" },
  { pattern: /\bwget\b/, suggestion: "Use Invoke-WebRequest on Windows (PowerShell)" },
  { pattern: /\bsort\b/, suggestion: "Use Sort-Object on Windows (PowerShell)" },
  { pattern: /\buniq\b/, suggestion: "Use Sort-Object -Unique or Group-Object on Windows (PowerShell)" },
  { pattern: /\bxargs\b/, suggestion: "Use ForEach-Object or pipeline in PowerShell" },
  { pattern: /\btar\b/, suggestion: "Use Expand-Archive (for .zip) or tar.exe (built into Windows 10+)" },
  { pattern: /\bchmod\b/, suggestion: "Use icacls on Windows" },
  { pattern: /\bdu\b/, suggestion: "Use Get-ChildItem -Recurse | Measure-Object on Windows (PowerShell)" },
  { pattern: /\bdf\b/, suggestion: "Use Get-PSDrive on Windows (PowerShell)" },
  { pattern: /\bps\b/, suggestion: "Use Get-Process on Windows (PowerShell)" },
  { pattern: /\btop\b/, suggestion: "Use Get-Process | Sort-Object CPU -Descending on Windows (PowerShell)" },
  { pattern: /\bkill\b/, suggestion: "Use Stop-Process on Windows (PowerShell)" },
  { pattern: /\benv\b/, suggestion: "Use Get-ChildItem Env: on Windows (PowerShell)" },
  { pattern: /\bdate\b/, suggestion: "Use Get-Date on Windows (PowerShell)" },
  { pattern: /\bwhoami\b/, suggestion: "Use $env:USERNAME on Windows (PowerShell)" },
  { pattern: /\bdiff\b/, suggestion: "Use Compare-Object on Windows (PowerShell)" },
  { pattern: /\bmkdir\b/, suggestion: "Use New-Item -ItemType Directory on Windows (PowerShell)" },
  { pattern: /\btouch\b/, suggestion: "Use New-Item -ItemType File on Windows (PowerShell)" },
];

function analyzeCommandFailure(command: string, stderr: string, stdout: string): string {
  const combined = `${stderr} ${stdout}`.toLowerCase();
  const hints: string[] = [];

  // Check for "command not found" patterns
  if (
    combined.includes("command not found") ||
    combined.includes("is not recognized") ||
    combined.includes("not found as a cmdlet") ||
    combined.includes("is not the name of a cmdlet")
  ) {
    // Extract the command name that failed
    const failedCmd = command.trim().split(/\s+/)[0];
    if (failedCmd) {
      // Check if it's a Unix command that has a Windows equivalent
      for (const hint of UNIX_TO_WINDOWS_HINTS) {
        if (hint.pattern.test(failedCmd)) {
          hints.push(hint.suggestion);
          break;
        }
      }
      // Specific guidance for common missing commands
      if (failedCmd === "rg") {
        hints.push("ripgrep (rg) is not installed. Install it with: scoop install ripgrep, choco install ripgrep, or use Select-String in PowerShell.");
      } else if (failedCmd === "grep" && IS_WINDOWS) {
        hints.push("grep is not available on Windows. Use Select-String -Pattern 'pattern' -Path 'file' in PowerShell.");
      } else if (failedCmd === "find" && IS_WINDOWS) {
        hints.push("find is a Linux/Unix command. Use Get-ChildItem -Recurse on Windows PowerShell.");
      } else if (failedCmd === "ls") {
        hints.push("Use Get-ChildItem or dir on Windows.");
      } else if (failedCmd === "curl") {
        hints.push("Use Invoke-WebRequest or Invoke-RestMethod on Windows PowerShell.");
      } else if (failedCmd === "wget") {
        hints.push("Use Invoke-WebRequest on Windows PowerShell, or install wget via scoop/choco.");
      } else if (IS_WINDOWS) {
        hints.push(`'${failedCmd}' is not available on Windows. Use a PowerShell equivalent or install it via scoop/choco.`);
      }
    }
  }

  // Check for permission errors
  if (combined.includes("permission denied") || combined.includes("access is denied")) {
    hints.push("The command requires elevated permissions. Try running as administrator.");
  }

  // Check for timeout
  if (combined.includes("timed out") || combined.includes("timeout")) {
    hints.push("The command timed out. Try a more specific command or increase the timeout.");
  }

  // Check for common path errors
  if (combined.includes("no such file") || combined.includes("cannot find path") || combined.includes("does not exist")) {
    hints.push("The specified path does not exist. Verify the path is correct.");
  }

  if (hints.length > 0) {
    return `\n[HINT: ${hints.join("; ")}]`;
  }
  return "";
}

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
  /^Write-Output\b/,
  /^Get-Command\b/,
  /^Compare-Object\b/,
  /^Measure-Object\b/,
  /^Get-PSDrive\b/,
  /^Get-Date\b/,
  /^Expand-Archive\b/,
  // Windows commands
  /^dir\b/i,
  /^cd\b/i,
  /^type\b/i,
  /^where\b/i,
  /^findstr\b/i,
];

// SHELL_EXPANSION_PATTERNS - block command substitution and shell expansion
const SHELL_EXPANSION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\$\(/, reason: 'Command substitution $() is blocked.' },
  { pattern: /`[^`]+`/, reason: 'Backtick command substitution is blocked.' },
  { pattern: /\$\{/, reason: 'Parameter expansion ${} is blocked.' },
  { pattern: /;\s*(?:rm|del|format|mkfs|shutdown|reboot)/i, reason: 'Chained destructive command blocked.' },
  { pattern: /&&\s*\w/, reason: 'Chained command (&&) is blocked.' },
  { pattern: /\|\s*\w/, reason: 'Piped command (|) is blocked.' },
  { pattern: /;\s*\w/, reason: 'Chained command (;) is blocked.' },
  // C-02: Output redirection (>, >>) must be rejected — it turns read-only commands into writes.
  { pattern: /[^|;]\s*>\s*\S/, reason: 'Output redirection (>) is blocked. Use typed file tools instead.' },
  // C-02: Input redirection (<) must be rejected for security.
  { pattern: /[^|;]\s*<\s*\S/, reason: 'Input redirection (<) is blocked.' },
  // C-02: Ampersand chaining (&) must be rejected — it chains arbitrary commands.
  { pattern: /\s+&\s+\w/, reason: 'Ampersand command chaining (&) is blocked.' },
  { pattern: /\bnode\s+-e\b/i, reason: 'Inline node execution (node -e) is blocked.' },
  { pattern: /\bpython\s+-c\b/i, reason: 'Inline python execution (python -c) is blocked.' },
  { pattern: /\bpython3\s+-c\b/i, reason: 'Inline python3 execution (python3 -c) is blocked.' },
];

// BLOCKED_COMMANDS - always blocked regardless of approval
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+-(?:[a-z]*r[a-z]*f[a-z]*|f[a-z]*r[a-z]*)\b\s+\//,
    reason: "rm -rf on root is blocked.",
  },
  {
    pattern: /\brm\s+--recursive\s+--force\s+\//,
    reason: "rm --recursive --force on root is blocked.",
  },
  {
    pattern: /\brm\s+--force\s+--recursive\s+\//,
    reason: "rm --force --recursive on root is blocked.",
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

  // Handle find with -exec: strip the -exec clause entirely (can't translate complex exec)
  // e.g. find . -name "*.ts" -exec grep -l "pattern" {} \;
  cmd = cmd.replace(/\s+-exec\b.*$/i, '');

  // Handle find with -maxdepth: convert to PowerShell depth
  // e.g. find /path -maxdepth 1 -type f -name "*.ts"
  const findMaxdepthMatch = cmd.match(
    /^find\s+(\S+)\s+-maxdepth\s+(\d+)\s+-type\s+([fd])\s+-name\s+"([^"]+)"/i
  );
  if (findMaxdepthMatch) {
    const [, searchPath, depth, type, filter] = findMaxdepthMatch;
    const pathArg = searchPath === '.' ? '' : `-Path "${searchPath}"`;
    const typeFlag = type === 'f' ? '-File' : '-Directory';
    return `Get-ChildItem ${pathArg} -Depth ${depth} -Filter "${filter}" ${typeFlag} -ErrorAction SilentlyContinue`;
  }

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

  // Simple find patterns — -iname with quoted path
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
  // find with -name (not -iname)
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

  // grep with recursive flag (-r, -R, -rR, -rn, -Rn, etc.)
  cmd = cmd.replace(/^grep\s+-[rR]+[niIwFls]*\s+"([^"]+)"\s+(.+)$/i, 'Select-String -Pattern "$1" -Path "$2\\*" -Recurse');
  cmd = cmd.replace(/^grep\s+-[rR]+[niIwFls]*\s+(\S+)\s+(.+)$/i, 'Select-String -Pattern $1 -Path "$2\\*" -Recurse');
  // grep with other flags (-i, -n, -w, etc. but not recursive)
  cmd = cmd.replace(/^grep\s+-[niIwFls]+\s+"([^"]+)"\s+(.+)$/i, 'Select-String -Pattern "$1" -Path $2');
  cmd = cmd.replace(/^grep\s+-[niIwFls]+\s+(\S+)\s+(.+)$/i, 'Select-String -Pattern $1 -Path $2');
  // grep without flags
  cmd = cmd.replace(/^grep\s+"([^"]+)"\s+(.+)$/i, 'Select-String -Pattern "$1" -Path $2');
  cmd = cmd.replace(/^grep\s+(\S+)\s+(.+)$/i, 'Select-String -Pattern $1 -Path $2');

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

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Execute a terminal command.
   * @param signal Optional AbortSignal. When fired, the child process tree is killed.
   */
  public async run(command: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<ToolResult> {
    const normalizedCommand = normalizeTerminalCommand(command);
    const validationError = this.validateCommand(normalizedCommand);
    if (validationError) {
      return {
        ok: false,
        output: `Command blocked by safety policy: ${validationError}`,
      };
    }

    // Fast-fail if already aborted
    if (signal?.aborted) {
      return {
        ok: false,
        output: "Command cancelled: abort signal was already fired.",
      };
    }

    try {
      const execOptions: import("child_process").ExecOptions & { signal?: AbortSignal } = {
        cwd: this.workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        signal,
      };

      if (IS_WINDOWS) {
        execOptions.shell = "powershell.exe";
      }

      const { stdout, stderr } = await execWithSignal(normalizedCommand, execOptions);

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
      const stderr = typedError.stderr ?? "";
      const stdout = typedError.stdout ?? "";
      const message = typedError.message ?? "";

      // If the error is from abort signal, report cancellation clearly
      if (signal?.aborted || message.includes("aborted") || message.includes("killed")) {
        return {
          ok: false,
          output: "Command cancelled by abort signal.",
        };
      }

      const rawOutput = `${stdout}${stderr}${message}`.trim();
      const hint = analyzeCommandFailure(normalizedCommand, stderr, stdout);
      return {
        ok: false,
        output: rawOutput + hint,
      };
    }
  }

  /**
   * Execute a command safely (execFile, no shell interpretation).
   * @param signal Optional AbortSignal. When fired, the child process tree is killed.
   */
  public async runSafe(
    command: string,
    args: string[],
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    // Fast-fail if already aborted
    if (signal?.aborted) {
      return {
        ok: false,
        output: "Command cancelled: abort signal was already fired.",
      };
    }

    try {
      const execOptions: import("child_process").ExecFileOptions & { signal?: AbortSignal } = {
        cwd: this.workspaceRoot,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        signal,
      };

      const { stdout, stderr } = await execFileWithSignal(command, args, execOptions);

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
      const stderr = typedError.stderr ?? "";
      const stdout = typedError.stdout ?? "";
      const message = typedError.message ?? "";

      // If the error is from abort signal, report cancellation clearly
      if (signal?.aborted || message.includes("aborted") || message.includes("killed")) {
        return {
          ok: false,
          output: "Command cancelled by abort signal.",
        };
      }

      const rawOutput = `${stdout}${stderr}${message}`.trim();
      const hint = analyzeCommandFailure(command, stderr, stdout);
      return {
        ok: false,
        output: rawOutput + hint,
      };
    }
  }

  /**
   * Execute a terminal command and stream output chunks.
   * @param signal Optional AbortSignal. When fired, the child process tree is killed.
   */
  public async *stream(
    command: string,
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ): AsyncGenerator<string, ToolResult> {
    const normalizedCommand = normalizeTerminalCommand(command);
    const validationError = this.validateCommand(normalizedCommand);
    if (validationError) {
      return {
        ok: false,
        output: `Command blocked by safety policy: ${validationError}`,
      };
    }

    // Fast-fail if already aborted
    if (signal?.aborted) {
      return {
        ok: false,
        output: "Command cancelled: abort signal was already fired.",
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
    let cancelled = false;
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
      killProcessTree(child);
    }, timeoutMs);

    // Abort signal handler: kill the process tree
    const onAbort = () => {
      cancelled = true;
      pushChunk("\n[command cancelled by abort signal]\n");
      killProcessTree(child);
    };

    if (signal) {
      if (signal.aborted) {
        cancelled = true;
        killProcessTree(child);
        clearTimeout(timeout);
        return {
          ok: false,
          output: "Command cancelled: abort signal was already fired.",
        };
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

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
      if (signal) signal.removeEventListener("abort", onAbort);
      wake();
    });

    child.on("close", (code) => {
      exitCode = code;
      if (!timedOut && !cancelled && typeof code === "number" && code !== 0) {
        pushChunk(`\n[process exited with code ${code}]\n`);
      }
      settled = true;
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", onAbort);
      wake();
    });

    try {
      while (!settled || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            if (settled) {
              resolve();
              return;
            }
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
      if (signal) signal.removeEventListener("abort", onAbort);
      if (!settled) {
        killProcessTree(child);
      }
    }

    const trimmedOutput = output.trim();

    if (cancelled) {
      return {
        ok: false,
        output: trimmedOutput || "Command cancelled by abort signal.",
      };
    }

    if (!timedOut && exitCode !== 0) {
      const hint = analyzeCommandFailure(normalizedCommand, trimmedOutput, "");
      return {
        ok: false,
        output: trimmedOutput + hint,
      };
    }
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

    // Reject tool names sent as shell commands (model confusion)
    const toolNames = ["git-status", "git-diff", "git-branch", "delete", "delete-contents", "move", "batch_edit", "mcp", "web-search", "search-web", "online-search"];
    const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
    if (toolNames.includes(firstWord)) {
      return ` '${firstWord}' is a tool name, not a shell command. Use the actual shell command (e.g., 'git status' instead of 'git-status').`;
    }

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

    // Deny-by-default: unknown commands are rejected.
    // Only commands matching SAFE_PATTERNS are allowed through the terminal
    // safety boundary. Everything else must go through typed tool wrappers
    // (GitTool, TestRunnerTool, SearchTool) or require explicit approval.
    return "Command is not in the terminal allowlist. Only explicitly permitted read-only commands are allowed. Use typed tool wrappers (git, test, search) instead of raw shell.";
  }
}
