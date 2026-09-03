"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/authContext";
import { MailIcon, LockIcon, UserIcon, SuccessCheckIcon } from "@/components/icons";

const TABS = [
  { href: "/login", label: "Sign In" },
  { href: "/register", label: "Sign Up" },
];

export default function RegisterPage() {
  const { signUp, configured } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!configured) {
      setError("Connect Supabase first (see README) to enable sign up.");
      triggerShake();
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      triggerShake();
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      triggerShake();
      return;
    }

    setLoading(true);
    const { error } = await signUp(email, password, fullName);
    setLoading(false);

    if (error) {
      setError(error);
      triggerShake();
      return;
    }
    setDone(true);
  }

  return (
    <AuthShell
      tabs={TABS}
      activeTab="/register"
      eyebrow="HR Admin Hub"
      headline="Set up your workspace once, and every deadline stays on track after."
    >
      {done ? (
        <div className="flex flex-col items-center py-4 text-center">
          <SuccessCheckIcon size={56} className="animate-pop-check text-success" />
          <h1 className="font-display mt-4 mb-2 text-2xl text-ink">Almost there</h1>
          <p className="text-sm text-ink-muted">
            We&apos;ve sent a confirmation link to <strong>{email}</strong>.
            Open it, then come back and sign in.
          </p>
          <Button className="mt-6" onClick={() => router.push("/login")}>
            Go to Sign In
          </Button>
        </div>
      ) : (
        <>
          <h1 className="font-display mb-1 text-2xl text-ink">Create your account</h1>
          <p className="mb-6 text-sm text-ink-muted">
            This workspace is set up for a single HR/Admin user.
          </p>

          <form
            onSubmit={handleSubmit}
            className={`flex flex-col gap-4 ${shake ? "animate-shake" : ""}`}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">Full name</span>
              <div className="relative">
                <UserIcon
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                />
                <Input
                  required
                  placeholder="Jordan Reyes"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="pl-9"
                />
              </div>
            </label>

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
                  type="password"
                  required
                  placeholder="At least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9"
                />
              </div>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">Confirm password</span>
              <div className="relative">
                <LockIcon
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                />
                <Input
                  type="password"
                  required
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </label>

            {error && (
              <p className="animate-fade-up rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className={`mt-1 w-full justify-center py-2.5 text-base ${loading ? "opacity-90" : ""}`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3.5 w-3.5 animate-spin-slow rounded-full border-2 border-white/40 border-t-white" />
                  Creating account…
                </span>
              ) : (
                "Sign Up"
              )}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
