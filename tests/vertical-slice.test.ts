import { describe, it, expect } from "vitest";
import { Effect, Fiber, Option, Stream } from "effect";
import * as Nexus from "../src/index.js";
import { UserState, UserRepositoryLive, UserSelected, buildApp, released } from "../examples/basic-app/index.js";
import * as Command from "../src/command/index.js";

describe("NEXUS vertical slice (§22)", () => {
  it("boots, executes a command, observes state, emits an event, and shuts down cleanly — with no MESH or PORT dependency", async () => {
    released.value = false;
    const log: Array<string> = [];

    const program = Effect.gen(function* () {
      log.push("application starts");
      const usersState = yield* Nexus.State.create(UserState, { users: [], selectedUser: Option.none() });
      const { selectUser, selectedUser } = buildApp(usersState);

      const app = Nexus.Application.define({ name: "basic-app", runtime: UserRepositoryLive });
      const running = yield* Nexus.Application.start(app);
      log.push("user service registered");
      log.push("user state initialized");

      const eventFiber = yield* Effect.fork(
        Stream.runCollect(Stream.take(Nexus.Event.subscribe(UserSelected), 1))
      );
      yield* Effect.sleep("1 millis");

      yield* Command.invoke(selectUser, { userId: "u1" });
      log.push("command executed");

      const stateAfter = yield* Nexus.State.get(usersState);
      log.push("state updated");

      const derived = yield* selectedUser.value;
      log.push("selector derives new value");

      const events = yield* Fiber.join(eventFiber);
      log.push("event emitted");

      yield* Nexus.Application.shutdown(running);
      log.push("application shuts down");

      return { stateAfter, derived, events: Array.from(events) };
    });

    const result = await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(Nexus.Event.EventBusLive)));

    expect(result.stateAfter.selectedUser).toEqual(Option.some("u1"));
    expect(result.derived).toEqual(Option.some("u1"));
    expect(result.events).toEqual([{ userId: "u1" }]);
    expect(released.value).toBe(true);
    expect(log).toEqual([
      "application starts",
      "user service registered",
      "user state initialized",
      "command executed",
      "state updated",
      "selector derives new value",
      "event emitted",
      "application shuts down",
    ]);
  });

  it("has no import of any mesh or port package anywhere under src/ or examples/", async () => {
    // Dynamic import, not require() — this repo's package.json sets "type": "module",
    // so a bare CJS require() would throw "require is not defined" at runtime here.
    const { execSync } = await import("node:child_process");
    const repoRoot = new URL("..", import.meta.url).pathname;
    const output = execSync(
      String.raw`grep -rlE "from ['\"](\.\./)*(mesh|port)/|@valence/(mesh|port)" src examples || true`,
      { cwd: repoRoot }
    ).toString();
    expect(output.trim()).toBe("");
  });
});
