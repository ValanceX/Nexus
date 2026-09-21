import { describe, it, expect } from "vitest";
import { Effect, Fiber } from "effect";
import * as Resource from "../src/resource/index.js";

describe("Resource", () => {
  it("acquires, uses, and releases in order", async () => {
    const events: Array<string> = [];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* Resource.acquire({
            acquire: Effect.sync(() => {
              events.push("acquire");
              return { id: 1 };
            }),
            release: () => Effect.sync(() => { events.push("release"); }),
          });
          events.push(`use:${handle.id}`);
        })
      )
    );

    expect(events).toEqual(["acquire", "use:1", "release"]);
  });

  it("releases even when the using effect fails", async () => {
    const events: Array<string> = [];

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Resource.acquire({
            acquire: Effect.sync(() => { events.push("acquire"); return {}; }),
            release: () => Effect.sync(() => { events.push("release"); }),
          });
          yield* Effect.fail("boom" as const);
        })
      )
    );

    expect(exit._tag).toBe("Failure");
    expect(events).toEqual(["acquire", "release"]);
  });

  it("releases when the using fiber is interrupted", async () => {
    const events: Array<string> = [];

    const program = Effect.scoped(
      Effect.gen(function* () {
        yield* Resource.acquire({
          acquire: Effect.sync(() => { events.push("acquire"); return {}; }),
          release: () => Effect.sync(() => { events.push("release"); }),
        });
        yield* Effect.never;
      })
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(program);
        yield* Effect.sleep("10 millis");
        yield* Fiber.interrupt(fiber);
      })
    );

    expect(events).toEqual(["acquire", "release"]);
  });
});
