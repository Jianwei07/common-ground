import {
  runEventSchema,
  runRequestSchema,
  type RunEvent,
  type RunRequest,
} from "@common-ground/protocol";

const RUNNER_URL = process.env.NEXT_PUBLIC_RUNNER_URL ?? "http://127.0.0.1:43117";
const TOKEN_KEY = "common-ground:runner-token";
const MAX_EVENT_LINE = 1_100_000;

export type RunnerHealth = {
  paired: boolean;
  status: "ready";
  version: string;
};

export interface Runner {
  health(signal?: AbortSignal): Promise<RunnerHealth>;
  run(request: RunRequest, signal?: AbortSignal): AsyncIterable<RunEvent>;
  cancel(requestId: string): Promise<void>;
}

export async function pairRunner(code: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${RUNNER_URL}/v1/pair`, {
    body: JSON.stringify({ code: code.trim() }),
    headers: { "content-type": "application/json" },
    method: "POST",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(await runnerError(response));
  const data: unknown = await response.json();
  if (!isRecord(data) || typeof data.token !== "string" || data.token.length < 32) {
    throw new Error("Runner returned an invalid pairing token");
  }
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}

export class LoopbackRunner implements Runner {
  #token: () => string | null;

  constructor(token = () => localStorage.getItem(TOKEN_KEY)) {
    this.#token = token;
  }

  async health(signal?: AbortSignal): Promise<RunnerHealth> {
    const response = await fetch(`${RUNNER_URL}/v1/health`, signal ? { signal } : {});
    if (!response.ok) throw new Error(await runnerError(response));
    const data: unknown = await response.json();
    if (
      !isRecord(data) ||
      data.status !== "ready" ||
      typeof data.version !== "string" ||
      typeof data.paired !== "boolean"
    ) {
      throw new Error("Runner returned an invalid health response");
    }
    return { paired: data.paired, status: "ready", version: data.version };
  }

  async *run(request: RunRequest, signal?: AbortSignal): AsyncIterable<RunEvent> {
    const valid = runRequestSchema.parse(request);
    const token = this.#token();
    if (!token) throw new Error("Pair the local runner before running code");
    const response = await fetch(`${RUNNER_URL}/v1/runs`, {
      body: JSON.stringify(valid),
      headers: {
        accept: "application/x-ndjson",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      method: "POST",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok || !response.body) throw new Error(await runnerError(response));

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > MAX_EVENT_LINE) throw new Error("Runner event exceeded the output limit");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const event = parseEvent(line, valid.requestId);
        yield event;
      }
      if (done) break;
    }
    if (pending.trim()) yield parseEvent(pending, valid.requestId);
  }

  async cancel(requestId: string): Promise<void> {
    const token = this.#token();
    if (!token) throw new Error("Pair the local runner before cancelling a run");
    const response = await fetch(`${RUNNER_URL}/v1/runs/${encodeURIComponent(requestId)}`, {
      headers: { authorization: `Bearer ${token}` },
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) throw new Error(await runnerError(response));
  }
}

export class MemoryRunner implements Runner {
  readonly events: RunEvent[];

  constructor(events: RunEvent[] = []) {
    this.events = events;
  }

  async health(): Promise<RunnerHealth> {
    return { paired: true, status: "ready", version: "memory" };
  }

  async *run(request: RunRequest): AsyncIterable<RunEvent> {
    runRequestSchema.parse(request);
    for (const event of this.events) yield runEventSchema.parse(event);
  }

  async cancel(): Promise<void> {}
}

export function hasRunnerToken(): boolean {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

function parseEvent(line: string, requestId: string): RunEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Runner returned malformed NDJSON");
  }
  const event = runEventSchema.parse(value);
  if (event.requestId !== requestId) throw new Error("Runner response request ID did not match");
  return event;
}

async function runnerError(response: Response): Promise<string> {
  try {
    const value: unknown = await response.json();
    if (isRecord(value) && typeof value.error === "string") return value.error;
  } catch {
    // Fall through to a metadata-only error.
  }
  return `Runner request failed (${response.status})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
