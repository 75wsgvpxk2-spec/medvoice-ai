import { useEffect, useRef, type ReactNode } from 'react';

/**
 * §3B — Focus Mode.
 *
 * When accuracy matters more than atmosphere, the room steps back and an
 * ordinary, high-legibility interface comes forward. The existing screens are
 * rendered inside it unchanged: §24 is explicit that mature screens are wrapped
 * rather than rewritten, so a clinician approving a note is looking at exactly
 * the interface that was reviewed, tested and shipped.
 *
 * The room stays visible behind, dimmed and inert. That is what keeps the
 * product one place rather than two — but the panel is a real modal surface,
 * so nothing behind it can be clicked by accident while a note is open.
 */
export function FocusLayer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /*
   * Focus moves into the panel when it opens. Without this the keyboard is
   * still in the room behind — the number keys would keep flying the camera
   * around underneath an open clinical form, which is both disorienting and a
   * good way to lose your place mid-note.
   */
  useEffect(() => {
    panel.current?.focus();
  }, [title]);

  return (
    <div className="room-focus" role="dialog" aria-modal="true" aria-label={title}>
      <div className="room-focus-panel" ref={panel} tabIndex={-1}>
        <div className="room-focus-bar">
          <span className="focus-breadcrumb">
            <span className="focus-live" aria-hidden="true" />
            Command room <span aria-hidden="true">/</span> <strong>{title}</strong>
          </span>
          <button className="focus-close" onClick={onClose}>
            Back to the room <span aria-hidden="true">Esc</span>
          </button>
        </div>
        <div className="room-focus-body">{children}</div>
      </div>
    </div>
  );
}
