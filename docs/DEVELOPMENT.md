# Build and test noBS CAD

To use CAD or connect an agent, [install the application](INSTALL.md). Build from
source when developing the project. Start with current `main`; check out a
release's tag instead when reproducing that release or pairing a source-built
MCP server with a downloaded desktop.

Install Git, [Node.js 22](https://nodejs.org/en/download), and the
[Rust toolchain](https://rustup.rs/), then:

```sh
git clone https://github.com/jackControls/noBS-CAD.git
cd noBS-CAD
npm ci
```

## Build the desktop package

Set up the native SDK for your machine below, then use the same build command
on Windows, macOS and Linux:

```sh
cargo xtask package
```

It selects the existing platform packager, which builds the frontend, native
application and embedded MCP server, stages dependencies and license notices,
and produces the application package. SDK and signing environment overrides
pass through unchanged. Desktop builds do not require `wasm-pack` or a browser
WASM build. Run commands from the repository root.

### Windows SDK

Install PowerShell 7, Visual Studio C++ Build Tools with the Windows SDK and your
target architecture, and the pinned vcpkg dependency set from the
[Windows setup](WINDOWS_PACKAGING.md#local-windows-build).

The command selects x64 or ARM64 to match the running Rust toolchain. It uses
the matching `vcpkg_installed/x64-windows` or `vcpkg_installed/arm64-windows`
prefix by default; set `OCCT_ROOT` only when your SDK is elsewhere.

The ZIP is written under
`src-tauri/target/<rust-target>/release/bundle/portable/`.
Runtime requirements remain those in the installation guide.

<details>
<summary>Build for the other Windows architecture</summary>

Install the other Rust target, Visual Studio target tools and matching vcpkg SDK,
then select it explicitly:

```powershell
rustup target add aarch64-pc-windows-msvc
cargo xtask package --target aarch64-pc-windows-msvc
```

Use `x86_64-pc-windows-msvc` for x64. If `OCCT_ROOT` is set, it must point
to the SDK for the selected target. The `--target` option is Windows-only.

</details>

### macOS SDK (Apple silicon)

Install Xcode Command Line Tools and Homebrew, then:

```sh
brew install opencascade
```

Use a compatible OCCT 7.9.x SDK; `OCCT_ROOT` can select an explicit prefix.
The `.app` and `.dmg` are written under `src-tauri/target/release/bundle/`.
Local builds are ad-hoc signed; production Developer ID signing and notarization
belong to the release workflow. See [OCCT packaging](OCCT_PACKAGING.md) for SDK
overrides and signing details.

### Ubuntu 26.04 SDK (x86_64)

The committed container supplies the reproducible Linux SDK. With Docker installed:

```sh
docker build -f scripts/docker/ubuntu-26.04.Dockerfile -t nbcad-ubuntu-26.04 .
docker run --rm -v "$PWD:/workspace" -w /workspace nbcad-ubuntu-26.04 \
  sh -lc 'npm ci && cargo xtask package'
```

The `.deb` and AppImage are written under `src-tauri/target/release/bundle/`.
The container builds packages; launch them on a desktop with Vulkan support.
For native SDK setup and X11/XWayland checks, use
[Ubuntu packaging](LINUX_PACKAGING.md).

## Verify changes

For shared model and frontend changes:

```sh
cargo test --locked --workspace
npm run test:frontend
npm run build:desktop
npm run check:knowledge
```

For native geometry and MCP changes, with the matching OCCT SDK available:

```sh
cargo test --locked -p nbcad-occt --features native-occt
cargo test --locked --manifest-path mcp-server/Cargo.toml -- --test-threads=1
```

The MCP suite includes complete recipe acceptance tests and can take a while.
Run its native tests sequentially so heavy OCCT operations do not compete for
memory and request deadlines. The **Desktop packages** workflow also checks the
final packages' launch and MCP behavior; a successful compilation alone does
not establish that a distributable package works.

## Standalone MCP server

<details>
<summary>For developers who need a separate server binary</summary>

The application already includes MCP through `--mcp`. A separate source build is
useful when changing the server without rebuilding the desktop:

```sh
cargo build --release --locked --manifest-path mcp-server/Cargo.toml
```

This produces `mcp-server/target/release/nbcad-mcp` (`nbcad-mcp.exe` on Windows),
unless `CARGO_TARGET_DIR` overrides the output directory. This executable starts
directly in stdio server mode, so do not pass `--mcp`.

It requires the same native OCCT runtime as its SDK. On Windows, the matching
SDK's `bin` directory must be in the server process's `PATH`; `OCCT_ROOT` alone
does not configure the DLL loader. Pair live desktop and server builds from the
same source revision.

For supported client presets, use the existing source installer:

```sh
cargo xtask install-mcp --dry-run
cargo xtask install-mcp --clients cursor
```

It builds/copies the standalone server, backs up the selected client's config,
and preserves unrelated entries. It does not install or configure the packaged
desktop application. See the [source MCP installer guide](agentic/INSTALL_MCP.md)
for supported clients, runtime setup and manual configuration.

</details>

## Browser development

<details>
<summary>For browser/WASM changes and browser regression tests</summary>

The browser is a development and testing host with its own kernel adapter.
It is not required to build or use the native application. Install
[`wasm-pack`](https://drager.github.io/wasm-pack/installer/), then:

```sh
rustup target add wasm32-unknown-unknown
npm run build:wasm
npm run dev
```

Open the Vite address. To build and check the browser bundle:

```sh
npm run build
npm run smoke:wasm
npx playwright install chromium
npm run e2e:release
```

The `e2e:*` commands in `package.json` select individual feature suites when a
change needs a narrower check.

</details>

## Where the code lives

- Rust crates own project data, sketches, feature history, references, drawings,
  assemblies, kinematics and recompute planning.
- Native OCCT supplies exact geometry through a narrow C++ bridge.
- Bevy renders the native viewport; React and Tauri currently own the surrounding
  interface and window integration.
- The MCP server and Rust script interpreter drive the shared product interface.
- The browser host uses the Rust model through WebAssembly and OpenCascade.js
  for solid operations.

See [architecture](proposed-architecture.md), [assemblies](ASSEMBLIES.md),
[drawings](2D_DRAWINGS.md), [the MCP harness](mcp-harness.md), and
[the knowledge library](../knowledge/index.md) for their contracts.

