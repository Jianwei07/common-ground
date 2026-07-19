import {
  groundWorkspaceSchema,
  normalizeProjectPath,
  type GroundLink,
  type GroundWorkspace,
  type PinnedRun,
  type RunConfiguration,
} from "@common-ground/protocol";
import { IndexeddbPersistence } from "y-indexeddb";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const LOCAL_STORAGE_PREFIX = "common-ground";
const DEFAULT_FILE = "src/index.ts";
const DEFAULT_SOURCE = `type Service = {
  name: string;
  port: number;
};

const services: Service[] = [
  { name: "api", port: 8080 },
  { name: "worker", port: 8081 },
];

console.log(services.map(({ name, port }) => \`\${name}:\${port}\`).join("\\n"));
`;

type CanvasElement = Record<string, unknown> & {
  id: string;
  index?: string;
  version?: number;
  versionNonce?: number;
};

type Listener = () => void;

export class WorkspaceDocument {
  readonly awareness: Awareness;
  readonly doc: Y.Doc;
  readonly storageId: string;

  #canvasElements: Y.Map<Record<string, unknown>>;
  #canvasState: Y.Map<unknown>;
  #files: Y.Map<Y.Text>;
  #links: Y.Map<GroundLink>;
  #listeners = new Set<Listener>();
  #meta: Y.Map<string>;
  #persistence?: IndexeddbPersistence;
  #pinnedRuns: Y.Map<PinnedRun>;
  #runs: Y.Map<RunConfiguration>;
  #version = 0;

  private constructor(doc: Y.Doc, storageId: string) {
    this.doc = doc;
    this.storageId = storageId;
    this.awareness = new Awareness(doc);
    this.#meta = doc.getMap<string>("meta");
    this.#files = doc.getMap<Y.Text>("files");
    this.#canvasElements = doc.getMap<Record<string, unknown>>("canvas-elements");
    this.#canvasState = doc.getMap<unknown>("canvas-state");
    this.#links = doc.getMap<GroundLink>("links");
    this.#runs = doc.getMap<RunConfiguration>("runs");
    this.#pinnedRuns = doc.getMap<PinnedRun>("pinned-runs");
    doc.on("update", this.#onUpdate);
  }

  static memory(seed?: GroundWorkspace): WorkspaceDocument {
    const model = new WorkspaceDocument(new Y.Doc(), seed?.workspaceId ?? crypto.randomUUID());
    if (seed) model.replace(seed);
    else model.initializeBlank();
    return model;
  }

  static emptyMemory(storageId = crypto.randomUUID()): WorkspaceDocument {
    return new WorkspaceDocument(new Y.Doc(), storageId);
  }

  static async openLocal(
    storageId: string,
    options: { initialize?: boolean; seed?: GroundWorkspace } = {},
  ): Promise<WorkspaceDocument> {
    const model = new WorkspaceDocument(new Y.Doc(), storageId);
    const persistence = new IndexeddbPersistence(`${LOCAL_STORAGE_PREFIX}:${storageId}`, model.doc);
    model.#persistence = persistence;
    await persistence.whenSynced;
    if (options.seed) model.replace(options.seed);
    else if (options.initialize !== false && !model.#meta.has("workspaceId")) model.initializeBlank();
    return model;
  }

  get version(): number {
    return this.#version;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot(): GroundWorkspace {
    const workspaceId = this.#meta.get("workspaceId") ?? this.storageId;
    const files = [...this.#files.entries()]
      .map(([path, text]) => ({ path, content: text.toString() }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const elements = [...this.#canvasElements.values()]
      .filter(isCanvasElement)
      .sort(compareCanvasElements);
    const appState = this.#canvasState.get("appState");
    return {
      workspaceId,
      name: this.#meta.get("name") ?? "Untitled ground",
      canvas: {
        elements,
        appState: isRecord(appState) ? appState : { viewBackgroundColor: "#f4efe5" },
      },
      files,
      links: [...this.#links.values()],
      runs: {
        configurations: [...this.#runs.values()],
        pinnedResults: [...this.#pinnedRuns.values()],
      },
    };
  }

  getFileText(path: string): Y.Text {
    const normalized = normalizeProjectPath(path);
    const text = this.#files.get(normalized);
    if (!text) throw new Error(`File does not exist: ${normalized}`);
    return text;
  }

  addFile(path: string, content = ""): void {
    const normalized = normalizeProjectPath(path);
    if (this.#files.has(normalized)) throw new Error(`File already exists: ${normalized}`);
    this.doc.transact(() => this.#files.set(normalized, new Y.Text(content)), "file-add");
  }

  deleteFile(path: string): void {
    const normalized = normalizeProjectPath(path);
    if (!this.#files.has(normalized)) return;
    this.doc.transact(() => {
      this.#files.delete(normalized);
      const removedRuns = new Set<string>();
      for (const [id, configuration] of this.#runs) {
        if (configuration.entrypoint === normalized) {
          this.#runs.delete(id);
          removedRuns.add(id);
        }
      }
      for (const [id, result] of this.#pinnedRuns) {
        if (removedRuns.has(result.configurationId)) this.#pinnedRuns.delete(id);
      }
      for (const [id, link] of this.#links) {
        if (
          (link.target.kind === "code" && link.target.path === normalized) ||
          (link.target.kind === "run" && removedRuns.has(link.target.runConfigurationId))
        ) {
          this.#links.delete(id);
        }
      }
    }, "file-delete");
  }

  setName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) return;
    this.#meta.set("name", trimmed);
  }

  setRunConfiguration(configuration: RunConfiguration): void {
    const path = normalizeProjectPath(configuration.entrypoint);
    if (!this.#files.has(path)) throw new Error(`Entrypoint does not exist: ${path}`);
    this.#runs.set(configuration.id, { ...configuration, entrypoint: path });
  }

  pinRun(result: PinnedRun): void {
    if (!this.#runs.has(result.configurationId)) throw new Error("Run configuration does not exist");
    this.#pinnedRuns.set(result.id, result);
  }

  setLink(link: GroundLink): void {
    if (!this.#canvasElements.has(link.elementId)) throw new Error("Canvas element does not exist");
    if (link.target.kind === "code" && !this.#files.has(normalizeProjectPath(link.target.path))) {
      throw new Error("Code target does not exist");
    }
    if (link.target.kind === "run" && !this.#runs.has(link.target.runConfigurationId)) {
      throw new Error("Run configuration does not exist");
    }
    this.doc.transact(() => {
      for (const [id, existing] of this.#links) {
        if (existing.elementId === link.elementId && id !== link.id) this.#links.delete(id);
      }
      this.#links.set(link.id, structuredClone(link));
      const element = this.#canvasElements.get(link.elementId);
      if (element) this.#canvasElements.set(link.elementId, withLink(element, link.id));
    }, "link-set");
  }

  removeLink(id: string): void {
    const link = this.#links.get(id);
    this.doc.transact(() => {
      this.#links.delete(id);
      if (!link) return;
      const element = this.#canvasElements.get(link.elementId);
      if (element) this.#canvasElements.set(link.elementId, withLink(element, null));
    }, "link-remove");
  }

  updateCanvas(elements: ReadonlyArray<Record<string, unknown>>, appState: Record<string, unknown>): void {
    this.doc.transact(() => {
      for (const element of elements) {
        if (!isCanvasElement(element)) continue;
        const previous = this.#canvasElements.get(element.id);
        if (
          previous &&
          previous.version === element.version &&
          previous.versionNonce === element.versionNonce
        ) {
          continue;
        }
        this.#canvasElements.set(element.id, structuredClone(element));
      }
      const nextState = selectCanvasState(appState);
      const previousState = this.#canvasState.get("appState");
      if (JSON.stringify(previousState) !== JSON.stringify(nextState)) {
        this.#canvasState.set("appState", nextState);
      }
    }, "canvas");
  }

  replace(workspace: GroundWorkspace): void {
    const valid = groundWorkspaceSchema.parse(workspace);
    this.doc.transact(() => {
      clear(this.#meta);
      clear(this.#files);
      clear(this.#canvasElements);
      clear(this.#canvasState);
      clear(this.#links);
      clear(this.#runs);
      clear(this.#pinnedRuns);
      this.#meta.set("workspaceId", valid.workspaceId);
      this.#meta.set("name", valid.name);
      valid.files.forEach((file) => this.#files.set(file.path, new Y.Text(file.content)));
      valid.canvas.elements.forEach((element) => {
        if (isCanvasElement(element)) this.#canvasElements.set(element.id, structuredClone(element));
      });
      this.#canvasState.set("appState", structuredClone(valid.canvas.appState ?? {}));
      valid.links.forEach((link) => this.#links.set(link.id, structuredClone(link)));
      valid.runs.configurations.forEach((run) => this.#runs.set(run.id, structuredClone(run)));
      valid.runs.pinnedResults.forEach((run) => this.#pinnedRuns.set(run.id, structuredClone(run)));
    }, "workspace-replace");
  }

  initializeBlank(): void {
    if (this.#meta.has("workspaceId")) return;
    this.replace({
      workspaceId: this.storageId,
      name: "Untitled ground",
      canvas: { elements: [], appState: { viewBackgroundColor: "#f4efe5" } },
      files: [{ path: DEFAULT_FILE, content: DEFAULT_SOURCE }],
      links: [],
      runs: {
        configurations: [
          { id: "run-main", name: "Run main", runtimeId: "typescript", entrypoint: DEFAULT_FILE },
        ],
        pinnedResults: [],
      },
    });
  }

  async dispose(): Promise<void> {
    this.doc.off("update", this.#onUpdate);
    this.awareness.destroy();
    await this.#persistence?.destroy();
    this.doc.destroy();
  }

  #onUpdate = (): void => {
    this.#version += 1;
    this.#listeners.forEach((listener) => listener());
  };
}

export function newWorkspaceId(): string {
  return crypto.randomUUID();
}

function clear<T>(map: Y.Map<T>): void {
  for (const key of map.keys()) map.delete(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCanvasElement(value: unknown): value is CanvasElement {
  return isRecord(value) && typeof value.id === "string" && value.id.length > 0;
}

function compareCanvasElements(left: CanvasElement, right: CanvasElement): number {
  if (typeof left.index === "string" && typeof right.index === "string") return left.index.localeCompare(right.index);
  return left.id.localeCompare(right.id);
}

function selectCanvasState(appState: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["viewBackgroundColor", "gridSize", "gridStep", "gridModeEnabled", "objectsSnapModeEnabled"];
  return Object.fromEntries(allowed.flatMap((key) => (appState[key] === undefined ? [] : [[key, appState[key]]])));
}

function withLink(element: Record<string, unknown>, linkId: string | null): Record<string, unknown> {
  return {
    ...structuredClone(element),
    link: linkId ? `https://common-ground.local/link/${linkId}` : null,
    version: typeof element.version === "number" ? element.version + 1 : 1,
    versionNonce: crypto.getRandomValues(new Uint32Array(1))[0] ?? 1,
  };
}
