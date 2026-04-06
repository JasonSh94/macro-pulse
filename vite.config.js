import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Ensures data.json in /public is served at /data.json in dev
  publicDir: "public",
});
