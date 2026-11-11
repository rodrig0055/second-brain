/**
 * What a KPI tile's number means, shown behind its info icon.
 *
 * The formulas follow the code that computes them (`lib/ads/metrics.ts` and the
 * performance marketing process doc it cites), not the platforms' defaults:
 * CIR here is spend over conversion value, which is not what Ads Manager calls
 * anything. Keys are tile labels, matched case-insensitively, so a tile gets
 * its definition without each caller repeating it.
 */
const DEFINITIONS: Record<string, string> = {
  spend: "What the ads cost in this period.",
  "ad spend": "What the ads cost in this period, across every connected ad platform.",
  "meta spend": "What the Meta ads cost in this period.",
  "google spend": "What the Google ads cost in this period.",
  purchases: "Purchases the ad platform attributes to the ads.",
  conversions: "Conversions Google Ads attributes to the ads.",
  value: "Conversion value: the order value the ad platform attributes to the ads.",
  revenue: "Order value in this period.",
  cir: "Cost to income ratio: spend ÷ conversion value, as a percentage. Lower is better; the team's headline metric.",
  "meta cir": "Meta spend ÷ Meta conversion value, as a percentage. Lower is better.",
  "google cir": "Google spend ÷ Google conversion value, as a percentage. Lower is better.",
  roas: "Return on ad spend: conversion value ÷ spend. CIR's reciprocal; higher is better.",
  "current roas": "Conversion value ÷ spend over the period, as the budgets stand.",
  "projected roas": "The ROAS if the same total spend moved toward the higher-ROAS campaigns and each kept its current return.",
  "roas / mer": "Blended return: all revenue ÷ all ad spend, across platforms.",
  cpa: "Cost per acquisition: spend ÷ purchases. Lower is better.",
  ctr: "Click-through rate: clicks ÷ impressions. Meta counts outbound clicks only, the clicks that left Meta.",
  aov: "Average order value: conversion value ÷ purchases.",
  "avg order value": "Average order value: revenue ÷ orders.",
  orders: "Orders placed in this period.",
  "new customers": "Customers whose first order falls in this period.",
  "blended cac": "Blended customer acquisition cost: (ad spend + voucher cost) ÷ new customers.",
  "voucher cost": "The discount given away through voucher codes in this period.",
  followers: "Followers at the end of the period.",
  gained: "New followers in this period, before unfollows.",
  reach: "Accounts that saw a post, summed day by day, so one person on two days counts twice.",
  "page views": "Views of the Facebook Page in this period.",
  posts: "Posts published in this period.",
  "email open rate": "Opens ÷ emails delivered.",
  "email click rate": "Clicks ÷ emails delivered.",
  users: "Website users Google Analytics counted in this period.",
  "marketing cost": "Ad spend + voucher cost, in USD at the month's rate (Inputs).",
  "orders with a voucher": "Share of orders that used a voucher code.",
  "app share of orders": "Share of orders placed in the app.",
  "ga4 purchases": "Purchases Google Analytics recorded on the site and app.",
  "ga4 revenue": "Purchase revenue Google Analytics recorded.",
  sessions: "Website sessions Google Analytics counted in this period.",
};

/** The definition for a tile label, if the glossary has one. */
export function metricDefinition(label: string): string | undefined {
  return DEFINITIONS[label.trim().toLowerCase()];
}
