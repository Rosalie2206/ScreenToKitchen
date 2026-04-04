/** Persisted UI locale: English (default) or Dutch (Flemish/Belgian Dutch). */

const STORAGE_KEY = "screenToKitchenLocale";

/** @typedef {'en'|'nl'} Locale */

/** @type {Record<Locale, Record<string, string>>} */
const STRINGS = {
  en: {
    menuHome: "Home",
    menuConverter: "Converter",
    menuCatalogue: "Catalogue",
    menuTechKitchen: "Tech Kitchen",
    menuPanelAria: "Main menu",
    ariaOpenMenu: "Open menu",
    ariaHomeNav: "Home",
    ariaUploadSection: "Upload a picture",
    heroScroll: "Scroll",
    heroCook: "Cook",
    heroRepeat: "Repeat",
    homeUploadLabel: "Upload your picture",
    docTitleHome: "Scroll Cook Repeat",
    docTitleConverter: "Converter · Scroll Cook Repeat",
    docTitleCatalogue: "Catalogue · Scroll Cook Repeat",
    docTitleRecipe: "Recipe · Scroll Cook Repeat",
    docTitleSaved: "Saved",
    docTitleTechBehind: "Tech Kitchen · Behind the scenes",
    docTitleTechHealth: "Tech Kitchen · Health check",
    translateSwitchToNl: "Switch interface to Dutch (Flemish)",
    translateSwitchToEn: "Switch interface to English",
    converterTitle: "Converter",
    converterEmpty: "No picture loaded yet.",
    uploadHeading: "Picture",
    uploadHint: "Choose from your gallery or take a new photo.",
    choosePhoto: "Choose photo",
    ocrReading: "Reading text from image… This may take a moment the first time.",
    ocrPreparing: "Preparing image for OCR…",
    ocrConverting: "Converting text to a structured recipe…",
    ocrNoText: "(No text detected in this image.)",
    ocrConvertFail: "Could not convert this image into a recipe. Try again with a clearer photo.",
    ocrReadFail:
      "Could not read text from this image. Check your connection and try again.",
    saveRecipe: "Save recipe",
    saveRecipeError: "Could not save the recipe.",
    catalogueTitle: "Catalogue",
    catalogueEmpty:
      "No saved recipes yet. Use Converter to read a recipe from a photo, then tap Save recipe.",
    catalogueLede: "Saved recipes",
    catalogueLoading: "Loading recipes…",
    catalogueLoadError: "Could not load saved recipes. Is the backend running?",
    catalogueDelete: "Remove recipe",
    recipePageMissing: "Recipe",
    recipeNotFound:
      "This recipe was not found. It may have been removed or the link is invalid.",
    recipeSavedHeading: "Saved recipe",
    recipeUntitled: "Recipe",
    behindTitle: "Tech Kitchen",
    behindLede: "How this app works—in plain language.",
    healthLede: "Live backend, local LLM, and Groq status.",
    healthPanelAria: "System status",
    healthTabsAria: "Tech Kitchen tabs",
    tabHealth: "Health check",
    tabBehind: "Behind the scenes",
    healthBackend: "Backend API",
    healthLocalLlm: "Local LLM",
    healthGroq: "Groq API",
    healthChecking: "Checking…",
    healthOnline: "Online",
    healthOffline: "Offline",
    healthReachable: "Reachable",
    healthUnreachable: "Unreachable",
    healthNotEnabled: "Not enabled",
    healthNoGroqKey: "No GROQ_API_KEY",
    healthConnected: "Connected",
    healthFailed: "Failed",
    healthUnknown: "Unknown",
    healthUnavailable: "Unavailable",
    healthLlmOkLocal: "Local LLM OK",
    healthLlmOkGroq: "Groq OK",
    healthLlmUnavailable: "LLM unavailable",
    healthLocalFailed: "Local LLM failed",
    healthGroqUnavailable: "Groq unavailable",
    healthNoErrorDetails: "No error details available.",
    healthPingFail:
      "Could not reach health endpoint. Is the backend running?",
    healthPingUrl: "Ping URL",
    healthLlmModeLabel: "LLM mode",
    healthErrLocal: "Local",
    healthErrGroq: "Groq",
    recipeIngredients: "Ingredients",
    recipeInstructions: "Instructions",
    recipeNotes: "Notes",
    recipeFallbackEmpty:
      'Could not split this into ingredients and steps. Try a clearer photo or add headings like "Ingredients" and "Instructions" in the image.',
  },
  nl: {
    menuHome: "Home",
    menuConverter: "Converter",
    menuCatalogue: "Catalogus",
    menuTechKitchen: "Tech-keuken",
    menuPanelAria: "Hoofdmenu",
    ariaOpenMenu: "Menu openen",
    ariaHomeNav: "Home",
    ariaUploadSection: "Een foto uploaden",
    heroScroll: "Scroll",
    heroCook: "Koken",
    heroRepeat: "Herhaal",
    homeUploadLabel: "Upload je foto",
    docTitleHome: "Scroll Cook Repeat",
    docTitleConverter: "Converter · Scroll Cook Repeat",
    docTitleCatalogue: "Catalogus · Scroll Cook Repeat",
    docTitleRecipe: "Recept · Scroll Cook Repeat",
    docTitleSaved: "Opgeslagen",
    docTitleTechBehind: "Tech-keuken · Achter de schermen",
    docTitleTechHealth: "Tech-keuken · Status",
    translateSwitchToNl: "Schakel interface naar het Nederlands (Vlaams)",
    translateSwitchToEn: "Schakel interface naar het Engels",
    converterTitle: "Converter",
    converterEmpty: "Nog geen foto geladen.",
    uploadHeading: "Foto",
    uploadHint: "Kies uit je galerij of neem een nieuwe foto.",
    choosePhoto: "Kies foto",
    ocrReading:
      "Tekst uit de foto lezen… De eerste keer kan even duren.",
    ocrPreparing: "Afbeelding voorbereiden voor OCR…",
    ocrConverting: "Tekst omzetten naar een gestructureerd recept…",
    ocrNoText: "(Geen tekst gevonden in deze afbeelding.)",
    ocrConvertFail:
      "Deze afbeelding kon niet worden omgezet naar een recept. Probeer een scherpere foto.",
    ocrReadFail:
      "Kon geen tekst uit deze afbeelding lezen. Controleer je verbinding en probeer opnieuw.",
    saveRecipe: "Recept bewaren",
    saveRecipeError: "Het recept kon niet worden bewaard.",
    catalogueTitle: "Catalogus",
    catalogueEmpty:
      "Nog geen bewaarde recepten. Gebruik de Converter om een recept van een foto te lezen en tik daarna op Recept bewaren.",
    catalogueLede: "Bewaarde recepten",
    catalogueLoading: "Recepten laden…",
    catalogueLoadError:
      "Kon bewaarde recepten niet laden. Draait de backend?",
    catalogueDelete: "Recept verwijderen",
    recipePageMissing: "Recept",
    recipeNotFound:
      "Dit recept werd niet gevonden. Het is mogelijk verwijderd of de link klopt niet.",
    recipeSavedHeading: "Bewaard recept",
    recipeUntitled: "Recept",
    behindTitle: "Tech-keuken",
    behindLede: "Hoe deze app werkt—in gewone taal.",
    healthLede: "Status van backend, lokale LLM en Groq.",
    healthPanelAria: "Systeemstatus",
    healthTabsAria: "Tech-keuken tabs",
    tabHealth: "Status",
    tabBehind: "Achter de schermen",
    healthBackend: "Backend-API",
    healthLocalLlm: "Lokale LLM",
    healthGroq: "Groq-API",
    healthChecking: "Bezig…",
    healthOnline: "Online",
    healthOffline: "Offline",
    healthReachable: "Bereikbaar",
    healthUnreachable: "Niet bereikbaar",
    healthNotEnabled: "Niet ingeschakeld",
    healthNoGroqKey: "Geen GROQ_API_KEY",
    healthConnected: "Verbonden",
    healthFailed: "Mislukt",
    healthUnknown: "Onbekend",
    healthUnavailable: "Niet beschikbaar",
    healthLlmOkLocal: "Lokale LLM OK",
    healthLlmOkGroq: "Groq OK",
    healthLlmUnavailable: "LLM niet beschikbaar",
    healthLocalFailed: "Lokale LLM mislukt",
    healthGroqUnavailable: "Groq niet beschikbaar",
    healthNoErrorDetails: "Geen foutdetails beschikbaar.",
    healthPingFail:
      "Kon het health-endpoint niet bereiken. Draait de backend?",
    healthPingUrl: "Ping-URL",
    healthLlmModeLabel: "LLM-modus",
    healthErrLocal: "Lokaal",
    healthErrGroq: "Groq",
    recipeIngredients: "Ingrediënten",
    recipeInstructions: "Bereiding",
    recipeNotes: "Tips",
    recipeFallbackEmpty:
      'Kon dit niet splitsen in ingrediënten en stappen. Probeer een scherpere foto of voeg koppen zoals "Ingrediënten" en "Bereiding" toe in de afbeelding.',
  },
};

/** @returns {Locale} */
export function getLocale() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "nl" ? "nl" : "en";
  } catch {
    return "en";
  }
}

/** @param {Locale} locale */
export function setLocale(locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale === "nl" ? "nl" : "en");
  } catch {
    /* ignore */
  }
}

export function toggleLocale() {
  const next = getLocale() === "en" ? "nl" : "en";
  setLocale(next);
  return next;
}

/** @param {string} key */
export function t(key) {
  const L = getLocale();
  const table = STRINGS[L];
  if (table && Object.prototype.hasOwnProperty.call(table, key)) {
    return table[key];
  }
  return STRINGS.en[key] ?? key;
}

/** Date/time for catalogue meta (nl-BE for Flemish). */
export function dateTimeLocaleTag() {
  return getLocale() === "nl" ? "nl-BE" : "en";
}
