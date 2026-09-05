"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, Card, Input, SectionHeading } from "@/components/ui";
import { useNotifications } from "@/lib/notificationContext";

const BUCKET = "files";

type FolderRecord = { id: string; path: string; name: string };
type StorageEntry = {
  name: string;
  isFolder: boolean;
  size?: number;
  updatedAt?: string;
};

export default function FilesPage() {
  const { items: folders, hydrated: foldersReady, add: addFolder, remove: removeFolder } =
    useSupabaseStore<FolderRecord>("hr_files_folders", []);

  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { notify } = useNotifications();

  const currentPath = path.join("/");

  const refresh = useCallback(async () => {
    if (!supabaseReady) return;
    setLoading(true);
    const { data } = await supabase.storage.from(BUCKET).list(currentPath, {
      limit: 200,
      sortBy: { column: "name", order: "asc" },
    });
    const files: StorageEntry[] = (data || [])
      .filter((f) => f.name !== ".keep")
      .map((f) => ({
        name: f.name,
        isFolder: false,
        size: f.metadata?.size,
        updatedAt: f.updated_at || undefined,
      }));
    setEntries(files);
    setLoading(false);
  }, [currentPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const subfolders = folders.filter((f) => {
    const parent = f.path.split("/").slice(0, -1).join("/");
    return parent === currentPath;
  });

  function goInto(name: string) {
    setPath((p) => [...p, name]);
  }

  function goToCrumb(index: number) {
    setPath((p) => p.slice(0, index + 1));
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !supabaseReady) return;
    setUploading(true);
    const names: string[] = [];
    for (const file of Array.from(fileList)) {
      const dest = currentPath ? `${currentPath}/${file.name}` : file.name;
      await supabase.storage.from(BUCKET).upload(dest, file, { upsert: true });
      names.push(file.name);
    }
    setUploading(false);
    refresh();
    notify(
      names.length === 1
        ? `File uploaded: "${names[0]}"`
        : `${names.length} files uploaded`,
      "created"
    );
  }

  async function handleDelete(name: string) {
    const dest = currentPath ? `${currentPath}/${name}` : name;
    await supabase.storage.from(BUCKET).remove([dest]);
    refresh();
    notify(`File deleted: "${name}"`, "deleted");
  }

  async function handleDownload(name: string) {
    const dest = currentPath ? `${currentPath}/${name}` : name;
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(dest, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  function createFolder() {
    if (!newFolderName.trim()) return;
    const folderPath = currentPath
      ? `${currentPath}/${newFolderName.trim()}`
      : newFolderName.trim();
    addFolder({ id: uuid(), path: folderPath, name: newFolderName.trim() });
    notify(`Folder created: "${newFolderName.trim()}"`, "created");
    setNewFolderName("");
    setNewFolderOpen(false);
  }

  async function deleteFolder(folder: FolderRecord) {
    const { data } = await supabase.storage.from(BUCKET).list(folder.path, { limit: 1000 });
    if (data && data.length > 0) {
      await supabase.storage
        .from(BUCKET)
        .remove(data.map((f) => `${folder.path}/${f.name}`));
    }
    removeFolder(folder.id);
    notify(`Folder deleted: "${folder.name}"`, "deleted");
  }

  if (!foldersReady) return null;

  return (
    <div>
      <SectionHeading
        title="File Manager"
        subtitle="Drop in pictures, personal files, or documents to keep them all in one place."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setNewFolderOpen((s) => !s)}>
              + New folder
            </Button>
            <Button onClick={() => inputRef.current?.click()}>+ Upload files</Button>
          </div>
        }
      />

      {!supabaseReady && (
        <Card className="mb-4 bg-warn-soft">
          <p className="text-sm text-warn">
            Connect Supabase (see README) to enable file storage.
          </p>
        </Card>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Breadcrumbs */}
      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        <button
          onClick={() => setPath([])}
          className={`text-ink-muted hover:text-ink ${path.length === 0 ? "font-medium text-ink" : ""}`}
        >
          All Files
        </button>
        {path.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-ink-muted">/</span>
            <button
              onClick={() => goToCrumb(i)}
              className={`text-ink-muted hover:text-ink ${i === path.length - 1 ? "font-medium text-ink" : ""}`}
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {newFolderOpen && (
        <Card className="mb-4 flex gap-2">
          <Input
            autoFocus
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
          />
          <Button onClick={createFolder}>Create</Button>
          <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
        </Card>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`mb-6 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? "border-accent bg-accent-soft" : "border-border bg-surface"
        }`}
      >
        <p className="text-sm text-ink-muted">
          {uploading ? "Uploading…" : "Drag and drop files here, or use Upload files above"}
        </p>
      </div>

      {/* Folders */}
      {subfolders.length > 0 && (
        <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {subfolders.map((f) => (
            <Card key={f.id} className="flex items-center justify-between gap-2">
              <button
                onClick={() => goInto(f.name)}
                className="flex flex-1 items-center gap-2 text-left"
              >
                <FolderIcon />
                <span className="truncate text-sm text-ink">{f.name}</span>
              </button>
              <button
                onClick={() => deleteFolder(f)}
                className="text-xs text-ink-muted hover:text-warn"
              >
                Delete
              </button>
            </Card>
          ))}
        </div>
      )}

      {/* Files */}
      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : entries.length === 0 && subfolders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
          This folder is empty.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((f) => (
            <Card key={f.name} className="flex items-center justify-between gap-2">
              <button
                onClick={() => handleDownload(f.name)}
                className="flex flex-1 items-center gap-2 text-left min-w-0"
              >
                <FileIcon name={f.name} />
                <span className="truncate text-sm text-ink">{f.name}</span>
              </button>
              <button
                onClick={() => handleDelete(f.name)}
                className="shrink-0 text-xs text-ink-muted hover:text-warn"
              >
                Delete
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-accent">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-ink-muted">
      {isImage ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}
