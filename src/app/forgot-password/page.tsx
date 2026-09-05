"use client";

import { useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/authContext";
import { MailIcon, SuccessCheckIcon } from "@/components/icons";

const TABS = [
  { href: "/login", label: "Sign In" },
  { href: "/forgot-password", label: "Recovery" },
];

export default function ForgotPasswordPage() {
  const { sendPasswordReset, configured } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!configured) {
      setError("Connect Supabase first (see README) to enable password recovery.");
      triggerShake();
      return;
    }
    setLoading(true);
    const { error } = await sendPasswordReset(email);
    setLoading(false);
    if (error) {
      setError(error);
      triggerShake();
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      tabs={TABS}
      activeTab="/forgot-password"
      eyebrow="HR Admin Hub"
      headline="A quiet, secure place to reset access to your workspace."
    >
      {sent ? (
        <div className="flex flex-col items-center py-4 text-center">
          <SuccessCheckIcon size={56} className="animate-pop-check text-success" />
          <h1 className="font-display mt-4 mb-2 text-2xl text-ink">Check your inbox</h1>
          <p className="text-sm text-ink-muted">
            If an account exists for <strong>{email}</strong>, a reset link is
            on its way. Open it to choose a new password.
          </p>
        </div>
      ) : (
        <>
          <h1 className="font-display mb-1 text-2xl text-ink">Password recovery</h1>
          <p className="mb-6 text-sm text-ink-muted">
            Enter your email and we&apos;ll send a link to reset your password.
          </p>

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
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
              className={`mt-1 w-full justify-center py-2.5 text-base ${loading ? "opacity-70" : ""}`}
            >
              {loading ? "Sending…" : "Send Reset Link"}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
