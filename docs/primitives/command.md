# Command

> **In plain terms:** "Please do this." A command is a named, typed action. When the UI sends `on.select={selectUser($event)}`, this is what runs. Input is validated before your code sees it.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §9. A `Command` represents
an application action — "the application should perform this operation."
It is the primary boundary through which MESH reaches NEXUS: a MESH command
intent reaches a command only through an explicit binding in the MESH host
adapter (§15). It is a NEXUS-owned primitive, not something external that
calls into NEXUS (§9's clarified diagram).

## Responsibility

- Give MPRX-originated intent (`on.select={selectUser($event)}`) exactly
  one typed entry point into application behavior.
- Validate input before any handler code runs.
- Let handlers read/modify `State`, call `Service`s, use `Capability`s,
  acquire `Resource`s, and emit `Event`s — the full application surface —
  while staying invisible to rendering concerns.

## Data Model

```ts
interface Command<Input, Output, Err, R> {
  readonly name: string;
  readonly input: Schema.Schema<Input>;
  readonly handler: (input: Input) => Effect.Effect<Output, Err, R>;
}
```

`name` is a stable, namespaced string (`"users.select"`, `"order.submit"`).
It is the command's identity in diagnostics (`CommandValidationError.command`)
and for any future record of "which commands ran", so keep it stable. MESH
doesn't key off it: an adapter binding takes the `Command` value itself,
and MESH intents are matched by their `component/name` in the binding table.

## API

```ts
namespace Command {
  function define<Input, Output, Err, R>(name: string,input: Schema.Schema<Input>, handler: (input: Input) => Effect.Effect<Output, Err, R>): Command<Input, Output, Err, R>;
  function invoke<Input, Output, Err, R>(command: Command<Input, Output, Err, R>, rawInput: unknown): Effect.Effect<Output, Err | CommandValidationError, R>;
}
```

`invoke` — not `handler` directly — is what the MESH host adapter's bindings
and tests call. It takes `unknown` deliberately: the whole point of a command
boundary (§9, §15) is that input arriving from outside NEXUS (an MPRX
event payload) is untrusted until `input` has decoded it. Calling
`command.handler(x)` directly bypasses that decode step, so application
code that already has a validated `Input` in hand should still prefer
`invoke` unless it has a specific reason not to pay the (cheap) redundant
decode.

## Errors

```ts
type CommandValidationError = {
  readonly _tag: "CommandValidationError";
  readonly command: string;
  readonly issues: ReadonlyArray<string>;
};
```

`invoke`'s error channel is `Err | CommandValidationError` — the command's
own typed failures are never conflated with "the input didn't match the
schema." A caller (the MESH adapter, a test) can always tell input rejection
apart from a domain failure by matching on `_tag`. `issues` are
human-readable messages describing why the input failed its schema.

## Rules

- A command handler must not render UI, manipulate DOM, invoke hardware
  APIs directly, or contain renderer-specific branches — those cross the
  PORT boundary NEXUS has no dependency on (§16).
- `invoke` must run schema decoding before the handler observes anything —
  a handler never sees a partially-invalid `Input`.
- Command names should be unique within an application, by convention.
  NEXUS doesn't enforce it: commands are plain values, and there is no
  command registry to check them against.
- Commands are the *only* thing MESH can reach (§15), and only through an
  explicit adapter binding. MESH must never be handed a `Service` tag or a
  `StateHandle`'s `update` directly.

## Example

```ts
const selectUser = Command.define(
  "users.select",
  Schema.Struct({ userId: UserId }),
  ({ userId }) => State.update(usersState, (s) =>  Effect.succeed({ ...s, selectedUser: Option.some(userId) }))
);

// In the MESH host adapter, the input is translated from command-intent
// arguments by an explicit binding; invoke validates it:
const binding = Mesh.bind(selectUser, (args) => ({ userId: (args[0] as { value: { id: string } }).value.id }));
```

## Testing

Covers §20 "Command": input validation (malformed `rawInput` yields
`CommandValidationError`, handler never runs), execution (valid input
reaches the handler and produces the expected `Output`), typed failures
(`Err` surfaces distinctly from `CommandValidationError`), and state/
service interaction (a command that updates `State` or calls a `Service`
does so correctly and via those primitives' own contracts, not by
reaching around them).
