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

export function RichTextEditor({ value, onChange, placeholder, minHeight = "160px" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (ref.current && isFirstRender.current) {
      ref.current.innerHTML = value || "";
      isFirstRender.current = false;
    }
  }, [value]);

  function exec(cmd: string) {
    document.execCommand(cmd);
    ref.current?.focus();
    onChange(ref.current?.innerHTML || "");
  }

  function setHeading(tag: string) {
    document.execCommand("formatBlock", false, tag);
    ref.current?.focus();
    onChange(ref.current?.innerHTML || "");
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background px-2 py-1.5">
        <select
          onChange={(e) => setHeading(e.target.value)}
          defaultValue="p"
          className="rounded border border-border bg-surface px-2 py-1 text-xs text-ink outline-none"
        >
          <option value="p">Paragraph</option>
          <option value="h2">Heading</option>
          <option value="h3">Subheading</option>
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
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML || "")}
        data-placeholder={placeholder}
        style={{ minHeight }}
        className="prose-editor px-3 py-2.5 text-sm text-ink outline-none [&_h2]:font-display [&_h2]:text-lg [&_h3]:font-display [&_h3]:text-base [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 empty:before:content-[attr(data-placeholder)] empty:before:text-ink-muted"
      />
    </div>
  );
}
