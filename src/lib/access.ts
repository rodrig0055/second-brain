import { redirect, notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  brands,
  departments,
  teams,
  users,
  userBrandAccess,
  userTeamAccess,
} from "@/db/schema";

export type DbUser = typeof users.$inferSelect;
export type DbDepartment = typeof departments.$inferSelect;
export type DbTeam = typeof teams.$inferSelect & { department: DbDepartment };
export type DbBrand = typeof brands.$inferSelect;

export class AccessError extends Error {
  constructor(
    public status: 401 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

/** Session + fresh DB row (so removing a user from the allowlist revokes access immediately). */
async function sessionUser(): Promise<DbUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  });
  return user ?? null;
}

async function teamAccess(user: DbUser, teamSlug: string) {
  const team = await db.query.teams.findFirst({
    where: eq(teams.slug, teamSlug),
    with: { department: true },
  });
  if (!team) return { team: null, allowed: false };
  if (user.role === "admin") return { team, allowed: true };
  const grant = await db.query.userTeamAccess.findFirst({
    where: and(
      eq(userTeamAccess.userId, user.id),
      eq(userTeamAccess.teamId, team.id),
    ),
  });
  return { team, allowed: !!grant };
}

async function brandAccess(user: DbUser, brandId: string) {
  const brand = await db.query.brands.findFirst({
    where: eq(brands.id, brandId),
  });
  if (!brand) return { brand: null, allowed: false };
  if (user.role === "admin") return { brand, allowed: true };
  const grant = await db.query.userBrandAccess.findFirst({
    where: and(
      eq(userBrandAccess.userId, user.id),
      eq(userBrandAccess.brandId, brand.id),
    ),
  });
  return { brand, allowed: !!grant };
}

// ---- Page / server-action helpers (redirect or 404) ----

export async function requireUser(): Promise<DbUser> {
  const user = await sessionUser();
  if (!user) redirect("/signin");
  return user;
}

export async function requireAdmin(): Promise<DbUser> {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}

export async function requireTeam(
  teamSlug: string,
): Promise<{ user: DbUser; team: DbTeam }> {
  const user = await requireUser();
  const { team, allowed } = await teamAccess(user, teamSlug);
  if (!team || !allowed) notFound();
  return { user, team };
}

export async function requireBrand(
  brandId: string,
): Promise<{ user: DbUser; brand: DbBrand }> {
  const user = await requireUser();
  const { brand, allowed } = await brandAccess(user, brandId);
  if (!brand || !allowed) notFound();
  return { user, brand };
}

// ---- API route helpers (throw AccessError; routes convert to JSON status) ----

export async function apiUser(): Promise<DbUser> {
  const user = await sessionUser();
  if (!user) throw new AccessError(401, "Not signed in");
  return user;
}

export async function apiTeam(
  teamSlug: string,
): Promise<{ user: DbUser; team: DbTeam }> {
  const user = await apiUser();
  const { team, allowed } = await teamAccess(user, teamSlug);
  if (!team) throw new AccessError(404, "Team not found");
  if (!allowed) throw new AccessError(403, "No access to this team");
  return { user, team };
}

export async function apiBrand(
  brandId: string,
): Promise<{ user: DbUser; brand: DbBrand }> {
  const user = await apiUser();
  const { brand, allowed } = await brandAccess(user, brandId);
  if (!brand) throw new AccessError(404, "Brand not found");
  if (!allowed) throw new AccessError(403, "No access to this brand");
  return { user, brand };
}

export function accessErrorResponse(err: unknown): Response | null {
  if (err instanceof AccessError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}

/** Teams visible to a user — drives nav and the dashboard. Admins see all. */
export async function getUserTeams(user: DbUser): Promise<DbTeam[]> {
  if (user.role === "admin") {
    return db.query.teams.findMany({
      with: { department: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    });
  }
  const grants = await db.query.userTeamAccess.findMany({
    where: eq(userTeamAccess.userId, user.id),
  });
  if (grants.length === 0) return [];
  return db.query.teams.findMany({
    where: inArray(
      teams.id,
      grants.map((g) => g.teamId),
    ),
    with: { department: true },
    orderBy: (t, { asc }) => [asc(t.name)],
  });
}

/** All departments, alphabetical — drives nav grouping and admin management. */
export async function getDepartments(): Promise<DbDepartment[]> {
  return db.query.departments.findMany({
    orderBy: (d, { asc }) => [asc(d.name)],
  });
}

/** Brands visible to a user — drives the brand selectors. Admins see all. */
export async function getUserBrands(user: DbUser): Promise<DbBrand[]> {
  if (user.role === "admin") {
    return db.query.brands.findMany({
      orderBy: (b, { asc }) => [asc(b.name)],
    });
  }
  const grants = await db.query.userBrandAccess.findMany({
    where: eq(userBrandAccess.userId, user.id),
  });
  if (grants.length === 0) return [];
  return db.query.brands.findMany({
    where: inArray(
      brands.id,
      grants.map((g) => g.brandId),
    ),
    orderBy: (b, { asc }) => [asc(b.name)],
  });
}
