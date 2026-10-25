import { useEffect, useState } from 'react'
import { IconClock } from '../icons.tsx'
import { useJmri } from '../state.tsx'

/** JMRI's fast clock. The server pushes once per fast minute; we interpolate between pushes. */
export function FastClock() {
  const time = useJmri((s) => s.time)
  const timeAt = useJmri((s) => s.timeAt)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const t = time ? Date.parse(time.time) : NaN
  if (!time || Number.isNaN(t)) return null
  const running = time.state === 2
  const fast = new Date(t + (running ? Math.max(0, now - timeAt) * time.rate : 0))
  const label = fast.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <span className="pill" title={`Fast clock ${running ? `running at ${time.rate}×` : 'stopped'}`}>
      <IconClock style={{ width: 14, height: 14 }} />
      <span className="clock">{label}</span>
      {time.rate !== 1 && <span>{time.rate}×</span>}
    </span>
  )
}
