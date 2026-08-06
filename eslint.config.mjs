import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "outputs/**", "work/**", "public/data/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["src/**/*.{ts,tsx}"], languageOptions: { globals: { window: "readonly", document: "readonly", navigator: "readonly", localStorage: "readonly", crypto: "readonly", btoa: "readonly", atob: "readonly", Blob: "readonly", URL: "readonly", ResizeObserver: "readonly", setTimeout: "readonly" } } },
);
