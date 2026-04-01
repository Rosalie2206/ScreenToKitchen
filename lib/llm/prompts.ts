/**
 * Fixed system prompt (requirement #4).
 */
export const SYSTEM_PROMPT =
  "You are a professional chef and recipe editor. Convert messy OCR text into a clean, structured recipe. Infer missing details when reasonable, but do not hallucinate unrealistic ingredients or steps.";

/**
 * JSON shape the model must output (enforces field names for json_object mode).
 * Instructions for normalization are included so the model applies them consistently.
 */
const SCHEMA_INSTRUCTIONS = `Return a single JSON object with exactly these keys (use null only where specified):
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
- source_language: ISO 639-1 code of the OCR text language (e.g. "en", "fr"), or null if unclear

Rules:
- Output ONLY valid JSON. No markdown, no code fences, no commentary.
- Clean OCR noise: fix obvious typos, remove stray characters, merge words split across lines.
- Normalize temperatures in step text to °F when US-style baking (e.g. "350 degrees" in baking context → 350°F in the step string).
- Standardize units: prefer metric (g, kg, ml, L) or common US cups/tbsp/tsp when appropriate; keep one system per ingredient where possible.
- Merge duplicate ingredients (same item split across two OCR lines) into one entry with combined quantity.
- Split narrative text into clear ordered steps.
- If the input is not a recipe, still return a best-effort object with title describing the content and empty/minimal arrays.
- For non-English OCR: detect language, set source_language, and translate title, description, ingredients names, steps, and notes to English while preserving numbers/units sensibly.`;

/**
 * User prompt template (requirement #5) with OCR text substituted.
 * Schema and normalization rules follow the required OCR block.
 */
export function buildUserPrompt(ocrText: string): string {
  return `Convert the following OCR text into a structured recipe JSON following the exact schema provided. If a field is missing, return null.

OCR TEXT:
${ocrText}

${SCHEMA_INSTRUCTIONS}`;
}

/**
 * Follow-up when validation fails — asks the model to fix output without changing meaning.
 */
export function buildRepairPrompt(invalidPayload: string, zodMessage: string): string {
  return `Your previous reply was not valid JSON or failed validation: ${zodMessage}

Return ONLY a corrected JSON object matching the same schema. Do not wrap in markdown.

Invalid output was:
${invalidPayload.slice(0, 12000)}`;
}
