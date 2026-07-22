"use client";

import type { CanvasDocument, GroundLink } from "@common-ground/protocol";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { selectCanvasState } from "../lib/workspace";
import { CloseIcon, FocusIcon, GitHubIcon, LinkIcon, PauseIcon, ResetIcon, RunIcon } from "./icons";

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((module) => module.Excalidraw),
  { loading: () => <div className="pane-loading">Preparing drafting surface…</div>, ssr: false },
);

const REPOSITORY_URL = "https://github.com/Jianwei07/common-ground";

export function CanvasPane({
  canvas,
  focused,
  isCollaborating,
  link,
  onCanvasChange,
  onEditLink,
  onFocus,
  onOpenLink,
  onSelection,
  viewOnly,
}: {
  canvas: CanvasDocument;
  focused: boolean;
  isCollaborating: boolean;
  link?: GroundLink;
  onCanvasChange: (elements: ReadonlyArray<Record<string, unknown>>, appState: Record<string, unknown>) => void;
  onEditLink: () => void;
  onFocus: () => void;
  onOpenLink: () => void;
  onSelection: (elementId: string | null) => void;
  viewOnly: boolean;
}) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const incomingScene = useMemo(() => sceneFingerprint(canvas.elements, canvas.appState ?? {}), [canvas.appState, canvas.elements]);
  const localScene = useRef(incomingScene);
  const selectedElement = useRef<string | null>(null);

  useEffect(() => {
    if (!api) return;
    if (localScene.current === incomingScene) return;
    const currentElements = api.getSceneElements() as unknown as ReadonlyArray<Record<string, unknown>>;
    const currentAppState = api.getAppState() as unknown as Record<string, unknown>;
    if (sceneFingerprint(currentElements, selectCanvasState(currentAppState)) === incomingScene) return;
    api.updateScene(
      { elements: canvas.elements, appState: canvas.appState } as unknown as Parameters<ExcalidrawImperativeAPI["updateScene"]>[0],
    );
  }, [api, canvas.appState, canvas.elements, incomingScene]);

  const initialData = useMemo(
    () => ({ elements: canvas.elements, appState: canvas.appState } as unknown as ExcalidrawInitialDataState),
    // Excalidraw consumes this only once; remote state flows through updateScene.
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <section aria-label="Architecture canvas" className="canvas-pane pane-surface">
      <div className="pane-heading canvas-heading">
        <div><span className="eyebrow">Canvas</span><span className="pane-detail">Architecture</span></div>
        <button aria-label={focused ? "Exit canvas focus mode" : "Focus canvas"} className="icon-button" onClick={onFocus} type="button"><FocusIcon /></button>
      </div>
      <div className="canvas-stage">
        <WhiteboardTimer />
        <a aria-label="Open Common Ground on GitHub" className="whiteboard-repository" href={REPOSITORY_URL} rel="noreferrer" target="_blank"><GitHubIcon /></a>
        <WhiteboardGuide />
        <Excalidraw
          UIOptions={{
            canvasActions: {
              export: false,
              loadScene: false,
              saveAsImage: false,
              saveToActiveFile: false,
              toggleTheme: false,
            },
            tools: { image: false },
          }}
          autoFocus={false}
          excalidrawAPI={setApi}
          initialData={initialData}
          isCollaborating={isCollaborating}
          name="Common Ground canvas"
          onChange={(elements, appState) => {
            const selected = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
            const selectedId = selected.length === 1 ? selected[0] ?? null : null;
            if (selectedElement.current !== selectedId) {
              selectedElement.current = selectedId;
              onSelection(selectedId);
            }
            const nextScene = sceneFingerprint(
              elements as unknown as ReadonlyArray<Record<string, unknown>>,
              selectCanvasState(appState as unknown as Record<string, unknown>),
            );
            if (localScene.current === nextScene) return;
            localScene.current = nextScene;
            onCanvasChange(elements as unknown as ReadonlyArray<Record<string, unknown>>, appState as unknown as Record<string, unknown>);
          }}
          onLinkOpen={(element, event) => {
            if (link?.elementId === element.id) {
              event.preventDefault();
              onOpenLink();
            }
          }}
          viewModeEnabled={viewOnly}
        />
      </div>
      {!viewOnly ? (
        <div className={`canvas-context ${link ? "linked" : ""}`} aria-live="polite">
          {link ? (
            <><span><LinkIcon />{link.target.kind === "code" ? link.target.symbol ?? link.target.path : "Linked run"}</span><button className="text-button" onClick={onOpenLink} type="button">Open</button><button className="text-button muted" onClick={onEditLink} type="button">Edit</button></>
          ) : (
            <span>Select one element to link it to code.</span>
          )}
        </div>
      ) : null}
    </section>
  );
}

function sceneFingerprint(elements: ReadonlyArray<Record<string, unknown>>, appState: Record<string, unknown>): string {
  return JSON.stringify([elements, appState]);
}

function WhiteboardTimer() {
  const [running, setRunning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(120);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setSecondsRemaining((current) => {
        if (current > 1) return current - 1;
        setRunning(false);
        return 0;
      });
    }, 1_000);
    return () => window.clearInterval(interval);
  }, [running]);

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = String(secondsRemaining % 60).padStart(2, "0");

  return (
    <div aria-label="Whiteboard timer controls" className="whiteboard-timer">
      <button aria-label={running ? "Pause timer" : "Start timer"} onClick={() => setRunning((current) => !current)} type="button">
        {running ? <PauseIcon /> : <RunIcon />}
      </button>
      <button aria-label="Reset timer" onClick={() => { setRunning(false); setSecondsRemaining(120); }} type="button"><ResetIcon /></button>
      <output aria-label="Whiteboard timer">{minutes}:{seconds}</output>
    </div>
  );
}

function WhiteboardGuide() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <aside aria-label="Whiteboard navigation help" className="whiteboard-guide">
      <button aria-label="Dismiss navigation help" className="whiteboard-guide-close" onClick={() => setVisible(false)} type="button"><CloseIcon /></button>
      <strong>How to navigate the whiteboard</strong>
      <p><b>Zoom:</b> Pinch or <kbd>⌘</kbd> + scroll</p>
      <p><b>Pan:</b> Two finger scroll or <kbd>space</kbd> + drag</p>
      <a href={`${REPOSITORY_URL}#readme`} rel="noreferrer" target="_blank">More help →</a>
    </aside>
  );
}
