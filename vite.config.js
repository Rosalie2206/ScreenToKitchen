import { defineConfig } from "vite";

// GitHub Project Page: https://<user>.github.io/<repo>/
// User/org site (username.github.io): set base to "/".
const repo = "ScreenToKitchen";

export default defineConfig({
  base: `/${repo}/`,
});
