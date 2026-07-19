# Task: Loopback runner

## Objective
Deliver a foreground Go helper with exact-origin pairing, bearer authentication, bounded request validation, NDJSON streaming, cancellation, and idle shutdown.

## User Story
As an engineer, I can explicitly pair the browser with a local helper and run workspace code without uploading source.

## Context
- Relevant paths: `runner`, protocol run schemas, and the web runner client.
- The helper listens only on loopback and logs metadata, never source or output.
- Input and authentication are trust boundaries.

## Changes
1. Implement `/v1/health`, one-time `/v1/pair`, authenticated `/v1/runs`, and exact-request cancellation.
2. Enforce exact Origin allowlisting, random bearer tokens, runtime/path/source limits, output limits, timeouts, and idle shutdown.
3. Add the streaming fetch Runner adapter and an in-memory test adapter in the web app.
4. Add focused Go HTTP tests for pairing, CORS, auth, limits, streaming, and cancellation.

## Verification
- `go test ./...`
- `pnpm --filter @common-ground/web test`

## Done
- Unpaired or invalid-origin clients cannot run code, valid events stream in order, and cancellation targets only its request.
