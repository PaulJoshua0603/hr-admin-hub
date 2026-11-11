"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

const BUCKET = "files";
/** Longest side of the stored picture. Kept small: it is shown at avatar size, and every
 *  view downloads it, which counts against the Supabase plan. */
const MAX_SIDE = 400;

/** Shrinks a picture to MAX_SIDE and re-encodes it as JPEG. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the picture"))), "image/jpeg", 0.85)
  );
}

/**
 * The employee's profile picture: click or drag a photo onto it to set it (Edit mode),
 * stored in Supabase Storage with only its path on the employee record.
 */
export function ProfilePhoto({
  path,
  name,
  employeeId,
  editable,
  onChange,
  onError,
}: {
  path?: string;
  name: string;
  employeeId: string;
  editable: boolean;
  onChange: (path: string | undefined) => void;
  onError: (message: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    if (!path || !supabaseReady) return;
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 60 * 60)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  async function upload(file: File) {
    if (!file.type.startsWith("image/")) {
      onError("Please choose a picture (JPG or PNG).");
      return;
    }
    setBusy(true);
    try {
      const blob = await shrink(file);
      const next = `profile-photos/${employeeId}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from(BUCKET).upload(next, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      if (path) void supabase.storage.from(BUCKET).remove([path]);
      setUrl(URL.createObjectURL(blob));
      onChange(next);
    } catch (err) {
      onError(`Could not upload the picture: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  function removePhoto() {
    if (path) void supabase.storage.from(BUCKET).remove([path]);
    setUrl(null);
    onChange(undefined);
  }

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const shown = path ? url : null;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        disabled={!editable || busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (editable && file) void upload(file);
        }}
        title={editable ? "Click or drop a photo here" : "Click Edit to change the photo"}
        className={`relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-2 bg-background text-2xl font-semibold text-ink-muted transition-colors ${
          dragging ? "border-accent" : "border-dashed border-border"
        } ${editable ? "cursor-pointer hover:border-accent" : "cursor-default"}`}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed Supabase URL, not a static asset
          <img src={shown} alt={`${name} profile picture`} className="h-full w-full object-cover" />
        ) : (
          <span>{initials || "?"}</span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
            Uploading…
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      {editable ? (
        <span className="text-center text-[11px] leading-tight text-ink-muted">
          Click or drag a photo
          {path && (
            <>
              {" · "}
              <button type="button" onClick={removePhoto} className="text-warn hover:underline">
                Remove
              </button>
            </>
          )}
        </span>
      ) : (
        <span className="text-[11px] text-ink-muted">Profile Picture</span>
      )}
    </div>
  );
}
