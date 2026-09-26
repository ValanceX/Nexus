# MESH slice fixture

A verbatim copy of `examples/slice/` from [ValanceX/Mesh](https://github.com/ValanceX/Mesh) at tag `v0.5.0`, commit `c0ef6d558d6f60478722910d564567a573579518`. Don't edit these files. To update them, re-copy them from a MESH tag and record the new commit here.

Copied files: `components.json`, `users.mprx`, `user-card.mprx`, `snapshots/first.json`, `snapshots/second.json`, `expected/first.tree.json`, `expected/select-first.intent.json`.

`tests/mesh.test.ts` compiles the two templates with `@valancex/mesh-compiler` (a devDependency) in `beforeAll`. That's the build-time step. No NEXUS code under `src/` uses the compiler.
