# ScreenToKitchen

Progressive Web App (Vite) configured for **GitHub Pages** at  
`https://<your-username>.github.io/ScreenToKitchen/`.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output is in `dist/` (suitable for any static host).

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. **Repository → Settings → Pages**: set **Source** to **GitHub Actions** (not “Deploy from a branch” unless you prefer that flow).
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds with `npm ci` / `npm run build` and publishes `dist` to Pages.

If you rename the repository, update the `repo` value in `vite.config.js` so asset URLs match (`/<repo>/`).

## “Native” vs GitHub Pages

GitHub Pages only serves **static** HTML, CSS, and JavaScript. It does **not** host iOS/Android or desktop app binaries. A **PWA** (manifest + service worker) is the usual way to get an installable, app-like experience in the browser and still deploy here.
