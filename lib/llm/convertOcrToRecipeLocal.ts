/**
 * Local OCR text -> structured recipe conversion using Ollama.
 *
 * IMPORTANT:
 * - This file is intended for Node.js/server-side code.
 * - Ollama must be running locally on the same machine.
 * - We never expose any API key to the client.
 */

import { parseRecipeJson } from "./schema.js";
import { metricizeAllIngredients } from "./metricIngredients.js";
import type { RecipeOutputLocale } from "./types.js";

const DEFAULT_MODEL = "mistral";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRIES = 2; // requirement: retry once after JSON failure (so attempts up to 2)

const OLLAMA_BASE_URL = "http://127.0.0.1:1234";

/**
 * Recipe interface (matches your requested schema).
 * Bonus fields are optional.
 */
export interface Recipe {
  title: string;
  description: string;
  servings: number | null;
  prep_time_minutes: number | null;
  cook_time_minutes: number | null;
  total_time_minutes: number | null;
  ingredients: {
    name: string;
    quantity: number | null;
    unit: string | null;
  }[];
  steps: string[];
  notes: string[];
  /**
   * Bonus: heuristic confidence score (0–1) based on OCR quality / parse success.
   * Named `confidence` to align with the rest of this repo’s LLM types.
   */
  confidence?: number | null;
}

export type ConvertOcrToRecipeLocalOptions = {
  model?: string;
  /** Override base URL if you run Ollama elsewhere. */
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  /** Retry count after failure. Requirement says retry once; default implements that. */
  maxRetries?: number;
  /** Recipe narrative language (default English). */
  outputLocale?: RecipeOutputLocale;
};

const SYSTEM_PROMPT_BASE =
  "You are a professional chef and recipe editor. Convert messy OCR text into a clean, structured recipe. Express ingredient weights in grams or kilograms only—convert all ounces and pounds to metric; never leave oz or lb in the JSON output.";

const SYSTEM_PROMPT_NL =
  " All title, description, ingredient names, steps, and notes in the JSON must be written in Dutch (Flemish/Belgian standard). Translate from the OCR when it is not Dutch.";

function systemPrompt(locale: RecipeOutputLocale): string {
  return (
    SYSTEM_PROMPT_BASE + (locale === "nl" ? SYSTEM_PROMPT_NL : "")
  );
}

const USER_PROMPT_NL_RULE = `
- **Language:** Every title, description, ingredient name, step, and note must be in Dutch (Flemish/Belgian standard). Translate from the OCR if needed.
`;

function buildUserPrompt(ocrText: string, locale: RecipeOutputLocale): string {
  const langBlock = locale === "nl" ? USER_PROMPT_NL_RULE : "";
  return `Convert the following OCR text into structured JSON:

{
  title: string,
  description: string,
  servings: number | null,
  prep_time_minutes: number | null,
  cook_time_minutes: number | null,
  total_time_minutes: number | null,
  ingredients: {
    name: string,
    quantity: number | null,
    unit: string | null
  }[],
  steps: string[],
  notes: string[]
}

OCR TEXT:
${ocrText}

IMPORTANT:
- Return ONLY valid JSON
- No explanations
${langBlock}- Convert US/imperial measures to metric in the output:
- Temperatures: °F → °C in step text (e.g. 350°F → 175°C)
- Weight: **oz / ounces → grams**: multiply quantity by 28.35, round sensibly; set unit to "g" or "kg". **Never** output unit "oz". lb/lbs → g or kg (1 lb = 453.59 g).
- Liquids: fl oz → ml when clearly fluid measure (1 US fl oz ≈ 29.57 ml)
- Dry volume: cups / tbsp / tsp → ml where applicable
- Ingredient unit field must be only: g, kg, ml, L, or null
`;
}

function buildStrictJsonRetryPrompt(
  ocrText: string,
  locale: RecipeOutputLocale,
): string {
  const langBlock = locale === "nl" ? USER_PROMPT_NL_RULE : "";
  return `Convert the following OCR text into structured JSON:

{
  title: string,
  description: string,
  servings: number | null,
  prep_time_minutes: number | null,
  cook_time_minutes: number | null,
  total_time_minutes: number | null,
  ingredients: {
    name: string,
    quantity: number | null,
    unit: string | null
  }[],
  steps: string[],
  notes: string[]
}

OCR TEXT:
${ocrText}

IMPORTANT:
- ONLY RETURN VALID JSON. NO TEXT.
${langBlock}- Convert US/imperial to metric:
- Temperatures: °F → °C in step text (e.g. 350°F → 175°C)
- Weight: oz → g (quantity × 28.35); never output unit "oz". lb → g or kg (1 lb = 453.59 g)
- Liquids: fl oz → ml when clearly fluid (1 US fl oz ≈ 29.57 ml)
- Volume: cups / tbsp / tsp → ml where applicable
- Ingredient unit field: only g, kg, ml, L, or null
`;
}

function heuristicOcrConfidence(ocrText: string): number {
  const t = ocrText.trim();
  if (!t.length) return 0;
  const letters = (t.match(/[a-z0-9]/gi) || []).length;
  const ratio = letters / t.length;
  const words = t.split(/\s+/).filter(Boolean).length;
  const lengthFactor = Math.min(words / 80, 1);
  const score = 0.25 + 0.45 * ratio + 0.3 * lengthFactor;
  return Math.min(1, Math.max(0, Number(score.toFixed(3))));
}

function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase();
  if (!u) return null;

  const map: Record<string, string> = {
    grams: "g",
    gram: "g",
    g: "g",
    kilograms: "kg",
    kilogram: "kg",
    kg: "kg",
    milliliters: "ml",
    milliliter: "ml",
    ml: "ml",
    liters: "l",
    liter: "l",
    cups: "cup",
    cup: "cup",
    tbsp: "tbsp",
    "tbsps": "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    "tbsp.": "tbsp",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
  };

  return map[u] ?? unit.trim();
}

function normalizeRecipe(recipe: Recipe): Recipe {
  return {
    ...recipe,
    ingredients: metricizeAllIngredients(
      recipe.ingredients.map((ing) => ({
        ...ing,
        unit: normalizeUnit(ing.unit),
        name: ing.name.trim(),
      })),
    ),
    steps: recipe.steps.map((s) => s.trim()).filter(Boolean),
    notes: recipe.notes.map((n) => n.trim()).filter(Boolean),
    title: recipe.title.trim() || "Recipe",
    description: recipe.description.trim(),
  };
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ollamaGenerate(
  ollamaBaseUrl: string,
  model: string,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Ollama request failed (${res.status}). ${text}`.trim(),
      );
    }

    const data: unknown = await res.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("response" in data) ||
      typeof (data as { response?: unknown }).response !== "string"
    ) {
      throw new Error("Ollama response missing `response` field");
    }

    return (data as { response: string }).response;
  } finally {
    clearTimeout(timeout);
  }
}

function formatOllamaError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return `Ollama request timed out after ${DEFAULT_TIMEOUT_MS}ms. Is the model still loading?`;
  }
  if (err instanceof Error) {
    const msg = err.message || String(err);
    if (
      msg.includes("ECONNREFUSED") ||
      msg.toLowerCase().includes("connection refused") ||
      msg.toLowerCase().includes("failed to fetch") ||
      msg.toLowerCase().includes("fetch failed")
    ) {
      return `Could not reach local LLM at ${OLLAMA_BASE_URL}. Make sure it is running (check: http://127.0.0.1:1234). Original error: ${msg}`;
    }
    return msg;
  }
  return String(err);
}

export async function convertOCRToRecipeLocal(
  ocrText: string,
  options: ConvertOcrToRecipeLocalOptions = {},
): Promise<Recipe> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const model = options.model ?? DEFAULT_MODEL;
  const ollamaBaseUrl = options.ollamaBaseUrl ?? OLLAMA_BASE_URL;
  const outputLocale: RecipeOutputLocale =
    options.outputLocale === "nl" ? "nl" : "en";

  const trimmed = ocrText.trim();
  if (!trimmed) {
    return {
      title: "Recipe",
      description: "",
      servings: null,
      prep_time_minutes: null,
      cook_time_minutes: null,
      total_time_minutes: null,
      ingredients: [],
      steps: [],
      notes: [],
      confidence: 0,
    };
  }

  const ocrConfidence = heuristicOcrConfidence(trimmed);
  let lastErr: unknown = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const isRetry = attempt > 0;
    const userPrompt = isRetry
      ? buildStrictJsonRetryPrompt(trimmed, outputLocale)
      : buildUserPrompt(trimmed, outputLocale);

    // Ollama is a single-prompt interface, so we combine SYSTEM + USER.
    const prompt = `SYSTEM:\n${systemPrompt(outputLocale)}\n\nUSER:\n${userPrompt}\n`;

    try {
      const rawResponse = await ollamaGenerate(
        ollamaBaseUrl,
        model,
        prompt,
        timeoutMs,
      );

      const jsonCandidate = extractFirstJsonObject(rawResponse);
      if (!jsonCandidate) {
        throw new Error("Could not find a JSON object in Ollama output");
      }

      // Validate + parse with the existing strict schema in this repo.
      const parsed = parseRecipeJson(jsonCandidate) as unknown;

      // The repo’s schema allows optional `confidence` fields; we map to the required interface.
      const recipe = normalizeRecipe(parsed as Recipe);
      if (recipe.confidence == null) recipe.confidence = ocrConfidence;
      return recipe;
    } catch (err) {
      lastErr = err;
      // Exponential-ish backoff: 300ms, 600ms, 1200ms...
      if (attempt < maxRetries - 1) await sleep(300 * 2 ** attempt);
    }
  }

  const message = formatOllamaError(lastErr);
  // JSON parsing errors should surface clearly.
  throw new Error(
    `convertOCRToRecipeLocal: failed after ${maxRetries} attempts. ${message}`,
  );
}

