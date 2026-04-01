/**
 * LLM-based OCR → structured recipe conversion (Node.js).
 *
 * @example
 * ```ts
 * import { convertOCRToRecipe } from "./lib/llm/index.js";
 *
 * const recipe = await convertOCRToRecipe(ocrString, {
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 * ```
 */
export { convertOCRToRecipe, heuristicOcrConfidence } from "./convertOcrToRecipe.js";
export type { Recipe, Ingredient, ConvertOcrOptions } from "./types.js";
export { RecipeSchema, IngredientSchema, parseRecipeJson } from "./schema.js";
export { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";
