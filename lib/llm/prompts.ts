/**
 * Fixed system prompt (requirement #4) + locale-specific instructions.
 */
import type { RecipeOutputLocale } from "./types.js";

const SYSTEM_BASE =
  "You are a professional chef and recipe editor. Convert messy OCR text into a clean, structured recipe. Infer missing details when reasonable, but do not hallucinate unrealistic ingredients or steps. Express all ingredient weights in metric grams or kilograms only—never leave imperial ounces or pounds in the structured output.";

const SYSTEM_LOCALE: Record<RecipeOutputLocale, string> = {
  en: "",
  nl: " All user-facing text in the JSON response (title, description, every ingredient name, every step, every note) must be written in Dutch using standard written Dutch as used in Flanders (Belgium). Translate from the OCR source when it is not already Dutch; normalize spelling and wording if the OCR is Dutch.",
};

export function buildSystemPrompt(locale: RecipeOutputLocale): string {
  return SYSTEM_BASE + SYSTEM_LOCALE[locale];
}

/**
 * JSON shape the model must output (enforces field names for json_object mode).
 * Instructions for normalization are included so the model applies them consistently.
 */
function schemaInstructions(locale: RecipeOutputLocale): string {
  const outputLangRule =
    locale === "nl"
      ? `- For any OCR that is not fully Dutch: detect the source language, set source_language (ISO 639-1), and translate title, description, ingredient names, steps, and notes into **Dutch** (Flemish/Belgian standard). If the OCR is already Dutch, keep Dutch and only clean OCR noise.
- Every string meant for the cook (title, description, ingredient names, steps, notes) must be **Dutch** — never English in those fields when this rule applies.`
      : `- For non-English OCR: detect language, set source_language, and translate title, description, ingredients names, steps, and notes to English while preserving numbers/units sensibly.`;

  return `Return a single JSON object with exactly these keys (use null only where specified):
- title: string
- description: string (short summary; empty string if nothing to say)
- servings: number or null
- prep_time_minutes: number or null
- cook_time_minutes: number or null
- total_time_minutes: number or null
- ingredients: array of { "name": string, "quantity": number or null, "unit": string or null }
- steps: array of strings (ordered cooking steps)
- notes: array of strings (tips, variations, storage; empty array if none)
- confidence: number between 0 and 1 (how reliable the OCR/recipe extraction seems)
- source_language: ISO 639-1 code of the OCR text language (e.g. "en", "fr", "nl"), or null if unclear

Rules:
- Output ONLY valid JSON. No markdown, no code fences, no commentary.
- Clean OCR noise: fix obvious typos, remove stray characters, merge words split across lines.
- Normalize temperatures in step text to °C (convert from °F when present; e.g. "350°F" in baking context → "175°C" in the step string).
- Standardize units to European/metric only in both ingredient \`quantity\`/\`unit\` fields and in step text. Do not emit imperial weight units in ingredients.
  - **Ounces (weight):** Treat "oz", "ounce", "ounces" as avoirdupois weight. Convert to grams: multiply the numeric quantity by **28.35** (round to whole grams for amounts under ~500 g, otherwise one decimal place if helpful). Set \`unit\` to \`"g"\` or \`"kg"\` (use kg only when ≥ 1000 g or the recipe clearly uses kg). **Never** set \`unit\` to \`"oz"\` or leave ounce-based amounts unconverted.
  - **Pounds:** lb/lbs → g or kg (1 lb = 453.59 g).
  - **Fluid ounces (liquids):** If the OCR says "fl oz" or it is clearly a liquid volume, convert to ml (1 US fl oz ≈ 29.57 ml) and use \`unit\` \`"ml"\`.
  - Volume (dry measure): cups → ml, tbsp/tablespoon → ml, tsp/teaspoon → ml where applicable.
  - Temperature in prose: °F → °C.
  - Output ingredient \`unit\` as one of: **g, kg, ml, L**, or null (never oz, lb, cup, tbsp, etc.).
- Merge duplicate ingredients (same item split across two OCR lines) into one entry with combined quantity.
- Split narrative text into clear ordered steps.
- If the input is not a recipe, still return a best-effort object with title describing the content and empty/minimal arrays.
${outputLangRule}`;
}

/**
 * User prompt template (requirement #5) with OCR text substituted.
 * Schema and normalization rules follow the required OCR block.
 */
export function buildUserPrompt(
  ocrText: string,
  locale: RecipeOutputLocale = "en",
): string {
  return `Convert the following OCR text into a structured recipe JSON following the exact schema provided. If a field is missing, return null.

OCR TEXT:
${ocrText}

${schemaInstructions(locale)}`;
}

/**
 * Follow-up when validation fails — asks the model to fix output without changing meaning.
 */
export function buildRepairPrompt(
  invalidPayload: string,
  zodMessage: string,
  locale: RecipeOutputLocale = "en",
): string {
  const langHint =
    locale === "nl"
      ? "\n\nKeep all narrative fields (title, description, ingredient names, steps, notes) in Dutch (Flemish/Belgian standard)."
      : "";
  return `Your previous reply was not valid JSON or failed validation: ${zodMessage}

Return ONLY a corrected JSON object matching the same schema. Do not wrap in markdown.

Invalid output was:
${invalidPayload.slice(0, 12000)}${langHint}`;
}
