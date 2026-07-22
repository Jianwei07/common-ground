# Common Ground Design Contract

Status: MVP implementation contract
Product line: **Design systems together.**

## 1. Product definition

Common Ground is a local-first architecture workbench for engineering teams. A single working surface combines an Excalidraw canvas, a Python-first Monaco workspace, local code execution, and optional encrypted collaboration. The portable unit is one `.ground` file.

The launch category is team architecture work, not interview software. CoderPad and HackerRank already pair collaborative drawing with runnable editors; a split screen is not a moat. Common Ground instead owns the complete local artifact: diagram, source, diagram-to-code links, run configurations, and selected results.

### Positioning

- Local-first and useful offline.
- Source runs on the user's machine and is not uploaded for execution.
- Canvas elements can point to exact files, lines, symbols, or run configurations.
- Canvas and code can later share one encrypted real-time room.
- No account is required for the local product or ephemeral rooms.

### Open-source and commercial boundary

- The workbench, protocol package, and runner are MIT licensed.
- The hosted relay is AGPL-3.0-only and remains self-hostable.
- A future managed service may sell persistent rooms, history, identity, and governance. Those features and billing are outside the MVP.

### Evidence informing the wedge

- [CoderPad drawing mode](https://coderpad.io/resources/docs/interview/drawing-mode/) and [multi-file pads](https://coderpad.io/resources/docs/interview/pads/using-pad-features/) establish that drawing plus runnable code is already available in interviews.
- [HackerRank Interview](https://www.hackerrank.com/products/interview) also combines a shared IDE and whiteboard.
- [Eraser](https://docs.eraser.io/docs/what-is-eraser) validates an engineering-team diagram/document market, while its documented core is not a runnable local project artifact.
- [Excalidraw](https://github.com/excalidraw/excalidraw) validates local-first drawing and encrypted collaboration.
- [Zed](https://github.com/zed-industries/zed) is a performance and multiplayer reference, not an embeddable web dependency.

## 2. Domain contract

| Term | Meaning |
|---|---|
| Workspace | The live local project: canvas, files, links, run configurations, and optional pinned results. |
| Ground artifact | A portable, versioned ZIP representation of one workspace. |
| Canvas element | An Excalidraw element identified by its stable element ID. |
| Ground link | A relation from a canvas element to code or a run configuration. |
| Run configuration | A named runtime and entrypoint, with optional standard input. |
| Pinned run | A deliberately persisted result included in an artifact; transient output is not persisted. |
| Room | An ephemeral relay namespace whose content is end-to-end encrypted by clients. |
| Participant session | One random client identity used for awareness and sender-key derivation. |
| Runner | The loopback service that validates requests and invokes a fixed Docker runtime. |

### Domain invariants

1. Project paths are normalized, relative POSIX paths beneath `workspace/`.
2. A link references an existing canvas element and a valid code path or run configuration.
3. Run configurations select only a built-in runtime ID and a workspace entrypoint.
4. Room keys are generated client-side, remain in URL fragments, and never reach the relay.
5. The relay stores and forwards opaque ciphertext only.
6. The runner chooses images, commands, flags, mounts, limits, and environment; clients cannot override them.
7. Transient CRDT history, dependencies, caches, build output, and unpinned output never enter a `.ground` file.

## 3. Experience contract

### Routes and capability

- `/` redirects to `/workspace`.
- `/workspace` restores the last local workspace or creates a blank one.
- `/room/:roomId#key=…` opens an encrypted ephemeral room.
- Chrome and Edge are fully supported. Safari and Firefox receive best-effort local editing.
- Screens narrower than 768 px are view/present-only.

### Desktop layout

The product opens directly into a resizable workbench. A compact top bar contains the editable workspace name, local/room status, presence, import/export, and Share. Beneath it, the warm canvas sits to the left and the editor sits to the right. New workspaces open `main.py`; a compact toolbar above Monaco selects Python, JavaScript, TypeScript, Go, or Rust and runs the remembered file for that language. The Result panel below Monaco is open by default. Either main pane can enter focus mode.

There is no dashboard, marketing hero, permanent inspector, or card grid.

### Visual thesis

A warm neutral drafting surface is recessed into a graphite workbench. Cobalt is the only action and collaboration accent. Tailwind-backed semantic CSS variables define the palette, spacing, 4–6 px radii, one-pixel borders, and restrained shadows. System sans and monospace fonts avoid a font-loading dependency. There are no gradients.

### Interaction thesis

- The two work surfaces enter with a short opacity/translate sequence.
- Split resizing and focus mode preserve spatial continuity.
- Canvas/code link selection, output reveal, and remote presence use brief functional highlights.
- All non-essential animation is disabled by `prefers-reduced-motion`.

### Accessibility

- Top bar, splitter, file tree, tabs, output, dialogs, and focus mode are keyboard reachable.
- Icon-only controls have accessible names and visible focus rings.
- Connection and run state are expressed with text, not color alone.
- Run status uses a polite live region.
- Monaco accessibility mode remains available.

## 4. Ground artifact contract

`.ground` is a ZIP archive with this layout:

```text
manifest.json
canvas.excalidraw
workspace/<project files>
links.json
runs.json
assets/<sha256>          # optional local binary artifacts
```

Version 1 manifest:

```ts
type GroundManifestV1 = {
  format: "common-ground";
  version: 1;
  workspaceId: string;
  name: string;
  canvas: "canvas.excalidraw";
  filesRoot: "workspace/";
  links: "links.json";
  runs: "runs.json";
};
```

Import fails atomically on unsupported versions, invalid JSON, absolute paths, backslashes, `.` or `..` segments, duplicate normalized paths, entries above 10 MB, archives above 25 MB uncompressed, or more than 1,000 entries. Required entries must exist exactly once. No partially imported workspace is committed.

## 5. Architecture

### Repository

```text
apps/web             Next.js PWA and local workspace
apps/relay           Cloudflare Worker and room Durable Object
packages/protocol    shared schemas, archive, and encrypted frame protocol
runner               foreground Go loopback helper
runner/images        fixed runtime image definitions
DESIGN.md             canonical contract
.planning/specs       executable delivery status
```

The repository uses a pnpm workspace without Turborepo. TypeScript is strict. Code stays in its deployable until a second real consumer exists; `packages/protocol` is shared because web and relay both consume its wire schemas.

### Web

- Current stable Next.js App Router and React.
- Tailwind v4 with semantic CSS variables.
- Embedded `@excalidraw/excalidraw` and Monaco; neither is forked.
- Yjs is the shared document, persisted through `y-indexeddb`; `y-monaco` binds the editor.
- A small Zustand store owns ephemeral layout and selection state only.
- Zod validates trust boundaries; `fflate` reads and writes `.ground` archives.
- A web manifest and Serwist-managed service worker cache the application shell.
- OpenNext targets Cloudflare Workers.

### Shared document

The Yjs document owns files, canvas scene JSON, links, run configurations, and pinned results. UI state such as active tab, splitter position, open panels, and focus mode is local. IndexedDB restores the last workspace. Export reads a consistent document snapshot into the artifact contract.

### Public seams

Only two replaceable Interfaces exist in the MVP:

```ts
interface Runner {
  health(signal?: AbortSignal): Promise<RunnerHealth>;
  run(request: RunRequest, signal?: AbortSignal): AsyncIterable<RunEvent>;
  cancel(requestId: string): Promise<void>;
}

interface RoomTransport {
  connect(roomId: string, signal?: AbortSignal): Promise<void>;
  send(frame: Uint8Array): void;
  close(): void;
  subscribe(listener: (frame: Uint8Array) => void): () => void;
}
```

Each has one production adapter and one in-memory test adapter. Excalidraw and Monaco remain concrete integrations.

## 6. Local runner security contract

The PWA streams NDJSON from a foreground helper on `127.0.0.1`:

```text
GET    /v1/health
POST   /v1/pair
POST   /v1/runs
DELETE /v1/runs/:requestId
```

On the first Run, the workbench shows the exact-origin command needed to start the helper, checks its loopback connection, then asks for the short one-time pairing code. A successful pair returns a random bearer token and immediately runs the selected program; later runs need one click. Every non-health request requires both an exact configured Origin and the token. CORS never uses `*`. The helper exits after 15 minutes without an authenticated client or active run.

The request surface is closed: runtime ID, files, entrypoint, and optional stdin only. Paths and total source size are validated. Images and invocation templates are compiled into the helper.

Every Docker run uses a digest-pinned multi-architecture image and enforces:

- `--network none`
- read-only root filesystem
- tmpfs workspace populated from a tar stream on stdin
- non-root user
- all capabilities dropped and `no-new-privileges`
- one CPU, 512 MB memory, 64 PIDs
- 15-second wall timeout
- 1 MB combined output and 10 MB source limits
- exact container ID/name tracking, `--rm`, cancellation, and label-scoped orphan cleanup

No Docker socket, host path, arbitrary image, command, flag, mount, or environment variable is client-controlled. Cleanup never performs a global prune. The editor presents Python first, followed by JavaScript, TypeScript, Go, and Rust. Package installation and runtime networking are excluded.

## 7. Encrypted room contract

- Clients generate an unguessable room ID and 256-bit room key.
- The key is encoded in the URL fragment and therefore absent from HTTP and WebSocket requests.
- HKDF-SHA-256 derives a sender subkey from the room key and random participant-session ID.
- AES-256-GCM encrypts every document update, awareness update, and snapshot.
- Each sender uses a monotonically increasing 64-bit counter in a 96-bit nonce and authenticates protocol version, room ID, sender ID, counter, and frame kind.
- Receivers reject invalid authentication, malformed metadata, and repeated or decreasing counters per sender.
- The relay can observe room ID, timing, frame kind, and byte size, but not plaintext.

One room permits 10 active editors and 25 present participants. Edit-link possession is the only authorization in v1. Binary attachments remain local-only. The Durable Object keeps one compact encrypted snapshot BLOB, capped at 1.5 MB, for 24 hours after the last disconnect; an alarm deletes it after expiry. No D1, R2, authentication, billing, analytics, or third-party observability is introduced.

## 8. Delivery roadmap

1. Establish product, domain, UX, security, and architecture contracts.
2. Ship the offline workbench for canvas, Python-first files, links, and `.ground` import/export.
3. Add the guided paired loopback helper and Python Docker execution.
4. Reuse the fixed runner path for JavaScript, TypeScript, Go, and Rust.
5. Add encrypted ephemeral rooms and snapshots.
6. Release after functional, security, accessibility, performance, and multi-client checks pass.

Full IDE parity is deferred: terminal, runner-backed LSP, Git, debugger, extensions, settings sync, hosted execution, accounts, billing, and persistent rooms. Add one only after observed usage makes its cost real.

## 9. Release gates

### Functional

- A multi-file canvas workspace survives browser close/reopen while offline.
- Export, local clearing, and import reproduce canvas, files, links, run configurations, and pinned results.
- Canvas links open the target file and optional line or symbol.
- Two browser contexts can concurrently edit canvas and code without lost updates.
- A participant can join from an encrypted snapshot within 24 hours.
- Wrong keys and modified ciphertext fail closed.

### Security

- Archive traversal, duplicate paths, unsupported versions, oversized entries, and decompression bombs are rejected.
- Runner requests cannot reach the internet, host services, Docker socket, or host files.
- Timeouts and cancellation terminate the exact container; limits are enforced; labelled orphans do not remain.
- Logs contain identifiers, runtime, counts, sizes, durations, result state, and error codes only—never room keys, source, output, or ciphertext.

### Performance fixtures

- Local fixture: 1,000 canvas elements, 100 files, up to 5 MB source.
- Shared snapshot: up to 1.5 MB encrypted.
- Cached workspace ready within 2 seconds; first online load within 4 seconds on the documented test profile.
- Pan/zoom and typing target 60 fps with no steady-state main-thread task above 50 ms.
- Same-region remote updates target 250 ms p95.
- Warm runs target 2 seconds for JS/Python and 5 seconds for Go/Rust.

### Operations and accessibility

- Automated accessibility checks pass and VoiceOver receives a manual smoke test.
- Core keyboard flows, visible focus, reduced motion, and live run announcements work.
- Official beta remains within Cloudflare's free plan and accepts hard quota failures rather than paid overages.

## 10. Assumptions

- Users install Docker and manually start the helper.
- macOS and Linux are the first runner platforms.
- Dependency versions are current stable releases at scaffold time and pinned by the lockfile.
- OCI images are pinned by digest before release.
- Phones and tablets are present/view-only.
- The managed-service hypothesis is persistent host-paid rooms with guests free; no billing code is in this repository.
