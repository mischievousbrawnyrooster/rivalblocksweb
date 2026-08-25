import { useEffect, useRef } from 'react'
import BlockArt from './BlockArt.jsx'

/**
 * @param {Array} shots     [{ seed, caption }]
 * @param {number} index    which shot is open
 * @param {string} variant  BlockArt variant for this game
 * @param {Function} onClose
 * @param {Function} onNavigate  (nextIndex) => void
 */
export default function Lightbox({ shots, index, variant, onClose, onNavigate }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') return onClose()
      if (e.key === 'ArrowRight') return onNavigate((index + 1) % shots.length)
      if (e.key === 'ArrowLeft') return onNavigate((index - 1 + shots.length) % shots.length)
      if (e.key !== 'Tab') return

      // Focus trap: keep Tab inside the dialog.
      const focusable = panelRef.current?.querySelectorAll('button')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    // Stop the page behind the dialog from scrolling.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [index, shots.length, onClose, onNavigate])

  const shot = shots[index]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Screenshot ${index + 1} of ${shots.length}: ${shot.caption}`}
        className="w-full max-w-3xl border border-line bg-bg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-line px-4 py-3">
          <span className="rule-label">
            {index + 1} / {shots.length}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="ml-auto text-xs uppercase tracking-[0.16em] text-muted hover:text-flare"
          >
            Close
          </button>
        </div>

        <div className="blueprint flex aspect-16/10 items-center justify-center p-8">
          <BlockArt
            variant={variant}
            seed={shot.seed}
            title={shot.caption}
            className="h-full w-full object-contain"
          />
        </div>

        <div className="flex items-center gap-4 border-t border-line px-4 py-3">
          <p className="text-sm text-muted">{shot.caption}</p>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => onNavigate((index - 1 + shots.length) % shots.length)}
              className="border border-line px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-muted hover:border-flare hover:text-flare"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => onNavigate((index + 1) % shots.length)}
              className="border border-line px-3 py-1.5 text-xs uppercase tracking-[0.16em] text-muted hover:border-flare hover:text-flare"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
