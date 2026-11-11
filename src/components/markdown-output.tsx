"use client";

import { memo } from "react";
import { Streamdown, type StreamdownProps } from "streamdown";

/**
 * Shared renderer for LLM-generated markdown (task output, saved runs, chat
 * replies). Wraps streamdown, which memoizes completed blocks (no per-token
 * flicker while streaming) and renders incomplete markdown (a half-written
 * table / **bold / code fence) as valid formatting instead of literal syntax.
 *
 * Styling is done with an explicit `components` map (NOT @tailwindcss/typography)
 * so it matches the focused-workbench theme: zinc text, clear links,
 * bordered tables, and Geist. Keeping it here centralizes all
 * output styling in one place.
 */
const components: StreamdownProps["components"] = {
  h1: (p) => <h1 className="mt-5 mb-2 text-lg font-semibold tracking-tight text-zinc-900" {...p} />,
  h2: (p) => <h2 className="mt-4 mb-1.5 text-base font-semibold tracking-tight text-zinc-900" {...p} />,
  h3: (p) => <h3 className="mt-3 mb-1 text-sm font-semibold text-zinc-900" {...p} />,
  p: (p) => <p className="leading-relaxed" {...p} />,
  ul: (p) => <ul className="list-disc space-y-1 pl-5 marker:text-zinc-400" {...p} />,
  ol: (p) => <ol className="list-decimal space-y-1 pl-5" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  strong: (p) => <strong className="font-semibold text-zinc-900" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  a: ({ node: _node, ...p }) => {
    void _node;
    return (
      <a
        className="text-blue-600 underline underline-offset-2 hover:text-zinc-900"
        target="_blank"
        rel="noopener noreferrer"
        {...p}
      />
    );
  },
  blockquote: (p) => (
    <blockquote className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 italic text-zinc-600" {...p} />
  ),
  hr: (p) => <hr className="border-zinc-200" {...p} />,
  // (Code blocks + inline code use streamdown's built-in Shiki rendering.)
  // Tables, the priority case for the SendPulse reports.
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table
        className="min-w-full border-collapse text-sm [&_tbody_tr:nth-child(even)]:bg-zinc-50"
        {...p}
      />
    </div>
  ),
  th: (p) => (
    <th className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left font-semibold text-zinc-700" {...p} />
  ),
  td: (p) => <td className="border-b border-zinc-100 px-3 py-2 align-top text-zinc-700" {...p} />,
};

/**
 * Memoized on its (string) props. A chat re-renders on every streamed token, and without this
 * every earlier reply in the thread is re-parsed as markdown each time: a long conversation turned
 * typing and scrolling sluggish while an answer streamed. Only the reply still growing re-renders.
 */
export const MarkdownOutput = memo(function MarkdownOutput({
  children,
  className,
  controls,
}: {
  children: string;
  className?: string;
  /**
   * Streamdown draws its own copy and download buttons on every code fence. They are right almost
   * everywhere, and wrong on a lyric sheet the order has since replaced — a locked sheet with a copy
   * button on it is not locked. Passing `false` takes them off; leaving it out keeps them.
   */
  controls?: StreamdownProps["controls"];
}) {
  return (
    <Streamdown
      className={`text-sm leading-relaxed text-zinc-900 break-words space-y-3 ${className ?? ""}`}
      components={components}
      controls={controls}
    >
      {children}
    </Streamdown>
  );
});
