import { describe, expect, it } from "vitest";

import {
  createParticipantSessionId,
  createRoomCredentials,
  EncryptedRoomCodec,
  formatRoomFragment,
  parseRoomFragment,
  RoomCryptoError,
} from "../src";

describe("encrypted room frames", () => {
  it("derives sender keys and authenticates metadata", async () => {
    const credentials = createRoomCredentials();
    const sender = new EncryptedRoomCodec(credentials.roomId, credentials.key, credentials.participantSessionId);
    const receiver = new EncryptedRoomCodec(credentials.roomId, credentials.key, createParticipantSessionId());
    const plaintext = new TextEncoder().encode("a yjs update");

    const frame = await sender.encrypt("document", plaintext);
    const decoded = await receiver.decrypt(frame);

    expect(decoded.kind).toBe("document");
    expect(decoded.senderId).toBe(credentials.participantSessionId);
    expect(decoded.counter).toBe(1n);
    expect(decoded.payload).toEqual(plaintext);
  });

  it("fails closed for a wrong key or modified ciphertext", async () => {
    const first = createRoomCredentials();
    const second = createRoomCredentials();
    const sender = new EncryptedRoomCodec(first.roomId, first.key);
    const wrongReceiver = new EncryptedRoomCodec(first.roomId, second.key);
    const frame = await sender.encrypt("awareness", new Uint8Array([1, 2, 3]));
    await expect(wrongReceiver.decrypt(frame)).rejects.toThrow(RoomCryptoError);

    const receiver = new EncryptedRoomCodec(first.roomId, first.key);
    const modified = frame.slice();
    modified[modified.length - 1] = (modified[modified.length - 1] ?? 0) ^ 1;
    await expect(receiver.decrypt(modified)).rejects.toThrow(RoomCryptoError);
  });

  it("rejects replayed counters", async () => {
    const credentials = createRoomCredentials();
    const sender = new EncryptedRoomCodec(credentials.roomId, credentials.key);
    const receiver = new EncryptedRoomCodec(credentials.roomId, credentials.key);
    const frame = await sender.encrypt("snapshot", new Uint8Array([4]));
    await receiver.decrypt(frame);
    await expect(receiver.decrypt(frame)).rejects.toThrow(/replayed or decreased/);
  });

  it("round-trips only 256-bit URL-fragment keys", () => {
    const credentials = createRoomCredentials();
    expect(parseRoomFragment(`#${formatRoomFragment(credentials.key)}`)).toEqual(credentials.key);
    expect(() => parseRoomFragment("#key=c2hvcnQ")).toThrow(/256 bits/);
  });
});
