import { UserState, UserRepository, UserRepositoryLive, UserSelected, buildApp, released } from "../examples/basic-app/index.js";
import { Chunk, Effect, Fiber, Option, Stream } from "effect";
import { describe, it, expect } from "vitest";

import * as Command from "../src/command/index.js";
import * as Nexus from "../src/index.js";

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

      // Resolve the service out of the RUNNING application's own graph and call
      // it — this fails if the Layer was never actually built into the runtime.
      const users = yield* Effect.promise(() =>
        Nexus.Runtime.run(running.runtime, Effect.flatMap(UserRepository, (repo) => repo.listUsers()))
      );

      if (users.length === 2) {
        log.push("user service registered");
      }

      const stateBefore = yield* Nexus.State.get(usersState);

      if (stateBefore.users.length === 0 && Option.isNone(stateBefore.selectedUser)) {
        log.push("user state initialized");
      }

      // Subscribe on the APPLICATION'S OWN event bus (reachable through
      // running.runtime now that Runtime.make provide-merges EventBusLive).
      const eventFiber = Nexus.Runtime.runFork(
        running.runtime,
        Stream.runCollect(Stream.take(Nexus.Event.subscribe(UserSelected), 1))
      );
      yield* Effect.sleep("1 millis");

      // The command's handler publishes UserSelected, so it requires the bus —
      // running it through running.runtime is what satisfies that requirement.
      yield* Effect.promise(() => Nexus.Runtime.run(running.runtime, Command.invoke(selectUser, { userId: "u1" })));
      log.push("command executed");

      const stateAfter = yield* Nexus.State.get(usersState);
      log.push("state updated");

      const derived = yield* selectedUser.value;
      log.push("selector derives new value");

      const events = yield* Fiber.join(eventFiber);
      log.push("event emitted");

      yield* Nexus.Application.shutdown(running);
      const finalStatus = yield* Nexus.Application.status(running);
      log.push("application shuts down");

      return { users, stateAfter, derived, events: Array.from(Chunk.toReadonlyArray(events)), finalStatus };
    });

    const result = await Effect.runPromise(Effect.scoped(program));

    expect(result.users).toEqual([{ id: "u1", name: "Ada" }, { id: "u2", name: "Grace" }]);
    expect(result.stateAfter.selectedUser).toEqual(Option.some("u1"));
    expect(result.derived).toEqual(Option.some("u1"));
    expect(result.events).toEqual([{ userId: "u1" }]);
    expect(result.finalStatus).toEqual({ _tag: "Stopped" });
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
});
