import { useState } from 'react'
import { useTitle } from '../lib/useTitle.js'

export default function CipherRun() {
  useTitle('Cipher Run')
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 text-fg">
      <h1 className="display text-3xl">Cipher Run</h1>
      <p className="mt-2 text-muted">Terminal Decryption Race</p>
    </div>
  )
}
