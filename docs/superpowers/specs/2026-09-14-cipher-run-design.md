# Cipher Run: System Architecture & Design Specification

An authoritative multiplayer terminal breach decryption race where operators compete in live multi-lane lobbies or solo time-attack trials across curated mainframe protocols.

---

## 1. Overview & In-Fiction Premise

In **Cipher Run**, players act as clandestine security breach operators. Mainframe firewalls, neural links, and subsector gateways are failing under high-frequency distributed intrusion. Operators race against competing hackers and autonomous security daemons to decrypt classified protocols before system watchdogs trigger total lockout.

### Studio Rules & Invariants
* **Strict Three-Layer Architecture**:
  * Pure Rules Engine: `server/cipherrun.js` (zero Node APIs, zero timers, zero I/O, zero external imports).
  * Network Adapter: `server/cipherrun-server.js` (WebSocket lifecycle on port 8087 `/cipherrun-ws`, snapshot broadcasts).
  * Shared Pure Logic: `server/board.js` (`board-cipherrun.json` persistence).
  * Client UI: `src/pages/CipherRun.jsx` (DOM/Canvas dual-layer terminal interface).
* **Cleartext Protocol**: Cleartext JSON WebSockets with `maxPayload: 4096` and `perMessageDeflate: false` for Wireshark inspection.
* **Deterministic Testing**: Randomness injected via seeded RNG or counters; constants referenced instead of hardcoded literals.
* **Style & Copy Rules**: Zero external image textures; procedural typography and SVG/CSS styling; strictly zero em dashes in copy.

---

## 2. Text Corpus & Curated Breach Protocols

The game launches with 18 in-fiction protocols organized into three difficulty tiers:

### Tier 1: Quick Breaches (Fast Sprints · 25–40 words)
1. **Protocol 01 // Handshake Bypass**
   > `Access request granted on port 8084. Initializing secure shell bypass across secondary gateway. Override local routing tables and dump session credentials to volatile memory before firewall intrusion detection locks the subnet.`
2. **Protocol 02 // Neural Handshake**
   > `Synchronizing biometric pulse with mainframe clock. Buffer overflow detected at memory address zero zero four. Inject payload string into instruction pointer and force immediate privilege escalation.`
3. **Protocol 03 // Orbital Uplink**
   > `Satellite downlink established over subsector nine. Encrypted telemetry streaming at forty megabits per second. Intercept transmission keys and deploy root certificate across all orbital relays.`
4. **Protocol 04 // Core Dump**
   > `Kernel panic triggered by unhandled system exception. Hexadecimal register state dumped to console. Extract cryptographic hashes from stack trace before emergency watchdog restarts the host node.`
5. **Protocol 05 // Ghost Route**
   > `Spoofing interface hardware address to match authorized maintenance terminal. Packet inspection disabled on local switch. Tunnel raw datagrams through virtual network interface to evade passive trace.`
6. **Protocol 06 // Voltage Spike**
   > `Power distribution unit overdrawn on cooling bus. Transformer load reaching thermal ceiling. Divert auxiliary current to primary cooling towers before breaker trip causes catastrophic data corruption.`
7. **Protocol 07 // Cipher Reset**
   > `Rotating public keys across distributed keyrings. Verification hash mismatch detected on node seven. Force unilateral ledger commit and quarantine compromised identity provider.`

### Tier 2: Kernel Overrides (Medium Technical · 50–70 words)
8. **Protocol 08 // Black Ice Penetration**
   > `Intrusion countermeasures activated across outer security ring. Defensive neural spikes deploying aggressive packet dropping. Route traffic through encrypted decoy proxy cluster while executing parallel buffer exploit on authentication daemon. Maintain sixty cycle clock synchronization to prevent packet loss and bypass passive sentinel telemetry.`
9. **Protocol 09 // Subnet Quarantine**
   > `Rogue process detected executing unauthorized binary from temporary directory. Isolate internal bridge adapters and revoke access tokens across all active daemon threads. Inspect memory heap for injected shellcode, flush socket buffers, and broadcast cryptographically signed revocation certificates to adjacent security sectors.`
10. **Protocol 10 // Firmware Inversion**
    > `Flashing custom bootloader to volatile flash memory segment. Checksum verification bypassed using forged digital signature. Overwrite low-level interrupt vectors to capture privileged system calls prior to hypervisor initialization. Keep data bus frequency steady to avoid unexpected bus contention and register parity errors.`
11. **Protocol 11 // Memory Leak Exploitation**
    > `Unbounded heap allocation identified inside network routing module. Flood connection pool with asynchronous handshake frames until memory fragmentation triggers garbage collection stall. Seize vacated pointer tables and rewrite execution context before supervisor process triggers automated failover restart.`
12. **Protocol 12 // Fiber Array Siphon**
    > `Tapping undersea optical link at primary repeater station. Optical carrier signal attenuated by three decibels. Decode wavelength multiplexed stream and reconstruct raw packet payload in local memory cache before automated optical loss sensors alert maintenance crew.`
13. **Protocol 13 // Zero-Day Infiltration**
    > `Deploying unpatched privilege escalation sequence against core scheduler. System thread scheduler entering unmonitored debug state. Inject persistent administrative daemon into background task queue and scrub audit log entries to ensure zero trace presence across system event log.`
14. **Protocol 14 // Logic Gate Cascade**
    > `Asynchronous clock drift triggering race condition in hardware bus arbitration. Exploit transient timing window to overwrite read-only register bank. Ensure pipeline flush does not invalidate current instruction cache before latching control signals high.`

### Tier 3: Black Ice Mainframes (Long Endurance · 85–125 words)
15. **Protocol 15 // Global Mainframe Takeover**
    > `Security mainframe operating in lockstep redundancy across four continental data nodes. Initiate synchronized distributed denial attack against secondary heartbeat monitors to force split-brain consensus failure. Once quorum fails, broadcast forged cluster configuration state asserting authority over the master coordinate server. Rewrite partition mapping tables, secure encrypted cryptographic storage vaults, and disable automated rollback hooks across all surviving peripheral machines before operational engineers re-establish out-of-band console access.`
16. **Protocol 16 // Quantum Decryption Sweep**
    > `Shor algorithm coprocessor array operating at ninety-eight percent capacity. Factoring two thousand forty-eight bit asymmetric key exchange using superconducting flux qubits. Compensate for quantum phase decoherence by increasing microwave pulse modulation cadence. When private key factors resolve, decrypt operational transit ledger, capture active session cookies, and mirror master cryptographic keys to secure local cold storage before automated tamper sensors trigger cryptographic zeroization.`
17. **Protocol 17 // Deep Archive Reconstruction**
    > `Magnetic tape archive indexing system corrupted during unexpected power collapse. Read magnetic flux transitions directly from raw recording head telemetry. Rebuild damaged parity blocks using Reed-Solomon error correction matrices. Splice fragmented database records into contiguous table allocations, rebuild index b-trees, and export master transaction logs to immutable storage nodes before archive drive servos overheat from continuous seek cycles.`
18. **Protocol 18 // Cybernetic Defense Matrix**
    > `Automated facility defense grid monitoring all biometric and digital inputs. Intercept internal telemetry bus and broadcast simulated normal environmental telemetry across all sensory arrays. Neutralize autonomous sentry drone dispatch routines by injecting deadlocks into priority dispatch queues. Keep terminal bandwidth below intrusion detection thresholds, spoof operator command acknowledgments, and download classified facility schematics before physical facility lockdowns seal the vault perimeter doors.`

---

## 3. Pure Rules Engine (`server/cipherrun.js`)

The engine maintains complete simulation state in memory without side effects.

### Constants & Configuration
```javascript
export const TICK_MS = 33 // ~30 Hz tick loop
export const COUNTDOWN_MS = 5000 // 5-second synchronized start
export const POST_RACE_GRACE_MS = 6000 // 6 seconds to view finish standings
export const LOCKOUT_MS = 350 // Terminal static freeze on consecutive errors
export const CONSECUTIVE_ERROR_LIMIT = 3
export const MAX_PLAYERS = 8
export const BOT_FILL_TO = 4
export const BOT_NAMES = ['ZeroCool', 'AcidBurn', 'Crash', 'Phantom', 'Vector', 'Cereal', 'Daemon']
```

### Typing Mathematics (Monkeytype Standard)
* **Word Length Normalization**: Standardized to 5 characters (including spaces and punctuation).
* **Net WPM (Official Speed)**:
  $$\text{WPM} = \max\left(0, \frac{\text{correctKeystrokes} / 5}{\max(0.001, \text{elapsedSeconds} / 60)}\right)$$
* **Raw WPM (Gross Speed)**:
  $$\text{Raw WPM} = \frac{\text{totalKeystrokes} / 5}{\max(0.001, \text{elapsedSeconds} / 60)}$$
* **Accuracy Percentage**:
  $$\text{Accuracy \%} = \frac{\text{correctKeystrokes}}{\max(1, \text{totalKeystrokes})} \times 100$$
* **Progress Percentage**:
  $$\text{Progress \%} = \min\left(100, \frac{\text{cursorIndex}}{\text{targetText.length}} \times 100\right)$$

### Keystroke Handling & Glitch Breaker
1. **Lockout Check**: If `match.now < p.lockoutUntil`, the keystroke is rejected (glitch freeze active).
2. **Backspace (`Key === 'Backspace'`)**:
   * If `p.cursor > 0`, moves `p.cursor` back by 1.
   * If the character being stepped back over was an error, marks it cleared.
3. **Spacebar Word Jump (`Key === ' '`)**:
   * If the player is currently typing an error in the current word, pressing Space jumps `p.cursor` to the start of the next word.
   * Skipped characters are marked uncorrected, preserving progress while dinging accuracy.
4. **Alphanumeric Keystrokes**:
   * Expected character is `targetText[p.cursor]`.
   * **Match**: `p.correctKeystrokes += 1`, `p.totalKeystrokes += 1`, `p.consecutiveErrors = 0`, `p.cursor += 1`.
   * **Mismatch**: `p.totalKeystrokes += 1`, `p.consecutiveErrors += 1`.
   * **Glitch Breaker Trigger**: If `p.consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT`, triggers `p.lockoutUntil = match.now + LOCKOUT_MS` and logs a glitch event.
5. **Breach Completion**:
   * When `p.cursor >= targetText.length`, `p.finished = true`, `p.finishTime = match.elapsed`, `p.finalWpm = calculateWpm(...)`, `p.finalAcc = calculateAcc(...)`.
   * If this is the first racer to finish: `match.winner = p.id`, `match.firstFinishedAt = match.now`.

### Natural AI Bot Simulation (`driveBots`)
* Bots are seated up to `match.botFill` when humans are present.
* Each bot is assigned a baseline WPM profile (ranging from 55 WPM for Novice bots to 95 WPM for Expert bots).
* Keystroke intervals are calculated as:
  $$\Delta t = \frac{60000}{\text{WPM} \times 5} + \text{jitter}(-15\text{ms} \dots +25\text{ms})$$
* **Humanized Error Simulation (~2.5% rate)**:
  * A bot occasionally types an adjacent key instead of the target character.
  * The bot pauses for 120ms (simulating human recognition latency), hits Backspace, and corrects the letter before resuming cadence.

---

## 4. Network Adapter & Server Lifecycle (`server/cipherrun-server.js`)

* **Network Bindings**: Port `8087` on `127.0.0.1`, WebSocket subprotocol `'cipherrun.v1'`, `maxPayload: 4096`.
* **30 Hz Tick Loop**: Updates countdowns, advances bot keystrokes, calculates snapshot deltas, broadcasts to all connected clients.
* **Dual Operation**:
  * **Multiplayer Lobby (`mode: 'race'`)**: Shared synchronized 5s countdown, bot fill, head-to-head live progress tracks.
  * **Solo Time Attack (`mode: 'solo'`)**: Bypasses lobby queue, immediately launches the selected protocol, validates keystroke intervals, and banks verified times directly to the leaderboard.

### Protocol Frames

#### Client $\rightarrow$ Server
* `{ t: 'join', name: string, mode: 'race' | 'solo', protocolId?: number }`
* `{ t: 'key', key: string, cursor: number }`
* `{ t: 'ready' }` (signals lobby readiness or bot spawn)
* `{ t: 'restart' }` (requests match reset)
* `{ t: 'admin', key: string }`

#### Server $\rightarrow$ Client
* `{ t: 'welcome', id: string, slot: number, mode: 'race' | 'solo', protocol: { id: number, title: string, tier: number, text: string } }`
* 30 Hz Snapshot (`{ t: 'snap' }`):
  ```json
  {
    "t": "snap",
    "seq": 240,
    "phase": "racing",
    "countdown": 0,
    "elapsed": 12450,
    "winner": null,
    "protocol": { "id": 1, "title": "Protocol 01 // Handshake Bypass", "tier": 1 },
    "players": [
      {
        "id": "p-1",
        "name": "Operator",
        "slot": 0,
        "bot": false,
        "cursor": 84,
        "progress": 42.5,
        "wpm": 78.4,
        "rawWpm": 84.1,
        "acc": 98.2,
        "glitch": false,
        "finished": false,
        "finishTime": null
      }
    ],
    "board": [ ... ]
  }
  ```

---

## 5. Leaderboard Schema & Pure Storage (`server/board.js`)

### Registration
```javascript
{
  file: 'board-cipherrun.json',
  game: 'cipherrun',
  mode: null,
  title: 'Cipher Run'
}
```

### Metric Tracking
* `wins`: Total multiplayer 1st place finishes.
* `matches`: Total completed protocols.
* `peakWpm`: Best WPM recorded across any completed breach.
* `avgAcc`: Cumulative accuracy percentage.
* `fastestTime`: Fastest completion duration (in ms).
* `kills` / `deaths`: `null` (pure typing speed contest).

---

## 6. Client Interface & Telemetry (`src/pages/CipherRun.jsx`)

* **Aesthetic**: Retro-futuristic cyberpunk terminal; dark `#090d16` background with cyan, orange (`#ff6b1a`), and crisp monospace typography (`ui-monospace`, `Courier New`, `monospace`).

### Interface Layers
1. **Telemetry & Progress Strip (Top)**:
   * Competitor lanes with slot colors and avatars (`PIECE_ICON`).
   * Live animated progress bar showing each competitor's completion percentage.
   * Real-time WPM pill badge beside each racer.
2. **Breach Console (Center)**:
   * **Decryption Text Buffer**:
     * Characters correctly typed: Bright phosphor green/cyan.
     * Characters with errors: Red background box with white font (`bg-danger/25 text-danger`).
     * Current character: Pulsing amber caret cursor (`|`).
     * Remaining characters: Dim muted gray.
   * Hidden input capture handling seamless focus across mobile and desktop.
3. **Operator Telemetry Gauges (Bottom)**:
   * Live **WPM** (Monkeytype standard).
   * **Raw WPM** (Gross keystroke cadence).
   * **Accuracy %**.
   * **Time Elapsed** / Remaining.
4. **Terminal Glitch Overlay**:
   * On 3 consecutive typos, triggers CSS horizontal chromatic static jitter and displays a brief flashing banner: `FIREWALL BREAKER LOCKOUT [350ms]`.
5. **Solo Protocol Selector**:
   * Sidebar or drawer to browse all 18 protocols by tier (Quick, Kernel, Black Ice) with personal best badges.

---

## 7. Verification & Test Suite

### Unit Tests (`server/cipherrun.test.js`)
* Correct WPM / Raw WPM / Accuracy math against standard test vectors.
* Glitch lockout triggers on exactly 3 consecutive typos and rejects keystrokes during 350ms freeze.
* Backspace recovers cursor position and error status.
* Spacebar advances across word boundaries with uncorrected penalty.
* Match lifecycle transitions (`waiting` $\rightarrow$ `countdown` $\rightarrow$ `racing` $\rightarrow$ `over`).
* Bot AI types within configured WPM tolerance and recovers from simulated typos.
* Snapshot payload contains no private data and stays under 4KB limit.

### Integration Tests
* Full test suite verification via `npm.cmd test`.
* Production build verification via `npm.cmd run build`.
