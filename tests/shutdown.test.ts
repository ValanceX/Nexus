// How a runtime ends the work started with `run` and `runFork` (docs/primitives/runtime.md, "Termination"): after new work is refused and the bus is closed, termination waits up to a
// grace for the work to finish on its own (never less than one turn of the event loop), then interrupts what is left and waits for it to exit, and only then releases resources.
import { Cause, Duration, Effect, Exit, Fiber, Layer, Ref, Schema, Scope, Stream } from "effect";
import { describe, expect, it } from "vitest";

import * as Nexus from "../src/index.js";

const { Application, Runtime } = Nexus;

/** A layer whose resource logs its release. */
const logged = (log: Array<string>) => Layer.scopedDiscard(Effect.addFinalizer(() => Effect.sync(() => { log.push("released"); })));

/** An effect that takes `ms` to finish, logging how it ended. */
const slow = (log: Array<string>, ms: number) => Effect.sleep(Duration.millis(ms)).pipe(
  Effect.andThen(Effect.sync(() => { log.push("finished"); })),
  Effect.onInterrupt(() => Effect.sync(() => { log.push("interrupted"); }))
);

const start = (log: Array<string>, shutdown?: Nexus.Runtime.ShutdownOptions) => Application.start(
  Application.define({ name: "shutdown", runtime: logged(log) as Layer.Layer<never, unknown, Nexus.Application.ApplicationAmbient> }),
  shutdown === undefined ? undefined : { shutdown }
);

describe("shutdown: the work a runtime started", () => {
  it("is interrupted by default, and has exited before anything it uses is released", async () => {
    const log: Array<string> = [];
    const rejected = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));
      const work = Runtime.run(running.runtime, slow(log, 5000)).then(() => "resolved", () => "rejected");

      yield* Effect.sleep(5);
      yield* Application.shutdown(running);
      log.push("shut down");

      return yield* Effect.promise(() => work);
    }));

    expect(log).toEqual(["interrupted", "released", "shut down"]);
    expect(rejected).toBe("rejected");
  });

  it("is waited for within the grace, and finishes normally", async () => {
    const log: Array<string> = [];
    const result = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));
      const work = Runtime.run(running.runtime, slow(log, 30).pipe(Effect.as("done")));

      yield* Effect.sleep(5);
      yield* Application.shutdown(running, { grace: "1 second" });

      return yield* Effect.promise(() => work);
    }));

    expect(log).toEqual(["finished", "released"]);
    expect(result).toBe("done");
  });

  it("is interrupted when the grace runs out, and shutdown takes about the grace", async () => {
    const log: Array<string> = [];
    const took = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));

      Runtime.runFork(running.runtime, slow(log, 5000));
      yield* Effect.sleep(5);

      const before = Date.now();

      yield* Application.shutdown(running, { grace: "60 millis" });

      return Date.now() - before;
    }));

    expect(log).toEqual(["interrupted", "released"]);
    expect(took).toBeGreaterThanOrEqual(55);
    expect(took).toBeLessThan(1000);
  });

  it("is waited for as long as it takes with an infinite grace", async () => {
    const log: Array<string> = [];

    await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));

      Runtime.runFork(running.runtime, slow(log, 80));
      yield* Effect.sleep(5);
      yield* Application.shutdown(running, { grace: Duration.infinity });
    }));

    expect(log).toEqual(["finished", "released"]);
  });

  it("cannot start more work during the grace: it is refused as a defect with the code `terminating`", async () => {
    const log: Array<string> = [];
    const refused = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));

      Runtime.runFork(running.runtime, slow(log, 100));
      yield* Effect.sleep(5);

      const shutting = yield* Effect.fork(Application.shutdown(running, { grace: "1 second" }));

      yield* Effect.sleep(20);

      const late = yield* Effect.promise(() => Runtime.run(running.runtime, Effect.void).then(() => undefined, (error: unknown) => error));

      yield* Fiber.join(shutting);

      return late;
    }));

    expect(Runtime.refusalOf(refused)?.code).toBe("terminating");
  });

  it("is told apart from a refusal: an interrupted run is an interruption, not a bug and not a refusal", async () => {
    const log: Array<string> = [];
    const exit = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));
      const fiber = Runtime.runFork(running.runtime, slow(log, 5000));

      yield* Effect.sleep(5);
      yield* Application.shutdown(running);

      return yield* Fiber.await(fiber);
    }));

    expect(Exit.isFailure(exit) && Cause.isInterruptedOnly(exit.cause)).toBe(true);
    expect(Exit.isFailure(exit) && Runtime.refusalOf(exit.cause)).toBeFalsy();
  });

  it("honors the grace given to `start` when the start scope closes", async () => {
    const log: Array<string> = [];

    await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log, { grace: "1 second" }).pipe(Scope.extend(scope));

      Runtime.runFork(running.runtime, slow(log, 30));
      yield* Effect.sleep(5);
      yield* Scope.close(scope, Exit.void);
    }));

    expect(log).toEqual(["finished", "released"]);
  });

  it("lets a call to `shutdown` replace the grace given to `start`", async () => {
    const log: Array<string> = [];

    await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log, { grace: "1 second" }).pipe(Scope.extend(scope));

      Runtime.runFork(running.runtime, slow(log, 5000));
      yield* Effect.sleep(5);
      yield* Application.shutdown(running, { grace: 0 });
    }));

    expect(log).toEqual(["interrupted", "released"]);
  });

  it("is not waited for if it is the effect asking for the shutdown: a command may end its own application", async () => {
    const log: Array<string> = [];
    const outcome = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));

      return yield* Effect.promise(() => Runtime.run(running.runtime, Application.shutdown(running).pipe(Effect.andThen(Effect.sync(() => { log.push("command done"); })))).then(() => "resolved", () => "rejected"));
    }));

    expect(outcome).toBe("resolved");
    expect(log).toEqual(["released", "command done"]);
  });

  it("ends the streams of application-owned State when termination begins to wind down, so a consumer ends normally instead of being interrupted", async () => {
    const log: Array<string> = [];
    const Counter = Schema.Struct({ count: Schema.Number });
    const exit = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));
      const counter = yield* Application.createState(running, Counter, { count: 0 });
      const consumer = Runtime.runFork(running.runtime, Stream.runCollect(counter.changes));

      yield* Effect.sleep(5);
      yield* Nexus.State.set(counter, { count: 1 });
      yield* Application.shutdown(running);

      return yield* Fiber.await(consumer);
    }));

    expect(Exit.isSuccess(exit) && Array.from(exit.value)).toEqual([{ count: 1 }]);
  });

  it("does not wait for work that has exited: a runtime that ran fifty effects shuts down at once", async () => {
    const log: Array<string> = [];
    const settled = await Effect.runPromise(Effect.gen(function* () {
      const scope = yield* Scope.make();
      const running = yield* start(log).pipe(Scope.extend(scope));
      const done = yield* Ref.make(0);

      for (let n = 0; n < 50; n += 1) {
        yield* Effect.promise(() => Runtime.run(running.runtime, Ref.update(done, (count) => count + 1)));
      }

      const before = Date.now();

      yield* Application.shutdown(running);

      return { count: yield* Ref.get(done), took: Date.now() - before };
    }));

    expect(settled.count).toBe(50);
    expect(settled.took).toBeLessThan(500);
  });
});
