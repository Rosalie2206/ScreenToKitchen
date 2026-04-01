/**
 * Turn raw OCR text into a structured recipe (client-side heuristics).
 */

const ING_HEADER =
  /^(ingredients?|what you need|you will need|shopping list)\s*:?\s*$/i;
const DIR_HEADER =
  /^(directions?|instructions?|method|steps?|preparation|how to(?:\s+\w+)?)\s*:?\s*$/i;
const NOTES_HEADER = /^(notes?|tips?|chef'?s?\s*notes?)\s*:?\s*$/i;

const ING_LINE =
  /^[-–—•*·]\s*.+|^\d+[\d\s\/]*[-–]?\s*\d*\s*(?:cup|tbsp|tsp|teaspoon|tablespoon|oz|ounce|lb|pound|g|gram|kg|ml|l|clove|cloves|pinch|dash|can|package|bunch|stalk|slice|slices|piece|pieces|tbsp\.|tsp\.)\b/i;
const ING_LINE_LOOSE =
  /\b(cups?|tbsp|tsp|teaspoon|tablespoon|ounces?|oz|lb|g|kg|ml|cloves?)\b/i;

function looksLikeIngredientLine(line) {
  const t = line.trim();
  if (t.length < 2) return false;
  if (/^[-–—•*·]\s/.test(t)) return true;
  if (ING_LINE.test(t)) return true;
  if (/^\d/.test(t) && ING_LINE_LOOSE.test(t)) return true;
  if (/^(?:a|an|few|some|about)\s+\d/i.test(t) && t.length < 120) return true;
  return false;
}

function looksLikeStepLine(line) {
  const t = line.trim();
  return (
    /^\d{1,2}[\.\)]\s/.test(t) ||
    /^step\s+\d+/i.test(t) ||
    /^(first|next|then|finally)[,:]?\s/i.test(t)
  );
}

function classifyHeader(line) {
  if (ING_HEADER.test(line)) return "ingredients";
  if (DIR_HEADER.test(line)) return "directions";
  if (NOTES_HEADER.test(line)) return "notes";
  return null;
}

function takeTitleLines(lines, upTo) {
  if (upTo <= 0) return { title: "Recipe", consumed: 0 };
  const chunk = lines.slice(0, upTo);
  const joined = chunk.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length <= 120) {
    return { title: joined || "Recipe", consumed: upTo };
  }
  return { title: lines[0] || "Recipe", consumed: 1 };
}

function splitNumberedSteps(blockLines) {
  const steps = [];
  let current = [];
  const flush = () => {
    const s = current.join(" ").replace(/\s+/g, " ").trim();
    if (s) steps.push(s);
    current = [];
  };

  for (const line of blockLines) {
    const t = line.trim();
    if (/^\d{1,2}[\.\)]\s/.test(t)) {
      flush();
      current.push(t.replace(/^\d{1,2}[\.\)]\s*/, ""));
    } else if (t.length && current.length) {
      current.push(t);
    } else if (t.length && !steps.length && !current.length) {
      current.push(t);
    } else if (t.length) {
      current.push(t);
    }
  }
  flush();

  if (steps.length <= 1 && blockLines.length) {
    return blockLines.map((l) => l.trim()).filter(Boolean);
  }
  return steps;
}

function heuristicSplit(lines) {
  const titleLine = lines[0] && lines[0].length < 90 ? lines[0] : "Recipe";
  const rest = lines[0] && lines[0].length < 90 ? lines.slice(1) : lines;

  const ingredients = [];
  const steps = [];
  const notes = [];

  let mode = "ingredients";

  for (const line of rest) {
    const t = line.trim();
    if (!t) continue;

    const hdr = classifyHeader(t);
    if (hdr === "ingredients") {
      mode = "ingredients";
      continue;
    }
    if (hdr === "directions") {
      mode = "directions";
      continue;
    }
    if (hdr === "notes") {
      mode = "notes";
      continue;
    }

    if (mode === "notes") {
      notes.push(t);
      continue;
    }

    if (mode === "ingredients") {
      if (looksLikeStepLine(t) && ingredients.length) {
        mode = "directions";
        steps.push(t.replace(/^\d{1,2}[\.\)]\s*/, ""));
        continue;
      }
      if (looksLikeIngredientLine(t) || ingredients.length === 0) {
        ingredients.push(t.replace(/^[-–—•*·]\s*/, "").trim());
        continue;
      }
      mode = "directions";
      steps.push(t);
      continue;
    }

    if (mode === "directions") {
      steps.push(t);
    }
  }

  if (!steps.length && ingredients.length) {
    const ingSet = new Set(ingredients);
    const maybeSteps = rest.filter((l) => !ingSet.has(l) && !looksLikeIngredientLine(l));
    for (const m of maybeSteps) {
      if (!ingredients.includes(m)) steps.push(m);
    }
  }

  return {
    title: titleLine,
    ingredients: ingredients.filter(Boolean),
    steps: splitNumberedSteps(steps.length ? steps : rest),
    notes,
  };
}

function parseWithSectionHeaders(lines) {
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const kind = classifyHeader(lines[i]);
    if (kind) markers.push({ kind, index: i });
  }
  if (!markers.length) return null;

  const firstIdx = markers[0].index;
  const { title, consumed } = takeTitleLines(lines, firstIdx);

  const ingMarker = markers.find((m) => m.kind === "ingredients");
  const dirMarker = markers.find((m) => m.kind === "directions");
  const noteMarker = markers.find((m) => m.kind === "notes");

  let ingStart = ingMarker ? ingMarker.index + 1 : null;
  let ingEnd = lines.length;
  if (dirMarker && ingMarker && dirMarker.index > ingMarker.index) {
    ingEnd = dirMarker.index;
  } else if (noteMarker && ingMarker && noteMarker.index > ingMarker.index) {
    ingEnd = Math.min(ingEnd, noteMarker.index);
  }

  let dirStart = dirMarker ? dirMarker.index + 1 : null;
  let dirEnd = lines.length;
  if (noteMarker && dirMarker && noteMarker.index > dirMarker.index) {
    dirEnd = noteMarker.index;
  }

  const ingredients = [];
  if (ingStart != null) {
    for (let i = ingStart; i < ingEnd; i++) {
      const raw = lines[i].trim();
      if (!classifyHeader(raw)) {
        ingredients.push(raw.replace(/^[-–—•*·]\s*/, "").trim());
      }
    }
  }

  const stepLines = [];
  if (dirStart != null) {
    for (let i = dirStart; i < dirEnd; i++) {
      const raw = lines[i].trim();
      if (!classifyHeader(raw)) stepLines.push(raw);
    }
  }

  const notes = [];
  if (noteMarker) {
    for (let i = noteMarker.index + 1; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!classifyHeader(raw)) notes.push(raw);
    }
  }

  let steps = splitNumberedSteps(stepLines);
  if (!steps.length && stepLines.length) {
    steps = stepLines;
  }

  return {
    title,
    ingredients: ingredients.filter(Boolean),
    steps: steps.filter(Boolean),
    notes,
    consumedTitleLines: consumed,
  };
}

export function parseRecipeFromText(raw) {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return { title: "Recipe", ingredients: [], steps: [], notes: [] };
  }

  const lines = normalized
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) {
    return { title: "Recipe", ingredients: [], steps: [], notes: [] };
  }

  const structured = parseWithSectionHeaders(lines);
  if (structured && (structured.ingredients.length || structured.steps.length)) {
    return {
      title: structured.title,
      ingredients: structured.ingredients,
      steps: structured.steps,
      notes: structured.notes,
    };
  }

  return heuristicSplit(lines);
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildRecipeCardHtml(recipe) {
  const t = escapeHtml(recipe.title || "Recipe");
  const ing = (recipe.ingredients || []).map((x) => escapeHtml(x));
  const steps = (recipe.steps || []).map((x) => escapeHtml(x));
  const notes = (recipe.notes || []).map((x) => escapeHtml(x));

  const ingBlock =
    ing.length > 0
      ? `<section class="recipe-block recipe-block--ingredients" aria-label="Ingredients">
          <h3 class="recipe-block__title">Ingredients</h3>
          <ul class="recipe-list recipe-list--bullets">
            ${ing.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </section>`
      : "";

  const stepsBlock =
    steps.length > 0
      ? `<section class="recipe-block recipe-block--steps" aria-label="Instructions">
          <h3 class="recipe-block__title">Instructions</h3>
          <ol class="recipe-list recipe-list--numbered">
            ${steps.map((item) => `<li>${item}</li>`).join("")}
          </ol>
        </section>`
      : "";

  const notesBlock =
    notes.length > 0
      ? `<section class="recipe-block recipe-block--notes" aria-label="Notes">
          <h3 class="recipe-block__title">Notes</h3>
          <ul class="recipe-list recipe-list--notes">
            ${notes.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </section>`
      : "";

  const empty =
    !ing.length && !steps.length && !notes.length
      ? `<p class="recipe-fallback">Could not split this into ingredients and steps. Try a clearer photo or add headings like &quot;Ingredients&quot; and &quot;Instructions&quot; in the image.</p>`
      : "";

  return `
    <article class="recipe-card">
      <header class="recipe-card__header">
        <h2 class="recipe-card__title">${t}</h2>
      </header>
      <div class="recipe-card__body">
        ${ingBlock}
        ${stepsBlock}
        ${notesBlock}
        ${empty}
      </div>
    </article>
  `;
}
