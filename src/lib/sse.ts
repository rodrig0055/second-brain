// Minimal server-side Server-Sent Events helper. Used where we stream discrete
// JSON progress events (not a model text stream) — e.g. the image-generation
// fan-out, where each job resolves independently and we want to push results as
// they land instead of waiting for the slowest.

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/**
 * Creates a ReadableStream plus `send`/`close` helpers that encode objects as
 * SSE frames (`data: <json>\n\n`). Return `stream` from a Response with
 * `SSE_HEADERS`; call `send` as events occur and `close` when done.
 */
export function createSseStream<T = unknown>() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;

  // start() runs synchronously during construction, so `controller` is set
  // before this function returns.
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  function send(event: T): void {
    if (closed) return;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  function close(): void {
    if (closed) return;
    closed = true;
    controller.close();
  }

  return { stream, send, close };
}
