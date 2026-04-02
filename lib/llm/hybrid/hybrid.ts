import { convertOCRToRecipeHybridLocal } from "./local.js";
import { convertOCRToRecipeHybridApi } from "./api.js";
import type { Recipe } from "../types.js";

type HybridModeSource = "local" | "api";

function isTrueEnv(v: string | undefined): boolean {
  return v?.trim().toLowerCase() === "true";
}

function normalizeOpenAiBaseUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

/** Upstream libraries sometimes embed OpenAI doc URLs; this app uses Groq for cloud fallback. */
function sanitizeCloudErrorMessage(msg: string): string {
  return msg.replace(
    /https:\/\/platform\.openai\.com\/[^\s)]+/gi,
    "https://console.groq.com/docs/errors",
  );
}

/**
 * Robust hybrid converter:
 * - Try LOCAL LLM (Ollama) first if USE_LOCAL_LLM=true
 * - If local fails (network/timeout/JSON/validation), fall back to Groq API
 * - If both fail, throw a clear error
 */
export async function convertOCRToRecipeHybrid(
  ocrText: string,
  options?: { useLocalLlm?: boolean; localProvider?: "ollama" | "openai_compatible" },
): Promise<Recipe> {
  const { recipe } = await convertOCRToRecipeHybridWithMode(ocrText, options);
  return recipe;
}

/**
 * Bonus: returns which source was used.
 */
export async function convertOCRToRecipeHybridWithMode(
  ocrText: string,
  options?: { useLocalLlm?: boolean; localProvider?: "ollama" | "openai_compatible" },
): Promise<{ recipe: Recipe; source: HybridModeSource }> {
  const useLocal = options?.useLocalLlm ?? isTrueEnv(process.env.USE_LOCAL_LLM);
  const timeoutMs = Number(process.env.LOCAL_LLM_TIMEOUT_MS ?? 10_000);
  const localProvider =
    options?.localProvider ??
    ((process.env.LOCAL_LLM_PROVIDER?.trim().toLowerCase() === "openai_compatible"
      ? "openai_compatible"
      : "ollama") as "ollama" | "openai_compatible");

  const groqModel = process.env.GROQ_MODEL ?? "llama3-70b-8192";

  const localBaseUrl =
    process.env.LOCAL_LLM_BASE_URL?.trim() ||
    process.env.OLLAMA_BASE_URL?.trim() ||
    "http://127.0.0.1:1234";
  const localModel =
    process.env.LOCAL_LLM_MODEL?.trim() ||
    process.env.OLLAMA_MODEL?.trim() ||
    "mistral";

  let localErr: unknown = null;

  if (useLocal) {
    try {
      console.info("Using local LLM");
      const recipe =
        localProvider === "openai_compatible"
          ? await convertOCRToRecipeHybridApi(ocrText, {
              model: localModel,
              baseURL: normalizeOpenAiBaseUrl(localBaseUrl),
              // Most OpenAI-compatible local servers accept any non-empty key.
              apiKey: process.env.LOCAL_LLM_API_KEY?.trim() || "local-llm",
              maxRetries: 2,
            })
          : await convertOCRToRecipeHybridLocal(ocrText, {
              timeoutMs,
              ollamaBaseUrl: localBaseUrl,
              model: localModel,
            });
      return { recipe, source: "local" };
    } catch (err) {
      localErr = err;
      console.info("Falling back to API");
      console.warn(
        "Local LLM failed; falling back to API. Error:",
        err,
      );
    }
  } else {
    console.info("Falling back to API");
  }

  try {
    console.info("Falling back to API");
    const recipe = await convertOCRToRecipeHybridApi(ocrText, {
      model: groqModel,
      maxRetries: 2,
    });
    return { recipe, source: "api" };
  } catch (apiErr) {
    console.error("Both failed");

    const localMsg = !useLocal
      ? "skipped (USE_LOCAL_LLM is not enabled)"
      : localErr instanceof Error
        ? localErr.message
        : localErr != null
          ? String(localErr)
          : "unknown (local failed but no error details)";

    const rawApiMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);
    const apiMsg = sanitizeCloudErrorMessage(rawApiMsg);
    const quotaHint =
      /\b429\b|quota|rate limit/i.test(apiMsg)
        ? " Check limits: https://console.groq.com/"
        : "";

    throw new Error(
      `convertOCRToRecipeHybrid: Both failed. Local: ${localMsg}. Groq: ${apiMsg}.${quotaHint}`,
    );
  }
}

