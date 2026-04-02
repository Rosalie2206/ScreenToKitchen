import "./style.css";
import { marked } from "marked";
import dummyMarkdown from "../documentation/dummy?raw";
import {
  buildRecipeCardHtml,
  escapeHtml,
  cleanOcrTextForRecipe,
} from "./recipeParser.js";
import { fetchRecipe } from "./lib/fetchRecipe.js";
import { fetchHealth } from "./lib/fetchHealth.js";

const app = document.querySelector("#app");

const CATALOGUE_STORAGE_KEY = "screenToKitchenCatalogue";
/** @deprecated migrated once into catalogue */
const LEGACY_RECIPE_STORAGE_KEY = "screenToKitchenRecipe";

let imageObjectUrl = null;
let ocrRunId = 0;
/** Last parsed recipe on the converter screen (for save fallback). */
let lastConverterRecipe = null;

function revokeImage() {
  if (imageObjectUrl) {
    URL.revokeObjectURL(imageObjectUrl);
    imageObjectUrl = null;
  }
}

/**
 * @returns {{ name: 'home'|'converter'|'catalogue'|'recipe', recipeId?: string|null }}
 */
function parseRoute() {
  const raw = location.hash.replace(/^#/, "").replace(/^\//, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "converter") return { name: "converter" };
  if (parts[0] === "catalogue") return { name: "catalogue" };
  if (parts[0] === "tech-kitchen") {
    const subtab = parts[1] ?? "behind-the-scenes";
    if (subtab === "health-check") return { name: "tech-health" };
    return { name: "tech-behind" };
  }
  if (parts[0] === "behind-the-scenes") return { name: "tech-behind" };
  if (parts[0] === "recipe") {
    return { name: "recipe", recipeId: parts[1] ?? null };
  }
  return { name: "home" };
}

function loadCatalogue() {
  try {
    const raw = sessionStorage.getItem(CATALOGUE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (_) {
    /* ignore */
  }
  try {
    const legacy = sessionStorage.getItem(LEGACY_RECIPE_STORAGE_KEY);
    if (legacy) {
      const recipe = JSON.parse(legacy);
      const id = crypto.randomUUID();
      const entries = [{ id, savedAt: Date.now(), recipe }];
      sessionStorage.setItem(CATALOGUE_STORAGE_KEY, JSON.stringify(entries));
      sessionStorage.removeItem(LEGACY_RECIPE_STORAGE_KEY);
      return entries;
    }
  } catch (_) {
    /* ignore */
  }
  return [];
}

function saveCatalogue(entries) {
  try {
    sessionStorage.setItem(CATALOGUE_STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    console.error(err);
  }
}

function addRecipeToCatalogue(recipe) {
  const entries = loadCatalogue();
  const id = crypto.randomUUID();
  entries.unshift({ id, savedAt: Date.now(), recipe });
  saveCatalogue(entries);
  return id;
}

function getRecipeById(id) {
  const entry = loadCatalogue().find((e) => e.id === id);
  return entry?.recipe ?? null;
}

function renderMenuHeader() {
  return `
    <div class="home-header">
      <div class="home-brand">
        <a href="#/" aria-label="Go to home">
          <img class="home-logo" src="${import.meta.env.BASE_URL}home-logo.png" alt="ScreenToKitchen logo" />
        </a>
        <h1 class="home-title">Screen To Kitchen</h1>
      </div>
      <details class="home-menu">
        <summary class="home-menu__trigger" aria-label="Open menu">
          <img class="home-menu__icon" src="${import.meta.env.BASE_URL}menu-icon.png" alt="" />
        </summary>
        <nav class="home-menu__panel" aria-label="Main menu">
          <a class="home-menu__item" href="#/">Home</a>
          <a class="home-menu__item" href="#/converter">Converter</a>
          <a class="home-menu__item" href="#/catalogue">Catalogue</a>
          <a class="home-menu__item" href="#/tech-kitchen/behind-the-scenes">Tech Kitchen</a>
        </nav>
      </details>
    </div>
  `;
}

function renderHome() {
  revokeImage();
  lastConverterRecipe = null;
  document.title = "ScreenToKitchen";

  app.innerHTML = `
    <main class="shell">
      ${renderMenuHeader()}
      <figure class="home-hero-art-wrap" aria-hidden="true">
        <img class="home-hero-art" src="${import.meta.env.BASE_URL}home-cheese.png" alt="" />
      </figure>

      <section class="upload" aria-label="Upload a picture">
        <h2 class="upload-heading">Picture</h2>
        <p class="upload-hint hint">Choose from your gallery or take a new photo.</p>
        <div class="upload-controls">
          <label class="upload-button">
            <input type="file" class="upload-input" accept="image/*" />
            <span class="upload-button-label">Choose photo</span>
          </label>
        </div>
      </section>

    </main>
  `;

  app.querySelector(".upload-input").addEventListener("change", onFileSelected);
}

function getHealthPingUrl() {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/api/health`;
}

/**
 * @param {'ok'|'bad'|'na'} state — na = not applicable / disabled
 */
function setHealthRow(dot, badge, state, text) {
  if (!dot || !badge) return;
  dot.classList.remove("health-dot--ok", "health-dot--bad", "health-dot--na");
  badge.classList.remove("health-badge--ok", "health-badge--bad", "health-badge--na");
  if (state === "ok") {
    dot.classList.add("health-dot--ok");
    badge.classList.add("health-badge--ok");
  } else if (state === "bad") {
    dot.classList.add("health-dot--bad");
    badge.classList.add("health-badge--bad");
  } else {
    dot.classList.add("health-dot--na");
    badge.classList.add("health-badge--na");
  }
  badge.textContent = text;
}

async function checkHealthUI() {
  const dotBackend = app.querySelector(".health-dot-backend");
  const badgeBackend = app.querySelector(".health-backend-badge");
  const dotLocal = app.querySelector(".health-dot-local");
  const badgeLocal = app.querySelector(".health-local-badge");
  const dotGroq = app.querySelector(".health-dot-groq");
  const badgeGroq = app.querySelector(".health-groq-badge");
  const detailsEl = app.querySelector(".health-details");
  const pingUrl = getHealthPingUrl();

  const hasSplitLlm = dotGroq && badgeGroq && dotLocal && badgeLocal;

  if (!dotBackend || !badgeBackend) return;
  if (!hasSplitLlm) {
    const dotLlm = app.querySelector(".health-dot-llm");
    const badgeLlm = app.querySelector(".health-llm-badge");
    if (!dotLlm || !badgeLlm) return;
  }

  const setBackend = (ok, text) => {
    setHealthRow(dotBackend, badgeBackend, ok ? "ok" : "bad", text);
  };

  try {
    const health = await fetchHealth(5000);
    const llmMode = health.llm?.source ?? "none";
    setBackend(Boolean(health.backend?.ok), "Online");

    if (hasSplitLlm) {
      const loc = health.llm?.local;
      if (!loc?.enabled) {
        setHealthRow(dotLocal, badgeLocal, "na", "Not enabled");
      } else if (loc.ok) {
        setHealthRow(dotLocal, badgeLocal, "ok", "Reachable");
      } else {
        const err = loc.error?.trim() || "Unreachable";
        const short =
          err.length > 72 ? `${err.slice(0, 69)}…` : err;
        setHealthRow(dotLocal, badgeLocal, "bad", short);
      }

      const gq = health.llm?.groq;
      if (!gq?.enabled) {
        setHealthRow(dotGroq, badgeGroq, "bad", "No GROQ_API_KEY");
      } else if (gq.ok) {
        setHealthRow(dotGroq, badgeGroq, "ok", "Connected (models.list)");
      } else {
        const err = gq.error?.trim() || "Failed";
        const short =
          err.length > 72 ? `${err.slice(0, 69)}…` : err;
        setHealthRow(dotGroq, badgeGroq, "bad", short);
      }

      if (detailsEl) {
        detailsEl.textContent = `Ping URL: ${pingUrl} · Active route: ${llmMode} · Groq check: HTTP GET /api/health runs Groq models.list() on the server`;
      }
    } else {
      const dotLlm = app.querySelector(".health-dot-llm");
      const badgeLlm = app.querySelector(".health-llm-badge");
      if (health.llm?.ok) {
        setHealthRow(
          dotLlm,
          badgeLlm,
          "ok",
          health.llm.source === "local" ? "Local LLM OK" : "Groq OK",
        );
        if (detailsEl) {
          detailsEl.textContent = `Ping URL: ${pingUrl} · LLM mode: ${llmMode}`;
        }
      } else {
        const why =
          health.llm?.source === "none"
            ? "LLM unavailable"
            : health.llm?.source === "local"
              ? "Local LLM failed"
              : "Groq unavailable";
        setHealthRow(dotLlm, badgeLlm, "bad", why);
        if (detailsEl) {
          const localErr = health.llm.local?.error
            ? `Local: ${health.llm.local.error}`
            : "";
          const groqErr = health.llm.groq?.error
            ? `Groq: ${health.llm.groq.error}`
            : "";
          const combined = [localErr, groqErr].filter(Boolean).join(" · ");
          detailsEl.textContent = `Ping URL: ${pingUrl} · LLM mode: ${llmMode}${combined ? ` · ${combined}` : " · No error details available."}`;
        }
      }
    }
  } catch (e) {
    console.error(e);
    setBackend(false, "Offline");
    if (hasSplitLlm) {
      setHealthRow(dotLocal, badgeLocal, "bad", "Unknown");
      setHealthRow(dotGroq, badgeGroq, "bad", "Unknown");
    } else {
      const dotLlm = app.querySelector(".health-dot-llm");
      const badgeLlm = app.querySelector(".health-llm-badge");
      if (dotLlm && badgeLlm) {
        setHealthRow(dotLlm, badgeLlm, "bad", "Unavailable");
      }
    }
    if (detailsEl) {
      detailsEl.textContent = `Ping URL: ${pingUrl} · Could not reach health endpoint. Is the backend running?`;
    }
  }
}

function renderTechKitchenTabs(active) {
  return `
    <nav class="tech-tabs" aria-label="Tech Kitchen tabs">
      <a class="tech-tab ${active === "behind" ? "tech-tab--active" : ""}" href="#/tech-kitchen/behind-the-scenes">Behind the scenes</a>
      <a class="tech-tab ${active === "health" ? "tech-tab--active" : ""}" href="#/tech-kitchen/health-check">Health check</a>
    </nav>
  `;
}

function onFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  revokeImage();
  imageObjectUrl = URL.createObjectURL(file);
  location.hash = "#/converter";
}

function setConverterSaveState(recipe, enabled) {
  lastConverterRecipe = recipe;
  const btn = app.querySelector(".save-recipe-btn");
  if (btn) {
    btn.disabled = !enabled;
  }
}

async function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image for OCR"));
    img.src = src;
  });
}

/**
 * Preprocess an image for OCR:
 * - Resize down to a reasonable max dimension
 * - Convert to grayscale
 * - Apply a light contrast bump
 * - Threshold (simple adaptive-ish threshold based on mean luminance)
 *
 * This typically improves text legibility for Tesseract on photos of printed text.
 */
async function preprocessImageForOcr(imageSrc) {
  const img = await loadImage(imageSrc);
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));

  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return canvas;

  // Draw with grayscale + contrast filter before thresholding.
  ctx.filter = "grayscale(1) contrast(1.35) brightness(1.05)";
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = "none";

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // Convert to luminance and compute mean for a simple threshold.
  let sum = 0;
  const lum = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4 + 0];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // Standard luminance
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = y;
    sum += y;
  }
  const mean = sum / (w * h);
  const threshold = Math.max(80, Math.min(200, mean)); // keep within sane bounds

  // Apply threshold and write back to RGB channels.
  for (let i = 0; i < w * h; i++) {
    const v = lum[i] > threshold ? 255 : 0;
    const di = i * 4;
    data[di + 0] = v;
    data[di + 1] = v;
    data[di + 2] = v;
    data[di + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function cleanOcrForLlm(ocrText) {
  const trimmed = String(ocrText ?? "").trim();
  if (!trimmed) return "";

  // Your existing cleanup tries to isolate the most recipe-like block.
  const cleaned = cleanOcrTextForRecipe(trimmed);
  return cleaned.trim().length ? cleaned.trim() : trimmed;
}

async function runConverterOcr(runId, imageUrl) {
  const statusEl = app.querySelector(".ocr-status");
  const outputWrap = app.querySelector(".ocr-output-wrap");
  const recipeRoot = app.querySelector(".recipe-root");

  if (!statusEl || !outputWrap || !recipeRoot) return;

  setConverterSaveState(null, false);

  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    try {
      statusEl.hidden = false;
      statusEl.textContent = "Preparing image for OCR…";
      const ocrInput = await preprocessImageForOcr(imageUrl);

      // Tesseract tuning: keep best-effort (some params may not exist in all versions).
      try {
        await worker.setParameters({
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: "6", // assume a block of text
        });
      } catch {
        // Ignore parameter issues; OCR will still run.
      }

      const {
        data: { text },
      } = await worker.recognize(ocrInput);
      if (runId !== ocrRunId || parseRoute().name !== "converter") return;

      statusEl.hidden = false;
      statusEl.textContent = "Converting text to a structured recipe…";
      outputWrap.hidden = false;
      const cleanedForLlm = cleanOcrForLlm(text);
      const trimmed = cleanedForLlm.trim();
      if (!trimmed.length) {
        recipeRoot.innerHTML =
          '<p class="recipe-fallback">(No text detected in this image.)</p>';
        statusEl.hidden = true;
        setConverterSaveState(null, false);
        return;
      }

      try {
        const recipe = await fetchRecipe(trimmed);
        if (runId !== ocrRunId || parseRoute().name !== "converter") return;

        recipeRoot.innerHTML = buildRecipeCardHtml(recipe);
        statusEl.hidden = true;
        setConverterSaveState(recipe, true);
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : e ? String(e) : "Unknown error";
        statusEl.hidden = true;
        recipeRoot.innerHTML = `
          <p class="recipe-fallback">Could not convert this image into a recipe. Try again with a clearer photo.</p>
          <p class="recipe-fallback recipe-error-details">${escapeHtml(msg)}</p>
        `;
        setConverterSaveState(null, false);
      }
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    if (runId !== ocrRunId || parseRoute().name !== "converter") return;
    statusEl.textContent =
      "Could not read text from this image. Check your connection and try again.";
    console.error(err);
    setConverterSaveState(null, false);
  }
}

function renderConverter() {
  document.title = "Converter";

  if (!imageObjectUrl) {
    lastConverterRecipe = null;
    app.innerHTML = `
      <main class="shell shell--converter">
        ${renderMenuHeader()}
        <a href="#/" class="back-link back-link--converter">← Back</a>
        <h1>Converter</h1>
        <p class="hint converter-empty">No picture loaded. Upload one from the home screen.</p>
      </main>
    `;
    return;
  }

  const url = imageObjectUrl;
  const runId = ++ocrRunId;
  lastConverterRecipe = null;

  app.innerHTML = `
    <main class="shell shell--converter">
      ${renderMenuHeader()}
      <a href="#/" class="back-link back-link--converter">← Back</a>
      <h1>Converter</h1>
      <p class="lede converter-lede">Uploaded picture</p>
      <figure class="converter-thumb-wrap">
        <img class="converter-thumb" src="${url}" alt="Uploaded picture thumbnail" width="160" height="160" decoding="async" />
      </figure>
      <section class="ocr-section" aria-live="polite">
        <p class="ocr-status">Reading text from image… This may take a moment the first time.</p>
        <div class="ocr-output-wrap" hidden>
          <h2 class="ocr-heading">Recipe</h2>
          <div class="recipe-root"></div>
        </div>
      </section>
      <div class="converter-actions">
        <button type="button" class="save-recipe-btn" disabled>Save recipe</button>
      </div>
    </main>
  `;

  app.querySelector(".save-recipe-btn").addEventListener("click", () => {
    const recipe = lastConverterRecipe;
    if (!recipe) return;
    const id = addRecipeToCatalogue(recipe);
    location.hash = `#/recipe/${id}`;
  });

  runConverterOcr(runId, url);
}

function formatSavedDate(ts) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts));
  } catch {
    return "";
  }
}

function renderCataloguePage() {
  document.title = "Catalogue · ScreenToKitchen";
  const entries = loadCatalogue();

  if (!entries.length) {
    app.innerHTML = `
      <main class="shell shell--catalogue">
        ${renderMenuHeader()}
        <a href="#/" class="back-link back-link--converter">← Home</a>
        <h1 class="catalogue-title">Catalogue</h1>
        <p class="hint converter-empty">No saved recipes yet. Use Converter to read a recipe from a photo, then tap Save recipe.</p>
      </main>
    `;
    return;
  }

  const items = entries
    .map((e) => {
      const title = e.recipe?.title?.trim() || "Recipe";
      const label = escapeHtml(title);
      return `<li class="catalogue-item">
        <a class="catalogue-link" href="#/recipe/${e.id}">${label}</a>
        <span class="catalogue-meta">${escapeHtml(formatSavedDate(e.savedAt))}</span>
      </li>`;
    })
    .join("");

  app.innerHTML = `
    <main class="shell shell--catalogue">
      ${renderMenuHeader()}
      <a href="#/" class="back-link back-link--converter">← Home</a>
      <h1 class="catalogue-title">Catalogue</h1>
      <p class="lede catalogue-lede">Saved recipes</p>
      <ul class="catalogue-list">
        ${items}
      </ul>
    </main>
  `;
}

function renderRecipePage(recipeId) {
  const recipe = recipeId ? getRecipeById(recipeId) : null;

  if (!recipe) {
    document.title = "Recipe · ScreenToKitchen";
    app.innerHTML = `
      <main class="shell shell--recipe">
        ${renderMenuHeader()}
        <a href="#/catalogue" class="back-link back-link--converter">← Catalogue</a>
        <h1 class="recipe-page-title">Recipe</h1>
        <p class="hint converter-empty">This recipe was not found. It may have been removed or the link is invalid.</p>
      </main>
    `;
    return;
  }

  const title = recipe.title?.trim() || "Recipe";
  document.title = `${title} · Saved`;

  app.innerHTML = `
    <main class="shell shell--recipe">
      ${renderMenuHeader()}
      <a href="#/catalogue" class="back-link back-link--converter">← Catalogue</a>
      <h1 class="recipe-page-title">Saved recipe</h1>
      <div class="recipe-page-root">${buildRecipeCardHtml(recipe)}</div>
    </main>
  `;
}

/** Strip the doc’s top-level # title so the page heading stays unique. */
function prepareBehindTheScenesMarkdown(raw) {
  return raw.replace(/^#\s+[^\n]+\n+/, "").trim();
}

function renderBehindTheScenes() {
  document.title = "Tech Kitchen · Behind the scenes";
  const html = marked.parse(prepareBehindTheScenesMarkdown(dummyMarkdown), {
    gfm: true,
  });
  app.innerHTML = `
    <main class="shell shell--behind">
      ${renderMenuHeader()}
      ${renderTechKitchenTabs("behind")}
      <h1 class="behind-title">Tech Kitchen</h1>
      <p class="behind-lede lede">How this app works—in plain language.</p>
      <article class="doc-prose">${html}</article>
    </main>
  `;
}

function renderHealthCheckPage() {
  document.title = "Tech Kitchen · Health check";
  app.innerHTML = `
    <main class="shell shell--behind">
      ${renderMenuHeader()}
      ${renderTechKitchenTabs("health")}
      <h1 class="behind-title">Tech Kitchen</h1>
      <p class="behind-lede lede">Live backend, local LLM, and Groq status.</p>
      <section class="health-panel" aria-label="System status">
        <div class="health-row">
          <div class="health-label">
            <span class="health-dot health-dot--bad health-dot-backend" aria-hidden="true"></span>
            Backend API
          </div>
          <span class="health-badge health-badge--bad health-backend-badge">Checking…</span>
        </div>
        <div class="health-row">
          <div class="health-label">
            <span class="health-dot health-dot--bad health-dot-local" aria-hidden="true"></span>
            Local LLM
          </div>
          <span class="health-badge health-badge--bad health-local-badge">Checking…</span>
        </div>
        <div class="health-row">
          <div class="health-label">
            <span class="health-dot health-dot--bad health-dot-groq" aria-hidden="true"></span>
            Groq API
          </div>
          <span class="health-badge health-badge--bad health-groq-badge">Checking…</span>
        </div>
        <p class="hint health-details">Loading status details…</p>
      </section>
    </main>
  `;
  checkHealthUI();
}

function render() {
  const route = parseRoute();
  if (route.name === "converter") {
    renderConverter();
  } else if (route.name === "catalogue") {
    renderCataloguePage();
  } else if (route.name === "tech-behind") {
    renderBehindTheScenes();
  } else if (route.name === "tech-health") {
    renderHealthCheckPage();
  } else if (route.name === "recipe") {
    if (!route.recipeId) {
      location.hash = "#/catalogue";
      return;
    }
    renderRecipePage(route.recipeId);
  } else {
    renderHome();
  }
}

window.addEventListener("hashchange", render);
render();

const base = import.meta.env.BASE_URL;
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  });
}
