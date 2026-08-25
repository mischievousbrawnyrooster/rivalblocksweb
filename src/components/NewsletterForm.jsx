import { useId, useState } from 'react'
import { isValidEmail } from '../lib/validate.js'

export default function NewsletterForm() {
  const id = useId()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // ponytail: no backend, POST to a real list endpoint when one exists.
  function onSubmit(e) {
    e.preventDefault()
    if (!isValidEmail(email)) {
      // Validate on submit, not on every keystroke — nobody wants to be told
      // their half-typed address is wrong.
      setError('Enter a valid email address, like player@example.com.')
      return
    }
    setError('')
    setDone(true)
  }

  if (done) {
    return (
      <p role="status" className="border border-live/40 bg-live/10 px-5 py-4 text-sm">
        <strong className="text-live">You are on the list.</strong>{' '}
        <span className="text-muted">
          Season updates and playtest invites go to {email.trim()}.
        </span>
      </p>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full">
      <label htmlFor={id} className="rule-label">
        Get season updates and playtest invites
      </label>

      <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
        <input
          id={id}
          type="email"
          name="email"
          autoComplete="email"
          placeholder="player@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 border border-line bg-bg px-4 py-3 text-sm placeholder:text-muted focus:border-flare focus:outline-none"
        />
        <button
          type="submit"
          className="bg-flare px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90"
        >
          Sign up
        </button>
      </div>

      {/* Always rendered so screen readers announce the message when it appears. */}
      <p
        id={`${id}-error`}
        role="alert"
        aria-live="polite"
        className="mt-2.5 min-h-5 text-sm text-warn"
      >
        {error}
      </p>
    </form>
  )
}
