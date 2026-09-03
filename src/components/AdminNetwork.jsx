import { useState } from 'react'
import { useMatchSocket, rateOf } from '../lib/useMatchSocket.js'

const FEEDS = [
  { path: '/fracture-ws', label: 'Fracture Line' },
  { path: '/blast-ws', label: 'Blastworks' },
  { path: '/blast-dm-ws', label: 'Blastworks DM' },
  { path: '/ws', label: 'Blockout Royale' },
]

/** Pretty-prints a frame, with the long arrays folded down to a summary. */
function summarise(raw) {
  let msg
  try {
    msg = JSON.parse(raw)
  } catch {
    return raw
  }
  const folded = {}
  for (const [k, v] of Object.entries(msg)) {
    folded[k] = Array.isArray(v) && v.length > 8 ? `[${v.length} entries]` : v
  }
  return JSON.stringify(folded, null, 2)
}

export default function AdminNetwork() {
  const [feed, setFeed] = useState(FEEDS[0].path)
  const [picked, setPicked] = useState(null)
  const { log, status } = useMatchSocket(feed, null)
  const { fps, bps } = rateOf(log)

  const recent = [...log].reverse().slice(0, 40)
  const shown = recent.find((f) => f.n === picked) ?? recent[0]
  const total = log.reduce((n, f) => n + f.bytes, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {FEEDS.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => {
              setFeed(f.path)
              setPicked(null)
            }}
            className={`border px-4 py-2 text-xs uppercase tracking-[0.12em] transition-colors ${
              feed === f.path
                ? 'border-flare text-flare'
                : 'border-line text-muted hover:border-flare hover:text-flare'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-muted">
          {status === 'live' ? 'Reading' : 'No answer'} · ws://{feed}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="border border-line bg-surface p-4">
          <p className="rule-label">Frame rate</p>
          <p className="display mt-1.5 text-2xl tabular-nums">{fps.toFixed(1)} Hz</p>
        </div>
        <div className="border border-line bg-surface p-4">
          <p className="rule-label">Throughput</p>
          <p className="display mt-1.5 text-2xl tabular-nums">{(bps / 1024).toFixed(1)} KiB/s</p>
        </div>
        <div className="border border-line bg-surface p-4">
          <p className="rule-label">Mean frame</p>
          <p className="display mt-1.5 text-2xl tabular-nums">
            {log.length ? Math.round(total / log.length) : 0} B
          </p>
        </div>
        <div className="border border-line bg-surface p-4">
          <p className="rule-label">Captured</p>
          <p className="display mt-1.5 text-2xl tabular-nums">{log.length}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <div className="border border-line">
          <p className="rule-label border-b border-line bg-surface px-4 py-3">Frames</p>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto text-xs">
            {recent.map((f) => (
              <li key={f.n}>
                <button
                  type="button"
                  onClick={() => setPicked(f.n)}
                  className={`flex w-full items-baseline gap-3 px-4 py-2 text-left transition-colors hover:bg-surface ${
                    shown?.n === f.n ? 'bg-surface text-flare' : 'text-muted'
                  }`}
                >
                  <span className="font-mono tabular-nums">#{f.n}</span>
                  <span className="uppercase tracking-[0.12em]">{f.t}</span>
                  <span className="ml-auto font-mono tabular-nums">{f.bytes} B</span>
                </button>
              </li>
            ))}
            {recent.length === 0 && <li className="px-4 py-3 text-muted">Nothing yet.</li>}
          </ul>
        </div>

        <div className="border border-line">
          <p className="rule-label border-b border-line bg-surface px-4 py-3">
            {shown ? `Frame #${shown.n} · ${shown.bytes} bytes` : 'Frame'}
          </p>
          <pre className="max-h-96 overflow-auto p-4 font-mono text-xs leading-relaxed text-muted">
            {shown ? summarise(shown.raw) : '—'}
          </pre>
        </div>
      </div>

      <p className="border-l-2 border-flare pl-4 text-xs leading-relaxed text-muted">
        Frames are read from this browser's own socket, exactly as they arrive:
        uncompressed JSON over plain ws://, with permessage-deflate off. What is
        listed here is byte for byte what a capture on the wire shows, which is
        the whole reason the protocol is shaped this way. Arrays longer than
        eight entries are folded in the viewer only — the frame itself is intact.
      </p>
    </div>
  )
}
