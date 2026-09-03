"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { Button, Input } from "@/components/ui";
import { useAuth } from "@/lib/authContext";
import { LockIcon, SuccessCheckIcon } from "@/components/icons";

export default function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const router = useRouter();
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
    const { error } = await updatePassword(password);
    setLoading(false);
    if (error) {
      setError(error);
      triggerShake();
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/"), 1500);
  }

  return (
    <AuthShell
      tabs={[{ href: "/reset-password", label: "New Password" }]}
      activeTab="/reset-password"
      eyebrow="HR Admin Hub"
      headline="Choose a new password to get back into your workspace."
    >
      {done ? (
        <div className="flex flex-col items-center py-4 text-center">
          <SuccessCheckIcon size={56} className="animate-pop-check text-success" />
          <h1 className="font-display mt-4 mb-2 text-2xl text-ink">Password updated</h1>
          <p className="text-sm text-ink-muted">Taking you to your dashboard…</p>
        </div>
      ) : (
        <>
          <h1 className="font-display mb-1 text-2xl text-ink">Set a new password</h1>
          <p className="mb-6 text-sm text-ink-muted">
            Open this page from the reset link in your email, then set a new password below.
          </p>

          <form
            onSubmit={handleSubmit}
            className={`flex flex-col gap-4 ${shake ? "animate-shake" : ""}`}
          >
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-ink-muted">New password</span>
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
              <span className="text-xs font-medium text-ink-muted">Confirm new password</span>
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
              className={`mt-1 w-full justify-center py-2.5 text-base ${loading ? "opacity-70" : ""}`}
            >
              {loading ? "Updating…" : "Update Password"}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
