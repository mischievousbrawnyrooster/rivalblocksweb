import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getNextAd } from '../data/ads.js'

export default function SidebarAd({ className = '' }) {
  const location = useLocation()
  const [ad, setAd] = useState(() => getNextAd())

  // Rotate ad automatically every time the user navigates to a new page
  useEffect(() => {
    setAd(getNextAd())
  }, [location.pathname])

  if (!ad) return null

  return (
    <aside
      aria-label="Sponsored transmission"
      className={`group relative overflow-hidden border border-line bg-surface p-4 transition-colors hover:border-flare/60 ${className}`}
    >
      {/* Top Header Tag */}
      <div className="flex items-center justify-between border-b border-line pb-2.5 text-[0.625rem] uppercase tracking-[0.14em] text-muted">
        <span className="flex items-center gap-1.5 text-flare">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-flare animate-pulse" />
          Holo-Ad
        </span>
        <span className="border border-line bg-bg px-1.5 py-0.5 font-mono text-[0.5625rem]">
          {ad.badge}
        </span>
      </div>

      {/* Ad Image with Blueprint Framing */}
      <div className="relative mt-3 aspect-4/3 overflow-hidden border border-line bg-bg">
        <img
          src={ad.image}
          alt={ad.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent opacity-80" />
        <div className="pointer-events-none absolute inset-0 border border-flare/10" />
      </div>

      {/* Sponsor Info & Pitch */}
      <div className="mt-3">
        <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">
          {ad.sponsor}
        </p>
        <h4 className="display mt-1 text-lg leading-tight group-hover:text-flare transition-colors">
          {ad.title}
        </h4>
        <p className="mt-1 text-xs font-semibold text-flare">
          {ad.tagline}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted line-clamp-2">
          {ad.blurb}
        </p>
      </div>

      {/* Action Button */}
      <div className="mt-4 pt-3 border-t border-line">
        <Link
          to={ad.href}
          className="block w-full text-center bg-flare/10 border border-flare/40 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-flare transition-all hover:bg-flare hover:text-on-flare"
        >
          {ad.cta} →
        </Link>
      </div>
    </aside>
  )
}

