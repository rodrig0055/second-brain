import { AlertTriangle, CheckCircle2, ShieldOff } from "lucide-react";
import type { ReviewResult } from "@/lib/review/review";

/**
 * The review receipt shown beside a task output.
 *
 * The point of a receipt is that its absence means something. A gated output
 * always carries one, so a person can tell "checked and clean" from "nobody
 * checked this" — which is exactly the distinction a silent pass destroys. So a
 * null review renders nothing at all here rather than an implied all-clear.
 */
export function ReviewReceipt({ review }: { review: ReviewResult | null }) {
  if (!review) return null;

  const j = review.judgment;
  const wrongFacts = (j?.factChecks ?? []).filter((f) => f.status === "wrong");
  const failed = Boolean(review.error);
  const flagged = review.verdict === "revise";

  const tone = failed
    ? {
        box: "border-zinc-300 bg-zinc-50",
        head: "text-zinc-700",
        Icon: ShieldOff,
        label: "Not reviewed",
      }
    : flagged
      ? {
          box: "border-amber-300 bg-amber-50",
          head: "text-amber-900",
          Icon: AlertTriangle,
          label: "Reviewed, issues remain",
        }
      : {
          box: "border-emerald-200 bg-emerald-50",
          head: "text-emerald-900",
          Icon: CheckCircle2,
          label: "Reviewed, clean",
        };
  const { Icon } = tone;

  return (
    <div className={`mt-6 rounded-xl border p-4 text-sm ${tone.box}`}>
      <div className={`flex items-center gap-2 font-medium ${tone.head}`}>
        <Icon className="size-4 shrink-0" />
        {tone.label}
        <span className="ml-auto text-xs font-normal opacity-70">
          {review.model} · {review.rounds} round{review.rounds === 1 ? "" : "s"} ·{" "}
          {review.lint.errorCount} error
          {review.lint.errorCount === 1 ? "" : "s"} / {review.lint.warnCount} warning
          {review.lint.warnCount === 1 ? "" : "s"}
        </span>
      </div>

      {failed && (
        <p className="mt-2 text-zinc-700">
          The reviewer could not run ({review.error}). Treat this output as
          unchecked and read it yourself before using it.
        </p>
      )}

      {j?.summary && <p className="mt-2 text-zinc-700">{j.summary}</p>}

      {wrongFacts.length > 0 && (
        <Section title="Contradicted by the brand docs">
          {wrongFacts.map((f, i) => (
            <li key={i}>
              <span className="font-medium">&ldquo;{f.fact}&rdquo;</span> {f.note}
            </li>
          ))}
        </Section>
      )}

      {(j?.findings.length ?? 0) > 0 && (
        <Section title="Still outstanding">
          {j!.findings.map((f, i) => (
            <li key={i}>
              <span className="font-medium">{f.rule}:</span> &ldquo;{f.quote}&rdquo;{" "}
              {f.why}
              {f.fix && (
                <span className="block text-zinc-600">Suggested: {f.fix}</span>
              )}
            </li>
          ))}
        </Section>
      )}

      {(j?.unlabelledVoiceLines.length ?? 0) > 0 && (
        <Section title="Customer-voice lines with no traced source">
          <li className="list-none pl-0 text-zinc-600">
            Do not publish these as real testimonials without sourcing them.
          </li>
          {j!.unlabelledVoiceLines.map((l, i) => (
            <li key={i}>&ldquo;{l}&rdquo;</li>
          ))}
        </Section>
      )}

      {(j?.keptFlags.length ?? 0) > 0 && (
        <Section title="Flags kept deliberately">
          {j!.keptFlags.map((k, i) => (
            <li key={i}>
              &ldquo;{k.quote}&rdquo; {k.why}
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium uppercase tracking-wider opacity-70">
        {title}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-5">{children}</ul>
    </div>
  );
}
