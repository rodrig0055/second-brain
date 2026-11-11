import {
  Activity,
  BookOpen,
  BrainCircuit,
  Building2,
  CalendarDays,
  Clock,
  FlaskConical,
  Gauge,
  Image as ImageIcon,
  Inbox,
  Lightbulb,
  ListChecks,
  Plug,
  Swords,
  Users,
} from "lucide-react";

/**
 * The Settings sections: the sidebar while you are in /admin, and the page
 * header for each. One list so the two never drift.
 *
 * `group: "system"` sits under a divider: plumbing you check rather than
 * content you edit.
 */
export type AdminSection = {
  href: string;
  label: string;
  icon: typeof Users;
  description: string;
  /** Active only on this exact path, because another section lives under it. */
  exact?: boolean;
  group?: "system";
  /** The page draws its own header, because it has actions. */
  ownHeader?: boolean;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  { href: "/admin/users", label: "Users & access", icon: Users, description: "Who can sign in, and which teams and brands they see." },
  { href: "/admin/teams", label: "Teams", icon: Building2, description: "Teams and the departments they belong to." },
  { href: "/admin/templates", label: "Task templates", icon: ListChecks, description: "Reusable tasks each team can run." },
  { href: "/admin/knowledge", label: "Knowledge", icon: BookOpen, description: "What the agents know: master prompt, brand voice, playbooks." },
  { href: "/admin/proposals", label: "Proposals", icon: Lightbulb, description: "Changes the agents suggest, waiting for a decision." },
  { href: "/admin/loops", label: "Research loops", icon: FlaskConical, description: "Open questions the brain is testing over time." },
  { href: "/admin/wiki/pending", label: "Lesson review", icon: Inbox, description: "Lessons the agents drafted, to approve or reject." },
  { href: "/admin/wiki", label: "Wiki activity", icon: BrainCircuit, description: "What changed in the knowledge base, and why.", exact: true },
  { href: "/admin/competitors", label: "Competitors", icon: Swords, description: "Who each brand competes with, for the agents to reference." },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays, description: "Campaign dates and occasions the agents plan around." },
  { href: "/admin/assets", label: "Brand assets", icon: ImageIcon, description: "Logos and reference images for image generation." },
  { href: "/admin/schedules", label: "Schedules", icon: Clock, description: "Tasks that run on their own, and when." },
  { href: "/admin/integrations", label: "Integrations", icon: Plug, description: "", group: "system", ownHeader: true },
  { href: "/admin/health", label: "Data health", icon: Activity, description: "Whether each sync is fresh and complete.", group: "system" },
  { href: "/admin/usage", label: "Usage & cost", icon: Gauge, description: "Model usage and spend, by person and team.", group: "system" },
];
