import { defineConfig } from "vite";

// Default to "/" for Vercel deployment.
// For GitHub Pages project sites, set VITE_BASE_PATH="/<repo>/" in build env.
const base = process.env.VITE_BASE_PATH?.trim() || "/";

export default defineConfig({
  base,
});
