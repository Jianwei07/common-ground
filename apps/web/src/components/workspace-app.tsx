"use client";

import {
  createRoomCredentials,
  exportGround,
  formatRoomFragment,
  importGround,
  type GroundLink,
  type RunEvent,
  type RuntimeId,
} from "@common-ground/protocol";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

import { useLayoutStore } from "../lib/layout-store";
import { hasRunnerToken, LoopbackRunner, pairRunner } from "../lib/runner";
import { useRoom } from "../lib/use-room";
import { storeRoomSeed, useWorkspace } from "../lib/use-workspace";
import { CanvasPane } from "./canvas-pane";
import { LinkDialog, NewFileDialog, PairDialog } from "./dialogs";
import { EditorPane } from "./editor-pane";
import { BrandMark, ExportIcon, ImportIcon, LinkIcon, ShareIcon } from "./icons";
import { OutputPanel } from "./output-panel";

type RunnerStatus = "checking" | "offline" | "paired" | "ready";

export function WorkspaceApp({ roomId }: { roomId?: string }) {
  const { error: workspaceError, importWorkspace, model, snapshot } = useWorkspace(roomId);
  const room = useRoom(roomId, model);
  const focus = useLayoutStore((state) => state.focus);
  const outputOpen = useLayoutStore((state) => state.outputOpen);
  const setFocus = useLayoutStore((state) => state.setFocus);
  const setOutputOpen = useLayoutStore((state) => state.setOutputOpen);
  const split = useLayoutStore((state) => state.split);
  const setSplit = useLayoutStore((state) => state.setSplit);
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activeConfigurationId, setActiveConfigurationId] = useState<string | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runFilesKey, setRunFilesKey] = useState<string | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [pairOpen, setPairOpen] = useState(false);
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus>("checking");
  const [runnerOrigin, setRunnerOrigin] = useState("");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const runAbort = useRef<AbortController | null>(null);
  const runner = useMemo(() => new LoopbackRunner(), []);

  useEffect(() => {
    const controller = new AbortController();
    void runner.health(controller.signal)
      .then((health) => setRunnerStatus(health.paired && hasRunnerToken() ? "paired" : "ready"))
      .catch(() => setRunnerStatus("offline"));
    return () => controller.abort();
  }, [runner]);

  useEffect(() => setRunnerOrigin(location.origin), []);

  useEffect(() => {
    if (!snapshot) return;
    const paths = new Set(snapshot.files.map((file) => file.path));
    const nextActive = activePath && paths.has(activePath) ? activePath : snapshot.files[0]?.path ?? null;
    if (nextActive !== activePath) setActivePath(nextActive);
    setOpenPaths((current) => {
      const valid = current.filter((path) => paths.has(path));
      if (nextActive && !valid.includes(nextActive)) valid.push(nextActive);
      return sameStrings(current, valid) ? current : valid;
    });
    if (!snapshot.runs.configurations.some((configuration) => configuration.id === activeConfigurationId)) {
      setActiveConfigurationId(snapshot.runs.configurations[0]?.id ?? null);
    }
  }, [activeConfigurationId, activePath, snapshot]);

  if (workspaceError || room.error) return <FailureScreen message={workspaceError ?? room.error ?? "Common Ground failed closed"} />;
  if (!model || !snapshot) return <LoadingScreen />;

  const resultStale = events.length > 0 && runFilesKey !== JSON.stringify(snapshot.files);
  const selectedLink = snapshot.links.find((link) => link.elementId === selectedElementId);
  const activate = (path: string, line: number | null = null) => {
    setActivePath(path);
    setOpenPaths((paths) => (paths.includes(path) ? paths : [...paths, path]));
    setPendingLine(line);
  };
  const openLink = (link: GroundLink) => {
    if (link.target.kind === "code") {
      activate(link.target.path, link.target.line ?? null);
      if (focus === "canvas") setFocus(null);
    } else {
      setActiveConfigurationId(link.target.runConfigurationId);
      setOutputOpen(true);
      if (focus === "canvas") setFocus(null);
    }
  };
  const createFile = (path: string) => {
    model.addFile(path);
    if (!snapshot.runs.configurations.length) {
      model.setRunConfiguration({
        id: "run-main",
        name: "Run main",
        runtimeId: runtimeFor(path),
        entrypoint: path,
      });
    }
    activate(path);
  };
  const closeTab = (path: string) => {
    setOpenPaths((current) => current.filter((candidate) => candidate !== path));
    if (path === activePath) {
      const remaining = openPaths.filter((candidate) => candidate !== path);
      setActivePath(remaining[remaining.length - 1] ?? null);
    }
  };
  const selectLanguage = (runtimeId: RuntimeId) => {
    const configuration = model.ensureRunConfiguration(runtimeId);
    setActiveConfigurationId(configuration.id);
    activate(configuration.entrypoint);
  };
  const executeRun = async () => {
    let current = model.getSnapshot();
    let configuration = current.runs.configurations.find((candidate) => candidate.id === activeConfigurationId) ?? current.runs.configurations[0];
    if (!configuration) {
      configuration = model.ensureRunConfiguration("python");
      setActiveConfigurationId(configuration.id);
      activate(configuration.entrypoint);
      current = model.getSnapshot();
    }
    setRunFilesKey(JSON.stringify(current.files));
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    runAbort.current = controller;
    setEvents([]);
    setOutputOpen(true);
    setRunning(true);
    try {
      for await (const event of runner.run({
        requestId,
        runtimeId: configuration.runtimeId,
        files: current.files,
        entrypoint: configuration.entrypoint,
        ...(configuration.stdin === undefined ? {} : { stdin: configuration.stdin }),
      }, controller.signal)) {
        setEvents((current) => [...current, event]);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setEvents((current) => [...current, { requestId, type: "stderr", chunk: `${safeError(cause)}\n` }, { requestId, type: "exit", exitCode: null, reason: "limit" }]);
      }
    } finally {
      runAbort.current = null;
      setRunning(false);
    }
  };
  const run = () => {
    if (!hasRunnerToken() || runnerStatus === "offline") {
      setPairOpen(true);
      return;
    }
    void executeRun();
  };
  const stop = async () => {
    const requestId = events[0]?.requestId;
    if (requestId) await runner.cancel(requestId).catch(() => undefined);
    runAbort.current?.abort();
  };
  const share = async () => {
    if (roomId) {
      await navigator.clipboard.writeText(location.href);
      setToast("Encrypted room link copied.");
      return;
    }
    const credentials = createRoomCredentials();
    storeRoomSeed(credentials.roomId, snapshot);
    location.assign(`/room/${credentials.roomId}#${formatRoomFragment(credentials.key)}`);
  };
  const exportWorkspace = () => {
    const archive = exportGround(snapshot);
    const href = URL.createObjectURL(new Blob([new Uint8Array(archive)], { type: "application/vnd.common-ground+zip" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${safeFilename(snapshot.name)}.ground`;
    anchor.click();
    URL.revokeObjectURL(href);
  };
  const importFile = async (file: File) => {
    try {
      const imported = importGround(new Uint8Array(await file.arrayBuffer()));
      if (roomId) model.replace(imported);
      else await importWorkspace(imported);
      setToast("Ground artifact imported.");
    } catch (cause) {
      setToast(`Import rejected: ${safeError(cause)}`);
    }
  };

  const style = { "--split": `${split}%` } as CSSProperties;
  return (
    <main className={`workbench focus-${focus ?? "none"}`}>
      <TopBar
        isRoom={Boolean(roomId)}
        name={snapshot.name}
        onExport={exportWorkspace}
        onImport={() => fileInput.current?.click()}
        onName={(name) => model.setName(name)}
        onShare={() => void share().catch((cause) => setToast(safeError(cause)))}
        participants={room.participants}
        roomStatus={room.status}
      />
      <input accept=".ground,application/zip" aria-label="Import Ground artifact file" className="visually-hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.currentTarget.value = ""; }} ref={fileInput} type="file" />
      {isMobile ? <div className="mobile-notice"><strong>Presentation mode</strong><span>Editing is available on a desktop browser.</span></div> : null}
      <div className="workspace-grid" style={style}>
        <CanvasPane
          canvas={snapshot.canvas}
          focused={focus === "canvas"}
          isCollaborating={Boolean(roomId)}
          {...(selectedLink ? { link: selectedLink } : {})}
          onCanvasChange={(elements, appState) => model.updateCanvas(elements, appState)}
          onEditLink={() => setLinkDialogOpen(true)}
          onFocus={() => setFocus(focus === "canvas" ? null : "canvas")}
          onOpenLink={() => selectedLink && openLink(selectedLink)}
          onSelection={setSelectedElementId}
          viewOnly={isMobile}
        />
        <Splitter disabled={focus !== null || isMobile} onChange={setSplit} value={split} />
        <div className="editor-column">
          <EditorPane
            activePath={activePath}
            files={snapshot.files}
            focused={focus === "editor"}
            language={(snapshot.runs.configurations.find((configuration) => configuration.id === activeConfigurationId) ?? snapshot.runs.configurations[0])?.runtimeId ?? "python"}
            model={model}
            onActivate={activate}
            onCloseTab={closeTab}
            onFocus={() => setFocus(focus === "editor" ? null : "editor")}
            onLanguage={selectLanguage}
            onNewFile={() => setNewFileOpen(true)}
            onRun={run}
            openPaths={openPaths}
            pendingLine={pendingLine}
            runnerStatus={running ? "Running…" : runnerStatus === "paired" ? "Runner paired" : runnerStatus === "ready" ? "Runner ready to pair" : runnerStatus === "checking" ? "Checking runner…" : "Runner offline"}
            running={running}
          />
          <OutputPanel events={events} onStop={() => void stop()} running={running} stale={resultStale} />
        </div>
      </div>
      {selectedElementId && !selectedLink && !isMobile ? <button className="link-selection-button" onClick={() => setLinkDialogOpen(true)} type="button"><LinkIcon />Link selected element</button> : null}
      <NewFileDialog onClose={() => setNewFileOpen(false)} onCreate={createFile} open={newFileOpen} />
      <PairDialog
        command={`go run ./runner/cmd/common-ground-runner -origin ${runnerOrigin || "<current-origin>"}`}
        connected={runnerStatus === "ready"}
        onCheck={async () => {
          const health = await runner.health();
          if (health.paired && !hasRunnerToken()) throw new Error("Runner is already paired. Restart it to get a new code.");
          if (health.paired) {
            setRunnerStatus("paired");
            setPairOpen(false);
            void executeRun();
          } else {
            setRunnerStatus("ready");
          }
        }}
        onClose={() => setPairOpen(false)}
        onPair={async (code) => {
          await pairRunner(code);
          setRunnerStatus("paired");
          setPairOpen(false);
          void executeRun();
        }}
        open={pairOpen}
      />
      <LinkDialog elementId={selectedElementId} {...(selectedLink ? { existing: selectedLink } : {})} onClose={() => setLinkDialogOpen(false)} onSave={(link) => model.setLink(link)} open={linkDialogOpen} workspace={snapshot} />
      {toast ? <div className="toast" role="status"><span>{toast}</span><button aria-label="Dismiss message" onClick={() => setToast(null)} type="button">×</button></div> : null}
      {outputOpen ? null : <button className="output-reopen" onClick={() => setOutputOpen(true)} type="button">Result</button>}
    </main>
  );
}

function TopBar({
  isRoom,
  name,
  onExport,
  onImport,
  onName,
  onShare,
  participants,
  roomStatus,
}: {
  isRoom: boolean;
  name: string;
  onExport: () => void;
  onImport: () => void;
  onName: (name: string) => void;
  onShare: () => void;
  participants: number;
  roomStatus: "connecting" | "encrypted" | "local";
}) {
  const [draftName, setDraftName] = useState(name);
  useEffect(() => setDraftName(name), [name]);
  return (
    <header className="topbar">
      <div className="brand"><BrandMark /><span>Common Ground</span></div>
      <span className="topbar-separator" />
      <input aria-label="Workspace name" className="workspace-name" maxLength={120} onBlur={() => onName(draftName)} onChange={(event) => setDraftName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} value={draftName} />
      <div className="topbar-status">
        <span className={`status-label ${isRoom ? "room" : ""}`}><span className="status-dot" />{isRoom ? roomStatus === "encrypted" ? "Encrypted room" : "Connecting" : "Saved locally"}</span>
        {isRoom ? <span aria-label={`${participants} participants`} className="presence"><span>Y</span>{participants > 1 ? <span>{participants}</span> : null}</span> : null}
      </div>
      <div className="topbar-actions">
        <button className="icon-button topbar-utility" onClick={onImport} title="Import .ground" type="button"><ImportIcon /><span className="visually-hidden">Import Ground artifact</span></button>
        <button className="icon-button topbar-utility" onClick={onExport} title="Export .ground" type="button"><ExportIcon /><span className="visually-hidden">Export Ground artifact</span></button>
        <button className="button primary share-button" onClick={onShare} type="button"><ShareIcon />{isRoom ? "Copy link" : "Share"}</button>
      </div>
    </header>
  );
}

function Splitter({ disabled, onChange, value }: { disabled: boolean; onChange: (value: number) => void; value: number }) {
  const dragging = useRef(false);
  const move = (event: PointerEvent) => {
    if (!dragging.current) return;
    onChange((event.clientX / window.innerWidth) * 100);
  };
  const stop = () => {
    dragging.current = false;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };
  const start = (event: ReactPointerEvent) => {
    if (disabled) return;
    event.preventDefault();
    dragging.current = true;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  useEffect(() => stop, []);
  return <div aria-disabled={disabled} aria-label="Resize canvas and editor" aria-orientation="vertical" aria-valuemax={75} aria-valuemin={25} aria-valuenow={Math.round(value)} className="splitter" onKeyDown={(event) => { if (disabled) return; if (event.key === "ArrowLeft") onChange(value - 2); if (event.key === "ArrowRight") onChange(value + 2); }} onPointerDown={start} role="separator" tabIndex={disabled ? -1 : 0}><span /></div>;
}

function LoadingScreen() {
  return <main className="status-screen"><BrandMark /><p>Restoring local workspace…</p></main>;
}

function FailureScreen({ message }: { message: string }) {
  return <main className="status-screen failure"><BrandMark /><h1>Common Ground stayed closed</h1><p>{message}</p><a className="button secondary" href="/workspace">Open local workspace</a></main>;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function safeFilename(name: string): string {
  return name.trim().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "workspace";
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Operation failed";
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function runtimeFor(path: string): RuntimeId {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension === "js" || extension === "jsx" ? "javascript" : extension === "py" ? "python" : extension === "go" ? "go" : extension === "rs" ? "rust" : "typescript";
}
