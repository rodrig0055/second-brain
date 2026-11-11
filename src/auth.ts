import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [Google],
  pages: { signIn: "/signin" },
  session: { strategy: "jwt" },
  callbacks: {
    // Allowlist: only emails that an admin has already added may sign in.
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const existing = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (!existing) return false;
      await db
        .update(users)
        .set({
          name: existing.name ?? user.name ?? null,
          image: user.image ?? existing.image,
        })
        .where(eq(users.id, existing.id));
      return true;
    },
    async jwt({ token, trigger }) {
      const email = token.email?.toLowerCase();
      if (email && (trigger === "signIn" || !token.userId)) {
        const dbUser = await db.query.users.findFirst({
          where: eq(users.email, email),
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.role = dbUser.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
        session.user.role = (token.role as "admin" | "member") ?? "member";
      }
      return session;
    },
  },
});
