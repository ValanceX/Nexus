import { describe, it, expect } from "vitest";
import { Effect, Exit, Fiber } from "effect";

import * as Resource from "../src/resource/index.js";

describe("Resource", () => {
  it("acquires, uses, and releases in order", async () => {
    const events: Array<string> = [];

    await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(Resource.acquire({
        acquire: Effect.Do.pipe(
          Effect.tap(() => events.push("acquire")),
          Effect.map(() => ({ id: 1 }))
        ),
        release: () => Effect.sync(() => {
          events.push("release");
        }),
      })),
      Effect.tap((handle) => events.push(`use:${handle.id}`))
    )));

    expect(events).toEqual(["acquire", "use:1", "release"]);
  });

  it("releases even when the using effect fails", async () => {
    const events: Array<string> = [];

    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(Resource.acquire({
        acquire: Effect.Do.pipe(
          Effect.tap(() => events.push('acquire')),
          Effect.map(() => ({}))
        ),
        release: () => Effect.sync(() => {
          events.push("release");
        }),
      })),
      Effect.andThen(Effect.fail('boom' as const))
    )));

    expect(exit).is.satisfies(Exit.isFailure);
    expect(events).toEqual(["acquire", "release"]);
  });

  it("releases when the using fiber is interrupted", async () => {
    const events: Array<string> = [];

    await Effect.runPromise(Effect.Do.pipe(
      Effect.map(() => Effect.scoped(Resource.acquire({
        acquire: Effect.Do.pipe(
          Effect.tap(() => events.push("acquire")),
          Effect.map(() => ({}))
        ),
        release: () => Effect.sync(() => { 
          events.push("release"); 
        }),
      }))),
      Effect.andThen(Effect.fork),
      Effect.andThen((fiber) => Effect.Do.pipe(
        Effect.andThen(Effect.sleep("10 millis")),
        Effect.andThen(Fiber.interrupt(fiber)),
      ))
    ));

    expect(events).toEqual(["acquire", "release"]);
  });
});
