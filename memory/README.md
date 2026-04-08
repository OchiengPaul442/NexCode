# Memory Storage

Runtime memory files are written here:

- `long-term-memory.jsonl` (append-only, faster read/write historical memory)
- `feedback-log.jsonl` (self-improvement scoring logs)
- `prompt-versions.json` (prompt version tracking)

These files are generated at runtime by `agent-core`.

Long-term memory search supports lightweight query filters:

- `tag:<value>`
- `type:interaction|feedback|note`
- `since:<Nd|Nh|Nm>` (for example `since:7d`)
