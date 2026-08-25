import { useEffect } from 'react'

const SUFFIX = 'RivalBlocks'

/** Sets the document title for a route. An SPA does not do this for you. */
export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — ${SUFFIX}` : SUFFIX
  }, [title])
}
