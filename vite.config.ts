import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const releaseTime = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date()).replaceAll("/", "-");

export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify("v18"),
    __RELEASE_TIME__: JSON.stringify(releaseTime),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
