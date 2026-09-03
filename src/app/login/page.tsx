"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/authContext";
import { MailIcon, LockIcon } from "@/components/icons";

const TABS = [
  { href: "/login", label: "Sign In" },
  { href: "/register", label: "Sign Up" },
];

export default function LoginPage() {
  const { signIn, configured } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!configured) {
      setError("Connect Supabase first (see README) to enable sign in.");
      triggerShake();
      return;
    }
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
      setLoading(false);
      setError(error);
      triggerShake();
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push("/"), 450);
  }

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  return (
    <AuthShell
      tabs={TABS}
      activeTab="/login"
      eyebrow="HR Admin Hub"
      headline="Everything your onboarding and daily HR ops need, in one calm place."
    >
      <h1 className="font-display mb-1 text-2xl text-ink">Welcome back</h1>
      <p className="mb-6 text-sm text-ink-muted">Sign in to your workspace.</p>

      <form
        onSubmit={handleSubmit}
        className={`flex flex-col gap-4 ${shake ? "animate-shake" : ""}`}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">Email</span>
          <div className="relative">
            <MailIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <Input
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-9"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-muted">Password</span>
          <div className="relative">
            <LockIcon
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            />
            <Input
              type={showPassword ? "text" : "password"}
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-9 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted transition-colors hover:text-ink"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>
        </label>

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-accent hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        {error && (
          <p className="animate-fade-up rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={loading || success}
          className={`mt-1 w-full justify-center py-2.5 text-base ${
            loading || success ? "opacity-90" : ""
          }`}
        >
          {success ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-scale-in rounded-full bg-white/25" />
              Welcome back…
            </span>
          ) : loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-white/40 border-t-white" />
              Signing in…
            </span>
          ) : (
            "Sign In"
          )}
        </Button>
      </form>
    </AuthShell>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 3l18 18" strokeLinecap="round" />
      <path
        d="M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.3A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a13.6 13.6 0 0 1-3 3.7M6.3 6.9A13.9 13.9 0 0 0 2.5 12s3.5 7 9.5 7a9.7 9.7 0 0 0 4.2-.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path
        d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
