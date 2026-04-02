import type Groq from "groq-sdk";

/**
 * Structured recipe returned by {@link convertOCRToRecipe}.
 * Core fields match the product schema; bonus fields are optional.
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
  /** Bonus: 0–1 heuristic or model-estimated confidence in extraction quality */
  confidence?: number | null;
  /** Bonus: detected OCR / recipe language (ISO 639-1), if not English */
  source_language?: string | null;
};

export type ConvertOcrOptions = {
  /** Defaults to process.env.GROQ_API_KEY */
  apiKey?: string;
  /** Optional Groq API base URL override */
  baseURL?: string;
  /** Groq model id (e.g. llama-3.1-70b-versatile) */
  model?: string;
  /** Retries when the model returns invalid JSON or validation fails (default 3) */
  maxRetries?: number;
  /** Inject a custom Groq client (for tests or proxies) */
  client?: Groq;
};
