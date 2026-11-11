import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (!req.auth && pathname !== "/signin") {
    return NextResponse.redirect(new URL("/signin", req.nextUrl));
  }
  if (req.auth && pathname === "/signin") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|api/cron|api/meta-insights|api/storefront/snapshot|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp)).*)",
  ],
};
