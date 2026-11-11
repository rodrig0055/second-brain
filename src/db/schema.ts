import {
  type AnyPgColumn,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const userRole = pgEnum("user_role", ["admin", "member"]);
export const docKind = pgEnum("doc_kind", [
  "master-prompt",
  "brand-voice",
  "offer-rules",
  "catalog",
  "playbook",
  "winner",
  "image-guidelines",
  // LLM-maintained wiki kinds (see src/lib/wiki/). Appended at the end —
  // drizzle push only emits clean ALTER TYPE ADD VALUE for appends.
  "lesson", // durable directive auto-captured from chat reflection
  "wiki-page", // weekly data digest, rewritten in place by ingest
  "wiki-index", // deterministic per-brand table of contents (never injected)
  // Trigger-indexed procedure doc: only its index line (title + trigger) is
  // injected; the agent loads the body on demand via the load_skill tool.
  "skill",
  // The brand's own tribal knowledge — corrections, constraints, what worked and
  // what failed. Injected last among brand docs and declared authoritative: on a
  // conflict with generic guidance or a playbook, the lens wins, because it is
  // the brand speaking. One per brand.
  "brand-lens",
  // A playbook that is NOT injected into the cached prefix: a task loads it by slug
  // on demand and appends it to the user prompt. Everything else about it is a playbook.
  "playbook-routed",
]);
export const runStatus = pgEnum("run_status", ["running", "done", "error"]);
export const usageKind = pgEnum("usage_kind", ["chat", "task", "image"]);
export const scheduleFrequency = pgEnum("schedule_frequency", [
  "daily",
  "weekly",
]);

// External data integrations (Shopify, GA4, GSC, Meta, Google Ads, TikTok,
// SendPulse). One row per brand × platform × external account.
export const integrationPlatform = pgEnum("integration_platform", [
  "shopify",
  "ga4",
  "gsc",
  "meta",
  "google_ads",
  "tiktok",
  "sendpulse",
  // Organic Page/Instagram publishing + insights. A separate platform from
  // `meta` even though one token serves both, because the two are different
  // channels and TEAM_PLATFORMS (src/lib/tools/brain-tools.ts) scopes a chat by
  // platform — so the split is what lets drafting be gated while ads reads are
  // not. Listed LAST to match the live database: Postgres `ALTER TYPE … ADD
  // VALUE` appends, so putting it mid-list here would read as a diff to the
  // next `drizzle-kit push` and invite it to recreate the type.
  "meta_organic",
  // Organic TikTok account (Accounts API). Separate from `tiktok` (ads) for the
  // same reason meta_organic is separate from meta. Appended LAST, see above.
  "tiktok_organic",
  // A storefront CMS, through the storefront's own MCP endpoint (/mcp/cms).
  // Nothing syncs: chats read live and propose writes. Appended LAST, see above.
  "cms",
]);
export const connectionStatus = pgEnum("connection_status", [
  "connected",
  "error",
  "disconnected",
]);

// LLM providers whose API keys can be supplied via the admin UI instead of
// (or overriding) the build-time env vars. One row per provider.
export const llmProvider = pgEnum("llm_provider", [
  "anthropic",
  "openai",
  "google",
]);

// The allowlist IS this table: a row must exist (created by an admin)
// before a Google account is allowed to sign in.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  role: userRole("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Departments group teams in the nav (e.g. Marketing, Commercial).
// Admins can create new ones, so this is a table rather than a fixed enum.
export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  departmentId: uuid("department_id")
    .notNull()
    .references(() => departments.id, { onDelete: "restrict" }),
});

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
});

export const userTeamAccess = pgTable(
  "user_team_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.teamId] })],
);

export const userBrandAccess = pgTable(
  "user_brand_access",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.brandId] })],
);

// brandId null = global doc (e.g. master prompt); teamId null = brand-wide doc.
export const knowledgeDocs = pgTable("knowledge_docs", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "cascade",
  }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
  kind: docKind("kind").notNull(),
  title: text("title").notNull(),
  // Stable, human-readable key for cross-links ([[slug]]) and the wiki index.
  // Nullable until backfilled (scripts/backfill-doc-slugs.ts); uniqueness is
  // enforced per (brandId, teamId) scope at the app layer in saveDoc.
  slug: text("slug"),
  // Free-form labels for filtering / OKF-style frontmatter.
  tags: text("tags").array().notNull().default([]),
  // OKF-style structured frontmatter (source, related slugs, confidence, …).
  metadata: jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  content: text("content").notNull(),
  // For kind="skill": the "when to use this" trigger the agent pattern-matches
  // against a request before calling load_skill. Null for non-skill docs.
  triggerDescription: text("trigger_description"),
  isActive: boolean("is_active").notNull().default(true),
  // Review gate for LLM-authored docs. Human docs and all pre-existing rows are
  // "approved" (the default) so nothing regresses; reflection files new lessons
  // as "pending" (not injected until an admin approves) and marks the ones they
  // replace "superseded". buildSystemPrompt injects "approved" only.
  reviewState: text("review_state").notNull().default("approved"),
  // When the doc's facts were last confirmed against source data. Stamped by the
  // weekly ingest on the data digest; surfaced in the prompt as an "as of" date
  // so the agent can judge staleness. Null = not applicable (most human docs).
  verifiedAt: timestamp("verified_at"),
  updatedById: uuid("updated_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type TemplateInputField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "number";
  options?: string[];
  required?: boolean;
  placeholder?: string;
};

export const taskTemplates = pgTable("task_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  promptTemplate: text("prompt_template").notNull(),
  inputFields: jsonb("input_fields")
    .$type<TemplateInputField[]>()
    .notNull()
    .default([]),
  model: text("model").notNull(),
  // How the run output is rendered: "markdown" (streamed prose) or "report"
  // (structured JSON → KPI tiles + tables via ReportView).
  renderAs: text("render_as").notNull().default("markdown"),
  // Opt-in review gate. Empty (the default) = no review, so existing templates
  // are untouched. Set true on templates whose output a customer will read:
  // blog posts, product descriptions, meta fields, newsletters, ad copy.
  // See src/lib/review/.
  reviewGate: boolean("review_gate").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New chat"),
  // Selected chat model ("provider/model"); null = fall back to DEFAULT_CHAT_MODEL.
  model: text("model"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  /** Plain text of the message: what search and old rows read. */
  content: text("content").notNull(),
  /**
   * The full UI message parts (text + tool calls with their results), so a
   * reloaded chat redraws its charts, tables and choices. Null on rows written
   * before 2026-10-12 and on user turns, which render from `content`.
   */
  parts: jsonb("parts").$type<unknown[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const taskRuns = pgTable("task_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => taskTemplates.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  inputs: jsonb("inputs").$type<Record<string, string>>().notNull().default({}),
  output: text("output").notNull().default(""),
  model: text("model").notNull(),
  status: runStatus("status").notNull().default("running"),
  // The review gate's result, when the template opted in. Null = not reviewed,
  // which is deliberately distinguishable from reviewed-and-clean: an output
  // with no receipt was never checked, and must not read as if it were.
  review: jsonb("review").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Reusable per-brand reference images, uploaded by admins, stored in Vercel Blob.
export const brandAssets = pgTable("brand_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  label: text("label").notNull().default(""),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Competitors tracked per brand. Injected into every chat/task prompt for the
// brand so the agent knows who it's competing against. The domain doubles as a
// ready target for SERP/Ahrefs competitor analysis.
export const competitors = pgTable("competitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Brands this competitor applies to. Empty = all brands (global).
  brandIds: jsonb("brand_ids").$type<string[]>().notNull().default([]),
  // Deprecated: superseded by brandIds. Kept (nullable, unused) so the
  // migration stays additive; drop in a later cleanup migration.
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  domain: text("domain").notNull().default(""),
  notes: text("notes").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Calendar of commercially-relevant dates (holidays, seasonal peaks, campaign
// moments). brandId null = applies to all brands; set a brand for market-specific
// dates (e.g. Mother's Day differs across PH/SG/VN/TH). `recurring` = the same
// month/day repeats every year; the stored `date`'s month+day are what matter
// then. Non-recurring rows are one-off dates (a specific sale, an event).
export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Brands this event applies to. Empty = all brands (global). Set specific
  // brands for market-specific dates (Mother's Day differs across PH/SG/VN/TH).
  brandIds: jsonb("brand_ids").$type<string[]>().notNull().default([]),
  // Deprecated: superseded by brandIds. Kept (nullable, unused) so the
  // migration stays additive; drop in a later cleanup migration.
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  date: date("date").notNull(),
  recurring: boolean("recurring").notNull().default(false),
  notes: text("notes").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ImageOutput = {
  model: string;
  platform: string;
  url: string;
  variant?: number;
  /** GPT Image 2.6 runs: the planning depth and detail it rendered with, and who chose them. */
  settings?: { complexity: string; fineDetail: boolean; source: string };
};

export const imageGenerations = pgTable("image_generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  models: jsonb("models").$type<string[]>().notNull().default([]),
  brief: text("brief").notNull().default(""),
  platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
  referenceUrls: jsonb("reference_urls").$type<string[]>().notNull().default([]),
  outputs: jsonb("outputs").$type<ImageOutput[]>().notNull().default([]),
  status: runStatus("status").notNull().default("running"),
  // The template the run started from, if any. It is what ranks the template library by real
  // use. Nullable because most runs start from a blank brief, and forward-declared because
  // image_templates is defined just below.
  templateId: uuid("template_id").references((): AnyPgColumn => imageTemplates.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Folders that group image templates by use case. Flat (no nesting) and shared by everyone,
// like the templates themselves. Deleting a folder unfiles its templates rather than deleting them.
export const imageTemplateFolders = pgTable("image_template_folders", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Reusable image templates: reference image(s) + a baked-in prompt that prefill
// Image Studio. Self-serve (any user). brandId null = available for all brands.
export const imageTemplates = pgTable("image_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  prompt: text("prompt").notNull().default(""),
  referenceUrls: jsonb("reference_urls").$type<string[]>().notNull().default([]),
  folderId: uuid("folder_id").references(() => imageTemplateFolders.id, {
    onDelete: "set null",
  }),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const imageTemplatesRelations = relations(imageTemplates, ({ one }) => ({
  brand: one(brands, {
    fields: [imageTemplates.brandId],
    references: [brands.id],
  }),
  folder: one(imageTemplateFolders, {
    fields: [imageTemplates.folderId],
    references: [imageTemplateFolders.id],
  }),
  createdBy: one(users, {
    fields: [imageTemplates.createdById],
    references: [users.id],
  }),
}));

// One row per model call (chat reply, task run or image) capturing token usage + cost.
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: usageKind("kind").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  brandId: uuid("brand_id").references(() => brands.id, {
    onDelete: "set null",
  }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  // Cache read/creation components of inputTokens (prompt caching). Read tokens
  // bill at a steep discount, Anthropic write tokens at a small premium.
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
    .notNull()
    .default("0"),
  refId: uuid("ref_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A task template scheduled to run automatically on a recurring cadence.
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id")
    .notNull()
    .references(() => taskTemplates.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  inputs: jsonb("inputs").$type<Record<string, string>>().notNull().default({}),
  frequency: scheduleFrequency("frequency").notNull().default("daily"),
  hour: integer("hour").notNull().default(6), // UTC hour-of-day to run
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const scheduledTasksRelations = relations(scheduledTasks, ({ one }) => ({
  template: one(taskTemplates, {
    fields: [scheduledTasks.templateId],
    references: [taskTemplates.id],
  }),
  brand: one(brands, {
    fields: [scheduledTasks.brandId],
    references: [brands.id],
  }),
}));

// ---- External data integrations ----

// Per-brand connection to an external platform. Credentials are encrypted at
// rest (see src/lib/crypto.ts); `config` holds non-secret settings (shop
// domain, api version, property/account ids, currency, timezone).
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: integrationPlatform("platform").notNull(),
    displayName: text("display_name").notNull().default(""),
    // store domain / GA property id / ad-account id — natural key per platform.
    externalAccountId: text("external_account_id").notNull().default(""),
    authType: text("auth_type").notNull(), // oauth | api_key | system_user_token | service_account
    encryptedCredentials: text("encrypted_credentials"),
    config: jsonb("config")
      .$type<Record<string, string | number | boolean>>()
      .notNull()
      .default({}),
    status: connectionStatus("status").notNull().default("connected"),
    lastSyncAt: timestamp("last_sync_at"),
    lastSyncStatus: text("last_sync_status"),
    syncError: text("sync_error"),
    // Latest-state mirror of the sync_runs failure vocabulary (see sync.ts):
    // blocked_reauth_required | blocked_provider_unavailable | failed_validation.
    // Null when the last sync succeeded. `recoveryAction` is the human next step.
    failureKind: text("failure_kind"),
    recoveryAction: text("recovery_action"),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_connection_brand_platform_account").on(
      t.brandId,
      t.platform,
      t.externalAccountId,
    ),
  ],
);

// Entity-grain rows synced from a platform (orders, products, campaigns, etc.).
// Upserted on (connectionId, recordType, externalId).
export const integrationRecords = pgTable(
  "integration_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: integrationPlatform("platform").notNull(),
    recordType: text("record_type").notNull(), // order | product | campaign | …
    externalId: text("external_id").notNull(),
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_record_connection_type_external").on(
      t.connectionId,
      t.recordType,
      t.externalId,
    ),
    index("idx_record_brand_platform_type").on(
      t.brandId,
      t.platform,
      t.recordType,
    ),
  ],
);

// Denormalized daily metrics — the single pane for dashboards and agent tools.
// `dimensionKey` is a stable serialization of `dimension` ("" = account-level)
// so we can upsert on (brandId, platform, date, dimensionKey).
export const metricsDaily = pgTable(
  "metrics_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: integrationPlatform("platform").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    dimension: jsonb("dimension")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    dimensionKey: text("dimension_key").notNull().default(""),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    orders: integer("orders").notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    emailsSent: integer("emails_sent").notNull().default(0),
    opens: integer("opens").notNull().default(0),
    // Email's denominator is `delivered`, not `emailsSent` — a sendpulse row
    // without these can only yield rates against sent, which is a different
    // (lower) number than the one the email team quotes. Additive across
    // platforms in the same way `orders`/`sessions` already are (0 elsewhere).
    delivered: integer("delivered").notNull().default(0),
    unsubscribed: integer("unsubscribed").notNull().default(0),
    bounced: integer("bounced").notNull().default(0),
    spend: numeric("spend", { precision: 14, scale: 2 }).notNull().default("0"),
    revenue: numeric("revenue", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    currency: text("currency").notNull().default("USD"),
    extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_metrics_brand_platform_date_dim").on(
      t.brandId,
      t.platform,
      t.date,
      t.dimensionKey,
    ),
    index("idx_metrics_brand_date").on(t.brandId, t.date),
  ],
);

// Audit/observability for each ETL run (mirrors usageEvents ergonomics).
export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => integrationConnections.id, { onDelete: "cascade" }),
  brandId: uuid("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  platform: integrationPlatform("platform").notNull(),
  status: runStatus("status").notNull().default("running"),
  rowsWritten: integer("rows_written").notNull().default(0),
  windowStart: text("window_start"),
  windowEnd: text("window_end"),
  errorMessage: text("error_message"),
  // Failure taxonomy (null on success). Lets a caller distinguish a transient
  // provider outage (retry) from an expired credential (needs a human reconnect)
  // from bad data (needs investigation). `recoveryAction` = the human next step.
  failureKind: text("failure_kind"),
  recoveryAction: text("recovery_action"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
});

// AI-classified ad creatives. One row per (connection, ad). Holds the creative
// media refs pulled from Meta plus the durable AI labels (asset type, messaging
// angle, hook tactic, funnel stage) that power the creative-analytics dashboards.
// Metrics are NOT duplicated here — they live in integration_records ("ad_insight")
// keyed by ad id and are joined on `adId` at query time. Upserted on
// (connectionId, adId) so re-analysing a window skips already-classified ads.
export const adCreatives = pgTable(
  "ad_creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: integrationPlatform("platform").notNull().default("meta"),
    adId: text("ad_id").notNull(),
    adName: text("ad_name").notNull().default(""),
    campaignId: text("campaign_id").notNull().default(""),
    campaignName: text("campaign_name").notNull().default(""),
    objective: text("objective").notNull().default(""), // Meta campaign objective
    effectiveStatus: text("effective_status").notNull().default(""), // ACTIVE | PAUSED | …
    // creative media pulled from Meta
    mediaType: text("media_type").notNull().default(""), // image | video | carousel
    imageUrl: text("image_url"),
    thumbnailUrl: text("thumbnail_url"),
    videoId: text("video_id"),
    body: text("body").notNull().default(""), // primary text
    title: text("title").notNull().default(""), // headline
    callToAction: text("call_to_action").notNull().default(""),
    // AI classification (normalized enum values — see meta/classify.ts)
    aiAssetType: text("ai_asset_type"),
    messagingAngle: text("messaging_angle"),
    hookTactic: text("hook_tactic"),
    funnelStage: text("funnel_stage"), // TOF | MOF | BOF
    confidence: numeric("confidence", { precision: 4, scale: 2 }),
    rationale: text("rationale"),
    classification: jsonb("classification").$type<Record<string, unknown>>(),
    classifyModel: text("classify_model"),
    classifiedAt: timestamp("classified_at"),
    // The ad set this ad belongs to, so an ad set can inherit what the AI said
    // about the ads inside it without a second round trip to Meta.
    adsetId: text("adset_id").notNull().default(""),
    adsetName: text("adset_name").notNull().default(""),
    // `effectiveStatus` is what Meta is actually doing; `configuredStatus` is
    // what the ad says it should be. They differ when a parent is paused.
    configuredStatus: text("configured_status").notNull().default(""),
    metaCreatedAt: timestamp("meta_created_at"),
    // When we last confirmed the status. An ad Meta stops returning is only
    // treated as gone once this has been stale for a while, because a single
    // bad response is not a deletion.
    lastStatusAt: timestamp("last_status_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ad_creative_conn_ad").on(t.connectionId, t.adId),
    index("idx_ad_creative_brand_ad").on(t.brandId, t.adId),
    index("idx_ad_creative_conn_status").on(t.connectionId, t.effectiveStatus),
    index("idx_ad_creative_conn_adset").on(t.connectionId, t.adsetId),
  ],
);

/**
 * The email team's structured call on a send, lifted verbatim from the three
 * controlled phrases they already write by hand in the tracking sheet. It is
 * one atomic judgement, always read together, which is why it is a single jsonb
 * rather than three columns that could be set independently.
 *
 * This is computed deterministically (src/lib/email/verdict.ts), never by a
 * model: it is the number the team is judged on, so it has to be reproducible.
 */
export type EmailVerdict = {
  subject: "didnt_work" | "worked" | "worked_well" | "worked_really_well";
  content: "didnt_drive_clicks" | "drove_clicks" | "drove_clicks_well";
  unsub: "really_low" | "low" | "moderate" | "high";
};

/**
 * The email team's judgement layer, plus the SendPulse facts it hangs off.
 *
 * Why this exists rather than reading `integration_records`: that table's
 * upsert does `set: { data }`, replacing the whole jsonb every sync — any
 * annotation stored there is destroyed on the next tick. The columns below the
 * "annotations" line are written ONLY by a human via /api/email/annotate and
 * are deliberately absent from the sync's `set:` clause.
 *
 * Metrics are additive counts only. Every rate (openRate, ctr, ctor, unsubRate,
 * bounceRate) is derived in src/lib/email/metrics.ts — mixing a stored rate with
 * a derived one is how the source spreadsheet ended up with two different
 * definitions of CTR in the same column.
 */
export const emailCampaigns = pgTable(
  "email_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(), // SendPulse campaign id
    name: text("name").notNull().default(""),
    sendDate: text("send_date").notNull(), // YYYY-MM-DD, account timezone
    sendAt: timestamp("send_at"), // full send_date, for time-of-day analysis
    weekday: integer("weekday").notNull().default(0), // ISO 1=Mon..7=Sun
    subject: text("subject").notNull().default(""),
    senderEmail: text("sender_email").notNull().default(""),
    // `http://archive.sendpulse.com//u/…` — normalize scheme + double slash on write.
    permalink: text("permalink").notNull().default(""),
    // The address book is the whole universe (e.g. 523k) not the segment that
    // was actually mailed (e.g. 143k) — SendPulse applies segmentation at send
    // time and does not expose it. So listId/listName are context, not identity.
    listId: text("list_id").notNull().default(""),
    listName: text("list_name").notNull().default(""),
    segment: text("segment").notNull().default(""),
    // Bloomly TH and VN mail the whole list split by LANGUAGE rather than by
    // lifecycle segment, so for those brands (brand × language) is the
    // comparison group that (brand × segment) is for Acme Florals PH.
    // "" | en | th | vi. See src/lib/email/language.ts.
    language: text("language").notNull().default(""),
    languageSource: text("language_source").notNull().default(""), // script | utm | human | ""
    // How `segment` was resolved, in the resolver's priority order:
    // "utm"  — token in utm_campaign, read off the referrals URLs (most reliable)
    // "name" — text after the last "|" in campaign.name
    // "list" — address book name (last resort; see above)
    // "human" — set in the UI.  "" — unresolved.
    segmentSource: text("segment_source").notNull().default(""),

    // ---- metrics: additive counts only, never a rate ----
    sent: integer("sent").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    opened: integer("opened").notNull().default(0),
    clicked: integer("clicked").notNull().default(0),
    unsubscribed: integer("unsubscribed").notNull().default(0),
    bounced: integer("bounced").notNull().default(0),
    // Raw statistics.general code -> count, so a code we don't map yet is not lost.
    extra: jsonb("extra").$type<Record<string, number>>().notNull().default({}),

    // ---- annotations: written by humans only, never by sync ----
    // The one thing the API cannot give: the SendPulse filter applied at send
    // time ("Did not open campaign X", "Rating after 2 stars", "Cebu").
    targetingFilter: text("targeting_filter").notNull().default(""),
    targetingFilterTokens: jsonb("targeting_filter_tokens")
      .$type<string[]>()
      .notNull()
      .default([]),
    notes: text("notes").notNull().default(""),
    verdict: jsonb("verdict").$type<EmailVerdict | null>(),
    // Kept alongside `verdict`: when a human overrides the computed call, that
    // disagreement is the most informative row in the table.
    autoVerdict: jsonb("auto_verdict").$type<EmailVerdict | null>(),
    verdictSource: text("verdict_source").notNull().default(""), // "" | auto | human
    annotatedAt: timestamp("annotated_at"),

    // ---- GA4-attributed revenue (see src/lib/email/revenue.ts) ----
    utmCampaign: text("utm_campaign").notNull().default(""),
    utmCampaignOverride: text("utm_campaign_override").notNull().default(""),
    utmId: text("utm_id").notNull().default(""),
    revenueMatch: text("revenue_match").notNull().default("unmatched"),
    sessions: integer("sessions").notNull().default(0),
    transactions: integer("transactions").notNull().default(0),
    // NULL = unknown (never joined). 0 = genuinely zero revenue. Do not conflate.
    revenue: numeric("revenue", { precision: 14, scale: 2 }),
    revenueCurrency: text("revenue_currency").notNull().default(""),
    revenueWindowDays: integer("revenue_window_days").notNull().default(7),
    revenueSyncedAt: timestamp("revenue_synced_at"),

    syncedAt: timestamp("synced_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_email_campaign_conn_external").on(t.connectionId, t.externalId),
    index("idx_email_campaign_brand_date").on(t.brandId, t.sendDate),
    // The baseline query: trailing window for one brand × segment.
    index("idx_email_campaign_brand_segment_date").on(
      t.brandId,
      t.segment,
      t.sendDate,
    ),
    // The same query for the language-split markets (TH, VN).
    index("idx_email_campaign_brand_language_date").on(
      t.brandId,
      t.language,
      t.sendDate,
    ),
  ],
);

/**
 * Per-URL click counts from `GET /campaigns/{id}/referrals`, plus the AI label
 * for which creative element that link belongs to. Mirrors `ad_creatives`:
 * deterministic facts from the API, durable AI labels alongside, written by a
 * separate lazily-triggered pass rather than by the sync.
 *
 * Honest limitation, deliberately not hidden: a creative element is not a link.
 * Two blocks pointing at the same URL collapse into ONE referrals row, and an
 * unlinked element (a GIF, payment icons) can never earn a click. Analysis may
 * therefore only rank elements that are linked, and must never conclude that an
 * unlinked element "didn't drive clicks". The real fix is utm_content per block.
 */
export const emailCampaignLinks = pgTable(
  "email_campaign_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    // sha256 hex of `url`. The unique index keys on this because a btree entry
    // caps at ~2704 bytes and these URLs carry long UTM query strings.
    urlHash: text("url_hash").notNull(),
    clicks: integer("clicks").notNull().default(0),
    rank: integer("rank").notNull().default(0), // 1-based by clicks; "top 5" = rank <= 5
    // Deterministic, from the URL path shape — no model involved.
    linkTarget: text("link_target").notNull().default(""), // home | product | collection | search | other
    productHandle: text("product_handle").notNull().default(""),
    // AI label. NULL until classified. Closed vocabulary lives in TS
    // (src/lib/email/classify.ts) rather than a pgEnum, same as ad_creatives,
    // so adding an element type needs no migration.
    element: text("element"),
    elementDetail: text("element_detail").notNull().default(""),
    confidence: numeric("confidence", { precision: 4, scale: 2 }),
    rationale: text("rationale"),
    classifyModel: text("classify_model"),
    classifiedAt: timestamp("classified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_email_link_campaign_url").on(t.campaignId, t.urlHash),
    index("idx_email_link_brand_element").on(t.brandId, t.element),
    index("idx_email_link_campaign_rank").on(t.campaignId, t.rank),
  ],
);

// Admin-supplied API keys for the LLM providers. The key is encrypted at rest
// (same AES-256-GCM scheme as integration credentials). When a row exists for a
// provider it overrides that provider's env var at request time.
export const llmProviderKeys = pgTable("llm_provider_keys", {
  provider: llmProvider("provider").primaryKey(),
  encryptedKey: text("encrypted_key").notNull(),
  // last 4 chars of the key, kept in cleartext so the UI can show a hint.
  hint: text("hint").notNull().default(""),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Admin-registered custom LLM endpoints (any OpenAI-compatible API: a self-host,
// a gateway, OpenRouter, Together, etc.). Each row contributes one selectable
// model id of the form `<slug>/<modelName>`. The key is encrypted at rest.
export const customLlmModels = pgTable("custom_llm_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  // url-safe identifier used as the provider segment of the model id.
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  baseUrl: text("base_url").notNull(),
  // the model name passed to the provider (e.g. "llama-3.3-70b").
  modelName: text("model_name").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  // last 4 chars of the key, kept in cleartext so the UI can show a hint.
  hint: text("hint").notNull().default(""),
  createdById: uuid("created_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const integrationConnectionsRelations = relations(
  integrationConnections,
  ({ one, many }) => ({
    brand: one(brands, {
      fields: [integrationConnections.brandId],
      references: [brands.id],
    }),
    createdBy: one(users, {
      fields: [integrationConnections.createdById],
      references: [users.id],
    }),
    records: many(integrationRecords),
    syncRuns: many(syncRuns),
  }),
);

export const integrationRecordsRelations = relations(
  integrationRecords,
  ({ one }) => ({
    connection: one(integrationConnections, {
      fields: [integrationRecords.connectionId],
      references: [integrationConnections.id],
    }),
    brand: one(brands, {
      fields: [integrationRecords.brandId],
      references: [brands.id],
    }),
  }),
);

export const metricsDailyRelations = relations(metricsDaily, ({ one }) => ({
  brand: one(brands, {
    fields: [metricsDaily.brandId],
    references: [brands.id],
  }),
}));

export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
  connection: one(integrationConnections, {
    fields: [syncRuns.connectionId],
    references: [integrationConnections.id],
  }),
  brand: one(brands, { fields: [syncRuns.brandId], references: [brands.id] }),
}));

export const adCreativesRelations = relations(adCreatives, ({ one }) => ({
  connection: one(integrationConnections, {
    fields: [adCreatives.connectionId],
    references: [integrationConnections.id],
  }),
  brand: one(brands, { fields: [adCreatives.brandId], references: [brands.id] }),
}));

export const emailCampaignsRelations = relations(
  emailCampaigns,
  ({ one, many }) => ({
    connection: one(integrationConnections, {
      fields: [emailCampaigns.connectionId],
      references: [integrationConnections.id],
    }),
    brand: one(brands, {
      fields: [emailCampaigns.brandId],
      references: [brands.id],
    }),
    links: many(emailCampaignLinks),
  }),
);

export const emailCampaignLinksRelations = relations(
  emailCampaignLinks,
  ({ one }) => ({
    campaign: one(emailCampaigns, {
      fields: [emailCampaignLinks.campaignId],
      references: [emailCampaigns.id],
    }),
    brand: one(brands, {
      fields: [emailCampaignLinks.brandId],
      references: [brands.id],
    }),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  teamAccess: many(userTeamAccess),
  brandAccess: many(userBrandAccess),
}));

export const brandsRelations = relations(brands, ({ many }) => ({
  userAccess: many(userBrandAccess),
}));

// competitors + calendarEvents scope to brands via a `brandIds` array (empty =
// all brands), so there's no single-FK Drizzle relation — callers resolve brand
// names from a lookup map.

export const userBrandAccessRelations = relations(userBrandAccess, ({ one }) => ({
  user: one(users, { fields: [userBrandAccess.userId], references: [users.id] }),
  brand: one(brands, {
    fields: [userBrandAccess.brandId],
    references: [brands.id],
  }),
}));

export const brandAssetsRelations = relations(brandAssets, ({ one }) => ({
  brand: one(brands, { fields: [brandAssets.brandId], references: [brands.id] }),
}));

export const imageGenerationsRelations = relations(
  imageGenerations,
  ({ one }) => ({
    user: one(users, {
      fields: [imageGenerations.userId],
      references: [users.id],
    }),
    brand: one(brands, {
      fields: [imageGenerations.brandId],
      references: [brands.id],
    }),
  }),
);

export const departmentsRelations = relations(departments, ({ many }) => ({
  teams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  department: one(departments, {
    fields: [teams.departmentId],
    references: [departments.id],
  }),
  userAccess: many(userTeamAccess),
  templates: many(taskTemplates),
}));

export const userTeamAccessRelations = relations(userTeamAccess, ({ one }) => ({
  user: one(users, { fields: [userTeamAccess.userId], references: [users.id] }),
  team: one(teams, { fields: [userTeamAccess.teamId], references: [teams.id] }),
}));

export const knowledgeDocsRelations = relations(knowledgeDocs, ({ one }) => ({
  brand: one(brands, {
    fields: [knowledgeDocs.brandId],
    references: [brands.id],
  }),
  team: one(teams, { fields: [knowledgeDocs.teamId], references: [teams.id] }),
}));

export const taskTemplatesRelations = relations(taskTemplates, ({ one, many }) => ({
  team: one(teams, { fields: [taskTemplates.teamId], references: [teams.id] }),
  runs: many(taskRuns),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  team: one(teams, { fields: [conversations.teamId], references: [teams.id] }),
  brand: one(brands, {
    fields: [conversations.brandId],
    references: [brands.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const taskRunsRelations = relations(taskRuns, ({ one }) => ({
  template: one(taskTemplates, {
    fields: [taskRuns.templateId],
    references: [taskTemplates.id],
  }),
  user: one(users, { fields: [taskRuns.userId], references: [users.id] }),
  brand: one(brands, { fields: [taskRuns.brandId], references: [brands.id] }),
}));

// ---------------------------------------------------------------------------
// Storefront history (sitemaps + product data feeds)
//
// "Current" data is fetched live on demand; these tables keep a weekly HISTORY
// so we can compare over time. Storage stays small because we only record
// deltas (added / removed / changed) rather than a full copy each week.
// ---------------------------------------------------------------------------

export const storefrontSource = pgEnum("storefront_source", [
  "sitemap",
  "feed",
]);
export const storefrontChangeKind = pgEnum("storefront_change_kind", [
  "added",
  "removed",
  "updated",
]);

// One row per capture (a single sitemap OR feed pull) for one brand.
export const storefrontSnapshots = pgTable(
  "storefront_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    source: storefrontSource("source").notNull(),
    countryCode: text("country_code").notNull(), // PH / SG / TH / VN
    url: text("url").notNull(), // the URL that was fetched
    status: runStatus("status").notNull().default("running"),
    totalItems: integer("total_items").notNull().default(0),
    addedCount: integer("added_count").notNull().default(0),
    removedCount: integer("removed_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    // Aggregates: sitemap => counts by url type; feed => e.g. inStock / onSale.
    summary: jsonb("summary")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    errorMessage: text("error_message"),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_sf_snapshot_brand_source").on(
      t.brandId,
      t.source,
      t.capturedAt,
    ),
  ],
);

// Latest known state of every sitemap URL (upserted each capture).
export const sitemapUrls = pgTable(
  "sitemap_urls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    urlType: text("url_type").notNull().default("other"), // product/collection/blog/page/search/other
    isPresent: boolean("is_present").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    removedAt: timestamp("removed_at"),
  },
  (t) => [
    uniqueIndex("uq_sitemap_url_brand_url").on(t.brandId, t.url),
    index("idx_sitemap_url_brand_type").on(t.brandId, t.urlType),
  ],
);

// Sitemap URL add/remove history.
export const sitemapUrlChanges = pgTable(
  "sitemap_url_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => storefrontSnapshots.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    urlType: text("url_type").notNull().default("other"),
    changeKind: storefrontChangeKind("change_kind").notNull(), // added | removed
    detectedAt: timestamp("detected_at").notNull().defaultNow(),
  },
  (t) => [index("idx_sitemap_change_brand_time").on(t.brandId, t.detectedAt)],
);

// Latest known state of every feed product (upserted each capture).
export const feedProducts = pgTable(
  "feed_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(), // g:id
    title: text("title").notNull().default(""),
    link: text("link").notNull().default(""),
    imageLink: text("image_link").notNull().default(""),
    price: text("price").notNull().default(""), // e.g. "145.00 SGD"
    salePrice: text("sale_price").notNull().default(""),
    availability: text("availability").notNull().default(""),
    productType: text("product_type").notNull().default(""),
    googleCategory: text("google_category").notNull().default(""),
    // Placement fields, kept for consumers that need where an item is sold
    // (the ChatGPT plugin): g:custom_label_0 = hub id, g:custom_label_2 =
    // comma-separated PSGC city ids the item is limited to (empty = no limit).
    hubId: text("hub_id").notNull().default(""),
    cityIds: text("city_ids").notNull().default(""),
    description: text("description").notNull().default(""),
    isPresent: boolean("is_present").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    removedAt: timestamp("removed_at"),
  },
  (t) => [
    uniqueIndex("uq_feed_product_brand_pid").on(t.brandId, t.productId),
  ],
);

// Feed product delta history (only rows where something changed).
export const feedProductChanges = pgTable(
  "feed_product_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => storefrontSnapshots.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    title: text("title").notNull().default(""),
    changeKind: storefrontChangeKind("change_kind").notNull(), // added | removed | updated
    field: text("field"), // price | sale_price | availability | title (null for add/remove)
    oldValue: text("old_value"),
    newValue: text("new_value"),
    detectedAt: timestamp("detected_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_feed_change_brand_time").on(t.brandId, t.detectedAt),
    index("idx_feed_change_product").on(t.brandId, t.productId),
  ],
);

export const storefrontSnapshotsRelations = relations(
  storefrontSnapshots,
  ({ one, many }) => ({
    brand: one(brands, {
      fields: [storefrontSnapshots.brandId],
      references: [brands.id],
    }),
    sitemapChanges: many(sitemapUrlChanges),
    feedChanges: many(feedProductChanges),
  }),
);

export const sitemapUrlsRelations = relations(sitemapUrls, ({ one }) => ({
  brand: one(brands, {
    fields: [sitemapUrls.brandId],
    references: [brands.id],
  }),
}));

export const sitemapUrlChangesRelations = relations(
  sitemapUrlChanges,
  ({ one }) => ({
    brand: one(brands, {
      fields: [sitemapUrlChanges.brandId],
      references: [brands.id],
    }),
    snapshot: one(storefrontSnapshots, {
      fields: [sitemapUrlChanges.snapshotId],
      references: [storefrontSnapshots.id],
    }),
  }),
);

export const feedProductsRelations = relations(feedProducts, ({ one }) => ({
  brand: one(brands, {
    fields: [feedProducts.brandId],
    references: [brands.id],
  }),
}));

export const feedProductChangesRelations = relations(
  feedProductChanges,
  ({ one }) => ({
    brand: one(brands, {
      fields: [feedProductChanges.brandId],
      references: [brands.id],
    }),
    snapshot: one(storefrontSnapshots, {
      fields: [feedProductChanges.snapshotId],
      references: [storefrontSnapshots.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// LLM wiki (Karpathy-style): the model maintains lesson / wiki-page docs in
// knowledge_docs; wiki_activity is the append-only log of every wiki decision
// (Karpathy's log.md) — also the job record and the reflection throttle state.
// ---------------------------------------------------------------------------

export const wikiOp = pgEnum("wiki_op", [
  "reflection",
  "ingest",
  "lint",
  "index",
  // The weekly proactive pass that files proposals (see src/lib/proposals/).
  "propose",
]);

/**
 * What a proposal is asking for. The pass proposes; a human disposes. Nothing
 * here is ever applied on its own.
 */
export const proposalKind = pgEnum("proposal_kind", [
  "context-edit", // a doc is wrong, or is missing something the week revealed
  "template", // a task worth turning into a reusable template
  "schedule", // the team keeps asking for the same thing by hand
  "idea", // a campaign or content idea worth keeping
  "open-loop", // an unresolved question worth researching (feeds the loops engine)
  "preference", // a standing preference the team revealed
]);

export const proposalState = pgEnum("proposal_state", [
  "pending",
  "applied",
  "dismissed",
]);

/**
 * The proposals inbox.
 *
 * The brain reads the week across everything connected and files what it thinks
 * should change. A dismissed proposal keeps its reasoning rather than being
 * deleted, because knowing what the team rejected is itself worth having: it
 * stops the same suggestion coming back every week.
 */
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    kind: proposalKind("kind").notNull(),
    title: text("title").notNull(),
    /** The proposal itself, written for a person to act on. */
    body: text("body").notNull(),
    /**
     * Why this is worth doing: exact quotes with their source, plus what the
     * pass could not see. Verbatim is the point — a flattened "the team wanted
     * better reporting" is not actionable, the real sentence is.
     */
    evidence: jsonb("evidence")
      .$type<{
        quotes?: {
          text: string;
          source: string;
          verified?: boolean;
          /** Resolved by matching the quote, so it points at a real thread. */
          userId?: string;
          conversationId?: string;
        }[];
        signals?: string[];
        blindSpots?: string[];
      }>()
      .notNull()
      .default({}),
    /**
     * Whose work produced this.
     *
     * Resolved from which conversation actually contains the proposal's quote,
     * not from what the model claims the source was. Null when the evidence is
     * organisational rather than one person's (a stale doc, a repeated template)
     * — those stay an admin concern.
     *
     * This is what lets a proposal reach the person who caused it instead of
     * waiting in an admin page they may never open.
     */
    sourceUserId: uuid("source_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    state: proposalState("state").notNull().default("pending"),
    /** The reason on dismissal, or the note on approval. Never dropped. */
    decision: text("decision").notNull().default(""),
    decidedById: uuid("decided_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at"),
    /** Which pass produced it, so a bad batch can be traced and retired. */
    runRef: text("run_ref").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("proposals_brand_state_idx").on(t.brandId, t.state),
    index("proposals_source_user_idx").on(t.sourceUserId, t.state),
    index("proposals_created_idx").on(t.createdAt),
  ],
);

export const proposalsRelations = relations(proposals, ({ one }) => ({
  brand: one(brands, { fields: [proposals.brandId], references: [brands.id] }),
  team: one(teams, { fields: [proposals.teamId], references: [teams.id] }),
  decidedBy: one(users, {
    fields: [proposals.decidedById],
    references: [users.id],
    relationName: "proposalDecidedBy",
  }),
  sourceUser: one(users, {
    fields: [proposals.sourceUserId],
    references: [users.id],
    relationName: "proposalSourceUser",
  }),
}));

// ---------------------------------------------------------------------------
// Open loops → hypotheses → validations.
//
// The research pipeline: the brain notices what it cannot explain, a weekly pass
// decides which of those questions are worth chasing, each promoted question
// becomes a falsifiable prediction with a test built from tools we actually
// have, and running the test produces a verdict with a shelf life.
//
// The four stages stay distinct on purpose. A loop is a QUESTION, a hypothesis
// is a PREDICTION plus the test that would settle it, a validation is a VERDICT.
// Blur them and you get recommendations dressed as research.
// ---------------------------------------------------------------------------

/**
 * Why an observation became a question. Naming the pull is what separates a real
 * loop from a note: it says what specifically caught the eye.
 */
export const loopPull = pgEnum("loop_pull", [
  "curiosity", // something the rest of our context cannot explain
  "resonance", // something notably good, and we want to know why it works
  "surprise", // contradicts what our context would have predicted
  "tension", // two sources disagree and cannot both be true
  "pattern", // the same thing keeps appearing across independent sources
  "gap", // an absence where presence would be expected
]);

/**
 * Where the question lives in the business.
 *
 * Deliberately NOT a copy of a DTC-creative taxonomy: these are the six things
 * this company actually argues about across six brands and four markets. They
 * are a lens for spotting neglect ("every loop is about message, nobody is
 * asking about economics"), never a cage — a question that sits between two gets
 * the closer one.
 */
export const loopTerritory = pgEnum("loop_territory", [
  "demand", // where traffic and demand come from, and why it moves
  "offer", // pricing, promos, product mix, what to lead with
  "message", // what we say and show
  "audience", // who we reach, and who we are missing
  "economics", // unit economics, CAC, ROAS, MER, where budget should go
  "retention", // repeat purchase, lifecycle, email
]);

export const loopState = pgEnum("loop_state", [
  "captured", // noticed, not yet graded
  "promoted", // graded worth chasing, in the testing queue
  "archived", // below the bar, kept with its reasoning
  "answered", // a validation resolved it
]);

export const hypothesisState = pgEnum("hypothesis_state", [
  "draft",
  "ready", // has a falsifiable prediction and a runnable plan
  "resolved",
  "unvalidatable", // cannot be settled with the data we can reach
]);

export const validationVerdict = pgEnum("validation_verdict", [
  "validated",
  "invalidated",
  "inconclusive", // the test ran and the evidence genuinely points both ways
  "insufficient", // the test could not gather enough to judge
]);

export const openLoops = pgTable(
  "open_loops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** What was noticed, in one or two sentences. */
    observation: text("observation").notNull(),
    pull: loopPull("pull").notNull(),
    /** One sentence on how the pull fired: what turned a note into a question. */
    pullNote: text("pull_note").notNull().default(""),
    /**
     * The one open question. Singular on purpose: a loop carrying two questions
     * was two loops, and stacking them makes it impossible to score or settle.
     */
    question: text("question").notNull(),
    /** What would change for the brand if this were answered. */
    justification: text("justification").notNull(),
    territory: loopTerritory("territory").notNull(),
    evidence: jsonb("evidence")
      .$type<{
        quotes?: { text: string; source: string; verified?: boolean }[];
        sources?: string[];
        blindSpots?: string[];
      }>()
      .notNull()
      .default({}),
    state: loopState("state").notNull().default("captured"),
    /**
     * Set by the roll-up. Capture never scores itself: generation captures and
     * grading decides, so nothing is pre-killed at the moment of noticing.
     */
    score: jsonb("score").$type<{
      stakes: number;
      confidence: number;
      researchability: number;
      novelty: number;
      total: number;
      reasoning?: string;
    }>(),
    tier: integer("tier"),
    /** Why it was archived. A known dead end is worth more than a lost noticing. */
    archivedReason: text("archived_reason").notNull().default(""),
    sourceProposalId: uuid("source_proposal_id").references(() => proposals.id, {
      onDelete: "set null",
    }),
    /**
     * The loop this one came out of. A finding almost always raises the next
     * question, and this is what makes the pipeline feed itself instead of
     * dead-ending at a verdict.
     */
    parentLoopId: uuid("parent_loop_id"),
    /**
     * Whose work raised this question. Inherited from the proposal that produced
     * it, and from the parent loop for a successor, so a chain of reasoning stays
     * attributed to the person who started it. Distinct from createdById, which
     * records who accepted the proposal.
     */
    sourceUserId: uuid("source_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    gradedAt: timestamp("graded_at"),
  },
  (t) => [
    index("open_loops_brand_state_idx").on(t.brandId, t.state),
    index("open_loops_source_user_idx").on(t.sourceUserId, t.state),
    index("open_loops_territory_idx").on(t.territory),
  ],
);

export const hypotheses = pgTable(
  "hypotheses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    loopId: uuid("loop_id")
      .notNull()
      .references(() => openLoops.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** The bet, stated so evidence could refute it. Ours, never a fact. */
    prediction: text("prediction").notNull(),
    /**
     * The pulls that would settle it, each naming a tool we actually have.
     * Triangulated: a few sources that each see a different angle, read only as
     * deep as that angle needs.
     */
    testPlan: jsonb("test_plan")
      .$type<{ tool: string; pull: string; looksLike: string }[]>()
      .notNull()
      .default([]),
    /**
     * What each outcome would mean, written BEFORE the research runs. A bar set
     * afterwards is not a bar, it is a rationalisation.
     */
    bar: jsonb("bar")
      .$type<{
        validated: string;
        invalidated: string;
        inconclusive: string;
        insufficient: string;
      }>()
      .notNull()
      .default({
        validated: "",
        invalidated: "",
        inconclusive: "",
        insufficient: "",
      }),
    state: hypothesisState("state").notNull().default("draft"),
    unvalidatableReason: text("unvalidatable_reason").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("hypotheses_brand_state_idx").on(t.brandId, t.state)],
);

export const validations = pgTable(
  "validations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hypothesisId: uuid("hypothesis_id")
      .notNull()
      .references(() => hypotheses.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    verdict: validationVerdict("verdict").notNull(),
    /** What the pulls actually returned, and how it met or missed the bar. */
    findings: text("findings").notNull(),
    evidence: jsonb("evidence")
      .$type<{
        pulls?: { tool: string; result: string }[];
        blindSpots?: string[];
      }>()
      .notNull()
      .default({}),
    /**
     * A confirmed finding is not assumed to hold forever. The account moves, the
     * market moves, and a validated claim past this date is a stale claim.
     */
    revalidateBy: timestamp("revalidate_by"),
    /** The question this answer raised. See openLoops.parentLoopId. */
    nextLoopId: uuid("next_loop_id").references(() => openLoops.id, {
      onDelete: "set null",
    }),
    model: text("model"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("validations_brand_verdict_idx").on(t.brandId, t.verdict)],
);

export const openLoopsRelations = relations(openLoops, ({ one, many }) => ({
  brand: one(brands, { fields: [openLoops.brandId], references: [brands.id] }),
  team: one(teams, { fields: [openLoops.teamId], references: [teams.id] }),
  sourceProposal: one(proposals, {
    fields: [openLoops.sourceProposalId],
    references: [proposals.id],
  }),
  sourceUser: one(users, {
    fields: [openLoops.sourceUserId],
    references: [users.id],
  }),
  hypotheses: many(hypotheses),
}));

export const hypothesesRelations = relations(hypotheses, ({ one, many }) => ({
  loop: one(openLoops, {
    fields: [hypotheses.loopId],
    references: [openLoops.id],
  }),
  brand: one(brands, { fields: [hypotheses.brandId], references: [brands.id] }),
  validations: many(validations),
}));

export const validationsRelations = relations(validations, ({ one }) => ({
  hypothesis: one(hypotheses, {
    fields: [validations.hypothesisId],
    references: [hypotheses.id],
  }),
  brand: one(brands, { fields: [validations.brandId], references: [brands.id] }),
}));

export const wikiActivity = pgTable(
  "wiki_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").references(() => teams.id, {
      onDelete: "set null",
    }),
    op: wikiOp("op").notNull(),
    // created | updated | replaced | no-lesson | skipped | deactivated |
    // flagged | regenerated | error
    action: text("action").notNull(),
    // set null (not cascade) so the audit trail survives doc deletion.
    docId: uuid("doc_id").references(() => knowledgeDocs.id, {
      onDelete: "set null",
    }),
    refId: uuid("ref_id"), // conversationId for reflection; null for cron ops
    detail: text("detail").notNull().default(""),
    meta: jsonb("meta")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    model: text("model"), // null for deterministic ops (index)
    status: runStatus("status").notNull().default("done"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_wiki_activity_brand_time").on(t.brandId, t.createdAt),
    index("idx_wiki_activity_ref").on(t.refId),
  ],
);

export const wikiActivityRelations = relations(wikiActivity, ({ one }) => ({
  brand: one(brands, {
    fields: [wikiActivity.brandId],
    references: [brands.id],
  }),
  team: one(teams, { fields: [wikiActivity.teamId], references: [teams.id] }),
  doc: one(knowledgeDocs, {
    fields: [wikiActivity.docId],
    references: [knowledgeDocs.id],
  }),
}));

// ---- Newsletter campaigns ----

/**
 * Where a campaign is in the pipeline. It only moves forward on an explicit
 * action: `ready` means validation passed AND a human approved it, and nothing
 * reaches SendPulse without that. `needs_art` exists because the hero is the
 * one part of the email a person still makes.
 */
export const newsletterStatus = pgEnum("newsletter_status", [
  "draft",
  "needs_art",
  "ready",
  "handed_off",
  "sent",
  "archived",
]);

/**
 * One planned email. `blocks` holds the Campaign block array — the same shape
 * both renderers consume — so the editor, the validator and the emitters all
 * read one source of truth.
 *
 * The rendered HTML is deliberately NOT stored here: it is derived from
 * `blocks` plus live catalog data, and a stale copy that disagrees with the
 * blocks would be worse than no copy. It is rebuilt on demand.
 */
export const newsletterCampaigns = pgTable(
  "newsletter_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),

    // The slot this send occupies. `sendAt` lives on the campaign rather than
    // in `scheduledTasks` because that table's `weekly` fires Monday only, and
    // SG sends Tue/Thu/Sat.
    sendDate: date("send_date").notNull(),
    status: newsletterStatus("status").notNull().default("draft"),

    subject: text("subject").notNull().default(""),
    preheader: text("preheader").notNull().default(""),
    // Campaign["blocks"] from src/lib/newsletter/campaign.ts.
    blocks: jsonb("blocks").$type<unknown[]>().notNull().default([]),

    // The designer's contribution, or an image-studio generation.
    heroAssetUrl: text("hero_asset_url").notNull().default(""),

    // Email-safe derivatives of the catalog photos, cached so a re-render does
    // not re-download 14MB of originals. Keyed by source URL + width, so a
    // product swap invalidates only its own entry.
    derivedImages: jsonb("derived_images")
      .$type<{ key: string; url: string; bytes: number }[]>()
      .notNull()
      .default([]),

    // Last validation result, so the list can show state without re-running it.
    // Advisory only — every render re-validates before it emits anything.
    validation: jsonb("validation").$type<{
      errors: number;
      warnings: number;
      checkedAt: string;
    }>(),

    // Set when a person approves. Both together are the send gate.
    approvedById: uuid("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),

    // Populated in phase 4; kept here so the handoff has somewhere to land.
    sendpulseTemplateId: text("sendpulse_template_id").notNull().default(""),
    sendpulseCampaignId: text("sendpulse_campaign_id").notNull().default(""),

    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("newsletter_campaigns_brand_date_idx").on(t.brandId, t.sendDate),
    index("newsletter_campaigns_status_idx").on(t.status),
  ],
);

export const newsletterCampaignsRelations = relations(
  newsletterCampaigns,
  ({ one }) => ({
    brand: one(brands, {
      fields: [newsletterCampaigns.brandId],
      references: [brands.id],
    }),
    team: one(teams, {
      fields: [newsletterCampaigns.teamId],
      references: [teams.id],
    }),
    approvedBy: one(users, {
      fields: [newsletterCampaigns.approvedById],
      references: [users.id],
    }),
  }),
);

/**
 * Per-send results, with clicks attributed to what was clicked.
 *
 * `metricsDaily` already carries campaign totals; what has no home is the
 * per-link breakdown, which is the column the team maintains by hand in the
 * review spreadsheet ("Contents with Highest Clicks (Top 5)"). SendPulse
 * exposes it at /campaigns/{id}/referrals, so it can be generated instead.
 *
 * Keyed by the SendPulse campaign id rather than our own, because the point is
 * to ingest the months of history that pre-date this tool. `campaignId` is set
 * only for sends the brain produced.
 */
export const newsletterLinkStats = pgTable(
  "newsletter_link_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    sendpulseCampaignId: text("sendpulse_campaign_id").notNull(),
    campaignId: uuid("campaign_id").references(() => newsletterCampaigns.id, {
      onDelete: "set null",
    }),

    sendDate: date("send_date").notNull(),
    subject: text("subject").notNull().default(""),

    delivered: integer("delivered").notNull().default(0),
    opened: integer("opened").notNull().default(0),
    clicked: integer("clicked").notNull().default(0),
    unsubscribed: integer("unsubscribed").notNull().default(0),

    /**
     * Every link the send contained, with its click count and what it points
     * at. `kind` is the review spreadsheet's own vocabulary (product, occasion,
     * collection, home, social) so the generated table reads like the one the
     * team already keeps.
     */
    links: jsonb("links")
      .$type<{ href: string; kind: string; label: string; clicks: number }[]>()
      .notNull()
      .default([]),

    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("newsletter_link_stats_campaign_uq").on(t.brandId, t.sendpulseCampaignId),
    index("newsletter_link_stats_date_idx").on(t.brandId, t.sendDate),
  ],
);

export const newsletterLinkStatsRelations = relations(newsletterLinkStats, ({ one }) => ({
  brand: one(brands, { fields: [newsletterLinkStats.brandId], references: [brands.id] }),
  campaign: one(newsletterCampaigns, {
    fields: [newsletterLinkStats.campaignId],
    references: [newsletterCampaigns.id],
  }),
}));

/**
 * The content framework, as data rather than a spreadsheet tab.
 *
 * One row per brand per weekday it sends. `themes` is the Excel's own
 * vocabulary ("Occasion Amplification", "Engagement Content"), kept as free
 * text because it is editorial guidance for the planner, not an enum the code
 * branches on. A brand's cadence is simply which weekdays have active rows —
 * SG has three, Acme Florals has seven.
 */
export const newsletterSlots = pgTable(
  "newsletter_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    // 0 = Sunday, matching Date#getDay, so no translation at the call site.
    weekday: integer("weekday").notNull(),
    themes: text("themes").array().notNull().default([]),
    /** The standing offer for this brand, e.g. "S$15 OFF, capped at S$10". */
    voucher: text("voucher").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("newsletter_slots_brand_weekday_uq").on(t.brandId, t.weekday)],
);

export const newsletterSlotsRelations = relations(newsletterSlots, ({ one }) => ({
  brand: one(brands, { fields: [newsletterSlots.brandId], references: [brands.id] }),
}));

/**
 * Templates a marketer saved from a campaign they liked.
 *
 * The four built-in skeletons live in code (src/lib/newsletter/templates.ts)
 * because they carry slot definitions the framework fills. A saved template is
 * simpler: a frozen block list, copy and all, because the thing being asked for
 * is "make another one like that".
 *
 * `brandId` null means every brand. A template saved from a Bloomly SG campaign
 * usually names Bloomly SG products, so saving defaults to that brand only.
 */
export const newsletterTemplates = pgTable(
  "newsletter_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    blocks: jsonb("blocks").notNull().default([]),
    subject: text("subject").notNull().default(""),
    preheader: text("preheader").notNull().default(""),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("newsletter_templates_team_idx").on(t.teamId, t.createdAt)],
);

export const newsletterTemplatesRelations = relations(newsletterTemplates, ({ one }) => ({
  brand: one(brands, { fields: [newsletterTemplates.brandId], references: [brands.id] }),
  team: one(teams, { fields: [newsletterTemplates.teamId], references: [teams.id] }),
}));

/**
 * What a person knows about a Meta entity that Meta itself does not record.
 *
 * Kept out of `integration_records`, where the platform's own copy of an entity
 * lives: every sync replaces that jsonb wholesale, so anything a human typed
 * there is destroyed by the next run.
 *
 * Funnel is the reason this table exists. The process doc reads it off the
 * campaign name, then lists the exceptions that break it — Bloomly PH runs its
 * MOF ad set inside the TOF campaign — so the mapping has to be stated per ad
 * set and stored, not inferred. See src/lib/ads/funnel.ts for the precedence.
 */
export const adAnnotations = pgTable(
  "ad_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    // campaign | adset | ad. Text rather than an enum, matching reviewState and
    // renderAs: a new level should not need a migration on an enum type.
    level: text("level").notNull(),
    entityId: text("entity_id").notNull(),
    entityName: text("entity_name").notNull().default(""),
    funnel: text("funnel"), // TOF | MOF | BOF, null while unmapped
    audienceLabel: text("audience_label").notNull().default(""),
    /** The sale or occasion this belongs to: PAYDAY, 9.9, GRANDPARENTS, BAU. */
    purpose: text("purpose").notNull().default(""),
    /**
     * An ad set made so a sale's new ads actually spend. Meta otherwise keeps
     * buying the proven BAU ads and the new ones get nothing, which the PO26
     * sheet records by hand as "failed to run". Exempt from the routine
     * efficiency rules, which would flag them by design.
     */
    isEventAdSet: boolean("is_event_ad_set").notNull().default(false),
    /** Overrides the funnel's own CIR target for this entity. */
    cirTargetPct: numeric("cir_target_pct", { precision: 6, scale: 2 }),
    /** The doc's request: a preview link, or a Trello card, per ad. */
    trelloUrl: text("trello_url").notNull().default(""),
    // Human corrections to the AI creative labels in ad_creatives. Kept apart
    // so re-running the classifier never overwrites a person's judgement.
    hookOverride: text("hook_override"),
    angleOverride: text("angle_override"),
    // Who decided this: a person in the workspace, a person via chat, or a seed
    // script. Never the classifier — an AI guess stays a suggestion in
    // ad_creatives.funnelStage and is only promoted here by someone accepting
    // it, so this table always means "somebody said so".
    source: text("source").notNull().default("user"),
    updatedById: uuid("updated_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ad_annotation_entity").on(t.connectionId, t.level, t.entityId),
    index("idx_ad_annotation_brand_level").on(t.brandId, t.level),
  ],
);

/**
 * An append-only log of why an ad was turned off, turned back on, or left alone.
 *
 * The doc asks for it directly: "A note column can be also useful for
 * additional notes why the ad was re-activated, turned-off, or left to be
 * turned on." Append-only because the value is the history, and because the
 * sync writes here too when it notices a status changed in Ads Manager — which
 * is how a pause made outside this tool shows up inside it.
 */
export const adNotes = pgTable(
  "ad_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    level: text("level").notNull(),
    entityId: text("entity_id").notNull(),
    body: text("body").notNull(),
    /** user | system. System notes come from the sync noticing a change. */
    source: text("source").notNull().default("user"),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_ad_note_entity").on(t.connectionId, t.entityId, t.createdAt)],
);

/**
 * The thresholds a brand is judged against, one row per rule.
 *
 * In a table rather than connection config or doc metadata because these get
 * edited, argued with, and need to say who last changed them. `params` is jsonb
 * so each rule kind carries its own shape, validated with zod at the edge (see
 * src/lib/ads/rules/).
 *
 * `currency` is stored per rule rather than assumed from the account: Bloomly PH
 * bills in USD while the .ph brands are otherwise discussed in pesos, and a
 * threshold of 30 means nothing until you know which. Evaluation refuses on a
 * mismatch instead of comparing anyway, which would be out by roughly 58x.
 *
 * `confirmed_at` null means the numbers are inherited, not this brand's own.
 * Every threshold ships from Acme Florals PH's benchmarks in the process doc,
 * because no Bloomly PH targets exist yet, and a borrowed benchmark must never
 * read as a measured one.
 */
export const adRules = pgTable(
  "ad_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** Stable handle used in alerts and in the UI, e.g. "cir-tof". */
    key: text("key").notNull(),
    /** See RULE_KINDS in src/lib/ads/rules/types.ts. */
    kind: text("kind").notNull(),
    label: text("label").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    level: text("level").notNull().default("ad"),
    /** Empty = every funnel. */
    funnels: jsonb("funnels").$type<string[]>().notNull().default([]),
    includeEventAdSets: boolean("include_event_ad_sets").notNull().default(false),
    params: jsonb("params").$type<Record<string, number>>().notNull().default({}),
    currency: text("currency").notNull().default("USD"),
    /** Where the numbers came from, e.g. "Acme Florals PH benchmarks". */
    source: text("source").notNull().default(""),
    confirmedAt: timestamp("confirmed_at"),
    confirmedById: uuid("confirmed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ad_rule_key").on(t.connectionId, t.key),
    index("idx_ad_rule_brand_enabled").on(t.brandId, t.enabled),
  ],
);

/**
 * A rule firing on one entity over one window.
 *
 * `fingerprint` is what stops the same problem being raised every time the
 * rules run: it combines the rule, the entity and the window end, so a repeat
 * updates `last_seen_at` instead of filing a duplicate. Without it a daily pass
 * would bury the specialist in the same fifteen alerts every morning, which is
 * the fastest way to make them stop reading any of them.
 *
 * `provisional` marks a finding that rests on days Meta may still restate.
 * Only the spend-based rules can be provisional, because the doc asks for those
 * early; anyone acting on one needs to know a purchase could still land.
 */
export const adAlerts = pgTable(
  "ad_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => adRules.id, { onDelete: "set null" }),
    ruleKey: text("rule_key").notNull(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("warning"), // critical | warning
    level: text("level").notNull(),
    entityId: text("entity_id").notNull(),
    entityName: text("entity_name").notNull().default(""),
    funnel: text("funnel"),
    fingerprint: text("fingerprint").notNull(),
    metric: text("metric").notNull().default(""),
    observed: numeric("observed", { precision: 14, scale: 4 }),
    threshold: numeric("threshold", { precision: 14, scale: 4 }),
    message: text("message").notNull().default(""),
    provisional: boolean("provisional").notNull().default(false),
    /** False when the rule's thresholds are inherited rather than confirmed. */
    confirmed: boolean("confirmed").notNull().default(false),
    windowStart: date("window_start"),
    windowEnd: date("window_end"),
    /** open | acknowledged | resolved */
    state: text("state").notNull().default("open"),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    acknowledgedById: uuid("acknowledged_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    acknowledgedAt: timestamp("acknowledged_at"),
  },
  (t) => [
    uniqueIndex("uq_ad_alert_fingerprint").on(t.connectionId, t.fingerprint),
    index("idx_ad_alert_open").on(t.brandId, t.state, t.severity),
  ],
);

/**
 * A change to the live ad account: proposed here, approved by a person, then
 * carried out. Nothing reaches Meta without a row in this table.
 *
 * Deliberately not the `proposals` table. Accepting a proposal only records a
 * decision, whereas accepting one of these performs an irreversible action on a
 * live account, so it needs its own execution record: what was sent, what came
 * back, how many attempts, and the status the entity held when the change was
 * proposed. The weekly proposals pass also counts pending rows and reads past
 * ones as signal, and ad actions would drown both.
 *
 * `expectedStatus` is the guard against acting on a stale view. Between a rule
 * proposing a pause and a human approving it, somebody may have paused, edited
 * or re-activated the ad in Ads Manager. The executor re-reads the live status
 * and refuses when it no longer matches, rather than reverting a person's more
 * recent decision.
 *
 * `openKey` is unique while an action is open and null once it closes, so an
 * entity cannot collect two competing pending pauses. Partial uniqueness is
 * expressed by storing null, since Postgres treats nulls as distinct.
 */
export const adActions = pgTable(
  "ad_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** pause_ad | activate_ad | create_ad */
    kind: text("kind").notNull(),
    level: text("level").notNull().default("ad"),
    /** Empty for create_ad, which has no entity until it succeeds. */
    entityId: text("entity_id").notNull().default(""),
    entityName: text("entity_name").notNull().default(""),
    /** Everything the executor needs: expectedStatus, draftId, adSetId. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Why, in the words shown to whoever approves it. */
    reason: text("reason").notNull().default(""),
    /** rule | user | agent */
    source: text("source").notNull().default("rule"),
    alertId: uuid("alert_id").references(() => adAlerts.id, { onDelete: "set null" }),
    proposedById: uuid("proposed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** pending | approved | executing | done | failed | rejected | stale | cancelled | outcome_unknown */
    state: text("state").notNull().default("pending"),
    /**
     * The set this belongs to, when it was decided alongside others.
     *
     * Nullable, because a single pause from the workspace is still one action
     * with no set around it, and forcing a set of one would put a layer between
     * a button and the thing it does.
     */
    changeSetId: uuid("change_set_id").references(() => adChangeSets.id, {
      onDelete: "cascade",
    }),
    openKey: text("open_key"),
    decidedById: uuid("decided_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Required to reject, so a refusal teaches the next pass something. */
    decision: text("decision").notNull().default(""),
    decidedAt: timestamp("decided_at"),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at"),
    metaRequest: jsonb("meta_request").$type<Record<string, unknown>>(),
    metaResponse: jsonb("meta_response").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ad_action_open").on(t.connectionId, t.openKey),
    index("idx_ad_action_state").on(t.brandId, t.state, t.createdAt),
  ],
);

/**
 * The morning summary, built once per account per day and stored.
 *
 * Stored rather than recomputed because it is a record of what the team was
 * told on a given morning. Rebuilding it later would silently rewrite that,
 * since Meta keeps restating recent days, and "what did we know on Tuesday"
 * is exactly the question asked after a bad decision.
 */
export const adDigests = pgTable(
  "ad_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** In the ad account's own timezone, not UTC. */
    date: date("date").notNull(),
    /** Rendered with the same <ReportView/> the task reports use. */
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_ad_digest_day").on(t.connectionId, t.date)],
);

/**
 * An ad waiting to be made, replacing the Ad Marketing Funnel sheet.
 *
 * The sheet's own columns, because those are what the team fills in: concept,
 * headline, caption, purpose, audience, upload status, date requested, notes.
 *
 * Both aspect ratios are required before a draft can run. The doc is explicit
 * that every ad needs a 1:1 and a 9:16, and an ad published with only one gets
 * cropped or letterboxed in half its placements.
 */
export const adDrafts = pgTable(
  "ad_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** The peg or idea, e.g. "Generic KV Style". */
    concept: text("concept").notNull().default(""),
    /** PAYDAY | 9.9 | GRANDPARENTS | QIXI | BDAY | BAU */
    purpose: text("purpose").notNull().default("BAU"),
    /** When the sale or occasion lands, for the 5-7 days notice rule. */
    eventDate: date("event_date"),
    funnels: jsonb("funnels").$type<string[]>().notNull().default([]),
    targetAdSetId: text("target_ad_set_id").notNull().default(""),
    headline: text("headline").notNull().default(""),
    primaryText: text("primary_text").notNull().default(""),
    description: text("description").notNull().default(""),
    callToAction: text("call_to_action").notNull().default("SHOP_NOW"),
    linkUrl: text("link_url").notNull().default(""),
    /** [{ratio: "1:1"|"9:16", url, kind, imageGenerationId, metaHash}] */
    assets: jsonb("assets").$type<Record<string, unknown>[]>().notNull().default([]),
    trelloUrl: text("trello_url").notNull().default(""),
    /** requested | ready_to_run | uploading | uploaded | failed_to_run | archived */
    status: text("status").notNull().default("requested"),
    notes: text("notes").notNull().default(""),
    /** Null means never reviewed, distinct from reviewed and clean. */
    review: jsonb("review").$type<Record<string, unknown>>(),
    metaCreativeId: text("meta_creative_id"),
    metaAdId: text("meta_ad_id"),
    requestedById: uuid("requested_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    uploadedAt: timestamp("uploaded_at"),
    archivedAt: timestamp("archived_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_ad_draft_status").on(t.brandId, t.status, t.requestedAt),
    index("idx_ad_draft_event").on(t.brandId, t.eventDate),
  ],
);

/**
 * The account as Meta has it configured, as opposed to how it performed.
 *
 * `metrics_daily` is built from the Insights API, which reports delivery. It
 * has never carried objective, budget, bid strategy, schedule or targeting,
 * because Insights does not return them. So until this table existed the app
 * could not answer "what is this ad set's daily budget", let alone propose
 * changing it.
 *
 * Synced from the `/campaigns`, `/adsets` and `/ads` edges, one row per entity
 * per connection, upserted on (connection, level, entity). Rows are a mirror,
 * not a history: the previous value of a field is not kept here, because the
 * record of a deliberate change belongs in `ad_actions` and a change somebody
 * made in Ads Manager is Meta's own `/activities` to tell.
 *
 * Budgets are stored in the account currency's MINOR unit, exactly as Meta
 * returns them, and converted on read. Dividing by 100 here would be right for
 * USD, PHP, SGD and THB and wrong for VND, which has no minor unit at all.
 */
export const adEntities = pgTable(
  "ad_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** campaign | adset | ad */
    level: text("level").notNull(),
    /** Meta's own numeric id. */
    entityId: text("entity_id").notNull(),
    name: text("name").notNull().default(""),
    /** What the entity is set to. Writable. */
    status: text("status").notNull().default(""),
    /** What Meta computes from this entity plus its parents. Not writable. */
    effectiveStatus: text("effective_status").notNull().default(""),
    /** Empty at the level that has no such parent. */
    campaignId: text("campaign_id").notNull().default(""),
    adSetId: text("ad_set_id").notNull().default(""),
    /** Campaign only. */
    objective: text("objective").notNull().default(""),
    buyingType: text("buying_type").notNull().default(""),
    /** Ad sets carry these too when the budget sits at ad-set level. */
    bidStrategy: text("bid_strategy").notNull().default(""),
    billingEvent: text("billing_event").notNull().default(""),
    optimizationGoal: text("optimization_goal").notNull().default(""),
    /** Minor units of the account currency. Null where unset by Meta. */
    dailyBudgetMinor: numeric("daily_budget_minor", { precision: 20, scale: 0 }),
    lifetimeBudgetMinor: numeric("lifetime_budget_minor", {
      precision: 20,
      scale: 0,
    }),
    budgetRemainingMinor: numeric("budget_remaining_minor", {
      precision: 20,
      scale: 0,
    }),
    bidAmountMinor: numeric("bid_amount_minor", { precision: 20, scale: 0 }),
    /** The currency those minor units are in, copied from the account. */
    currency: text("currency").notNull().default(""),
    /** Stored whole: a proposal has to diff against all of it, not a summary. */
    targeting: jsonb("targeting").$type<Record<string, unknown>>(),
    /**
     * Stable hash of `targeting`, for change detection.
     *
     * Comparing the JSON directly is unreliable because Meta does not promise
     * key order, so an unchanged spec can serialize two ways.
     */
    targetingHash: text("targeting_hash").notNull().default(""),
    promotedObject: jsonb("promoted_object").$type<Record<string, unknown>>(),
    /**
     * All five carry a time zone, unlike most of this schema.
     *
     * A bare `timestamp` column round-trips through the driver as LOCAL time,
     * so a value stored as UTC reads back shifted by the reader's offset. On
     * Vercel that is invisible because the runtime is UTC; from a laptop in
     * Manila every one of these is eight hours out. Meta also returns its own
     * times with an offset (`+0800`), which a bare column would discard.
     *
     * Freshness is the reason this matters rather than being cosmetic: a
     * proposal built on a stale row is meant to be refused, and a staleness
     * check that is eight hours wrong cannot do that.
     */
    startTime: timestamp("start_time", { withTimezone: true }),
    /** Campaigns call this stop_time and ad sets call it end_time. */
    stopTime: timestamp("stop_time", { withTimezone: true }),
    /** Meta's own timestamps, not ours. */
    metaCreatedAt: timestamp("meta_created_at", { withTimezone: true }),
    metaUpdatedAt: timestamp("meta_updated_at", { withTimezone: true }),
    /** When we last read it. A proposal built on a stale row is refused. */
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ad_entity").on(t.connectionId, t.level, t.entityId),
    index("idx_ad_entity_brand_level").on(t.brandId, t.level, t.status),
    index("idx_ad_entity_campaign").on(t.connectionId, t.campaignId),
  ],
);

/**
 * Several changes decided together.
 *
 * `ad_actions` has a unique open key per entity, which is right for "pause this
 * ad" and wrong for "shift 20% from these four ad sets to those two". That is
 * one decision, not six, and approving it six times invites approving four of
 * them and wandering off.
 *
 * A set is never atomic and does not pretend to be. Meta has no transaction
 * across entities, so it applies action by action and each carries its own
 * outcome. `state` here is the roll-up, and `partial` is a real resting place
 * rather than a failure: some of it happened.
 *
 * The guardrails in force are copied onto the row at proposal time. They are
 * editable, and an audit that says "approved under the rules as they are now"
 * answers a different question from the one anyone asks afterwards.
 */
export const adChangeSets = pgTable(
  "ad_change_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** What this set is for, in the words shown to whoever approves it. */
    reason: text("reason").notNull().default(""),
    /** rule | user | agent */
    source: text("source").notNull().default("agent"),
    /** pending | approved | applying | done | partial | rejected | cancelled */
    state: text("state").notNull().default("pending"),
    proposedById: uuid("proposed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedById: uuid("decided_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Required to reject, so a refusal teaches the next pass something. */
    decision: text("decision").notNull().default(""),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The limits as they stood when this was proposed, not as they stand now. */
    guardrails: jsonb("guardrails").$type<Record<string, unknown>>().notNull().default({}),
    /** What the brain expects to happen, so the queue can be scored later. */
    expectation: text("expectation").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_change_set_brand_state").on(t.brandId, t.state, t.createdAt)],
);

export const adActionsRelations = relations(adActions, ({ one }) => ({
  brand: one(brands, { fields: [adActions.brandId], references: [brands.id] }),
  alert: one(adAlerts, { fields: [adActions.alertId], references: [adAlerts.id] }),
}));

export const adDraftsRelations = relations(adDrafts, ({ one }) => ({
  brand: one(brands, { fields: [adDrafts.brandId], references: [brands.id] }),
}));

export const adAnnotationsRelations = relations(adAnnotations, ({ one }) => ({
  connection: one(integrationConnections, {
    fields: [adAnnotations.connectionId],
    references: [integrationConnections.id],
  }),
  brand: one(brands, { fields: [adAnnotations.brandId], references: [brands.id] }),
}));

export const adNotesRelations = relations(adNotes, ({ one }) => ({
  brand: one(brands, { fields: [adNotes.brandId], references: [brands.id] }),
  author: one(users, { fields: [adNotes.authorId], references: [users.id] }),
}));

export const adRulesRelations = relations(adRules, ({ one }) => ({
  brand: one(brands, { fields: [adRules.brandId], references: [brands.id] }),
}));

export const adAlertsRelations = relations(adAlerts, ({ one }) => ({
  brand: one(brands, { fields: [adAlerts.brandId], references: [brands.id] }),
  rule: one(adRules, { fields: [adAlerts.ruleId], references: [adRules.id] }),
}));

// ---------------------------------------------------------------------------
// Organic social publishing (Meta Page + Instagram)
// ---------------------------------------------------------------------------
// Everything the agent writes lands here first. The agent has no tool that can
// reach Meta: `socialDraftPost` inserts a row and stops. A person publishing the
// row in /t/social-media/social is what calls the Graph API. The point is that
// the write path is a UI action by a named person, not a model decision.

// `approved` is legacy and is never written any more: it was the middle of a
// two-step publish that could leave a row stranded if the request died between
// the two updates. `publishing` replaces it and carries `claimed_at`, so a
// stalled row is visible and resumable instead of invisible and stuck.
//
// `scheduled` means META holds the post, not us. Facebook can schedule natively
// (published=false + scheduled_publish_time); Instagram cannot, and we run no
// timer of our own, so an Instagram post is published by hand on the day.
//
// New values are appended LAST: Postgres ALTER TYPE ... ADD VALUE appends, so
// any other order makes the next schema diff read as a change.
export const socialPostStatus = pgEnum("social_post_status", [
  "draft",
  "approved",
  "published",
  "failed",
  "publishing",
  "scheduled",
  "discarded",
]);

// Which surface(s) a draft targets. `both` cross-posts the same caption+media
// to the Page and to Instagram as two separate API calls, so one can succeed
// while the other fails — hence the two id columns and the partial-failure
// handling in publish.ts.
export const socialChannel = pgEnum("social_channel", [
  "instagram",
  "facebook",
  "both",
  // TikTok on its own: never part of a cross-post, so `both` keeps meaning
  // Instagram + Facebook. Appended LAST (see socialPostStatus).
  "tiktok",
]);

export const socialPostDrafts = pgTable(
  "social_post_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    // Which connection published it. Nullable + set null so deleting a
    // connection never destroys the record of what was posted.
    connectionId: uuid("connection_id").references(
      () => integrationConnections.id,
      { onDelete: "set null" },
    ),
    channel: socialChannel("channel").notNull().default("instagram"),
    // image | video | carousel | text. Text is Facebook-only; Instagram has no
    // media-less post, which publish.ts rejects before it calls anything.
    mediaType: text("media_type").notNull().default("image"),
    caption: text("caption").notNull().default(""),
    // Public https URLs. Meta FETCHES these from its own servers, so a blob
    // URL behind auth or a localhost URL fails at container creation with a
    // message that does not say why. Vercel Blob URLs are public and work.
    mediaUrls: jsonb("media_urls").$type<string[]>().notNull().default([]),
    linkUrl: text("link_url"),
    status: socialPostStatus("status").notNull().default("draft"),
    // Provenance. `createdById` is null and `agentDrafted` true when the agent
    // wrote it, so the queue can show a human reviewer where a draft came from.
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    agentDrafted: boolean("agent_drafted").notNull().default(false),
    rationale: text("rationale").notNull().default(""),
    approvedById: uuid("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at"),
    publishedAt: timestamp("published_at"),
    igMediaId: text("ig_media_id"),
    fbPostId: text("fb_post_id"),
    permalink: text("permalink"),
    error: text("error"),

    // When Meta will publish it. Facebook-native scheduling only, and only
    // while status is `scheduled`: we run no timer, so this is Meta's clock.
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    // A day the person means to post this, in `timezone`. A marker on the
    // calendar, not an instruction to anything: nothing acts on it.
    plannedFor: date("planned_for"),
    timezone: text("timezone").notNull().default("Asia/Manila"),

    // Publish bookkeeping. `claimedAt` is what makes a stalled `publishing`
    // row recoverable: past a threshold it can be claimed again.
    publishAttempts: integer("publish_attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    // An Instagram container survives a request that dies mid-publish. Stored
    // before we poll it, so a retry finishes the one in flight rather than
    // creating a second post.
    igContainerId: text("ig_container_id"),
    igContainerChildren: jsonb("ig_container_children")
      .$type<string[]>()
      .notNull()
      .default([]),

    firstComment: text("first_comment").notNull().default(""),
    firstCommentId: text("first_comment_id"),

    // TikTok publishing is asynchronous: the publish call returns a task id
    // and the post id arrives later. The task id is stored before anything
    // polls it, so a request that dies mid-publish resumes the task instead
    // of posting twice. See src/lib/integrations/tiktok_organic/publish.ts.
    ttPublishId: text("tt_publish_id"),
    ttPostId: text("tt_post_id"),
    // Disclosure + interaction settings TikTok requires per post
    // (TiktokPostOptions in src/lib/social/tiktok-rules.ts).
    tiktokOptions: jsonb("tiktok_options")
      .$type<Record<string, string | boolean>>()
      .notNull()
      .default({}),
    altText: text("alt_text").notNull().default(""),
    tags: text("tags").array().notNull().default([]),
    // Ties the rows one compose produced: the same post to several brands, or
    // the Facebook and Instagram halves of a scheduled cross-post.
    groupId: uuid("group_id"),

    // Soft delete. A discarded draft still says what someone decided not to
    // post, which the hard DELETE this replaces threw away.
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    lastEditedById: uuid("last_edited_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedById: uuid("published_by_id").references(() => users.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("social_drafts_brand_status_idx").on(t.brandId, t.status, t.createdAt),
    index("social_drafts_status_scheduled_idx").on(t.status, t.scheduledAt),
    index("social_drafts_brand_planned_idx").on(t.brandId, t.plannedFor),
    index("social_drafts_ig_media_idx").on(t.igMediaId),
    index("social_drafts_fb_post_idx").on(t.fbPostId),
    index("social_drafts_group_idx").on(t.groupId),
  ],
);

export const socialPostDraftsRelations = relations(socialPostDrafts, ({ one }) => ({
  brand: one(brands, {
    fields: [socialPostDrafts.brandId],
    references: [brands.id],
  }),
  connection: one(integrationConnections, {
    fields: [socialPostDrafts.connectionId],
    references: [integrationConnections.id],
  }),
  createdBy: one(users, {
    fields: [socialPostDrafts.createdById],
    references: [users.id],
  }),
  approvedBy: one(users, {
    fields: [socialPostDrafts.approvedById],
    references: [users.id],
  }),
  lastEditedBy: one(users, {
    fields: [socialPostDrafts.lastEditedById],
    references: [users.id],
  }),
  publishedBy: one(users, {
    fields: [socialPostDrafts.publishedById],
    references: [users.id],
  }),
}));

// ---------------------------------------------------------------------------
// CUSTOMSONG orders
//
// One row per song a customer bought. The task run holds the words and the
// lyric-video job holds the MP4; this table holds what neither of them knows:
// which SKU was paid for, how far through the two gates the order is, and what
// the customer finally approved.
//
// Additive by construction: nothing here is referenced by another team's table,
// and a row only ever appears after a Custom Song run has completed.
//
// `approvedLyrics` and `approvedStyleBox` are the capture corpus. The run output
// is what the model proposed; these two are what a human signed off after Gate 1,
// which is the only version worth learning from.
// ---------------------------------------------------------------------------

// ---- Merchant Center title overrides (src/lib/integrations/merchant_center/) ----
//
// A chat proposes a batch of new product titles; nothing reaches Google until an
// admin clicks Approve on the batch card. Applied titles live in a supplemental
// API data source ("Second Brain title overrides (API)") placed first in the
// feed's rule, so the XML feed still owns every other attribute. Status is text,
// not an enum, so a new state needs no migration.

/** A proposed set of title changes for one Merchant Center account. */
export const merchantTitleBatches = pgTable(
  "merchant_title_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(), // Merchant Center sub-account id
    // pending -> applying -> applied | partial | failed ; applied/partial -> reverted
    status: text("status").notNull().default("pending"),
    note: text("note"), // why these titles, as the chat put it
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    revertedBy: uuid("reverted_by").references(() => users.id, { onDelete: "set null" }),
    revertedAt: timestamp("reverted_at"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_merchant_title_batch_brand").on(t.brandId, t.createdAt)],
);

/** One product's title change inside a batch. */
export const merchantTitleChanges = pgTable(
  "merchant_title_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => merchantTitleBatches.id, { onDelete: "cascade" }),
    offerId: text("offer_id").notNull(),
    contentLanguage: text("content_language").notNull(),
    feedLabel: text("feed_label").notNull(),
    oldTitle: text("old_title").notNull(),
    newTitle: text("new_title").notNull(),
    // pending | applied | failed | reverted
    status: text("status").notNull().default("pending"),
    errorMessage: text("error_message"),
  },
  (t) => [index("idx_merchant_title_change_batch").on(t.batchId)],
);

/**
 * The override source we created in an account, and the feed rule exactly as
 * it was before we touched it, so removing the override restores it.
 */
export const merchantOverrideSources = pgTable(
  "merchant_override_sources",
  {
    accountId: text("account_id").notNull(),
    // An account can have several primary sources (TH has a Thai and an English
    // feed); each gets its own row and its own saved rule.
    primaryDataSourceName: text("primary_data_source_name").notNull(),
    dataSourceName: text("data_source_name").notNull(), // our supplemental source
    previousRule: jsonb("previous_rule").$type<unknown[]>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.primaryDataSourceName] })],
);

// ---- CMS changes from chat (src/lib/integrations/cms/) ----
//
// A chat reads the storefront CMS live, but every call that would change it is
// saved here first and drawn as a card; it reaches the CMS only when a person
// clicks Apply (an admin, for publishing). The CMS is reached through one shared
// account, so this table is also the only record of who asked for what.

/** One proposed CMS tool call and what happened to it. */
export const cmsChangeRequests = pgTable(
  "cms_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => integrationConnections.id, {
      onDelete: "set null",
    }),
    host: text("host").notNull(), // the storefront the call goes to, as it was proposed
    tenant: text("tenant").notNull(), // PH | SG | TH | VN
    tool: text("tool").notNull(), // the CMS's own tool name, e.g. product_create
    args: jsonb("args").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(), // one line for the card and the log
    note: text("note"), // why, as the chat put it
    // pending -> applying -> applied | failed ; pending -> rejected
    status: text("status").notNull().default("pending"),
    result: text("result"), // what the CMS answered
    errorMessage: text("error_message"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_cms_change_request_brand").on(t.brandId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Marketing Review (src/lib/reports/). Replaces the PH weekly, PH monthly and
// SG monthly report sheets. Everything here is additive: no existing table is
// read differently because of it.
// ---------------------------------------------------------------------------

/**
 * Daily figures by source and dimension. One row per brand, source, day and
 * dimension value; the numbers live in `m` because each source carries a
 * different set and none of them is summed across sources.
 *
 * Sources:
 *   orders          dim platform (web|android|ios)           from your commerce database
 *   orders_channel  dim channel (GA4 session channel | App)  replica x GA4 transactionId
 *   voucher         dim code                                 from your commerce database
 *   ga4_first_user  dim channel                              GA4 first-user channel
 *   ga4_session     dim channel                              GA4 session channel
 *   gsc             dim segment (branded|nonbranded)         Search Console via BigQuery
 *   social          dim channel (facebook|instagram|tiktok)  follower snapshots
 */
export const reportDaily = pgTable(
  "report_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD in the brand's own timezone
    dimKey: text("dim_key").notNull().default(""),
    m: jsonb("m").$type<Record<string, number>>().notNull().default({}),
    syncedAt: timestamp("synced_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_report_daily").on(t.brandId, t.source, t.date, t.dimKey),
    index("idx_report_daily_brand_date").on(t.brandId, t.date),
  ],
);

export type ReviewQuestion = {
  id: string;
  text: string;
  answer: string;
  /** The AI's first pass, kept so the edit is visible. */
  aiDraft?: string;
};

/** Each run of a reporting sync, for the freshness dots. */
export const reportSyncLog = pgTable(
  "report_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    status: text("status").notNull(), // ok | error | skipped
    windowStart: text("window_start"),
    windowEnd: text("window_end"),
    rows: integer("rows").notNull().default(0),
    message: text("message"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("idx_report_sync_log").on(t.source, t.startedAt)],
);

// ---------------------------------------------------------------------------
// Partnerships (src/lib/partners/). The Bloomly SG partner tracker: who we are
// talking to, how the last contact went, and what each live partner sells.
// Sales are not stored here: they are read from report_daily's voucher rows,
// matched to a partner by its code patterns.
// ---------------------------------------------------------------------------

/**
 * One organisation: a perks platform (KRIS+, Dive Deals), a school, a
 * preschool group, a company. Status moves forward on its own when a contact
 * is logged (prospect -> contacted -> talks); live, paused and declined are
 * set by hand.
 */
export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("other"), // platform | school | preschool | corporate | media | other
    status: text("status").notNull().default("prospect"), // prospect | contacted | talks | live | paused | declined
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    // Voucher codes that are this partner's sales, upper case, "*" matching
    // anything (KRIS*PLUS*, DIVEDEALS20).
    codes: jsonb("codes").$type<string[]>().notNull().default([]),
    website: text("website").notNull().default(""),
    // Deal terms and context: what they get, what we agreed.
    notes: text("notes").notNull().default(""),
    // A date someone asked us to come back on ("talk again in December").
    // Overrides the follow-up ladder while it is later than the last contact.
    followUpOn: text("follow_up_on"),
    statusChangedAt: timestamp("status_changed_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_partners_brand_name").on(t.brandId, t.name),
    index("idx_partners_status").on(t.brandId, t.status),
  ],
);

/** A person at a partner. A partner can have several; one is the primary. */
export const partnerContacts = pgTable(
  "partner_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    name: text("name").notNull().default(""),
    role: text("role").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_partner_contacts_partner").on(t.partnerId)],
);

/**
 * Every email, call, message or meeting, append-only. The follow-up ladder
 * reads only this: unanswered outreach since the last time they responded.
 */
export const partnerTouches = pgTable(
  "partner_touches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => partnerContacts.id, { onDelete: "set null" }),
    channel: text("channel").notNull(), // email | call | whatsapp | meeting
    // sent: we reached out and heard nothing (or the call went unanswered).
    // replied: they answered, or we spoke.
    outcome: text("outcome").notNull(),
    on: text("on").notNull(), // YYYY-MM-DD, Singapore
    note: text("note").notNull().default(""),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_partner_touches_partner").on(t.partnerId, t.on)],
);

// ---------------------------------------------------------------------------
// AI search visibility (the Evidence-Sorted Roadmap): which buyer prompts the
// AI assistants answer with us in them, and the 90-day cycles of fixes run
// against the gaps. Brand-scoped; Acme Florals is the first brand.
// ---------------------------------------------------------------------------

/** Per-brand settings: what counts as "us", and the facts an answer is checked against. */
export const aiSearchSettings = pgTable("ai_search_settings", {
  brandId: uuid("brand_id")
    .primaryKey()
    .references(() => brands.id, { onDelete: "cascade" }),
  // Lower-case names an answer may call us by, besides the domain.
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  // Our domains: a citation to any of them (or a subdomain) is a linked citation.
  domains: jsonb("domains").$type<string[]>().notNull().default([]),
  // Facts an answer about us must agree with. Empty = accuracy is not checked.
  facts: text("facts").notNull().default(""),
  // Days between runs of one prompt on one platform: 1 for the baseline, 7 after.
  cadenceDays: integer("cadence_days").notNull().default(1),
  platforms: jsonb("platforms").$type<string[]>().notNull().default(["chatgpt", "gemini", "claude"]),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** A buyer question we track, tagged by journey stage and topic. */
export const aiSearchPrompts = pgTable(
  "ai_search_prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    stage: text("stage").notNull(), // awareness | consideration | decision
    topic: text("topic").notNull(),
    // en | tl (Tagalog or Taglish). Twins of one question in both languages
    // share a topic, so the scorecard can compare them like for like.
    language: text("language").notNull().default("en"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_ai_search_prompts_brand_text").on(t.brandId, t.text)],
);

/**
 * One answer from one assistant to one prompt on one day. A failed call is
 * stored with `error` set and is never scored, so an outage reads as missing
 * data rather than as zero visibility.
 */
export const aiSearchRuns = pgTable(
  "ai_search_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => aiSearchPrompts.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // chatgpt | gemini | claude
    model: text("model").notNull(),
    runOn: text("run_on").notNull(), // YYYY-MM-DD, Manila
    answer: text("answer").notNull().default(""),
    appeared: boolean("appeared").notNull().default(false),
    recommended: boolean("recommended").notNull().default(false),
    cited: boolean("cited").notNull().default(false),
    // 1-based rank of our first mention among every brand the answer names.
    position: integer("position"),
    brands: jsonb("brands").$type<{ name: string; domain: string | null; recommended: boolean }[]>().notNull().default([]),
    citations: jsonb("citations").$type<{ url: string; domain: string; title: string }[]>().notNull().default([]),
    // null = not checked (we were not in the answer, or no facts are set).
    accuracyIssues: jsonb("accuracy_issues").$type<string[] | null>(),
    sentiment: text("sentiment"), // positive | neutral | negative
    judgeError: text("judge_error"),
    error: text("error"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_ai_search_runs_prompt_platform_day").on(t.promptId, t.platform, t.runOn),
    index("idx_ai_search_runs_brand_day").on(t.brandId, t.runOn),
  ],
);

/** A 90-day cycle: 15 days planning, two 30-day build blocks, 15 days re-testing. */
export const aiSearchCycles = pgTable(
  "ai_search_cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    startOn: text("start_on").notNull(), // YYYY-MM-DD
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_ai_search_cycles_brand_number").on(t.brandId, t.number)],
);

/** One fix: one hypothesis, one owner, one KPI, one re-test date. */
export const aiSearchActions = pgTable(
  "ai_search_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cycleId: uuid("cycle_id")
      .notNull()
      .references(() => aiSearchCycles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    hypothesis: text("hypothesis").notNull().default(""),
    topic: text("topic").notNull().default(""),
    readiness: text("readiness").notNull(), // one of the ten readiness traits
    tier: text("tier").notNull(), // do | only_if | good_to_have | parked
    impact: integer("impact").notNull().default(2),
    effort: integer("effort").notNull().default(2),
    block: integer("block").notNull().default(1), // 1 | 2
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    kpi: text("kpi").notNull().default(""),
    retestOn: text("retest_on").notNull(), // YYYY-MM-DD
    status: text("status").notNull().default("planned"), // planned | in_progress | shipped
    decision: text("decision"), // keep | expand | revise | stop
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_ai_search_actions_cycle").on(t.cycleId)],
);
