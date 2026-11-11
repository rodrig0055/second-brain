"use client";

import {
  useActionState,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  ShoppingBag,
  Share2,
  Megaphone,
  LineChart,
  Mail,
  Camera,
  ChevronRight,
  Music2,
  Store,
} from "lucide-react";
import {
  connectCms,
  connectGa4,
  connectGoogleAds,
  connectMeta,
  connectMetaOrganic,
  connectSendpulse,
  connectShopify,
  deleteConnection,
  setConnectionStatus,
  syncNow,
  type FormState,
} from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@astryxdesign/core/Button";

// ── Types passed from the server page (plain, serializable) ────────────────
type ConnLike = {
  id: string;
  brandId: string;
  platform: string;
  status: string;
  lastSyncAt: Date | null;
  syncError: string | null;
};

type BrandLike = { id: string; name: string; domain: string };

type PlatformKey =
  | "shopify"
  | "meta"
  | "meta_organic"
  | "tiktok_organic"
  | "tiktok"
  | "google_ads"
  | "ga4"
  | "sendpulse"
  | "cms";

const PLATFORM_META: Record<
  PlatformKey,
  { label: string; icon: ComponentType<{ className?: string }>; tile: string }
> = {
  shopify: { label: "Shopify", icon: ShoppingBag, tile: "bg-green-50 text-green-600" },
  meta: { label: "Meta Ads", icon: Share2, tile: "bg-blue-50 text-blue-600" },
  meta_organic: {
    label: "Meta organic (Page + IG)",
    icon: Camera,
    tile: "bg-pink-50 text-pink-600",
  },
  tiktok_organic: {
    label: "TikTok account",
    icon: Music2,
    tile: "bg-zinc-100 text-zinc-900",
  },
  tiktok: { label: "TikTok Ads", icon: Music2, tile: "bg-cyan-50 text-cyan-700" },
  google_ads: { label: "Google Ads", icon: Megaphone, tile: "bg-amber-50 text-amber-600" },
  ga4: { label: "GA4", icon: LineChart, tile: "bg-orange-50 text-orange-600" },
  sendpulse: { label: "SendPulse", icon: Mail, tile: "bg-red-50 text-red-600" },
  cms: { label: "Storefront CMS", icon: Store, tile: "bg-violet-50 text-violet-600" },
};

/** Platforms read live from chat: nothing syncs, so there is no sync state to show. */
const LIVE_ONLY: PlatformKey[] = ["cms"];

// ── Root ───────────────────────────────────────────────────────────────────
export function BrandConnections({
  brands,
  connections,
  encReady,
}: {
  brands: BrandLike[];
  connections: ConnLike[];
  encReady: boolean;
}) {
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const brand = brands.find((b) => b.id === brandId);

  const connByKey = useMemo(
    () => new Map(connections.map((c) => [`${c.brandId}:${c.platform}`, c])),
    [connections],
  );

  // Which platforms to show for this brand. Shopify only for stores that use it.
  const platforms = useMemo<PlatformKey[]>(() => {
    const showShopify =
      (brand?.domain.includes("northwindaudio") ?? false) ||
      connByKey.has(`${brandId}:shopify`);
    return [
      ...(showShopify ? (["shopify"] as PlatformKey[]) : []),
      "meta",
      "meta_organic",
      "tiktok_organic",
      "tiktok",
      "google_ads",
      "ga4",
      "sendpulse",
      "cms",
    ];
  }, [brand, brandId, connByKey]);

  if (brands.length === 0) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-sm text-zinc-500">
        No brands yet, add one under Teams &amp; departments to connect platforms.
      </p>
    );
  }

  return (
    <div id="connections" className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-zinc-700">Brand</label>
        <div className="relative">
          <select
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            className="u-transition appearance-none rounded-lg border border-zinc-200 bg-white py-2 pl-3 pr-9 text-sm font-medium text-zinc-800 shadow-card outline-none hover:border-zinc-300 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-500/20"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <ChevronRight className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 rotate-90 text-zinc-400" />
        </div>
        {brand && (
          <span className="font-mono text-xs text-zinc-400">{brand.domain}</span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {platforms.map((p, i) => (
          <PlatformCard
            key={`${brandId}:${p}`}
            platform={p}
            brandId={brandId}
            conn={connByKey.get(`${brandId}:${p}`)}
            encReady={encReady}
            index={i}
          />
        ))}
      </div>
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
function PlatformCard({
  platform,
  brandId,
  conn,
  encReady,
  index,
}: {
  platform: PlatformKey;
  brandId: string;
  conn?: ConnLike;
  encReady: boolean;
  index: number;
}) {
  const meta = PLATFORM_META[platform];
  const Icon = meta.icon;
  // GA4 and SendPulse read via a shared account-wide credential, no per-brand
  // key to encrypt, so they don't depend on the encryption key being set.
  const disabled = platform === "ga4" || platform === "sendpulse" ? false : !encReady;

  const liveOnly = LIVE_ONLY.includes(platform);
  const state = !conn
    ? "Not connected"
    : conn.status === "connected"
      ? liveOnly
        ? "Connected"
        : conn.lastSyncAt
        ? `Synced ${new Date(conn.lastSyncAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`
        : "Awaiting first sync"
      : conn.status === "error"
        ? "Sync error"
        : "Disconnected";

  const connected = conn && conn.status !== "disconnected";

  return (
    <details
      className="group animate-enter u-transition flex flex-col rounded-xl border border-zinc-200 bg-white shadow-card open:border-zinc-300"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <summary className="flex cursor-pointer list-none flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${meta.tile}`}>
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-zinc-900">{meta.label}</p>
            <span className="mt-0.5 flex items-center gap-1.5">
              <StatusDot status={conn?.status} />
              <span
                className={`text-xs ${conn?.status === "error" ? "text-red-500" : "text-zinc-500"}`}
              >
                {state}
              </span>
            </span>
          </div>
        </div>
        <span
          className={`mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
            connected
              ? "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
              : "bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
          }`}
        >
          {connected ? "Manage" : <><span className="text-base leading-none">+</span> Connect</>}
        </span>
      </summary>

      <div className="space-y-3 border-t border-zinc-100 px-4 py-4">
        {connected && conn && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
            {!liveOnly && (
              <>
                <form action={syncNow}>
                  <input type="hidden" name="id" value={conn.id} />
                  <Button label="Sync now" variant="ghost" size="sm" type="submit" />
                </form>
                <span className="text-zinc-300">·</span>
              </>
            )}
            <form action={setConnectionStatus}>
              <input type="hidden" name="id" value={conn.id} />
              <input type="hidden" name="disconnect" value="true" />
              <ConfirmSubmitButton
                message={`Disconnect ${meta.label}? Data already synced will remain available.`}
                label="Disconnect"
              />
            </form>
            <span className="text-zinc-300">·</span>
            <form action={deleteConnection}>
              <input type="hidden" name="id" value={conn.id} />
              <ConfirmSubmitButton
                message={`Delete the ${meta.label} connection? This cannot be undone.`}
                label="Delete"
              />
            </form>
          </div>
        )}
        {conn?.syncError && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs leading-relaxed text-red-600">
            {conn.syncError.slice(0, 160)}
          </p>
        )}
        {disabled && (
          <p className="text-xs text-amber-600">
            Set the encryption key before connecting.
          </p>
        )}
        {platform === "shopify" && <ShopifyFormBody brandId={brandId} disabled={disabled} />}
        {platform === "meta" && <MetaFormBody brandId={brandId} disabled={disabled} />}
        {platform === "meta_organic" && (
          <MetaOrganicFormBody brandId={brandId} disabled={disabled} />
        )}
        {platform === "tiktok_organic" && (
          <TikTokConnectBody brandId={brandId} kind="account" disabled={disabled} reconnect={!!connected} />
        )}
        {platform === "tiktok" && (
          <TikTokConnectBody brandId={brandId} kind="ads" disabled={disabled} reconnect={!!connected} />
        )}
        {platform === "google_ads" && <GoogleAdsFormBody brandId={brandId} disabled={disabled} />}
        {platform === "ga4" && <GA4FormBody brandId={brandId} />}
        {platform === "sendpulse" && <SendPulseFormBody brandId={brandId} />}
        {platform === "cms" && <CmsFormBody brandId={brandId} disabled={disabled} />}
      </div>
    </details>
  );
}

function StatusDot({ status }: { status?: string }) {
  const tone =
    status === "connected"
      ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]"
      : status === "error"
        ? "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]"
        : status === "disconnected"
          ? "bg-zinc-400"
          : "bg-transparent ring-1 ring-inset ring-zinc-300";
  return <span className={`size-1.5 shrink-0 rounded-full ${tone}`} aria-hidden />;
}

// ── Form primitives ──────────────────────────────────────────────────────────
const fieldCls =
  "u-transition w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500/20";

function Field({
  label,
  name,
  type,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        className={`${fieldCls} font-normal`}
      />
    </label>
  );
}

function SubmitButton({ disabled, children }: { disabled: boolean; children: string }) {
  return (
    <Button
      label={children}
      variant="primary"
      size="sm"
      width="100%"
      type="submit"
      isDisabled={disabled}
    />
  );
}

function FormHint({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-zinc-500">{children}</p>;
}

const INITIAL: FormState = {};

/** Inline error / success banner driven by an action's returned FormState. */
function FormFeedback({ state, okText }: { state: FormState; okText: string }) {
  if (state.error) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs leading-relaxed text-red-600">
        {state.error}
      </p>
    );
  }
  if (state.ok) {
    return (
      <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
        {okText}
      </p>
    );
  }
  return null;
}

function ShopifyFormBody({ brandId, disabled }: { brandId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(connectShopify, INITIAL);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="brandId" value={brandId} />
      <FormHint>
        Custom app with Admin API read access. Paste the API key + secret; we mint
        tokens automatically. Shop is your <code className="text-zinc-700">*.myshopify.com</code> handle.
      </FormHint>
      <Field label="Shop domain" name="shop" required placeholder="brand.myshopify.com" />
      <Field label="API key (client ID)" name="clientId" required placeholder="f9bc56ad…" />
      <Field label="API secret key" name="clientSecret" type="password" required placeholder="shpss_…" />
      <SubmitButton disabled={disabled || pending}>
        {pending ? "Connecting…" : "Connect & sync"}
      </SubmitButton>
      <FormFeedback state={state} okText="Connected, syncing data now." />
    </form>
  );
}

function MetaFormBody({ brandId, disabled }: { brandId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(connectMeta, INITIAL);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="brandId" value={brandId} />
      <FormHint>
        Business Settings → Users → <strong className="font-medium text-zinc-700">System Users</strong>:
        generate a token with <code className="text-zinc-700">ads_read</code>.
      </FormHint>
      <Field label="Ad account id" name="adAccountId" required placeholder="act_1244310401" />
      <Field label="System user access token" name="accessToken" type="password" required placeholder="EAAB…" />
      <SubmitButton disabled={disabled || pending}>
        {pending ? "Connecting…" : "Connect & sync"}
      </SubmitButton>
      <FormFeedback state={state} okText="Connected, syncing data now." />
    </form>
  );
}

function MetaOrganicFormBody({
  brandId,
  disabled,
}: {
  brandId: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(connectMetaOrganic, INITIAL);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="brandId" value={brandId} />
      <FormHint>
        The same System User token, with{" "}
        <code className="text-zinc-700">pages_manage_posts</code> and{" "}
        <code className="text-zinc-700">instagram_content_publish</code>, plus the
        Page&apos;s numeric id. The Instagram account is read from the Page, so
        there is nothing to type for it. Drafts still need a human to approve
        them before anything posts.
      </FormHint>
      <Field label="Facebook Page id" name="pageId" required placeholder="119200955544023" />
      <Field
        label="System user access token"
        name="accessToken"
        type="password"
        required
        placeholder="EAAB…"
      />
      <SubmitButton disabled={disabled || pending}>
        {pending ? "Connecting…" : "Connect & sync"}
      </SubmitButton>
      <FormFeedback state={state} okText="Connected, syncing data now." />
    </form>
  );
}

function GA4FormBody({ brandId }: { brandId: string }) {
  const [state, action, pending] = useActionState(connectGa4, INITIAL);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="brandId" value={brandId} />
      <FormHint>
        Read-only via the shared service account, no keys to paste. Grant{" "}
        <code className="text-zinc-700">openclaw@…gserviceaccount.com</code> at
        least <strong className="font-medium text-zinc-700">Viewer</strong> on the
        GA4 property, then enter its numeric property id (Admin → Property Settings).
      </FormHint>
      <Field label="GA4 property id" name="propertyId" required placeholder="316035504" />
      <SubmitButton disabled={pending}>{pending ? "Connecting…" : "Connect"}</SubmitButton>
      <FormFeedback state={state} okText="Connected." />
    </form>
  );
}

function SendPulseFormBody({ brandId }: { brandId: string }) {
  const [state, action, pending] = useActionState(connectSendpulse, INITIAL);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="brandId" value={brandId} />
      <FormHint>
        Read-only via the shared account-wide API key, no keys to paste.
        Campaigns are matched to this brand by their sender-email domain. Leave
        blank to use the brand&apos;s own domain, or override it below.
      </FormHint>
      <Field label="Sender domain (optional)" name="senderDomain" placeholder="acmeflorals.example" />
      <SubmitButton disabled={pending}>{pending ? "Connecting…" : "Connect"}</SubmitButton>
      <FormFeedback state={state} okText="Connected." />
    </form>
  );
}

function CmsFormBody({ brandId, disabled }: { brandId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(connectCms, INITIAL);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="brandId" value={brandId} />
      <FormHint>
        The storefront&apos;s <code className="text-zinc-700">/mcp/cms</code> endpoint. Chats in teams
        with CMS access read products live; every change waits on an Apply card, and publishing
        needs an admin. Use a CMS account with the admin role or the cms permission. With an email
        and password the app logs in again by itself when the token expires.
      </FormHint>
      <Field label="Storefront URL" name="host" required placeholder="dev3.acmeflorals.example" />
      <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600">
        Storefront code
        <select name="tenant" required defaultValue="PH" className={`${fieldCls} font-normal`}>
          <option value="PH">PH</option>
          <option value="SG">SG</option>
          <option value="TH">TH</option>
          <option value="VN">VN</option>
        </select>
      </label>
      <Field label="CMS email" name="email" placeholder="admin@acmeflorals.example" />
      <Field label="CMS password" name="password" type="password" />
      <Field label="Or an API token" name="token" type="password" placeholder="Sanctum token" />
      <label className="flex items-center gap-2 text-xs font-medium text-zinc-600">
        <input type="checkbox" name="live" className="size-3.5 rounded border-zinc-300" />
        Live storefront (leave off for dev3 and other test environments)
      </label>
      <SubmitButton disabled={disabled || pending}>{pending ? "Checking…" : "Connect"}</SubmitButton>
      <FormFeedback state={state} okText="Connected." />
    </form>
  );
}

function GoogleAdsFormBody({ brandId, disabled }: { brandId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(connectGoogleAds, INITIAL);
  return (
    <form action={action} className="space-y-2.5">
      <input type="hidden" name="brandId" value={brandId} />
      <FormHint>
        Developer token (API Center, via a manager account), OAuth client id/secret,
        and a refresh token with the <code className="text-zinc-700">adwords</code> scope.
        Login customer id only if under an MCC.
      </FormHint>
      <Field label="Customer id" name="customerId" required placeholder="1244310401" />
      <Field label="Login customer id (optional)" name="loginCustomerId" placeholder="MCC id" />
      <Field label="Developer token" name="developerToken" type="password" required />
      <Field label="OAuth client id" name="clientId" required />
      <Field label="OAuth client secret" name="clientSecret" type="password" required />
      <Field label="Refresh token" name="refreshToken" type="password" required />
      <SubmitButton disabled={disabled || pending}>
        {pending ? "Connecting…" : "Connect & sync"}
      </SubmitButton>
      <FormFeedback state={state} okText="Connected, syncing data now." />
    </form>
  );
}

/**
 * TikTok connects by OAuth, not a pasted token: the button leaves for TikTok's
 * consent page and the callback route stores the grant. A plain link, because
 * the redirect has to be a top-level navigation.
 */
function TikTokConnectBody({
  brandId,
  kind,
  disabled,
  reconnect,
}: {
  brandId: string;
  kind: "account" | "ads";
  disabled: boolean;
  reconnect: boolean;
}) {
  const href = `/api/integrations/tiktok/connect?kind=${kind}&brandId=${encodeURIComponent(brandId)}`;
  return (
    <div className="space-y-2.5">
      <FormHint>
        {kind === "account"
          ? "Sign in as the brand's TikTok Business account and approve every permission. Posts and daily account stats sync each morning; TikTok reports counts 24-48h late."
          : "Sign in with the TikTok for Business user that manages the brand's ad accounts."}
      </FormHint>
      {/* A plain <a>, not Next Link: the OAuth route must not be prefetched. Disabled renders a disabled button. */}
      <Button
        href={href}
        as="a"
        label={reconnect ? "Reconnect with TikTok" : "Connect with TikTok"}
        variant="primary"
        size="sm"
        width="100%"
        isDisabled={disabled}
      />
    </div>
  );
}
