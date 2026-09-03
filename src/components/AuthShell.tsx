"use client";

import Link from "next/link";
import Image from "next/image";
import ThemeToggle from "@/components/ThemeToggle";

export function AuthShell({
  tabs,
  activeTab,
  eyebrow,
  headline,
  children,
}: {
  tabs: { href: string; label: string }[];
  activeTab: string;
  eyebrow: string;
  headline: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#EEF2EF] px-4 py-10 dark:bg-[#0B1112]">
      <BackgroundGlow />

      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>

      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-2xl border border-black/5 bg-white shadow-[0_30px_80px_-30px_rgba(14,94,86,0.35)] md:grid-cols-[1fr_1.05fr] dark:border-white/5 dark:bg-surface">
        {/* Form side */}
        <div className="animate-rise-in flex flex-col justify-center px-8 py-10 sm:px-12">
          <div className="mb-8 flex items-center gap-2">
            <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full">
              <Image src="/logo.png" alt="HR Admin Hub" fill sizes="32px" className="object-cover" />
            </span>
            <span className="font-display text-lg text-ink">HR Admin Hub</span>
          </div>

          <div className="mb-7 flex gap-1 rounded-lg bg-background p-1">
            {tabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
                  activeTab === tab.href
                    ? "bg-surface text-accent shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>

          {children}
        </div>

        {/* Illustration side */}
        <div className="relative hidden overflow-hidden bg-gradient-to-br from-[#0E5E56] via-[#0B4A45] to-[#0A2E2A] p-10 text-white md:flex md:flex-col md:justify-center">
          <FloatingShapes />
          <NetworkIllustration />
          <div className="relative z-10 mt-8 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/60">
              {eyebrow}
            </p>
            <h2 className="font-display mt-2 text-2xl leading-snug text-white">
              {headline}
            </h2>
          </div>
        </div>
      </div>
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
      <div className="absolute -bottom-32 -right-20 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />
    </div>
  );
}

function FloatingShapes() {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="animate-float-slow absolute left-8 top-10 h-16 w-16 rounded-2xl border border-white/10 bg-white/5" />
      <div className="animate-float-slower absolute bottom-16 right-10 h-24 w-24 rounded-full border border-white/10 bg-white/5" />
      <div className="animate-float-slow absolute bottom-10 left-16 h-10 w-10 rotate-12 rounded-lg border border-white/10 bg-white/5" />
    </div>
  );
}

/** Abstract org-chart / people-network graphic, drawn in on mount. */
function NetworkIllustration() {
  const nodes: [number, number][] = [
    [150, 40],
    [70, 100],
    [230, 100],
    [40, 170],
    [110, 175],
    [190, 175],
    [260, 170],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ];

  return (
    <svg
      viewBox="0 0 300 220"
      className="relative z-10 mx-auto h-48 w-full max-w-xs"
      fill="none"
    >
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]}
          y1={nodes[a][1]}
          x2={nodes[b][0]}
          y2={nodes[b][1]}
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="1.5"
          strokeDasharray="200"
          strokeDashoffset="200"
          className="animate-draw-line"
          style={{ animationDelay: `${i * 90}ms` }}
        />
      ))}
      {nodes.map(([x, y], i) => (
        <g key={i}>
          <circle
            cx={x}
            cy={y}
            r={i === 0 ? 14 : 10}
            fill={i === 0 ? "#4FD1C5" : "rgba(255,255,255,0.9)"}
            className="animate-node-pop"
            style={{ animationDelay: `${300 + i * 80}ms` }}
          />
        </g>
      ))}
    </svg>
  );
}
