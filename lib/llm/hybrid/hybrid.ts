import { convertOCRToRecipeHybridLocal } from "./local.js";
import { convertOCRToRecipeHybridApi } from "./api.js";
import type { Recipe } from "../types.js";
import {
  parseLocalLlmProviderFromEnv,
  type LocalLlmWireFormat,
} from "../localProviderMode.js";
import { GROQ_MODEL } from "../groqModelConfig.js";

type HybridModeSource = "local" | "api";

function isTrueEnv(v: string | undefined): boolean {
  return v?.trim().toLowerCase() === "true";
}

function normalizeLocalV1BaseUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

/** Strip misleading vendor doc URLs from upstream error strings (cloud path uses Groq). */
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
  options?: { useLocalLlm?: boolean; localProvider?: LocalLlmWireFormat },
): Promise<Recipe> {
  const { recipe } = await convertOCRToRecipeHybridWithMode(ocrText, options);
  return recipe;
}

/**
 * Bonus: returns which source was used.
 */
export async function convertOCRToRecipeHybridWithMode(
  ocrText: string,
  options?: { useLocalLlm?: boolean; localProvider?: LocalLlmWireFormat },
): Promise<{ recipe: Recipe; source: HybridModeSource }> {
  const useLocal = options?.useLocalLlm ?? isTrueEnv(process.env.USE_LOCAL_LLM);
  const timeoutMs = Number(process.env.LOCAL_LLM_TIMEOUT_MS ?? 10_000);
  const localProvider: LocalLlmWireFormat =
    options?.localProvider ??
    parseLocalLlmProviderFromEnv(process.env.LOCAL_LLM_PROVIDER);

  const groqModel = GROQ_MODEL;

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
              baseURL: normalizeLocalV1BaseUrl(localBaseUrl),
              // Local Chat Completions servers typically accept any non-empty bearer token.
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

