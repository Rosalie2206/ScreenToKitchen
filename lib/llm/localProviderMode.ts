/**
 * Local LLM wiring: native Ollama API vs a `/v1` Chat Completions server (LM Studio, etc.).
 *
 * Internal wire value `openai_compatible` is historical; env may use `compatible` instead.
 */
export type LocalLlmWireFormat = "ollama" | "openai_compatible";

export function parseLocalLlmProviderFromEnv(
  value: string | undefined,
): LocalLlmWireFormat {
  const v = value?.trim().toLowerCase() ?? "";
  if (v === "openai_compatible" || v === "compatible") return "openai_compatible";
  return "ollama";
}

export function parseLocalLlmProviderFromRequest(
  header: string | string[] | undefined,
  query: unknown,
  envValue: string | undefined,
): LocalLlmWireFormat {
  const raw = Array.isArray(header) ? header[0] : header;
  const fromReq = String(raw ?? query ?? "")
    .trim()
    .toLowerCase();
  if (fromReq === "openai_compatible" || fromReq === "compatible") {
    return "openai_compatible";
  }
  if (fromReq === "ollama") return "ollama";
  return parseLocalLlmProviderFromEnv(envValue);
}
