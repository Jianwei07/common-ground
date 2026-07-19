# Task: PWA workbench shell

## Objective
Deliver an installable, offline-capable Next.js workbench with embedded Excalidraw and Monaco, a resizable split, focus mode, file navigation, output, and a view-only mobile presentation.

## User Story
As an engineer, I can draw and edit project files in one polished local work surface that recovers after reload and remains usable offline.

## Context
- Relevant paths: `apps/web`, root workspace configuration, and `DESIGN.md`.
- Use semantic CSS variables and Tailwind v4; do not add a component kit.
- Canvas and editor are concrete vendor integrations.

## Changes
1. Scaffold the pnpm workspace and strict Next.js App Router app with `/` redirecting to `/workspace`.
2. Build the accessible top bar, resizable canvas/editor regions, file tree, tabs, Monaco editor, output drawer, focus modes, and mobile view-only state.
3. Embed Excalidraw and Monaco through small integration modules; add manifest and offline service worker wiring.
4. Add one focused browser smoke test for route, keyboard controls, and responsive view-only behavior.

## Verification
- `pnpm --filter @common-ground/web test`
- `pnpm --filter @common-ground/web build`

## Done
- The workbench renders as contracted, core controls are keyboard labelled, and the production PWA build succeeds.
