# Validation Report

Date: 2026-04-05

## Scope

Full regression validation was executed across these Ollama models:

- `kimi-k2.5:cloud`
- `qwen3-coder:480b-cloud`
- `qwen2.5-coder:7b`
- `nemotron-mini:latest`

Test categories per model:

- Real-world `auto` planning/implementation prompt
- `/tool search`
- `/tool read`
- `/tool web-search`
- `/tool terminal` filesystem create/move/delete
- `/tool terminal` dangerous-command block check
- `/edit ...` proposal generation + apply flow

## Summary

- Total test cases: `36`
- Passed: `36`
- Failed: `0`
- Memory entries before: `4`
- Memory entries after: `40`
- Memory delta (interaction learning persistence): `+36`

Machine-readable details are in `docs/VALIDATION_REPORT.json`.

## Timing Highlights

- Kimi real-world auto: `258400 ms`
- Qwen3 480b cloud real-world auto: `456674 ms`
- Qwen2.5 coder 7b real-world auto: `82674 ms`
- Nemotron-mini real-world auto: `9965 ms`

Tool execution and filesystem operations consistently completed in low latency ranges for all models.

## Security Validation

Dangerous terminal pattern test (`/tool terminal rm -rf /`) was blocked for all models.

## Filesystem Capability Validation

For each model, the agent successfully performed:

- Create file
- Move file
- Delete file

These operations were verified with on-disk existence checks.

## Edit Workflow Validation

For each model, the `/edit` flow produced at least one proposed edit and the first edit was applied successfully.

## Notes

- A previous activation issue (`Cannot find module '@nexcode/agent-core'`) was traced to VSIX dependency packaging.
- Release packaging now uses isolated staging and dependency verification to prevent this regression.
