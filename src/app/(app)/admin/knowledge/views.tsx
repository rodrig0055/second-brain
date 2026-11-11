import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { DocForm } from "./doc-form";
import { requireAdmin } from "@/lib/access";

/**
 * What the create and edit forms show, loaded once for both places they open:
 * the full page (a shared link, a refresh) and the side panel over the list.
 */

export async function newView() {
  await requireAdmin();
  return { title: "New knowledge doc", body: <DocForm /> };
}

export async function editView(id: string) {
  await requireAdmin();
  const doc = await db.query.knowledgeDocs.findFirst({ where: eq(knowledgeDocs.id, id) });
  if (!doc) notFound();
  return { title: `Edit: ${doc.title}`, body: <DocForm doc={doc} /> };
}

export const SHEET_WIDTH = 896;
