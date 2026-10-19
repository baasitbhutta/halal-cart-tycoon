import { defineConfig } from "vite";

// Static web app: `npm run dev` serves web/, `npm run build:web` emits
// dist-web/ (deployable to GitHub Pages as-is). No backend.
export default defineConfig({
  root: "web",
  // Project Pages serves from /halal-cart-tycoon/; local dev stays at /.
  base: process.env.GH_PAGES ? "/halal-cart-tycoon/" : "/",
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
});
