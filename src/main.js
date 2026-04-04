import "./style.css";
import { marked } from "marked";
import dummyMarkdown from "../documentation/dummy?raw";
import {
  buildRecipeCardHtml,
  escapeHtml,
  cleanOcrTextForRecipe,
} from "./recipeParser.js";
import { fetchRecipe } from "./lib/fetchRecipe.js";
import {
  fetchRecipesCatalogue,
  fetchRecipeById,
  deleteRecipeApi,
  postRecipe,
} from "./lib/recipesApi.js";
import { fetchHealth } from "./lib/fetchHealth.js";
import { getLocale, toggleLocale, t, dateTimeLocaleTag } from "./i18n.js";

const app = document.querySelector("#app");

/**
 * Per-letter spans with upward arc per word (center letters higher), plus slight rotation.
 * Arc uses parabola 4·t·(1−t), t ∈ [0,1] along the word.
 */
function playfulHeroWord(word) {
  const n = word.length;
  return [...word]
    .map((ch, i) => {
      const safe = escapeHtml(ch);
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const arc = 4 * t * (1 - t);
      return `<span class="home-hero-char" style="--t:${t};--arc:${arc}">${safe}</span>`;
    })
    .join("");
}

let imageObjectUrl = null;
let ocrRunId = 0;
/** Last parsed recipe on the converter screen. */
let lastConverterRecipe = null;
/** Server id after POST /api/recipe (SQLite), if persisted. */
let lastConverterRecipeId = null;

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
    const subtab = parts[1] ?? "health-check";
    if (subtab === "health-check") return { name: "tech-health" };
    return { name: "tech-behind" };
  }
  if (parts[0] === "behind-the-scenes") return { name: "tech-behind" };
  if (parts[0] === "recipe") {
    return { name: "recipe", recipeId: parts[1] ?? null };
  }
  return { name: "home" };
}

function renderMenuHeader(options = {}) {
  const hideHomeIcon = options.hideHomeIcon === true;
  const homeIcon = hideHomeIcon
    ? ""
    : `
        <a class="home-nav-icon" href="#/" aria-label="${escapeHtml(t("ariaHomeNav"))}">
          <img class="home-nav-icon__img" src="${import.meta.env.BASE_URL}home-icon.png" alt="" />
        </a>`;
  const translateAria =
    getLocale() === "nl" ? t("translateSwitchToEn") : t("translateSwitchToNl");
  /** Translate toggle is not shown on the home page (language can be changed after navigating away). */
  const translateStrip = hideHomeIcon
    ? ""
    : `
        <button
          type="button"
          class="home-header__translate"
          aria-pressed="${getLocale() === "nl" ? "true" : "false"}"
          aria-label="${escapeHtml(translateAria)}"
        >
          <img class="home-header__translate-img" src="${import.meta.env.BASE_URL}translate-banner.svg" alt="" width="356" height="186" decoding="async" />
        </button>`;
  const actions = `
      <div class="home-header__actions">
        <div class="home-header__icon-row">
          ${homeIcon}
          <details class="home-menu">
            <summary class="home-menu__trigger" aria-label="${escapeHtml(t("ariaOpenMenu"))}">
              <img class="home-menu__icon" src="${import.meta.env.BASE_URL}menu-icon.png" alt="" />
            </summary>
            <nav class="home-menu__panel" aria-label="${escapeHtml(t("menuPanelAria"))}">
              <a class="home-menu__item" href="#/">${escapeHtml(t("menuHome"))}</a>
              <a class="home-menu__item" href="#/converter">${escapeHtml(t("menuConverter"))}</a>
              <a class="home-menu__item" href="#/catalogue">${escapeHtml(t("menuCatalogue"))}</a>
              <a class="home-menu__item" href="#/tech-kitchen/health-check">${escapeHtml(t("menuTechKitchen"))}</a>
            </nav>
          </details>
        </div>
        ${translateStrip}
      </div>`;
  return `
    <div class="home-header home-header--icons-only">
      ${actions}
    </div>`;
}

function renderHome() {
  revokeImage();
  lastConverterRecipe = null;
  lastConverterRecipeId = null;
  document.title = "Scroll Cook Repeat";

  app.innerHTML = `
    <main class="shell shell--home">
      ${renderMenuHeader({ hideHomeIcon: true })}
      <div class="home-hero">
        <h1 class="home-hero-title" aria-label="Scroll Cook Repeat">
          <span class="home-hero-title__line">${playfulHeroWord("Scroll")}</span>
          <span class="home-hero-title__line">${playfulHeroWord("Cook")}</span>
          <span class="home-hero-title__line">${playfulHeroWord("Repeat")}</span>
        </h1>
        <section class="upload upload--home-hero" aria-label="${escapeHtml(t("ariaUploadSection"))}">
          <div class="upload-controls">
            <label class="upload-button upload-button--home-hero">
              <input type="file" class="upload-input" accept="image/*" />
              <span class="upload-button-label">${escapeHtml(t("homeUploadLabel"))}</span>
            </label>
          </div>
        </section>
      </div>
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
    setBackend(Boolean(health.backend?.ok), t("healthOnline"));

    if (hasSplitLlm) {
      const loc = health.llm?.local;
      if (!loc?.enabled) {
        setHealthRow(dotLocal, badgeLocal, "na", t("healthNotEnabled"));
      } else if (loc.ok) {
        setHealthRow(dotLocal, badgeLocal, "ok", t("healthReachable"));
      } else {
        const err = loc.error?.trim() || t("healthUnreachable");
        const short =
          err.length > 72 ? `${err.slice(0, 69)}…` : err;
        setHealthRow(dotLocal, badgeLocal, "bad", short);
      }

      const gq = health.llm?.groq;
      if (!gq?.enabled) {
        setHealthRow(dotGroq, badgeGroq, "bad", t("healthNoGroqKey"));
      } else if (gq.ok) {
        setHealthRow(dotGroq, badgeGroq, "ok", t("healthConnected"));
      } else {
        const err = gq.error?.trim() || t("healthFailed");
        const short =
          err.length > 72 ? `${err.slice(0, 69)}…` : err;
        setHealthRow(dotGroq, badgeGroq, "bad", short);
      }

    } else {
      const dotLlm = app.querySelector(".health-dot-llm");
      const badgeLlm = app.querySelector(".health-llm-badge");
      if (health.llm?.ok) {
        setHealthRow(
          dotLlm,
          badgeLlm,
          "ok",
          health.llm.source === "local"
            ? t("healthLlmOkLocal")
            : t("healthLlmOkGroq"),
        );
        if (detailsEl) {
          detailsEl.textContent = `${t("healthPingUrl")}: ${pingUrl} · ${t("healthLlmModeLabel")}: ${llmMode}`;
        }
      } else {
        const why =
          health.llm?.source === "none"
            ? t("healthLlmUnavailable")
            : health.llm?.source === "local"
              ? t("healthLocalFailed")
              : t("healthGroqUnavailable");
        setHealthRow(dotLlm, badgeLlm, "bad", why);
        if (detailsEl) {
          const localErr = health.llm.local?.error
            ? `${t("healthErrLocal")}: ${health.llm.local.error}`
            : "";
          const groqErr = health.llm.groq?.error
            ? `${t("healthErrGroq")}: ${health.llm.groq.error}`
            : "";
          const combined = [localErr, groqErr].filter(Boolean).join(" · ");
          detailsEl.textContent = `${t("healthPingUrl")}: ${pingUrl} · ${t("healthLlmModeLabel")}: ${llmMode}${combined ? ` · ${combined}` : ` · ${t("healthNoErrorDetails")}`}`;
        }
      }
    }
  } catch (e) {
    console.error(e);
    setBackend(false, t("healthOffline"));
    if (hasSplitLlm) {
      setHealthRow(dotLocal, badgeLocal, "bad", t("healthUnknown"));
      setHealthRow(dotGroq, badgeGroq, "bad", t("healthUnknown"));
    } else {
      const dotLlm = app.querySelector(".health-dot-llm");
      const badgeLlm = app.querySelector(".health-llm-badge");
      if (dotLlm && badgeLlm) {
        setHealthRow(dotLlm, badgeLlm, "bad", t("healthUnavailable"));
      }
    }
    if (detailsEl) {
      detailsEl.textContent = `${t("healthPingUrl")}: ${pingUrl} · ${t("healthPingFail")}`;
    }
  }
}

function renderTechKitchenTabs(active) {
  return `
    <nav class="tech-tabs" aria-label="${escapeHtml(t("healthTabsAria"))}">
      <a class="tech-tab ${active === "health" ? "tech-tab--active" : ""}" href="#/tech-kitchen/health-check">${escapeHtml(t("tabHealth"))}</a>
      <a class="tech-tab ${active === "behind" ? "tech-tab--active" : ""}" href="#/tech-kitchen/behind-the-scenes">${escapeHtml(t("tabBehind"))}</a>
    </nav>
  `;
}

function onFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  revokeImage();
  lastConverterRecipe = null;
  lastConverterRecipeId = null;
  imageObjectUrl = URL.createObjectURL(file);
  const alreadyOnConverter = parseRoute().name === "converter";
  location.hash = "#/converter";
  // Same-hash navigation does not fire `hashchange`; re-render when uploading from empty converter.
  if (alreadyOnConverter) {
    render();
  }
}

/**
 * @param {object | null} recipe
 * @param {boolean} enabled
 * @param {string | null | undefined} savedId — server id; omit to keep previous id (e.g. language toggle)
 */
function setConverterSaveState(recipe, enabled, savedId) {
  lastConverterRecipe = recipe;
  if (!recipe || !enabled) {
    lastConverterRecipeId = null;
  } else if (savedId !== undefined) {
    lastConverterRecipeId = savedId;
  }
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
      statusEl.textContent = t("ocrPreparing");
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
      statusEl.textContent = t("ocrConverting");
      outputWrap.hidden = false;
      const cleanedForLlm = cleanOcrForLlm(text);
      const trimmed = cleanedForLlm.trim();
      if (!trimmed.length) {
        recipeRoot.innerHTML = `<p class="recipe-fallback">${escapeHtml(t("ocrNoText"))}</p>`;
        statusEl.hidden = true;
        setConverterSaveState(null, false);
        return;
      }

      try {
        const { recipe, id } = await fetchRecipe(trimmed, {
          outputLocale: getLocale() === "nl" ? "nl" : "en",
        });
        if (runId !== ocrRunId || parseRoute().name !== "converter") return;

        recipeRoot.innerHTML = buildRecipeCardHtml(recipe);
        statusEl.hidden = true;
        setConverterSaveState(recipe, true, id ?? null);
        const thumbWrap = app.querySelector(".converter-thumb-wrap");
        if (thumbWrap) thumbWrap.hidden = true;
        const uploadLede = app.querySelector(".converter-lede");
        if (uploadLede) uploadLede.hidden = true;
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof Error ? e.message : e ? String(e) : "Unknown error";
        statusEl.hidden = true;
        recipeRoot.innerHTML = `
          <p class="recipe-fallback">${escapeHtml(t("ocrConvertFail"))}</p>
          <p class="recipe-fallback recipe-error-details">${escapeHtml(msg)}</p>
        `;
        setConverterSaveState(null, false);
      }
    } finally {
      await worker.terminate();
    }
  } catch (err) {
    if (runId !== ocrRunId || parseRoute().name !== "converter") return;
    statusEl.textContent = t("ocrReadFail");
    console.error(err);
    setConverterSaveState(null, false);
  }
}

function renderConverter() {
  document.title = t("docTitleConverter");

  if (!imageObjectUrl) {
    lastConverterRecipe = null;
    lastConverterRecipeId = null;
    app.innerHTML = `
      <main class="shell shell--converter">
        ${renderMenuHeader()}
        <h1>${escapeHtml(t("converterTitle"))}</h1>
        <p class="hint converter-empty">${escapeHtml(t("converterEmpty"))}</p>
        <section class="upload" aria-label="${escapeHtml(t("ariaUploadSection"))}">
          <h2 class="upload-heading">${escapeHtml(t("uploadHeading"))}</h2>
          <p class="upload-hint hint">${escapeHtml(t("uploadHint"))}</p>
          <div class="upload-controls">
            <label class="upload-button">
              <input type="file" class="upload-input" accept="image/*" />
              <span class="upload-button-label">${escapeHtml(t("choosePhoto"))}</span>
            </label>
          </div>
        </section>
      </main>
    `;
    app.querySelector(".upload-input").addEventListener("change", onFileSelected);
    return;
  }

  const url = imageObjectUrl;
  const recipeToRestore = lastConverterRecipe;

  app.innerHTML = `
    <main class="shell shell--converter">
      ${renderMenuHeader()}
      <h1>${escapeHtml(t("converterTitle"))}</h1>
      <section class="ocr-section" aria-live="polite">
        <p class="ocr-status">${escapeHtml(t("ocrReading"))}</p>
        <div class="ocr-output-wrap" hidden>
          <div class="recipe-root"></div>
        </div>
      </section>
      <div class="converter-actions">
        <button type="button" class="save-recipe-btn" disabled>${escapeHtml(t("saveRecipe"))}</button>
      </div>
    </main>
  `;

  app.querySelector(".save-recipe-btn").addEventListener("click", async () => {
    const recipe = lastConverterRecipe;
    if (!recipe) return;
    if (lastConverterRecipeId) {
      location.hash = `#/recipe/${lastConverterRecipeId}`;
      return;
    }
    try {
      const { id } = await postRecipe(recipe);
      lastConverterRecipeId = id;
      location.hash = `#/recipe/${id}`;
    } catch (e) {
      console.error(e);
    }
  });

  if (recipeToRestore) {
    const recipeRoot = app.querySelector(".recipe-root");
    const outputWrap = app.querySelector(".ocr-output-wrap");
    const statusEl = app.querySelector(".ocr-status");
    if (recipeRoot && outputWrap && statusEl) {
      recipeRoot.innerHTML = buildRecipeCardHtml(recipeToRestore);
      outputWrap.hidden = false;
      statusEl.hidden = true;
      setConverterSaveState(recipeToRestore, true);
    }
    return;
  }

  const runId = ++ocrRunId;
  runConverterOcr(runId, url);
}

function formatSavedDate(ts) {
  try {
    return new Intl.DateTimeFormat(dateTimeLocaleTag(), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts));
  } catch {
    return "";
  }
}

async function renderCataloguePage() {
  document.title = t("docTitleCatalogue");
  app.innerHTML = `
    <main class="shell shell--catalogue">
      ${renderMenuHeader()}
      <h1 class="catalogue-title">${escapeHtml(t("catalogueTitle"))}</h1>
      <p class="hint converter-empty">${escapeHtml(t("catalogueLoading"))}</p>
    </main>
  `;

  let entries;
  try {
    entries = await fetchRecipesCatalogue();
  } catch (e) {
    console.error(e);
    app.innerHTML = `
      <main class="shell shell--catalogue">
        ${renderMenuHeader()}
        <h1 class="catalogue-title">${escapeHtml(t("catalogueTitle"))}</h1>
        <p class="hint converter-empty">${escapeHtml(t("catalogueLoadError"))}</p>
      </main>
    `;
    return;
  }

  if (!entries.length) {
    app.innerHTML = `
      <main class="shell shell--catalogue">
        ${renderMenuHeader()}
        <h1 class="catalogue-title">${escapeHtml(t("catalogueTitle"))}</h1>
        <p class="hint converter-empty">${escapeHtml(t("catalogueEmpty"))}</p>
      </main>
    `;
    return;
  }

  const items = entries
    .map((e) => {
      const title = e.recipe?.title?.trim() || t("recipeUntitled");
      const label = escapeHtml(title);
      const delLabel = escapeHtml(t("catalogueDelete"));
      return `<li class="catalogue-item">
        <div class="catalogue-item__row">
          <div class="catalogue-item__main">
            <a class="catalogue-link" href="#/recipe/${escapeHtml(e.id)}">${label}</a>
            <span class="catalogue-meta">${escapeHtml(formatSavedDate(e.savedAt))}</span>
          </div>
          <button type="button" class="catalogue-delete" data-id="${escapeHtml(e.id)}" aria-label="${delLabel}">×</button>
        </div>
      </li>`;
    })
    .join("");

  app.innerHTML = `
    <main class="shell shell--catalogue">
      ${renderMenuHeader()}
      <h1 class="catalogue-title">${escapeHtml(t("catalogueTitle"))}</h1>
      <p class="lede catalogue-lede">${escapeHtml(t("catalogueLede"))}</p>
      <ul class="catalogue-list">
        ${items}
      </ul>
    </main>
  `;
}

async function renderRecipePage(recipeId) {
  document.title = t("docTitleRecipe");
  app.innerHTML = `
    <main class="shell shell--recipe">
      ${renderMenuHeader()}
      <h1 class="recipe-page-title">${escapeHtml(t("recipePageMissing"))}</h1>
      <p class="hint converter-empty">${escapeHtml(t("catalogueLoading"))}</p>
    </main>
  `;

  let recipe = null;
  try {
    recipe = recipeId ? await fetchRecipeById(recipeId) : null;
  } catch (e) {
    console.error(e);
  }

  if (!recipe) {
    app.innerHTML = `
      <main class="shell shell--recipe">
        ${renderMenuHeader()}
        <h1 class="recipe-page-title">${escapeHtml(t("recipePageMissing"))}</h1>
        <p class="hint converter-empty">${escapeHtml(t("recipeNotFound"))}</p>
      </main>
    `;
    return;
  }

  const title = recipe.title?.trim() || t("recipeUntitled");
  document.title = `${title} · ${t("docTitleSaved")}`;

  app.innerHTML = `
    <main class="shell shell--recipe">
      ${renderMenuHeader()}
      <h1 class="recipe-page-title">${escapeHtml(t("recipeSavedHeading"))}</h1>
      <div class="recipe-page-root">${buildRecipeCardHtml(recipe)}</div>
    </main>
  `;
}

/** Strip the doc’s top-level # title so the page heading stays unique. */
function prepareBehindTheScenesMarkdown(raw) {
  return raw.replace(/^#\s+[^\n]+\n+/, "").trim();
}

function renderBehindTheScenes() {
  document.title = t("docTitleTechBehind");
  const html = marked.parse(prepareBehindTheScenesMarkdown(dummyMarkdown), {
    gfm: true,
  });
  app.innerHTML = `
    <main class="shell shell--behind">
      ${renderMenuHeader()}
      <h1 class="behind-title">${escapeHtml(t("behindTitle"))}</h1>
      ${renderTechKitchenTabs("behind")}
      <p class="behind-lede lede">${escapeHtml(t("behindLede"))}</p>
      <article class="doc-prose">${html}</article>
    </main>
  `;
}

function renderHealthCheckPage() {
  document.title = t("docTitleTechHealth");
  app.innerHTML = `
    <main class="shell shell--behind">
      ${renderMenuHeader()}
      <h1 class="behind-title">${escapeHtml(t("behindTitle"))}</h1>
      ${renderTechKitchenTabs("health")}
      <p class="behind-lede lede">${escapeHtml(t("healthLede"))}</p>
      <section class="health-panel" aria-label="${escapeHtml(t("healthPanelAria"))}">
        <div class="health-cell">
          <div class="health-cell__name">
            <span class="health-dot health-dot--bad health-dot-backend" aria-hidden="true"></span>
            ${escapeHtml(t("healthBackend"))}
          </div>
          <div class="health-cell__status">
            <span class="health-badge health-badge--bad health-backend-badge">${escapeHtml(t("healthChecking"))}</span>
          </div>
        </div>
        <div class="health-cell">
          <div class="health-cell__name">
            <span class="health-dot health-dot--bad health-dot-local" aria-hidden="true"></span>
            ${escapeHtml(t("healthLocalLlm"))}
          </div>
          <div class="health-cell__status">
            <span class="health-badge health-badge--bad health-local-badge">${escapeHtml(t("healthChecking"))}</span>
          </div>
        </div>
        <div class="health-cell">
          <div class="health-cell__name">
            <span class="health-dot health-dot--bad health-dot-groq" aria-hidden="true"></span>
            ${escapeHtml(t("healthGroq"))}
          </div>
          <div class="health-cell__status">
            <span class="health-badge health-badge--bad health-groq-badge">${escapeHtml(t("healthChecking"))}</span>
          </div>
        </div>
      </section>
    </main>
  `;
  checkHealthUI();
}

function render() {
  document.documentElement.lang = getLocale() === "nl" ? "nl-BE" : "en";
  const route = parseRoute();
  if (route.name === "converter") {
    renderConverter();
  } else if (route.name === "catalogue") {
    void renderCataloguePage();
  } else if (route.name === "tech-behind") {
    renderBehindTheScenes();
  } else if (route.name === "tech-health") {
    renderHealthCheckPage();
  } else if (route.name === "recipe") {
    if (!route.recipeId) {
      location.hash = "#/catalogue";
      return;
    }
    void renderRecipePage(route.recipeId);
  } else {
    renderHome();
  }
}

window.addEventListener("hashchange", render);

app.addEventListener("click", (e) => {
  const btn = e.target.closest(".home-header__translate");
  if (!btn) return;
  e.preventDefault();
  toggleLocale();
  render();
});

app.addEventListener("click", (e) => {
  const del = e.target.closest(".catalogue-delete");
  if (!del) return;
  e.preventDefault();
  const id = del.getAttribute("data-id");
  if (!id) return;
  void (async () => {
    try {
      await deleteRecipeApi(id);
      if (parseRoute().name === "catalogue") void renderCataloguePage();
    } catch (err) {
      console.error(err);
    }
  })();
});

render();

const base = import.meta.env.BASE_URL;
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  });
}
