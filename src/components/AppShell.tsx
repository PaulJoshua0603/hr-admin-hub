"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import NotificationBell from "@/components/NotificationBell";
import ProfileCard from "@/components/ProfileCard";
import PageTransition from "@/components/PageTransition";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/authContext";
import {
  CalendarIcon,
  DashboardIcon,
  EmployeesIcon,
  FilesIcon,
  LogoutIcon,
  ReportsIcon,
  SearchIcon,
  TasksIcon,
} from "@/components/icons";

function HeaderClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  const dateStr = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="hidden shrink-0 flex-col items-end leading-tight lg:flex">
      <span className="text-sm font-medium text-ink">{timeStr}</span>
      <span className="text-[11px] text-ink-muted">{dateStr}</span>
    </div>
  );
}

const NAV = [
  { href: "/", label: "Dashboard", icon: DashboardIcon },
  { href: "/tasks", label: "Tasks & Notes", icon: TasksIcon },
  { href: "/employees", label: "Employees", icon: EmployeesIcon },
  { href: "/reports", label: "Reports", icon: ReportsIcon },
  { href: "/calendar", label: "Calendar", icon: CalendarIcon },
  { href: "/files", label: "Files", icon: FilesIcon },
];

const PUBLIC_ROUTES = ["/login", "/register", "/forgot-password", "/reset-password"];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublicRoute = pathname ? PUBLIC_ROUTES.includes(pathname) : false;

  if (isPublicRoute) {
    return <>{children}</>;
  }

  return <ProtectedShell>{children}</ProtectedShell>;
}

function ProtectedShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, configured, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (configured && !loading && !user) {
      router.replace("/login");
    }
  }, [configured, loading, user, router]);

  if (configured && loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background dark:bg-[#0B1112]">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin-slow rounded-full border-2 border-accent-soft border-t-accent" />
          <p className="text-sm text-ink-muted">Loading your workspace…</p>
        </div>
      </div>
    );
  }

  if (configured && !user) {
    return null;
  }

  return (
    <div className="flex min-h-dvh items-stretch justify-center bg-background p-0 dark:bg-[#0B1112]">
      <div className="flex h-dvh w-full min-w-0 overflow-hidden bg-background">
        <aside className="hidden md:flex h-full w-56 shrink-0 flex-col border-r border-border bg-surface py-5 lg:w-64">
          <div className="mb-6 flex items-center gap-2.5 px-4 lg:px-5">
            <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full shadow-sm">
              <Image src="/logo.png" alt="HR Admin Hub" fill sizes="40px" className="object-cover" priority />
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-base leading-tight text-ink">HR Admin Hub</p>
              <p className="mt-0.5 truncate text-[11px] text-ink-muted">Onboarding &amp; day-to-day ops</p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 lg:px-5">
            <div>
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-ink-muted/70">
                Menu
              </p>
              <nav className="flex flex-col gap-1">
                {NAV.map((item) => {
                  const active =
                    item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group relative flex items-center gap-2.5 overflow-hidden rounded-xl px-3 py-2.5 text-sm transition-all duration-200 ${
                        active
                          ? "bg-accent font-medium text-white shadow-md shadow-accent/25"
                          : "text-ink-muted hover:translate-x-0.5 hover:bg-background hover:text-ink"
                      }`}
                    >
                      <Icon
                        size={17}
                        className={`shrink-0 transition-transform duration-200 ${
                          active ? "text-white" : "text-ink-muted group-hover:text-ink"
                        } group-hover:scale-110`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div>
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-ink-muted/70">
                General
              </p>
              <nav className="flex flex-col gap-1">
                <button
                  onClick={async () => {
                    setSigningOut(true);
                    await signOut();
                    router.replace("/login");
                  }}
                  disabled={signingOut}
                  className="group flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-ink-muted transition-all duration-200 hover:translate-x-0.5 hover:bg-background hover:text-warn disabled:opacity-60"
                >
                  <LogoutIcon
                    size={17}
                    className="shrink-0 text-ink-muted transition-transform duration-200 group-hover:scale-110 group-hover:text-warn"
                  />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              </nav>
            </div>
          </div>
        </aside>

        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-border bg-surface/90 px-3 py-3 backdrop-blur sm:gap-3 sm:px-5 sm:py-4 md:px-8">
            <MobileNav pathname={pathname} />

            <div className="relative hidden min-w-0 max-w-sm flex-1 md:block">
              <SearchIcon
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"
              />
              <input
                type="text"
                placeholder="Search…"
                className="w-full rounded-full border border-border bg-background py-2 pl-10 pr-4 text-sm text-ink outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <HeaderClock />
              <span className="hidden h-6 w-px bg-border lg:block" />
              <ThemeToggle />
              <NotificationBell />
              {user && <ProfileCard user={user} variant="header" />}
            </div>
          </header>
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 sm:px-5 sm:py-6 md:px-8 md:py-8">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
    </div>
  );
}

function MobileNav({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex gap-1 overflow-x-auto md:hidden">
      {NAV.map((item) => {
        const active =
          item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${
              active ? "bg-accent font-medium text-white" : "text-ink-muted"
            }`}
          >
            <Icon size={15} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
