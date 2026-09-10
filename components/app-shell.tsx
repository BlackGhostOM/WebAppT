"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import {
  BellIcon,
  BookOpenIcon,
  CalendarIcon,
  CheckSquareIcon,
  DatabaseIcon,
  InboxIcon,
  KanbanSquareIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MessageSquareIcon,
  OctagonXIcon,
  PackageIcon,
  SettingsIcon,
  TrendingUpIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboardIcon },
  { href: "/chat", key: "chat", icon: MessageSquareIcon },
  { href: "/approvals", key: "approvals", icon: CheckSquareIcon },
  { href: "/tasks", key: "tasks", icon: KanbanSquareIcon },
  { href: "/products", key: "products", icon: PackageIcon },
  { href: "/inbox", key: "inbox", icon: InboxIcon },
  { href: "/pipeline", key: "pipeline", icon: TrendingUpIcon },
  { href: "/content", key: "content", icon: CalendarIcon },
  { href: "/data", key: "data", icon: DatabaseIcon },
  { href: "/knowledge", key: "knowledge", icon: BookOpenIcon },
  { href: "/settings", key: "settings", icon: SettingsIcon },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useT();
  const { signOut } = useAuthActions();
  const me = useQuery(api.settings.me);
  const pending = useQuery(api.approvals.pending);
  const emergency = useQuery(api.tasks.emergencyStatus);
  const notifications = useQuery(api.settings.notifications);
  const activate = useMutation(api.tasks.activateEmergencyStop);
  const deactivate = useMutation(api.tasks.deactivateEmergencyStop);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopReason, setStopReason] = useState("");

  async function confirmStopAll() {
    try {
      const n = await activate({ reason: stopReason });
      toast.warning(`أُوقفت ${n} مهمة وتعطّل بدء مهام جديدة`);
      setStopOpen(false);
      setStopReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.error);
    }
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-e bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4 font-heading text-base font-semibold">{t.appName}</div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV.map(({ href, key, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            const count = key === "approvals" ? pending?.length ?? 0 : 0;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                <span className="flex-1">{t.nav[key]}</span>
                {count > 0 && <Badge variant="destructive">{count}</Badge>}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3 text-xs text-muted-foreground">
          <div className="truncate" dir="ltr">
            {me?.email}
          </div>
          <div>{me?.role === "owner" ? "المالك" : "موظف"}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b bg-background px-4">
          <div className="flex-1 truncate text-sm font-medium md:hidden">{t.appName}</div>
          <div className="hidden flex-1 md:block" />
          {emergency?.active ? (
            <Button variant="destructive" size="sm" onClick={() => deactivate().then(() => toast.success("أُعيد تفعيل الوكلاء"))}>
              <OctagonXIcon data-icon="inline-start" />
              {t.chat.resumeAll}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setStopOpen(true)}>
              <OctagonXIcon data-icon="inline-start" className="text-destructive" />
              {t.chat.stopAll}
            </Button>
          )}
          <Link href="/settings?tab=governance" className="relative inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted" aria-label={t.dashboard.notifications}>
            <BellIcon className="size-4" />
            {notifications && notifications.length > 0 && <span className="absolute -top-0.5 -end-0.5 size-2 rounded-full bg-destructive" />}
          </Link>
          <Button variant="ghost" size="sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
            {locale === "ar" ? "EN" : "ع"}
          </Button>
          <Button variant="ghost" size="icon" aria-label={t.common.signOut} onClick={() => void signOut()}>
            <LogOutIcon />
          </Button>
        </header>
        {emergency?.active && <div className="bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">{t.chat.emergencyActive}</div>}
        <main className="flex-1 overflow-x-hidden p-4 md:p-6">{children}</main>
        <nav className="flex items-center justify-around border-t bg-background p-1 md:hidden">
          {NAV.slice(0, 5).map(({ href, key, icon: Icon }) => (
            <Link key={href} href={href} className={cn("flex flex-col items-center gap-0.5 rounded-md p-2 text-[10px]", pathname.startsWith(href) && "text-primary")}>
              <Icon className="size-4" />
              {t.nav[key]}
            </Link>
          ))}
        </nav>
      </div>
      <Dialog open={stopOpen} onOpenChange={setStopOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.chat.stopAll}</DialogTitle>
            <DialogDescription>{t.chat.confirmStopAll}</DialogDescription>
          </DialogHeader>
          <Input placeholder={t.common.reason} value={stopReason} onChange={(e) => setStopReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button variant="destructive" onClick={confirmStopAll}>
              {t.common.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
