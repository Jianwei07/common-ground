"use client";

import type { GroundLink, GroundWorkspace } from "@common-ground/protocol";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { CloseIcon } from "./icons";

type BaseDialogProps = { onClose: () => void; open: boolean };

export function NewFileDialog({
  onClose,
  onCreate,
  open,
}: BaseDialogProps & { onCreate: (path: string) => void }) {
  const dialog = useDialog(open);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      onCreate(String(form.get("path") ?? ""));
      setError(null);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "File could not be created");
    }
  };

  return (
    <dialog aria-labelledby="new-file-title" className="dialog" onCancel={onClose} onClose={onClose} ref={dialog}>
      <form onSubmit={submit}>
        <DialogHeading id="new-file-title" onClose={onClose}>New file</DialogHeading>
        <label className="field-label" htmlFor="new-file-path">Project path</label>
        <input autoFocus className="text-field" id="new-file-path" name="path" placeholder="src/service.ts" required />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button className="button secondary" onClick={onClose} type="button">Cancel</button><button className="button primary" type="submit">Create file</button></div>
      </form>
    </dialog>
  );
}

export function PairDialog({
  onClose,
  onPair,
  open,
}: BaseDialogProps & { onPair: (code: string) => Promise<void> }) {
  const dialog = useDialog(open);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    try {
      await onPair(code);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <dialog aria-labelledby="pair-title" className="dialog" onCancel={onClose} onClose={onClose} ref={dialog}>
      <form onSubmit={(event) => void submit(event)}>
        <DialogHeading id="pair-title" onClose={onClose}>Pair local runner</DialogHeading>
        <p className="dialog-copy">Enter the one-time code shown by the foreground helper. Source stays on this machine.</p>
        <label className="field-label" htmlFor="pair-code">One-time code</label>
        <input autoComplete="one-time-code" autoFocus className="text-field pair-code" id="pair-code" inputMode="numeric" maxLength={8} name="code" required />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button className="button secondary" onClick={onClose} type="button">Cancel</button><button className="button primary" disabled={pending} type="submit">{pending ? "Pairing…" : "Pair runner"}</button></div>
      </form>
    </dialog>
  );
}

export function LinkDialog({
  elementId,
  existing,
  onClose,
  onSave,
  open,
  workspace,
}: BaseDialogProps & {
  elementId: string | null;
  existing?: GroundLink;
  onSave: (link: GroundLink) => void;
  workspace: GroundWorkspace;
}) {
  const dialog = useDialog(open);
  const [kind, setKind] = useState<"code" | "run">(existing?.target.kind ?? "code");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setKind(existing?.target.kind ?? "code"), [existing]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!elementId) return;
    const data = new FormData(event.currentTarget);
    try {
      if (kind === "code") {
        const lineValue = Number(data.get("line"));
        const symbol = String(data.get("symbol") ?? "").trim();
        onSave({
          id: existing?.id ?? crypto.randomUUID(),
          elementId,
          target: {
            kind: "code",
            path: String(data.get("path") ?? ""),
            ...(lineValue > 0 ? { line: lineValue } : {}),
            ...(symbol ? { symbol } : {}),
          },
        });
      } else {
        onSave({
          id: existing?.id ?? crypto.randomUUID(),
          elementId,
          target: { kind: "run", runConfigurationId: String(data.get("runConfigurationId") ?? "") },
        });
      }
      setError(null);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Link could not be saved");
    }
  };

  const existingCode = existing?.target.kind === "code" ? existing.target : undefined;
  const existingRun = existing?.target.kind === "run" ? existing.target : undefined;
  return (
    <dialog aria-labelledby="link-title" className="dialog link-dialog" onCancel={onClose} onClose={onClose} ref={dialog}>
      <form onSubmit={submit}>
        <DialogHeading id="link-title" onClose={onClose}>Link canvas element</DialogHeading>
        <fieldset className="segmented-field">
          <legend>Target type</legend>
          <label><input checked={kind === "code"} name="kind" onChange={() => setKind("code")} type="radio" value="code" /><span>Code</span></label>
          <label><input checked={kind === "run"} name="kind" onChange={() => setKind("run")} type="radio" value="run" /><span>Run</span></label>
        </fieldset>
        {kind === "code" ? (
          <div className="dialog-fields">
            <label className="field-label" htmlFor="link-path">File</label>
            <select className="text-field" defaultValue={existingCode?.path} id="link-path" name="path" required>
              {workspace.files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
            </select>
            <div className="field-columns">
              <div><label className="field-label" htmlFor="link-line">Line</label><input className="text-field" defaultValue={existingCode?.line} id="link-line" min="1" name="line" type="number" /></div>
              <div><label className="field-label" htmlFor="link-symbol">Symbol label</label><input className="text-field" defaultValue={existingCode?.symbol} id="link-symbol" name="symbol" placeholder="createServer" /></div>
            </div>
          </div>
        ) : (
          <div className="dialog-fields"><label className="field-label" htmlFor="link-run">Run configuration</label><select className="text-field" defaultValue={existingRun?.runConfigurationId} id="link-run" name="runConfigurationId" required>{workspace.runs.configurations.map((run) => <option key={run.id} value={run.id}>{run.name}</option>)}</select></div>
        )}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button className="button secondary" onClick={onClose} type="button">Cancel</button><button className="button primary" type="submit">Save link</button></div>
      </form>
    </dialog>
  );
}

function DialogHeading({ children, id, onClose }: { children: string; id: string; onClose: () => void }) {
  return <div className="dialog-heading"><h2 id={id}>{children}</h2><button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button"><CloseIcon /></button></div>;
}

function useDialog(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const current = dialog.current;
    if (!current) return;
    if (open && !current.open) current.showModal();
    if (!open && current.open) current.close();
  }, [open]);
  return dialog;
}
