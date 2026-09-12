# noBS CAD

**Design it. Make it. Show how it works.**

Free, open-source mechanical CAD that runs on your computer. Build parametric
parts, bring them together in an assembly, create the drawings, and export
directly to your slicer. Use the interface yourself or let your MCP-compatible
agent drive the same modeling operations—with an editable design at the end.

**Reliability → performance → ease of use.** In that order.
No required account, subscription, or cloud backend.

**[Download the showcase prerelease](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12)**
· [Watch it build](#made-in-nobs-cad)
· [Connect your agent](#your-cad-your-agent-your-model)
· [Contribute](CONTRIBUTING.md)

Built on the work of **[Open CASCADE Technology](https://github.com/Open-Cascade-SAS/OCCT)**,
**[Bevy](https://bevy.org/)**, **[wgpu](https://wgpu.rs/)**,
**[Rust](https://rust-lang.org/)**, **[Tauri](https://tauri.app/)** and
**[React](https://react.dev/)**. [Meet the foundations](#built-on-open-source).

> **Pre-alpha:** this is a development preview, including the showcase work in
> [PR #118](https://github.com/jackControls/noBS-CAD/pull/118). Expect rough edges
> and keep backups of projects you care about. The release notes identify the
> exact source and package verification.

## Made in noBS CAD

These are actual rendered constructions driven by our **Rust MCP recipe runner**.
The recordings show sketches becoming features, parts becoming assemblies, and
authored captions and camera moves explaining the process. The videos are edited
for presentation; the recipes contain the full construction and final checks.

### A vise you can take apart—and learn from

[![The captured-slide vise, with rounded printed parts and a compact screw handle](docs/assets/showcase/vise.png)](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12/vise-construction-refined.mp4)

**[Watch the 2:21 build](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12/vise-construction-refined.mp4)**
· [30-second overview](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12/vise-construction-30s.mp4)
· [Editable recipe](examples/scripts/d-screw-vise.nbcad.jsonc)

Six printed parts, 100 mm gripping faces, 90 mm travel, a coarse rounded D-screw,
captured slides and optional mounts. Explore fits, moving joints, individual print
layouts and seven drawing sheets. The detailed montage ends with a live orbit.

### A garden bench, from a blank document

[![Crown garden bench in the native CAD viewport after a checked replay](docs/assets/showcase/bench.png)](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12/bench-construction-30s.mp4)

**[Watch the 30-second build](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12/bench-construction-30s.mp4)**
· [Editable recipe](examples/scripts/garden-bench.nbcad.jsonc)

Dimensioned timber parts, eased edges, repeated slats and assembly placement.
Follow the feature history back to the sketches and change the design yourself.

### A vertical-axis turbine with a generator drive

[![Two-stage vertical-axis turbine with its shaft, bearings and generator drive](docs/assets/showcase/turbine.png)](examples/scripts/vertical-axis-turbine.nbcad.jsonc)

**[Explore the editable recipe](examples/scripts/vertical-axis-turbine.nbcad.jsonc)**
· [Design and validation status](docs/flagship-examples.md)

Two staggered Savonius stages, a bearing-supported shaft, a 4:1 geared generator
drive, fit coupons, print layouts and part/assembly drawings. An additive design
experiment in clearances, repeated geometry, gearing and constrained motion.
The image above is the current native model; a turbine video is not included yet.

The examples have automated geometry, interference and repeatability checks.
They are **development designs**, with physical fit, load, wear and generator
output still to be qualified. The bench's complete drawing package is unfinished.
[See exactly what is validated](docs/flagship-examples.md).

## Install and make your first part

Download the package for your computer from the
**[showcase prerelease](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12)**:

- **Windows x64 / ARM64:** extract the matching portable ZIP and run
  `noBS-CAD.exe`. Keep the DLLs beside it. The matching Microsoft Visual C++
  runtime and WebView2 are required; [setup and prerequisite links](docs/INSTALL.md#windows).
- **macOS, Apple silicon:** open the DMG and drag **noBS CAD** into
  **Applications**. [Installation details](docs/INSTALL.md#macos)
- **Ubuntu 26.04, x64:** install the `.deb` with your package manager, or make
  the AppImage executable and run it. [Copyable commands](docs/INSTALL.md#ubuntu)

No compiler is needed for the desktop app or its bundled recipes.
Downloads include **SHA-256 checksums**. [Installation and troubleshooting](docs/INSTALL.md)
· [Build from source](docs/DEVELOPMENT.md)

Once the app opens:

1. Choose **Scripts → Sketch, extrude, ease the edges**.
2. Select **Presentation** and click **Run in new design**.
3. **Pause**, **Step**, change speed, or switch to **Maximum** to finish without
   presentation waits. The existing design stays in its own tab.
4. Save the result as an editable **`.nbcad`** project.

Open the **Source** tab to read or change a recipe. **File → Open Script…** loads
your own `.nbcad.jsonc` file without running it. The three flagship designs and
short feature lessons are in the same library.
[Browse the recipes](examples/scripts/README.md) · [Playback guide](docs/native-scripts.md)

## From design to manufacture

**Parametric parts.** Constrained sketches, dimensions and reference geometry
drive extrude, revolve, sweep, loft, rib, holes, modeled threads, fillets,
chamfers, shells, patterns and other editable features. Inspect the history,
change a dimension and recompute.

**Integrated assemblies.** Reuse components, place occurrences and nest
subassemblies in the same `.nbcad` project format. Ground components, define
joints, explore motion and check interference. Rigid, revolute, slider,
cylindrical, planar, ball, universal, pin-slot and screw joints support mechanical
relationships. [Assembly guide](docs/ASSEMBLIES.md)

**Design and drawings together.** Create ISO or ANSI/ASME sheets with projected
and derived views, dimensions, center geometry, manufacturing annotations and
title blocks. Export DXF or use the platform print/PDF path.
[Drawing guide](docs/2D_DRAWINGS.md)

**Materials and direct 3MF.** Assign per-body materials and colors, preflight the
geometry and export native 3MF with units and compatible slicer metadata. Send
the result to your slicer without an intermediate STEP/STL conversion. STEP
import and AP242 export support CAD interchange; STL is available when needed.
3MF is a manufacturing handoff, not a pre-sliced project. Keep `.nbcad` for
editable history.

Assembly motion is kinematic, not a physics simulation. Material assignments
describe appearance and manufacturing intent; they are not strength calculations.

## Your CAD, your agent, your model

**MCP is a core interface.** The desktop, local API and MCP share the product's
operation grouping and Rust modeling path. An agent can discover tools, create
and edit parts, work with assemblies and drawings, export manufacturing files,
launch CAD and drive an explicitly selected live document. Headless execution
and visible presentation use the same modeling operations.

Bring your preferred **MCP-compatible agent and model**. We aim to keep pace
with frontier agents while preserving an open interface for other providers and
local models. There is no required AI subscription built into CAD. Your chosen
agent determines whether any prompts or model data leave your machine.

The standalone stdio MCP server currently has a separate source-build setup:
**[MCP installation](docs/INSTALL.md#connect-an-mcp-agent)**. The packaged desktop
already includes the Rust runner needed for the Scripts library.

For an authored design, the agent can make **one script request**. Rust sequences
the individual operations, stops on an error and runs the recipe's checks.
Presentation mode adds captions, camera transitions and playback controls;
maximum speed removes authored waits. No embedded JavaScript is needed in a recipe.

```json
{"action":"script","recipe":"mounting-plate"}
```

Pass this to `cad_interface` in a blank headless document. For a live demonstration,
attach to the intended document and use presentation mode.
[MCP guide](mcp-server/README.md) · [Live control](docs/mcp-harness.md)
· [Recipe format](docs/native-scripts.md) · [Offline engineering knowledge](knowledge/index.md)

## Learn by watching. Build by doing.

Today, replayable lessons, chapter notes, miniature previews and inspectable
source let a design explain how it was made. Our ambition is to make this the
foundation for **guided learning and conversational design wizards**: CAD that
helps you make something, teaches the reasoning and shows each operation.

We also want a careful path from mechanical CAD to **CAM**, beginning with
useful, testable 3-axis machining workflows. CAM, broader learning journeys and
structural simulation are aspirations, not shipping features.
[Project direction](docs/goals.md)

## Built on open source

noBS CAD would not exist without these projects and their contributors:

- **[Open CASCADE Technology](https://github.com/Open-Cascade-SAS/OCCT)** provides
  the native geometry kernel: exact solids, surface operations and CAD interchange.
- **[Bevy](https://bevy.org/) and [wgpu](https://wgpu.rs/)** render the native
  desktop viewport.
- **[Rust](https://rust-lang.org/)** underpins the parametric model, geometry
  planning, assembly logic and recipe runner.
- **[Tauri](https://tauri.app/)** provides the desktop shell;
  **[React](https://react.dev/)** provides menus, dialogs and the accessible interface.
- **[OpenCascade.js](https://github.com/donalffons/opencascade.js)** supports our
  browser development and testing build.

We also thank **[FreeCAD](https://www.freecad.org/)** and the wider open-source
CAD community for the work that makes this field possible. FreeCAD is an
inspiration, not a bundled dependency.

### Related projects

Dependency licenses and attribution live in [Third-party notices](THIRD_PARTY_NOTICES.md).
Icon sources are recorded in [Icon provenance](docs/ICON_PROVENANCE.md).
Peer CAD projects have their own licenses; see [contribution guidance](CONTRIBUTING.md#license--borrow).

### 3D mouse compatibility

noBS CAD supports 3Dconnexion SpaceMouse devices. The optional browser-development
driver bridge loads only after the user enables it.
noBS CAD is independent and is not affiliated with, endorsed by or certified by
3Dconnexion. 3Dconnexion and SpaceMouse are trademarks or registered trademarks
of 3Dconnexion. 3D input device development tools and related technology are
provided under license from 3Dconnexion. © 3Dconnexion 1992–2020. All rights reserved.

## Help make it dependable

**Contributions welcome.** Bring a real part, a confusing workflow, a bug
reproduction, a lesson or a focused improvement. Reliability comes first, then
performance and ease of use. Small reproducible examples help us turn failures
into lasting fixes.

[Contributing](CONTRIBUTING.md) · [Report a problem](https://github.com/jackControls/noBS-CAD/issues)
· [Hunt geometry edge cases](docs/EDGE_CASE_HUNT.md) · [Build and test](docs/DEVELOPMENT.md)

For a bug report, include the build, operating system, steps and a small project
you can share. Tell us what you expected and what happened. Discuss large changes
early so we can agree on the design and user experience.

## License

**Free to use, open to inspect and improve, local by default.**
noBS CAD is licensed under the [GNU LGPL 2.1 or later](LICENSE)
(`LGPL-2.1-or-later`). Third-party components retain their own licenses and notices.
