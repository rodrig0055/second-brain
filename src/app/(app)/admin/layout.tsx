import { requireAdmin } from "@/lib/access";
import { RouteHeader } from "@/components/route-header";
import { ADMIN_SECTIONS } from "./sections";

/**
 * Settings. Its sections are in the sidebar (Settings drills down like a
 * workspace), so this draws only the page header for the section you are on.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <RouteHeader
        entries={ADMIN_SECTIONS.map((s) => ({
          href: s.href,
          title: s.label,
          description: s.description,
          ownHeader: s.ownHeader,
        }))}
      />
      {children}
    </div>
  );
}
