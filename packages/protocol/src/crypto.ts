const VERSION = 1;
const SENDER_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_BYTES = 1 + 1 + SENDER_BYTES + 8;
const TAG_BYTES = 16;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();

export const roomFrameKinds = ["document", "awareness", "snapshot"] as const;
export type RoomFrameKind = (typeof roomFrameKinds)[number];

const kindToByte: Record<RoomFrameKind, number> = { document: 1, awareness: 2, snapshot: 3 };
const byteToKind = new Map<number, RoomFrameKind>([
  [1, "document"],
  [2, "awareness"],
  [3, "snapshot"],
]);

export class RoomCryptoError extends Error {
  override name = "RoomCryptoError";
}

export type RoomCredentials = {
  roomId: string;
  key: Uint8Array;
  participantSessionId: string;
};

export type DecryptedRoomFrame = {
  kind: RoomFrameKind;
  senderId: string;
  counter: bigint;
  payload: Uint8Array;
};

export function createRoomCredentials(): RoomCredentials {
  const key = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  return {
    roomId: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
    key,
    participantSessionId: toBase64Url(crypto.getRandomValues(new Uint8Array(SENDER_BYTES))),
  };
}

export function createParticipantSessionId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(SENDER_BYTES)));
}

export function formatRoomFragment(key: Uint8Array): string {
  if (key.byteLength !== KEY_BYTES) throw new RoomCryptoError("Room keys must contain 256 bits");
  return `key=${toBase64Url(key)}`;
}

export function parseRoomFragment(fragment: string): Uint8Array {
  const parameters = new URLSearchParams(fragment.replace(/^#/, ""));
  const encoded = parameters.get("key");
  if (!encoded) throw new RoomCryptoError("Room key is missing from the URL fragment");
  const key = fromBase64Url(encoded);
  if (key.byteLength !== KEY_BYTES) throw new RoomCryptoError("Room key must contain 256 bits");
  return key;
}

export class EncryptedRoomCodec {
  readonly participantSessionId: string;
  #counter = 0n;
  #decryptKeys = new Map<string, Promise<CryptoKey>>();
  #lastSeen = new Map<string, bigint>();
  #roomId: string;
  #roomKey: Uint8Array<ArrayBuffer>;
  #sender: Uint8Array<ArrayBuffer>;
  #sendKey: Promise<CryptoKey>;

  constructor(roomId: string, roomKey: Uint8Array, participantSessionId = createParticipantSessionId()) {
    validateRoomId(roomId);
    if (roomKey.byteLength !== KEY_BYTES) throw new RoomCryptoError("Room keys must contain 256 bits");
    const sender = fromBase64Url(participantSessionId);
    if (sender.byteLength !== SENDER_BYTES) throw new RoomCryptoError("Participant session IDs must contain 128 bits");
    this.#roomId = roomId;
    this.#roomKey = new Uint8Array(roomKey);
    this.#sender = new Uint8Array(sender);
    this.participantSessionId = participantSessionId;
    this.#sendKey = deriveSenderKey(this.#roomKey, this.#roomId, this.#sender);
  }

  async encrypt(kind: RoomFrameKind, payload: Uint8Array): Promise<Uint8Array> {
    if (payload.byteLength + HEADER_BYTES + TAG_BYTES > MAX_FRAME_BYTES) {
      throw new RoomCryptoError("Encrypted room frame exceeds 2 MB");
    }
    if (this.#counter === 0xffffffffffffffffn) throw new RoomCryptoError("Sender nonce counter is exhausted");
    this.#counter += 1n;
    const header = makeHeader(kind, this.#sender, this.#counter);
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: makeNonce(this.#sender, this.#counter),
        additionalData: makeAdditionalData(this.#roomId, header),
        tagLength: 128,
      },
      await this.#sendKey,
      new Uint8Array(payload),
    );
    return concat(header, new Uint8Array(encrypted));
  }

  async decrypt(frame: Uint8Array): Promise<DecryptedRoomFrame> {
    const metadata = inspectEncryptedRoomFrame(frame);
    const previous = this.#lastSeen.get(metadata.senderId) ?? 0n;
    if (metadata.counter <= previous) throw new RoomCryptoError("Room frame counter was replayed or decreased");
    const sender = fromBase64Url(metadata.senderId);
    let key = this.#decryptKeys.get(metadata.senderId);
    if (!key) {
      key = deriveSenderKey(this.#roomKey, this.#roomId, sender);
      this.#decryptKeys.set(metadata.senderId, key);
    }
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: makeNonce(sender, metadata.counter),
          additionalData: makeAdditionalData(this.#roomId, new Uint8Array(frame.subarray(0, HEADER_BYTES))),
          tagLength: 128,
        },
        await key,
        new Uint8Array(frame.subarray(HEADER_BYTES)),
      );
      this.#lastSeen.set(metadata.senderId, metadata.counter);
      return { ...metadata, payload: new Uint8Array(plaintext) };
    } catch (error) {
      if (error instanceof RoomCryptoError) throw error;
      throw new RoomCryptoError("Room frame authentication failed");
    }
  }
}

export function inspectEncryptedRoomFrame(
  frame: Uint8Array,
): Omit<DecryptedRoomFrame, "payload"> {
  if (frame.byteLength < HEADER_BYTES + TAG_BYTES || frame.byteLength > MAX_FRAME_BYTES) {
    throw new RoomCryptoError("Encrypted room frame has an invalid size");
  }
  if (frame[0] !== VERSION) throw new RoomCryptoError("Unsupported encrypted room frame version");
  const kindByte = frame[1];
  const kind = kindByte === undefined ? undefined : byteToKind.get(kindByte);
  if (!kind) throw new RoomCryptoError("Unsupported encrypted room frame kind");
  const sender = frame.slice(2, 2 + SENDER_BYTES);
  const counter = new DataView(frame.buffer, frame.byteOffset + 2 + SENDER_BYTES, 8).getBigUint64(0, false);
  if (counter === 0n) throw new RoomCryptoError("Room frame counter must be positive");
  return { kind, senderId: toBase64Url(sender), counter };
}

async function deriveSenderKey(
  roomKey: Uint8Array<ArrayBuffer>,
  roomId: string,
  sender: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", roomKey, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode(`common-ground:${roomId}`),
      info: concat(encoder.encode("room-sender-v1:"), sender),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function makeHeader(
  kind: RoomFrameKind,
  sender: Uint8Array<ArrayBuffer>,
  counter: bigint,
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(HEADER_BYTES);
  header[0] = VERSION;
  header[1] = kindToByte[kind];
  header.set(sender, 2);
  new DataView(header.buffer).setBigUint64(2 + SENDER_BYTES, counter, false);
  return header;
}

function makeNonce(sender: Uint8Array<ArrayBuffer>, counter: bigint): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(12);
  nonce.set(sender.subarray(0, 4), 0);
  new DataView(nonce.buffer).setBigUint64(4, counter, false);
  return nonce;
}

function makeAdditionalData(roomId: string, header: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return concat(encoder.encode(`common-ground-room-v1:${roomId}:`), header);
}

function validateRoomId(roomId: string): void {
  const decoded = fromBase64Url(roomId);
  if (decoded.byteLength !== 16 || roomId !== toBase64Url(decoded)) {
    throw new RoomCryptoError("Room IDs must be canonical 128-bit base64url values");
  }
}

function toBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new RoomCryptoError("Invalid base64url value");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    throw new RoomCryptoError("Invalid base64url value");
  }
}

function concat(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(values.reduce((length, value) => length + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}
