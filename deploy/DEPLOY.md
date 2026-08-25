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
