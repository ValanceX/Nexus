import type { StateHandle } from "../state/index.js";

import { Effect, Stream } from "effect";

export interface SelectorHandle<B> {
  readonly value: Effect.Effect<B>;
  /** Future commits only: the current value is not emitted. */
  readonly changes: Stream.Stream<B>;
  /** The current value at subscription, then every later commit, with no gap between them (`State.values`). */
  readonly values: Stream.Stream<B>;
}

export const define = <A, B>(state: StateHandle<A>, project: (a: A) => B): SelectorHandle<B> => ({
  value: Effect.map(state.get, project),
  changes: Stream.map(state.changes, project),
  values: Stream.map(state.values, project),
});

export const combine = <A, B, C>(a: SelectorHandle<A>, b: SelectorHandle<B>, project: (a: A, b: B) => C): SelectorHandle<C> => ({
  value: Effect.zipWith(a.value, b.value, project),
  changes: Stream.zipLatestWith(a.changes, b.changes, project),
  // Each side's current value is atomic with its own subscription, so the combination ends at the latest of both.
  values: Stream.zipLatestWith(a.values, b.values, project),
});
