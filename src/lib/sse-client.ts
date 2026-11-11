// Client-side reader for the SSE frames produced by `createSseStream` (see
// src/lib/sse.ts). Reads the response body with getReader()/TextDecoder, splits
// on the `\n\n` frame boundary, parses each `data:` line as JSON, and hands the
// parsed event to `onEvent`. Deliberately dependency-free so client components
// can import it without pulling anything server-only.

/**
 * Adapts an SSE byte stream into a ReadableStream of parsed JSON events. Handy
 * for feeding the AI SDK's `readUIMessageStream`, which expects a stream of
 * already-parsed `UIMessageChunk` objects rather than raw SSE bytes.
 */
export function sseToStream<T = unknown>(
  body: ReadableStream<Uint8Array>,
): ReadableStream<T> {
  return new ReadableStream<T>({
    async start(controller) {
      try {
        await readSse<T>(body, (event) => controller.enqueue(event));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export async function readSse<T = unknown>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        const trimmed = line.trimStart();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        try {
          onEvent(JSON.parse(data) as T);
        } catch {
          // ignore malformed frame
        }
      }
    }
  }
}
