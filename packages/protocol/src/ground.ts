import { unzipSync, zipSync } from "fflate";

import {
  canvasDocumentSchema,
  groundLinkSchema,
  groundManifestV1Schema,
  groundRunsSchema,
  groundWorkspaceSchema,
  type GroundManifestV1,
  type GroundWorkspace,
} from "./schema";
import { normalizeProjectPath } from "./path";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const GROUND_LIMITS = {
  compressedBytes: 25 * 1024 * 1024,
  entries: 1_000,
  entryBytes: 10 * 1024 * 1024,
  uncompressedBytes: 25 * 1024 * 1024,
} as const;

export class GroundArchiveError extends Error {
  override name = "GroundArchiveError";
}

export function exportGround(workspace: GroundWorkspace): Uint8Array {
  const valid = groundWorkspaceSchema.parse(workspace);
  const manifest: GroundManifestV1 = {
    format: "common-ground",
    version: 1,
    workspaceId: valid.workspaceId,
    name: valid.name,
    canvas: "canvas.excalidraw",
    filesRoot: "workspace/",
    links: "links.json",
    runs: "runs.json",
  };
  const entries: Record<string, Uint8Array> = {
    "manifest.json": jsonBytes(manifest),
    "canvas.excalidraw": jsonBytes(valid.canvas),
    "links.json": jsonBytes(valid.links),
    "runs.json": jsonBytes(valid.runs),
  };
  for (const file of valid.files) {
    const path = normalizeProjectPath(file.path);
    const content = encoder.encode(file.content);
    if (content.byteLength > GROUND_LIMITS.entryBytes) {
      throw new GroundArchiveError(`Workspace file exceeds 10 MB: ${path}`);
    }
    entries[`workspace/${path}`] = content;
  }
  return zipSync(entries, { level: 6 });
}

export function importGround(archive: Uint8Array): GroundWorkspace {
  const indexed = inspectZip(archive);
  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(archive);
  } catch {
    throw new GroundArchiveError("Archive could not be decompressed");
  }
  if (Object.keys(unpacked).length !== indexed.size) {
    throw new GroundArchiveError("Archive index and extracted entries differ");
  }

  for (const [name, expectedSize] of indexed) {
    const entry = unpacked[name];
    if (!entry || entry.byteLength !== expectedSize) {
      throw new GroundArchiveError(`Archive entry size changed during extraction: ${name}`);
    }
  }

  const manifest = groundManifestV1Schema.parse(readJson(required(unpacked, "manifest.json"), "manifest.json"));
  const allowed = new Set([manifest.canvas, manifest.links, manifest.runs, "manifest.json"]);
  const files: Array<{ path: string; content: string }> = [];
  for (const [entryName, value] of Object.entries(unpacked)) {
    if (entryName.startsWith(manifest.filesRoot)) {
      const path = normalizeProjectPath(entryName.slice(manifest.filesRoot.length));
      files.push({ path, content: decode(value, entryName) });
      continue;
    }
    if (/^assets\/[a-f0-9]{64}$/.test(entryName)) {
      continue;
    }
    if (!allowed.has(entryName)) {
      throw new GroundArchiveError(`Unsupported archive entry: ${entryName}`);
    }
  }

  return groundWorkspaceSchema.parse({
    workspaceId: manifest.workspaceId,
    name: manifest.name,
    canvas: canvasDocumentSchema.parse(readJson(required(unpacked, manifest.canvas), manifest.canvas)),
    files,
    links: groundLinkSchema.array().parse(readJson(required(unpacked, manifest.links), manifest.links)),
    runs: groundRunsSchema.parse(readJson(required(unpacked, manifest.runs), manifest.runs)),
  });
}

function inspectZip(archive: Uint8Array): Map<string, number> {
  if (archive.byteLength > GROUND_LIMITS.compressedBytes) {
    throw new GroundArchiveError("Archive exceeds 25 MB");
  }
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
    throw new GroundArchiveError("Multi-disk ZIP archives are not supported");
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new GroundArchiveError("ZIP64 archives are not supported");
  }
  if (entryCount === 0 || entryCount > GROUND_LIMITS.entries) {
    throw new GroundArchiveError("Archive entry count is outside the supported range");
  }
  if (centralOffset + centralSize > eocd) {
    throw new GroundArchiveError("Invalid ZIP central directory bounds");
  }

  const entries = new Map<string, number>();
  const dataRanges: Array<[number, number]> = [];
  let total = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    requireBounds(view, offset, 46);
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new GroundArchiveError("Invalid ZIP central directory entry");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    requireBounds(view, offset + 46, nameLength + extraLength + commentLength);
    if ((flags & 1) !== 0) {
      throw new GroundArchiveError("Encrypted ZIP entries are not supported");
    }
    if (method !== 0 && method !== 8) {
      throw new GroundArchiveError("Unsupported ZIP compression method");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new GroundArchiveError("ZIP64 entries are not supported");
    }
    if (uncompressedSize > GROUND_LIMITS.entryBytes) {
      throw new GroundArchiveError("Archive entry exceeds 10 MB");
    }
    total += uncompressedSize;
    if (total > GROUND_LIMITS.uncompressedBytes) {
      throw new GroundArchiveError("Archive expands beyond 25 MB");
    }

    const rawName = new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength);
    const name = normalizeArchiveEntry(decode(rawName, "ZIP file name"));
    if (entries.has(name)) {
      throw new GroundArchiveError(`Duplicate normalized archive path: ${name}`);
    }
    entries.set(name, uncompressedSize);
    validateLocalEntry(view, localOffset, method, compressedSize, name, dataRanges);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) {
    throw new GroundArchiveError("ZIP central directory size does not match its entries");
  }
  dataRanges.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < dataRanges.length; index += 1) {
    const previous = dataRanges[index - 1];
    const current = dataRanges[index];
    if (previous && current && current[0] < previous[1]) {
      throw new GroundArchiveError("ZIP entries overlap");
    }
  }
  return entries;
}

function validateLocalEntry(
  view: DataView,
  offset: number,
  method: number,
  compressedSize: number,
  expectedName: string,
  ranges: Array<[number, number]>,
): void {
  requireBounds(view, offset, 30);
  if (view.getUint32(offset, true) !== 0x04034b50 || view.getUint16(offset + 8, true) !== method) {
    throw new GroundArchiveError("Invalid ZIP local entry");
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  requireBounds(view, offset + 30, nameLength + extraLength + compressedSize);
  const rawName = new Uint8Array(view.buffer, view.byteOffset + offset + 30, nameLength);
  if (normalizeArchiveEntry(decode(rawName, "ZIP local file name")) !== expectedName) {
    throw new GroundArchiveError("ZIP local and central names differ");
  }
  const start = offset + 30 + nameLength + extraLength;
  ranges.push([start, start + compressedSize]);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === view.byteLength) return offset;
    }
  }
  throw new GroundArchiveError("ZIP end record is missing");
}

function normalizeArchiveEntry(name: string): string {
  if (name.endsWith("/")) throw new GroundArchiveError("Directory entries are not supported");
  return normalizeProjectPath(name);
}

function requireBounds(view: DataView, offset: number, length: number): void {
  if (offset < 0 || length < 0 || offset + length > view.byteLength) {
    throw new GroundArchiveError("ZIP record is out of bounds");
  }
}

function required(entries: Record<string, Uint8Array>, name: string): Uint8Array {
  const value = entries[name];
  if (!value) throw new GroundArchiveError(`Required archive entry is missing: ${name}`);
  return value;
}

function readJson(value: Uint8Array, name: string): unknown {
  try {
    return JSON.parse(decode(value, name));
  } catch (error) {
    if (error instanceof GroundArchiveError) throw error;
    throw new GroundArchiveError(`Invalid JSON in ${name}`);
  }
}

function decode(value: Uint8Array, name: string): string {
  try {
    return decoder.decode(value);
  } catch {
    throw new GroundArchiveError(`Invalid UTF-8 in ${name}`);
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}
