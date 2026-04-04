/**
 * Local SQLite persistence for recipes (better-sqlite3, synchronous).
 * Database file: project root `recipes.db`, or RECIPES_DB_PATH override.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { Recipe } from "../types/recipe.js";

const dbPath =
  process.env.RECIPES_DB_PATH?.trim() || path.join(process.cwd(), "recipes.db");

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
