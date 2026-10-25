import { Effect } from "effect";
import { expect, it } from "vitest";

import * as Nexus from "../src/index.js";

// T1.1: a runtime needs no layer when the application has no services yet.
it("Runtime.make with no layer builds a runnable runtime", async () => {
  const result = await Effect.runPromise(Effect.scoped(Nexus.Runtime.make().pipe(
    Effect.flatMap((runtime) => Effect.promise(() => Nexus.Runtime.run(runtime, Effect.succeed(7))))
  )));

  expect(result).toBe(7);
});

// T1.2: an application with no services omits `runtime`; the stored record still has it.
it("Application.define without runtime stores an empty runtime layer and starts", async () => {
  const app = Nexus.Application.define({ name: "bare" });

  expect(app.definition.runtime).toBeDefined();

  const status = await Effect.runPromise(Effect.scoped(Nexus.Application.start(app).pipe(
    Effect.flatMap((running) => running.status)
  )));

  expect(status._tag).toBe("Running");
});
