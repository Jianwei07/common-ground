# Task: Canvas-code links

## Objective
Let users create, inspect, follow, and remove links from selected canvas elements to code locations or run configurations.

## User Story
As an engineer, I can select a diagram element and jump directly to the implementation or runnable example it represents.

## Context
- Relevant paths: protocol link schemas, Excalidraw selection integration, editor navigation, and workspace UI tests.
- Links live in Yjs and export in `links.json`.
- Do not add a permanent inspector; use one contextual popover/dialog.

## Changes
1. Track selected Excalidraw element IDs and expose a compact Link action when exactly one element is selected.
2. Add an accessible link dialog for code path, optional line/symbol, or run configuration.
3. Highlight linked elements and navigate link activation to the target tab and line.
4. Test schema validation, link creation/removal, and code navigation.

## Verification
- `pnpm --filter @common-ground/web test`

## Done
- A selected canvas element can link to and open a valid target, survives export/import, and never leaves an invalid target silently active.
