import "./style.css";

const app = document.querySelector("#app");
app.innerHTML = `
  <main class="shell">
    <h1>ScreenToKitchen</h1>
    <p class="lede">This is a Progressive Web App. Install it from the browser menu for an app-like experience.</p>
    <p class="hint">GitHub Pages serves static files only — this is not an App Store or Play Store binary.</p>
  </main>
`;

const base = import.meta.env.BASE_URL;
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  });
}
