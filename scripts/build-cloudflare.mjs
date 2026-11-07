import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(root, "dist");
const publicApi = (process.env.AHL_PUBLIC_API_BASE_URL || "").trim().replace(/\\/+$/, "");
if (publicApi) {
  const parsed = new URL(publicApi);
  if (parsed.protocol !== "https:" || parsed.origin !== publicApi) {
    throw new Error("AHL_PUBLIC_API_BASE_URL must be an HTTPS origin without a path.");
  }
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of ["index.html", "app", "assets", "screens"]) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

const runtimeConfig = "window.AHL_API_BASE_URL = " + JSON.stringify(publicApi) + ";\\n";
await writeFile(resolve(output, "runtime-config.js"), runtimeConfig, "utf8");
await writeFile(resolve(output, "app", "runtime-config.js"), runtimeConfig, "utf8");
console.log("Cloudflare static package created in dist/");
