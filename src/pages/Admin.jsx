import { useState } from 'react'
import AdminMatch from '../components/AdminMatch.jsx'
import AdminNetwork from '../components/AdminNetwork.jsx'
import AdminStudio from '../components/AdminStudio.jsx'
import { useTitle } from '../lib/useTitle.js'

// ponytail: one shared operator credential, checked in the browser. This is a
// lab console on a trusted segment — the check keeps the page out of the way of
// people who wander in, and it is not a security boundary. Anyone can read this
// out of the bundle, and the key it sends travels in cleartext over the same
// plain ws:// the game uses. Put a real identity provider and TLS in front of
// this before the console is reachable from anywhere that matters.
const OPERATOR = 'admin'
const KEY = 'admin'
const SESSION = 'rb-operator'

const TABS = [
  { id: 'match', label: 'Match control' },
  { id: 'network', label: 'Network' },
  { id: 'studio', label: 'Studio' },
]

function SignIn({ onPass }) {
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [failed, setFailed] = useState(false)

  return (
    <section className="blueprint mx-auto max-w-md px-5 py-24">
      <p className="rule-label">RivalBlocks</p>
      <h1 className="display mt-2 text-4xl">Operations</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Internal console. Match servers, live protocol and fleet reporting.
      </p>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (user === OPERATOR && pass === KEY) {
            sessionStorage.setItem(SESSION, '1')
            onPass()
          } else {
            setFailed(true)
          }
        }}
      >
        <div>
          <label htmlFor="op-user" className="rule-label">
            Operator
          </label>
          <input
            id="op-user"
            value={user}
            autoComplete="username"
            onChange={(e) => setUser(e.target.value)}
            className="mt-2 w-full border border-line bg-surface px-4 py-3 text-sm"
          />
        </div>
        <div>
          <label htmlFor="op-key" className="rule-label">
            Key
          </label>
          <input
            id="op-key"
            type="password"
            value={pass}
            autoComplete="current-password"
            onChange={(e) => setPass(e.target.value)}
            className="mt-2 w-full border border-line bg-surface px-4 py-3 text-sm"
          />
        </div>

        {failed && (
          <p role="alert" className="border-l-2 border-warn pl-3 text-sm text-warn">
            That pair was not recognised.
          </p>
        )}

        <button
          type="submit"
          className="w-full bg-flare px-7 py-3.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
        >
          Sign in
        </button>
      </form>
    </section>
  )
}

export default function Admin() {
  useTitle('Operations')

  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION) === '1'
    } catch {
      // Private windows and locked-down browsers throw rather than return null.
      return false
    }
  })
  const [tab, setTab] = useState('match')

  if (!open) return <SignIn onPass={() => setOpen(true)} />

  return (
    <section className="mx-auto max-w-6xl px-5 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="rule-label">Internal</p>
          <h1 className="display mt-1 text-3xl">Operations</h1>
        </div>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(SESSION)
            setOpen(false)
          }}
          className="border border-line px-5 py-2.5 text-xs uppercase tracking-[0.12em] text-muted transition-colors hover:border-flare hover:text-flare"
        >
          Sign out
        </button>
      </div>

      <div role="tablist" aria-label="Console sections" className="mt-8 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`border px-5 py-2.5 text-xs uppercase tracking-[0.12em] transition-colors ${
              tab === t.id
                ? 'border-flare text-flare'
                : 'border-line text-muted hover:border-flare hover:text-flare'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="mt-8"
      >
        {tab === 'match' && <AdminMatch adminKey={KEY} />}
        {tab === 'network' && <AdminNetwork />}
        {tab === 'studio' && <AdminStudio />}
      </div>
    </section>
  )
}
