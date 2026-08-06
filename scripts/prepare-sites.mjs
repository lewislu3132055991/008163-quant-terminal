import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

let html = await readFile("dist/index.html", "utf8");
const scriptMatch = html.match(/<script type="module"[^>]+src="\.\/([^"]+)"[^>]*><\/script>/);
const styleMatch = html.match(/<link rel="stylesheet"[^>]+href="\.\/([^"]+)"[^>]*>/);
if (!scriptMatch || !styleMatch) throw new Error("Unable to identify Vite assets");

const [javascript, css, bundleText] = await Promise.all([
  readFile(`dist/${scriptMatch[1]}`, "utf8"),
  readFile(`dist/${styleMatch[1]}`, "utf8"),
  readFile("public/data/research-bundle.json", "utf8"),
]);
const inlineBundle = JSON.stringify(JSON.parse(bundleText)).replaceAll("</", "<\\/");
html = html
  .replace(styleMatch[0], () => `<style>${css}</style>`)
  .replace(scriptMatch[0], () => `<script>window.__RESEARCH_BUNDLE__=${inlineBundle};</script><script type="module">${javascript}</script>`)
  .replace(/<link rel="manifest"[^>]*>/g, "");
const encodedHtml = Buffer.from(html, "utf8").toString("base64");

await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await writeFile("dist/server/index.js", `const encodedHtml = ${JSON.stringify(encodedHtml)};
function decodeHtml() {
  const binary = atob(encodedHtml);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/" || pathname === "/index.html") {
      return new Response(decodeHtml(), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    }
    return new Response("Not found", { status: 404 });
  }
};
`, "utf8");
