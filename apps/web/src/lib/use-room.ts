"use client";

import { EncryptedRoomCodec, parseRoomFragment, type RoomFrameKind } from "@common-ground/protocol";
import { useEffect, useState } from "react";
import { applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";

import { WebSocketRoomTransport, type RoomTransport } from "./room-transport";
import type { WorkspaceDocument } from "./workspace";

const REMOTE_ORIGIN = Symbol("encrypted-room");
const MAX_SNAPSHOT_BYTES = 1.5 * 1024 * 1024;
const makeDefaultTransport = () => new WebSocketRoomTransport();

export type RoomState = {
  error: string | null;
  participants: number;
  status: "connecting" | "encrypted" | "local";
};

export function useRoom(
  roomId: string | undefined,
  model: WorkspaceDocument | null,
  makeTransport: () => RoomTransport = makeDefaultTransport,
): RoomState {
  const [state, setState] = useState<RoomState>({ error: null, participants: 1, status: roomId ? "connecting" : "local" });

  useEffect(() => {
    if (!roomId || !model) {
      setState({ error: null, participants: 1, status: "local" });
      return;
    }
    const controller = new AbortController();
    const transport = makeTransport();
    let closed = false;
    let outgoing = Promise.resolve();
    let incoming = Promise.resolve();
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;

    const fail = (error: unknown) => {
      if (!closed) setState((current) => ({ ...current, error: safeError(error) }));
    };

    try {
      const key = parseRoomFragment(location.hash);
      const codec = new EncryptedRoomCodec(roomId, key);
      model.awareness.setLocalStateField("user", {
        color: "#2457d6",
        name: `Guest ${codec.participantSessionId.slice(0, 4)}`,
      });

      const send = (kind: RoomFrameKind, payload: Uint8Array) => {
        outgoing = outgoing
          .then(async () => {
            if (!closed) transport.send(await codec.encrypt(kind, payload));
          })
          .catch(fail);
      };
      const onDocumentUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin !== REMOTE_ORIGIN) send("document", update);
      };
      const onAwarenessUpdate = (
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const participants = model.awareness.getStates().size;
        setState((current) => ({ ...current, participants }));
        if (origin !== REMOTE_ORIGIN) {
          send("awareness", encodeAwarenessUpdate(model.awareness, [...changes.added, ...changes.updated, ...changes.removed]));
        }
      };
      model.doc.on("update", onDocumentUpdate);
      model.awareness.on("update", onAwarenessUpdate);

      const unsubscribe = transport.subscribe((frame) => {
        incoming = incoming
          .then(async () => {
            const decoded = await codec.decrypt(frame);
            if (decoded.kind === "awareness") applyAwarenessUpdate(model.awareness, decoded.payload, REMOTE_ORIGIN);
            else Y.applyUpdate(model.doc, decoded.payload, REMOTE_ORIGIN);
          })
          .catch(fail);
      });

      void transport
        .connect(roomId, controller.signal)
        .then(() => {
          if (closed) return;
          setState((current) => ({ ...current, status: "encrypted" }));
          snapshotTimer = setTimeout(() => {
            const snapshot = Y.encodeStateAsUpdate(model.doc);
            if (snapshot.byteLength <= MAX_SNAPSHOT_BYTES) send("snapshot", snapshot);
            else fail(new Error("Encrypted room snapshot exceeds 1.5 MB; local editing is still available"));
          }, 200);
        })
        .catch(fail);

      return () => {
        closed = true;
        controller.abort();
        if (snapshotTimer) clearTimeout(snapshotTimer);
        unsubscribe();
        model.doc.off("update", onDocumentUpdate);
        model.awareness.off("update", onAwarenessUpdate);
        model.awareness.setLocalState(null);
        transport.close();
      };
    } catch (error) {
      fail(error);
      return () => {
        closed = true;
        transport.close();
      };
    }
  }, [makeTransport, model, roomId]);

  return state;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "Encrypted room failed closed";
}
