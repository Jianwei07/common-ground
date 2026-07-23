"use client";

import type { RunEvent } from "@common-ground/protocol";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useLayoutStore } from "../lib/layout-store";
import { CloseIcon } from "./icons";

export function OutputPanel({
  events,
  onStop,
  running,
  stale,
}: {
  events: RunEvent[];
  onStop: () => void;
  running: boolean;
  stale: boolean;
}) {
  const outputOpen = useLayoutStore((state) => state.outputOpen);
  const setOutputOpen = useLayoutStore((state) => state.setOutputOpen);
  const [height, setHeight] = useState(200);
  const drag = useRef<{ height: number; y: number } | null>(null);
  const output = events.filter(isOutputEvent);
  const exit = [...events].reverse().find((event) => event.type === "exit");
  const resize = (next: number) => setHeight(Math.min(600, Math.max(100, next)));
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { height, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) resize(drag.current.height + drag.current.y - event.clientY);
  };
  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!outputOpen) return null;
  return (
    <section aria-label="Result" className="output-panel" style={{ height }}>
      <div
        aria-label="Resize editor and result"
        aria-orientation="horizontal"
        aria-valuemax={600}
        aria-valuemin={100}
        aria-valuenow={height}
        className="output-resizer"
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") event.preventDefault();
          if (event.key === "ArrowUp") resize(height + 20);
          if (event.key === "ArrowDown") resize(height - 20);
        }}
        onPointerCancel={stopResize}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={stopResize}
        role="separator"
        tabIndex={0}
      ><span /></div>
      <div className="output-toolbar">
        <div className="output-title"><span>Result</span><span aria-live="polite" className="run-state">{running ? "Running" : stale ? "Source changed · run again" : exit?.type === "exit" ? `${exit.reason} · exit ${exit.exitCode ?? "—"}` : "Not run"}</span></div>
        <div className="run-config-controls">
          {running ? <button className="text-button danger" onClick={onStop} type="button">Stop</button> : null}
          <button aria-label="Close result" className="icon-button compact" onClick={() => setOutputOpen(false)} type="button"><CloseIcon /></button>
        </div>
      </div>
      <pre className="output-stream" tabIndex={0}>{stale ? <span className="output-placeholder">Code changed. Run again to update the result.</span> : output.length ? output.map((event, index) => <span className={event.type === "stderr" ? "stderr" : ""} key={`${event.requestId}-${index}`}>{event.chunk}</span>) : <span className="output-placeholder">Run your code to see the result.</span>}</pre>
    </section>
  );
}

function isOutputEvent(event: RunEvent): event is RunEvent & { chunk: string; type: "stdout" | "stderr" } {
  return event.type === "stdout" || event.type === "stderr";
}
