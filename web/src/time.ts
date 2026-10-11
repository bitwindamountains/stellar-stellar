// Wall-clock time in an IANA zone <-> UTC, using only Intl (no date library).

function zoneParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms))
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') }
}

/** "2026-10-05T18:00" as wall time in `timeZone` -> ISO UTC string. */
export function zonedToUtc(local: string, timeZone: string): string {
  const [date, time] = local.split('T')
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  let guess = wall
  for (let i = 0; i < 2; i++) {
    // Shift by the zone's offset at the guess; a second pass settles DST edges.
    const p = zoneParts(guess, timeZone)
    guess += wall - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi)
  }
  return new Date(guess).toISOString()
}

/** ISO UTC -> "2026-10-05T18:00" wall time in `timeZone` (for <input type="datetime-local">). */
export function utcToZoned(iso: string, timeZone: string): string {
  const p = zoneParts(new Date(iso).getTime(), timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`
}

function addDays(local: string, days: number): string {
  const [y, mo, d] = local.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10)
}

/** One-tap schedule times as wall-clock values in `timeZone`: in 1 hour, tonight 7 pm, tomorrow 9 am. */
export function quickTimes(timeZone: string, now = new Date()): { label: string; value: string }[] {
  const local = utcToZoned(now.toISOString(), timeZone)
  const today = local.slice(0, 10)
  const tonight = local < `${today}T19:00` ? `${today}T19:00` : `${addDays(today, 1)}T19:00`
  return [
    { label: 'In 1 hour', value: utcToZoned(new Date(now.getTime() + 3_600_000).toISOString(), timeZone) },
    { label: local < `${today}T19:00` ? 'Tonight 7 pm' : 'Tomorrow 7 pm', value: tonight },
    { label: 'Tomorrow 9 am', value: `${addDays(today, 1)}T09:00` },
  ]
}
