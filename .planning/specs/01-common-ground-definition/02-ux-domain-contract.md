# Task: UX and domain contract

## Objective
Define the workbench routes, responsive behavior, visual system, accessible interaction model, domain language, and invariants.

## User Story
As an engineer, I open Common Ground directly into a calm working surface and can understand its status and actions without an account or onboarding flow.

## Context
- `DESIGN.md` owns product and interface decisions.
- The UI follows a technical drafting desk direction: warm canvas, graphite chassis, cobalt accent.
- Mobile is view/present-only in the MVP.

## Changes
1. Add domain terms and invariants to `DESIGN.md`.
2. Add route, desktop layout, mobile capability, visual, motion, and accessibility contracts to `DESIGN.md`.
3. Add performance and functional fixtures used by later implementation leaves.

## Verification
- `rg -n "Domain contract|Experience contract|Accessibility|Performance fixtures" DESIGN.md`

## Done
- Routes, layout, state ownership, domain terms, and non-negotiable accessibility behavior are unambiguous.
