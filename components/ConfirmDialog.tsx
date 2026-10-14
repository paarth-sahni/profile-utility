"use client";

/**
 * Purpose: the app's branded confirmation dialog (replaces window.confirm). Built on the native <dialog>
 * element opened with showModal(), so the browser provides the focus trap, makes the rest of the page inert,
 * and handles Esc. Esc, a click on the backdrop and the cancel button all choose the SAFE answer (onCancel);
 * focus starts on that button and returns to where it was when the dialog closes. Render it only while it
 * should be open (mounting opens it, unmounting closes it).
 */
import { useEffect, useId, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  /** The action that loses something (e.g. "Yes, discard"). */
  confirmLabel: string;
  /** The safe answer (e.g. "No, keep it"); also what Esc and the backdrop choose. */
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra content under the message (e.g. a required checkbox). */
  children?: ReactNode;
}

export default function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel, children }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Remember who had focus: the dialog is removed from the page when the parent unmounts it, and by then the
    // browser can no longer hand focus back on its own.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      opener?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(e) => {
        e.preventDefault(); // Esc: let the parent decide (it unmounts the dialog)
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel(); // click on the backdrop
      }}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-md border border-hairline bg-white p-0 text-ink shadow-lg backdrop:bg-ink/50"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-medium text-ink-dark">
          {title}
        </h2>
        <p id={messageId} className="mt-2 text-sm text-ink-light">
          {message}
        </p>
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-ink transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
