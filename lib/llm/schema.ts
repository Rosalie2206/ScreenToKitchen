import { z } from "zod";

/**
 * Zod schema mirroring the Recipe type — used to validate LLM output at runtime.
 */
export const IngredientSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
});

export const RecipeSchema = z.object({
  title: z.string(),
  description: z.string(),
  servings: z.number().nullable(),
  prep_time_minutes: z.number().nullable(),
  cook_time_minutes: z.number().nullable(),
  total_time_minutes: z.number().nullable(),
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string()),
  notes: z.array(z.string()),
  confidence: z.number().min(0).max(1).nullable().optional(),
  source_language: z.string().nullable().optional(),
});

export type ParsedRecipe = z.infer<typeof RecipeSchema>;

/**
 * Strips optional ```json fences if the model wraps output in markdown.
 */
export function extractJsonPayload(raw: string): string {
  let t = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(t);
  if (fenced) t = fenced[1].trim();
  // Some models may include leading/trailing commentary even when instructed.
  // To be more robust, if we don't clearly have a JSON object, try extracting
  // the first top-level `{...}` region.
  if (!t.startsWith("{") || !t.endsWith("}")) {
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      t = t.slice(start, end + 1).trim();
    }
  }
  return t;
}

/**
 * Parses and validates JSON string into a Recipe object.
 * @throws z.ZodError if structure does not match
 */
export function parseRecipeJson(jsonString: string): ParsedRecipe {
  const payload = extractJsonPayload(jsonString);
  const data: unknown = JSON.parse(payload);
  return RecipeSchema.parse(data);
}
