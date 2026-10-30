import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Close } from './icons'

/** A bottom sheet on phone, a centred popover from 900px: a native modal <dialog> (Esc, focus trap, inert page).
 * Closes on Esc, a backdrop tap or the close button; focus goes back to whatever opened it. */
export default function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const downOnBackdrop = useRef(false)
  const id = useId()

  // Layout effect, so a caller can close a sheet inside flushSync and then move focus itself.
  useLayoutEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      opener.current = document.activeElement as HTMLElement | null
      d.showModal()
    } else if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog ref={ref} className="sheet glass" aria-labelledby={id}
      onClose={() => {
        // Browsers restore focus on close; this covers the ones that drop it on <body>.
        if (!document.activeElement || document.activeElement === document.body) opener.current?.focus()
        onClose()
      }}
      // The dialog box has no padding, so a press on the dialog itself landed on the backdrop. Both the press and the
      // release must be there: a text selection dragged out of the sheet ends on the backdrop too.
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) ref.current?.close() }}>
      <div className="sheet-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="sheet-x" aria-label={`Close ${title.toLowerCase()}`} onClick={() => ref.current?.close()}><Close /></button>
      </div>
      <div className="sheet-body">{open && children}</div>
    </dialog>
  )
}
