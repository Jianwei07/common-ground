import { LoopbackRunner, MemoryRunner } from "../src/lib/runner";

const request = {
  requestId: "request-1",
  runtimeId: "typescript" as const,
  files: [{ path: "src/index.ts", content: "console.log('safe')" }],
  entrypoint: "src/index.ts",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runner client", () => {
  it("streams split NDJSON frames and verifies request IDs", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"requestId":"request-1","type":"status","status":"run'));
        controller.enqueue(encoder.encode('ning"}\n{"requestId":"request-1","type":"stdout","chunk":"ok\\n"}\n'));
        controller.enqueue(encoder.encode('{"requestId":"request-1","type":"exit","exitCode":0,"reason":"completed"}'));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));

    const events = [];
    for await (const event of new LoopbackRunner(() => "a".repeat(64)).run(request)) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["status", "stdout", "exit"]);
  });

  it("provides a dependency-free in-memory runner seam", async () => {
    const runner = new MemoryRunner([
      { requestId: "request-1", type: "exit", exitCode: 0, reason: "completed" },
    ]);
    const events = [];
    for await (const event of runner.run(request)) events.push(event);
    expect(events).toHaveLength(1);
  });
});
