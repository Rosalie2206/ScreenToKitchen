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
 * Does not send secrets — the OpenAI key stays on the server.
 */
export async function fetchRecipe(ocrText: string): Promise<Recipe> {
  const trimmed = ocrText.trim();
  if (!trimmed) {
    throw new RecipeApiError("ocrText is empty", 400, "VALIDATION_ERROR");
  }

  const url = `${apiBase()}/api/recipe`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    throw new RecipeApiError("Invalid JSON in response", res.status, "BAD_RESPONSE");
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
