import { describe, it, expect } from "vitest";
import { Effect, Option, Schema } from "effect";
import * as Command from "../src/command/index.js";
import * as State from "../src/state/index.js";

const SelectInput = Schema.Struct({ userId: Schema.String });

describe("Command", () => {
  it("rejects malformed input before the handler runs", async () => {
    let handlerRan = false;
    const cmd = Command.define("users.select", SelectInput, () => {
      handlerRan = true;
      return Effect.succeed("ran" as const);
    });

    const exit = await Effect.runPromiseExit(Command.invoke(cmd, { userId: 42 }));
    expect(exit._tag).toBe("Failure");
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
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const users = yield* State.create(UserState, { selectedUser: Option.none() });
          const selectUser = Command.define("users.select", SelectInput, ({ userId }) =>
            State.update(users, (s) => Effect.succeed({ ...s, selectedUser: Option.some(userId) }))
          );
          yield* Command.invoke(selectUser, { userId: "u1" });
          return yield* State.get(users);
        })
      )
    );
    expect(result).toEqual({ selectedUser: Option.some("u1") });
  });
});
