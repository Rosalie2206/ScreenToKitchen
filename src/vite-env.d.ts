/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full origin of the Vercel deployment when the UI is hosted elsewhere (e.g. GitHub Pages). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
