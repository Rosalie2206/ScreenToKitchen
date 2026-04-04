/**
 * GET /api/recipes — list all saved recipes
 * POST /api/recipes — save a recipe body (manual save)
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Recipe } from "../../types/recipe.js";
import { getRecipes, saveRecipe } from "../../lib/db.js";

function setCors(res: VercelResponse, origin: string | undefined): void {
  const allow = process.env.ALLOWED_ORIGIN?.trim() || origin || "*";
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-use-local-llm, x-local-llm-provider",
  );
}

function parseBody(body: unknown): unknown {
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

function isRecipeShape(x: unknown): x is Recipe {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.title === "string" &&
    typeof o.description === "string" &&
    Array.isArray(o.ingredients) &&
    Array.isArray(o.steps) &&
    Array.isArray(o.notes)
  );
}

export default function handler(
  req: VercelRequest,
  res: VercelResponse,
): void {
  const origin = req.headers.origin as string | undefined;
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    if (req.method === "GET") {
      const rows = getRecipes();
      const recipes = rows.map((row) => ({
        id: row.id,
        title: row.title,
        created_at: row.created_at,
        recipe: JSON.parse(row.data) as Recipe,
      }));
      res.status(200).json({ recipes });
      return;
    }

    if (req.method === "POST") {
      const body = parseBody(req.body);
      if (!body || typeof body !== "object" || !("recipe" in body)) {
        res.status(400).json({
          error: "Missing recipe object",
          code: "VALIDATION_ERROR",
        });
        return;
      }
      const recipe = (body as { recipe: unknown }).recipe;
      if (!isRecipeShape(recipe)) {
        res.status(400).json({
          error: "Invalid recipe payload",
          code: "VALIDATION_ERROR",
        });
        return;
      }
      const saved = saveRecipe(recipe);
      res.status(201).json({
        id: saved.id,
        created_at: saved.created_at,
        recipe: saved.recipe,
      });
      return;
    }

    res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Database error",
      code: "DB_ERROR",
    });
  }
}
