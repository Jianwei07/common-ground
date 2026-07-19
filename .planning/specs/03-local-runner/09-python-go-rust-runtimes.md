# Task: Python Go and Rust runtimes

## Objective
Reuse the validated Docker path for Python, Go, and Rust without expanding the client-controlled surface.

## User Story
As an engineer, I can select a built-in Python, Go, or Rust run configuration and receive the same bounded local execution behavior.

## Context
- Relevant paths: shared runtime schemas and fixed runner runtime table.
- No language-specific runner abstraction is needed beyond data-driven fixed definitions.
- Package installation and network access remain excluded.

## Changes
1. Add fixed, digest-ready image and command definitions for Python, Go, and Rust.
2. Add representative runtime fixtures and reuse the sandbox conformance tests.
3. Expose all built-in runtime IDs in run-configuration UI and artifact validation.

## Verification
- `go test ./...`
- `pnpm --filter @common-ground/protocol test`

## Done
- All five runtime IDs validate and map to fixed commands while sharing identical isolation, timeout, output, and cleanup behavior.
