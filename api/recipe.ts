/**
 * Vercel serverless function: POST /api/recipe
 * Converts OCR text to a structured recipe via OpenAI. API key stays server-side only.
 */
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ZodError } from "zod";
import {
  parseRecipeJson,
  extractJsonPayload,
  type ParsedRecipe,
} from "../lib/llm/schema.js";
import type { Recipe } from "../types/recipe.js";
import { convertOCRToRecipeLocal } from "../lib/llm/convertOcrToRecipeLocal.js";
import { convertOCRToRecipeHybrid } from "../lib/llm/hybrid/hybrid.js";

const SYSTEM_PROMPT =
  "You are a professional chef and recipe editor. Convert messy OCR text into a clean, structured recipe. Infer missing details when reasonable, but do not hallucinate unrealistic ingredients or steps.";

const MODEL = "gpt-4.1" as const;
const TEMPERATURE = 0.2;
const USE_OLLAMA =
  process.env.USE_OLLAMA?.trim().toLowerCase() === "true" ||
  (process.env.OLLAMA_BASE_URL?.trim().length ?? 0) > 0;

function messageFromUnknown(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

function zodOrErrorMessage(err: unknown): string {
  if (err instanceof ZodError) return err.message;
  if (err instanceof SyntaxError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Vercel may provide parsed JSON or a raw string depending on config. */
function parseRequestBody(body: unknown): unknown {
  if (body == null) return undefined;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  return body;
}

function buildUserPrompt(ocrText: string): string {
  return `Convert the following OCR text into a structured recipe JSON following this schema:

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

Additional instructions (still output a single JSON object only):
- Clean OCR noise: fix broken words, remove stray characters, merge lines that belong together.
- Normalize units to common forms (g, kg, ml, L, cups, tbsp, tsp, °F/°C in step text as needed).
- Merge duplicate ingredients if OCR split one item across lines.
- Optionally add "confidence" (number 0–1) reflecting how reliable the OCR text seemed; we map it to confidence_score in the response.`;
}

/** Second attempt: stricter JSON-only instruction (requirement: retry once if parsing fails). */
const RETRY_USER_ADDENDUM = `Your previous reply was not valid JSON or did not match the schema.

Return ONLY one JSON object, no markdown fences, no commentary. The object must include keys: title, description, servings, prep_time_minutes, cook_time_minutes, total_time_minutes, ingredients, steps, notes. Use null for unknown numbers.`;

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  return new OpenAI({ apiKey });
}

function setCors(res: VercelResponse, origin: string | undefined): void {
  const allow =
    process.env.ALLOWED_ORIGIN?.trim() ||
    origin ||
    "*";
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-use-local-llm, x-local-llm-provider",
  );
}

function parseBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

function resolveUseLocalLlm(req: VercelRequest): boolean {
  const headerValue = req.headers["x-use-local-llm"];
  const fromHeader = Array.isArray(headerValue)
    ? parseBooleanLike(headerValue[0])
    : parseBooleanLike(headerValue);
  if (typeof fromHeader === "boolean") return fromHeader;

  const fromQuery = parseBooleanLike(req.query.useLocal);
  if (typeof fromQuery === "boolean") return fromQuery;

  return process.env.USE_LOCAL_LLM?.trim().toLowerCase() === "true";
}

function resolveLocalLlmProvider(req: VercelRequest): "ollama" | "openai_compatible" {
  const headerValue = req.headers["x-local-llm-provider"];
  const fromHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const normalized = String(fromHeader ?? req.query.localProvider ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "openai_compatible") return "openai_compatible";
  if (normalized === "ollama") return "ollama";
  return process.env.LOCAL_LLM_PROVIDER?.trim().toLowerCase() === "openai_compatible"
    ? "openai_compatible"
    : "ollama";
}

/**
 * Maps parsed LLM output (may include optional confidence) to the public Recipe type.
 */
function toRecipeResponse(p: ParsedRecipe): Recipe {
  const base: Recipe = {
    title: p.title.trim() || "Recipe",
    description: p.description.trim(),
    servings: p.servings,
    prep_time_minutes: p.prep_time_minutes,
    cook_time_minutes: p.cook_time_minutes,
    total_time_minutes: p.total_time_minutes,
    ingredients: p.ingredients.map(
      (i: ParsedRecipe["ingredients"][number]) => ({
        name: i.name.trim(),
        quantity: i.quantity,
        unit: i.unit?.trim() || null,
      }),
    ),
    steps: p.steps.map((s: string) => s.trim()).filter(Boolean),
    notes: p.notes.map((n: string) => n.trim()).filter(Boolean),
  };
  const c = p.confidence;
  if (typeof c === "number" && c >= 0 && c <= 1) {
    base.confidence_score = c;
  }
  return base;
}

async function runCompletion(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: TEMPERATURE,
    response_format: { type: "json_object" },
    messages,
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Empty completion from OpenAI");
  }
  return raw;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const origin = req.headers.origin as string | undefined;
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({
      error: "Method not allowed",
      code: "METHOD_NOT_ALLOWED",
    });
    return;
  }

  const body = parseRequestBody(req.body);
  if (body === undefined) {
    res.status(400).json({
      error: "Invalid JSON body",
      code: "INVALID_JSON",
    });
    return;
  }

  const text =
    typeof body === "object" &&
    body !== null &&
    "ocrText" in body &&
    typeof (body as { ocrText: unknown }).ocrText === "string"
      ? (body as { ocrText: string }).ocrText.trim()
      : "";

  if (!text) {
    res.status(400).json({
      error: "Missing or invalid ocrText",
      code: "VALIDATION_ERROR",
    });
    return;
  }

  // Hybrid mode (local first if enabled via env):
  // - If USE_LOCAL_LLM=true, we attempt Ollama first with a short timeout.
  // - If local fails (network/timeout/JSON), we fall back to OpenAI automatically.
  try {
    const useLocalLlm = resolveUseLocalLlm(req);
    const localProvider = resolveLocalLlmProvider(req);
    const hybridRecipe = await convertOCRToRecipeHybrid(text, {
      useLocalLlm,
      localProvider,
    });
    res.status(200).json({
      recipe: toRecipeResponse(hybridRecipe as ParsedRecipe) as Recipe,
    });
    return;
  } catch (e) {
    res.status(502).json({
      error: messageFromUnknown(
        e,
        "Failed to convert OCR text to recipe",
      ),
      code: "HYBRID_LLM_ERROR",
    });
    return;
  }

  let client: OpenAI;
  try {
    client = getOpenAI();
  } catch (e) {
    res.status(500).json({
      error: messageFromUnknown(e, "Server configuration error"),
      code: "CONFIG_ERROR",
    });
    return;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(text) },
  ];

  let raw: string;
  try {
    raw = await runCompletion(client, messages);
  } catch (e) {
    res.status(502).json({
      error: messageFromUnknown(e, "OpenAI request failed"),
      code: "OPENAI_ERROR",
    });
    return;
  }

  let parsed: ParsedRecipe;
  try {
    parsed = parseRecipeJson(raw);
  } catch (firstErr) {
    // Retry once with stricter instruction (requirement #4)
    const msg = zodOrErrorMessage(firstErr);

    const retryMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...messages,
      { role: "assistant", content: extractJsonPayload(raw).slice(0, 12000) },
      {
        role: "user",
        content: `${RETRY_USER_ADDENDUM}\n\nParse/validation error: ${msg}`,
      },
    ];

    let raw2: string;
    try {
      raw2 = await runCompletion(client, retryMessages);
    } catch (e) {
      res.status(502).json({
        error: messageFromUnknown(e, "OpenAI retry failed"),
        code: "OPENAI_ERROR",
      });
      return;
    }

    try {
      parsed = parseRecipeJson(raw2);
    } catch {
      res.status(500).json({
        error: "Model returned invalid JSON after retry",
        code: "INVALID_MODEL_OUTPUT",
      });
      return;
    }
  }

  res.status(200).json({ recipe: toRecipeResponse(parsed) });
}
