# Task: Product and market contract

## Objective
Record one durable product definition, launch wedge, open-source boundary, evidence base, and explicit MVP exclusions.

## Context
- `DESIGN.md` is the canonical contract; leaf specs must not duplicate it.
- The repository begins with an MIT license and no application code.
- Drawing plus runnable code already exists in interview products; portability and local-first team architecture work are the wedge.

## Changes
1. Add the product definition, positioning, market evidence, licensing boundary, managed-service hypothesis, and deferred scope to `DESIGN.md`.
2. Keep the workbench and runner MIT; mark the relay package AGPL-3.0-only when scaffolded.

## Verification
- `rg -n "Design systems together|Open-source and commercial boundary|Full IDE parity is deferred" DESIGN.md`

## Done
- A fresh contributor can state the user, wedge, business boundary, and excluded features from `DESIGN.md` alone.
