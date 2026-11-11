import {
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardCheck,
  Files,
  Image as ImageIcon,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Mail,
  GitPullRequestArrow,
  Handshake,
  Megaphone,
  MessageSquareText,
  Milestone,
  Sparkles,
  PenSquare,
  PlugZap,
  Presentation,
  Send,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import type { TabIcon as TabIconName } from "@/lib/workspaces";

/**
 * Icon names to icons. The registry stores names because a component cannot
 * cross the server/client boundary and that module is read from both sides.
 */
export const TAB_ICONS: Record<TabIconName, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  tasks: ListChecks,
  outputs: Files,
  dashboards: BarChart3,
  ads: Megaphone,
  performance: Table2,
  creatives: ImageIcon,
  ideate: Lightbulb,
  alerts: Bell,
  social: Send,
  posts: Table2,
  compose: PenSquare,
  calendar: CalendarDays,
  drafts: Files,
  campaigns: Mail,
  leads: Users,
  changes: GitPullRequestArrow,
  connections: PlugZap,
  scorecard: ClipboardCheck,
  customers: UserPlus,
  meetings: Presentation,
  inputs: SlidersHorizontal,
  partners: Handshake,
  sales: TrendingUp,
  "ai-search": Sparkles,
  prompts: MessageSquareText,
  roadmap: Milestone,
};

export function TabIcon({ name, className = "size-4" }: { name: TabIconName; className?: string }) {
  const Icon = TAB_ICONS[name] ?? LayoutDashboard;
  return <Icon className={className} />;
}
