import { defineConfig } from "vite";

// Tauri expects a fixed port and must not clear the terminal so Rust errors stay visible.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // WebView2 (Chromium), WKWebView (Safari 14+ on macOS 11) and WebKitGTK.
    target: ["es2021", "chrome105", "safari14"],
    sourcemap: false,
    // No source maps and no inline modules keep the CSP strict.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
