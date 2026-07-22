import { EncryptedRoomCodec, createRoomCredentials } from "@common-ground/protocol";
import * as Y from "yjs";

import { WorkspaceDocument } from "../src/lib/workspace";

const REMOTE = Symbol("test-room");

describe("WorkspaceDocument", () => {
  it("keeps canvas-to-code links valid when files are removed", async () => {
    const model = WorkspaceDocument.memory();
    expect(model.getFileText("main.py").toString()).toContain("Hello, Common Ground!");
    model.updateCanvas([{ id: "service-node", version: 1, versionNonce: 1 }], {});
    model.setLink({
      id: "service-link",
      elementId: "service-node",
      target: { kind: "code", path: "main.py", line: 1, symbol: "print" },
    });

    expect(model.getSnapshot().links).toHaveLength(1);
    model.deleteFile("main.py");
    expect(model.getSnapshot().links).toEqual([]);
    expect(model.getSnapshot().runs.configurations).toEqual([]);
    await model.dispose();
  });

  it("converges code and canvas updates after encrypted transport", async () => {
    const credentials = createRoomCredentials();
    const leftCodec = new EncryptedRoomCodec(credentials.roomId, credentials.key);
    const rightCodec = new EncryptedRoomCodec(credentials.roomId, credentials.key);
    const left = WorkspaceDocument.memory();
    const right = WorkspaceDocument.emptyMemory(left.storageId);
    Y.applyUpdate(right.doc, Y.encodeStateAsUpdate(left.doc), REMOTE);

    const codeUpdate = captureUpdate(left, () => left.getFileText("main.py").insert(0, "# shared\n"));
    await relay(codeUpdate, leftCodec, rightCodec, right);
    const canvasUpdate = captureUpdate(left, () => {
      left.updateCanvas([{ id: "api", version: 1, versionNonce: 2, type: "rectangle" }], {});
    });
    await relay(canvasUpdate, leftCodec, rightCodec, right);

    const returnUpdate = captureUpdate(right, () => right.getFileText("main.py").insert(0, "# peer\n"));
    await relay(returnUpdate, rightCodec, leftCodec, left);

    expect(right.getSnapshot()).toEqual(left.getSnapshot());
    expect(left.getSnapshot().files[0]?.content).toContain("# peer\n# shared");
    expect(left.getSnapshot().canvas.elements).toHaveLength(1);
    await Promise.all([left.dispose(), right.dispose()]);
  });

  it("starts new workspaces in Python", async () => {
    const model = WorkspaceDocument.memory();
    const snapshot = model.getSnapshot();

    expect(snapshot.files).toEqual([{ path: "main.py", content: 'print("Hello, Common Ground!")\n' }]);
    expect(snapshot.runs.configurations).toEqual([
      { id: "run-python", name: "Run Python", runtimeId: "python", entrypoint: "main.py" },
    ]);
    await model.dispose();
  });

  it("creates one remembered file and run configuration per language", async () => {
    const model = WorkspaceDocument.memory();
    model.getFileText("main.py").insert(0, "# keep me\n");

    const paths = (["javascript", "typescript", "go", "rust"] as const).map(
      (runtimeId) => model.ensureRunConfiguration(runtimeId).entrypoint,
    );
    const python = model.ensureRunConfiguration("python");

    expect(paths).toEqual(["main.js", "main.ts", "main.go", "main.rs"]);
    expect(python.entrypoint).toBe("main.py");
    expect(model.getFileText("main.py").toString()).toContain("# keep me");
    expect(model.getSnapshot().runs.configurations.filter((run) => run.runtimeId === "python")).toHaveLength(1);
    await model.dispose();
  });

  it("does not migrate an existing saved workspace", async () => {
    const model = WorkspaceDocument.memory({
      workspaceId: "saved-workspace",
      name: "Saved workspace",
      canvas: { elements: [], appState: {} },
      files: [{ path: "legacy.ts", content: "console.log('saved');\n" }],
      links: [],
      runs: { configurations: [{ id: "legacy-run", name: "Legacy", runtimeId: "typescript", entrypoint: "legacy.ts" }], pinnedResults: [] },
    });

    expect(model.getSnapshot().files).toEqual([{ path: "legacy.ts", content: "console.log('saved');\n" }]);
    expect(model.getSnapshot().runs.configurations[0]?.id).toBe("legacy-run");
    await model.dispose();
  });
});

function captureUpdate(model: WorkspaceDocument, change: () => void): Uint8Array {
  let captured: Uint8Array | undefined;
  const listener = (update: Uint8Array) => {
    captured = update;
  };
  model.doc.on("update", listener);
  change();
  model.doc.off("update", listener);
  if (!captured) throw new Error("Expected a Yjs update");
  return captured;
}

async function relay(
  update: Uint8Array,
  sender: EncryptedRoomCodec,
  receiver: EncryptedRoomCodec,
  target: WorkspaceDocument,
): Promise<void> {
  const frame = await sender.encrypt("document", update);
  const decoded = await receiver.decrypt(frame);
  Y.applyUpdate(target.doc, decoded.payload, REMOTE);
}
