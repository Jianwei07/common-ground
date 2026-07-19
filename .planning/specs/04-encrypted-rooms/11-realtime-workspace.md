# Task: Realtime workspace

## Objective
Synchronize Yjs document updates and Awareness across encrypted rooms without losing local persistence.

## User Story
As an engineer, I can share a room and co-edit both diagram and code while seeing restrained live presence.

## Context
- Relevant paths: web Yjs workspace, room crypto/transport, Excalidraw integration, Monaco binding, and room route.
- Document, awareness, and snapshots are distinct encrypted frame kinds.
- Binary canvas attachments stay local-only.

## Changes
1. Add `/room/[roomId]` using the fragment key and encrypted RoomTransport adapter.
2. Encrypt/decrypt Yjs updates and Awareness messages and apply remote state without echo loops.
3. Bind Monaco text to Yjs and reconcile Excalidraw scene updates through the same document.
4. Add presence UI and a two-context convergence test covering code and canvas changes.

## Verification
- `pnpm --filter @common-ground/web test`
- `pnpm --filter @common-ground/web test:e2e`

## Done
- Two clients converge on canvas and code, preserve local state, and expose no plaintext on transport.
