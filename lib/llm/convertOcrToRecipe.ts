import Groq from "groq-sdk";
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
} from "groq-sdk/resources/chat/completions";
import { ZodError } from "zod";
import type {
  ConvertOcrOptions,
  Recipe,
  RecipeOutputLocale,
} from "./types.js";
import {
  parseRecipeJson,
  extractJsonPayload,
  type ParsedRecipe,
} from "./schema.js";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildRepairPrompt,
} from "./prompts.js";
import { GROQ_MODEL, GROQ_FALLBACK_MODEL } from "./groqModelConfig.js";
import { metricizeAllIngredients } from "./metricIngredients.js";

const DEFAULT_MAX_RETRIES = 3;

/**
 * True when requests go to Groq Cloud (primary→fallback retry only applies there;
 * local OpenAI-compatible servers use unrelated model IDs).
 */
function isGroqCloudBaseURL(baseURL: string | undefined): boolean {
  const b = (baseURL ?? "").trim().toLowerCase();
  if (!b) return true;
  return b.includes("groq.com");
}

/**
 * Detects Groq errors where switching models may help (decommissioned model, invalid id, etc.).
 */
function isGroqModelAvailabilityError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as {
    status?: number;
    message?: string;
    code?: string;
    error?: { message?: string; code?: string };
  };
  const status = e.status;
  const code = String(e.code ?? e.error?.code ?? "");
  const msg = `${e.message ?? ""} ${e.error?.message ?? ""} ${code}`.toLowerCase();

  if (code === "model_decommissioned" || /model_decommissioned/i.test(msg)) {
    return true;
  }
  if (/decommission|invalid model|unknown model|model.*not found|no such model/i.test(msg)) {
    return true;
  }
  if (status === 400 || status === 404) {
    if (/model/.test(msg)) return true;
  }
  return false;
}

/**
 * One chat completion; on Groq Cloud, retries once with {@link GROQ_FALLBACK_MODEL} if the primary fails with a model-availability error.
 */
async function runChatCompletion(
  client: Groq,
  primaryModel: string,
  messages: ChatCompletionMessageParam[],
  jsonMode: "json_object" | "text",
  allowModelFallback: boolean,
): Promise<{ completion: ChatCompletion; modelUsed: string }> {
  const baseBody = {
    model: primaryModel,
    temperature: 0.2,
    messages,
    ...(jsonMode === "json_object"
      ? { response_format: { type: "json_object" as const } }
      : {}),
  };

  try {
    const completion = await client.chat.completions.create(baseBody);
    return { completion, modelUsed: primaryModel };
  } catch (err) {
    if (
      !allowModelFallback ||
      primaryModel === GROQ_FALLBACK_MODEL ||
      !isGroqModelAvailabilityError(err)
    ) {
      throw err;
    }
    console.warn("Primary model unavailable, switching to fallback");
    const completion = await client.chat.completions.create({
      ...baseBody,
      model: GROQ_FALLBACK_MODEL,
    });
    return { completion, modelUsed: GROQ_FALLBACK_MODEL };
  }
}

/**
 * Heuristic OCR quality score (bonus when model omits confidence).
 * Favors alphanumeric density and reasonable length.
 */
export function heuristicOcrConfidence(ocrText: string): number {
  const t = ocrText.trim();
  if (!t.length) return 0;
  const alnum = (t.match(/[a-z0-9]/gi) || []).length;
  const ratio = alnum / t.length;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  const lengthFactor = Math.min(wordCount / 80, 1);
  const raw = 0.25 + 0.45 * ratio + 0.3 * lengthFactor;
  return Math.min(1, Math.max(0, Number(raw.toFixed(3))));
}

function getClient(options: ConvertOcrOptions): Groq {
  if (options.client) return options.client;
  const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "convertOCRToRecipe: missing API key. Pass options.apiKey or set GROQ_API_KEY.",
    );
  }
  const baseURL = options.baseURL ?? process.env.GROQ_BASE_URL;
  return new Groq(
    baseURL ? { apiKey, baseURL } : { apiKey },
  );
}

/**
 * Calls Groq Chat Completions, validates JSON with Zod, retries on failure.
 */
async function callModelAndParse(
  client: Groq,
  model: string,
  messages: ChatCompletionMessageParam[],
  attempt: number,
  maxRetries: number,
  jsonMode: "json_object" | "text",
  allowModelFallback: boolean,
  locale: RecipeOutputLocale,
): Promise<Recipe> {
  const { completion, modelUsed } = await runChatCompletion(
    client,
    model,
    messages,
    jsonMode,
    allowModelFallback,
  );

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("convertOCRToRecipe: empty response from model");
  }

  try {
    const parsed = parseRecipeJson(raw);
    return normalizeRecipe(parsed);
  } catch (err) {
    const msg =
      err instanceof ZodError
        ? err.message
        : err instanceof SyntaxError
          ? err.message
          : String(err);

    if (attempt >= maxRetries) {
      throw new Error(
        `convertOCRToRecipe: invalid JSON after ${maxRetries} attempts: ${msg}`,
        { cause: err },
      );
    }

    const repairUser = buildRepairPrompt(extractJsonPayload(raw), msg, locale);
    const repairMessages: ChatCompletionMessageParam[] = [
      ...messages,
      { role: "assistant", content: raw },
      { role: "user", content: repairUser },
    ];

    // Keep the same model that succeeded for the initial parse attempt; do not re-run primary→fallback.
    return callModelAndParse(
      client,
      modelUsed,
      repairMessages,
      attempt + 1,
      maxRetries,
      jsonMode,
      false,
      locale,
    );
  }
}

function pickJsonMode(baseURL: string | undefined): "json_object" | "text" {
  const b = (baseURL ?? "").trim().toLowerCase();
  if (!b) return "json_object";
  // Local /v1 Chat Completions servers often reject json_object mode.
  if (b.includes("127.0.0.1") || b.includes("localhost")) return "text";
  return "json_object";
}

/**
 * Ensures nullable numbers, trims strings, dedupes ingredient names lightly.
 */
function normalizeRecipe(r: ParsedRecipe): Recipe {
  const ingredients = mergeDuplicateIngredients(
    metricizeAllIngredients(
      r.ingredients.map((ing) => ({
        name: ing.name.trim(),
        quantity: ing.quantity,
        unit: ing.unit?.trim() || null,
      })),
    ),
  );

  return {
    title: r.title.trim() || "Untitled recipe",
    description: r.description.trim(),
    servings: r.servings,
    prep_time_minutes: r.prep_time_minutes,
    cook_time_minutes: r.cook_time_minutes,
    total_time_minutes: r.total_time_minutes,
    ingredients,
    steps: r.steps.map((s) => s.trim()).filter(Boolean),
    notes: r.notes.map((n) => n.trim()).filter(Boolean),
    confidence: r.confidence ?? null,
    source_language: r.source_language ?? null,
  };
}

/**
 * Merges ingredients with the same normalized name (OCR often splits one line into two).
 */
function mergeDuplicateIngredients(
  items: Recipe["ingredients"],
): Recipe["ingredients"] {
  const map = new Map<string, Recipe["ingredients"][0]>();

  for (const ing of items) {
    const key = ing.name.toLowerCase().replace(/\s+/g, " ");
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...ing });
      continue;
    }
    if (existing.quantity == null && ing.quantity != null) {
      existing.quantity = ing.quantity;
      existing.unit = ing.unit ?? existing.unit;
    } else if (ing.quantity != null && existing.quantity != null) {
      existing.quantity = existing.quantity + ing.quantity;
    }
    if (!existing.unit && ing.unit) existing.unit = ing.unit;
  }

  return [...map.values()];
}

function emptyRecipe(): Recipe {
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
    source_language: null,
  };
}

/**
 * Converts raw OCR text into a validated {@link Recipe} using Groq.
 *
 * - Uses JSON response mode when supported + Zod validation
 * - Retries with a repair prompt if parsing fails
 * - Fills missing confidence with {@link heuristicOcrConfidence} when absent
 */
export async function convertOCRToRecipe(
  ocrText: string,
  options: ConvertOcrOptions = {},
): Promise<Recipe> {
  const trimmed = ocrText.trim();
  if (!trimmed) {
    return emptyRecipe();
  }

  const client = getClient(options);
  const model = options.model ?? GROQ_MODEL;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const effectiveBaseURL = options.baseURL ?? process.env.GROQ_BASE_URL;
  const jsonMode = pickJsonMode(effectiveBaseURL);
  const allowModelFallback = isGroqCloudBaseURL(effectiveBaseURL);
  const locale: RecipeOutputLocale =
    options.outputLocale === "nl" ? "nl" : "en";

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(locale) },
    { role: "user", content: buildUserPrompt(trimmed, locale) },
  ];

  let recipe = await callModelAndParse(
    client,
    model,
    messages,
    1,
    maxRetries,
    jsonMode,
    allowModelFallback,
    locale,
  );

  if (recipe.confidence == null) {
    recipe = {
      ...recipe,
      confidence: heuristicOcrConfidence(trimmed),
    };
  }

  return recipe;
}
