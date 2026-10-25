import type { Effect, Scope } from "effect";
import { it } from "vitest";

import type { EventBusShape } from "../src/event/index.js";
import * as Nexus from "../src/index.js";

interface Svc { readonly svc: true }

// The omitted-layer forms mean "no services": they must not be assignable to a type that promises some.
// (Checked by `pnpm typecheck`; an unused @ts-expect-error fails it.)
it("rejects a defaulted runtime/application typed as having services", () => {
  // @ts-expect-error R must not be inferred as Svc from the target type
  const app: Nexus.Application.Application<Svc> = Nexus.Application.define({ name: "x" });
  // @ts-expect-error likewise for Runtime.make()
  const rt: Effect.Effect<Nexus.Runtime.NexusRuntime<Svc | EventBusShape>, Nexus.Runtime.RuntimeInitError, Scope.Scope> = Nexus.Runtime.make();

  void app; void rt;
});
