import { Effect, Layer, Option, Schema } from "effect";
import * as Nexus from "../../src/index.js";

export const UserId = Schema.String;
export const User = Schema.Struct({ id: UserId, name: Schema.String });
export type User = Schema.Schema.Type<typeof User>;

export const UserState = Schema.Struct({
  users: Schema.Array(User),
  // NOTE: Schema.OptionFromNullOr's encoded side is `string | null | undefined`,
  // not an already-constructed Option instance, so Schema.decodeUnknown would
  // reject Option.none()/Option.some(userId) as invalid input. OptionFromSelf's
  // encoded AND decoded sides are both Option<A>, so it accepts Option values
  // directly while still performing real validation.
  selectedUser: Schema.OptionFromSelf(UserId),
});

export interface UserRepositoryShape {
  readonly listUsers: () => Effect.Effect<ReadonlyArray<User>>;
}

export const UserRepository = Nexus.Service.define<UserRepositoryShape>("UserRepository");

export const released = { value: false };

export const UserRepositoryLive = Layer.scoped(
  UserRepository,
  Nexus.Resource.acquire({
    acquire: Effect.sync((): UserRepositoryShape => ({
      listUsers: () => Effect.succeed([{ id: "u1", name: "Ada" }, { id: "u2", name: "Grace" }]),
    })),
    release: () => Effect.sync(() => { released.value = true; }),
  })
);

export const UserSelected = Nexus.Event.define("UserSelected", Schema.Struct({ userId: UserId }));

export const buildApp = (usersState: Nexus.State.StateHandle<Schema.Schema.Type<typeof UserState>>) => {
  const selectUser = Nexus.Command.define(
    "users.select",
    Schema.Struct({ userId: UserId }),
    ({ userId }) => Effect.Do.pipe(
      Effect.andThen(Nexus.State.update(usersState, (s) => Effect.succeed({ ...s, selectedUser: Option.some(userId) }))),
      Effect.andThen(Nexus.Event.publish(UserSelected, { userId }))
    )
  );

  const selectedUser = Nexus.Selector.define(usersState, (s) => s.selectedUser);

  return { selectUser, selectedUser };
};
