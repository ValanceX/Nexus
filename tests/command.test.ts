import { Effect, Exit, Option, Schema } from "effect";
import { describe, it, expect } from "vitest";

import * as Command from "../src/command/index.js";
import * as Service from "../src/service/index.js";
import * as State from "../src/state/index.js";

const SelectInput = Schema.Struct({ userId: Schema.String });

describe("Command", () => {
  it("rejects malformed input before the handler runs", async () => {
    let handlerRan = false;

    const cmd = Command.define("users.select", SelectInput, () => Effect.Do.pipe(
      Effect.tap(() => void (handlerRan = true)),
      Effect.andThen(() => Effect.succeed("ran" as const))
    ));

    const exit = await Effect.runPromiseExit(Command.invoke(cmd, { userId: 42 }));

    expect(exit).is.satisfies(Exit.isFailure);
    expect(handlerRan).toBe(false);
  });

  it("runs the handler and returns its output for valid input", async () => {
    const cmd = Command.define("users.select", SelectInput, ({ userId }) =>
      Effect.succeed(`selected:${userId}`)
    );
    const result = await Effect.runPromise(Command.invoke(cmd, { userId: "u1" }));
  
    expect(result).toBe("selected:u1");
  });

  it("keeps the handler's typed failures distinct from validation failures", async () => {
    const cmd = Command.define("users.select", SelectInput, () => Effect.fail({ _tag: "NotFound" as const }));
    const error = await Effect.runPromise(Effect.flip(Command.invoke(cmd, { userId: "u1" })));

    expect(error).toEqual({ _tag: "NotFound" });
  });

  it("updates state through the command handler", async () => {
    const UserState = Schema.Struct({ selectedUser: Schema.OptionFromSelf(Schema.String) });

    const result = await Effect.runPromise(Effect.scoped(Effect.Do.pipe(
      Effect.bind('users', () => State.create(UserState, { selectedUser: Option.none() })),
      Effect.let('selectUser', ({ users }) => Command.define("users.select", SelectInput, ({ userId }) =>
        State.update(users, (s) => Effect.succeed({ ...s, selectedUser: Option.some(userId) }))
      )),
      Effect.andThen(({ users, selectUser }) => Effect.Do.pipe(
        Effect.andThen(Command.invoke(selectUser, { userId: "u1" })),
        Effect.andThen(State.get(users))
      ))
    )));

    expect(result).toEqual({ selectedUser: Option.some("u1") });
  });

  it("resolves a service from its requirements and calls it through the command handler", async () => {
    interface UserRepositoryShape {
      readonly nameOf: (userId: string) => Effect.Effect<string>;
    }

    const UserRepository = Service.define<UserRepositoryShape>("UserRepository");
    const UserRepositoryLive = Service.layerSync(UserRepository, () => ({
      nameOf: (userId: string) => Effect.succeed(`user:${userId}`),
    }));

    // The handler declares UserRepository in its R; Command.invoke keeps that
    // requirement, and the caller satisfies it with the service's Layer.
    const describeUser = Command.define("users.describe", SelectInput, ({ userId }) =>
      Effect.flatMap(UserRepository, (repo) => repo.nameOf(userId))
    );

    const result = await Effect.runPromise(Command.invoke(describeUser, { userId: "u1" }).pipe(Effect.provide(UserRepositoryLive)));

    expect(result).toBe("user:u1");
  });
});
