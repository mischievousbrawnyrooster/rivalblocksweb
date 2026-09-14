import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { getNextAd } from '../data/ads.js'

export default function BannerAd({ className = '' }) {
  const location = useLocation()
  const [ad, setAd] = useState(() => getNextAd())

  // Rotate ad automatically every time the user navigates to a new page
  useEffect(() => {
    setAd(getNextAd())
  }, [location.pathname])

  if (!ad) return null

  return (
    <div
      aria-label="Sponsored transmission banner"
      className={`group relative overflow-hidden border border-line bg-surface p-5 transition-colors hover:border-flare/60 ${className}`}
    >
      <div className="flex items-center justify-between border-b border-line pb-2.5 text-[0.625rem] uppercase tracking-[0.14em] text-muted">
        <span className="flex items-center gap-1.5 text-flare font-bold">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-flare animate-pulse" />
          Holo-Ad Transmission
        </span>
        <span className="border border-line bg-bg px-2 py-0.5 font-mono text-[0.625rem]">
          {ad.badge}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center">
        {/* Ad Image Thumbnail */}
        <div className="relative h-28 w-28 shrink-0 overflow-hidden border border-line bg-bg sm:h-24 sm:w-24">
          <img
            src={ad.image}
            alt={ad.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
          <div className="pointer-events-none absolute inset-0 border border-flare/20" />
        </div>

        {/* Text & Pitch */}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted">
            {ad.sponsor}
          </p>
          <h3 className="display mt-0.5 text-xl leading-tight group-hover:text-flare transition-colors">
            {ad.title}
          </h3>
          <p className="mt-1 text-sm font-semibold text-flare">
            {ad.tagline}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted line-clamp-2">
            {ad.blurb}
          </p>
        </div>

        {/* Action Button */}
        <div className="shrink-0 self-start sm:self-center">
          <Link
            to={ad.href}
            className="inline-block bg-flare px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-on-flare transition-opacity hover:opacity-90 active:scale-95"
          >
            {ad.cta} →
          </Link>
        </div>
      </div>
    </div>
  )
}

