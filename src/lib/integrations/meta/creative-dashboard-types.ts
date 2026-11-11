// Client-safe constants + types for the Meta creative dashboards. This module
// imports NO database / server code so client components (dashboards-client,
// charts) can import the dashboard list, metric list and result types without
// pulling the DB into the browser bundle. The server-only query logic lives in
// creative-dashboards.ts, which re-exports everything here.

export const CREATIVE_DASHBOARDS = [
  {
    id: "win_rate",
    label: "Win-rate by category",
    blurb:
      "For each creative category (asset type, angle, hook, funnel stage), the share of ads beating your target, average performance and spend behind it.",
  },
  {
    id: "kill_scale",
    label: "Kill / Scale",
    blurb:
      "Ads to kill (under target, real spend) and scale (over target), segmented by TOF / MOF / BOF and ranked by spend.",
  },
  {
    id: "iteration",
    label: "Iteration priorities",
    blurb:
      "Underperformers ranked by the spend behind them — the creatives worth iterating first. Generate AI iteration ideas per ad.",
  },
] as const;

export type CreativeDashboardType = (typeof CREATIVE_DASHBOARDS)[number]["id"];

export const EVAL_METRICS = ["roas", "cpa", "ctr", "purchases"] as const;
export type EvalMetric = (typeof EVAL_METRICS)[number];

export type AdRow = {
  adId: string;
  adName: string;
  campaignName: string;
  mediaType: string;
  thumbnailUrl: string | null;
  assetType: string | null;
  messagingAngle: string | null;
  hookTactic: string | null;
  funnelStage: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpa: number | null;
  ctr: number; // percent
  metricValue: number | null; // value of the chosen metric
  isWinner: boolean;
};

export type Segment = {
  key: string;
  ads: number;
  winners: number;
  winRate: number; // 0-1
  avgMetric: number | null;
  spend: number;
};

export type WinRateResult = {
  type: "win_rate";
  currency: string;
  metric: EvalMetric;
  threshold: number;
  totalAds: number;
  dimensions: { dimension: string; label: string; segments: Segment[] }[];
};

export type KillScaleResult = {
  type: "kill_scale";
  currency: string;
  metric: EvalMetric;
  threshold: number;
  stages: { stage: string; kill: AdRow[]; scale: AdRow[] }[];
};

export type IterationResult = {
  type: "iteration";
  currency: string;
  metric: EvalMetric;
  threshold: number;
  underperformers: AdRow[];
};

export type CreativeDashboardResult =
  | WinRateResult
  | KillScaleResult
  | IterationResult;
