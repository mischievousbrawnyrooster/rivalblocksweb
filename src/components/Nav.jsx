import { useEffect, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import ThemeToggle from './ThemeToggle.jsx'

const links = [
  { to: '/games', label: 'Games' },
  { to: '/servers', label: 'Servers' },
  { to: '/about', label: 'Studio' },
]

const linkClass = ({ isActive }) =>
  `text-xs tracking-[0.16em] uppercase transition-colors ${
    isActive ? 'text-flare' : 'text-muted hover:text-fg'
  }`

export default function Nav() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  // Navigating on a phone should close the menu behind you.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-5">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="block h-3.5 w-3.5 bg-flare" aria-hidden="true" />
          <span className="display text-base">RivalBlocks</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <ThemeToggle />
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center border border-line text-muted md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              {open ? (
                <path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 5.7 18.3 4.3 16.9 10.6 10.6 4.3 4.3 5.7 2.9 12 9.2l4.9-4.9z" />
              ) : (
                <path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `block border-b border-line px-5 py-3.5 text-xs uppercase tracking-[0.16em] ${
                  isActive ? 'text-flare' : 'text-muted'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}
