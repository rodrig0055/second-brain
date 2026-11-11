import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { brands, integrationConnections, customLlmModels } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { encryptionConfigured } from "@/lib/crypto";
import { LLM_PROVIDERS, listProviderKeyStatus } from "@/lib/llm-keys";
import { PageHeader } from "@/components/page-header";
import { BrandConnections } from "./brand-connections";
import { CustomModelForm, LlmKeyForm } from "./key-forms";
import { connectTiktokAds, deleteCustomModel, deleteLlmKey } from "./actions";
import { cookies } from "next/headers";
import { PENDING_COOKIE, openPending } from "@/lib/integrations/tiktok_ads/connect";
import { RotationPanel } from "./rotation-panel";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@astryxdesign/core/Button";

export default async function AdminIntegrationsPage({
  searchParams,
}: {
  // Set by the TikTok OAuth callback, the one connect flow that leaves the page.
  searchParams: Promise<{ tiktok?: string; account?: string; reason?: string }>;
}) {
  await requireAdmin();
  const { tiktok, account, reason } = await searchParams;
  // An advertiser grant reaching several ad accounts waits here to be assigned.
  const pendingAds =
    tiktok === "pick" ? openPending((await cookies()).get(PENDING_COOKIE)?.value) : null;

  const [connections, allBrands, llmKeys, customModels] = await Promise.all([
    db.query.integrationConnections.findMany({
      orderBy: [desc(integrationConnections.createdAt)],
    }),
    db.query.brands.findMany({ orderBy: [asc(brands.name)] }),
    listProviderKeyStatus(),
    db.query.customLlmModels.findMany({
      orderBy: [asc(customLlmModels.label)],
    }),
  ]);

  const llmStatusByProvider = new Map(llmKeys.map((k) => [k.provider, k]));
  const encReady = encryptionConfigured();

  const connectedCount = connections.filter(
    (c) => c.status === "connected",
  ).length;

  const brandList = allBrands.map((b) => ({
    id: b.id,
    name: b.name,
    domain: b.domain,
  }));
  const connList = connections.map((c) => ({
    id: c.id,
    brandId: c.brandId,
    platform: c.platform,
    status: c.status,
    lastSyncAt: c.lastSyncAt,
    syncError: c.syncError,
  }));

  return (
    <div className="space-y-12">
      <PageHeader
        title="Connections"
        description="Connect each brand's external platforms so their data flows into the brain. Everything syncs with the morning tick, or on demand, powering the agent's answers and the Insights dashboard."
        action={
          <Button
            href="#connections"
            as="a"
            label="New Connection"
            variant="primary"
          />
        }
      />

      {tiktok === "pick" && (
        <section className="-mt-6 space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
          {pendingAds ? (
            <form action={connectTiktokAds} className="space-y-3">
              <p className="text-sm font-medium text-zinc-900">
                Which TikTok ad accounts belong to{" "}
                {allBrands.find((b) => b.id === pendingAds.brandId)?.name ?? "this brand"}?
              </p>
              <ul className="space-y-1.5">
                {pendingAds.advertisers.map((a) => (
                  <li key={a.advertiserId}>
                    <label className="flex items-center gap-2 text-sm text-zinc-700">
                      <input type="checkbox" name="advertiserId" value={a.advertiserId} />
                      <span className="font-medium">{a.name}</span>
                      <span className="font-mono text-xs text-zinc-400">
                        {a.advertiserId} · {a.currency} · {a.timezone}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button label="Connect selected" variant="primary" size="sm" type="submit" />
            </form>
          ) : (
            <p className="text-sm text-amber-700">The TikTok grant expired. Connect again.</p>
          )}
        </section>
      )}

      {tiktok && tiktok !== "pick" && (
        <p
          className={`-mt-6 rounded-lg border px-4 py-2.5 text-xs leading-relaxed ${
            tiktok === "connected" && !reason
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
          }`}
        >
          {tiktok === "connected"
            ? `TikTok connected${account ? `: ${account}` : ""}.${reason ? ` ${reason}` : ""}`
            : `TikTok connection failed. ${reason ?? ""}`}
        </p>
      )}

      {!encReady && (
        <p className="-mt-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-700">
          <span aria-hidden className="mt-0.5 text-amber-500">
            ⚠
          </span>
          <span>
            <code className="text-amber-800">INTEGRATIONS_ENC_KEY</code> is not
            set. Add a 32-byte base64 key to the environment before connecting.
            Credentials are encrypted at rest.
          </span>
        </p>
      )}

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400">
            Connections by brand
          </h3>
          <p className="shrink-0 text-right text-xs tabular-nums text-zinc-400">
            <span className="text-base font-medium text-zinc-800">
              {connectedCount}
            </span>
            <span className="text-zinc-300"> / {connections.length}</span>{" "}
            <span className="uppercase tracking-wider">live</span>
          </p>
        </div>
        <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-zinc-500">
          Each brand connects its own accounts. Credentials are encrypted at rest
          and connecting kicks off a backfill. The ad platforms are{" "}
          <span className="text-zinc-700">read-only</span>, the agent audits
          spend, campaigns, search terms and creative fatigue, but never edits a
          live account.
        </p>

        <div className="mt-5">
          <BrandConnections
            brands={brandList}
            connections={connList}
            encReady={encReady}
          />
        </div>
      </section>

      <div className="border-t border-zinc-200 pt-8">
        <h2 className="text-sm font-medium text-zinc-700">LLM API keys</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Bring your own keys for the model providers. A key saved here is
          encrypted at rest and overrides the matching environment variable for
          chat, task runs, and image generation. Leave a provider empty to keep
          using its env var.
        </p>

        <div className="mt-4 max-w-xl space-y-3">
          {LLM_PROVIDERS.map((p) => {
            const status = llmStatusByProvider.get(p.id);
            const hasDbKey = status?.hasDbKey ?? false;
            const hasEnvKey = status?.hasEnvKey ?? false;
            return (
              <div
                key={p.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-800">
                      {p.label}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {hasDbKey ? (
                        <>
                          Saved key ····{status?.hint}
                          {status?.updatedAt
                            ? ` · updated ${new Date(status.updatedAt).toLocaleDateString("en-PH")}`
                            : ""}
                        </>
                      ) : hasEnvKey ? (
                        <>
                          Using <code>{p.envVar}</code> from the environment
                        </>
                      ) : (
                        <span className="text-amber-600">
                          No key, set <code>{p.envVar}</code> or save one below
                        </span>
                      )}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-xs ${
                      hasDbKey || hasEnvKey
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-zinc-100 text-zinc-500"
                    }`}
                  >
                    {hasDbKey ? "custom" : hasEnvKey ? "env" : "none"}
                  </span>
                </div>

                <div className="mt-3 flex items-end gap-2">
                  <LlmKeyForm
                    provider={p.id}
                    placeholder={p.keyPlaceholder}
                    hasDbKey={hasDbKey}
                    encReady={encReady}
                  />
                  {hasDbKey && (
                    <form action={deleteLlmKey}>
                      <input type="hidden" name="provider" value={p.id} />
                      <ConfirmSubmitButton
                        message={`Remove the saved ${p.label} key? Requests will fall back to the environment key if configured.`}
                        label="Remove"
                      />
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 max-w-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-zinc-700">
                Custom models ({customModels.length})
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                Add any OpenAI-compatible endpoint (a self-host, a gateway,
                OpenRouter, Together, …). Each becomes selectable in task
                templates.
              </p>
            </div>
          </div>

          {customModels.length > 0 && (
            <div className="mt-4 space-y-2">
              {customModels.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-card"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-800">
                      {m.label}
                      <span className="text-zinc-500">, {m.modelName}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      <code>{m.slug}/{m.modelName}</code> · {m.baseUrl} · key
                      ····{m.hint}
                    </p>
                  </div>
                  <form action={deleteCustomModel}>
                    <input type="hidden" name="id" value={m.id} />
                    <ConfirmSubmitButton
                      message={`Remove “${m.label}”? It will no longer be available to tasks.`}
                      label="Remove"
                    />
                  </form>
                </div>
              ))}
            </div>
          )}

          <details className="group mt-4">
            <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-card hover:border-zinc-300 hover:bg-zinc-50">
              <span className="text-base leading-none">+</span>
              Add custom model
            </summary>
            <CustomModelForm encReady={encReady} />
          </details>

          <RotationPanel />
        </div>
      </div>
    </div>
  );
}
