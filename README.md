# ScreenToKitchen

Progressive Web App (Vite) configured for **GitHub Pages** at  
`https://<your-username>.github.io/ScreenToKitchen/`.

## Local development

ScreenToKitchen has:
- a Vite frontend (`src/`)
- a local/serverless backend (`api/recipe.ts`, `api/health.ts`)

Run both in separate terminals.

### Terminal A — frontend (UI + OCR in browser)
```bash
npm install
npm run dev
```

### Terminal B — backend (Vercel local API)
```bash
npx vercel dev
```

### Point the frontend to the backend
If your Vercel local URL is `http://localhost:3000`:

```bash
export VITE_API_BASE_URL="http://localhost:3000"
```

Restart `npm run dev` (or reload after restart) so the env var is applied.

The homepage status panel uses `/api/health` and will show:
- backend status (up/down)
- LLM status (local/openai availability)

## LLM mode (hybrid)
The backend converts OCR text using:

- **Local Ollama (Mistral)** first, if enabled
- **OpenAI fallback** (production-ready default)

Environment variables (set them for `vercel dev` / Vercel):

- `USE_LOCAL_LLM` = `"true"` to try local LLM first (`"false"` skips local and uses OpenAI)
- `LOCAL_LLM_PROVIDER` = `ollama` (default) or `openai_compatible`
- `LOCAL_LLM_BASE_URL` = local server base URL (default `http://127.0.0.1:1234`)
- `OLLAMA_BASE_URL` = legacy alias for local base URL (still supported)
- `OLLAMA_MODEL` = default `mistral`
- `LOCAL_LLM_MODEL` = local model name override (e.g. `openai/gpt-oss-20b`)
- `LOCAL_LLM_API_KEY` = optional key for OpenAI-compatible local servers (defaults to `local-llm`)
- `LOCAL_LLM_TIMEOUT_MS` = default `10000`
- `OPENAI_API_KEY` (required for fallback-to-OpenAI or OpenAI-only mode)

### Example local LLM setup (Ollama-style)
If your local LLM server is running on `http://127.0.0.1:1234` with Ollama-compatible endpoints:

```bash
export USE_LOCAL_LLM="true"
export LOCAL_LLM_PROVIDER="ollama"
export LOCAL_LLM_BASE_URL="http://127.0.0.1:1234"
export LOCAL_LLM_MODEL="mistral"
```

### Example local LLM setup (OpenAI-compatible, e.g. LM Studio)
```bash
export USE_LOCAL_LLM="true"
export LOCAL_LLM_PROVIDER="openai_compatible"
export LOCAL_LLM_BASE_URL="http://127.0.0.1:1234"
export LOCAL_LLM_MODEL="openai/gpt-oss-20b"
export LOCAL_LLM_API_KEY="local-llm"
```

If local LLM fails, the backend automatically falls back to OpenAI (when `OPENAI_API_KEY` is set).

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
