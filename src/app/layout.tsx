// CSS order matters: layers.css declares the cascade-layer order and must be the first stylesheet,
// then globals.css, then anything that imports Astryx or theme CSS (AstryxRoot does).
import "./layers.css";
import "./globals.css";
import "./stylex.css";
import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { AstryxRoot } from "@/components/astryx-root";

// The theme's body and heading face (src/themes/brain/brainTheme.ts reads --font-figtree).
// Astryx never loads fonts; next/font self-hosts it, so there is no runtime Google Fonts call.
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Second Brain",
  description: "AI workspace for our brands & teams",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${figtree.variable} h-full antialiased`}>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla) inject body attributes before React hydrates */}
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-zinc-50 text-zinc-900"
      >
        <AstryxRoot>{children}</AstryxRoot>
        <Analytics />
      </body>
    </html>
  );
}
