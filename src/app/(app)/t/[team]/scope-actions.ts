"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { requireTeam } from "@/lib/access";
import { brandsWithConnections } from "@/lib/brand-scope";
import {
  applySelection,
  encodeScopeValue,
  parseScopeValue,
  safeReturnTo,
  scopeCookieName,
  withQuery,
} from "@/lib/brand-scope-params";
import { workspaceFor, workspaceHome } from "@/lib/workspaces";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days

/**
 * The only place the brand scope cookie is written.
 *
 * Render cannot set a cookie (headers are gone once streaming starts), and a
 * GET link cannot either, so the chips are submit buttons in a form. The action
 * writes the cookie and then redirects to the same page carrying `?brands=`, so
 * the URL and the cookie never disagree and the result is still shareable.
 *
 * Everything in the form is client-supplied, so the team is re-authorised and
 * the brands are re-checked against this user's own grants.
 */
export async function setBrandScope(formData: FormData): Promise<void> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const raw = String(formData.get("brands") ?? "");
  const requestedReturn = String(formData.get("returnTo") ?? "");

  const { user, team } = await requireTeam(teamSlug);
  const fallback = workspaceHome(team.slug);
  const returnTo = safeReturnTo(team.slug, requestedReturn, fallback);

  const platforms = workspaceFor(team.slug).scopePlatforms ?? [];
  const { brands: all } = await brandsWithConnections(user, platforms);

  const selection = parseScopeValue(raw);
  const chosen = selection ? applySelection(all, selection, true) : null;

  // A selection that resolves to nothing this user can see is ignored rather
  // than stored, so a stale or hand-edited value cannot wedge the surface.
  if (!chosen?.length) redirect(returnTo);

  const isAll = chosen.length === all.length;
  const value = encodeScopeValue(
    isAll ? { all: true } : { all: false, slugs: chosen.map((b) => b.slug) },
  );

  const store = await cookies();
  store.set({
    name: scopeCookieName(team.slug),
    value,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_SECONDS,
  });

  // Outside any try/catch: redirect() works by throwing.
  redirect(withQuery(returnTo, {}, { brands: value }));
}
