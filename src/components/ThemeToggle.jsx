import { useEffect, useState } from 'react'

const KEY = 'rb-theme'

export default function ThemeToggle() {
  // index.html already resolved the real theme before paint; read it back
  // rather than guessing, so the button never disagrees with the page.
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || 'dark',
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* private mode: the theme just will not persist */
    }
  }, [theme])

  const dark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-pressed={!dark}
      title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex h-9 w-9 items-center justify-center border border-line text-muted transition-colors hover:border-flare hover:text-flare"
    >
      <span className="sr-only">
        {dark ? 'Switch to light theme' : 'Switch to dark theme'}
      </span>
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        {dark ? (
          <path d="M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-13a1 1 0 0 1-1-1V1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1Zm0 19a1 1 0 0 1-1-1v-2a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1ZM4 13H2a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2Zm18 0h-2a1 1 0 1 1 0-2h2a1 1 0 1 1 0 2ZM5.6 6.99 4.19 5.58a1 1 0 0 1 1.42-1.42L7 5.58A1 1 0 0 1 5.6 7Zm12.8 12.82-1.4-1.41a1 1 0 0 1 1.41-1.42l1.41 1.41a1 1 0 0 1-1.42 1.42ZM18.4 6.99A1 1 0 0 1 17 5.58l1.4-1.42a1 1 0 1 1 1.42 1.42ZM5.6 19.81a1 1 0 0 1-1.41-1.42l1.4-1.41A1 1 0 0 1 7 18.4Z" />
        ) : (
          <path d="M12.3 22a10 10 0 0 1-1.4-19.9 1 1 0 0 1 1 1.55 8 8 0 0 0 9.45 12.1 1 1 0 0 1 1.28 1.33A10 10 0 0 1 12.3 22Z" />
        )}
      </svg>
    </button>
  )
}
