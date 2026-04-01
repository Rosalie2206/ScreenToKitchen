/**
 * Structured recipe returned by POST /api/recipe (shared contract for client + API).
 */
export type Ingredient = {
  name: string;
  quantity: number | null;
  unit: string | null;
};

export type Recipe = {
  title: string;
  description: string;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  ingredients: Ingredient[];
  steps: string[];
  notes: string[];
  /** Optional: extraction / OCR quality estimate (0–1) */
  confidence_score?: number;
};

export type RecipeApiRequestBody = {
  ocrText: string;
};

export type RecipeApiSuccessResponse = {
  recipe: Recipe;
};

export type RecipeApiErrorResponse = {
  error: string;
  code?: string;
};
