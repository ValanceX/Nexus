import { Effect } from "effect";
import { expect, it } from "vitest";

import { hello } from "./index.js";

it("the hello example runs with no service, layer or resource", async () => {
  expect(await Effect.runPromise(Effect.scoped(hello))).toEqual({ count: 2 });
});
