import { createRequire } from "node:module";
import { expect, it } from "vitest";

// A tool (a version check, a peer-range audit) reads a package's manifest through `<name>/package.json`; the exports map must let it.
it("the package manifest is exported", () => {
  const manifest = JSON.parse(JSON.stringify(createRequire(import.meta.url)("../package.json"))) as { version: string; exports: Record<string, unknown> };

  expect(manifest.exports["./package.json"]).toBe("./package.json");
  expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
});
