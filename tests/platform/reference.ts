import type { Clock } from "effect";

import { Layer } from "effect";

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

  return options.clock === undefined ? environment : Layer.merge(environment, Layer.setClock(options.clock));
};
