import { convertOCRToRecipe } from "../convertOcrToRecipe.js";
import { RecipeSchema } from "../schema.js";
import type { Recipe, RecipeOutputLocale } from "../types.js";

/**
 * Fallback conversion using Groq (chat completions).
 *
 * We validate the output shape before returning.
 */
export async function convertOCRToRecipeHybridApi(
  ocrText: string,
  opts: {
    model: string;
    // GROQ_API_KEY is read from env by convertOCRToRecipe
    apiKey?: string;
    baseURL?: string;
    maxRetries?: number;
    outputLocale?: RecipeOutputLocale;
  },
): Promise<Recipe> {
  const recipe = await convertOCRToRecipe(ocrText, {
    model: opts.model,
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    maxRetries: opts.maxRetries ?? 3,
    outputLocale: opts.outputLocale,
  });

  return RecipeSchema.parse(recipe) as Recipe;
}

