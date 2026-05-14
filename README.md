# AMIS Progressive Web App — Deployment Guide

This folder contains AMIS configured as a Progressive Web App (PWA). Once
deployed to an HTTPS server, users can install AMIS to their phone or desktop
home screen, use it fully offline after the first load, and automatically
receive update prompts when you ship a new version.

## Two deployment modes — same `amis.html` works for both

The `amis.html` in this folder is **dual-mode**:

- **Standalone** — upload just `amis.html` to any server (HTTP or HTTPS).
  Works exactly like the original: aggressive no-cache headers, no install
  prompt, no offline-reload capability, no update banners. The browser
  silently logs 404s for `manifest.json` and `service-worker.js` (the
  registration code handles this gracefully) but everything else functions
  normally.
- **Full PWA** — upload all 5 files (`amis.html`, `manifest.json`,
  `service-worker.js`, `icon-192.png`, `icon-512.png`) to an HTTPS server.
  Get installable app, offline reloads, and auto-update notifications.

When deployed as a full PWA, the service worker intercepts requests *before*
the no-cache meta tags are consulted, so those tags have no effect. They're
safe to keep in the file regardless of deployment mode.

## What's in this folder

| File | Purpose |
|---|---|
| `amis.html` | The app. Patched with manifest link, apple-touch-icon link, and service-worker registration. Anti-cache meta tags removed. |
| `manifest.json` | PWA metadata — app name, icons, theme color, start URL, display mode (standalone). |
| `service-worker.js` | Background script. Caches the app shell, serves it offline, detects updates, posts update notifications to the page. |
| `icon-192.png` | 192×192 home-screen icon (Android, desktop browsers, iOS apple-touch-icon). |
| `icon-512.png` | 512×512 large icon (splash screens, app launchers). |

All five files must be in the same folder and served from the same origin.

## Required: HTTPS

Service workers only work over **HTTPS** or **localhost**. If you try to
register the SW from `http://your-server.com/amis.html`, the browser will
silently refuse and the app will fall back to normal browser behaviour
(works, but no offline, no install prompt, no auto-updates).

**Free HTTPS options:**

- **Cloudflare Pages** — drag-and-drop deployment, automatic HTTPS, free
  custom domains. Recommended for AMIS.
- **Netlify** — same idea, drag-and-drop or git-based, free HTTPS.
- **GitHub Pages** — free if you put the files in a public repo.
- **Vercel** — similar to the above.
- **Let's Encrypt** — if you self-host on your own server (e.g. a VPS in
  Malaysia), use `certbot` to get a free certificate.

## Quick local test (before deploying)

You can verify the PWA works on your own machine before pushing to a live
server. From this folder, run:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/amis.html` in Chrome. To verify the SW
registered:

1. Open DevTools (F12)
2. Go to **Application** tab → **Service Workers** in the left panel
3. You should see `service-worker.js` with status "activated and is running"
4. Under **Application → Manifest**, the AMIS icons and theme color should
   display

You can simulate offline by checking **Application → Service Workers → Offline**
and reloading the page — it should still load from cache.

## Deployment steps

1. Upload all 5 files to your HTTPS-enabled web hosting. Keep them in the
   same folder.
2. Open the URL in Chrome on Android or Edge on desktop. Look for an
   "Install" icon in the address bar (or a banner prompt).
3. On iOS Safari, the user installs via **Share → Add to Home Screen**.
   iOS doesn't show an automatic install prompt — this is a Safari
   limitation, not a configuration issue.
4. Confirm the install: tap the home-screen icon and the app should open
   in standalone mode (no browser address bar visible).

## How updates work

Every time a user opens the app, the service worker does two things in
parallel:

1. **Serves the cached version instantly** — page loads in milliseconds,
   even with no signal.
2. **Fetches a fresh copy of amis.html in the background** — and compares
   it to what's in the cache.

If the fresh copy is different, the SW saves it to the cache and posts a
message to the page. The page then shows a green banner at the bottom:
"✨ A new version of AMIS is ready" with a **Reload** button. The user can
reload immediately, or dismiss the banner and reload later — they always
have a working version of the app in the meantime.

### When you ship a new version

To push an update:

1. Replace `amis.html` on your server with the new version.
2. **Bump the cache version** in `service-worker.js`. Open the file, find
   this line near the top:

   ```js
   const CACHE_VERSION = 'amis-v1';
   ```

   Change `'amis-v1'` to `'amis-v2'` (then v3, v4 for future releases).
   This invalidates the old cache so users definitely get the fresh files.

3. (Optional but recommended) also replace `service-worker.js` itself with
   the version-bumped copy. The browser auto-detects SW file changes and
   installs the new one.

The next time a user opens the app, they get the cached old version
instantly. The new SW activates in the background, swaps the cache, and
posts the update notification. On their next visit (or when they tap
Reload), they get the new app.

## Browser compatibility notes

- **Android Chrome / Edge / Samsung Internet** — full support. Install
  prompt, offline, auto-update all work.
- **iOS Safari (16.4+)** — supports service workers and "Add to Home
  Screen", but no automatic install prompt. Users must use the Share menu.
- **Desktop Chrome / Edge / Brave** — full support, including install
  prompt and standalone window mode.
- **Firefox** — service worker works, but Firefox doesn't show an install
  prompt for PWAs on desktop. Mobile Firefox does support installation.
- **Older browsers (no `serviceWorker` in `navigator`)** — the app still
  works fine, but without offline capability or auto-updates. The
  registration code is gated on feature detection, so nothing breaks.

## Troubleshooting

**Install prompt doesn't appear.** Check (a) HTTPS is active, (b) the
manifest.json loads with no console errors, (c) you've visited the page
more than once (Chrome only prompts after engagement). Open DevTools →
Application → Manifest to see any manifest errors.

**Updates not appearing.** The browser caches the service-worker.js file
for up to 24 hours by default. To force a re-check immediately, bump
`CACHE_VERSION` AND change the SW file (even a comment change is enough),
then reload the page twice.

**iOS install icon looks wrong.** iOS uses the `apple-touch-icon` link in
the HTML head, not the manifest icons. This link is already set to
`icon-192.png`. If you replace the icons, replace both files; iOS will
resize the 192 to whatever size it needs.

**App still loads stale content after deployment.** Open the app, then
DevTools → Application → Storage → "Clear site data". This forces a fresh
load and re-registers the SW. (Only needed during development; production
users get updates automatically via the banner.)
