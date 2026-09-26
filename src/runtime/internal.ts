// Runtime internals. Not re-exported by src/index.ts: nothing here is public.
import { Effect, Exit, Runtime as EffectRuntime, Scope } from "effect";

declare const NexusRuntimeTypeId: unique symbol;

/**
 * An opaque execution handle (N3). It carries no readable member: the Effect
 * runtime, the service Context and the runtime's Scope stay in the module-private
 * registry below, reachable only by the functions that execute through a handle.
 * Contravariant in R, like Effect's own Runtime<in R>, so call sites infer as before.
 */
export interface NexusRuntime<in R> {
  readonly [NexusRuntimeTypeId]: (_: R) => void;
}

export interface RuntimeRecord {
  readonly runtime: EffectRuntime.Runtime<never>;
  readonly scope: Scope.CloseableScope;
}

const records = new WeakMap<object, RuntimeRecord>();

export const register = <R>(record: RuntimeRecord): NexusRuntime<R> => {
  const handle: object = Object.freeze(Object.create(null));

  records.set(handle, record);

  return handle as NexusRuntime<R>;
};

export const recordOf = (handle: NexusRuntime<never>): RuntimeRecord | undefined => records.get(handle);

export const scopeOf = (handle: NexusRuntime<never>): Scope.Scope | undefined => recordOf(handle)?.scope;

/** The one defect value for lifecycle and handle misuse. Deliberately not a public error type. */
export const refusal = (reason: string): Error => new Error(`NEXUS: ${reason}`);

/** Ends a runtime: closes its scope, releasing everything its service graph acquired. */
export const terminate = (handle: NexusRuntime<never>): Effect.Effect<void> => {
  const record = recordOf(handle);

  return record === undefined ? Effect.void : Scope.close(record.scope, Exit.void);
};
