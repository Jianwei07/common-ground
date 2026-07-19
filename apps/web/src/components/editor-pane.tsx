"use client";

import type { GroundFile } from "@common-ground/protocol";
import type { BeforeMount, OnMount } from "@monaco-editor/react";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";

import { useLayoutStore } from "../lib/layout-store";
import type { WorkspaceDocument } from "../lib/workspace";
import { AddIcon, CloseIcon, FileIcon, FocusIcon, SidebarIcon } from "./icons";

const Editor = dynamic(() => import("@monaco-editor/react"), {
  loading: () => <div className="pane-loading dark">Loading editor…</div>,
  ssr: false,
});

export function EditorPane({
  activePath,
  files,
  focused,
  model,
  onActivate,
  onCloseTab,
  onFocus,
  onNewFile,
  openPaths,
  pendingLine,
}: {
  activePath: string | null;
  files: GroundFile[];
  focused: boolean;
  model: WorkspaceDocument;
  onActivate: (path: string) => void;
  onCloseTab: (path: string) => void;
  onFocus: () => void;
  onNewFile: () => void;
  openPaths: string[];
  pendingLine: number | null;
}) {
  const treeOpen = useLayoutStore((state) => state.treeOpen);
  const setTreeOpen = useLayoutStore((state) => state.setTreeOpen);

  return (
    <section aria-label="Code workspace" className="editor-pane pane-surface">
      <div className="pane-heading editor-heading">
        <div className="editor-heading-left">
          <button aria-label={treeOpen ? "Collapse file tree" : "Expand file tree"} aria-pressed={treeOpen} className="icon-button" onClick={() => setTreeOpen(!treeOpen)} type="button"><SidebarIcon /></button>
          <span className="eyebrow">Workspace</span><span className="pane-detail">{files.length} {files.length === 1 ? "file" : "files"}</span>
        </div>
        <button aria-label={focused ? "Exit editor focus mode" : "Focus editor"} className="icon-button" onClick={onFocus} type="button"><FocusIcon /></button>
      </div>
      <div className={`editor-body ${treeOpen ? "tree-visible" : ""}`}>
        {treeOpen ? (
          <aside aria-label="Project files" className="file-tree">
            <div className="file-tree-heading"><span>Files</span><button aria-label="New file" className="icon-button compact" onClick={onNewFile} type="button"><AddIcon /></button></div>
            <ul>
              {files.map((file) => (
                <li key={file.path}>
                  <button aria-current={file.path === activePath ? "page" : undefined} className={file.path === activePath ? "active" : ""} onClick={() => onActivate(file.path)} title={file.path} type="button"><FileIcon /><span>{file.path}</span></button>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
        <div className="editor-main">
          <div aria-label="Open files" className="editor-tabs" role="tablist">
            {openPaths.map((path) => (
              <div className={path === activePath ? "editor-tab active" : "editor-tab"} key={path} role="presentation">
                <button aria-selected={path === activePath} onClick={() => onActivate(path)} role="tab" type="button">{basename(path)}</button>
                <button aria-label={`Close ${path}`} className="tab-close" onClick={() => onCloseTab(path)} type="button"><CloseIcon /></button>
              </div>
            ))}
          </div>
          <div className="monaco-shell">
            {activePath ? <BoundEditor key={activePath} line={pendingLine} model={model} path={activePath} /> : <EmptyEditor onNewFile={onNewFile} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function BoundEditor({ line, model, path }: { line: number | null; model: WorkspaceDocument; path: string }) {
  const binding = useRef<{ destroy(): void } | null>(null);
  const disposed = useRef(false);
  const onMount: OnMount = (editor) => {
    const textModel = editor.getModel();
    if (!textModel) return;
    void import("y-monaco").then(({ MonacoBinding }) => {
      if (disposed.current || editor.getModel() !== textModel) return;
      binding.current = new MonacoBinding(model.getFileText(path), textModel, new Set([editor]), model.awareness);
      if (line) {
        editor.revealLineInCenter(line);
        editor.setPosition({ column: 1, lineNumber: line });
        editor.focus();
      }
    });
  };
  useEffect(() => () => {
    disposed.current = true;
    binding.current?.destroy();
  }, []);

  return (
    <Editor
      beforeMount={defineTheme}
      defaultLanguage={languageFor(path)}
      defaultValue={model.getFileText(path).toString()}
      onMount={onMount}
      options={{
        accessibilitySupport: "auto",
        automaticLayout: true,
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        lineHeight: 21,
        minimap: { enabled: false },
        padding: { top: 14 },
        renderLineHighlight: "all",
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 2,
      }}
      path={`file:///${path}`}
      theme="common-ground"
    />
  );
}

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("common-ground", {
    base: "vs-dark",
    inherit: true,
    colors: {
      "editor.background": "#181b1a",
      "editor.foreground": "#d8d9d4",
      "editor.lineHighlightBackground": "#222625",
      "editor.selectionBackground": "#2457d666",
      "editorCursor.foreground": "#5b82eb",
      "editorGutter.background": "#181b1a",
      "editorLineNumber.activeForeground": "#b8bab5",
      "editorLineNumber.foreground": "#5d625f",
    },
    rules: [
      { foreground: "7da2ef", token: "keyword" },
      { foreground: "d5ab74", token: "string" },
      { foreground: "8dbf9c", token: "number" },
      { foreground: "777d79", token: "comment" },
    ],
  });
};

function EmptyEditor({ onNewFile }: { onNewFile: () => void }) {
  return <div className="empty-editor"><FileIcon /><p>No file open</p><button className="button secondary" onClick={onNewFile} type="button">Create file</button></div>;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ go: "go", js: "javascript", jsx: "javascript", py: "python", rs: "rust", ts: "typescript", tsx: "typescript" } as Record<string, string>)[extension ?? ""] ?? "plaintext";
}
