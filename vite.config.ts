import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port, so enable strictPort.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    watch: {
      // Exclude src-tauri from Vite's watch (only the Rust side builds it).
      ignored: ["**/src-tauri/**"],
    },
  },
});
