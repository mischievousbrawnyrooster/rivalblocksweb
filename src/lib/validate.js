const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** True if the trimmed value looks like a deliverable address. */
export function isValidEmail(value) {
  if (typeof value !== 'string') return false
  return EMAIL.test(value.trim())
}
