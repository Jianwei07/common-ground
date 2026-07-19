"use client";

import type { CanvasDocument, GroundLink } from "@common-ground/protocol";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { FocusIcon, LinkIcon } from "./icons";

const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((module) => module.Excalidraw),
  { loading: () => <div className="pane-loading">Preparing drafting surface…</div>, ssr: false },
);

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
  const sceneVersion = useMemo(
    () => canvas.elements.map((element) => `${String(element.id)}:${String(element.version)}:${String(element.versionNonce)}`).join("|"),
    [canvas.elements],
  );

  useEffect(() => {
    if (!api) return;
    api.updateScene(
      { elements: canvas.elements, appState: canvas.appState } as unknown as Parameters<ExcalidrawImperativeAPI["updateScene"]>[0],
    );
  }, [api, canvas.appState, canvas.elements, sceneVersion]);

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
        <Excalidraw
          UIOptions={{
            canvasActions: {
              export: false,
              loadScene: false,
              saveAsImage: false,
              saveToActiveFile: false,
              toggleTheme: false,
            },
          }}
          autoFocus={false}
          excalidrawAPI={setApi}
          initialData={initialData}
          isCollaborating={isCollaborating}
          name="Common Ground canvas"
          onChange={(elements, appState) => {
            const selected = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
            onSelection(selected.length === 1 ? selected[0] ?? null : null);
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
