// Spec test 9: the import boundary between NEXUS core, the MESH adapter and
// @valancex/mesh-runtime (spec §5.1, M4). A static check: it reads source
// text and never loads the MESH runtime.
//
//           NEXUS core            src/<primitive>/
//               ▲ imports
//         MESH adapter            src/mesh/
//               │ imports
//               ▼
//   @valancex/mesh-runtime
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const meshDir = join(src, "mesh");
const entry = join(src, "index.ts");

const primitives = ["application", "capability", "command", "event", "resource", "runtime", "selector", "service", "state"];

// Static `import … from "x"` and `export … from "x"`, side-effect `import "x"`,
// and dynamic `import("x")`. `[^;]*?` lets a clause span lines.
const patterns = [
  /\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const specifiersOf = (file: string): ReadonlyArray<string> => {
  const text = readFileSync(file, "utf8");

  return patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), (match) => match[1] ?? ""));
};

const isInside = (dir: string, path: string) => path === dir || path.startsWith(dir + sep);

// Where a relative specifier points, as a source path; bare specifiers stay as they are.
const target = (file: string, specifier: string) => specifier.startsWith(".") ? resolve(dirname(file), specifier) : specifier;

const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".ts"))
  .map((path) => join(src, path));

const core = sources.filter((file) => file !== entry && !isInside(meshDir, file));
const adapter = sources.filter((file) => isInside(meshDir, file));

const violations = (files: ReadonlyArray<string>, forbidden: (file: string, specifier: string) => boolean) => files.flatMap((file) =>
  specifiersOf(file)
    .filter((specifier) => forbidden(file, specifier))
    .map((specifier) => `${relative(src, file)} imports "${specifier}"`)
);

describe("Architecture: the MESH import boundary (spec test 9)", () => {
  it("finds the source it checks", () => {
    // Guards against a vacuous pass: a broken walk or pattern would otherwise find nothing to reject.
    for (const primitive of primitives) {
      expect(core).toContain(join(src, primitive, "index.ts"));
    }

    expect(specifiersOf(join(meshDir, "index.ts"))).toContain("@valancex/mesh-runtime");
    expect(specifiersOf(join(src, "state", "index.ts"))).toContain("effect");
  });

  it("keeps NEXUS core independent of the adapter and of every MESH package", () => {
    expect(violations(core, (file, specifier) =>
      isInside(meshDir, target(file, specifier)) || specifier.startsWith("@valancex/mesh-")
    )).toEqual([]);
  });

  it("lets the package entry reach MESH only through the adapter's index", () => {
    expect(violations([entry], (file, specifier) =>
      (isInside(meshDir, target(file, specifier)) && specifier !== "./mesh/index.js") || specifier.startsWith("@valancex/mesh-")
    )).toEqual([]);
  });

  it("keeps the adapter off the MESH compiler (M4)", () => {
    expect(violations(adapter, (_file, specifier) => specifier.startsWith("@valancex/mesh-compiler"))).toEqual([]);
  });
});
