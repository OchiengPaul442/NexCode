[CmdletBinding()]
param(
    [string]$Model = "",
    [int]$MaxIterations = 80,
    [int]$MaxConsecutiveFailures = 3,
    [int]$DelaySeconds = 3
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Fail([string]$Message) {
    Write-Host "ERROR: $Message" -ForegroundColor Red
    exit 1
}

function Read-State {
    $path = Join-Path $script:RepoRoot "docs\remediation\STATE.json"
    if (-not (Test-Path $path)) {
        Fail "Missing $path"
    }

    try {
        return Get-Content $path -Raw | ConvertFrom-Json
    }
    catch {
        Fail "STATE.json is not valid JSON: $($_.Exception.Message)"
    }
}

$script:RepoRoot = (Get-Location).Path

if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
    Fail "Run this script from the NexCode repository root containing package.json."
}

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    Fail "The repository must be a Git worktree."
}

$requiredFiles = @(
    ".opencode\agents\nexcode-remediator.md",
    "docs\audit\NEXCODE_FULL_CODERABBIT_STYLE_REVIEW.md",
    "docs\audit\NEXCODE_CLAUDE_OPENCODE_REMEDIATION_PROMPT.md",
    "docs\remediation\STATE.json",
    "docs\remediation\WORK_QUEUE.md",
    "docs\remediation\REMEDIATION_LOG.md"
)

foreach ($relative in $requiredFiles) {
    if (-not (Test-Path (Join-Path $RepoRoot $relative))) {
        Fail "Required file is missing: $relative"
    }
}

$opencodeCommand = Get-Command opencode -ErrorAction SilentlyContinue
if (-not $opencodeCommand) {
    Fail "OpenCode is not installed or is not available on PATH."
}

# Prefer the native Windows binary instead of the npm-generated opencode.ps1
# wrapper. Windows PowerShell can otherwise turn native stderr into a
# NativeCommandError and hide the actual OpenCode output.
$OpenCodeExecutable = $null

$nativeCommand = Get-Command opencode.exe -ErrorAction SilentlyContinue
if ($nativeCommand -and (Test-Path $nativeCommand.Source)) {
    $OpenCodeExecutable = $nativeCommand.Source
}

if (-not $OpenCodeExecutable -and $opencodeCommand.Source) {
    $wrapperDirectory = Split-Path -Parent $opencodeCommand.Source
    $candidate = Join-Path $wrapperDirectory "node_modules\opencode-ai\bin\opencode.exe"
    if (Test-Path $candidate) {
        $OpenCodeExecutable = $candidate
    }
}

if (-not $OpenCodeExecutable) {
    Fail "Could not locate the native opencode.exe binary. Run 'Get-Command opencode -All' and reinstall OpenCode if necessary."
}

Write-Host "Using OpenCode binary: $OpenCodeExecutable" -ForegroundColor DarkGray

if ([string]::IsNullOrWhiteSpace($Model)) {
    Fail "A model is required. Pass -Model 'provider/model'."
}

$branch = (& git branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($branch)) {
    Fail "The repository is in detached HEAD state."
}
if ($branch -in @("main", "master", "develop", "production", "prod")) {
    Fail "Refusing autonomous remediation on protected-looking branch '$branch'. Create a dedicated remediation branch first."
}

$initialStatus = & git status --porcelain
if ($initialStatus) {
    Fail "Start from a clean worktree. Commit or stash current changes before running the loop."
}

$logDir = Join-Path $RepoRoot "logs\opencode-remediation"
New-Item -ItemType Directory -Force $logDir | Out-Null

$consecutiveFailures = 0
$previousIteration = -1
$staleIterations = 0

for ($i = 1; $i -le $MaxIterations; $i++) {
    $stateBefore = Read-State

    if ($stateBefore.status -eq "complete") {
        Write-Host "NexCode remediation is already complete." -ForegroundColor Green
        exit 0
    }

    if ($stateBefore.status -eq "blocked") {
        Write-Host "NexCode remediation is blocked. Review STATE.json and REMEDIATION_LOG.md." -ForegroundColor Yellow
        exit 2
    }

    Write-Host ""
    Write-Host "=== NexCode autonomous remediation iteration $i/$MaxIterations ===" -ForegroundColor Cyan
    Write-Host "Ledger iteration: $($stateBefore.iteration); status: $($stateBefore.status)"

    $prompt = @"
Execute exactly one bounded NexCode remediation iteration.

Use the attached audit, remediation prompt, and persistent control files as the
authoritative work queue. Inspect the current Git worktree and recent commits before
editing.

Do not ask questions. Use conservative judgment or mark a finding blocked with exact
evidence. Work on one finding or at most three tightly coupled findings. Verify first,
fix root causes, add regression tests, run validation, update all control files, and
commit only a coherent passing batch.

Do not push, publish, rewrite Git history, access external directories, read real
environment secret files, or use destructive deletion commands.

End after one batch and print the required NEXCODE_LOOP_RESULT marker.
"@

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $iterationLog = Join-Path $logDir ("iteration-{0:D3}-{1}.log" -f $i, $timestamp)

    $arguments = @(
        "--print-logs",
        "--log-level", "INFO",
        "run",
        "--auto",
        "--agent", "nexcode-remediator",
        "--title", "NexCode remediation iteration $i",
        "--file", "docs/audit/NEXCODE_FULL_CODERABBIT_STYLE_REVIEW.md",
        "--file", "docs/audit/NEXCODE_CLAUDE_OPENCODE_REMEDIATION_PROMPT.md",
        "--file", "docs/remediation/STATE.json",
        "--file", "docs/remediation/WORK_QUEUE.md",
        "--file", "docs/remediation/REMEDIATION_LOG.md"
    )

    if (-not [string]::IsNullOrWhiteSpace($Model)) {
        $arguments += @("--model", $Model)
    }

    $arguments += $prompt

    try {
        # Windows PowerShell 5.1 may promote native stderr to ErrorRecord objects.
        # Temporarily keep native stderr non-terminating and stringify it for logs.
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        if (Test-Path variable:PSNativeCommandUseErrorActionPreference) {
            $previousNativePreference = $PSNativeCommandUseErrorActionPreference
            $PSNativeCommandUseErrorActionPreference = $false
        }

        & $OpenCodeExecutable @arguments 2>&1 |
            ForEach-Object { $_.ToString() } |
            Tee-Object -FilePath $iterationLog

        $exitCode = $LASTEXITCODE
    }
    catch {
        $exitCode = 1
        $_ | Out-String | Tee-Object -FilePath $iterationLog -Append
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference

        if (Test-Path variable:previousNativePreference) {
            $PSNativeCommandUseErrorActionPreference = $previousNativePreference
        }
    }

    if ($exitCode -ne 0) {
        $consecutiveFailures++
        Write-Host "OpenCode exited with code $exitCode ($consecutiveFailures consecutive failure(s))." -ForegroundColor Yellow
    }
    else {
        $consecutiveFailures = 0
    }

    if ($consecutiveFailures -ge $MaxConsecutiveFailures) {
        Write-Host "Stopping after $consecutiveFailures consecutive OpenCode failures." -ForegroundColor Red
        exit 3
    }

    $stateAfter = Read-State

    if ($stateAfter.iteration -eq $previousIteration) {
        $staleIterations++
    }
    else {
        $staleIterations = 0
        $previousIteration = $stateAfter.iteration
    }

    if ($staleIterations -ge 2) {
        Write-Host "Stopping because the persistent ledger did not advance for two iterations." -ForegroundColor Red
        exit 4
    }

    Write-Host "Updated status: $($stateAfter.status); ledger iteration: $($stateAfter.iteration)" -ForegroundColor Cyan
    Write-Host "Counts: fixed=$($stateAfter.counts.fixed), pending=$($stateAfter.counts.pending), blocked=$($stateAfter.counts.blocked), obsolete=$($stateAfter.counts.obsolete), falsePositive=$($stateAfter.counts.falsePositive)"

    if ($stateAfter.status -eq "complete") {
        Write-Host "All audit work reached a terminal state. Review FINAL_COMPLETION_REPORT.md." -ForegroundColor Green
        exit 0
    }

    if ($stateAfter.status -eq "blocked") {
        Write-Host "No further autonomous progress is possible. Review the documented blockers." -ForegroundColor Yellow
        exit 2
    }

    if ($i -lt $MaxIterations) {
        Start-Sleep -Seconds $DelaySeconds
    }
}

Write-Host "Reached MaxIterations=$MaxIterations before completion." -ForegroundColor Yellow
exit 5
