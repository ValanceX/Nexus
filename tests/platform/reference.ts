import { Clock, Effect, Layer } from "effect";

import * as Nexus from "../../src/index.js";

/**
 * The v0.6 reference test platform (D41): evidence for the supply point, not a
 * product. It supplies a caller-given resolution map as host-owned values and,
 * optionally, a Clock. It does nothing else and uses no host API. It is not
 * exported from the package and is not a platform package.
 */
export const referencePlatform = (options: {
  readonly resolutions?: ReadonlyMap<string, Nexus.Capability.CapabilityResolution<unknown>>;
  readonly clock?: Clock.Clock;
} = {}): Nexus.Application.Platform => {
  const environment = Nexus.Capability.EnvironmentLive(options.resolutions ?? new Map());

  return options.clock === undefined ? environment : Layer.merge(environment, Layer.succeed(Clock.Clock, options.clock));
};

/** A Clock whose time stands still at `n` milliseconds; the rest (nanoseconds, sleep) is the live Clock's. */
export const fixedClock = (n: number): Clock.Clock => {
  const live = Clock.Clock.defaultValue();

  return {
    currentTimeMillis: Effect.succeed(n),
    currentTimeMillisUnsafe: () => n,
    currentTimeNanos: live.currentTimeNanos,
    currentTimeNanosUnsafe: () => live.currentTimeNanosUnsafe(),
    monotonicTimeNanos: live.monotonicTimeNanos,
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    sleep: (duration) => live.sleep(duration),
  };
};
