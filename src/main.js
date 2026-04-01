import "./style.css";
import { marked } from "marked";
import dummyMarkdown from "../documentation/dummy?raw";
import {
  buildRecipeCardHtml,
  escapeHtml,
  parseRecipeFromText,
} from "./recipeParser.js";

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
  if (parts[0] === "behind-the-scenes") return { name: "behind" };
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

function renderHome() {
  revokeImage();
  lastConverterRecipe = null;
  document.title = "ScreenToKitchen";

  app.innerHTML = `
    <main class="shell">
      <h1>ScreenToKitchen</h1>
      <p class="lede">This is a Progressive Web App. Install it from the browser menu for an app-like experience.</p>
      <p class="home-nav">
        <a class="home-nav__link" href="#/catalogue">Catalogue</a>
      </p>
      <p class="home-actions">
        <a class="home-behind-btn" href="#/behind-the-scenes">Behind the scenes</a>
      </p>

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

      <p class="hint footer-hint">GitHub Pages serves static files only — this is not an App Store or Play Store binary.</p>
    </main>
  `;

  app.querySelector(".upload-input").addEventListener("change", onFileSelected);
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
      const {
        data: { text },
      } = await worker.recognize(imageUrl);
      if (runId !== ocrRunId || parseRoute().name !== "converter") return;

      statusEl.hidden = true;
      outputWrap.hidden = false;
      const trimmed = text.trim();
      if (!trimmed.length) {
        recipeRoot.innerHTML =
          '<p class="recipe-fallback">(No text detected in this image.)</p>';
        setConverterSaveState(parseRecipeFromText(""), true);
        return;
      }
      const recipe = parseRecipeFromText(trimmed);
      recipeRoot.innerHTML = buildRecipeCardHtml(recipe);
      setConverterSaveState(recipe, true);
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
  document.title = "Behind the scenes · ScreenToKitchen";
  const html = marked.parse(prepareBehindTheScenesMarkdown(dummyMarkdown), {
    gfm: true,
  });
  app.innerHTML = `
    <main class="shell shell--behind">
      <a href="#/" class="back-link back-link--converter">← Home</a>
      <h1 class="behind-title">Behind the scenes</h1>
      <p class="behind-lede lede">How this app works—in plain language.</p>
      <article class="doc-prose">${html}</article>
    </main>
  `;
}

function render() {
  const route = parseRoute();
  if (route.name === "converter") {
    renderConverter();
  } else if (route.name === "catalogue") {
    renderCataloguePage();
  } else if (route.name === "behind") {
    renderBehindTheScenes();
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
