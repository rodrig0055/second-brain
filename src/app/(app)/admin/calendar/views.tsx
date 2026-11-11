import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { calendarEvents } from "@/db/schema";
import { EventForm } from "./event-form";
import { requireAdmin } from "@/lib/access";

/**
 * What the create and edit forms show, loaded once for both places they open:
 * the full page (a shared link, a refresh) and the side panel over the list.
 */

export async function newView() {
  await requireAdmin();
  return { title: "New calendar event", body: <EventForm /> };
}

export async function editView(id: string) {
  await requireAdmin();
  const event = await db.query.calendarEvents.findFirst({ where: eq(calendarEvents.id, id) });
  if (!event) notFound();
  return { title: `Edit: ${event.name}`, body: <EventForm event={event} /> };
}

export const SHEET_WIDTH = 768;
