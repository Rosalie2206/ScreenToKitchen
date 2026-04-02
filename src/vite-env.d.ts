/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full origin of the Vercel deployment when the UI is hosted elsewhere (e.g. GitHub Pages). */
  readonly VITE_API_BASE_URL?: string;
  /** Optional per-request override for local-first mode sent as x-use-local-llm. */
  readonly VITE_USE_LOCAL_LLM?: string;
  /** Optional per-request override for local provider: "ollama" or "openai_compatible". */
  readonly VITE_LOCAL_LLM_PROVIDER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
