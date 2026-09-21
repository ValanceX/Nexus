import { Effect, Schema } from "effect";

export interface Command<Input, Output, Err, R> {
  readonly name: string;
  readonly input: Schema.Schema<Input>;
  readonly handler: (input: Input) => Effect.Effect<Output, Err, R>;
}

export type CommandValidationError = {
  readonly _tag: "CommandValidationError";
  readonly command: string;
  readonly issues: ReadonlyArray<string>;
};

export const define = <Input, Output, Err, R>(
  name: string,
  input: Schema.Schema<Input>,
  handler: (input: Input) => Effect.Effect<Output, Err, R>
): Command<Input, Output, Err, R> => ({ name, input, handler });

export const invoke = <Input, Output, Err, R>(
  command: Command<Input, Output, Err, R>,
  rawInput: unknown
): Effect.Effect<Output, Err | CommandValidationError, R> =>
  Schema.decodeUnknown(command.input)(rawInput).pipe(
    Effect.mapError((error): CommandValidationError => ({
      _tag: "CommandValidationError",
      command: command.name,
      issues: [String(error)],
    })),
    Effect.flatMap(command.handler)
  );
