import { createRoomCredentials, EncryptedRoomCodec } from "@common-ground/protocol";
import { env } from "cloudflare:workers";
import { reset, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

import type { Env } from "../src";

const origin = "http://localhost:3000";
const sockets: WebSocket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.close(1000, "test complete"));
  await reset();
});

describe("encrypted room relay", () => {
  it("rejects unknown origins and plaintext HTTP", async () => {
    const room = createRoomCredentials();
    const denied = await SELF.fetch(`https://relay.test/rooms/${room.roomId}`, {
      headers: { Origin: "https://evil.example", Upgrade: "websocket" },
    });
    expect(denied.status).toBe(403);

    const plain = await SELF.fetch(`https://relay.test/rooms/${room.roomId}`, { headers: { Origin: origin } });
    expect(plain.status).toBe(426);
  });

  it("forwards opaque binary frames without echoing to the sender", async () => {
    const credentials = createRoomCredentials();
    const senderCodec = new EncryptedRoomCodec(credentials.roomId, credentials.key);
    const sender = await connect(credentials.roomId);
    const receiver = await connect(credentials.roomId);
    const plaintext = new TextEncoder().encode("private yjs update");
    const frame = await senderCodec.encrypt("document", plaintext);
    const received = nextMessage(receiver);
    sender.send(frame);

    const relayed = await received;
    expect(new Uint8Array(relayed)).toEqual(frame);
    expect(new TextDecoder().decode(relayed)).not.toContain("private yjs update");
  });

  it("stores one bounded ciphertext snapshot and removes it on expiry", async () => {
    const credentials = createRoomCredentials();
    const codec = new EncryptedRoomCodec(credentials.roomId, credentials.key);
    const socket = await connect(credentials.roomId);
    const frame = await codec.encrypt("snapshot", new Uint8Array([1, 2, 3, 4]));
    socket.send(frame);
    const namespace = (env as unknown as Env).ROOMS;
    const stub = namespace.getByName(credentials.roomId);

    await expect.poll(() => runInDurableObject(stub, async (_instance, state) => Boolean(await state.storage.get("snapshot")))).toBe(true);
    socket.close(1000, "idle");
    await expect.poll(() => runInDurableObject(stub, async (_instance, state) => Boolean(await state.storage.getAlarm()))).toBe(true);

    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put("expiresAt", Date.now() - 1);
      // Keep workerd from firing this automatically before the helper can.
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runInDurableObject(stub, async (_instance, state) => state.storage.get("snapshot"))).toBeUndefined();
  });

  it("refuses document writes from presentation clients", async () => {
    const credentials = createRoomCredentials();
    const codec = new EncryptedRoomCodec(credentials.roomId, credentials.key);
    const presenter = await connect(credentials.roomId, "present");
    const closed = new Promise<CloseEvent>((resolve) => presenter.addEventListener("close", resolve, { once: true }));
    presenter.send(await codec.encrypt("document", new Uint8Array([1])));
    expect((await closed).code).toBe(1008);
  });
});

async function connect(roomId: string, role = "editor"): Promise<WebSocket> {
  const response = await SELF.fetch(`https://relay.test/rooms/${roomId}?role=${role}`, {
    headers: { Origin: origin, Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("WebSocket upgrade did not return a socket");
  socket.accept();
  sockets.push(socket);
  return socket;
}

function nextMessage(socket: WebSocket): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) resolve(event.data);
      else if (event.data instanceof Blob) void event.data.arrayBuffer().then(resolve, reject);
      else reject(new Error("Relay returned a text frame"));
    }, { once: true });
  });
}
