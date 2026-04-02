import type {
  Recipe,
  RecipeApiErrorResponse,
  RecipeApiSuccessResponse,
} from "../../types/recipe";

/**
 * Base URL for API calls. On Vercel (same deployment), leave empty so requests go to /api/recipe.
 * For static hosting (e.g. GitHub Pages) pointing at a Vercel API, set in .env:
 *   VITE_API_BASE_URL=https://your-deployment.vercel.app
 */
function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (base?.replace(/\/$/, "") ?? "") as string;
}

function resolveUseLocalLlmOverride(): boolean | undefined {
  const raw = import.meta.env.VITE_USE_LOCAL_LLM;
  if (raw == null) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

function resolveLocalLlmProviderOverride(): string | undefined {
  const raw = import.meta.env.VITE_LOCAL_LLM_PROVIDER;
  if (raw == null) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === "openai_compatible" || v === "ollama") return v;
  return undefined;
}

export class RecipeApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "RecipeApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Calls POST /api/recipe with OCR text and returns the structured recipe.
 * Does not send secrets — the Groq key stays on the server.
 */
export async function fetchRecipe(ocrText: string): Promise<Recipe> {
  const trimmed = ocrText.trim();
  if (!trimmed) {
    throw new RecipeApiError("ocrText is empty", 400, "VALIDATION_ERROR");
  }

  const url = `${apiBase()}/api/recipe`;
  let res: Response;
  try {
    const useLocal = resolveUseLocalLlmOverride();
    const provider = resolveLocalLlmProviderOverride();
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (typeof useLocal === "boolean") {
      headers["x-use-local-llm"] = String(useLocal);
    }
    if (provider) {
      headers["x-local-llm-provider"] = provider;
    }
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ocrText: trimmed } satisfies { ocrText: string }),
    });
  } catch (e) {
    throw new RecipeApiError(
      e instanceof Error ? e.message : "Network request failed",
      0,
      "NETWORK_ERROR",
    );
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    // If the backend crashed, we might get an HTML error page instead of JSON.
    let bodySnippet = "";
    try {
      bodySnippet = await res.text();
    } catch {
      // ignore
    }
    bodySnippet = bodySnippet.trim().slice(0, 300);
    throw new RecipeApiError(
      `Invalid JSON in response (HTTP ${res.status}). ${bodySnippet ? `Snippet: ${bodySnippet}` : ""}`,
      res.status,
      "BAD_RESPONSE",
    );
  }

  if (!res.ok) {
    const err = payload as Partial<RecipeApiErrorResponse>;
    throw new RecipeApiError(
      err.error ?? `Request failed with status ${res.status}`,
      res.status,
      err.code,
    );
  }

  const data = payload as Partial<RecipeApiSuccessResponse>;
  if (!data.recipe || typeof data.recipe !== "object") {
    throw new RecipeApiError("Response missing recipe", res.status, "BAD_RESPONSE");
  }

  return data.recipe;
}
