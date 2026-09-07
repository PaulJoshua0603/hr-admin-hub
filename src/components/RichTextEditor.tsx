"use client";

import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
};

const TOOLS: { cmd: string; label: string; icon: string }[] = [
  { cmd: "bold", label: "Bold", icon: "B" },
  { cmd: "italic", label: "Italic", icon: "I" },
  { cmd: "underline", label: "Underline", icon: "U" },
  { cmd: "insertUnorderedList", label: "Bullet list", icon: "•" },
  { cmd: "insertOrderedList", label: "Numbered list", icon: "1." },
];

const FONT_SIZES = [
  { label: "Small", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "5" },
  { label: "X-Large", value: "7" },
];

const TEXT_COLORS = ["#1C2420", "#0E5E56", "#C1502B", "#1D4ED8", "#7C3AED", "#DC2626"];
const HIGHLIGHT_COLORS = ["transparent", "#FEF08A", "#BBF7D0", "#BFDBFE", "#FBCFE8", "#FED7AA"];

export function RichTextEditor({ value, onChange, placeholder, minHeight = "160px" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (ref.current && isFirstRender.current) {
      ref.current.innerHTML = value || "";
      isFirstRender.current = false;
    }
  }, [value]);

  function exec(cmd: string, arg?: string) {
    document.execCommand(cmd, false, arg);
    ref.current?.focus();
    onChange(ref.current?.innerHTML || "");
  }

  function setHeading(tag: string) {
    exec("formatBlock", tag);
  }

  function setFontSize(size: string) {
    exec("fontSize", size);
  }

  function setTextColor(color: string) {
    exec("foreColor", color);
  }

  function setHighlight(color: string) {
    exec("hiliteColor", color === "transparent" ? "inherit" : color);
  }

  function insertTable() {
    ref.current?.focus();
    const rows = 3;
    const cols = 3;
    let html = '<table style="border-collapse:collapse;width:100%;margin:8px 0;">';
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) {
        html +=
          '<td style="border:1px solid #DDE3DD;padding:6px 8px;min-width:60px;" contenteditable="true">&nbsp;</td>';
      }
      html += "</tr>";
    }
    html += "</table><p><br></p>";
    document.execCommand("insertHTML", false, html);
    onChange(ref.current?.innerHTML || "");
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-2 py-1.5">
        <select
          onChange={(e) => setHeading(e.target.value)}
          defaultValue="p"
          title="Paragraph style"
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-ink outline-none"
        >
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
        </select>

        <select
          onChange={(e) => setFontSize(e.target.value)}
          defaultValue="3"
          title="Font size"
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-ink outline-none"
        >
          {FONT_SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {TOOLS.map((t) => (
          <button
            key={t.cmd}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(t.cmd)}
            title={t.label}
            className="flex h-7 w-7 items-center justify-center rounded text-sm font-semibold text-ink-muted hover:bg-surface hover:text-ink"
          >
            {t.icon}
          </button>
        ))}

        <span className="mx-1 h-5 w-px bg-border" />

        <div className="flex items-center gap-0.5" title="Text color">
          {TEXT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTextColor(c)}
              style={{ backgroundColor: c }}
              className="h-5 w-5 rounded-full border border-border"
              aria-label={`Text color ${c}`}
            />
          ))}
        </div>

        <span className="mx-1 h-5 w-px bg-border" />

        <div className="flex items-center gap-0.5" title="Highlight color">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setHighlight(c)}
              style={{
                backgroundColor: c === "transparent" ? "#fff" : c,
                backgroundImage:
                  c === "transparent"
                    ? "linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)"
                    : undefined,
                backgroundSize: c === "transparent" ? "6px 6px" : undefined,
                backgroundPosition: c === "transparent" ? "0 0, 3px 3px" : undefined,
              }}
              className="h-5 w-5 rounded border border-border"
              aria-label={`Highlight ${c}`}
            />
          ))}
        </div>

        <span className="mx-1 h-5 w-px bg-border" />

        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertTable}
          title="Insert table"
          className="flex h-7 items-center justify-center rounded px-2 text-xs font-medium text-ink-muted hover:bg-surface hover:text-ink"
        >
          ⊞ Table
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML || "")}
        data-placeholder={placeholder}
        style={{ minHeight }}
        className="prose-editor px-3 py-2.5 text-sm text-ink outline-none [&_h2]:font-display [&_h2]:text-lg [&_h3]:font-display [&_h3]:text-base [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-1.5 empty:before:content-[attr(data-placeholder)] empty:before:text-ink-muted"
      />
    </div>
  );
}
