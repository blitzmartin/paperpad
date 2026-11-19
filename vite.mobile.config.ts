import { defineConfig, mergeConfig } from "vite";
import desktop from "./vite.config.ts";

// The mobile shell (mobile.html), used by the Android build through
// src-tauri/tauri.android.conf.json. Same settings as the desktop build,
// with its own port (both dev servers can run at once) and output folder.
export default mergeConfig(
  desktop,
  defineConfig({
    server: { port: 1421 },
    build: {
      outDir: "dist-mobile",
      rollupOptions: { input: "mobile.html" },
    },
  }),
);
