/**
 * Today, for any pass that reasons about a date window.
 *
 * A model has no clock. Given "the last 90 days" and no reference date it will
 * invent one, and the pull that follows returns an empty range that reads as a
 * genuine absence of data. That failure is silent and it is worse than an error,
 * because the empty result gets written into a verdict a human then trusts.
 *
 * buildSystemPrompt already does this for chat and task runs. Every background
 * pass that names a window needs it too.
 */
export function todayBlock(): string {
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    weekday: "long",
  }).format(now);
  return (
    `# Today\n${today} (${weekday}, Asia/Manila). Compute every date window from ` +
    `this. Never guess a date, and never use a year you were not given: a window ` +
    `in the wrong year returns no rows and looks exactly like missing data.`
  );
}
