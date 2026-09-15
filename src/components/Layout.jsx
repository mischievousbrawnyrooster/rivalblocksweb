import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Nav from './Nav.jsx'
import Footer from './Footer.jsx'

export default function Layout() {
  const { pathname } = useLocation()

  // A router swap keeps the old scroll position otherwise, which lands you
  // halfway down a page you have not seen the top of.
  //
  // Block body, not a concise arrow: html has scroll-behavior:smooth, which
  // makes scrollTo return a Promise. Returning it from an effect makes React
  // treat it as the cleanup function and throw on unmount.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [pathname])

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-flare focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-on-flare"
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </>
  )
}
