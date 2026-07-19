# Task: Architecture roadmap

## Objective
Define the smallest monorepo, deployable boundaries, two public seams, security contracts, delivery order, and release gates.

## Context
- Only `Runner` and `RoomTransport` are replaceable interfaces in v1.
- Vendor modules stay concrete until a second implementation appears.
- `packages/protocol` is shared by web and relay.

## Changes
1. Add repository shape, web/data-flow decisions, public seams, runner constraints, room cryptography, and snapshot lifecycle to `DESIGN.md`.
2. Add delivery order, release gates, assumptions, and explicit deferred capabilities.
3. Create the complete indexed `.planning/specs/` tree with every status initially false.

## Verification
- `python3 /Users/jayden77/.agents/skills/jayden-workflow/scripts/validate_specs.py .`
- `rg -n "Public seams|Local runner security contract|Encrypted room contract|Release gates" DESIGN.md`

## Done
- The implementation order and trust boundaries are reviewable without inventing new architecture during execution.
