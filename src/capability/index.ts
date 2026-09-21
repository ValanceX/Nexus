import { Context, Effect, Layer } from "effect";

export interface Capability<Shape> {
  readonly id: string;
  readonly tag: Context.Tag<Shape, Shape>;
}

export const define = <Shape>(id: string): Capability<Shape> => ({
  id,
  tag: Context.GenericTag<Shape>(id),
});

export type CapabilitySource = "native" | "browser" | "remote" | "fallback";

export type CapabilityResolution<Shape> =
  | { readonly _tag: "Available"; readonly implementation: Shape; readonly source: CapabilitySource }
  | { readonly _tag: "Unavailable"; readonly reason: string };

export type CapabilityUnavailableError = {
  readonly _tag: "CapabilityUnavailableError";
  readonly id: string;
  readonly reason: string;
};

export interface EnvironmentShape {
  readonly resolutions: ReadonlyMap<string, CapabilityResolution<unknown>>;
}

export const Environment = Context.GenericTag<EnvironmentShape>("nexus/Environment");

export const EnvironmentLive = (resolutions: ReadonlyMap<string, CapabilityResolution<unknown>>): Layer.Layer<EnvironmentShape> => Layer.succeed(Environment, { resolutions });

export const resolve = <Shape>(capability: Capability<Shape>): Effect.Effect<CapabilityResolution<Shape>, never, EnvironmentShape> => Effect.map(Environment, (env) => {
  const found = env.resolutions.get(capability.id);

  return (found ?? { _tag: "Unavailable", reason: `no resolution registered for '${capability.id}'` }) as CapabilityResolution<Shape>;
});

export const require = <Shape>(capability: Capability<Shape>): Effect.Effect<Shape, CapabilityUnavailableError, EnvironmentShape> => Effect.flatMap(resolve(capability), (resolution) =>
  resolution._tag === "Available"
    ? Effect.succeed(resolution.implementation)
    : Effect.fail({ _tag: "CapabilityUnavailableError", id: capability.id, reason: resolution.reason })
);
