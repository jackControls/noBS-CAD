# Build and test noBS CAD

For a ready-to-run application, use the [installation guide](INSTALL.md).
The commands below assume a checkout of this repository and run from its root:

```sh
git clone https://github.com/jackControls/noBS-CAD.git
cd noBS-CAD
```

Install Git, [Node.js 22](https://nodejs.org/en/download) and the
[Rust toolchain](https://rustup.rs/) first. Native builds also need a C++ compiler
and the platform's OCCT 7.9 SDK: Visual Studio C++ Build Tools on Windows,
Xcode Command Line Tools on macOS, or the packages/container described for Ubuntu.
The release source revision is recorded in its notes; check out that tag when
building an MCP server to pair with a downloaded desktop.

## Ubuntu 26.04 LTS

Ubuntu 26.04 LTS is the official Linux desktop baseline. The app uses the
native Bevy/wgpu Vulkan viewport inside the Tauri WebKitGTK window. It runs on
X11 directly and on Ubuntu's standard Wayland desktop through XWayland. The
release job produces an Ubuntu `.deb` and a portable AppImage, then
launch-tests both display routes.

The committed container is the simplest reproducible build environment:

```sh
docker build -f scripts/docker/ubuntu-26.04.Dockerfile -t nbcad-ubuntu-26.04 .
docker run --rm -v "$PWD:/workspace" -w /workspace nbcad-ubuntu-26.04 \
  sh -lc 'npm ci && npm run bundle:linux'
```

On a native Ubuntu 26.04 development system with the documented GTK, Vulkan,
and OCCT packages already installed:

```sh
npm ci
npm run bundle:linux
```

See [Ubuntu 26.04 packaging](LINUX_PACKAGING.md) for dependencies,
artifacts, X11/XWayland verification, and 3D-input permissions.

## Windows x64 and ARM64 portable builds

The Windows release path targets Windows 10 version 1803 or newer and Windows
11. It produces a portable ZIP rather than an installer, uses the WebView2
runtime supplied by Windows, and requires Microsoft's centrally installed
matching Visual C++ v14 Redistributable. The desktop build uses the same native
Bevy viewport as macOS, backed by wgpu's DX12/Vulkan support; React and CSS
remain the real menu, tab, dialog, and accessibility interface.

The build itself requires Windows, Visual Studio C++ Build Tools, the Windows
SDK, Rust, Node.js, and the pinned OCCT 7.9.3 vcpkg dependency.
After installing the pinned vcpkg manifest:

```powershell
$target = "x86_64-pc-windows-msvc" # Use aarch64-pc-windows-msvc for ARM64.
$triplet = "x64-windows" # Use arm64-windows for ARM64.
$env:OCCT_ROOT = "$PWD\vcpkg_installed\$triplet"
npm ci
npm run bundle:windows:portable -- -Target $target
```

See [Windows portable packaging](WINDOWS_PACKAGING.md) for the complete
setup, output layout, runtime requirements, and GitHub Actions workflow.

## Native macOS development bundle

The macOS packaging path uses Tauri with OCCT 7.9.x.

```sh
brew install opencascade
npm ci
npm run bundle:macos
```

The resulting ad-hoc-signed development application and disk image are written
to:

```text
src-tauri/target/release/bundle/macos/noBS CAD.app
src-tauri/target/release/bundle/dmg/noBS CAD_0.1.0_aarch64.dmg
```

Development packages intentionally retain Rust symbols for crash diagnosis.
The desktop packaging workflow treats a `v*` Git tag as the production
boundary and sets `CARGO_PROFILE_RELEASE_STRIP=symbols` for macOS, Windows,
and Linux. To reproduce a stripped production package locally, set that variable
before running the platform bundle command:

```sh
CARGO_PROFILE_RELEASE_STRIP=symbols npm run bundle:macos
```

```powershell
$env:CARGO_PROFILE_RELEASE_STRIP = "symbols"
npm run bundle:windows:portable
```

See [OCCT packaging and browser/WASM strategy](OCCT_PACKAGING.md) for
native SDK overrides, the Apple-silicon GitHub Actions build, and packaging
details.

## Browser development build

The browser build is a development and testing environment. It requires
Node.js, npm, a current Rust toolchain, the `wasm32-unknown-unknown` target,
and [`wasm-pack`](https://drager.github.io/wasm-pack/installer/).

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run build:wasm
npm run dev
```

Open the local address printed by Vite. Create a production browser bundle
with:

```sh
npm run build
```

## Project structure

- React, TypeScript, and Vite provide the DOM interface; Bevy renders the
  native desktop viewport.
- Host-neutral Rust crates own project data, sketches, feature definitions,
  history, stable references, drawing intent, assembly structure, kinematics,
  and recompute planning.
- Native builds use Open CASCADE Technology through a narrow C++ bridge.
- The browser development build uses the same Rust model through WebAssembly
  and OpenCascade.js for solid operations.
- `.nbcad` files are inspectable ZIP archives containing a manifest and model
  data.

Public technical references:

- [Download pre-release desktop builds](https://github.com/jackControls/noBS-CAD/releases)
- [Goals / directions](goals.md)
- [2D technical drawings](2D_DRAWINGS.md)
- [Assemblies, components, and joints](ASSEMBLIES.md)
- [Proposed architecture](proposed-architecture.md)
- [MCP harness notes](mcp-harness.md)
- [Open Knowledge Format bundle](../knowledge/index.md)
- [OCCT packaging and browser/WASM strategy](OCCT_PACKAGING.md)
- [Windows portable packaging](WINDOWS_PACKAGING.md)
- [MCP server](../mcp-server/README.md)
- [Icon provenance](ICON_PROVENANCE.md)
- [Generated WASM bundle](../src/engine-wasm/README.md)

## Verify changes

Start with:

```sh
npm run check:knowledge
cargo test --workspace
npm run build:wasm
npm run build
npm run smoke:wasm
```

Browser regression suites run through Playwright. For example:

```sh
npx playwright install chromium
npm run e2e:m2
npm run e2e:hole
npm run e2e:timeline
```

Run the complete browser release regression set with:

```sh
npm run e2e:release
```

Native OCCT and MCP checks require a compatible local OCCT installation:

```sh
cargo test -p nbcad-occt --features native-occt
cargo test --manifest-path mcp-server/Cargo.toml
```

