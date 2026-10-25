import { readFileSync } from "node:fs";
import { Effect, Layer, Schema } from "effect";
import { expect, it } from "vitest";

// The README's "first app" runs here. Everything between the markers must appear verbatim in README.md, so the snippet cannot drift from code that compiles.
// Imports use the source tree; the README imports the same names from "@valancex/nexus".
import { Command, Runtime, State } from "../src/index.js";

// readme:start
const Counter = Schema.Struct({ count: Schema.Number });

const program = Effect.Do.pipe(
  Effect.bind("counter", () => State.create(Counter, { count: 0 })),
  Effect.bind("runtime", () => Runtime.make(Layer.empty)),
  Effect.bind("increment", ({ counter }) => Effect.succeed(
    Command.define("counter.increment", Schema.Struct({ by: Schema.Number }), ({ by }) =>
      State.update(counter, (s) => Effect.succeed({ count: s.count + by })))
  )),
  Effect.tap(({ runtime, increment }) => Effect.promise(() => Runtime.run(runtime, Command.invoke(increment, { by: 2 })))),
  Effect.andThen(({ counter }) => State.get(counter))
);

// Prints { count: 2 }
Effect.runPromise(Effect.scoped(program)).then(console.log);
// readme:end

it("the README first app runs and is the README's text", async () => {
  expect(await Effect.runPromise(Effect.scoped(program))).toEqual({ count: 2 });

  const source = readFileSync(new URL(import.meta.url), "utf8");
  const snippet = source.slice(source.indexOf("// readme:start\n") + "// readme:start\n".length, source.indexOf("// readme:end"));
  expect(readFileSync(new URL("../README.md", import.meta.url), "utf8")).toContain(snippet);
});
