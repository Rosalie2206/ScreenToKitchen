export type HealthResponse = {
  backend: { ok: boolean };
  llm: {
    ok: boolean;
    source: "local" | "groq" | "none";
    local: { enabled: boolean; ok: boolean; error?: string };
    groq: { enabled: boolean; ok: boolean; error?: string };
  };
};

function apiBase(): string {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  return base?.replace(/\/$/, "") ?? "";
}

function resolveUseLocalLlmOverride(): boolean | undefined {
  const raw = import.meta.env.VITE_USE_LOCAL_LLM;
  if (raw == null) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

function resolveLocalLlmProviderOverride(): string | undefined {
  const raw = import.meta.env.VITE_LOCAL_LLM_PROVIDER;
  if (raw == null) return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === "openai_compatible" || v === "compatible" || v === "ollama") return v;
  return undefined;
}

export async function fetchHealth(
  timeoutMs = 5000,
): Promise<HealthResponse> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${apiBase()}/api/health`;
    const useLocal = resolveUseLocalLlmOverride();
    const provider = resolveLocalLlmProviderOverride();
    const headers: HeadersInit = {};
    if (typeof useLocal === "boolean") {
      headers["x-use-local-llm"] = String(useLocal);
    }
    if (provider) {
      headers["x-local-llm-provider"] = provider;
    }
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Health check failed (HTTP ${res.status}). ${text}`);
    }
    const data = (await res.json()) as HealthResponse;
    return data;
  } finally {
    clearTimeout(t);
  }
}
