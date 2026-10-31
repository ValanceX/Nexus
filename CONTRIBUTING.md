# Contributing to NEXUS

Bug reports and pull requests are welcome on [GitHub](https://github.com/ValanceX/Nexus/issues). This is how to work on NEXUS itself; to use it, start at the [README](README.md).

## Checks

Requires Node 22 or later. From a clone:

```console
pnpm install
pnpm test        # the test suite (vitest)
pnpm typecheck
pnpm build
```

`prepublishOnly` runs the same three before a publish.

## Documentation

Documentation lives in `docs/`, organized by what the reader wants to do: `reference/` (exact behavior: the primitives, semantic analysis, stability, release notes) and `explanation/` (the architecture, the roadmap and the design record). A pull request that changes behavior updates the page that describes it, in the same pull request. The primitive pages are normative: their **Data Model**, **API**, **Errors** and **Rules** sections match the exported declarations exactly, and `tests/semantic.test.ts` checks the semantic page against the module.

## Releases

A release is a `v*` tag; [`release.yml`](.github/workflows/release.yml) publishes `@valancex/nexus` with the version's notes from `docs/reference/releases/vX.Y.Z.md` (a patch release) or `docs/reference/releases/vX.Y.md`. Prepare the version, the notes and the [changelog](CHANGELOG.md) entry in a pull request first.
