# NexCode Autonomous OpenCode Remediation Kit

This kit lets OpenCode work through the full NexCode audit autonomously in a bounded
outer loop.

## Why this uses many fresh runs

A single endless session eventually accumulates too much context and becomes less
reliable. This setup makes each OpenCode invocation complete one small verified batch.
Progress is persisted in Git and these files:

- `docs/remediation/STATE.json`
- `docs/remediation/WORK_QUEUE.md`
- `docs/remediation/REMEDIATION_LOG.md`

The PowerShell supervisor starts the next fresh invocation until the state becomes
`complete`, `blocked`, the failure limit is reached, or the iteration cap is reached.

## Install

Extract the contents of this ZIP directly into the NexCode repository root. The
repository should then contain:

```text
.opencode/agents/nexcode-remediator.md
.opencode/commands/remediate-next.md
docs/audit/NEXCODE_FULL_CODERABBIT_STYLE_REVIEW.md
docs/audit/NEXCODE_CLAUDE_OPENCODE_REMEDIATION_PROMPT.md
docs/remediation/STATE.json
docs/remediation/WORK_QUEUE.md
docs/remediation/REMEDIATION_LOG.md
scripts/run-nexcode-remediation-loop.ps1
```

## Before running

From PowerShell in the NexCode repository root:

```powershell
git status
git add .
git commit -m "chore: checkpoint before autonomous remediation"
git switch -c fix/nexcode-full-remediation
```

Authenticate OpenCode and check available models:

```powershell
opencode auth login
opencode models
opencode agent list
```

Confirm `nexcode-remediator` appears in the agent list.

Use a strong coding/reasoning model with reliable tool use and a large context window.
The model ID must use OpenCode's `provider/model` format.

## Start the full loop

Example:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-nexcode-remediation-loop.ps1 `
  -Model "YOUR_PROVIDER/YOUR_MODEL" `
  -MaxIterations 80
```

When the default model is already configured:

```powershell
powershell -ExecutionPolicy Bypass `
  -File .\scripts\run-nexcode-remediation-loop.ps1 `
  -MaxIterations 80
```

The loop uses `opencode run --auto`, but the custom agent contains explicit deny rules
for external directories, secret files, Git push/history rewriting, package publishing,
and destructive deletion commands.

## Observe progress

In another terminal:

```powershell
Get-Content .\docs\remediation\STATE.json
Get-Content .\docs\remediation\REMEDIATION_LOG.md -Tail 100
git log --oneline --decorate -20
git status
```

Logs from every OpenCode invocation are written to:

```text
logs/opencode-remediation/
```

## Stop the loop

Press `Ctrl+C`. Progress already committed and recorded in the ledger remains intact.

To resume, run the same PowerShell command again. The loop reads the existing state and
continues from the next actionable finding.

## Manual single iteration

Inside the OpenCode TUI, run:

```text
/remediate-next
```

Or from PowerShell:

```powershell
opencode run --auto --agent nexcode-remediator `
  --file docs/audit/NEXCODE_FULL_CODERABBIT_STYLE_REVIEW.md `
  --file docs/audit/NEXCODE_CLAUDE_OPENCODE_REMEDIATION_PROMPT.md `
  --file docs/remediation/STATE.json `
  --file docs/remediation/WORK_QUEUE.md `
  --file docs/remediation/REMEDIATION_LOG.md `
  "Execute exactly one bounded remediation iteration."
```

## Completion evidence

Do not treat the job as complete merely because the loop exits successfully. Confirm:

```powershell
Get-Content .\docs\remediation\STATE.json
Get-Content .\docs\remediation\FINAL_COMPLETION_REPORT.md
git status
npm test
npm run build
```

The final state should be `complete`, every NC finding should have a terminal status,
and the final report should map every finding to evidence.
