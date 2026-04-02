/**
 * Vercel serverless function: GET /api/health
 *
 * Lightweight health check for the frontend:
 * - Backend handler is reachable if this route responds.
 * - Checks whether local Ollama or Chat Completions–compatible (/v1) server is reachable (optional).
 * - Checks whether Groq credentials are configured and reachable (cheap: list models).
 */
import Groq from "groq-sdk";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  parseLocalLlmProviderFromRequest,
  type LocalLlmWireFormat,
} from "../lib/llm/localProviderMode.js";

const LOCAL_LLM_BASE_URL =
  process.env.LOCAL_LLM_BASE_URL?.trim() ||
  process.env.OLLAMA_BASE_URL?.trim() ||
  "http://127.0.0.1:1234";
const GROQ_API_KEY = process.env.GROQ_API_KEY;

/** Base URL for local servers exposing Chat Completions `/v1/*` routes (e.g. LM Studio). */
function normalizeLocalV1BaseUrl(base: string): string {
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

function resolveLocalLlmProvider(req: VercelRequest): LocalLlmWireFormat {
  return parseLocalLlmProviderFromRequest(
    req.headers["x-local-llm-provider"],
    req.query.localProvider,
    process.env.LOCAL_LLM_PROVIDER,
  );
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
    await res.json().catch(() => null);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

async function checkGroq(apiKey: string | undefined): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey) return { ok: false, error: "GROQ_API_KEY not set" };
  try {
    const client = new Groq({ apiKey });
    await client.models.list();
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** Local LM Studio–style server: GET /v1/models via fetch (no extra SDK). */
async function checkLocalChatCompletionsServer(
  baseUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${normalizeLocalV1BaseUrl(baseUrl)}/models`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.LOCAL_LLM_API_KEY?.trim() || "local-llm"}`,
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    await res.json().catch(() => null);
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
  const groqEnabled = Boolean(GROQ_API_KEY);

  const [localRes, groqRes] = await Promise.all([
    localEnabled
      ? localProvider === "openai_compatible"
        ? checkLocalChatCompletionsServer(LOCAL_LLM_BASE_URL)
        : checkOllama(LOCAL_LLM_BASE_URL)
      : Promise.resolve({ ok: false, error: undefined } as const),
    checkGroq(GROQ_API_KEY),
  ]);

  const llmOk = (localEnabled && localRes.ok) || groqRes.ok;
  const source = (localEnabled && localRes.ok) ? "local" : groqRes.ok ? "groq" : "none";

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
      groq: { enabled: groqEnabled, ok: groqRes.ok, error: groqRes.error },
    },
  });
}
