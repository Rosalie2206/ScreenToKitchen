import OpenAI from "openai";
import { ZodError } from "zod";
import type { ConvertOcrOptions, Recipe } from "./types.js";
import {
  parseRecipeJson,
  extractJsonPayload,
  type ParsedRecipe,
} from "./schema.js";
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  buildRepairPrompt,
} from "./prompts.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_RETRIES = 3;

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

function getClient(options: ConvertOcrOptions): OpenAI {
  if (options.client) return options.client;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "convertOCRToRecipe: missing API key. Pass options.apiKey or set OPENAI_API_KEY.",
    );
  }
  const baseURL = options.baseURL ?? process.env.OPENAI_BASE_URL;
  return new OpenAI({ apiKey, baseURL });
}

/**
 * Calls OpenAI Chat Completions with JSON mode, validates with Zod, retries on failure.
 */
async function callModelAndParse(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  attempt: number,
  maxRetries: number,
  jsonMode: "json_object" | "text",
): Promise<Recipe> {
  const request: OpenAI.Chat.ChatCompletionCreateParams = {
    model,
    temperature: 0.2,
    messages,
  };
  if (jsonMode === "json_object") {
    request.response_format = { type: "json_object" };
  }
  const completion = await client.chat.completions.create(request);

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

    // Retry: ask model to repair (keeps system prompt + user OCR + repair instruction)
    const repairUser = buildRepairPrompt(extractJsonPayload(raw), msg);
    const repairMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...messages,
      { role: "assistant", content: raw },
      { role: "user", content: repairUser },
    ];

    return callModelAndParse(
      client,
      model,
      repairMessages,
      attempt + 1,
      maxRetries,
      jsonMode,
    );
  }
}

function pickJsonMode(baseURL: string | undefined): "json_object" | "text" {
  const b = (baseURL ?? "").trim().toLowerCase();
  if (!b) return "json_object";
  // Local OpenAI-compatible servers often reject json_object mode.
  if (b.includes("127.0.0.1") || b.includes("localhost")) return "text";
  return "json_object";
}

/**
 * Ensures nullable numbers, trims strings, dedupes ingredient names lightly.
 */
function normalizeRecipe(r: ParsedRecipe): Recipe {
  const ingredients = mergeDuplicateIngredients(
    r.ingredients.map((ing) => ({
      name: ing.name.trim(),
      quantity: ing.quantity,
      unit: ing.unit?.trim() || null,
    })),
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
    // Prefer the entry that has quantity info; concatenate names only if different wording
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
 * Converts raw OCR text into a validated {@link Recipe} using OpenAI.
 *
 * - Uses JSON response mode + Zod validation
 * - Retries with a repair prompt if parsing fails
 * - Fills missing confidence with {@link heuristicOcrConfidence} when absent
 *
 * @param ocrText - Raw OCR output from an image
 * @param options - API key, model, retries, optional client
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
  const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const effectiveBaseURL = options.baseURL ?? process.env.OPENAI_BASE_URL;
  const jsonMode = pickJsonMode(effectiveBaseURL);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(trimmed) },
  ];

  let recipe = await callModelAndParse(client, model, messages, 1, maxRetries, jsonMode);

  // Bonus: ensure confidence is set (prefer model; else heuristic)
  if (recipe.confidence == null) {
    recipe = {
      ...recipe,
      confidence: heuristicOcrConfidence(trimmed),
    };
  }

  return recipe;
}
