"use client";

import type { GroundWorkspace, RunConfiguration, RunEvent, RuntimeId } from "@common-ground/protocol";

import { useLayoutStore } from "../lib/layout-store";
import type { WorkspaceDocument } from "../lib/workspace";
import { CloseIcon } from "./icons";

export function OutputPanel({
  activeConfigurationId,
  events,
  model,
  onConfiguration,
  onStop,
  running,
  workspace,
}: {
  activeConfigurationId: string | null;
  events: RunEvent[];
  model: WorkspaceDocument;
  onConfiguration: (id: string) => void;
  onStop: () => void;
  running: boolean;
  workspace: GroundWorkspace;
}) {
  const outputOpen = useLayoutStore((state) => state.outputOpen);
  const setOutputOpen = useLayoutStore((state) => state.setOutputOpen);
  const configuration = workspace.runs.configurations.find((run) => run.id === activeConfigurationId) ?? workspace.runs.configurations[0];
  const output = events.filter(isOutputEvent);
  const exit = [...events].reverse().find((event) => event.type === "exit");

  if (!outputOpen) return null;
  return (
    <section aria-label="Run output" className="output-panel">
      <div className="output-toolbar">
        <div className="output-title"><span>Output</span><span aria-live="polite" className="run-state">{running ? "Running" : exit?.type === "exit" ? `${exit.reason} · ${exit.exitCode ?? "—"}` : "Ready"}</span></div>
        <div className="run-config-controls">
          {workspace.runs.configurations.length > 1 ? <select aria-label="Run configuration" className="inline-select" onChange={(event) => onConfiguration(event.target.value)} value={configuration?.id}>{workspace.runs.configurations.map((run) => <option key={run.id} value={run.id}>{run.name}</option>)}</select> : null}
          {configuration ? <RuntimeControls configuration={configuration} model={model} workspace={workspace} /> : null}
          {running ? <button className="text-button danger" onClick={onStop} type="button">Stop</button> : null}
          <button aria-label="Close output" className="icon-button compact" onClick={() => setOutputOpen(false)} type="button"><CloseIcon /></button>
        </div>
      </div>
      <pre className="output-stream" tabIndex={0}>{output.length ? output.map((event, index) => <span className={event.type === "stderr" ? "stderr" : ""} key={`${event.requestId}-${index}`}>{event.chunk}</span>) : <span className="output-placeholder">Run the active configuration to stream local output.</span>}</pre>
    </section>
  );
}

function isOutputEvent(event: RunEvent): event is RunEvent & { chunk: string; type: "stdout" | "stderr" } {
  return event.type === "stdout" || event.type === "stderr";
}

function RuntimeControls({ configuration, model, workspace }: { configuration: RunConfiguration; model: WorkspaceDocument; workspace: GroundWorkspace }) {
  const update = (patch: Partial<Pick<RunConfiguration, "runtimeId" | "entrypoint">>) => model.setRunConfiguration({ ...configuration, ...patch });
  return (
    <>
      <select aria-label="Runtime" className="inline-select" onChange={(event) => update({ runtimeId: event.target.value as RuntimeId })} value={configuration.runtimeId}>
        <option value="typescript">TypeScript</option><option value="javascript">JavaScript</option><option value="python">Python</option><option value="go">Go</option><option value="rust">Rust</option>
      </select>
      <select aria-label="Entrypoint" className="inline-select entrypoint-select" onChange={(event) => update({ entrypoint: event.target.value })} value={configuration.entrypoint}>{workspace.files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select>
    </>
  );
}
