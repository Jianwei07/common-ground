"use client";

import { groundWorkspaceSchema, type GroundWorkspace } from "@common-ground/protocol";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { newWorkspaceId, WorkspaceDocument } from "./workspace";

const LAST_WORKSPACE_KEY = "common-ground:last-workspace";
const ROOM_SEED_PREFIX = "common-ground:room-seed:";

type WorkspaceState = {
  error: string | null;
  model: WorkspaceDocument | null;
};

export function useWorkspace(roomId?: string): {
  error: string | null;
  importWorkspace: (workspace: GroundWorkspace) => Promise<void>;
  model: WorkspaceDocument | null;
  snapshot: GroundWorkspace | null;
} {
  const [state, setState] = useState<WorkspaceState>({ error: null, model: null });

  useEffect(() => {
    let active = true;
    let opened: WorkspaceDocument | null = null;
    const open = async () => {
      try {
        const storageId = roomId ? `room-${roomId}` : localStorage.getItem(LAST_WORKSPACE_KEY) ?? newWorkspaceId();
        const seed = roomId ? readRoomSeed(roomId) : undefined;
        opened = await WorkspaceDocument.openLocal(storageId, { initialize: !roomId, ...(seed ? { seed } : {}) });
        if (!roomId) localStorage.setItem(LAST_WORKSPACE_KEY, opened.getSnapshot().workspaceId);
        if (active) setState({ error: null, model: opened });
        else await opened.dispose();
      } catch (error) {
        if (active) setState({ error: error instanceof Error ? error.message : "Workspace could not be opened", model: null });
      }
    };
    void open();
    return () => {
      active = false;
      if (opened) void opened.dispose();
    };
  }, [roomId]);

  const importWorkspace = useCallback(
    async (workspace: GroundWorkspace) => {
      const valid = groundWorkspaceSchema.parse(workspace);
      const next = await WorkspaceDocument.openLocal(valid.workspaceId, { seed: valid });
      const previous = state.model;
      localStorage.setItem(LAST_WORKSPACE_KEY, valid.workspaceId);
      setState({ error: null, model: next });
      await previous?.dispose();
    },
    [state.model],
  );

  const version = useSyncExternalStore(
    state.model?.subscribe ?? emptySubscribe,
    () => state.model?.version ?? 0,
    () => 0,
  );
  const snapshot = useMemo(() => state.model?.getSnapshot() ?? null, [state.model, version]);
  return { error: state.error, importWorkspace, model: state.model, snapshot };
}

export function storeRoomSeed(roomId: string, workspace: GroundWorkspace): void {
  sessionStorage.setItem(`${ROOM_SEED_PREFIX}${roomId}`, JSON.stringify(workspace));
}

function readRoomSeed(roomId: string): GroundWorkspace | undefined {
  const key = `${ROOM_SEED_PREFIX}${roomId}`;
  const value = sessionStorage.getItem(key);
  if (!value) return undefined;
  sessionStorage.removeItem(key);
  try {
    return groundWorkspaceSchema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function emptySubscribe(): () => void {
  return () => undefined;
}
