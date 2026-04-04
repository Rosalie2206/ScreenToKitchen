import type { Recipe } from "../../types/recipe";
import { RecipeApiError } from "./fetchRecipe.js";

function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return (base?.replace(/\/$/, "") ?? "") as string;
}

export type CatalogueEntry = {
  id: string;
  savedAt: number;
  recipe: Recipe;
};

/**
 * GET /api/recipes — saved recipes (newest first).
 */
export async function fetchRecipesCatalogue(): Promise<CatalogueEntry[]> {
  const url = `${apiBase()}/api/recipes`;
  let res: Response;
  try {
    res = await fetch(url);
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
    throw new RecipeApiError(
      `Invalid JSON (HTTP ${res.status})`,
      res.status,
      "BAD_RESPONSE",
    );
  }

  if (!res.ok) {
    const err = payload as { error?: string; code?: string };
    throw new RecipeApiError(
      err.error ?? `Request failed (${res.status})`,
      res.status,
      err.code,
    );
  }

  const data = payload as {
    recipes?: Array<{ id: string; created_at: string; recipe: Recipe }>;
  };
  if (!Array.isArray(data.recipes)) {
    throw new RecipeApiError("Response missing recipes", res.status, "BAD_RESPONSE");
  }

  return data.recipes.map((r) => ({
    id: r.id,
    savedAt: Date.parse(r.created_at),
    recipe: r.recipe,
  }));
}

/**
 * GET /api/recipes/:id
 */
export async function fetchRecipeById(id: string): Promise<Recipe | null> {
  const url = `${apiBase()}/api/recipes/${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new RecipeApiError(
      e instanceof Error ? e.message : "Network request failed",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 404) return null;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new RecipeApiError(
      `Invalid JSON (HTTP ${res.status})`,
      res.status,
      "BAD_RESPONSE",
    );
  }

  if (!res.ok) {
    const err = payload as { error?: string; code?: string };
    throw new RecipeApiError(
      err.error ?? `Request failed (${res.status})`,
      res.status,
      err.code,
    );
  }

  const data = payload as { recipe?: Recipe };
  if (!data.recipe || typeof data.recipe !== "object") {
    throw new RecipeApiError("Response missing recipe", res.status, "BAD_RESPONSE");
  }
  return data.recipe;
}

/**
 * DELETE /api/recipes/:id
 */
export async function deleteRecipeApi(id: string): Promise<void> {
  const url = `${apiBase()}/api/recipes/${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "DELETE" });
  } catch (e) {
    throw new RecipeApiError(
      e instanceof Error ? e.message : "Network request failed",
      0,
      "NETWORK_ERROR",
    );
  }

  if (res.status === 204 || res.status === 404) return;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new RecipeApiError(`Delete failed (${res.status})`, res.status, "BAD_RESPONSE");
  }

  const err = payload as { error?: string; code?: string };
  throw new RecipeApiError(
    err.error ?? `Request failed (${res.status})`,
    res.status,
    err.code,
  );
}

/**
 * POST /api/recipes — manual save (e.g. when conversion did not persist).
 */
export async function postRecipe(recipe: Recipe): Promise<{
  id: string;
  created_at: string;
}> {
  const url = `${apiBase()}/api/recipes`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipe }),
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
    throw new RecipeApiError(
      `Invalid JSON (HTTP ${res.status})`,
      res.status,
      "BAD_RESPONSE",
    );
  }

  if (!res.ok) {
    const err = payload as { error?: string; code?: string };
    throw new RecipeApiError(
      err.error ?? `Request failed (${res.status})`,
      res.status,
      err.code,
    );
  }

  const data = payload as { id?: string; created_at?: string };
  if (!data.id || !data.created_at) {
    throw new RecipeApiError("Response missing id", res.status, "BAD_RESPONSE");
  }
  return { id: data.id, created_at: data.created_at };
}
