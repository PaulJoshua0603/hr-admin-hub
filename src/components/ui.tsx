import { forwardRef } from "react";
export function Card({
  children,
  className = "",
  hover = false,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`rounded-lg border border-border bg-surface p-4 transition-colors ${
        hover ? "hover-lift" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl text-ink">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const styles = {
    primary: "bg-accent text-white hover:opacity-95 hover:shadow-md shadow-accent/20",
    ghost: "bg-transparent text-ink-muted hover:bg-background border border-border",
    danger: "bg-transparent text-warn hover:bg-warn-soft border border-transparent",
  }[variant];

  return (
    <button
      className={`press-scale rounded-md px-3 py-1.5 text-sm font-medium transition-all ${styles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-all duration-200 focus:border-accent focus:ring-2 focus:ring-accent/15 ${props.className || ""}`}
    />
  );
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={`w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent ${props.className || ""}`}
    />
  );
});

export function FieldGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function StatusSelect<T extends string>({
  value,
  onChange,
  options,
  labels,
  tone,
  className = "",
  disabled = false,
}: {
  value: T;
  onChange: (v: T) => void;
  options: T[];
  labels: Record<T, string>;
  tone: (v: T) => "neutral" | "success" | "warn" | "accent";
  className?: string;
  disabled?: boolean;
}) {
  const toneStyles: Record<string, string> = {
    neutral: "bg-background text-ink-muted",
    success: "bg-success-soft text-success",
    warn: "bg-warn-soft text-warn",
    accent: "bg-accent-soft text-accent",
  };
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={`shrink-0 rounded-full border-0 px-3 py-1.5 text-xs font-semibold outline-none ring-0 focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60 ${
        disabled ? "" : "cursor-pointer"
      } ${toneStyles[tone(value)]} ${className}`}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {labels[o]}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={`group -mx-2 flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-background"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[var(--accent)]"
      />
      <span className={checked ? "text-ink-muted line-through" : "text-ink"}>
        {label}
      </span>
    </label>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "warn" | "success" | "accent";
  children: React.ReactNode;
}) {
  const styles = {
    neutral: "bg-background text-ink-muted",
    warn: "bg-warn-soft text-warn",
    success: "bg-success-soft text-success",
    accent: "bg-accent-soft text-accent",
  }[tone];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      {children}
    </span>
  );
}
