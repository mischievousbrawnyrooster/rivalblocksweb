import { useEffect } from 'react'
import { markHref } from './favicons.js'

/**
 * Swaps the tab icon for a route, and puts the studio mark back on the way
 * out. The pair to useTitle: an SPA changes neither for you, and a tab left
 * wearing Blastworks on the careers page is just wrong.
 *
 * The link element is the one index.html ships with. It is reused rather than
 * replaced, because some browsers ignore a second icon link and keep the
 * first, and others cache the old one until the element itself changes.
 */
export function useFavicon(name) {
  useEffect(() => {
    const link = document.querySelector('link[rel="icon"]')
    if (!link) return undefined
    link.href = markHref(name)
    return () => {
      link.href = markHref('rivalblocks')
    }
  }, [name])
}
