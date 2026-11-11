import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands, teams, type knowledgeDocs } from "@/db/schema";
import { deleteDoc, saveDoc } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@astryxdesign/core/Button";

const KIND_LABELS: Record<string, string> = {
  "master-prompt": "Master prompt (global behavioral contract)",
  "brand-voice": "Brand voice",
  "offer-rules": "Offer rules",
  catalog: "Catalog notes",
  playbook: "Team playbook",
  winner: "Winner (proven example)",
  "image-guidelines": "Image guidelines (visual style for Image Studio)",
  lesson: "Lesson (AI-learned from chats)",
  "wiki-page": "Wiki page (AI-maintained digest)",
  "wiki-index": "Wiki index (AI-maintained, not injected)",
  skill: "Skill (loaded on demand via its trigger)",
  "brand-lens":
    "Brand lens (this brand's own rules — wins over generic guidance)",
};

export async function DocForm({
  doc,
}: {
  doc?: typeof knowledgeDocs.$inferSelect;
}) {
  const [allBrands, allTeams] = await Promise.all([
    db.query.brands.findMany({ orderBy: [asc(brands.name)] }),
    db.query.teams.findMany({ orderBy: [asc(teams.name)] }),
  ]);

  const inputCls =
    "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none";

  return (
    <form action={saveDoc} className="space-y-5">
      {doc && <input type="hidden" name="id" value={doc.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Brand
          <select
            name="brandId"
            defaultValue={doc?.brandId ?? ""}
            className={inputCls}
          >
            <option value="">Global (all brands)</option>
            {allBrands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Team
          <select
            name="teamId"
            defaultValue={doc?.teamId ?? ""}
            className={inputCls}
          >
            <option value="">Brand-wide (all teams)</option>
            {allTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Kind
          <select
            name="kind"
            defaultValue={doc?.kind ?? "brand-voice"}
            className={inputCls}
          >
            {Object.entries(KIND_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Title
        <input
          name="title"
          required
          defaultValue={doc?.title}
          placeholder="Brand Voice"
          className={inputCls}
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Slug
          <input
            name="slug"
            defaultValue={doc?.slug ?? ""}
            placeholder="brand-voice"
            className={inputCls}
          />
          <span className="text-[11px] text-zinc-400">
            Stable key for cross-links ([[slug]]); auto-generated from the title
            if left blank.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Tags
          <input
            name="tags"
            defaultValue={(doc?.tags ?? []).join(", ")}
            placeholder="voice, tone"
            className={inputCls}
          />
          <span className="text-[11px] text-zinc-400">
            Comma-separated labels for filtering.
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Trigger description (skills only)
        <input
          name="triggerDescription"
          defaultValue={doc?.triggerDescription ?? ""}
          placeholder="When the user wants to check or rewrite copy in the brand voice"
          className={inputCls}
        />
        <span className="text-[11px] text-zinc-400">
          For <span className="font-medium">skill</span> docs only: the “when to use this” text the
          agent matches a request against. Precise triggers fire when you want; vague ones misfire.
          The skill body is loaded on demand, not injected.
        </span>
      </label>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Content (markdown, injected into every chat/task for this scope)
        <textarea
          name="content"
          required
          rows={18}
          defaultValue={doc?.content}
          placeholder={"## Tone\nWe sound: warm, confident…\nWe never sound: salesy, generic…"}
          className={`${inputCls} font-mono text-xs leading-relaxed`}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={doc?.isActive ?? true}
        />
        Active (included in prompts)
      </label>

      <div className="flex items-center gap-3">
        <Button label="Save doc" variant="primary" type="submit" />
        {doc && (
          <ConfirmSubmitButton
            formAction={deleteDoc}
            message={`Delete “${doc.title}”? This cannot be undone.`}
            label="Delete"
          />
        )}
      </div>
    </form>
  );
}
