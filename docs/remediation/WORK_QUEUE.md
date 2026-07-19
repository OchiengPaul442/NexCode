# NexCode Remediation Work Queue

This file is initialized by the first autonomous OpenCode invocation.

The bootstrap iteration must parse every `NC-###` finding from the full audit and
replace this placeholder with a complete ordered queue. Every item must retain its
original finding ID and include:

- Severity
- Status
- Dependencies
- Affected files and symbols
- Verified/Unverified indicator
- Required tests
- Verification commands
- Resolution evidence

Do not remove findings. Findings that no longer apply must be marked `obsolete` or
`false_positive` with evidence.
