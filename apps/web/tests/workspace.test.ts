import { EncryptedRoomCodec, createRoomCredentials } from "@common-ground/protocol";
import * as Y from "yjs";

import { WorkspaceDocument } from "../src/lib/workspace";

const REMOTE = Symbol("test-room");

describe("WorkspaceDocument", () => {
  it("keeps canvas-to-code links valid when files are removed", async () => {
    const model = WorkspaceDocument.memory();
    expect(model.getFileText("src/index.ts").toString()).toContain("`${name}:${port}`");
    model.updateCanvas([{ id: "service-node", version: 1, versionNonce: 1 }], {});
    model.setLink({
      id: "service-link",
      elementId: "service-node",
      target: { kind: "code", path: "src/index.ts", line: 4, symbol: "services" },
    });

    expect(model.getSnapshot().links).toHaveLength(1);
    model.deleteFile("src/index.ts");
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

    const codeUpdate = captureUpdate(left, () => left.getFileText("src/index.ts").insert(0, "// shared\n"));
    await relay(codeUpdate, leftCodec, rightCodec, right);
    const canvasUpdate = captureUpdate(left, () => {
      left.updateCanvas([{ id: "api", version: 1, versionNonce: 2, type: "rectangle" }], {});
    });
    await relay(canvasUpdate, leftCodec, rightCodec, right);

    const returnUpdate = captureUpdate(right, () => right.getFileText("src/index.ts").insert(0, "// peer\n"));
    await relay(returnUpdate, rightCodec, leftCodec, left);

    expect(right.getSnapshot()).toEqual(left.getSnapshot());
    expect(left.getSnapshot().files[0]?.content).toContain("// peer\n// shared");
    expect(left.getSnapshot().canvas.elements).toHaveLength(1);
    await Promise.all([left.dispose(), right.dispose()]);
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
