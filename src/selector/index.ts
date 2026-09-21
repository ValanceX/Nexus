import type { StateHandle } from "../state/index.js";

import { Effect, Stream } from "effect";

export interface SelectorHandle<B> {
  readonly value: Effect.Effect<B>;
  readonly changes: Stream.Stream<B>;
}

export const define = <A, B>(state: StateHandle<A>, project: (a: A) => B): SelectorHandle<B> => ({
  value: Effect.map(state.get, project),
  changes: Stream.map(state.changes, project),
});

export const combine = <A, B, C>(a: SelectorHandle<A>, b: SelectorHandle<B>, project: (a: A, b: B) => C): SelectorHandle<C> => ({
  value: Effect.zipWith(a.value, b.value, project),
  changes: Stream.zipLatestWith(a.changes, b.changes, project),
});
