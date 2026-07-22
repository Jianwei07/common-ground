"use client";

import type { RunEvent } from "@common-ground/protocol";

import { useLayoutStore } from "../lib/layout-store";
import { CloseIcon } from "./icons";

export function OutputPanel({
  events,
  onStop,
  running,
}: {
  events: RunEvent[];
  onStop: () => void;
  running: boolean;
}) {
  const outputOpen = useLayoutStore((state) => state.outputOpen);
  const setOutputOpen = useLayoutStore((state) => state.setOutputOpen);
  const output = events.filter(isOutputEvent);
  const exit = [...events].reverse().find((event) => event.type === "exit");

  if (!outputOpen) return null;
  return (
    <section aria-label="Result" className="output-panel">
      <div className="output-toolbar">
        <div className="output-title"><span>Result</span><span aria-live="polite" className="run-state">{running ? "Running" : exit?.type === "exit" ? `${exit.reason} · exit ${exit.exitCode ?? "—"}` : "Not run"}</span></div>
        <div className="run-config-controls">
          {running ? <button className="text-button danger" onClick={onStop} type="button">Stop</button> : null}
          <button aria-label="Close result" className="icon-button compact" onClick={() => setOutputOpen(false)} type="button"><CloseIcon /></button>
        </div>
      </div>
      <pre className="output-stream" tabIndex={0}>{output.length ? output.map((event, index) => <span className={event.type === "stderr" ? "stderr" : ""} key={`${event.requestId}-${index}`}>{event.chunk}</span>) : <span className="output-placeholder">Run your code to see the result.</span>}</pre>
    </section>
  );
}

function isOutputEvent(event: RunEvent): event is RunEvent & { chunk: string; type: "stdout" | "stderr" } {
  return event.type === "stdout" || event.type === "stderr";
}
