'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface ConfirmOptions {
  /** The question itself: «این پوزیشن حذف شود؟» — never «آیا مطمئن هستید؟». */
  title: string;
  /** What happens, briefly (e.g. that it cannot be undone). */
  body?: ReactNode;
  /** The action, named: «حذف», «حذف پوزیشن» — never «بله». */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions get the danger colour. */
  danger?: boolean;
}

/**
 * In-app confirmation (instead of `window.confirm`, whose OK / Cancel follow the
 * browser's language and ignore RTL). Native <dialog>: top layer, focus kept inside,
 * Escape and a click outside cancel. Focus starts on «انصراف», so Enter never deletes.
 */
function ConfirmDialog({ title, body, confirmLabel, cancelLabel = 'انصراف', danger = true, onDone }: ConfirmOptions & { onDone: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
  }, []);

  return (
    <dialog
      ref={ref}
      dir="rtl"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onDone(false);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDone(false);
      }}
      className="sx-pop m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-default bg-surface p-0 text-primary backdrop:bg-black/70"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-lg font-semibold leading-7">
          {title}
        </h2>
        {body && (
          <div id={bodyId} className="text-sm leading-6 text-secondary">
            {body}
          </div>
        )}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus onClick={() => onDone(false)} className="tap min-h-11 rounded-lg border border-strong px-4 text-[15px] text-primary hover:bg-elevated transition-colors">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onDone(true)}
            className={`tap min-h-11 rounded-lg px-4 text-[15px] font-semibold transition hover:brightness-110 ${danger ? 'bg-danger text-on-brand' : 'bg-brand text-on-brand'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * `const [confirmDialog, confirm] = useConfirm();` — render `confirmDialog` once, then
 * `if (await confirm({ title: 'این پوزیشن حذف شود؟', confirmLabel: 'حذف' })) remove();`
 */
export function useConfirm(): [ReactNode, (o: ConfirmOptions) => Promise<boolean>] {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => setReq({ ...o, resolve })), []);
  const dialog = req ? (
    <ConfirmDialog
      {...req}
      onDone={(ok) => {
        req.resolve(ok);
        setReq(null);
      }}
    />
  ) : null;
  return [dialog, confirm];
}
