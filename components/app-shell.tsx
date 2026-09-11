"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import {
  BarChart3Icon,
  BookOpenIcon,
  CalendarIcon,
  CheckSquareIcon,
  CompassIcon,
  DatabaseIcon,
  InboxIcon,
  KanbanSquareIcon,
  LanguagesIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  MessageSquareIcon,
  OctagonXIcon,
  PackageIcon,
  SettingsIcon,
  TrendingUpIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type NavKey = "dashboard" | "chat" | "approvals" | "tasks" | "products" | "inbox" | "pipeline" | "reports" | "content" | "data" | "knowledge" | "settings";
type GroupKey = "daily" | "commercial" | "knowledge" | "admin";

interface NavItem {
  href: string;
  key: NavKey;
  icon: LucideIcon;
  /** Attention-queue key whose count is shown next to the item. */
  countKey?: "pendingApprovals" | "openMessages";
}

/** Navigation grouped by how often the owner reaches for it: daily queues first, administration last. */
const NAV_GROUPS: { key: GroupKey; items: NavItem[] }[] = [
  {
    key: "daily",
    items: [
      { href: "/dashboard", key: "dashboard", icon: LayoutDashboardIcon },
      { href: "/chat", key: "chat", icon: MessageSquareIcon },
      { href: "/approvals", key: "approvals", icon: CheckSquareIcon, countKey: "pendingApprovals" },
      { href: "/inbox", key: "inbox", icon: InboxIcon, countKey: "openMessages" },
      { href: "/tasks", key: "tasks", icon: KanbanSquareIcon },
    ],
  },
  {
    key: "commercial",
    items: [
      { href: "/products", key: "products", icon: PackageIcon },
      { href: "/pipeline", key: "pipeline", icon: TrendingUpIcon },
      { href: "/content", key: "content", icon: CalendarIcon },
    ],
  },
  {
    key: "knowledge",
    items: [
      { href: "/data", key: "data", icon: DatabaseIcon },
      { href: "/knowledge", key: "knowledge", icon: BookOpenIcon },
      { href: "/reports", key: "reports", icon: BarChart3Icon },
    ],
  },
  { key: "admin", items: [{ href: "/settings", key: "settings", icon: SettingsIcon }] },
];

/** Bottom bar on phones: the four daily queues plus "more" (opens the full menu). */
const MOBILE_NAV: NavItem[] = NAV_GROUPS[0].items.slice(0, 4);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useT();
  const { signOut } = useAuthActions();
  const me = useQuery(api.settings.me);
  const attention = useQuery(api.settings.attention);
  const emergency = useQuery(api.tasks.emergencyStatus);
  const [menuOpen, setMenuOpen] = useState(false);

  const counts: Partial<Record<NonNullable<NavItem["countKey"]>, number>> = {};
  for (const item of attention?.items ?? []) {
    if (item.key === "pendingApprovals" || item.key === "openMessages") counts[item.key] = item.count;
  }
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const navList = (onNavigate?: () => void) => (
    <nav aria-label={t.common.menu} className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.key}>
          <div className="mb-1 px-3 text-xs font-medium text-hint">{t.navGroups[group.key]}</div>
          <ul className="space-y-0.5">
            {group.items.map(({ href, key, icon: Icon, countKey }) => {
              const active = isActive(href);
              const count = countKey ? counts[countKey] ?? 0 : 0;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                      active && "bg-primary-soft font-medium text-primary-text before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-primary",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                    <span className="flex-1 truncate">{t.nav[key]}</span>
                    {count > 0 && (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums" aria-label={`${count}`}>
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const userBlock = (
    <div className="border-t border-sidebar-border p-3">
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-text" aria-hidden>
          {(me?.name ?? me?.email ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{me?.name ?? me?.email ?? "…"}</div>
          <div className="truncate text-xs text-muted-foreground">{me?.role === "owner" ? t.common.owner : me ? t.common.staff : ""}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label={t.common.language}>
          <LanguagesIcon data-icon="inline-start" /> {locale === "ar" ? "English" : "العربية"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOutIcon data-icon="inline-start" /> {t.common.signOut}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded-lg bg-card px-3 py-2 text-sm shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:start-2">
        {t.common.skipToContent}
      </a>

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-dvh">
        <Brand className="h-16 border-b border-sidebar-border px-4" />
        {navList()}
        {userBlock}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur supports-backdrop-filter:bg-background/80 md:h-16 md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label={t.common.menu} onClick={() => setMenuOpen(true)}>
            <MenuIcon />
          </Button>
          <Brand className="md:hidden" compact />
          <div className="flex-1" />
          <EmergencyControl active={!!emergency?.active} />
          <NotificationBell />
        </header>

        {emergency?.active && (
          <div role="status" className="flex items-center justify-center gap-2 border-b border-destructive/30 bg-destructive-soft px-4 py-2 text-center text-sm text-destructive-text">
            <OctagonXIcon className="size-4 shrink-0" aria-hidden />
            {t.chat.emergencyActive}
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-[1600px] flex-1 overflow-x-hidden p-4 pb-24 md:p-6 md:pb-6 lg:p-8">
          {children}
        </main>

        {/* Phone bottom bar */}
        <nav aria-label={t.common.menu} className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
          {MOBILE_NAV.map(({ href, key, icon: Icon, countKey }) => {
            const active = isActive(href);
            const count = countKey ? counts[countKey] ?? 0 : 0;
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("relative flex min-h-14 flex-col items-center justify-center gap-1 text-xs", active ? "font-medium text-primary-text" : "text-muted-foreground")}>
                <Icon className="size-5" aria-hidden />
                <span className="truncate px-1">{t.nav[key]}</span>
                {count > 0 && <span className="absolute top-1.5 end-[calc(50%-1.25rem)] h-[18px] min-w-[18px] rounded-full bg-primary px-1 text-center text-xs font-semibold leading-[18px] text-primary-foreground tabular-nums">{count > 99 ? "99+" : count}</span>}
              </Link>
            );
          })}
          <button type="button" onClick={() => setMenuOpen(true)} className="flex min-h-14 flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <MenuIcon className="size-5" aria-hidden />
            <span>{t.nav.more}</span>
          </button>
        </nav>
      </div>

      {/* Phone drawer with the full grouped menu */}
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent className="inset-y-0 top-0 flex h-dvh w-[min(20rem,88vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-sidebar p-0 ltr:left-0 rtl:right-0 rtl:left-auto data-open:zoom-in-100 data-closed:zoom-out-100 md:hidden">
          <DialogHeader className="border-b border-sidebar-border px-4 py-3">
            <DialogTitle className="sr-only">{t.common.menu}</DialogTitle>
            <DialogDescription className="sr-only">{t.appName}</DialogDescription>
            <Brand />
          </DialogHeader>
          {navList(() => setMenuOpen(false))}
          {userBlock}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Brand({ className, compact }: { className?: string; compact?: boolean }) {
  const { t } = useT();
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
        <CompassIcon className="size-4" />
      </span>
      <span className={cn("font-heading font-semibold", compact ? "text-sm" : "text-base")}>{t.appName}</span>
    </div>
  );
}

/**
 * Emergency stop lives in the header as the one always-visible safety control.
 * Idle: a quiet outline button (icon-only on phones). Active: a soft destructive
 * pill that resumes on click; the banner under the header repeats the state.
 */
function EmergencyControl({ active }: { active: boolean }) {
  const { t } = useT();
  const activate = useMutation(api.tasks.activateEmergencyStop);
  const deactivate = useMutation(api.tasks.deactivateEmergencyStop);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirmStopAll() {
    setBusy(true);
    try {
      const n = await activate({ reason });
      toast.warning(`أُوقفت ${n} مهمة وتعطّل بدء مهام جديدة`);
      setOpen(false);
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.error);
    } finally {
      setBusy(false);
    }
  }

  if (active) {
    return (
      <Button variant="destructive" size="sm" onClick={() => deactivate().then(() => toast.success("أُعيد تفعيل الوكلاء"))}>
        <OctagonXIcon data-icon="inline-start" />
        {t.chat.resumeAll}
      </Button>
    );
  }
  return (
    <>
      <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={() => setOpen(true)}>
        <OctagonXIcon data-icon="inline-start" className="text-destructive" />
        {t.chat.stopAll}
      </Button>
      <Button variant="outline" size="icon-sm" className="sm:hidden" aria-label={t.chat.stopAll} onClick={() => setOpen(true)}>
        <OctagonXIcon className="text-destructive" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.chat.stopAll}</DialogTitle>
            <DialogDescription>{t.chat.confirmStopAll}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="stop-reason">{t.common.reason}</Label>
            <Input id="stop-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={confirmStopAll} disabled={busy}>
              {t.common.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
