import type { ParseResult } from "effect";
import { Effect, Schema } from "effect";

// `Encoded` is the raw shape the input schema decodes from; it defaults to
// `Input`, so `Command<I, O, E, R>` still means a non-transforming schema.
export interface Command<Input, Output, Err, R, Encoded = Input> {
  readonly name: string;
  readonly input: Schema.Schema<Input, Encoded>;
  readonly handler: (input: Input) => Effect.Effect<Output, Err, R>;
}

export type CommandValidationError = {
  readonly _tag: "CommandValidationError";
  readonly command: string;
  readonly issues: ReadonlyArray<string>;
  // The structured parse error that `issues` was flattened from.
  readonly cause: ParseResult.ParseError;
};

export const define = <Input, Output, Err, R, Encoded = Input>(name: string, input: Schema.Schema<Input, Encoded>, handler: (input: Input) => Effect.Effect<Output, Err, R>): Command<Input, Output, Err, R, Encoded> => ({
  name, input, handler
});

export const invoke = <Input, Output, Err, R, Encoded = Input>(command: Command<Input, Output, Err, R, Encoded>, rawInput: unknown): Effect.Effect<Output, Err | CommandValidationError, R> => Schema
  .decodeUnknown(command.input)(rawInput)
  .pipe(
    Effect.mapError((error): CommandValidationError => ({
      _tag: "CommandValidationError",
      command: command.name,
      issues: [String(error)],
      cause: error,
    })),
    Effect.flatMap(command.handler)
  );
