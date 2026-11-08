/**
 * Minify the emitted JavaScript in dist/ in place.
 *
 * tsc produces readable ESM in dist/; this pass runs esbuild over each .js
 * file to shrink the published bundle. We minify in place (same paths) so the
 * package.json "exports"/"bin" entries keep pointing at valid files, and we
 * leave the .d.ts type declarations untouched.
 *
 * Shebang preservation: esbuild keeps a leading "#!" line, so dist/server/cli.js
 * stays executable as a bin.
 */

import { build } from "esbuild";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const DIST = new URL("../dist/", import.meta.url).pathname;

/** Recursively collect every .js file under a directory. */
async function collectJs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJs(full)));
    } else if (entry.name.endsWith(".js")) {
      files.push(full);
    }
  }
  return files;
}

const files = await collectJs(DIST);
if (files.length === 0) {
  console.error("minify: no .js files found in dist/ — did tsc run?");
  process.exit(1);
}

await build({
  entryPoints: files,
  outdir: DIST,
  // Overwrite each file in place with its minified version.
  allowOverwrite: true,
  minify: true,
  format: "esm",
  platform: "node",
  // Do not bundle: keep the module graph and import specifiers intact so the
  // files still resolve against node_modules and each other at runtime.
  bundle: false,
  logLevel: "warning",
});

console.error(`minify: minified ${files.length} file(s) in dist/`);
