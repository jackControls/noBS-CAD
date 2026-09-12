# noBS CAD

Free, open-source parametric CAD for mechanical parts, assemblies and drawings.
Runs locally, with the same modeling tools available to people and MCP agents.

**[Download](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12.2)**
· [Install](docs/INSTALL.md)
· [Connect an agent](docs/INSTALL.md#connect-an-mcp-agent)
· [Contribute](CONTRIBUTING.md)

## Made in noBS CAD

Built from sketches and features through the Rust MCP recipe runner.
The loops show the construction; the longer recordings show it in detail.

### Vise

[![Vise with a captured sliding jaw and compact D-screw handle](docs/assets/showcase/vise.png)](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/vise-build-full.mp4)

100 mm jaws, 90 mm travel, a coarse D-screw and a six-part assembly.

<a href="https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/vise-build-full.mp4"><img src="docs/assets/showcase/vise-loop.gif" width="360" alt="30-second loop of the vise being built in noBS CAD"></a>

[Detailed build · 2:21](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/vise-build-full.mp4)
· **[Open recipe in noBS CAD](https://jackcontrols.github.io/noBS-CAD/open.html#d-screw-vise)**
· [Recipe source](examples/scripts/d-screw-vise.nbcad.jsonc)

<!-- Print photo: add docs/assets/showcase/vise-printed.jpg when supplied. -->

### Garden bench

[![Garden bench with crowned back slats and rounded armrests](docs/assets/showcase/bench.png)](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/bench-build-full.mp4)

A timber frame, repeated slats and shaped arms, assembled from dimensioned parts.

<a href="https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/bench-build-full.mp4"><img src="docs/assets/showcase/bench-loop.gif" width="360" alt="30-second loop of the garden bench being built in noBS CAD"></a>

[Full build · 4:04](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/bench-build-full.mp4)
· **[Open recipe in noBS CAD](https://jackcontrols.github.io/noBS-CAD/open.html#garden-bench)**
· [Recipe source](examples/scripts/garden-bench.nbcad.jsonc)

<!-- Print photo: add docs/assets/showcase/bench-printed.jpg when supplied. -->

### Vertical-axis turbine

[![Two-stage vertical-axis turbine with its bearing-supported shaft and generator drive](docs/assets/showcase/turbine.png)](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/turbine-build-full.mp4)

Two staggered Savonius stages, a bearing-supported shaft and a 4:1 geared generator drive.

<a href="https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/turbine-build-full.mp4"><img src="docs/assets/showcase/turbine-loop.gif" width="360" alt="30-second loop of the vertical-axis turbine being built in noBS CAD"></a>

[Detailed build · 4:15](https://github.com/jackControls/noBS-CAD/releases/download/preview-2026-09-12.2/turbine-build-full.mp4)
· **[Open recipe in noBS CAD](https://jackcontrols.github.io/noBS-CAD/open.html#vertical-axis-turbine)**
· [Recipe source](examples/scripts/vertical-axis-turbine.nbcad.jsonc)

<!-- Print photo: add docs/assets/showcase/turbine-printed.jpg when supplied. -->

The recipes retain editable feature history, assembly relationships and checks. [Design details and validation](docs/flagship-examples.md)
· [More examples](examples/scripts/README.md)

## Install

- **Windows:** extract the portable ZIP and open `noBS-CAD.exe`.
- **macOS:** open the Apple-silicon DMG and drag the app into Applications.
- **Ubuntu 26.04:** install the DEB and open noBS CAD from the application launcher.

[Download packages](https://github.com/jackControls/noBS-CAD/releases/tag/preview-2026-09-12.2)
· [Setup and troubleshooting](docs/INSTALL.md)

This is a pre-alpha release. Keep backups of important projects.

## Design, assemble, draw

Constrained sketches and reference geometry drive editable solid features.
Reuse parts in assemblies, define joints and check their motion and interference.
Keep parts, assemblies and drawings together in an `.nbcad` project.

Assign materials and colors, then export directly to **3MF** for your slicer.
**STEP** and **STL** support interchange; drawings export to **DXF** and print/PDF.
[Assemblies](docs/ASSEMBLIES.md) · [Drawings](docs/2D_DRAWINGS.md)

## MCP and replay

The installed application also runs as a local stdio MCP server with `--mcp`.
Bring your preferred MCP-compatible agent and model. No CAD account, subscription
or cloud service is required.

Agents use the same Rust modeling operations as the desktop. A single recipe
request can build a part or assembly, with captions, camera moves and playback
controls when you want to watch. Open **Scripts** in CAD to run a bundled example,
or inspect and edit its source before running it in a new design.

[Agent setup](docs/INSTALL.md#connect-an-mcp-agent)
· [MCP interface](mcp-server/README.md)
· [Recipe format and playback](docs/native-scripts.md)
· [Engineering knowledge](knowledge/index.md)

## Development

Contributions are welcome. Our priorities are reliability, performance and ease
of use, in that order. Bring a part, a reproducible bug or a focused improvement.

`cargo xtask package` builds the desktop package for your computer.
[Developer setup](docs/DEVELOPMENT.md) · [Contributing](CONTRIBUTING.md)

Future work includes CAM and guided design lessons and wizards.
[Project direction](docs/goals.md)
· [Moving the interface into Bevy](https://github.com/jackControls/noBS-CAD/issues/38)

## Open-source foundations

- **[Open CASCADE Technology](https://github.com/Open-Cascade-SAS/OCCT)** — geometry and CAD interchange.
- **[Bevy](https://bevy.org/) and [wgpu](https://wgpu.rs/)** — native rendering.
- **[Rust](https://rust-lang.org/)** — modeling, assemblies and recipe execution.
- **[Tauri](https://tauri.app/) and [React](https://react.dev/)** — desktop shell and interface.
- **[OpenCascade.js](https://github.com/donalffons/opencascade.js)** — browser development builds.

Thanks also to [FreeCAD](https://www.freecad.org/) and the wider open-source CAD community.

## License

[GNU LGPL 2.1 or later](LICENSE). Free to use, inspect and improve.

<details>
<summary>Third-party notices and 3D mouse support</summary>

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

</details>
