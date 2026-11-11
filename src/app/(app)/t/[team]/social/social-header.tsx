"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { PageHeader } from "@/components/page-header";
import { usePathname } from "next/navigation";
import { MessageSquare, Plus } from "lucide-react";

/**
 * One header row for every Social page: what this page is on the left, the
 * page's actions on the right.
 *
 * A client component because the title follows the URL and a layout does not
 * re-render on navigation. Create post is a plain link: from a Social page it
 * is intercepted into the side panel, and opened directly it is a full page.
 */

const PAGES: { suffix: string; title: string; description: string }[] = [
  { suffix: "/social/posts", title: "Posts", description: "Everything that went out, filterable." },
  { suffix: "/social/calendar", title: "Calendar", description: "Planned, scheduled and published, by day." },
  { suffix: "/social/drafts", title: "Drafts", description: "Written and waiting to go out." },
  { suffix: "/social/connections", title: "Connections", description: "The accounts each brand posts to." },
  { suffix: "/social/compose", title: "Create post", description: "Write once, for every brand you run." },
  { suffix: "/social", title: "Overview", description: "How each brand is doing, and what needs you." },
];

export function SocialHeader({ teamSlug }: { teamSlug: string }) {
  const pathname = usePathname();
  const page = PAGES.find((p) => pathname.endsWith(p.suffix)) ?? PAGES[PAGES.length - 1];
  const onCompose = pathname.endsWith("/social/compose");

  return (
    <PageHeader
      title={page.title}
      description={page.description}
      action={
        <>
          <Button
            label="Ask the agent"
            variant="secondary"
            icon={<Icon icon={MessageSquare} />}
            href={`/chat?team=${teamSlug}`}
          />
          {!onCompose && (
            <Button
              label="Create post"
              variant="primary"
              icon={<Icon icon={Plus} />}
              href={`/t/${teamSlug}/social/compose`}
              as={NoScrollLink}
            />
          )}
        </>
      }
    />
  );
}

/** Opening Create post over a Social page keeps the page where it was behind the side panel. */
function NoScrollLink(props: ComponentProps<typeof Link>) {
  return <Link {...props} scroll={false} />;
}
