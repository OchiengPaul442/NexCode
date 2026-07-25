# The Autonomous Coding Agent Gauntlet

You are operating as a senior software engineer, security engineer, database engineer, SRE, QA engineer, and technical writer.

Your mission is to inspect, repair, complete, secure, test, document, and validate a deliberately defective production-style application.

You must work autonomously from beginning to end.

Do not merely make the visible tests pass. The repository will be evaluated using hidden functional, concurrency, security, performance, accessibility, migration, and resilience tests.

---

## 1. Repository Context

The repository contains a partially implemented multi-tenant financial transaction and reconciliation platform called **Aegis Ledger**.

The intended architecture is:

```text
aegis-ledger/
├── apps/
│   └── web/                 # Next.js and TypeScript dashboard
├── services/
│   ├── api/                 # TypeScript API service
│   └── worker/              # Python background worker
├── packages/
│   ├── shared/              # Shared schemas, types and utilities
│   └── config/              # Shared configuration
├── database/
│   ├── migrations/
│   └── seeds/
├── tests/
│   ├── integration/
│   ├── security/
│   ├── concurrency/
│   └── e2e/
├── infra/
│   └── docker/
├── scripts/
├── docker-compose.yml
└── README.md
```

The system uses:

- TypeScript
- Next.js
- Node.js API service
- Python worker
- PostgreSQL
- Redis
- Docker Compose
- REST APIs
- Background jobs
- Database migrations
- Structured logging
- Automated tests

Respect the existing package manager, lockfiles, architecture, naming conventions, and framework choices.

Do not replace the entire application with a simplified implementation.

---

## 2. Primary Mission

Make the platform production-ready while preserving backward compatibility.

The completed system must:

1. Authenticate users securely.
2. isolate every tenant’s data.
3. maintain a correct double-entry financial ledger.
4. process concurrent transfers without corrupting balances.
5. safely handle duplicated, delayed, replayed, and out-of-order events.
6. provide an accessible web dashboard.
7. survive temporary infrastructure failures.
8. expose useful logs, health checks, and metrics.
9. run through one documented command.
10. pass all visible and hidden evaluations.

You must investigate the repository before deciding what to change.

Do not assume that the existing implementation, tests, comments, migrations, documentation, or configuration are correct.

---

## 3. Non-Negotiable Rules

You must not:

- Delete, skip, weaken, or disable failing tests.
- Change expected results merely to make tests pass.
- hardcode test-specific values.
- bypass authentication or authorization.
- replace real infrastructure with mocks in production code.
- use floating-point numbers for financial amounts.
- silence TypeScript, linting, migration, security, or test errors.
- introduce blanket `any`, `@ts-ignore`, disabled linters, or equivalent shortcuts.
- swallow exceptions without logging or handling them.
- expose secrets in source code, logs, test output, Docker images, or client bundles.
- log passwords, tokens, cookies, webhook secrets, or full financial payloads.
- claim that something works without executing the relevant validation.
- leave background processes, test servers, temporary databases, containers, ports, or files behind.
- make destructive database changes without documenting migration and rollback implications.
- depend on undocumented manual setup.
- use arbitrary sleeps to hide race conditions or flaky tests.
- return fake success responses when a dependency has failed.

When requirements conflict, prioritize:

1. financial correctness;
2. tenant isolation;
3. security;
4. backward compatibility;
5. reliability;
6. maintainability;
7. performance;
8. developer convenience.

Document any unavoidable trade-off.

---

## 4. Functional Requirements

### 4.1 Authentication

Implement secure authentication and authorization.

The system must correctly handle:

- valid access tokens;
- expired tokens;
- malformed tokens;
- missing tokens;
- revoked users;
- disabled tenants;
- role changes;
- key rotation;
- clock skew;
- duplicate headers;
- conflicting authentication sources.

Supported roles:

- `platform_admin`
- `tenant_admin`
- `finance_manager`
- `analyst`
- `viewer`

Authorization must be enforced on the server.

Hiding a button in the frontend is not authorization.

A user belonging to one tenant must never access another tenant’s:

- accounts;
- transfers;
- balances;
- jobs;
- exports;
- audit records;
- users;
- webhook events;
- cached data.

This isolation must remain correct even when IDs are guessed or supplied directly.

---

### 4.2 Financial Accounts

Each tenant can create financial accounts.

An account contains:

- immutable ID;
- tenant ID;
- account name;
- currency;
- status;
- available balance;
- ledger balance;
- creation timestamp;
- update timestamp;
- version number.

Money must be stored using integer minor units or another exact decimal representation.

Do not use JavaScript or Python floating-point arithmetic for money.

Validate:

- currency codes;
- amount boundaries;
- zero amounts;
- negative amounts;
- extremely large amounts;
- integer overflow;
- malformed numeric strings;
- exponential notation;
- whitespace;
- Unicode digits;
- `NaN`;
- infinity;
- negative zero.

Transfers between accounts with different currencies must be rejected unless a documented currency-conversion workflow exists.

Do not silently convert currencies.

---

### 4.3 Double-Entry Ledger

Every completed transfer must generate balanced ledger entries.

For every ledger transaction:

```text
sum(all debit and credit effects) = 0
```

A transfer must never produce:

- a debit without the matching credit;
- a credit without the matching debit;
- duplicate entries;
- an unexplained balance;
- a partially committed transaction.

Ledger entries must be immutable.

Corrections must be represented using reversal or compensating entries rather than editing historical ledger records.

Balances must be reproducible from ledger entries.

Provide a validation command that checks:

- balanced journal entries;
- account balance consistency;
- missing references;
- duplicate references;
- orphan records;
- invalid currencies;
- broken audit chains.

---

### 4.4 Transfer Processing

Implement or repair:

```http
POST /v1/transfers
GET /v1/transfers/:id
GET /v1/transfers
POST /v1/transfers/:id/reverse
```

A transfer request includes:

- source account;
- destination account;
- currency;
- amount;
- description;
- client reference;
- optional metadata.

A transfer may move through:

```text
pending → processing → completed
pending → cancelled
processing → failed
completed → reversed
```

Illegal state transitions must be rejected.

The transfer process must be safe when:

- two requests arrive at exactly the same time;
- multiple workers process the same job;
- the worker crashes after reading the job;
- the process crashes after updating one record;
- Redis becomes temporarily unavailable;
- PostgreSQL disconnects during processing;
- a client retries after a timeout;
- a request is cancelled by the client;
- the same message is delivered several times;
- messages arrive out of order;
- the source account is being modified concurrently;
- two transfers attempt to spend the final available balance.

The system must never permit an account to exceed its permitted overdraft limit because of a race condition.

Use proper transactions, constraints, locking, idempotency, or equivalent correctness mechanisms.

Do not rely only on an application-level “check balance, then update balance” sequence.

---

### 4.5 Idempotency

`POST /v1/transfers` must support an `Idempotency-Key` header.

Requirements:

- Repeating the same request with the same key must return the original logical result.
- It must not create another transfer.
- It must not create duplicate ledger entries.
- Concurrent requests using the same key must remain safe.
- Reusing a key with a different payload must return a conflict response.
- Keys must be scoped to the correct tenant and operation.
- Failed attempts must not permanently poison valid future retries unless the failure represents a committed result.
- Idempotency records must not leak data across tenants.
- Canonical request hashing must handle field order consistently.
- Sensitive values must not be stored unnecessarily.

Hidden tests will send many identical requests concurrently.

---

### 4.6 Webhooks

Implement or repair:

```http
POST /v1/webhooks/settlements
```

Webhook verification must include:

- HMAC signature validation;
- constant-time signature comparison;
- timestamp validation;
- replay protection;
- body integrity;
- secret rotation;
- event ID deduplication;
- content-type validation;
- payload-size limits.

Correctly handle:

- malformed JSON;
- duplicated events;
- delayed events;
- future timestamps;
- old timestamps;
- out-of-order status changes;
- valid retries;
- invalid signatures;
- multiple signature headers;
- Unicode body differences;
- modified whitespace;
- missing event IDs;
- events for unknown transfers.

Do not parse and reserialize the body before verifying a signature that is defined over raw bytes.

A duplicated webhook may produce another HTTP response, but it must not duplicate its financial effect.

---

### 4.7 Background Jobs

The Python worker processes settlement, reconciliation, export, and notification jobs.

Implement or repair:

- retry behavior;
- exponential backoff;
- retry limits;
- dead-letter handling;
- job idempotency;
- graceful shutdown;
- visibility timeouts;
- job timeouts;
- poison-message handling;
- structured error reporting.

Retry only failures that are likely to be temporary.

Do not retry permanent validation failures forever.

A worker crash must not create partial financial effects.

Two workers processing the same job must not create duplicate effects.

Shutdown must stop accepting new work, finish or safely release current work, close connections, and exit within a reasonable period.

---

### 4.8 CSV Transaction Import

Implement or repair bulk CSV import.

The import must:

- stream large files instead of loading the entire file into memory;
- enforce configurable row and file-size limits;
- validate headers;
- validate every row;
- report row-level errors;
- preserve valid Unicode;
- handle quoted fields;
- handle line-ending differences;
- detect duplicate client references;
- prevent cross-tenant account references;
- avoid partial imports unless explicitly requested;
- support a dry-run mode;
- generate a final reconciliation summary.

Protect against:

- CSV formula injection;
- path traversal;
- zip bombs, when archives are accepted;
- null bytes;
- invalid encodings;
- oversized fields;
- duplicate headers;
- ambiguous date formats;
- locale-dependent numbers;
- spreadsheet formulas;
- malicious filenames.

Imported financial amounts must follow the same exact-money rules as API-created transfers.

---

### 4.9 Audit Log

Security-sensitive and financial actions must create immutable audit events.

Include:

- actor;
- tenant;
- action;
- target;
- timestamp;
- request correlation ID;
- relevant non-sensitive metadata;
- previous event hash;
- current event hash.

The audit chain must allow tampering to be detected.

Do not include secrets, raw passwords, authentication tokens, or unnecessary personal data.

Provide an audit-chain verification command.

Concurrent audit writes must not accidentally fork or corrupt the chain.

Document how retention, archival, and tenant access should work.

---

### 4.10 Reconciliation

Create a reconciliation process that compares:

- account balances;
- ledger-derived balances;
- completed transfers;
- settlement events;
- imported records.

The process must identify:

- missing ledger entries;
- duplicate entries;
- balance differences;
- orphan transfers;
- settlement mismatches;
- unexpected currency combinations;
- failed but financially applied transfers;
- completed transfers without matching financial effects.

The process must produce a machine-readable report and a human-readable summary.

Running reconciliation must not modify financial data unless an explicit repair mode is selected.

Repair mode must never silently alter historical entries.

---

### 4.11 Web Dashboard

The dashboard must provide:

- authentication;
- tenant-aware navigation;
- account balances;
- transfer creation;
- transfer history;
- transaction details;
- import status;
- reconciliation status;
- audit-log viewing for authorized roles;
- understandable loading, empty, success, and failure states.

The frontend must:

- avoid exposing secrets;
- avoid trusting client-side roles;
- escape untrusted content;
- resist open redirects;
- avoid unsafe HTML rendering;
- handle expired sessions;
- prevent duplicate form submission;
- preserve user-entered data after recoverable errors;
- display server validation errors safely;
- work with keyboard navigation;
- use proper labels and focus handling;
- provide accessible status announcements;
- avoid serious accessibility violations.

Transfer creation must not show success before the server confirms a committed or accepted operation.

A browser refresh must not accidentally resubmit a transfer.

---

## 5. API and Data Compatibility

Preserve documented API behavior unless it is insecure or financially incorrect.

When changing an API:

- maintain backward compatibility where practical;
- version incompatible behavior;
- update OpenAPI documentation;
- update generated types;
- update clients;
- add migration notes;
- add tests.

Database migrations must work:

- on a clean database;
- on the supplied legacy database state;
- when executed once;
- when deployment is restarted;
- without losing valid data.

Migration failures must stop deployment rather than leaving the schema partially upgraded.

Add database constraints for invariants that should not depend only on application code.

---

## 6. Security Investigation

Perform a focused security review and fix confirmed vulnerabilities.

Investigate at least:

- SQL injection;
- command injection;
- path traversal;
- server-side request forgery;
- cross-site scripting;
- cross-site request forgery where relevant;
- insecure direct object references;
- cross-tenant data leakage;
- broken role checks;
- JWT algorithm confusion;
- weak token validation;
- insecure cookie configuration;
- prototype pollution;
- unsafe deserialization;
- mass assignment;
- rate-limit bypass;
- cache poisoning;
- secret exposure;
- log injection;
- dependency vulnerabilities;
- unrestricted file uploads;
- denial-of-service vectors;
- information leakage through errors;
- timing-sensitive signature comparison.

Do not report theoretical vulnerabilities without checking whether the code is actually affected.

Do not “fix” vulnerabilities by disabling the feature.

Add regression tests for every confirmed security issue you fix.

---

## 7. Reliability and Failure Handling

The application must behave honestly during dependency failures.

Test and improve behavior when:

- PostgreSQL is unavailable;
- Redis is unavailable;
- the worker is unavailable;
- migrations have not run;
- a job repeatedly fails;
- the disk is full;
- a request times out;
- a downstream service returns invalid data;
- the process receives `SIGTERM`;
- the application restarts during work;
- environment variables are missing;
- an environment variable has an invalid value.

Differentiate between:

```http
/health/live
/health/ready
```

Liveness should indicate whether the process is alive.

Readiness should indicate whether the instance can safely receive traffic.

Do not mark the service ready when critical startup or migration requirements are unmet.

---

## 8. Observability

Implement or repair:

- structured JSON logs;
- request correlation IDs;
- job correlation IDs;
- useful error codes;
- metrics;
- health endpoints;
- startup and shutdown logs;
- safe database and queue diagnostics.

At minimum, expose metrics for:

- request count;
- request latency;
- error count;
- active requests;
- transfer results;
- idempotency conflicts;
- webhook validation failures;
- duplicate webhooks;
- job retries;
- dead-lettered jobs;
- reconciliation discrepancies.

Do not use high-cardinality values such as raw user IDs or transfer IDs as metric labels.

Sanitize line breaks and untrusted values written to logs.

---

## 9. Intentional Defects

Assume the repository contains defects in several of these areas:

- incorrect environment loading;
- dependency-version conflicts;
- stale generated code;
- broken imports;
- hidden circular dependencies;
- database migration ordering;
- authorization;
- tenant filtering;
- request validation;
- transaction boundaries;
- balance calculations;
- webhook verification;
- retry logic;
- cache keys;
- asynchronous exception handling;
- frontend state management;
- memory usage;
- Docker health checks;
- CI configuration;
- flaky tests;
- timezone handling;
- Unicode handling;
- cleanup scripts;
- error reporting;
- documentation.

Some visible tests may pass despite incorrect behavior.

Some visible tests may themselves be incomplete.

A comment saying that a function is safe is not evidence that it is safe.

---

## 10. Adversarial Cases

Your implementation will be tested against cases including:

1. Two tenants using identical account IDs.
2. Two users with similar Unicode usernames.
3. Fifty concurrent transfers spending the same balance.
4. One hundred concurrent requests using the same idempotency key.
5. One idempotency key reused with a different payload.
6. Duplicate queue delivery.
7. Worker termination during processing.
8. Webhooks delivered in reverse order.
9. A valid webhook replayed after the replay window.
10. Multiple signature headers.
11. Missing or duplicated JSON properties.
12. Very large integers.
13. Negative zero.
14. Scientific notation.
15. Invalid UTF-8.
16. CSV formulas beginning with `=`, `+`, `-`, or `@`.
17. An import referencing another tenant’s account.
18. A disabled user with a previously valid token.
19. A viewer calling an administrator endpoint directly.
20. Guessed object IDs.
21. Cache entries created under another tenant.
22. Redis failure after a database commit.
23. Database failure after a job is received.
24. Client disconnection while the server continues processing.
25. A migration applied to populated legacy data.
26. A failed migration followed by application restart.
27. Server shutdown while requests and jobs are active.
28. Reconciliation running while transfers are being created.
29. An audit record modified directly in the database.
30. A malicious description containing HTML, terminal escape codes, and line breaks.

---

## 11. Required Autonomous Work Loop

Follow this loop until the repository is genuinely ready.

### Phase 1: Inspect

- Read the repository structure.
- Read project instructions.
- Read package manifests and lockfiles.
- Read Docker configuration.
- Read migrations.
- Read tests.
- Read CI workflows.
- Inspect recent code patterns.
- Identify the intended architecture.
- Check the working tree before modifying files.

### Phase 2: Establish the Baseline

Run the relevant:

- installation;
- build;
- type-check;
- lint;
- unit tests;
- integration tests;
- end-to-end tests;
- migration checks;
- security checks.

Record the exact baseline failures.

Do not begin by randomly editing files.

### Phase 3: Diagnose

For each failure:

- reproduce it;
- identify its actual cause;
- distinguish symptoms from root causes;
- inspect related code paths;
- identify affected invariants;
- consider security and backward-compatibility implications.

### Phase 4: Implement

Make focused, reviewable changes.

Prefer correcting root causes over adding special cases.

Add or improve tests before considering an issue finished.

### Phase 5: Validate

After each meaningful group of changes:

- run targeted tests;
- run broader tests;
- review the diff;
- inspect for unintended changes;
- check generated files;
- check migrations;
- check logs for warnings;
- confirm cleanup.

### Phase 6: Red-Team Your Own Work

Attempt to break the implementation using:

- malformed input;
- unauthorized requests;
- concurrent requests;
- duplicate delivery;
- infrastructure failure;
- replay attempts;
- large inputs;
- state-transition abuse;
- cross-tenant access;
- browser refreshes;
- process restarts.

Do not assume passing happy-path tests is sufficient.

### Phase 7: Full Verification

Run the complete verification process from a clean state.

Where possible, verify:

```bash
docker compose down --volumes --remove-orphans
docker compose build
docker compose up -d
./scripts/migrate.sh
./scripts/seed.sh
./scripts/verify.sh
./scripts/cleanup.sh
```

Adapt these commands to the repository, but provide an equivalent reproducible workflow.

Ensure no orphan process, container, port, database, temporary file, or test account remains after cleanup.

---

## 12. Required Tests

Add meaningful tests covering at least:

- account creation;
- valid transfer;
- insufficient balance;
- invalid currency;
- double-entry balance invariant;
- illegal state transition;
- transfer reversal;
- concurrent spending;
- idempotent retry;
- conflicting idempotency payload;
- duplicate webhook;
- invalid webhook signature;
- webhook replay;
- out-of-order webhook;
- cross-tenant access;
- role restrictions;
- disabled user;
- CSV validation;
- CSV formula injection;
- duplicate queue delivery;
- worker retry exhaustion;
- graceful shutdown;
- migration from legacy state;
- reconciliation discrepancies;
- audit-chain tampering;
- frontend duplicate submission;
- frontend accessibility;
- cleanup behavior.

Tests must be deterministic.

Do not use arbitrary delays as synchronization.

Use controllable clocks, barriers, transactions, fixtures, test containers, or equivalent deterministic mechanisms.

---

## 13. Documentation Deliverables

Update or create:

```text
README.md
docs/architecture.md
docs/api.md
docs/security.md
docs/threat-model.md
docs/migrations.md
docs/runbook.md
docs/testing.md
docs/decisions/
```

Documentation must explain:

- architecture;
- trust boundaries;
- authentication;
- authorization;
- tenant isolation;
- money representation;
- ledger invariants;
- transfer state machine;
- idempotency;
- webhook verification;
- retry policy;
- failure recovery;
- database migration procedure;
- rollback considerations;
- secret management;
- local development;
- testing;
- deployment;
- incident response;
- known limitations.

Do not write documentation that contradicts the implementation.

---

## 14. Completion Criteria

The task is not complete merely because the application starts.

It is complete only when:

- the clean build succeeds;
- type-checking succeeds;
- linting succeeds;
- migrations succeed;
- tests succeed;
- critical financial invariants are verified;
- tenant isolation is tested;
- concurrency behavior is tested;
- security regression tests pass;
- the application starts from a clean environment;
- health checks behave correctly;
- graceful shutdown works;
- documentation matches reality;
- cleanup succeeds;
- the final working tree contains no accidental artifacts;
- you have reviewed your own final diff.

Never state “all tests pass” unless you actually ran all relevant tests.

When a test cannot be run, state exactly:

- which test was not run;
- why it could not run;
- what evidence is available instead;
- what risk remains.

---

## 15. Final Response Format

Your final answer must contain the following sections.

### 1. Repository Assessment

Summarize the architecture and the most important problems discovered.

### 2. Root Causes

Explain the root causes rather than only listing symptoms.

### 3. Changes Made

List the important files and behavior changed.

### 4. Financial Correctness

Explain how double-entry accounting, balances, transactions, reversals, and concurrency are protected.

### 5. Security Findings

Separate:

- confirmed vulnerabilities fixed;
- suspected issues investigated but not confirmed;
- remaining risks.

### 6. Database and Migration Safety

Explain migrations, constraints, legacy-data handling, and rollback considerations.

### 7. Testing Evidence

Provide the exact commands executed and their actual results.

Include numbers of passing, failing, and skipped tests where available.

### 8. Adversarial Validation

Describe the concurrency, replay, tenant-isolation, malformed-input, and failure scenarios tested.

### 9. Cleanup Verification

Confirm whether temporary processes, containers, ports, files, and test data were removed.

### 10. Remaining Limitations

Be explicit and honest.

### 11. Final Verdict

Use exactly one of:

```text
VERDICT: READY
VERDICT: READY WITH KNOWN LIMITATIONS
VERDICT: NOT READY
```

Do not use `READY` when critical tests were skipped, financial invariants remain uncertain, tenant isolation is unverified, or security-critical failures remain unresolved.
