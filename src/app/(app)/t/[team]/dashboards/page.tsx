import Link from "next/link";
import { and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { getUserBrands, requireTeam } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { DashboardsSwitcher } from "@/components/dashboards-switcher";
import { NewsletterResults } from "@/components/newsletter/results-panel";
import { newsletterBrands } from "@/lib/newsletter/store";
import { NEWSLETTER_TEAM_SLUG } from "@/lib/newsletter/access";
import { isChannelWorkspace, workspaceHome } from "@/lib/workspaces";
import { redirect } from "next/navigation";

export default async function TeamDashboardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ nb?: string }>;
}) {
  const { team: teamSlug } = await params;
  const { nb } = await searchParams;
  const { user } = await requireTeam(teamSlug);

  // Channel workspaces carry their own surfaces; the generic dashboards tab is
  // not one of their tabs any more.
  if (isChannelWorkspace(teamSlug)) redirect(workspaceHome(teamSlug));

  // Advertising accounts on brands this user can access (Google Ads + Meta).
  const brands = await getUserBrands(user);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));

  const conns = brands.length
    ? await db.query.integrationConnections.findMany({
        where: and(
          inArray(integrationConnections.platform, [
            "google_ads",
            "meta",
            "shopify",
          ]),
          inArray(
            integrationConnections.brandId,
            brands.map((b) => b.id),
          ),
        ),
      })
    : [];

  const active = conns.filter((c) => c.status !== "disconnected");

  // Storefront brands = accessible brands NOT on Shopify (Northwind Audio). They
  // expose the custom-CMS sitemaps + product feeds we track.
  const shopifyBrandIds = new Set(
    conns.filter((c) => c.platform === "shopify").map((c) => c.brandId),
  );
  const storefrontBrands = brands
    .filter((b) => !shopifyBrandIds.has(b.id))
    .map((b) => ({ id: b.id, name: b.name, domain: b.domain }));

  const googleAccounts = active
    .filter((c) => c.platform === "google_ads")
    .map((c) => ({
      id: c.id,
      label: c.displayName || c.externalAccountId || "Google Ads account",
      brand: brandName.get(c.brandId) ?? "",
      customerId: c.externalAccountId ?? "",
      currency: String(c.config?.currency ?? "USD"),
      status: c.status,
    }));

  const metaAccounts = active
    .filter((c) => c.platform === "meta")
    .map((c) => ({
      id: c.id,
      label: c.displayName || c.externalAccountId || "Meta ad account",
      brand: brandName.get(c.brandId) ?? "",
      accountId: c.externalAccountId ?? "",
      currency: String(c.config?.currency ?? "USD"),
      status: c.status,
    }));

  // Newsletter results answer the same question as every other dashboard, so
  // they live here rather than in the campaign tab. Gated the same way the nav
  // pill is: this is the newsletter team's data.
  const showNewsletter = teamSlug === NEWSLETTER_TEAM_SLUG;
  const newsletter = showNewsletter ? (
    <NewsletterResults
      brands={(await newsletterBrands()).map((b) => ({ id: b.id, slug: b.slug, name: b.name }))}
      brandSlug={nb}
    />
  ) : null;

  const hasAny =
    googleAccounts.length > 0 ||
    metaAccounts.length > 0 ||
    storefrontBrands.length > 0 ||
    showNewsletter;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Dashboards"
        description="Monitor connected advertising accounts and act on performance signals."
      />

      {!hasAny ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-card">
          No Google Ads or Meta accounts connected on brands you can access. An
          admin can connect one in{" "}
          <Link
            href="/admin/integrations"
            className="underline underline-offset-2 hover:text-zinc-900"
          >
            Integrations
          </Link>
          .
        </div>
      ) : (
        <DashboardsSwitcher
          googleAccounts={googleAccounts}
          storefrontBrands={storefrontBrands}
          newsletter={newsletter}
        />
      )}
    </div>
  );
}
