import { Chunk, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect";
import { describe, it, expect } from "vitest";

import * as Event from "../src/event/index.js";
import * as Runtime from "../src/runtime/index.js";
import * as Service from "../src/service/index.js";

interface ClockShape { readonly now: () => number }
const Clock = Service.define<ClockShape>("Clock");
const ClockLive = Service.layerSync(Clock, () => ({ now: () => 99 }));

describe("Runtime", () => {
  it("executes an effect against the built service graph", async () => {
    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(() => Runtime.make(ClockLive)),
      Effect.andThen((runtime) => Effect.promise(() => Runtime.run(runtime, Effect.map(Clock, (c) => c.now()))))
    )));

    expect(result).toBe(99);
  });

  it("feeds its own event bus into the layer's requirements and keeps it reachable", async () => {
    interface NotifierShape {
      readonly notify: (n: number) => Effect.Effect<void>
    }

    const Ping = Event.define("Ping", Schema.Struct({ n: Schema.Number }));
    const Notifier = Service.define<NotifierShape>("Notifier");

    // The layer declares EventBusShape as an INPUT requirement; Runtime.make
    // satisfies it with the runtime's own bus (provide), and the same bus stays
    // in the built context (merge), so Event.subscribe works through the runtime.
    const NotifierLive: Layer.Layer<NotifierShape, never, Event.EventBusShape> = Layer.effect(
      Notifier,
      Effect.map(Effect.context<Event.EventBusShape>(), (bus) => ({
        notify: (n: number) => Event.publish(Ping, { n }).pipe(Effect.provide(bus)),
      }))
    );

    const events = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind('runtime', () => Runtime.make(NotifierLive)),
      Effect.let('fiber', ({ runtime }) => Runtime.runFork(runtime, Stream.runCollect(Stream.take(Event.subscribe(Ping), 1)))),
      Effect.andThen(({ runtime, fiber }) => Effect.Do.pipe(
        Effect.andThen(Effect.sleep('1 millis')),
        Effect.andThen(Effect.promise(() => Runtime.run(runtime, Effect.flatMap(Notifier, (n) => n.notify(7))))),
        Effect.andThen(Fiber.join(fiber))
      ))
    )));

    expect(Array.from(Chunk.toReadonlyArray(events))).toEqual([{ n: 7 }]);
  });

  it("interrupting a runFork fiber stops the running effect and runs its finalizer", async () => {
    let cleaned = false;

    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(Runtime.make(ClockLive)),
      Effect.map((runtime) => Runtime.runFork(
        runtime,
        Effect.acquireUseRelease(
          Effect.succeed("held"),
          () => Effect.never,
          () => Effect.sync(() => { cleaned = true; })
        )
      )),
      Effect.andThen((fiber) => Effect.Do.pipe(
        Effect.andThen(Effect.sleep('10 millis')),
        Effect.andThen(Fiber.interrupt(fiber)),
        Effect.map(() => cleaned)
      ))
    )));

    expect(result).toBe(true);
  });

  it("shutdown releases resources acquired through the service graph", async () => {
    interface HeldShape { readonly held: boolean }

    let released = false;

    const Held = Service.define<HeldShape>("Held");
    const HeldLive = Layer.scoped(
      Held,
      Effect.acquireRelease(Effect.succeed({ held: true }), () => Effect.sync(() => { released = true; }))
    );

    await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.andThen(Runtime.make(HeldLive)),
      Effect.andThen(Runtime.shutdown)
    )));

    expect(released).toBe(true);
  });

  it("reports a typed RuntimeInitError when the layer fails to build", async () => {
    interface BrokenShape { readonly x: number }
    const Broken = Service.define<BrokenShape>("Broken");
    const BrokenLive = Layer.effect(Broken, Effect.fail("boom" as const));

    const exit = await Effect.runPromiseExit(
      Effect.scoped(Runtime.make(BrokenLive as unknown as Layer.Layer<BrokenShape, unknown, never>))
    );

    expect(exit).is.satisfies(Exit.isFailure);
  });
});
