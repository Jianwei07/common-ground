# Task: Encrypted room transport

## Objective
Implement replay-resistant client-side room encryption and an opaque Cloudflare Durable Object WebSocket relay.

## User Story
As an engineer, I can open an edit link whose secret never reaches the service and have malformed, replayed, or modified frames rejected.

## Context
- Relevant paths: `packages/protocol/src/crypto.ts`, `apps/web` room transport, and `apps/relay`.
- Native Web Crypto is the only cryptographic dependency.
- The RoomTransport production adapter has one in-memory test adapter.

## Changes
1. Define binary frame metadata and implement HKDF sender keys, AES-GCM encryption, monotonic nonces, authenticated metadata, and replay tracking.
2. Add client room-ID/key generation and fragment-only URL parsing.
3. Implement the AGPL Cloudflare Worker and one Durable Object WebSocket relay per room with editor/presenter caps.
4. Test correct round trips, wrong keys, tampering, counter replay, and opaque relay behavior.

## Verification
- `pnpm --filter @common-ground/protocol test`
- `pnpm --filter @common-ground/relay test`

## Done
- The relay handles only ciphertext and clients fail closed on every tested key, integrity, metadata, or replay error.
