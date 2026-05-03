import { useEffect } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  variant: 'text' | 'json';
  content: unknown;
};

function format(variant: 'text' | 'json', content: unknown): string {
  if (variant === 'text') return content == null ? '' : String(content);
  try {
    const obj = typeof content === 'string' ? JSON.parse(content) : content;
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(content);
  }
}

export function ContentModal({ open, onClose, title, variant, content }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const formatted = format(variant, content);

  return createPortal(
    <div
      role="dialog" aria-modal="true"
      data-testid="content-modal-backdrop"
      onClick={onClose}
      className="fixed inset-0 bg-bg/80 backdrop-blur-sm flex items-start justify-center pt-16 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="text-sm font-medium text-text">{title ?? 'Content'}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void navigator.clipboard.writeText(formatted); }}
              className="text-xs border border-border hover:border-border-strong text-text-muted hover:text-text px-2 py-1 rounded transition"
            >
              Copy
            </button>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text text-xl leading-none px-2"
              aria-label="Close"
            >×</button>
          </div>
        </header>
        <pre className="flex-1 overflow-auto px-4 py-3 text-xs font-mono text-text whitespace-pre-wrap">
          {formatted}
        </pre>
      </div>
    </div>,
    document.body,
  );
}
