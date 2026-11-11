"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";

import { rerunRules, type AdsFormState } from "../actions";

const EMPTY: AdsFormState = {};

/** Judge the account now, rather than waiting for the nightly pass. */
export function RunRulesButton({
  teamSlug,
  brandId,
  label,
}: {
  teamSlug: string;
  brandId: string;
  label: string;
}) {
  const [state, run, running] = useActionState(rerunRules, EMPTY);

  return (
    <span className="flex items-center gap-1.5">
      <form action={run}>
        <input type="hidden" name="team" value={teamSlug} />
        <input type="hidden" name="brandId" value={brandId} />
        <Button
          type="submit"
          isDisabled={running}
          label={running ? "Judging…" : label}
          icon={<Icon icon={RefreshCw} className={running ? "animate-spin" : undefined} />}
          size="sm"
        />
      </form>
      {state.ok && <span className="text-[0.7rem] text-emerald-700">{state.ok}</span>}
      {state.error && <span className="text-[0.7rem] text-red-600">{state.error}</span>}
    </span>
  );
}
