"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { FileText, Paperclip, SendHorizontal, Square, X } from "lucide-react";
import { ActivityLine, pickActivity } from "@/components/tool-activity";
import { AssistantParts } from "@/components/genui/assistant-parts";
import { isImeEnter } from "@/lib/keyboard";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB per file

// Images + PDFs are sent to the model as binary file parts (data URLs); every
// other type (CSV, JSON, text, code, …) is read as text and inlined into the
// message, which every model can read regardless of its file-type support.
type Attachment =
  | { kind: "image"; mediaType: string; filename: string; url: string }
  | { kind: "doc"; mediaType: string; filename: string; url: string }
  | { kind: "text"; filename: string; text: string };

function read(file: File, as: "dataURL" | "text"): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    if (as === "dataURL") r.readAsDataURL(file);
    else r.readAsText(file);
  });
}

async function toAttachment(file: File): Promise<Attachment | null> {
  if (file.size > MAX_FILE_BYTES) return null;
  if (file.type.startsWith("image/")) {
    return { kind: "image", mediaType: file.type, filename: file.name, url: await read(file, "dataURL") };
  }
  if (file.type === "application/pdf") {
    return { kind: "doc", mediaType: file.type, filename: file.name, url: await read(file, "dataURL") };
  }
  return { kind: "text", filename: file.name, text: await read(file, "text") };
}

export function ChatThread({
  conversationId,
  initialMessages,
  models,
  initialModel,
}: {
  conversationId: string;
  initialMessages: UIMessage[];
  models: { id: string; label: string }[];
  initialModel: string;
}) {
  const [input, setInput] = useState("");
  const [model, setModel] = useState(initialModel);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    const parts = (await Promise.all(arr.map(toAttachment))).filter(
      (a): a is Attachment => !!a,
    );
    setNotice(
      parts.length < arr.length
        ? `Some files skipped, max ${MAX_FILE_BYTES / 1024 / 1024}MB each.`
        : null,
    );
    setAttachments((a) => [...a, ...parts]);
  }

  const { messages, sendMessage, status, error, stop } = useChat({
    // Batch streamed tokens into one render per 50 ms instead of one per chunk, so the main
    // thread stays free for typing and scrolling while a reply streams in.
    experimental_throttle: 50,
    id: conversationId,
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { conversationId },
    }),
  });

  const busy = status === "submitted" || status === "streaming";

  // Only auto-scroll when the user is already near the bottom, so reading
  // back through history mid-stream doesn't yank them down.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // A picked choice or a submitted form continues the chat as the user.
  function reply(text: string) {
    if (busy || !text.trim()) return;
    sendMessage({ text }, { body: { model } });
  }

  function submit() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || busy) return;
    // Images + PDFs → binary file parts; text-based files → inlined as fenced
    // blocks so any model can read them.
    const fileParts = attachments
      .filter((a) => a.kind !== "text")
      .map((a) => {
        const f = a as Extract<Attachment, { kind: "image" | "doc" }>;
        return { type: "file" as const, mediaType: f.mediaType, filename: f.filename, url: f.url };
      });
    const textBlocks = attachments
      .filter((a): a is Extract<Attachment, { kind: "text" }> => a.kind === "text")
      .map((a) => `\n\nAttached file \`${a.filename}\`:\n\`\`\`\n${a.text}\n\`\`\``)
      .join("");
    setInput("");
    setAttachments([]);
    setNotice(null);
    sendMessage(
      { text: text + textBlocks, ...(fileParts.length ? { files: fileParts } : {}) },
      { body: { model } },
    );
  }

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {messages.length === 0 && (
            <div className="mx-auto max-w-md pt-20 text-center">
              <p className="text-sm font-medium text-zinc-700">Start with a clear outcome</p>
              <p className="mt-1 text-sm leading-6 text-zinc-500">
                Ask a question, draft campaign copy, or attach a file for analysis. Replies follow this brand&apos;s voice and rules.
              </p>
            </div>
          )}
          {messages.map((m, mi) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "animate-enter ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-zinc-100 px-4 py-2.5 text-sm text-zinc-900 shadow-card sm:max-w-[78%]"
                  : "animate-enter max-w-full py-2 text-sm leading-6 text-zinc-800"
              }
            >
              {m.role === "assistant" ? (
                <AssistantParts
                  message={m}
                  // Choices and forms are live only on the latest answer, and
                  // not while it is still streaming.
                  interactive={mi === messages.length - 1 && !busy}
                  answeredWith={
                    messages[mi + 1]?.role === "user"
                      ? messages[mi + 1].parts
                          .filter((p) => p.type === "text")
                          .map((p) => p.text)
                          .join("")
                      : undefined
                  }
                  onReply={reply}
                />
              ) : m.parts.map((part, i) =>
                part.type === "text" ? (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    {part.text}
                  </div>
                ) : part.type === "file" && part.mediaType?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={part.url}
                    alt={part.filename ?? "attachment"}
                    className="mt-1 max-h-64 rounded-lg border border-zinc-200"
                  />
                ) : part.type === "file" ? (
                  <div
                    key={i}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600"
                  >
                    <FileText className="size-3.5" /> {part.filename ?? "file"}
                  </div>
                ) : null,
              )}
            </div>
          ))}
          {status === "submitted" && (
            <p className="u-shimmer w-fit text-sm font-medium">Thinking…</p>
          )}
          {status === "streaming" &&
            (() => {
              const last = messages[messages.length - 1];
              const label =
                last?.role === "assistant" ? pickActivity(last.parts) : null;
              return label ? <ActivityLine label={label} /> : null;
            })()}
          {error && (
            <p className="text-sm text-red-400">
              Something went wrong: {error.message}
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3 sm:px-6 sm:py-4">
        <div className="mx-auto mb-2 flex max-w-3xl items-center gap-2">
          <label className="text-xs text-zinc-500">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="u-transition rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 focus:border-zinc-400 focus:outline-none"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {notice && (
          <p className="mx-auto mb-2 max-w-3xl text-xs text-amber-600">{notice}</p>
        )}
        {attachments.length > 0 && (
          <div className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative">
                {a.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.url}
                    alt={a.filename}
                    className="size-16 rounded-lg border border-zinc-200 object-cover"
                  />
                ) : (
                  <div className="flex h-16 max-w-40 items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3">
                    {a.kind === "doc" ? <FileText className="size-4" /> : <Paperclip className="size-4" />}
                    <span className="truncate text-xs text-zinc-600">
                      {a.filename}
                    </span>
                  </div>
                )}
                <IconButton
                  label="Remove attachment"
                  icon={<Icon icon={X} />}
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    setAttachments((arr) => arr.filter((_, j) => j !== i))
                  }
                  className="absolute -right-1.5 -top-1.5"
                />
              </div>
            ))}
          </div>
        )}
        <form
          className="mx-auto flex max-w-3xl items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <IconButton
            label="Attach files"
            tooltip="Attach files"
            icon={<Icon icon={Paperclip} />}
            size="lg"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0"
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.items)
                .filter((it) => it.kind === "file")
                .map((it) => it.getAsFile())
                .filter((f): f is File => !!f);
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (isImeEnter(e)) return;
                submit();
              }
            }}
            rows={2}
            placeholder="Message Second Brain"
            className="u-transition field-sizing-content max-h-[calc(10lh+1.5rem+2px)] min-h-[calc(2lh+1.5rem+2px)] flex-1 resize-none rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
          />
          {busy ? (
            <Button
              label="Stop generating"
              tooltip="Stop generating"
              variant="primary"
              size="lg"
              onClick={() => stop()}
              endContent={<Icon icon={Square} size="sm" className="fill-current" />}
            >
              Stop
            </Button>
          ) : (
            <Button
              label="Send"
              type="submit"
              variant="primary"
              size="lg"
              isDisabled={!input.trim() && attachments.length === 0}
              endContent={<Icon icon={SendHorizontal} size="sm" />}
            />
          )}
        </form>
      </div>
    </>
  );
}
