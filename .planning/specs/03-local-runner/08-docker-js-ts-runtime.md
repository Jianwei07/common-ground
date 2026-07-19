# Task: Docker JavaScript and TypeScript runtime

## Objective
Execute JavaScript and TypeScript through one fixed, sandboxed Docker adapter with exact container tracking and scoped cleanup.

## User Story
As an engineer, I can run the current JS or TS entrypoint locally and see bounded streaming output in the workbench.

## Context
- Relevant paths: `runner/internal/docker`, `runner/images`, and workbench run controls.
- Docker invocation is server-owned; requests never contain commands, images, mounts, flags, or environment.
- OCI images must be digest-pinned for release.

## Changes
1. Add the Docker Runner adapter and fixed JS/TS runtime definitions.
2. Stream a tar workspace to a no-network, read-only, non-root, capability-free, resource-limited container.
3. Track an exact generated name/container, enforce timeout/output limits, and remove only Common Ground labelled orphans.
4. Wire Run/cancel/output UI and add command-conformance tests plus an opt-in Docker smoke test.

## Verification
- `go test ./...`
- `CG_DOCKER_TEST=1 go test ./runner/... -run Docker`

## Done
- JS/TS output streams to the UI and the tested Docker invocation enforces every contracted isolation flag and cleanup boundary.
