# ADR 0007 — Out-of-process plugins that return native scripts (proposed)

- Status: Proposed
- Date: 2026-09-23
- Related: [docs/PLUGINS.md](../PLUGINS.md), [docs/native-scripts.md](../native-scripts.md),
  [docs/proposed-architecture.md](../proposed-architecture.md)

## Context

noBS CAD has one construction path: a version 1 `.nbcad.jsonc` script runs
through the Rust interpreter and the shared grouped interface, whether it comes
from the recipe catalog, `File → Open Script`, MCP or `cargo xtask run-script`.
The product is local and offline, and new engine, export and MCP surfaces are
written in Rust so every platform behaves the same.

Some useful capabilities do not fit that policy well. Importing a scanned 2D
print into a plate model needs image processing libraries and iterates quickly
against messy real-world input; other importers, generators and company-specific
conventions have the same shape. Putting them in the core would add heavy
dependencies, tie their release cadence to the CAD release and, for company
conventions, put private material in a public repository.

## Decision (proposed)

1. A **plugin is a separate local program** in its own directory, described by
   `nbcad-plugin.json`. Plugins may be written in any language.
2. The host runs a plugin with **one JSON request on standard input** and reads
   **one JSON response on standard output**. There is no shell, no long-lived
   connection and no callback into the host.
3. A plugin's **only output is a version 1 native script** plus a report of
   flags. The host validates the script with the ordinary parser and catalog,
   then runs it through the ordinary interpreter. Plugins never receive kernel,
   document or session access.
4. Version 1 defines two kinds: `import` (one input file) and `generate`
   (options only). Analysis or export plugins that must read the model are not
   part of version 1; when they are wanted, they receive an exported snapshot
   rather than a live handle.
5. Discovery reads `NBCAD_PLUGIN_DIRS` and the per-user plugin directory beside
   the desktop configuration. The host-neutral crate `nbcad-plugins` owns the
   manifest, discovery and protocol; the MCP server exposes `plugins` and
   `plugin` actions on `cad_interface`. A desktop menu entry is a follow-up that
   reuses the same crate.

## Alternatives considered

- **In-process WebAssembly plugins.** Sandboxed and portable, but the modules
  could not use OpenCV-class libraries, would need a bespoke ABI to the engine
  and a toolchain for authors. Reasonable later for pure-computation plugins.
- **JavaScript plugins in the web shell.** Contradicts the one-execution-path
  rule, would not run headlessly, and the web shell is scheduled to retire.
- **Plugins as MCP servers.** Inverts the current roles: the app is the server
  and agents are clients. A plugin that wants agent reach can still be wrapped
  by an agent calling `cad_interface`.
- **Direct kernel bindings for plugins.** Fast, but every plugin would become a
  second modeling path with its own validation gaps.

## Consequences

- Plugins are ordinary local programs run with the user's permissions. Install
  only trusted plugins; the host checks the response shape and script validity,
  not the program's behaviour.
- Everything a plugin builds stays editable and replayable because it is a
  script. Bugs in a plugin surface as a rejected script or a failed step, never
  as corrupted geometry.
- The protocol is versioned so requests, responses and manifests can grow
  without breaking older hosts or plugins.

## Acceptance sketch

- [x] `nbcad-plugins` discovers manifests, validates them and runs a plugin with
  timeout, size limits and clear errors; tests need no OpenCASCADE.
- [x] `cad_interface` `plugins` lists installed plugins; `plugin` runs one and
  executes its script exactly like `script`, or returns it with `execute: false`.
- [ ] Desktop `File → Import with plugin…` reuses the same crate and the Scripts
  workspace.
- [ ] A first real plugin (drawing import) lives in its own repository.
