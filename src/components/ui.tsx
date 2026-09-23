import { forwardRef, useState } from "react";

/**
 * Shared control metrics. Buttons, inputs, selects and the pill select all resolve to
 * the same height and radius, which is what lets a form row of mixed controls sit on
 * one baseline instead of each control setting its own size.
 */
const CONTROL = "h-9 rounded-lg text-sm";
const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const FIELD_BASE = `${CONTROL} w-full border border-border bg-surface px-3 text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/70 hover:border-ink-muted/40 focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-60`;

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
      className={`rounded-xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors ${
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
  toolbar,
}: {
  title: string;
  subtitle?: string;
  /** One or two controls that belong beside the title. */
  action?: React.ReactNode;
  /** A page's full set of tools, given its own row so it never squeezes the title. */
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="mb-6 border-b border-border pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        {/* min-w-0 lets the text shrink gracefully; the action group may shrink too, so a
            long row of buttons can no longer squeeze the subtitle into a narrow column. */}
        <div className="min-w-0 sm:flex-1">
          <h1 className="font-display text-2xl tracking-tight text-ink">{title}</h1>
          {subtitle && (
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-muted">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{action}</div>}
      </div>
      {toolbar && <div className="mt-4 flex flex-wrap items-center gap-2">{toolbar}</div>}
    </div>
  );
}

/**
 * A report section that stays shut until it is asked for. The Reports page carries a
 * dozen of these, and rendering every table at once buries whichever one is actually
 * wanted; the heading alone tells you how many records are inside.
 */
export function CollapsibleSection({
  title,
  subtitle,
  count,
  defaultOpen = false,
  onOpenChange,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  defaultOpen?: boolean;
  /** Told whenever the section is opened or closed — for a caller that defers its own
   *  work (loading a large template, say) until the section holding it is actually seen. */
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          // Worked out here and passed to both, rather than telling the parent from inside
          // the state updater — React runs updaters during render, where a parent's
          // setState is not allowed.
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        className={`flex w-full items-center gap-3 text-left ${FOCUS_RING} rounded-lg`}
      >
        <span
          aria-hidden
          className={`text-ink-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-display text-lg text-ink">{title}</span>
          {typeof count === "number" && (
            <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-xs tabular-nums text-ink-muted">
              {count}
            </span>
          )}
          {subtitle && <span className="mt-1 block text-xs text-ink-muted">{subtitle}</span>}
        </span>
        <span className="shrink-0 text-xs text-ink-muted">{open ? "Hide" : "View"}</span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/** Divider between groups of tools in a toolbar row. */
export function ToolbarDivider() {
  return <span aria-hidden className="mx-1 hidden h-6 w-px bg-border sm:block" />;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`${buttonClasses(variant, size)} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Every control that should read as a button resolves its look here. Uploads have to be
 * a <label> wrapping a hidden <input type="file">, and hand-copying these classes is how
 * "Import from Excel" and "Update Email/Supervisor" drifted into two different sizes and
 * colours next to the real buttons.
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  const variants = {
    primary:
      "bg-accent text-white shadow-sm shadow-accent/25 hover:brightness-110 active:brightness-95",
    secondary:
      "border border-border bg-surface text-ink hover:border-ink-muted/40 hover:bg-background",
    ghost: "border border-border bg-transparent text-ink-muted hover:bg-background hover:text-ink",
    danger: "border border-transparent bg-transparent text-warn hover:bg-warn-soft",
  }[variant];
  const sizes = { sm: "h-8 px-2.5 text-xs", md: "h-9 px-3.5 text-sm" }[size];
  return `press-scale inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 ${FOCUS_RING} ${sizes} ${variants}`;
}

/** A file picker that looks and sizes exactly like a Button. */
export function FileButton({
  children,
  accept,
  disabled = false,
  onFile,
  variant = "secondary",
  title,
}: {
  children: React.ReactNode;
  accept?: string;
  disabled?: boolean;
  onFile: (file: File) => void;
  variant?: ButtonVariant;
  title?: string;
}) {
  return (
    <label title={title} className={disabled ? "cursor-not-allowed" : "cursor-pointer"}>
      <span className={`${buttonClasses(variant)} ${disabled ? "pointer-events-none opacity-50" : ""}`}>
        {children}
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD_BASE} ${props.className || ""}`} />;
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-ink transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/70 hover:border-ink-muted/40 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 ${
        props.className || ""
      }`}
    />
  );
});

export function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Labelled field wrapper so a control and its caption always align as one unit. */
export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-ink-muted">{hint}</span>}
    </label>
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
    neutral: "bg-background text-ink-muted ring-border",
    success: "bg-success-soft text-success ring-success/20",
    warn: "bg-warn-soft text-warn ring-warn/20",
    accent: "bg-accent-soft text-accent ring-accent/20",
  };
  return (
    <div className={`relative inline-flex h-8 shrink-0 items-center ${className}`}>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className={`h-8 w-full appearance-none rounded-full border-0 py-0 pl-3 pr-8 text-xs font-semibold ring-1 ring-inset transition-shadow ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-60 ${
          disabled ? "" : "cursor-pointer"
        } ${toneStyles[tone(value)]}`}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="pointer-events-none absolute right-2.5 opacity-70"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
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
      className={`group -mx-2 flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${
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
      <span className={checked ? "text-ink-muted line-through" : "text-ink"}>{label}</span>
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
    neutral: "bg-background text-ink-muted ring-border",
    warn: "bg-warn-soft text-warn ring-warn/20",
    success: "bg-success-soft text-success ring-success/20",
    accent: "bg-accent-soft text-accent ring-accent/20",
  }[tone];
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${styles}`}
    >
      {children}
    </span>
  );
}

/**
 * Count tile used for the clickable totals. Kept here so every stat card on the app
 * has the same figure size, label treatment and selected state.
 */
export function StatCard({
  value,
  label,
  hint,
  active = false,
  onClick,
}: {
  value: React.ReactNode;
  label: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const shared = `rounded-xl border bg-surface p-5 text-left transition-all duration-150 ${
    active ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-border"
  }`;
  const body = (
    <>
      <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-xs font-medium text-ink-muted">{label}</p>
      {hint && <p className="mt-2 text-xs font-medium text-accent">{hint}</p>}
    </>
  );
  if (!onClick) return <div className={shared}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${shared} press-scale hover:border-accent ${FOCUS_RING}`}
    >
      {body}
    </button>
  );
}

/** Scroll container + consistent chrome for the app's data tables. */
export function TableWrap({
  children,
  className = "",
  maxHeight,
}: {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div
      style={maxHeight ? { maxHeight } : undefined}
      className={`data-table-wrap overflow-auto rounded-xl border border-border ${className}`}
    >
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-ink-muted">
      {children}
    </div>
  );
}

/** Search field with a magnifier affordance, sized to match the other controls. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.2-3.2" />
      </svg>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-muted/70 hover:border-ink-muted/40 focus:border-accent focus:ring-2 focus:ring-accent/15"
      />
    </div>
  );
}
