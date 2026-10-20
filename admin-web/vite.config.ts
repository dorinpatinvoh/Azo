import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Console web administrateur AZƆ̀ : site statique (hébergé sur Cloudflare Pages), qui appelle l'API du serveur.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
});
