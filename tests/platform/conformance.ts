import { Effect, Layer } from "effect";

import * as Nexus from "../../src/index.js";

/**
 * v0.7 platform conformance (outline C21): **test tooling only**. It is not
 * exported from the package, not a runtime validator, and never runs during a
 * normal `Application.start`. It checks a platform author's *claim* (its
 * provision statement) against what the platform's Layer actually supplies:
 *
 * - every `provided` id must resolve `Available` on this start;
 * - every `notProvided` id must resolve `Unavailable` on this start;
 * - an id in neither list is undecided, and is never reported.
 *
 * It reads the statement's two lists only, compares ids exactly (C19, D53),
 * and reports each distinct id once, in statement order: `provided` first.
 */
export type ConformanceFailure =
  | { readonly _tag: "ProvidedButUnavailable"; readonly id: string; readonly reason: string }
  | { readonly _tag: "NotProvidedButAvailable"; readonly id: string };

export type ProvisionStatement = Pick<Nexus.Semantic.TargetProfile, "provided" | "notProvided">;

const distinct = (ids: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(ids)];

export const conformance = (platform: Nexus.Application.Platform, statement: ProvisionStatement): Promise<ReadonlyArray<ConformanceFailure>> =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const running = yield* Nexus.Application.start(Nexus.Application.define({ name: "conformance", runtime: Layer.empty }), { platform });
    // Through the public resolve path, so an id the platform doesn't mention is Unavailable exactly as the application would see it.
    const resolveId = (id: string) => Effect.promise(() => Nexus.Runtime.run(running.runtime, Nexus.Capability.resolve(Nexus.Capability.define<unknown>(id))));
    const failures: Array<ConformanceFailure> = [];

    for (const id of distinct(statement.provided)) {
      const resolution = yield* resolveId(id);
      if (resolution._tag === "Unavailable") failures.push({ _tag: "ProvidedButUnavailable", id, reason: resolution.reason });
    }
    for (const id of distinct(statement.notProvided)) {
      const resolution = yield* resolveId(id);
      if (resolution._tag === "Available") failures.push({ _tag: "NotProvidedButAvailable", id });
    }

    yield* Nexus.Application.shutdown(running);
    return failures;
  })));
