import type { Scope } from "effect";

import { Clock, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

const fixed = (n: number): Clock.Clock => ({ ...Clock.make(), currentTimeMillis: Effect.succeed(n), unsafeCurrentTimeMillis: () => n });

// Starts an application, reads Clock.currentTimeMillis through Runtime.run on its
// runtime, and shuts it down.
const readClock = <R>(start: Effect.Effect<Nexus.Application.RunningApplication<R>, Nexus.Application.ApplicationInitError, Scope.Scope>): Promise<number> =>
  Effect.runPromise(Effect.scoped(start.pipe(
    Effect.andThen((running) => Effect.promise(() => Nexus.Runtime.run(running.runtime, Clock.currentTimeMillis)))
  )));

// D38/D39: NEXUS names no default service; the precedence is Effect's. These
// pin today's routes (audit E2), so that any change to them is deliberate.
describe("Default services: Effect's precedence, characterized (v0.6 D39)", () => {
  it("the caller's Clock reaches the application runtime", async () => {
    const app = Nexus.Application.define({ name: "caller-clock", runtime: Layer.empty });

    expect(await readClock(Effect.withClock(Nexus.Application.start(app), fixed(1)))).toBe(1);
  });

  it("an application-layer Clock wins over the caller's", async () => {
    const app = Nexus.Application.define({ name: "app-clock", runtime: Layer.setClock(fixed(3)) });

    expect(await readClock(Effect.withClock(Nexus.Application.start(app), fixed(1)))).toBe(3);
  });
});
