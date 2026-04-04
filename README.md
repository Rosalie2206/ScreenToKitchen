# Scroll Cook Repeat

Progressive Web App (Vite) configured for **GitHub Pages** at  
`https://<your-username>.github.io/ScreenToKitchen/` (set `VITE_BASE_PATH` when building).

## Local development

Scroll Cook Repeat has:
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

The **Tech Kitchen → Health check** page uses `/api/health` and will show:
- backend status (up/down)
- LLM status (local / Groq availability)

## LLM mode (hybrid)
The backend converts OCR text using:

- **Local** (Ollama, or a Chat Completions `/v1` server such as LM Studio) first, if enabled
- **Groq** fallback (cloud, fast inference)

Environment variables (set them for `vercel dev` / Vercel):

- `GROQ_API_KEY` — **required** for cloud conversion and health check of Groq
- `GROQ_MODEL` — optional (default `llama-3.1-70b-versatile`; on failure, cloud requests retry once with `llama-3.1-8b-instant`)
- `GROQ_BASE_URL` — optional override (rare)
- `USE_LOCAL_LLM` = `"true"` to try local LLM first (`"false"` skips local and uses Groq only)
- `LOCAL_LLM_PROVIDER` = `ollama` (default), `compatible` (Chat Completions / LM Studio), or `openai_compatible` (same as `compatible`, legacy name)
- `LOCAL_LLM_BASE_URL` = local server base URL (default `http://127.0.0.1:1234`)
- `OLLAMA_BASE_URL` = legacy alias for local base URL (still supported)
- `OLLAMA_MODEL` = default `mistral`
- `LOCAL_LLM_MODEL` = local model id as shown in your tool (e.g. `openai/gpt-oss-20b` in LM Studio)
- `LOCAL_LLM_API_KEY` = optional bearer token for local `/v1` servers (defaults to `local-llm`)
- `LOCAL_LLM_TIMEOUT_MS` = default `10000`

### Example local LLM setup (Ollama-style)
If your local LLM server is running on `http://127.0.0.1:1234` with Ollama-compatible endpoints:

```bash
export USE_LOCAL_LLM="true"
export LOCAL_LLM_PROVIDER="ollama"
export LOCAL_LLM_BASE_URL="http://127.0.0.1:1234"
export LOCAL_LLM_MODEL="mistral"
```

### Example local LLM setup (LM Studio / Chat Completions)
```bash
export USE_LOCAL_LLM="true"
export LOCAL_LLM_PROVIDER="compatible"
export LOCAL_LLM_BASE_URL="http://127.0.0.1:1234"
export LOCAL_LLM_MODEL="openai/gpt-oss-20b"
export LOCAL_LLM_API_KEY="local-llm"
```

If local LLM fails, the backend automatically falls back to **Groq** when `GROQ_API_KEY` is set.

## Build

```bash
npm run build
```

Output is in `dist/` (suitable for any static host).

For **GitHub Pages project sites**, set at build time:

```bash
export VITE_BASE_PATH="/ScreenToKitchen/"
npm run build
```

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. **Repository → Settings → Pages**: set **Source** to **GitHub Actions** (not “Deploy from a branch” unless you prefer that flow).
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` builds with `npm ci` / `npm run build` and publishes `dist` to Pages.

If you rename the repository, update `VITE_BASE_PATH` in the workflow (or env) so asset URLs match (`/<repo>/`).

## “Native” vs GitHub Pages

GitHub Pages only serves **static** HTML, CSS, and JavaScript. It does **not** host iOS/Android or desktop app binaries. A **PWA** (manifest + service worker) is the usual way to get an installable, app-like experience in the browser and still deploy here.
