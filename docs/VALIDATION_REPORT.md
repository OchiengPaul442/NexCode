# Validation Report

Date: 2026-04-08

## Scope

Full validation was executed for the selected Ollama model:

- `gpt-oss:120b-cloud`

Test categories:

- Real-world `auto` end-to-end prompt
- `/tool search`
- `/tool read`
- `/tool web-search`
- `/tool terminal` filesystem create/move/delete
- `/tool terminal` dangerous-command block check
- `/edit ...` proposal generation + apply flow
- Empty-workspace command lifecycle (create/edit/delete)
- Next.js blog scaffold + support-file creation

## Summary

- Total test cases: `11`
- Passed: `11`
- Failed: `0`
- Success rate: `100%`
- Memory entries before: `286`
- Memory entries after: `295`
- Memory delta: `+9`

Machine-readable details are in `docs/VALIDATION_REPORT.json`.

## Timing Highlights

- Real-world auto: `8691 ms`
- Tool search: `30399 ms`
- Next.js blog scaffold: `50873 ms`

## Security Validation

Dangerous terminal pattern test (`/tool terminal rm -rf /`) was blocked successfully.

## Filesystem Capability Validation

Validated successfully:

- Create file
- Move file
- Delete file
- Append/update via edit flow

## Notes

- Validation was run after orchestration streaming/routing refactor and sidebar UX updates.
- The selected model configuration for validation defaults is now `gpt-oss:120b-cloud`.
