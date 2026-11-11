/**
 * What can this Meta token actually see, and is it enough to publish an ad?
 *
 * A system user token is valid the moment it is generated, and stays valid
 * whether or not anything was assigned to it — so "the token works" and "the
 * token can run ads for this brand" are different claims, and the gap between
 * them only shows up at the point of publishing. This asks Meta directly and
 * prints the ad account, Page and Instagram ids that ad creation needs.
 *
 *   set -a && . ./.env.local && set +a && npx tsx scripts/check-meta-assets.ts
 *
 * Reads ACCESS_TOKEN (and AD_ACCOUNT_ID, if you want one account singled out).
 * Read-only: every call is a GET, and nothing is written to the database.
 *
 * Three things have to line up before an ad can be created, and each fails in
 * its own way:
 *   ad account   assigned with a managing task, or writes are refused
 *   Page         assigned, and the source of object_story_spec.page_id
 *   Instagram    assigned, and the source of object_story_spec.instagram_user_id
 *
 * instagram_user_id is the current field name. instagram_actor_id has not been
 * supported since v22.0, so anything still passing it is writing to a field
 * Meta stopped reading.
 */
import { DEFAULT_API_VERSION } from "../src/lib/integrations/meta/client";

const GRAPH = "https://graph.facebook.com";

/** Scopes ad creation needs, beyond simply reading insights. */
const WRITE_SCOPES = [
  "ads_management",
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_ads",
  "business_management",
];

/** Tasks on an ad account that permit writing, as opposed to only viewing. */
const MANAGING_TASKS = ["MANAGE", "ADVERTISE"];

type Json = Record<string, unknown>;

async function graph(path: string, params: Record<string, string>, token: string) {
  const search = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${DEFAULT_API_VERSION}/${path}?${search}`);
  const json = (await res.json()) as Json & {
    error?: { message?: string; code?: number };
  };
  if (json.error) {
    throw new Error(
      `${json.error.message ?? "unknown error"} (code ${json.error.code ?? "?"})`,
    );
  }
  return json;
}

function line(ok: boolean, text: string) {
  console.log(`${ok ? "  ok  " : "  --  "}${text}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const token = process.env.ACCESS_TOKEN?.trim();
  if (!token) {
    console.error(
      "ACCESS_TOKEN is not set. Generate a system user token in Business\n" +
        "Settings > Users > System Users, then put it in .env.local.",
    );
    process.exit(1);
  }
  const wanted = process.env.AD_ACCOUNT_ID?.trim();

  // --- who the token belongs to, what it may do, and how long it lasts ---
  const me = await graph("me", { fields: "id,name" }, token);
  console.log(`Token belongs to: ${me.name ?? "(unnamed)"} (${me.id})\n`);

  const debug = (await graph("debug_token", { input_token: token }, token)) as {
    data?: { scopes?: string[]; expires_at?: number; type?: string };
  };
  const scopes = debug.data?.scopes ?? [];
  const expires = debug.data?.expires_at ?? 0;

  console.log("Scopes");
  for (const scope of WRITE_SCOPES) {
    line(scopes.includes(scope), scope);
  }
  // 0 means never, which is what a system user token should be. A dated one
  // works now and stops working in the middle of some future week.
  line(
    expires === 0,
    expires === 0
      ? "never expires"
      : `expires ${new Date(expires * 1000).toISOString().slice(0, 10)} — regenerate with expiration set to Never`,
  );

  // --- ad accounts ---
  console.log("\nAd accounts");
  const accounts = (await graph(
    "me/adaccounts",
    {
      fields: "name,account_id,currency,timezone_name,account_status,user_tasks",
      limit: "100",
    },
    token,
  )) as { data?: Json[] };
  const accountRows = accounts.data ?? [];
  if (accountRows.length === 0) {
    line(false, "none assigned — assign one in Business Settings > Accounts");
  }
  for (const a of accountRows) {
    const id = `act_${a.account_id}`;
    const tasks = (a.user_tasks as string[]) ?? [];
    const canWrite = tasks.some((t) => MANAGING_TASKS.includes(t));
    const mark = wanted && id === wanted ? " <- AD_ACCOUNT_ID" : "";
    line(
      canWrite,
      `${id}  ${a.name}  ${a.currency}  ${a.timezone_name}  ` +
        `[${tasks.join(", ") || "no tasks"}]${mark}`,
    );
  }

  // --- pages, and the Instagram account each one carries ---
  console.log("\nPages and Instagram accounts");
  const pages = (await graph(
    "me/accounts",
    {
      fields: "name,id,tasks,instagram_business_account{id,username}",
      limit: "100",
    },
    token,
  )) as { data?: Json[] };
  const pageRows = pages.data ?? [];
  if (pageRows.length === 0) {
    line(
      false,
      "no Pages assigned — a Page is required for object_story_spec.page_id",
    );
  }
  for (const p of pageRows) {
    const tasks = (p.tasks as string[]) ?? [];
    const canAdvertise = tasks.some((t) => MANAGING_TASKS.includes(t));
    line(
      canAdvertise,
      `page_id ${p.id}  ${p.name}  [${tasks.join(", ") || "no tasks"}]`,
    );
    const ig = p.instagram_business_account as
      | { id?: string; username?: string }
      | undefined;
    line(
      Boolean(ig?.id),
      ig?.id
        ? `  instagram_user_id ${ig.id}  @${ig.username ?? "?"}`
        : `  no Instagram account linked to ${p.name} — link it on the Page, ` +
            "then assign it to this system user",
    );
  }

  console.log(
    process.exitCode
      ? "\nSomething above is missing. Ads can still be read, but publishing " +
          "one would fail."
      : "\nEverything ad creation needs is assigned.",
  );
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
