import { useMatchSocket, rateOf } from '../lib/useMatchSocket.js'

const ARENAS = ['kiln', 'substation', 'drydock', 'scrapyard']

function Stat({ label, value, hint }) {
  return (
    <div className="border border-line bg-surface p-4">
      <p className="rule-label">{label}</p>
      <p className="display mt-1.5 text-2xl tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

function Roster({ players, onKick }) {
  if (!players?.length) return <p className="text-sm text-muted">Nobody in the arena.</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-line text-left">
          <th className="rule-label pb-2 font-normal">Operator</th>
          <th className="rule-label pb-2 text-right font-normal">K</th>
          <th className="rule-label pb-2 text-right font-normal">D</th>
          <th className="rule-label pb-2 text-right font-normal">HP</th>
          <th className="pb-2" />
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={p.id} className="border-b border-line/60">
            <td className="py-2">
              <span className={p.alive ? '' : 'text-muted'}>{p.name}</span>
              {p.bot && <span className="rule-label ml-2">bot</span>}
            </td>
            <td className="py-2 text-right font-mono tabular-nums">{p.kills}</td>
            <td className="py-2 text-right font-mono tabular-nums">{p.deaths}</td>
            <td className="py-2 text-right font-mono tabular-nums">{p.alive ? p.hp : '—'}</td>
            <td className="py-2 text-right">
              {onKick && !p.bot && (
                <button
                  type="button"
                  onClick={() => onKick(p.id)}
                  className="border border-line px-2.5 py-1 text-[0.625rem] uppercase tracking-[0.12em] text-muted transition-colors hover:border-warn hover:text-warn"
                >
                  Drop
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MatchPanel({ title, path, controllable, adminKey }) {
  const { state, status, log, authed, send } = useMatchSocket(path, controllable ? adminKey : null)
  const { fps, bps } = rateOf(log)
  const players = state?.players ?? []
  const live = players.filter((p) => !p.bot).length

  return (
    <section className="border border-line">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line bg-surface px-5 py-4">
        <h2 className="display text-xl">{title}</h2>
        <div className="flex items-center gap-2 text-[0.6875rem] uppercase tracking-[0.16em]">
          <span
            aria-hidden="true"
            className={status === 'live' ? 'text-live' : 'text-warn'}
          >
            ●
          </span>
          <span className={status === 'live' ? 'text-live' : 'text-warn'}>
            {status === 'live' ? 'Connected' : 'No answer'}
          </span>
          <span className="text-muted">· {path}</span>
        </div>
      </header>

      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Operators" value={live} hint={`${players.length - live} bots filling`} />
        <Stat label="Phase" value={state?.phase ?? '—'} hint={state?.arena ?? ''} />
        <Stat label="Tick" value={`${fps.toFixed(1)} Hz`} hint="frames leaving the server" />
        <Stat
          label="Downstream"
          value={`${(bps / 1024).toFixed(1)} KiB/s`}
          hint="per connected client"
        />
      </div>

      <div className="border-t border-line px-5 py-5">
        <Roster players={players} onKick={controllable && authed ? (id) => send({ t: 'kick', id }) : null} />
      </div>

      {controllable && (
        <div className="border-t border-line px-5 py-5">
          <p className="rule-label">Match control</p>
          {!authed ? (
            <p className="mt-2 text-sm text-warn">
              The match server did not accept the operator key. Controls are held back.
            </p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {ARENAS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => send({ t: 'arena', name })}
                    className={`border px-4 py-2 text-xs uppercase tracking-[0.12em] transition-colors ${
                      state?.arena === name
                        ? 'border-flare text-flare'
                        : 'border-line text-muted hover:border-flare hover:text-flare'
                    }`}
                  >
                    {name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => send({ t: 'restart' })}
                  className="border border-line px-4 py-2 text-xs uppercase tracking-[0.12em] text-muted transition-colors hover:border-flare hover:text-flare"
                >
                  Restart match
                </button>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {/* This is a floor on total participants, not a bot count: bots
                    only fill what people have not taken. Setting 5 with three
                    operators connected leaves two bots, not five. */}
                <span className="rule-label">Fill arena to</span>
                {[0, 2, 3, 5, 8].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => send({ t: 'bots', n })}
                    className="min-w-10 border border-line px-3 py-1.5 text-xs tabular-nums text-muted transition-colors hover:border-flare hover:text-flare"
                  >
                    {n}
                  </button>
                ))}
                <span className="text-xs text-muted">
                  {players.length} in the arena, {players.filter((p) => p.bot).length} of them bots.
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

export default function AdminMatch({ adminKey }) {
  return (
    <div className="space-y-8">
      <MatchPanel
        title="Fracture Line — browser trial"
        path="/fracture-ws"
        controllable
        adminKey={adminKey}
      />
      <MatchPanel title="Blockout Royale — browser trial" path="/ws" />
      <p className="border-l-2 border-line pl-4 text-xs leading-relaxed text-muted">
        Blockout Royale is observed only. Its match server exposes no control
        channel, so this console reads its broadcast and nothing more.
      </p>
    </div>
  )
}
