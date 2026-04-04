import { RecipeSchema } from "../schema.js";
import { convertOCRToRecipeLocal } from "../convertOcrToRecipeLocal.js";
import type { Recipe, RecipeOutputLocale } from "../types.js";

/**
 * Local-first conversion using Ollama.
 *
 * Implements:
 * - timeout wrapper
 * - JSON/shape validation (Zod via RecipeSchema)
 * - treats any failure as an exception (hybrid.ts will decide fallback)
 */

export async function convertOCRToRecipeHybridLocal(
  ocrText: string,
  opts: {
    timeoutMs: number;
    ollamaBaseUrl: string;
    model: string;
    outputLocale?: RecipeOutputLocale;
  },
): Promise<Recipe> {
  // convertOCRToRecipeLocal already enforces schema validation by parsing.
  // We still do an extra Zod validation here to satisfy "Validate result shape".
  const validated = await withTimeout(
    convertOCRToRecipeLocal(ocrText, {
      model: opts.model,
      ollamaBaseUrl: opts.ollamaBaseUrl,
      timeoutMs: opts.timeoutMs,
      outputLocale: opts.outputLocale,
      // Local implementation already retries once on JSON parse failures.
      // We keep it at 2 attempts to match "retry once".
      maxRetries: 2,
    }),
    opts.timeoutMs,
    "Local LLM timed out",
  );

  // RecipeSchema ignores unknown keys, so any local bonus fields are fine.
  return RecipeSchema.parse(validated) as Recipe;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

