import { convertOCRToRecipe } from "../convertOcrToRecipe.js";
import { RecipeSchema } from "../schema.js";
import type { Recipe } from "../types.js";

/**
 * Fallback conversion using the remote API (OpenAI).
 *
 * We validate the output shape before returning.
 */
export async function convertOCRToRecipeHybridApi(
  ocrText: string,
  opts: {
    model: string;
    // OPENAI_API_KEY is read from env by convertOCRToRecipe
    apiKey?: string;
    baseURL?: string;
    maxRetries?: number;
  },
): Promise<Recipe> {
  const recipe = await convertOCRToRecipe(ocrText, {
    model: opts.model,
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    maxRetries: opts.maxRetries ?? 3,
  });

  return RecipeSchema.parse(recipe) as Recipe;
}

