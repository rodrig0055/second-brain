import { Suspense } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { requireSocialTeam } from "@/lib/social/access";
import { brandTone } from "@/lib/brand-tone";
import { PLATFORMS, type Platform } from "@/lib/social/platforms";
import { PlatformIcon } from "@/components/platform-icon";
import { QueryFilter } from "@/components/ui/filter-pill";
import { ToneTag } from "@/components/status-badge";

/**
 * Which accounts each brand posts to, and which it could.
 *
 * Every brand you can work is listed, connected or not, against every platform
 * the workspace knows. A connected account says who it is; a missing one says
 * what connecting it would give you and who can do it. Platforms the app
 * cannot publish to yet are shown as planned rather than hidden, so the map is
 * honest about where the gaps are.
 */
export default async function SocialConnectionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team: teamSlug } = await params;
  const sp = await searchParams;
  const wanted = typeof sp.brand === "string" ? sp.brand : "";
  const { user, brands, unconnected } = await requireSocialTeam(teamSlug);
  const isAdmin = user.role === "admin";

  const rows = [
    ...brands.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      status: b.connection?.status ?? "",
      instagram: b.connection?.igUsername ? `@${b.connection.igUsername}` : "",
      facebook: b.connection?.pageName ?? "",
    })),
    ...unconnected.map((b) => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      status: "",
      instagram: "",
      facebook: "",
    })),
  ];

  const shown = rows.filter((r) => !wanted || r.slug === wanted);

  const live = PLATFORMS.filter((p) => p.status === "live");
  const planned = PLATFORMS.filter((p) => p.status === "planned");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Suspense fallback={null}>
          <QueryFilter
            name="brand"
            allLabel={`All brands (${rows.length})`}
            options={rows.map((r) => ({
              value: r.slug,
              label: r.name,
              icon: (
                <span
                  className={`size-2 rounded-full ${brandTone(r.slug).dot}`}
                />
              ),
            }))}
          />
        </Suspense>
        <span className="text-xs text-zinc-400">
          {brands.length} of {rows.length} brands have an account connected
        </span>
      </div>
      <div className="grid gap-8">
        {shown.map((row) => {
          const connected = live.filter((p) => accountFor(row, p)).length;
          return (
            <section key={row.id}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${brandTone(row.slug).dot}`}
                  />
                  <h2 className="text-sm font-semibold text-zinc-900">
                    {row.name}
                  </h2>
                  <span className="text-xs text-zinc-400">
                    {connected} of {PLATFORMS.length} connected
                  </span>
                  {row.status === "error" && (
                    <ToneTag tone="danger" label="Needs reconnecting" />
                  )}
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {live.map((p) => (
                  <PlatformCard
                    key={p.key}
                    platform={p}
                    account={accountFor(row, p)}
                    error={row.status === "error"}
                    isAdmin={isAdmin}
                  />
                ))}
                {planned.map((p) => (
                  <PlatformCard
                    key={p.key}
                    platform={p}
                    account=""
                    isAdmin={isAdmin}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function accountFor(
  row: { instagram: string; facebook: string },
  p: Platform,
): string {
  if (p.key === "instagram") return row.instagram;
  if (p.key === "facebook") return row.facebook;
  return "";
}

function PlatformCard({
  platform: p,
  account,
  error = false,
  isAdmin,
}: {
  platform: Platform;
  account: string;
  error?: boolean;
  isAdmin: boolean;
}) {
  const connected = Boolean(account);
  const planned = p.status === "planned";

  return (
    <div
      className={`flex min-h-36 flex-col justify-between rounded-xl p-3.5 ${
        connected
          ? "border border-zinc-200 bg-white shadow-card"
          : "border border-dashed border-zinc-300 bg-white/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <PlatformIcon name={p.key} size="md" muted={!connected && planned} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900">
            {p.label}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.7rem] text-zinc-500">
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                connected
                  ? error
                    ? "bg-red-500"
                    : "bg-emerald-500"
                  : "bg-zinc-300"
              }`}
            />
            {connected ? account : planned ? "Planned" : "Not connected"}
          </p>
        </div>
      </div>

      {!connected && (
        <p className="mt-2 text-[0.7rem] leading-4 text-zinc-400">{p.blurb}</p>
      )}

      <div className="mt-3">
        {connected ? (
          isAdmin ? (
            // Server component: lucide elements, not <Icon icon={...}>, since a
            // component reference cannot cross into a client component.
            <Button
              label="Manage"
              size="sm"
              width="100%"
              endContent={<ArrowUpRight className="size-3" aria-hidden />}
              href="/admin/integrations"
            />
          ) : (
            <span className="block text-center text-[0.7rem] text-zinc-400">
              Managed by an admin
            </span>
          )
        ) : planned ? (
          <Button
            label="Connect"
            size="sm"
            width="100%"
            icon={<Plus className="size-full" aria-hidden />}
            isDisabled
          />
        ) : isAdmin ? (
          <Button
            label="Connect"
            size="sm"
            width="100%"
            icon={<Plus className="size-full" aria-hidden />}
            href="/admin/integrations"
          />
        ) : (
          <span className="block text-center text-[0.7rem] text-zinc-400">
            Ask an admin to connect
          </span>
        )}
      </div>
    </div>
  );
}
