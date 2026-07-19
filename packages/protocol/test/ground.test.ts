import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  exportGround,
  GroundArchiveError,
  importGround,
  type GroundWorkspace,
} from "../src";

function workspace(): GroundWorkspace {
  return {
    workspaceId: "workspace-1",
    name: "Payments sketch",
    canvas: { elements: [{ id: "box-1", type: "rectangle" }], appState: { viewBackgroundColor: "#f7f2e8" } },
    files: [
      { path: "src/index.ts", content: "console.log('ready')\n" },
      { path: "src/model.ts", content: "export type ID = string\n" },
    ],
    links: [{ id: "link-1", elementId: "box-1", target: { kind: "code", path: "src/index.ts", line: 1 } }],
    runs: {
      configurations: [{ id: "run-main", name: "Run main", runtimeId: "typescript", entrypoint: "src/index.ts" }],
      pinnedResults: [],
    },
  };
}

describe("Ground archives", () => {
  it("round-trips a complete workspace", () => {
    expect(importGround(exportGround(workspace()))).toEqual(workspace());
  });

  it.each(["../secret", "/absolute", "C:/windows", "src\\escape.ts", "src//empty.ts"])(
    "rejects unsafe project path %s",
    (path) => {
      const input = workspace();
      input.files[0] = { path, content: "nope" };
      expect(() => exportGround(input)).toThrow();
    },
  );

  it("rejects duplicate Unicode-normalized archive names before decompression", () => {
    const archive = zipSync({
      "manifest.json": strToU8("{}"),
      "workspace/cafe\u0301.ts": strToU8("one"),
      "workspace/caf\u00e9.ts": strToU8("two"),
    });
    expect(() => importGround(archive)).toThrow(GroundArchiveError);
  });

  it("rejects traversal entries before parsing the manifest", () => {
    const archive = zipSync({ "../manifest.json": strToU8("{}") });
    expect(() => importGround(archive)).toThrow(/traversal/i);
  });

  it("rejects declared decompression bombs during ZIP preflight", () => {
    const archive = zipSync({ "manifest.json": strToU8("{}") });
    const copy = archive.slice();
    const view = new DataView(copy.buffer);
    for (let offset = 0; offset <= copy.byteLength - 4; offset += 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        view.setUint32(offset + 24, 11 * 1024 * 1024, true);
        break;
      }
    }
    expect(() => importGround(copy)).toThrow(/exceeds 10 MB/);
  });

  it("rejects unknown artifact versions", () => {
    const valid = exportGround(workspace());
    const entries = zipSync({
      "manifest.json": strToU8(JSON.stringify({ format: "common-ground", version: 2 })),
    });
    expect(valid.byteLength).toBeGreaterThan(0);
    expect(() => importGround(entries)).toThrow();
  });
});
