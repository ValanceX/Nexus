import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

// A tool (a version check, a peer-range audit) reads a package's manifest through `<name>/package.json`; the exports map must let it.
it("the package manifest is exported", () => {
  const manifest = JSON.parse(JSON.stringify(createRequire(import.meta.url)("../package.json"))) as { version: string; exports: Record<string, unknown> };

  expect(manifest.exports["./package.json"]).toBe("./package.json");
  expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
});

// A bundler keeps a module it cannot prove side-effect free, so a package that does not say so is evaluated by every consumer that imports anything from it, used or not (the
// Valance entries that only write a head or list a route table would still ship NEXUS). MESH and PORT Web say so; this says it of NEXUS, and checks the claim.
it("declares itself side-effect free, and nothing in src changes a global or the environment on import", () => {
  const manifest = JSON.parse(JSON.stringify(createRequire(import.meta.url)("../package.json"))) as { sideEffects?: unknown };
  const files = (directory: string): ReadonlyArray<string> => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []);
  const offenders = files(fileURLToPath(new URL("../src", import.meta.url)))
    .filter((file) => /\b(globalThis|process\.(env|on|exit)|window\.|document\.|addEventListener)\b/.test(readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));

  expect(manifest.sideEffects).toBe(false);
  expect(offenders).toEqual([]);
});
