import { ComposeSheet } from "./compose-sheet";
import { loadCompose } from "../../compose/load";

/**
 * Create post, opened from a Social page: the composer in a side panel over the
 * page you were on. Same URL as the full page, so it can be shared, and a
 * refresh lands on the full page rather than losing the work.
 */
export const maxDuration = 300;

export default async function ComposeSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team } = await params;
  const data = await loadCompose(team, await searchParams);
  if (!data) return null;
  return <ComposeSheet {...data} />;
}
