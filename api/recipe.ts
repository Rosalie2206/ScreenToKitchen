/**
 * Vercel serverless function: POST /api/recipe
 * Converts OCR text to a structured recipe via hybrid LLM (local optional + Groq fallback).
 * API keys stay server-side only.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ParsedRecipe } from "../lib/llm/schema.js";
import type { Recipe } from "../types/recipe.js";
import { convertOCRToRecipeHybrid } from "../lib/llm/hybrid/hybrid.js";
import {
  parseLocalLlmProviderFromRequest,
  type LocalLlmWireFormat,
} from "../lib/llm/localProviderMode.js";
import { saveRecipe } from "../lib/db.js";

function messageFromUnknown(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  return fallback;
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

function resolveLocalLlmProvider(req: VercelRequest): LocalLlmWireFormat {
  return parseLocalLlmProviderFromRequest(
    req.headers["x-local-llm-provider"],
    req.query.localProvider,
    process.env.LOCAL_LLM_PROVIDER,
  );
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

  const rawLocale =
    typeof body === "object" &&
    body !== null &&
    "outputLocale" in body &&
    typeof (body as { outputLocale: unknown }).outputLocale === "string"
      ? (body as { outputLocale: string }).outputLocale.trim().toLowerCase()
      : "";
  const outputLocale =
    rawLocale === "nl" ? ("nl" as const) : ("en" as const);

  // Hybrid: optional local LLM first, then Groq (see lib/llm/hybrid/hybrid.ts).
  try {
    const useLocalLlm = resolveUseLocalLlm(req);
    const localProvider = resolveLocalLlmProvider(req);
    const hybridRecipe = await convertOCRToRecipeHybrid(text, {
      useLocalLlm,
      localProvider,
      outputLocale,
    });
    const recipe = toRecipeResponse(hybridRecipe as ParsedRecipe) as Recipe;
    let id: string | undefined;
    let created_at: string | undefined;
    try {
      const saved = saveRecipe(recipe);
      id = saved.id;
      created_at = saved.created_at;
    } catch (dbErr) {
      console.error("saveRecipe after LLM:", dbErr);
    }
    res.status(200).json({
      recipe,
      ...(id && created_at ? { id, created_at } : {}),
    });
  } catch (e) {
    res.status(502).json({
      error: messageFromUnknown(
        e,
        "Failed to convert OCR text to recipe",
      ),
      code: "HYBRID_LLM_ERROR",
    });
  }
}
