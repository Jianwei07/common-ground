# Task: Local workspace and Ground format

## Objective
Persist the shared workspace locally and round-trip a safe version-1 `.ground` archive without partial imports.

## User Story
As an engineer, I can close the browser, recover my workspace offline, and move the complete project to another browser with one file.

## Context
- Relevant paths: `packages/protocol/src/ground.ts`, web workspace state, and import/export UI.
- Yjs owns durable shared state; Zustand owns layout only.
- Archive parsing is a trust boundary and cannot be simplified.

## Changes
1. Define Zod schemas and TypeScript types for manifests, files, links, run configurations, and pinned results.
2. Implement fflate export/import with normalized path, duplicate, entry count, entry size, total size, and version checks.
3. Add Yjs workspace creation, IndexedDB persistence, and snapshot/import replacement.
4. Wire named download/import actions into the top bar and cover valid round trips plus malicious archives in tests.

## Verification
- `pnpm --filter @common-ground/protocol test`
- `pnpm --filter @common-ground/web test`

## Done
- Valid state round-trips exactly and malformed or dangerous archives fail before replacing local state.
