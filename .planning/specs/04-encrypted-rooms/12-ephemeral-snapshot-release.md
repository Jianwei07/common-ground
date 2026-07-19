# Task: Ephemeral snapshot release

## Objective
Retain one bounded encrypted room snapshot for 24 hours, delete it on alarm, and pass the MVP release gates.

## User Story
As an engineer, I can reopen a recently idle room from its encrypted snapshot and know it disappears automatically after expiry.

## Context
- Relevant paths: relay Durable Object storage, encrypted room join flow, full build and release checks.
- Snapshot size is capped at 1.5 MB and stored as one SQLite-backed Durable Object BLOB.
- Logs must never contain room keys, source, output, or ciphertext.

## Changes
1. Accept, cap, store, and serve one encrypted snapshot with a 24-hour expiry; schedule and implement deletion alarm.
2. Add reconnect/join snapshot flow and tests for expiry, oversize rejection, and no-plaintext logging.
3. Run archive, crypto, relay, workbench, accessibility, build, and Go checks; document only unavoidable manual release checks.

## Verification
- `pnpm test`
- `pnpm build`
- `go test ./...`
- `python3 /Users/jayden77/.agents/skills/jayden-workflow/scripts/validate_specs.py .`

## Done
- A fresh client restores the valid snapshot before expiry, cannot after expiry, and all automated MVP gates pass.
