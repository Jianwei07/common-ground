# Common Ground

Local-first architecture workbench: Excalidraw, Monaco, portable `.ground` projects, local Docker execution, and encrypted ephemeral rooms.

## Develop

```sh
pnpm install
pnpm --filter @common-ground/web dev
```

The workbench runs at `http://localhost:3000/workspace`. Start the optional runner separately:

```sh
go run ./runner/cmd/common-ground-runner
```

See [DESIGN.md](DESIGN.md) for the product, security, and architecture contract.
