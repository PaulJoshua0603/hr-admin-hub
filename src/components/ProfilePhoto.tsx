"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, supabaseReady } from "@/lib/supabaseClient";

const BUCKET = "files";
/** Longest side of the stored picture. Kept small: it is shown at avatar size, and every
 *  view downloads it, which counts against the Supabase plan. */
const MAX_SIDE = 400;
/** The full-quality copy kept beside it, for the full-screen preview and the download. */
const HD_SIDE = 2400;

/** The HD copy sits next to the small one: "…-123.jpg" → "…-123-hd.jpg". */
export const hdPathOf = (path: string) => path.replace(/\.jpg$/, "-hd.jpg");

/** Resizes a picture to fit maxSide (never enlarging) and re-encodes it as JPEG. */
async function shrink(file: File, maxSide = MAX_SIDE, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read the picture"))), "image/jpeg", quality)
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
  const [preview, setPreview] = useState<string | null>(null);
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
      const [blob, hd] = await Promise.all([shrink(file), shrink(file, HD_SIDE, 0.92)]);
      const next = `profile-photos/${employeeId}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from(BUCKET).upload(next, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      const hdUpload = await supabase.storage.from(BUCKET).upload(hdPathOf(next), hd, { contentType: "image/jpeg" });
      if (hdUpload.error) throw hdUpload.error;
      if (path) void supabase.storage.from(BUCKET).remove([path, hdPathOf(path)]);
      setUrl(URL.createObjectURL(blob));
      onChange(next);
    } catch (err) {
      onError(`Could not upload the picture: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  function removePhoto() {
    if (path) void supabase.storage.from(BUCKET).remove([path, hdPathOf(path)]);
    setUrl(null);
    onChange(undefined);
  }

  /** Full-screen view of the HD copy (the small one for pictures from before HD copies). */
  async function openPreview() {
    if (!path) return;
    const hd = await supabase.storage.from(BUCKET).createSignedUrl(hdPathOf(path), 60 * 60);
    setPreview(hd.data?.signedUrl ?? url);
  }

  async function download() {
    if (!path) return;
    const fileName = `${name} - Profile Picture.jpg`;
    let link = (await supabase.storage.from(BUCKET).createSignedUrl(hdPathOf(path), 60, { download: fileName })).data?.signedUrl;
    if (!link) link = (await supabase.storage.from(BUCKET).createSignedUrl(path, 60, { download: fileName })).data?.signedUrl;
    if (!link) {
      onError("Could not download the picture.");
      return;
    }
    const a = document.createElement("a");
    a.href = link;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

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
        disabled={busy || (!editable && !path)}
        onClick={() => (editable ? input.current?.click() : void openPreview())}
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
        title={editable ? "Click or drop a photo here" : path ? "Click to view full screen" : "Click Edit to add a photo"}
        className={`relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-2 bg-background text-2xl font-semibold text-ink-muted transition-colors ${
          dragging ? "border-accent" : "border-dashed border-border"
        } ${editable || path ? "cursor-pointer hover:border-accent" : "cursor-default"}`}
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
        <span className="text-[11px] text-ink-muted">{path ? "Click to view" : "Profile Picture"}</span>
      )}

      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${name} profile picture`}
          className="fixed inset-0 z-50 flex flex-col bg-black/90"
          onClick={() => setPreview(null)}
        >
          <div className="flex items-center justify-between gap-3 px-5 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="truncate text-sm font-medium">{name}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void download()}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25"
              >
                Download HD
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-medium hover:bg-white/25"
                aria-label="Close"
              >
                Close ✕
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed Supabase URL */}
            <img
              src={preview}
              alt={`${name} profile picture`}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
