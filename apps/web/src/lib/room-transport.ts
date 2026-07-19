"use client";

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? "ws://127.0.0.1:8787";

export interface RoomTransport {
  connect(roomId: string, signal?: AbortSignal): Promise<void>;
  send(frame: Uint8Array): void;
  close(): void;
  subscribe(listener: (frame: Uint8Array) => void): () => void;
}

export class WebSocketRoomTransport implements RoomTransport {
  #listeners = new Set<(frame: Uint8Array) => void>();
  #pending: Uint8Array[] = [];
  #socket: WebSocket | null = null;

  async connect(roomId: string, signal?: AbortSignal): Promise<void> {
    if (this.#socket) throw new Error("Room transport is already connected");
    const base = new URL(RELAY_URL);
    if (base.protocol !== "ws:" && base.protocol !== "wss:") throw new Error("Relay URL must use WebSocket transport");
    base.pathname = `/rooms/${encodeURIComponent(roomId)}`;
    base.searchParams.set("role", "editor");
    const socket = new WebSocket(base);
    socket.binaryType = "arraybuffer";
    this.#socket = socket;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        socket.close(1000, "cancelled");
        reject(signal?.reason instanceof Error ? signal.reason : new Error("Room connection cancelled"));
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", abort);
        socket.removeEventListener("open", open);
        socket.removeEventListener("error", error);
      };
      const open = () => {
        cleanup();
        this.#pending.splice(0).forEach((frame) => socket.send(new Uint8Array(frame)));
        resolve();
      };
      const error = () => {
        cleanup();
        reject(new Error("Encrypted room could not connect"));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      socket.addEventListener("open", open, { once: true });
      socket.addEventListener("error", error, { once: true });
    });
    socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = new Uint8Array(event.data);
        this.#listeners.forEach((listener) => listener(frame));
      }
    });
  }

  send(frame: Uint8Array): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(new Uint8Array(frame));
    else if (!this.#socket || this.#socket.readyState === WebSocket.CONNECTING) this.#pending.push(frame.slice());
    else throw new Error("Encrypted room is not connected");
  }

  close(): void {
    this.#pending = [];
    this.#socket?.close(1000, "leaving");
    this.#socket = null;
  }

  subscribe(listener: (frame: Uint8Array) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export class MemoryRoomTransport implements RoomTransport {
  peer?: MemoryRoomTransport;
  #listeners = new Set<(frame: Uint8Array) => void>();

  async connect(): Promise<void> {}

  send(frame: Uint8Array): void {
    const peer = this.peer;
    if (peer) peer.#receive(frame.slice());
  }

  close(): void {}

  subscribe(listener: (frame: Uint8Array) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #receive(frame: Uint8Array): void {
    this.#listeners.forEach((listener) => listener(frame));
  }
}
