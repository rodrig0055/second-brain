import type { StreamdownProps } from "streamdown";
import { MarkdownOutput } from "@/components/markdown-output";
import { splitSections } from "@/lib/task-sections";

/**
 * Task output, with the reference sections some templates emit folded away.
 *
 * The Custom Song task ends with the sourced research behind its musical choices
 * and the internal composition brief. Both need to be inspectable — that is the
 * point of emitting them — but the operator's normal path is the Suno boxes
 * above them, so they open on demand.
 *
 * The folding lives here rather than in the model's text because MarkdownOutput
 * renders no raw HTML: a <details> the model emitted would come out as escaped
 * characters. Native <details> also needs no JS, so this adds no interactivity
 * cost. Output with none of these headings renders exactly as it did before.
 */
export function TaskOutput({
  children,
  controls,
}: {
  children: string;
  /** Forwarded to every block below — see <MarkdownOutput>. */
  controls?: StreamdownProps["controls"];
}) {
  const { head, sections } = splitSections(children);
  if (sections.length === 0)
    return <MarkdownOutput controls={controls}>{children}</MarkdownOutput>;

  return (
    <div className="space-y-3">
      <MarkdownOutput controls={controls}>{head}</MarkdownOutput>
      {sections.map((section) => (
        <details key={section.title} className="group rounded-lg border border-zinc-200 bg-white">
          <summary className="u-transition flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
            <span>{section.title}</span>
            <span className="text-xs font-normal text-zinc-500 group-open:hidden">Show</span>
          </summary>
          <div className="border-t border-zinc-200 p-4">
            <MarkdownOutput controls={controls}>{section.body}</MarkdownOutput>
          </div>
        </details>
      ))}
    </div>
  );
}
