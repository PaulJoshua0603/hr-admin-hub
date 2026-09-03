"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { v4 as uuid } from "uuid";
import { useSupabaseStore } from "@/lib/useSupabaseStore";

export type NotificationType = "created" | "updated" | "deleted" | "info" | "warn";

export type AppNotification = {
  id: string;
  message: string;
  type: NotificationType;
  createdAt: string;
  read: boolean;
};

type Toast = AppNotification;

type NotificationContextValue = {
  notifications: AppNotification[];
  unreadCount: number;
  toasts: Toast[];
  notify: (message: string, type?: NotificationType) => void;
  markAllRead: () => void;
  clearAll: () => void;
  dismissToast: (id: string) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { items, hydrated, setItems } = useSupabaseStore<AppNotification>(
    "hr_notifications",
    []
  );
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback(
    (message: string, type: NotificationType = "info") => {
      const entry: AppNotification = {
        id: uuid(),
        message,
        type,
        createdAt: new Date().toISOString(),
        read: false,
      };
      setItems([entry, ...items].slice(0, 200));
      setToasts((t) => [...t, entry]);
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== entry.id));
      }, 4000);
    },
    [items, setItems]
  );

  const markAllRead = useCallback(() => {
    setItems(items.map((n) => ({ ...n, read: true })));
  }, [items, setItems]);

  const clearAll = useCallback(() => {
    setItems([]);
  }, [setItems]);

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const unreadCount = items.filter((n) => !n.read).length;

  if (!hydrated) {
    return (
      <NotificationContext.Provider
        value={{
          notifications: [],
          unreadCount: 0,
          toasts: [],
          notify: () => {},
          markAllRead: () => {},
          clearAll: () => {},
          dismissToast: () => {},
        }}
      >
        {children}
      </NotificationContext.Provider>
    );
  }

  return (
    <NotificationContext.Provider
      value={{
        notifications: items,
        unreadCount,
        toasts,
        notify,
        markAllRead,
        clearAll,
        dismissToast,
      }}
    >
      {children}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast-in pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-lg"
        >
          <ToastDot type={t.type} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-ink">{t.message}</p>
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-ink-muted hover:text-ink"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function ToastDot({ type }: { type: NotificationType }) {
  const color =
    type === "deleted" ? "bg-warn" : type === "created" ? "bg-success" : "bg-accent";
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
