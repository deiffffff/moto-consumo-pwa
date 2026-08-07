import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "github",
  base: "./",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist-github",
    emptyOutDir: true,
  },
});
