"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import { useNotifications } from "@/lib/notificationContext";

const AVATAR_BUCKET = "files";
const AVATAR_FOLDER = "profile";

function getDisplayName(user: User): string {
  return (
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    user.email ||
    "Account"
  );
}

export default function ProfileCard({
  user,
  variant = "sidebar",
}: {
  user: User;
  variant?: "sidebar" | "header";
}) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { notify } = useNotifications();

  const displayName = getDisplayName(user);
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  useEffect(() => {
    const path = user.user_metadata?.avatar_path as string | undefined;
    if (!path || !supabaseReady) return;
    supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => setAvatarUrl(data?.signedUrl || null));
  }, [user]);

  async function handleUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !supabaseReady) return;
    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${AVATAR_FOLDER}/${user.id}-avatar.${ext}`;
    const { error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { upsert: true });
    if (!error) {
      await supabase.auth.updateUser({ data: { avatar_path: path } });
      const { data } = await supabase.storage
        .from(AVATAR_BUCKET)
        .createSignedUrl(path, 3600);
      setAvatarUrl(data?.signedUrl || null);
      notify("Profile picture updated", "updated");
    }
    setUploading(false);
  }

  const avatarSize = variant === "header" ? "h-10 w-10" : "h-9 w-9";

  const avatarButton = (
    <button
      onClick={() => fileInputRef.current?.click()}
      className={`relative ${avatarSize} shrink-0 overflow-hidden rounded-full border border-border bg-surface`}
      title="Change profile picture"
      disabled={!supabaseReady}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="Profile" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xs font-semibold text-accent">
          {initials || "?"}
        </span>
      )}
      {uploading && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[9px] text-white">
          …
        </span>
      )}
    </button>
  );

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => handleUpload(e.target.files)}
    />
  );

  if (variant === "header") {
    return (
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-surface py-1 pl-1 pr-3.5">
        {avatarButton}
        {fileInput}
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-medium text-ink">{displayName}</p>
          {user.email && (
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 rounded-md bg-background px-3 py-2">
      {avatarButton}
      {fileInput}
      <p className="truncate text-xs font-medium text-ink">{displayName}</p>
    </div>
  );
}
