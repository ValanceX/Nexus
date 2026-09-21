import { Context, Effect, Layer } from "effect";

export type Service<Shape> = Context.Tag<Shape, Shape>;

export const define = <Shape>(name: string): Service<Shape> => Context.GenericTag<Shape>(name);

export const layer = <Shape, E = never, R = never>(service: Service<Shape>, implementation: Effect.Effect<Shape, E, R>): Layer.Layer<Shape, E, R> => Layer.effect(service, implementation);

export const layerSync = <Shape>(service: Service<Shape>, implementation: () => Shape): Layer.Layer<Shape> => Layer.sync(service, implementation);
