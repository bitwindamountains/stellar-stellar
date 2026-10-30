import type { ReactNode } from 'react'
import { Alert, Chevron } from '../icons'

/** One setting of the post as a full-width row ("Media · Photo ›") that opens its sheet; its problems sit under it.
 * Problems show live but quiet; once the section was left or a save was blocked (`alert`) they turn amber and
 * are announced. The row's id is `row-<name>`, its problems' `err-<name>` (fields in the sheet point at them). */
export default function SettingRow({ name, icon, label, value, warnings = [], alert = false, onOpen }: {
  name: string
  icon: ReactNode
  label: string
  value: string
  warnings?: string[]
  alert?: boolean
  onOpen: () => void
}) {
  return (
    <div className="s-row">
      <button id={`row-${name}`} type="button" className="s-btn" aria-haspopup="dialog" onClick={onOpen}
        {...(warnings.length ? { 'aria-describedby': `err-${name}` } : {})} {...(alert && warnings.length ? { 'aria-invalid': true } : {})}>
        <span className="s-icon">{icon}</span>
        <span className="s-label">{label}</span>
        <span className="s-value">{value}</span>
        <Chevron />
      </button>
      <FieldError id={`err-${name}`} messages={warnings} alert={alert} />
    </div>
  )
}

/** A section's problems. With an id, fields point at it (aria-describedby); `alert` announces it when it appears. */
export function FieldError({ id, messages, alert = true }: { id?: string; messages: string[]; alert?: boolean }) {
  if (!messages.length) return null
  return (
    <ul id={id} className={alert ? 'field-error' : 'field-error quiet'} role={alert ? 'alert' : undefined}>
      {messages.map((m) => <li key={m}><Alert label="Problem" />{m}</li>)}
    </ul>
  )
}
