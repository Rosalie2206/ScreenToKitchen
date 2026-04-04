/**
 * GET /api/recipes/:id — one recipe
 * DELETE /api/recipes/:id — remove recipe
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Recipe } from "../../types/recipe.js";
import { deleteRecipe, getRecipeById } from "../../lib/db.js";

function setCors(res: VercelResponse, origin: string | undefined): void {
  const allow = process.env.ALLOWED_ORIGIN?.trim() || origin || "*";
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-use-local-llm, x-local-llm-provider",
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

  const rawId = req.query.id;
  const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";
  if (!id) {
    res.status(400).json({ error: "Missing id", code: "VALIDATION_ERROR" });
    return;
  }

  try {
    if (req.method === "GET") {
      const row = getRecipeById(id);
      if (!row) {
        res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
        return;
      }
      res.status(200).json({
        id: row.id,
        created_at: row.created_at,
        recipe: JSON.parse(row.data) as Recipe,
      });
      return;
    }

    if (req.method === "DELETE") {
      const ok = deleteRecipe(id);
      if (!ok) {
        res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
        return;
      }
      res.status(204).end();
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
