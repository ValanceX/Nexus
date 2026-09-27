# NEXUS capability model audit (v0.6 → v0.7)

*Audited 2026-09-27, against `main` at `c5b16b8` (v0.6.0 released; `package.json` 0.6.0).*

This document is the evidence base for the v0.7 outline, [`../superpowers/specs/2026-09-27-nexus-v0.7-outline.md`](../superpowers/specs/2026-09-27-nexus-v0.7-outline.md). It records facts, and it doesn't define an API. It extends the [runtime/platform audit](./2026-09-27-runtime-platform-audit.md) (cited here as *RPA*) and answers only the capability questions that audit left for v0.7: L6, I15, and v0.6's open questions O1, O2, O3, O5 and O6.

Baseline: `pnpm typecheck` is clean, `pnpm test` passes **332 tests in 23 files**, and `pnpm build` succeeds (Node 22.22, pnpm 10.33, effect 3.22). The working tree was clean.

Read in full for this audit:
- `src/capability`, `src/application`, `src/runtime`, `src/semantic` and `src/mesh`;
- `tests/platform.test.ts`, `tests/platform/reference.ts`, `tests/capability.test.ts`, `tests/semantic-isolation.test.ts`, and the leaf and platform blocks of `tests/architecture.test.ts`;
- `docs/ARCHITECTURE.md` §10, §16, §16.1, §25.2 and §26, and `docs/ROADMAP.md`;
- `docs/FUTURE_DIRECTION.md` §9, §15, §17 and §18;
- `docs/semantic.md` and `docs/primitives/capability.md`;
- the v0.4 outline (§3 X4, §4 A5 and A6, C4, D7, D8, DoD 12) and the v0.6 outline;
- RPA, PORT's `docs/ARCHITECTURE.md` ("Two kinds of capability") and MESH's `docs/ARCHITECTURE.md`.

Three claims were checked by experiment against `dist/`, from a scratchpad script. Nothing was committed.
- **X1. Platform merge.** `Layer.merge(EnvironmentLive({storage}), EnvironmentLive({network}))` passed as the platform resolves `storage` as **Unavailable** and `network` as Available. The second `Environment` replaces the first without any error.
- **X2. Identity collision.** Two `Capability.define` calls with the same `id` resolve to **the same implementation**.
- **X3. Identifier reuse.** `Semantic.analyze` accepts `{ capability: Storage.id }` as a requirement, and a profile listing capability ids, with no code change. It returns the documented verdicts and codes: incompatible gives `nexus-incompatible-target-capability`, and undecided gives `nexus-undetermined-target-capability`.

---

## A. Conclusion

NEXUS v0.6 already has both halves of the v0.7 relation. They were built at different times, for different reasons, and nothing yet says they talk about the same thing.

- **The runtime half is complete.** An application names a capability by `id` and uses it through `resolve` or `require`. A platform `Layer` answers for each `id` at start. Nothing is missing at runtime, and nothing in the v0.7 question requires a runtime change.
- **The static half is complete as machinery.** `Semantic.analyze` computes required × provided → supported / opaque / incompatible over opaque identifier strings, which is exactly the roadmap's relation (RPA §M).
- **The gap is meaning, not mechanism.** Nothing defines:
  - what a semantic "target" denotes (L6);
  - whether a semantic capability identifier may be an application `Capability`'s `id` (I15);
  - what a platform states before start about what it provides (O6);
  - whether an application's *use* of a capability is a *requirement* of it.

**The decisive finding is F3 below.** v0.6 invalidated the premise on which I15 was founded. I15 has to be revised deliberately. It can't be kept by inertia, and it can't be dropped silently.

---

## B. The four uses of "capability"

| # | Concept | Where | Identity | Owner of identifiers | Time | Consumer |
|---|---|---|---|---|---|---|
| 1 | **Application capability**: the `Capability` primitive | `src/capability`; ARCHITECTURE §10; `capability.md` | `Capability.id` (string) plus a phantom `Shape` | whoever calls `Capability.define`: the application, or a shared contract module | runtime | application effects, through `resolve` and `require` |
| 2 | **Platform provision** at runtime | `Application.Platform`, `EnvironmentShape` | the same `id`, as a map key | the platform decides the *answers*, not the ids | fixed at start (D36) | `resolve` and `require` |
| 3 | **Semantic target capability** | `src/semantic`; `semantic.md`; C4; I15, I16 | an opaque non-empty string | whoever produces the analysis context (D8: NEXUS ships none) | pre-execution | `Semantic.analyze` callers (none exist yet) |
| 4 | **PORT target capability** | PORT `docs/ARCHITECTURE.md` | PORT-chosen strings (`retained-rendering`, `stable-native-widget-identity`) | PORT | PORT's concern | MESH, tooling |

Rows 1 and 2 already share one identifier: the platform answers *for an application capability's `id`*. There is no separate "platform capability" namespace in the implementation, and none in the roadmap either. ROADMAP §17 writes "Application: requires Network / Platform: provides Network", which is one identifier appearing in two different statements.

Row 3 is the open one (L6). Row 4 doesn't exist in any code. PORT's packages are `export {}`, and MESH has no capability model: its only uses of the word are LSP capabilities and "targets describe themselves" (MESH ARCHITECTURE).

---

## C. Findings

**F1. The semantic relation is already the roadmap's relation.**
- `verdictOf` (`src/semantic/index.ts`) returns `Incompatible` exactly when a declared requirement is in `notProvided`.
- It returns `Undetermined` when requirements are undeclared or partial, or when a required id is undecided.
- It returns `Compatible` otherwise.

No new analysis is needed to evaluate *application requirements × platform provisions* (X3).

**F2. Semantic interprets no identifier.**
- Capability identifiers are compared only by string equality.
- Profiles are explicit input (C4, D8), and NEXUS ships no identifiers.
- Nothing in `src/semantic` knows whether an identifier names a platform facility or a rendering feature.

A "target" in Semantic is therefore whatever the supplied profile describes. That is already a neutral relation in fact, even though the documents and examples read it as an execution environment (RPA §F, ambiguity 1).

**F3. v0.6 removed I15's founding premise.** I15 and D7 rest on v0.4 finding A5, which gives two reasons:
- **(a)** Capability resolutions "describe *which implementation the application chose*, not *what a target provides*", because v0.4's resolutions came from `ApplicationDefinition.environment`, which the author wrote.
- **(b)** "An operation that uses `Capability.resolve` with a fallback doesn't *require* the facility at all."

v0.6 D31 removed `environment`, and D30 made the **platform** the only supplier of resolutions. After v0.6, the runtime `Environment` *is* what the execution environment provides, so reason (a) no longer holds. Reason (b) still holds, and it is the part that matters: *using* a capability is not *requiring* it.

**F4. I15 bundles two separable claims.**
- **I15a, independence.** Analysis neither reads nor affects resolution, and application capability configuration never decides a target capability.
- **I15b, separate identifier spaces.**

I15a is what the tests pin. `tests/semantic-isolation.test.ts`, "application capability is not target capability (DoD 12, I15)", shows that an `Available` resolution plus a profile that doesn't provide the id gives *incompatible*, an `Unavailable` resolution plus a providing profile gives *supported*, and resolution is unchanged by analysis. Nothing tests I15b. The test itself uses the **same string**, `"filesystem"`, as the application capability id and the target capability id. I15b is documentation only (`semantic.md`: "unrelated"; ARCHITECTURE §16.1: "separate identifier spaces").

**F5. A static provision claim and a runtime resolution are different facts.**
- A platform `Layer` is opaque before it is built (v0.6 table I-3, "Semantic inspection").
- Building it executes effects and may acquire resources (C15). Deriving a profile from it would be execution, which I16 forbids for a profile.
- A platform may also *legitimately* not know before start whether it will provide something: a permission prompt, an optional device, a remote service.

So the static statement is a **claim**, of the same epistemic kind as a declaration ("a claim by its author; NEXUS doesn't verify it", `semantic.md`). Its three-valued form (provided / not provided / undecided) is exactly what conditional provision needs.

**F6. Platform composition silently loses capabilities (X1).**
- Two `Environment` outputs merged into one platform keep only the last map.
- That is Effect's `Context` semantics for one tag, and it isn't an error anywhere.
- v0.6 recorded this as O1.
- Today no platform composes: the reference platform (`tests/platform/reference.ts`) builds one map.

**F7. Capability identity is nominal by string, and collisions are silent (X2).**
- The `Environment` is keyed by `id`.
- `Shape` is erased and never compared.
- Two contracts that share an `id` share an implementation.

A static binding that reuses the `id` inherits exactly this identity, and adds no new hazard.

**F8. Nothing in NEXUS may import `Semantic`.** `tests/architecture.test.ts` ("is imported by nothing under `src/` except the package entry") and ARCHITECTURE §16.1 ("any NEXUS module → Semantic (invalid)") pin this. So any "producer" that turns `Capability` values into semantic declarations can't live in a NEXUS module without revising D13. The producer would be small: `{ capability: Storage.id }` is already the whole of it (X3).

**F9. No consumer of a capability requirement exists yet.**
- No tooling, CLI or host calls `Semantic.analyze`.
- No platform package exists (D41).
- No PORT target exists.

L3 (what a consumer does with an `error`) therefore still has no consumer to decide it.

**F10. MESH and PORT are unaffected.**
- The MESH adapter imports no capability (`src/mesh/index.ts`), and M1–M4 hold.
- mesh-runtime's engine initialization outside Node (L7) is a host concern.
- PORT's own architecture already separates device capability (NEXUS) from target capability (PORT). Its diagram line "NEXUS → detect environment" is stale, as RPA §L recorded, and isn't edited from here.

---

## D. What v0.7 must decide

1. **L6.** What a semantic target profile denotes.
2. **I15.** Whether I15b survives, now that F3 holds.
3. What an application capability *requirement* is (F3b), and at what granularity.
4. What a platform *provision statement* is (F5), who authors it, and whether `start` sees it.
5. O1 (composition, F6), O2 (typed identity in `R`), O5 (non-`Environment` platform outputs) and O6 (pre-start description).
6. Identity and collision (F7).
7. Whether any runtime or `Semantic` API has to change (F1, F2 and F8 suggest not).

## E. What v0.7 must not change

All of RPA §H still applies, together with v0.6's I28–I33:
- the single supply point;
- platform-scoped lifetime;
- no environment vocabulary;
- no default-service wrapper;
- the leaf;
- the released semantic types and codes;
- the v0.4 differential corpus (I27).
