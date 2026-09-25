import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'

const port = async () => {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const value = server.address().port
  server.close()
  await once(server, 'close')
  return value
}

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ventline-'))
  const number = await port()
  const child = spawn(process.execPath, ['server/ventline-server.js'], {
    cwd: process.cwd(), env: { ...process.env, BOARD_DIR: dir, PORT: String(number) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const sockets = []
  t.after(async () => {
    for (const ws of sockets) ws.terminate()
    child.kill()
    if (child.exitCode === null) await once(child, 'exit')
    rmSync(dir, { recursive: true, force: true })
  })
  const connect = async (path = '/ventline-ws', protocol = 'ventline.v1') => {
    const ws = new WebSocket(`ws://127.0.0.1:${number}${path}`, protocol)
    sockets.push(ws)
    await Promise.race([
      once(ws, 'open'),
      once(ws, 'error').then(([err]) => { throw err }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`connect timed out: ${output}`)), 3000)),
    ])
    return ws
  }
  // Wait for the real child to bind. A missing entry point fails here with its stderr.
  for (let i = 0; i < 100 && !output.includes('Ventline match server on'); i++) {
    if (child.exitCode !== null) throw new Error(output)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.match(output, /Ventline match server on/)
  return { dir, connect, child, number }
}

const send = (ws, value) => ws.send(JSON.stringify(value))
const messages = (ws) => {
  const queue = []
  ws.on('message', raw => queue.push(JSON.parse(raw)))
  return async (predicate, timeout = 5000) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      const index = queue.findIndex(predicate)
      if (index !== -1) return queue.splice(index, 1)[0]
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('expected frame timed out')
  }
}
const board = dir => JSON.parse(readFileSync(join(dir, 'board-ventline.json'), 'utf8'))
const row = (dir, name) => board(dir).players.find(player => player.name === name)
const waitFor = async (check, timeout = 5000) => {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = check()
    if (value) return value
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('condition timed out')
}

test('one solo client starts, ignores forged score, and banks each attempt once', async t => {
  const { dir, connect, child } = await fixture(t)
  const ws = await connect()
  const next = messages(ws)
  send(ws, { t: 'join', mode: 'solo', name: '  Ace\u0000 ' })
  const welcome = await next(m => m.t === 'welcome')
  assert.equal(typeof welcome.id, 'string')
  const start = await next(m => m.t === 'snap' && m.phase === 'playing')
  assert.equal(start.players.length, 1)
  assert.equal(start.players[0].name, 'Ace')
  send(ws, { t: 'score', score: 9999 })
  const over = await next(m => m.t === 'snap' && m.phase === 'over', 5000)
  assert.equal(over.players[0].score, 0)
  await waitFor(() => row(dir, 'Ace'))
  assert.equal(row(dir, 'Ace').bestScore, 0)
  assert.equal(row(dir, 'Ace').matches, 1)
  send(ws, { t: 'retry' })
  send(ws, { t: 'retry' })
  await next(m => m.t === 'snap' && m.phase === 'playing')
  await next(m => m.t === 'snap' && m.phase === 'over', 5000)
  await waitFor(() => row(dir, 'Ace').matches === 2)
  assert.equal(row(dir, 'Ace').matches, 2)
  assert.equal(child.exitCode, null)
})

test('overlapping solo runs bank independently and a disconnect banks server progress', async t => {
  const { dir, connect } = await fixture(t)
  const a = await connect(), b = await connect()
  const nextA = messages(a), nextB = messages(b)
  send(a, { t: 'join', mode: 'solo', name: 'A' })
  send(b, { t: 'join', mode: 'solo', name: 'B' })
  const [wa, wb] = await Promise.all([nextA(m => m.t === 'welcome'), nextB(m => m.t === 'welcome')])
  assert.notEqual(wa.id, wb.id)
  await Promise.all([nextA(m => m.t === 'snap' && m.phase === 'playing'), nextB(m => m.t === 'snap' && m.phase === 'playing')])
  send(a, { t: 'score', score: 9999 })
  a.close()
  await once(a, 'close')
  await nextB(m => m.t === 'snap' && m.phase === 'over', 5000)
  await waitFor(() => row(dir, 'A') && row(dir, 'B'))
  assert.deepEqual([row(dir, 'A').bestScore, row(dir, 'B').bestScore], [0, 0])
  assert.deepEqual([row(dir, 'A').matches, row(dir, 'B').matches], [1, 1])
})

test('two live players share gates, spectators cannot flap, and live round banks', async t => {
  const { dir, connect } = await fixture(t)
  const a = await connect(), b = await connect(), c = await connect()
  const nextA = messages(a), nextB = messages(b), nextC = messages(c)
  send(a, { t: 'join', mode: 'live', name: 'Live A' })
  send(b, { t: 'join', mode: 'live', name: 'Live B' })
  const [wa, wb] = await Promise.all([nextA(m => m.t === 'welcome'), nextB(m => m.t === 'welcome')])
  send(a, { t: 'ready' }); send(b, { t: 'ready' })
  const [sa, sb] = await Promise.all([
    nextA(m => m.t === 'snap' && m.phase === 'playing', 5000),
    nextB(m => m.t === 'snap' && m.phase === 'playing', 5000),
  ])
  assert.notEqual(wa.id, wb.id)
  assert.deepEqual(sa.gates, sb.gates)
  assert.deepEqual(sa.players.map(p => p.id), sb.players.map(p => p.id))
  send(c, { t: 'join', mode: 'live', name: 'Watcher' })
  const wc = await nextC(m => m.t === 'welcome')
  const watched = await nextC(m => m.t === 'snap' && m.phase === 'playing')
  assert.equal(watched.players.some(p => p.id === wc.id), false)
  send(c, { t: 'flap' })
  send(c, { t: 'score', score: 9999 })
  await Promise.all([
    nextA(m => m.t === 'snap' && m.phase === 'over', 5000),
    nextB(m => m.t === 'snap' && m.phase === 'over', 5000),
  ])
  await waitFor(() => row(dir, 'Live A') && row(dir, 'Live B'))
  assert.equal(row(dir, 'Watcher'), undefined)
  assert.equal(row(dir, 'Live A').matches, 1)
  assert.equal(row(dir, 'Live B').matches, 1)
  assert.equal(row(dir, 'Live A').bestScore, 0)
  const lobby = await nextA(m => m.t === 'snap' && m.phase === 'lobby', 6000)
  assert.deepEqual(lobby.players.map(p => p.id), [wa.id, wb.id])
  assert.equal(row(dir, 'Live A').matches, 1)
  assert.equal(row(dir, 'Live B').matches, 1)
})

test('wrong handshake and malformed or oversized frames do not crash the process', async t => {
  const { connect, child, number } = await fixture(t)
  for (const [path, protocol] of [['/wrong', 'ventline.v1'], ['/ventline-ws', 'wrong.v1']]) {
    const ws = new WebSocket(`ws://127.0.0.1:${number}${path}`, protocol)
    await assert.rejects(once(ws, 'open'))
    ws.terminate()
  }
  const ws = await connect()
  const next = messages(ws)
  ws.send('{')
  send(ws, { t: 'join', mode: 'solo', name: 'Valid' })
  await next(m => m.t === 'welcome')
  ws.send('x'.repeat(5000))
  await once(ws, 'close')
  assert.equal(child.exitCode, null)
  const other = await connect()
  const nextOther = messages(other)
  send(other, { t: 'join', mode: 'solo', name: 'Still here' })
  await nextOther(m => m.t === 'welcome')
})
