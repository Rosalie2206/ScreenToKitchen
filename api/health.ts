/**
 * Vercel serverless function: GET /api/health
 *
 * Lightweight health check for the frontend:
 * - Backend handler is reachable if this route responds.
 * - Checks whether local Ollama is reachable (optional).
 * - Checks whether OpenAI credentials are configured and reachable (cheap: list models).
 */
import OpenAI from "openai";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const LOCAL_LLM_PROVIDER =
  process.env.LOCAL_LLM_PROVIDER?.trim().toLowerCase() ?? "ollama";
const LOCAL_LLM_BASE_URL =
  process.env.LOCAL_LLM_BASE_URL?.trim() ||
  process.env.OLLAMA_BASE_URL?.trim() ||
  "http://127.0.0.1:1234";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function normalizeOpenAiBaseUrl(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

function setCors(res: VercelResponse, origin: string | undefined): void {
  const allow = process.env.ALLOWED_ORIGIN?.trim() || origin || "*";
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-use-local-llm, x-local-llm-provider",
  );
}

function parseBooleanLike(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

function resolveUseLocalLlm(req: VercelRequest): boolean {
  const headerValue = req.headers["x-use-local-llm"];
  const fromHeader = Array.isArray(headerValue)
    ? parseBooleanLike(headerValue[0])
    : parseBooleanLike(headerValue);
  if (typeof fromHeader === "boolean") return fromHeader;

  const fromQuery = parseBooleanLike(req.query.useLocal);
  if (typeof fromQuery === "boolean") return fromQuery;

  return process.env.USE_LOCAL_LLM?.trim().toLowerCase() === "true";
}

function resolveLocalLlmProvider(req: VercelRequest): "ollama" | "openai_compatible" {
  const headerValue = req.headers["x-local-llm-provider"];
  const fromHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const normalized = String(fromHeader ?? req.query.localProvider ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "openai_compatible") return "openai_compatible";
  if (normalized === "ollama") return "ollama";
  return process.env.LOCAL_LLM_PROVIDER?.trim().toLowerCase() === "openai_compatible"
    ? "openai_compatible"
    : "ollama";
}

async function checkOllama(baseUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    // Response should be JSON; we just need to know Ollama is reachable.
    await res.json().catch(() => null);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

async function checkOpenAI(apiKey: string | undefined): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY not set" };
  try {
    const client = new OpenAI({ apiKey });
    // Cheap request to verify credentials/network.
    await client.models.list();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

async function checkOpenAiCompatibleLocal(
  baseUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = new OpenAI({
      apiKey: process.env.LOCAL_LLM_API_KEY?.trim() || "local-llm",
      baseURL: normalizeOpenAiBaseUrl(baseUrl),
    });
    await client.models.list();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const origin = req.headers.origin as string | undefined;
  setCors(res, origin);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
    return;
  }

  const backendOk = true;

  const localEnabled = resolveUseLocalLlm(req);
  const localProvider = resolveLocalLlmProvider(req);
  const openaiEnabled = Boolean(OPENAI_API_KEY);

  const [localRes, openaiRes] = await Promise.all([
    localEnabled
      ? localProvider === "openai_compatible"
        ? checkOpenAiCompatibleLocal(LOCAL_LLM_BASE_URL)
        : checkOllama(LOCAL_LLM_BASE_URL)
      : Promise.resolve({ ok: false, error: undefined } as const),
    checkOpenAI(OPENAI_API_KEY),
  ]);

  const llmOk = (localEnabled && localRes.ok) || openaiRes.ok;
  const source = (localEnabled && localRes.ok) ? "local" : openaiRes.ok ? "openai" : "none";

  res.status(200).json({
    backend: { ok: backendOk },
    llm: {
      ok: llmOk,
      source,
      local: {
        enabled: localEnabled,
        provider: localProvider,
        ok: localRes.ok,
        error: localRes.error,
      },
      openai: { enabled: openaiEnabled, ok: openaiRes.ok, error: openaiRes.error },
    },
  });
}

