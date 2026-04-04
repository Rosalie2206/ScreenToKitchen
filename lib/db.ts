/**
 * Local SQLite persistence for recipes (better-sqlite3, synchronous).
 *
 * - **Local dev:** `recipes.db` in the project root (writable).
 * - **Serverless (Vercel, etc.):** the filesystem under `process.cwd()` is read-only,
 *   so we default to `os.tmpdir()/screentokitchen-recipes.db` (writable). That storage
 *   is ephemeral across cold starts—use `RECIPES_DB_PATH` or a hosted DB for durability.
 * - **Override:** set `RECIPES_DB_PATH` to any writable file path.
 */
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { Recipe } from "../types/recipe.js";

function resolveDbPath(): string {
  const override = process.env.RECIPES_DB_PATH?.trim();
  if (override) return override;

  const onServerless =
    Boolean(process.env.VERCEL) ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.NETLIFY);

  if (onServerless) {
    return path.join(os.tmpdir(), "screentokitchen-recipes.db");
  }

  return path.join(process.cwd(), "recipes.db");
}

const dbPath = resolveDbPath();

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }
  return db;
}

export type SavedRecipeRow = {
  id: string;
  title: string;
  data: string;
  created_at: string;
};

/**
 * Insert a new recipe row. Generates id and timestamp.
 */
export function saveRecipe(recipe: Recipe): {
  id: string;
  created_at: string;
  recipe: Recipe;
} {
  const id = randomUUID();
  const created_at = new Date().toISOString();
  const title = recipe.title?.trim() || "Recipe";
  const data = JSON.stringify(recipe);

  const stmt = getDb().prepare(
    `INSERT INTO recipes (id, title, data, created_at) VALUES (?, ?, ?, ?)`,
  );
  stmt.run(id, title, data, created_at);

  return { id, created_at, recipe };
}

export function getRecipes(): SavedRecipeRow[] {
  return getDb()
    .prepare(
      `SELECT id, title, data, created_at FROM recipes ORDER BY datetime(created_at) DESC`,
    )
    .all() as SavedRecipeRow[];
}

export function getRecipeById(id: string): SavedRecipeRow | undefined {
  return getDb()
    .prepare(`SELECT id, title, data, created_at FROM recipes WHERE id = ?`)
    .get(id) as SavedRecipeRow | undefined;
}

/** @returns true if a row was deleted */
export function deleteRecipe(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM recipes WHERE id = ?`).run(id);
  return result.changes > 0;
}
