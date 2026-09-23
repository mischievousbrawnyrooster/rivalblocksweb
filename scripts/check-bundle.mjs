// Fails if three.js is in the chunk every page loads. Run after `npm run build`.
//
// three.js is ~570 KB. Blockout Royale 3D and Cutline are lazy routes so the
// marketing pages never download it; importing either eagerly would quietly
// add it to every page and nothing else would notice.
//
// The marker is a string three.js keeps through minification. The check also
// requires it to appear in SOME chunk: if a future three.js drops the string,
// this fails loudly instead of passing forever.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIST = 'dist'
const MARKER = 'THREE.WebGLRenderer'

let html
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf8')
} catch {
  console.error('check-bundle: no dist/index.html. Run `npm run build` first.')
  process.exit(1)
}

const entry = html.match(/src="\/(assets\/[^"]+\.js)"/)?.[1]
if (!entry) {
  console.error('check-bundle: could not find the entry script in dist/index.html.')
  process.exit(1)
}

const chunks = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js'))
const withThree = chunks.filter((f) => readFileSync(join(DIST, 'assets', f), 'utf8').includes(MARKER))

if (withThree.length === 0) {
  console.error(`check-bundle: no chunk contains "${MARKER}". The marker no longer identifies three.js; update it.`)
  process.exit(1)
}
if (withThree.includes(entry.replace('assets/', ''))) {
  console.error(`check-bundle: three.js is in the main chunk ${entry}. Every page now downloads it.`)
  process.exit(1)
}
console.log(`check-bundle: ok. three.js only in ${withThree.join(', ')}`)
