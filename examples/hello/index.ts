import { Effect, Schema } from "effect";
import * as Nexus from "../../src/index.js";

// The smallest runnable app: one State, one Command, no Service, Layer or Resource.
const Counter = Schema.Struct({ count: Schema.Number });

export const hello = Effect.Do.pipe(
  Effect.bind("counter", () => Nexus.State.create(Counter, { count: 0 })),
  Effect.bind("running", () => Nexus.Application.start(Nexus.Application.define({ name: "hello" }))),
  Effect.bind("increment", ({ counter }) => Effect.succeed(
    Nexus.Command.define("counter.increment", Schema.Struct({ by: Schema.Number }), ({ by }) =>
      Nexus.State.update(counter, (s) => Effect.succeed({ count: s.count + by })))
  )),
  Effect.tap(({ running, increment }) => Effect.promise(() => Nexus.Runtime.run(running.runtime, Nexus.Command.invoke(increment, { by: 2 })))),
  Effect.andThen(({ counter }) => Nexus.State.get(counter))
);
