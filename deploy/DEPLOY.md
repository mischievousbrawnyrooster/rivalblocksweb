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

## The game server

`/play` needs a process holding the match. nginx keeps serving the site
exactly as before and proxies `/ws` to it.

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

### Run it under systemd (once)

```bash
sudo cp /mnt/hgfs/<share-name>/deploy/rivalblocks-game.service \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rivalblocks-game
systemctl status rivalblocks-game
```

### Reload nginx with the proxy

```bash
sudo cp /mnt/hgfs/<share-name>/deploy/nginx.conf \
        /etc/nginx/sites-available/rivalblocks
sudo nginx -t
sudo systemctl reload nginx
```

### Test

From another machine, open `http://<vm-ip>/play` in two browser windows, join
with two names, and play a round.

If the board never appears, the handshake is the first suspect:

```bash
curl -i -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  http://localhost/ws
```

Expect `HTTP/1.1 101 Switching Protocols`. Anything else means the `location
/ws` block did not take, or the service is down — check
`journalctl -u rivalblocks-game -n 50`.

### Redeploying the game

```bash
sudo systemctl stop rivalblocks-game
# re-copy server/ as above
sudo systemctl start rivalblocks-game
```

nginx needs nothing unless its config changed.

### What is on the wire

Traffic between browser and VM is plain `ws://` on port 80. Anyone running
Wireshark on this network reads player names, every move, and the full board
state as JSON, with no decryption step. That is fine here — the protocol
carries no credentials and no personal data, and the site is already plain
HTTP on a trusted internal network. Put TLS in front of both before this goes
anywhere wider.
