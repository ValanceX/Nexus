import { describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

// v0.6 G3: the runtime values of the nine primitive namespaces, as released in
// v0.5.0. v0.6 adds only types (Application.Platform, Application.StartOptions),
// so none of these change.
const expected = {
  Application: ["createState", "define", "shutdown", "start", "status"],
  Runtime: ["Refusal", "isRefusal", "make", "refusalOf", "run", "runFork"],
  Service: ["define", "layer", "layerSync"],
  State: ["create", "get", "set", "update"],
  Selector: ["combine", "define"],
  Command: ["define", "invoke"],
  Capability: ["Environment", "EnvironmentLive", "define", "require", "resolve"],
  Resource: ["acquire"],
  Event: ["EventBusLive", "define", "publish", "subscribe"],
} as const;

describe("Exports: the primitive namespaces' runtime values (v0.6 G3)", () => {
  for (const [name, keys] of Object.entries(expected)) {
    it(`${name} exports exactly ${keys.join(", ")}`, () => {
      expect(Object.keys(Nexus[name as keyof typeof expected]).sort()).toEqual([...keys]);
    });
  }
});
