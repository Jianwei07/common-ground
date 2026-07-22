# Common Ground

Local-first architecture workbench: Excalidraw, a Python-first Monaco editor, portable `.ground` projects, local Docker execution, and encrypted ephemeral rooms.

## Develop

```sh
pnpm install
pnpm --filter @common-ground/web dev
```

The workbench runs at `http://localhost:3000/workspace`. New workspaces open `main.py`; choose a language beside the editor and press Run. The first Run guides local setup with this exact-origin command:

```sh
go run ./runner/cmd/common-ground-runner -origin http://localhost:3000
```

After the connection check, enter the helper's pairing code. The selected program runs immediately, and later runs are one click.

See [DESIGN.md](DESIGN.md) for the product, security, and architecture contract.
