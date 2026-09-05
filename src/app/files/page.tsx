"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { supabase, supabaseReady } from "@/lib/supabaseClient";
import { useSupabaseStore } from "@/lib/useSupabaseStore";
import { Button, Card, Input, SectionHeading } from "@/components/ui";
import { useNotifications } from "@/lib/notificationContext";
import { formatDate } from "@/lib/dates";

const BUCKET = "files";

type FolderRecord = { id: string; path: string; name: string };
type StorageEntry = {
  name: string;
  isFolder: boolean;
  size?: number;
  updatedAt?: string;
};
type SortKey = "name" | "size" | "date";

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp"];

export default function FilesPage() {
  const { items: folders, hydrated: foldersReady, add: addFolder, remove: removeFolder, update: updateFolder } =
    useSupabaseStore<FolderRecord>("hr_files_folders", []);

  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const { notify } = useNotifications();

  const currentPath = path.join("/");

  const refresh = useCallback(async () => {
    if (!supabaseReady) return;
    setLoading(true);
    const { data } = await supabase.storage.from(BUCKET).list(currentPath, {
      limit: 500,
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
    setSelected(new Set());
    setLoading(false);
  }, [currentPath]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fetch small signed-url thumbnails for image files in view.
  useEffect(() => {
    if (!supabaseReady) return;
    const images = entries.filter((f) => IMAGE_EXTS.includes(f.name.split(".").pop()?.toLowerCase() || ""));
    images.forEach(async (f) => {
      const dest = currentPath ? `${currentPath}/${f.name}` : f.name;
      if (thumbUrls[dest]) return;
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(dest, 3600);
      if (data?.signedUrl) {
        setThumbUrls((prev) => ({ ...prev, [dest]: data.signedUrl }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, currentPath]);

  const subfolders = folders.filter((f) => {
    const parent = f.path.split("/").slice(0, -1).join("/");
    return parent === currentPath;
  });

  const filteredFolders = useMemo(
    () => subfolders.filter((f) => f.name.toLowerCase().includes(search.toLowerCase())),
    [subfolders, search]
  );

  const filteredEntries = useMemo(() => {
    const list = entries.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === "size") return ((a.size || 0) - (b.size || 0)) * dir;
      if (sortKey === "date")
        return (new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime()) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
  }, [entries, search, sortKey, sortDir]);

  const totalSize = useMemo(() => entries.reduce((sum, f) => sum + (f.size || 0), 0), [entries]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function goInto(name: string) {
    setPath((p) => [...p, name]);
  }

  function goToCrumb(index: number) {
    setPath((p) => p.slice(0, index + 1));
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || !supabaseReady) return;
    const files = Array.from(fileList);
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });
    const names: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dest = currentPath ? `${currentPath}/${file.name}` : file.name;
      await supabase.storage.from(BUCKET).upload(dest, file, { upsert: true });
      names.push(file.name);
      setUploadProgress({ done: i + 1, total: files.length });
    }
    setUploading(false);
    setUploadProgress(null);
    refresh();
    notify(
      names.length === 1 ? `File uploaded: "${names[0]}"` : `${names.length} files uploaded`,
      "created"
    );
  }

  async function handleDelete(name: string) {
    const dest = currentPath ? `${currentPath}/${name}` : name;
    await supabase.storage.from(BUCKET).remove([dest]);
    refresh();
    notify(`File deleted: "${name}"`, "deleted");
  }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    const dests = Array.from(selected).map((name) => (currentPath ? `${currentPath}/${name}` : name));
    await supabase.storage.from(BUCKET).remove(dests);
    notify(`${dests.length} file(s) deleted`, "deleted");
    refresh();
  }

  async function handleDownload(name: string) {
    const dest = currentPath ? `${currentPath}/${name}` : name;
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(dest, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }

  async function handleCopyLink(name: string) {
    const dest = currentPath ? `${currentPath}/${name}` : name;
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(dest, 60 * 60 * 24 * 7);
    if (data?.signedUrl) {
      await navigator.clipboard.writeText(data.signedUrl);
      notify("Link copied (valid 7 days)", "info");
    }
  }

  async function handleRenameFile(oldName: string) {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) {
      setRenamingFile(null);
      return;
    }
    const oldDest = currentPath ? `${currentPath}/${oldName}` : oldName;
    const newDest = currentPath ? `${currentPath}/${newName}` : newName;
    const { error } = await supabase.storage.from(BUCKET).move(oldDest, newDest);
    if (error) {
      notify(`Rename failed: ${error.message}`, "warn");
    } else {
      notify(`Renamed to "${newName}"`, "updated");
      refresh();
    }
    setRenamingFile(null);
  }

  function handleRenameFolder(folder: FolderRecord) {
    const newName = renameValue.trim();
    if (!newName || newName === folder.name) {
      setRenamingFolder(null);
      return;
    }
    const parent = folder.path.split("/").slice(0, -1).join("/");
    const newPath = parent ? `${parent}/${newName}` : newName;
    updateFolder(folder.id, { name: newName, path: newPath });
    notify(`Folder renamed to "${newName}"`, "updated");
    setRenamingFolder(null);
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

  function toggleSelect(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (!foldersReady) return null;

  return (
    <div>
      <SectionHeading
        title="File Manager"
        subtitle={`Drop in pictures, personal files, or documents to keep them all in one place.${
          entries.length > 0 ? ` ${entries.length} file(s) here, ${formatSize(totalSize)} total.` : ""
        }`}
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

      {/* Toolbar: search + sort */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search files and folders…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="flex items-center gap-1 text-xs text-ink-muted">
          Sort:
          {(["name", "size", "date"] as SortKey[]).map((key) => (
            <button
              key={key}
              onClick={() => toggleSort(key)}
              className={`rounded-full px-2 py-1 capitalize ${
                sortKey === key ? "bg-accent-soft text-accent font-medium" : "hover:text-ink"
              }`}
            >
              {key}
              {sortKey === key && (sortDir === "asc" ? " ↑" : " ↓")}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-ink-muted">{selected.size} selected</span>
            <Button variant="danger" onClick={handleBulkDelete}>
              Delete selected
            </Button>
          </div>
        )}
      </div>

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
          {uploading
            ? `Uploading… ${uploadProgress ? `${uploadProgress.done}/${uploadProgress.total}` : ""}`
            : "Drag and drop files here, or use Upload files above"}
        </p>
      </div>

      {/* Folders */}
      {filteredFolders.length > 0 && (
        <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filteredFolders.map((f) => (
            <Card key={f.id} className="flex items-center justify-between gap-2">
              {renamingFolder === f.id ? (
                <Input
                  autoFocus
                  className="flex-1"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRenameFolder(f)}
                  onBlur={() => handleRenameFolder(f)}
                />
              ) : (
                <button
                  onClick={() => goInto(f.name)}
                  className="flex flex-1 items-center gap-2 text-left min-w-0"
                >
                  <FolderIcon />
                  <span className="truncate text-sm text-ink">{f.name}</span>
                </button>
              )}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => {
                    setRenamingFolder(f.id);
                    setRenameValue(f.name);
                  }}
                  className="text-xs text-ink-muted hover:text-accent"
                >
                  Rename
                </button>
                <button
                  onClick={() => deleteFolder(f)}
                  className="text-xs text-ink-muted hover:text-warn"
                >
                  Delete
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Files */}
      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : filteredEntries.length === 0 && filteredFolders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-ink-muted">
          {search ? "No matches." : "This folder is empty."}
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEntries.map((f) => {
            const dest = currentPath ? `${currentPath}/${f.name}` : f.name;
            const thumb = thumbUrls[dest];
            return (
              <Card key={f.name} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.has(f.name)}
                  onChange={() => toggleSelect(f.name)}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                ) : (
                  <FileIcon name={f.name} />
                )}
                <div className="min-w-0 flex-1">
                  {renamingFile === f.name ? (
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRenameFile(f.name)}
                      onBlur={() => handleRenameFile(f.name)}
                    />
                  ) : (
                    <button
                      onClick={() => handleDownload(f.name)}
                      className="block truncate text-left text-sm text-ink hover:text-accent"
                    >
                      {f.name}
                    </button>
                  )}
                  <p className="text-[11px] text-ink-muted">
                    {formatSize(f.size)}
                    {f.updatedAt ? ` · ${formatDate(f.updatedAt)}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                  <button
                    onClick={() => {
                      setRenamingFile(f.name);
                      setRenameValue(f.name);
                    }}
                    className="text-ink-muted hover:text-accent"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => handleCopyLink(f.name)}
                    className="text-ink-muted hover:text-accent"
                  >
                    Copy link
                  </button>
                  <button
                    onClick={() => handleDelete(f.name)}
                    className="text-ink-muted hover:text-warn"
                  >
                    Delete
                  </button>
                </div>
              </Card>
            );
          })}
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
  const isImage = IMAGE_EXTS.includes(ext);
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-8 w-8 shrink-0 text-ink-muted">
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
