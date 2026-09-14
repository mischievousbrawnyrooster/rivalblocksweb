import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ads, getRandomAd } from '../data/ads.js'

export default function FlankingAds() {
  const location = useLocation()
  const [leftAd, setLeftAd] = useState(() => ads[0])
  const [rightAd, setRightAd] = useState(() => ads[1] ?? ads[0])
  const [closedLeft, setClosedLeft] = useState(false)
  const [closedRight, setClosedRight] = useState(false)

  // Rotate ads on every page navigation
  useEffect(() => {
    const l = getRandomAd()
    const r = getRandomAd(l.id)
    setLeftAd(l)
    setRightAd(r)
  }, [location.pathname])

  return (
    <>
      {/* Left Flanking Skyscraper Ad */}
      {!closedLeft && leftAd && (
        <aside
          aria-label="Sponsored transmission left"
          className="pointer-events-auto fixed top-24 left-3 z-30 hidden w-44 xl:flex flex-col border border-line bg-surface/95 backdrop-blur p-3 shadow-2xl transition-colors hover:border-flare/60"
        >
          <div className="flex items-center justify-between border-b border-line pb-2 text-[0.5625rem] uppercase tracking-wider text-muted">
            <span className="flex items-center gap-1 text-flare font-bold">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-flare animate-pulse" />
              Holo-Ad
            </span>
            <button
              type="button"
              onClick={() => setClosedLeft(true)}
              aria-label="Close ad"
              className="text-muted hover:text-flare px-1"
            >
              ✕
            </button>
          </div>

          <div className="relative mt-2.5 aspect-3/4 overflow-hidden border border-line bg-bg">
            <img
              src={leftAd.image}
              alt={leftAd.title}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
              loading="lazy"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent opacity-80" />
          </div>

          <div className="mt-2.5">
            <span className="border border-line bg-bg px-1 py-0.5 font-mono text-[0.5625rem] text-muted">
              {leftAd.badge}
            </span>
            <h4 className="display mt-1 text-sm font-bold leading-tight">
              {leftAd.title}
            </h4>
            <p className="mt-1 text-[0.6875rem] font-medium leading-tight text-flare">
              {leftAd.tagline}
            </p>
          </div>

          <Link
            to={leftAd.href}
            className="mt-3 block w-full bg-flare/10 border border-flare/40 py-1.5 text-center text-[0.625rem] font-bold uppercase tracking-[0.12em] text-flare transition-all hover:bg-flare hover:text-on-flare"
          >
            {leftAd.cta} →
          </Link>
        </aside>
      )}

      {/* Right Flanking Skyscraper Ad */}
      {!closedRight && rightAd && (
        <aside
          aria-label="Sponsored transmission right"
          className="pointer-events-auto fixed top-24 right-3 z-30 hidden w-44 xl:flex flex-col border border-line bg-surface/95 backdrop-blur p-3 shadow-2xl transition-colors hover:border-flare/60"
        >
          <div className="flex items-center justify-between border-b border-line pb-2 text-[0.5625rem] uppercase tracking-wider text-muted">
            <span className="flex items-center gap-1 text-flare font-bold">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-flare animate-pulse" />
              Holo-Ad
            </span>
            <button
              type="button"
              onClick={() => setClosedRight(true)}
              aria-label="Close ad"
              className="text-muted hover:text-flare px-1"
            >
              ✕
            </button>
          </div>

          <div className="relative mt-2.5 aspect-3/4 overflow-hidden border border-line bg-bg">
            <img
              src={rightAd.image}
              alt={rightAd.title}
              className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
              loading="lazy"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent opacity-80" />
          </div>

          <div className="mt-2.5">
            <span className="border border-line bg-bg px-1 py-0.5 font-mono text-[0.5625rem] text-muted">
              {rightAd.badge}
            </span>
            <h4 className="display mt-1 text-sm font-bold leading-tight">
              {rightAd.title}
            </h4>
            <p className="mt-1 text-[0.6875rem] font-medium leading-tight text-flare">
              {rightAd.tagline}
            </p>
          </div>

          <Link
            to={rightAd.href}
            className="mt-3 block w-full bg-flare/10 border border-flare/40 py-1.5 text-center text-[0.625rem] font-bold uppercase tracking-[0.12em] text-flare transition-all hover:bg-flare hover:text-on-flare"
          >
            {rightAd.cta} →
          </Link>
        </aside>
      )}
    </>
  )
}

