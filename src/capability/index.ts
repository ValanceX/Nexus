import { Context, Effect, Layer, Option } from "effect";

declare const CapabilityTypeId: unique symbol;

/**
 * An application capability (v0.6 D37): a NEXUS identity and a typed contract.
 * Its implementation is supplied by the platform, through Environment, by `id`.
 * The phantom member carries `Shape` for inference (and makes it invariant); it
 * is declared, never assigned.
 */
export interface Capability<Shape> {
  readonly id: string;
  readonly [CapabilityTypeId]?: (_: Shape) => Shape;
}

export const define = <Shape>(id: string): Capability<Shape> => ({ id });

// v0.6 D32/D33: NEXUS names no execution environment and assigns no meaning to
// how an implementation was produced. A platform may label its own
// implementations internally; NEXUS neither reads nor exposes such labels.
export type CapabilityResolution<Shape> =
  | { readonly _tag: "Available"; readonly implementation: Shape }
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

export const resolve = <Shape>(capability: Capability<Shape>): Effect.Effect<CapabilityResolution<Shape>, never, EnvironmentShape> => Effect.map(Environment, (env) => Option.Do.pipe(
  Option.andThen(() => Option.fromNullable(env.resolutions.get(capability.id))),
  Option.getOrElse(() => ({ _tag: "Unavailable", reason: `no resolution registered for '${capability.id}'` }))
) as CapabilityResolution<Shape>);

export const require = <Shape>(capability: Capability<Shape>): Effect.Effect<Shape, CapabilityUnavailableError, EnvironmentShape> => Effect.flatMap(resolve(capability), (resolution) =>
  resolution._tag === "Available"
    ? Effect.succeed(resolution.implementation)
    : Effect.fail({ _tag: "CapabilityUnavailableError", id: capability.id, reason: resolution.reason })
);
