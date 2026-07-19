import { inspectEncryptedRoomFrame } from "@common-ground/protocol";
import { DurableObject } from "cloudflare:workers";

const MAX_EDITORS = 10;
const MAX_PARTICIPANTS = 35;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_AWARENESS_BYTES = 256 * 1024;
const MAX_SNAPSHOT_BYTES = 1.5 * 1024 * 1024;
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1_000;
const SNAPSHOT_KEY = "snapshot";
const EXPIRES_KEY = "expiresAt";

export interface Env {
  ALLOWED_ORIGINS: string;
  ROOMS: DurableObjectNamespace<Room>;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ready" }, 200);
    }
    const match = /^\/rooms\/([A-Za-z0-9_-]{22})$/.exec(url.pathname);
    if (!match || request.method !== "GET") return json({ error: "not found" }, 404);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "websocket upgrade required" }, 426);
    }
    if (!allowedOrigin(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) {
      return json({ error: "origin is not allowed" }, 403);
    }
    const roomId = match[1];
    if (!roomId) return json({ error: "invalid room ID" }, 400);
    return env.ROOMS.getByName(roomId).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") ?? "editor";
    if (role !== "editor" && role !== "present") return json({ error: "invalid room role" }, 400);

    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= MAX_PARTICIPANTS) return json({ error: "room participant limit reached" }, 429);
    if (role === "editor" && this.ctx.getWebSockets("editor").length >= MAX_EDITORS) {
      return json({ error: "room editor limit reached" }, 429);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);
    await this.ctx.storage.deleteAlarm();

    const expiresAt = await this.ctx.storage.get<number>(EXPIRES_KEY);
    if (expiresAt && expiresAt <= Date.now()) {
      await this.ctx.storage.delete([SNAPSHOT_KEY, EXPIRES_KEY]);
    } else {
      const snapshot = await this.ctx.storage.get<ArrayBuffer>(SNAPSHOT_KEY);
      if (snapshot) server.send(snapshot);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string") {
      socket.close(1003, "binary frames required");
      return;
    }
    if (message.byteLength > MAX_FRAME_BYTES) {
      socket.close(1009, "frame too large");
      return;
    }

    let metadata: ReturnType<typeof inspectEncryptedRoomFrame>;
    try {
      metadata = inspectEncryptedRoomFrame(new Uint8Array(message));
    } catch {
      socket.close(1007, "invalid encrypted frame");
      return;
    }
    const presenter = this.ctx.getTags(socket).includes("present");
    if (presenter && metadata.kind !== "awareness") {
      socket.close(1008, "presenters may send awareness only");
      return;
    }
    if (metadata.kind === "awareness" && message.byteLength > MAX_AWARENESS_BYTES) {
      socket.close(1009, "awareness frame too large");
      return;
    }
    if (metadata.kind === "snapshot") {
      if (message.byteLength > MAX_SNAPSHOT_BYTES) {
        socket.close(1009, "snapshot too large");
        return;
      }
      await this.ctx.storage.put(SNAPSHOT_KEY, message.slice(0));
    }

    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(message);
    }
  }

  override async webSocketClose(): Promise<void> {
    if (this.openSockets() > 0) return;
    const snapshot = await this.ctx.storage.get<ArrayBuffer>(SNAPSHOT_KEY);
    if (!snapshot) return;
    const expiresAt = Date.now() + SNAPSHOT_TTL_MS;
    await this.ctx.storage.put(EXPIRES_KEY, expiresAt);
    await this.ctx.storage.setAlarm(expiresAt);
  }

  override webSocketError(socket: WebSocket): void {
    socket.close(1011, "room transport error");
  }

  override async alarm(): Promise<void> {
    if (this.openSockets() > 0) return;
    const expiresAt = await this.ctx.storage.get<number>(EXPIRES_KEY);
    if (expiresAt && expiresAt > Date.now()) {
      await this.ctx.storage.setAlarm(expiresAt);
      return;
    }
    await this.ctx.storage.delete([SNAPSHOT_KEY, EXPIRES_KEY]);
  }

  private openSockets(): number {
    return this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN).length;
  }
}

function allowedOrigin(origin: string | null, allowlist: string): boolean {
  if (!origin) return false;
  return allowlist.split(",").map((value) => value.trim().replace(/\/$/, "")).includes(origin.replace(/\/$/, ""));
}

function json(value: Record<string, string>, status: number): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
