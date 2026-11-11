/**
 * Splitting task output into the part the operator acts on and the reference
 * sections that fold away. Kept free of React and streamdown imports so it can
 * be unit-tested directly; <TaskOutput> is the renderer over it.
 */

// Anchored to line start, and the number is optional so a renumbered heading
// still matches. Anything else the model writes is left alone.
const SECTION_RE =
  /^##[ \t]*(?:\d+\.[ \t]*)?(Reference research|Fact trace|Composition brief)[ \t]*$/gim;

export type Section = { title: string; body: string };

/**
 * `head` is everything before the first foldable heading — which is why the
 * operator reminder has to be emitted ABOVE these sections, not below: the last
 * section's body runs to the end of the output.
 */
export function splitSections(markdown: string): { head: string; sections: Section[] } {
  const matches = [...markdown.matchAll(SECTION_RE)];
  if (matches.length === 0) return { head: markdown, sections: [] };

  const first = matches[0].index ?? 0;
  const sections = matches.map((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end =
      i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
    return { title: match[1], body: markdown.slice(start, end).trim() };
  });

  return { head: markdown.slice(0, first).trimEnd(), sections };
}
