import { useCallback, useEffect, useRef, useState } from 'react'

// Frames arrive at the match tick rate. Keeping the last few seconds is enough
// to show a rate and a recent history without holding the whole session.
const KEEP = 240
// React is told about new frames this often, not thirty times a second. The
// ring buffer underneath still sees every single one.
const REFRESH_MS = 250

/**
 * An observing connection to a match server. It never joins, so it takes no
 * slot and changes nothing — the broadcast goes to every open socket, which is
 * exactly what makes read-only observation possible without a second protocol.
 *
 * Returns the latest snapshot, connection status, a frame log for the
 * inspector, and a send() for operator commands.
 */
export function useMatchSocket(path, adminKey) {
  const [state, setState] = useState(null)
  const [status, setStatus] = useState('connecting')
  const [log, setLog] = useState([])
  const [authed, setAuthed] = useState(false)

  const wsRef = useRef(null)
  const ringRef = useRef([])
  const seenRef = useRef(0)

  const send = useCallback((msg) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${scheme}://${window.location.host}${path}`)
    wsRef.current = ws
    setStatus('connecting')

    ws.onopen = () => {
      setStatus('live')
      if (adminKey) ws.send(JSON.stringify({ t: 'admin', key: adminKey }))
    }
    ws.onmessage = (e) => {
      const raw = typeof e.data === 'string' ? e.data : ''
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      seenRef.current += 1
      const ring = ringRef.current
      ring.push({
        n: seenRef.current,
        at: performance.now(),
        // The byte count of the frame as it came off the wire, so the inspector
        // reports what a capture would report.
        bytes: new Blob([raw]).size,
        t: msg.t,
        raw,
      })
      if (ring.length > KEEP) ring.shift()
      if (msg.t === 'admin') setAuthed(msg.ok === true)
    }
    ws.onclose = () => setStatus('closed')
    ws.onerror = () => ws.close()
    return () => ws.close()
  }, [path, adminKey])

  // Drain the ring into React on a timer. Rendering per frame would peg the
  // page for no benefit — nobody can read thirty updates a second.
  useEffect(() => {
    const id = setInterval(() => {
      const ring = ringRef.current
      const latest = [...ring].reverse().find((f) => f.t === 'state')
      if (latest) {
        try {
          setState(JSON.parse(latest.raw))
        } catch {
          /* a torn frame is not worth a crash */
        }
      }
      setLog([...ring])
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [])

  return { state, status, log, authed, send }
}

/** Frames per second and bytes per second over the tail of the log. */
export function rateOf(log, windowMs = 2000) {
  if (log.length < 2) return { fps: 0, bps: 0 }
  const now = log[log.length - 1].at
  const recent = log.filter((f) => now - f.at <= windowMs)
  if (recent.length < 2) return { fps: 0, bps: 0 }
  const span = (recent[recent.length - 1].at - recent[0].at) / 1000
  if (span <= 0) return { fps: 0, bps: 0 }
  const bytes = recent.reduce((n, f) => n + f.bytes, 0)
  return { fps: (recent.length - 1) / span, bps: bytes / span }
}
