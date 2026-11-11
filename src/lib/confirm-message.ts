/** Splits a one-line confirmation into the AlertDialog title (first sentence) and description (the rest). */
export function splitMessage(message: string): { title: string; description: string } {
  // "Delete “X”? This cannot be undone." -> title "Delete “X”?", description "This cannot be undone."
  const m = message.trim().match(/^([\s\S]+?[?.!])\s+([\s\S]+)$/);
  if (!m) return { title: message.trim(), description: "" };
  return { title: m[1], description: m[2] };
}
