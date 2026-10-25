import { Effect, Schema } from "effect";
import type { Scope } from "effect";
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

it("keeps the narrow Command/EventDef references compiling and distinct from transforming ones", () => {
  const plain: Nexus.Command.Command<{ n: number }, void, never, never> = Nexus.Command.define("p", Schema.Struct({ n: Schema.Number }), () => Effect.void);
  const ev: Nexus.Event.EventDef<"T", { n: number }> = Nexus.Event.define("T", Schema.Struct({ n: Schema.Number }));
  // @ts-expect-error a transforming schema (encoded string) is not the narrow Command<A> form
  const narrow: Nexus.Command.Command<{ n: number }, void, never, never> = Nexus.Command.define("t", Schema.Struct({ n: Schema.NumberFromString }), () => Effect.void);

  void plain; void ev; void narrow;
});

it("keeps explicit 4-argument Mesh.bind and a boolean validate flag compiling", () => {
  const cmd = Nexus.Command.define("b", Schema.Struct({ n: Schema.Number }), () => Effect.void);
  const bound = Nexus.Mesh.bind<{ readonly n: number }, void, never, never>(cmd, () => ({ n: 1 }));
  const ev = Nexus.Event.define("B", Schema.Struct({ n: Schema.Number }));
  const flag: boolean = Math.random() > 2;
  const stream = Nexus.Event.subscribe(ev, { validate: flag });

  void bound; void stream;
});
