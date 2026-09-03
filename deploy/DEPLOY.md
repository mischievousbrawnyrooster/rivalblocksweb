# Deploying to the Ubuntu VM

Build on Windows, move `dist/` into the guest, serve it with nginx. The VM
needs nginx and nothing else — no Node, no npm, no build toolchain.

## 1. Build (on Windows)

```bash
export PATH="/c/Program Files/nodejs:$PATH"   # until you restart the terminal
npm run build
```

Everything the site needs is now in `dist/`. That folder *is* the website.

## 2. Install nginx (once)

```bash
sudo apt update
sudo apt install -y nginx
```

## 3. Put the site in place

Make `dist/` reachable from the guest via the VMware shared folder. Find it:

```bash
ls /mnt/hgfs/
```

Then replace the served directory wholesale — no staging folder, no renaming:

```bash
sudo rm -rf /var/www/rivalblocks
sudo mkdir -p /var/www/rivalblocks
sudo cp -r /mnt/hgfs/<share-name>/dist/. /var/www/rivalblocks/
sudo chown -R www-data:www-data /var/www/rivalblocks
```

Two details that matter more than they look:

- **`dist/.` not `dist/*`** — the dot copies the directory's contents in one
  operation and cannot produce a nested `rivalblocks/dist/` by accident.
- **`rm -rf` first, every time.** Asset filenames are content-hashed, so
  `index.html` only works with the exact `assets/` it was built alongside.
  Mixing files from two builds means `index.html` requests a hash that no
  longer exists, `try_files` serves `index.html` in its place, the browser
  tries to parse HTML as JavaScript, and you get a blank page.

Verify all five files arrived:

```bash
find /var/www/rivalblocks -type f
```

Expect `index.html`, `assets/index-*.js`, `assets/index-*.css`, `favicon.svg`,
`mask-icon.svg`.

## 5. Install the nginx config (once)

Copy `deploy/nginx.conf` into the VM the same way you moved `dist/`, then:

```bash
sudo cp nginx.conf /etc/nginx/sites-available/rivalblocks
sudo ln -s /etc/nginx/sites-available/rivalblocks /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # otherwise it wins on port 80
sudo nginx -t                                 # syntax check FIRST
sudo systemctl reload nginx
```

`nginx -t` is not optional. A bad config plus a reload takes the site down.

## 6. Open the firewall

```bash
sudo ufw status                # if inactive, nothing to do
sudo ufw allow 'Nginx HTTP'    # only if ufw is active
```

## 7. Find the VM's IP and test

```bash
hostname -I
```

From the VM itself: `curl -I http://localhost/` → expect `HTTP/1.1 200 OK`.

From any other VM or from Windows: `http://<that-ip>/`

Test the SPA rewrite specifically, because it is the part most likely to be
wrong — go straight to `http://<that-ip>/servers` and reload. If you get the
server status page, the config works. If you get nginx's 404, step 5 did not
take effect.

For a friendlier name, add the IP to each machine's hosts file
(`/etc/hosts` on Linux, `C:\Windows\System32\drivers\etc\hosts` on Windows):

```
192.168.x.x   rivalblocks.local
```

## Redeploying

Repeat steps 1, 2 and 4. nginx needs no reload — it serves whatever is on
disk, and the config has not changed.

## Things worth knowing

- **Unknown URLs return HTTP 200, not 404.** The SPA fallback serves
  `index.html` for every unmatched path and React Router then renders the
  "This tile fell away" page. Visitors see the right thing; monitoring sees a
  200. Inherent to client-side routing, not a flaw in the config.
- **No HTTPS.** Plain HTTP, which is fine on a trusted internal VM network.
  Add TLS before exposing this any wider.
- **The nginx config is unverified.** It is standard and I have read it
  closely, but there is no nginx on the Windows workstation to test against.
  `sudo nginx -t` on the VM is the real check.
- **The dev server is not a host.** `npm run dev --host` is handy for a quick
  look from another VM, but it is unoptimised, single-process and stops when
  you close the terminal. nginx serving `dist/` is the actual deployment.

## The match servers

`/play` needs a process holding the match, and there are four of them — one per
game, plus a second Blastworks for the other mode. nginx keeps serving the site
exactly as before and proxies each path to its own port.

| Path | Port | Process | Game |
|---|---|---|---|
| `/ws` | 8081 | `server/server.js` | Blockout Royale |
| `/fracture-ws` | 8082 | `server/fracture-server.js` | Fracture Line |
| `/blast-ws` | 8083 | `server/blastworks-server.js` | Blastworks, last man standing |
| `/blast-dm-ws` | 8084 | `server/blastworks-dm.js` | Blastworks, deathmatch |

**No path but the first may begin with `/ws`.** nginx matches locations by
prefix, so `/ws-fracture` would be swallowed by the Blockout Royale rule and
the player connected to the wrong game, with no error anywhere. Vite's dev
proxy matches the same way, which is why the paths are shaped like this on both
sides.

Each process holds its own match in memory and knows its own port, so one
crashing takes nothing else with it and there is no configuration to keep in
step between them.

### Install Node (once)

```bash
sudo apt update
sudo apt install -y nodejs
node --version
```

`npm` is deliberately not installed. The only dependency, `ws`, is pure
JavaScript with no build step and no dependencies of its own, so copying the
folder is a complete install — and the VM needs no internet access.

### Put the server in place

From Windows, `server/` and `node_modules/ws` travel over the same VMware
shared folder as `dist/`:

```bash
sudo rm -rf /opt/rivalblocks-game
sudo mkdir -p /opt/rivalblocks-game/node_modules
sudo cp -r /mnt/hgfs/<share-name>/server /opt/rivalblocks-game/
sudo cp -r /mnt/hgfs/<share-name>/node_modules/ws /opt/rivalblocks-game/node_modules/
sudo chown -R www-data:www-data /opt/rivalblocks-game
```

`server/package.json` (just `{ "type": "module" }`) rides along inside that
`cp -r`. It is what tells Node these files are ES modules regardless of the
version `apt` gave you — do not "clean it up" as redundant, the service
won't start without it.

Check it starts before handing it to systemd:

```bash
sudo -u www-data node /opt/rivalblocks-game/server/server.js
```

Expect `Blockout Royale match server on ws://127.0.0.1:8081`. Ctrl-C.

### Make somewhere for the leaderboard (once)

The four servers write the standing board here and nginx serves it back out at
`/board/`. It sits outside `/var/www` deliberately: replacing the served
directory is how a redeploy works, and that must never take the leaderboard
with it.

```bash
sudo mkdir -p /var/lib/rivalblocks/board
sudo chown -R www-data:www-data /var/lib/rivalblocks
```

Nothing needs seeding. A game nobody has finished a match on simply has no file
yet, which the site reads as an empty board.

### Run them under systemd (once)

One template unit covers all four; the instance name is the file in `server/`
to run.

```bash
sudo cp /mnt/hgfs/<share-name>/deploy/rivalblocks@.service \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now \
    rivalblocks@server \
    rivalblocks@fracture-server \
    rivalblocks@blastworks-server \
    rivalblocks@blastworks-dm
systemctl status "rivalblocks@*"
```

If the older single-game `rivalblocks-game` unit is still installed, disable it
first — otherwise two processes fight over port 8081 and the loser restarts
forever:

```bash
sudo systemctl disable --now rivalblocks-game
```

### Reload nginx with the proxies

Two files: the site config, and the shared WebSocket headers its four proxy
blocks include.

```bash
sudo cp /mnt/hgfs/<share-name>/deploy/nginx.conf \
        /etc/nginx/sites-available/rivalblocks
sudo cp /mnt/hgfs/<share-name>/deploy/rivalblocks-ws.conf \
        /etc/nginx/rivalblocks-ws.conf
sudo nginx -t
sudo systemctl reload nginx
```

### Test

From another machine, open `http://<vm-ip>/play` in two browser windows, join
with two names, and play a round.

If a board never appears, the handshake is the first suspect. Check all four —
a mistake in the prefix rules shows as one game working and another not:

```bash
for path in /ws /fracture-ws /blast-ws /blast-dm-ws; do
  printf "%s " "$path"
  curl -s -o /dev/null -w "%{http_code}\n" -N \
    -H "Connection: Upgrade" -H "Upgrade: websocket" \
    -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
    "http://localhost$path"
done
```

Expect `101` from each. Anything else means that `location` block did not take,
or the service behind it is down — check
`journalctl -u rivalblocks@<instance> -n 50`.

The leaderboard is an ordinary GET, so it needs no special handling:

```bash
curl -i http://localhost/board/board-blockout.json
```

Expect `200` and JSON once a match has finished there, `404` before that. A
`200` returning HTML means the `location /board/` block did not take and the
SPA fallback answered instead.

### Redeploying the game

```bash
sudo systemctl stop "rivalblocks@*"
# re-copy server/ as above
sudo systemctl start \
    rivalblocks@server \
    rivalblocks@fracture-server \
    rivalblocks@blastworks-server \
    rivalblocks@blastworks-dm
```

nginx needs nothing unless its config changed. The leaderboard is untouched by
any of this — it lives on disk, not in the processes — so restarting one server
or all four costs nothing but the match in progress.

### What is on the wire

Traffic between browser and VM is plain `ws://` on port 80. Anyone running
Wireshark on this network reads player names, every move, the full board state
and the standing leaderboard as JSON, with no decryption step. The operator key
for `/admin` crosses the same wire in the clear. That is fine here — the protocol
carries no credentials and no personal data, and the site is already plain
HTTP on a trusted internal network. Put TLS in front of both before this goes
anywhere wider.

## On Void Linux instead of Ubuntu

Everything above assumes Debian conventions. Void differs in four places; the
rest of the sequence — building, copying `dist/`, copying `server/` and
`node_modules/ws` — is unchanged.

### Packages

```sh
sudo xbps-install -S nodejs nginx
```

Nothing else. `ws` is pure JavaScript with no dependencies of its own, so
there is no compiler, no node-gyp and no Python in the chain. Void's `nodejs`
includes npm, so you can build on the box instead of copying `dist/` in.

### nginx config lives in conf.d

There is no `sites-available` / `sites-enabled` on Void — that is a Debian
convention. Use:

```sh
sudo cp nginx.conf /etc/nginx/conf.d/rivalblocks.conf
sudo nginx -t
sudo sv reload nginx
```

**Void's stock `/etc/nginx/nginx.conf` already contains its own
`server { listen 80; ... }` block.** Two default servers on port 80 means
yours may not win. Comment the bundled one out, or give yours a real
`server_name` in place of `_`.

### There is no www-data

Every `chown www-data:www-data` above needs the user nginx actually runs as.
Find it, then use it everywhere including the service file:

```sh
grep -E '^\s*user' /etc/nginx/nginx.conf
```

### runit, not systemd

Ignore `rivalblocks@.service`; use `rivalblocks.run`. It is one script copied
into four service directories — it reads the directory name to know which
server it is starting.

```sh
for s in server fracture-server blastworks-server blastworks-dm; do
  sudo mkdir -p "/etc/sv/rivalblocks-$s"
  sudo cp rivalblocks.run "/etc/sv/rivalblocks-$s/run"
  sudo chmod +x "/etc/sv/rivalblocks-$s/run"
  sudo ln -s "/etc/sv/rivalblocks-$s" /var/service/
done
```

The symlink into `/var/service/` is what starts a service and enables it at
boot — there is no separate enable step. runit restarts the process whenever it
exits, so `Restart=always` needs no equivalent.

The leaderboard directory needs the user nginx runs as, not `www-data`:

```sh
sudo mkdir -p /var/lib/rivalblocks/board
sudo chown -R nginx:nginx /var/lib/rivalblocks
```

| systemd | runit |
|---|---|
| `systemctl status rivalblocks@server` | `sv status rivalblocks-server` |
| `systemctl stop rivalblocks@server` | `sv down rivalblocks-server` |
| `systemctl start rivalblocks@server` | `sv up rivalblocks-server` |
| `systemctl restart rivalblocks@server` | `sv restart rivalblocks-server` |
| `journalctl -u rivalblocks@server` | install `socklog-void`, then read `/var/log/socklog/` |
| disable | `sudo rm /var/service/rivalblocks-server` |

Redeploying a game becomes `sv down`, re-copy `server/`, `sv up`.
