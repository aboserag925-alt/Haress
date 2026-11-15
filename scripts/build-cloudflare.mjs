import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const runtimeConfig = 'window.AHL_API_BASE_URL = "";\n';

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of ["index.html", "app", "assets", "screens"]) {
  try {
    await stat(resolve(root, entry));
  } catch (error) {
    if (error.code === "ENOENT" && entry === "screens") continue;
    throw error;
  }
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}

await writeFile(resolve(output, "runtime-config.js"), runtimeConfig, "utf8");
await writeFile(resolve(output, "app", "runtime-config.js"), runtimeConfig, "utf8");
console.log("Cloudflare static package created in dist/; API calls use the same-origin Worker proxy.");
