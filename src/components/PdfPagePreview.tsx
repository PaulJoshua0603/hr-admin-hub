"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders the first page of a PDF into a canvas so values can be positioned over it.
 * Loading is lazy: pdf.js is a large dependency and is only pulled in when a template
 * is actually being previewed.
 */
export function PdfPagePreview({
  dataUrl,
  onSize,
  className = "",
}: {
  dataUrl: string;
  onSize?: (size: { width: number; height: number }) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    async function render() {
      setLoading(true);
      setError(null);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (c) =>
          c.charCodeAt(0)
        );
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        if (cancelled) return;

        // Render at 2x for a crisp background, then let CSS scale it to the container.
        const viewport = page.getViewport({ scale: 2 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        if (!context) return;

        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        task = renderTask;
        await renderTask.promise;
        if (cancelled) return;
        onSize?.({ width: viewport.width, height: viewport.height });
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not render this PDF.");
        setLoading(false);
      }
    }

    render();
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // onSize is a render-scoped callback; re-rendering the PDF when it changes identity
    // would loop, so the preview only re-renders when the file itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl]);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={canvasRef} className="block h-auto w-full rounded-md border border-border" />
      {loading && !error && (
        <p className="absolute inset-x-0 top-4 text-center text-xs text-ink-muted">Rendering template…</p>
      )}
      {error && (
        <p className="absolute inset-x-0 top-4 text-center text-xs text-warn">{error}</p>
      )}
    </div>
  );
}
