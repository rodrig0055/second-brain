import { redirect } from "next/navigation";

/**
 * Results moved into the Dashboards tab, where the rest of the "is this
 * working" reporting lives. Kept as a redirect rather than deleted, because the
 * team had this page bookmarked.
 */
export default async function ResultsRedirect({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team } = await params;
  redirect(`/t/${team}/dashboards`);
}
