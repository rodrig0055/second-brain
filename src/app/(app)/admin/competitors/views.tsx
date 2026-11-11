import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { competitors } from "@/db/schema";
import { CompetitorForm } from "./competitor-form";
import { requireAdmin } from "@/lib/access";

/**
 * What the create and edit forms show, loaded once for both places they open:
 * the full page (a shared link, a refresh) and the side panel over the list.
 */

export async function newView() {
  await requireAdmin();
  return { title: "New competitor", body: <CompetitorForm /> };
}

export async function editView(id: string) {
  await requireAdmin();
  const competitor = await db.query.competitors.findFirst({ where: eq(competitors.id, id) });
  if (!competitor) notFound();
  return { title: `Edit: ${competitor.name}`, body: <CompetitorForm competitor={competitor} /> };
}

export const SHEET_WIDTH = 768;
