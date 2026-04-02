/**
 * Single source of truth for Groq cloud models (see https://console.groq.com/docs/models).
 * `GROQ_MODEL` overrides the primary; fallback is used only when the primary request fails with a model-availability error.
 */

/** Env `GROQ_MODEL`, or default primary if unset. */
export const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "llama-3.1-70b-versatile";

/** Used when the primary model returns decommissioned / invalid model errors (one retry only). */
export const GROQ_FALLBACK_MODEL = "llama-3.1-8b-instant";
