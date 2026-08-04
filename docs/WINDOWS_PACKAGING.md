# Windows portable packaging

Status: experimental x64 release path validated by GitHub Actions.

## Supported baseline

The first Windows build intentionally has a narrow support target:

- Windows 10 version 1803 or newer, or Windows 11;
- x64 (`x86_64-pc-windows-msvc`);
- a portable ZIP rather than an installer;
- the system Microsoft Edge WebView2 Runtime;
- the centrally installed Microsoft Visual C++ v14 x64 Redistributable.

WebView2 is not copied into the ZIP. Microsoft distributes it with the
supported Windows versions above. The Visual C++ runtime is also not copied
app-locally: Microsoft recommends the centrally installed Redistributable so
security and servicing updates can be applied independently.

Permanent Microsoft x64 Redistributable download:

<https://aka.ms/vc14/vc_redist.x64.exe>

## Native viewport architecture

The Windows desktop build does not fall back to the browser renderer. Bevy
renders the real OCCT tessellation into an opaque Win32 child window using
wgpu's DX12/Vulkan backends. React and CSS continue to own the surrounding
menus, tabs, command dialogs, pointer interaction kernel, and accessibility
tree.

Wry hosts WebView2 in one child HWND and noBS CAD creates the Bevy viewport as
an adjacent child HWND. The Bevy window is placed above the viewport portion of
WebView2, then its Win32 window region is cut around every live DOM overlay.
The Bevy child owns viewport hits. `HTTRANSPARENT` cannot reliably pass input to
WebView2's renderer because it can live on another UI thread. The child relays
Win32 pointer and wheel messages through `ICoreWebView2::PostWebMessageAsString`,
and the page reconstructs them on the existing DOM interaction surface. Orbit,
sketch, datum, edge, and transient-preview interactions therefore retain the
same frontend kernel as macOS without requiring a transparent Tauri window or
transparent WebView2 compositor.

DOM rectangles stay in logical CSS pixels. Each native layout update reads the
current per-monitor Win32 DPI, positions the child window in physical pixels,
and resizes Bevy's swapchain to the same physical extent. Moving between
different-DPI monitors invalidates the frontend layout cache even when its CSS
geometry is unchanged.

## Reproducible dependency set

The root `vcpkg.json` pins the vcpkg registry and overrides Open CASCADE
Technology to 7.9.3, the same OCCT line used by the macOS build. The manifest
installs a dynamic x64 Windows prefix under:

```text
vcpkg_installed/x64-windows
```

The portable packager copies every DLL from that prefix's `bin` directory.
Because the prefix is created from an isolated manifest, this is the complete
runtime set for OCCT and its selected dependencies rather than a collection of
DLL names maintained by hand.

## Local Windows build

Install:

- Visual Studio C++ Build Tools with **Desktop development with C++**;
- a current Windows SDK;
- Node.js and npm;
- Rust with the MSVC and WebAssembly targets;
- `wasm-pack` 0.13.1;
- vcpkg at the commit pinned by `vcpkg.json`.

From PowerShell:

```powershell
rustup target add x86_64-pc-windows-msvc
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1 --locked
npm ci

.\.vcpkg\bootstrap-vcpkg.bat -disableMetrics
.\.vcpkg\vcpkg.exe install `
  --triplet x64-windows `
  --x-manifest-root="$PWD" `
  --x-install-root="$PWD\vcpkg_installed"

$env:OCCT_ROOT = "$PWD\vcpkg_installed\x64-windows"
npm run bundle:windows:portable
```

The command rebuilds the Rust WebAssembly frontend package, compiles the
release Tauri executable without creating an installer, gathers the native
runtime DLLs and license notices, and writes:

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/portable/
├── noBS-CAD-0.1.0-windows-x64/
├── noBS-CAD-0.1.0-windows-x64.zip
└── noBS-CAD-0.1.0-windows-x64.zip.sha256
```

The directory contains `noBS-CAD.exe`, the OCCT dependency DLLs, a runtime
requirements README, and license notices. It does not contain WebView2 or the
Microsoft Visual C++ runtime.

## GitHub Actions

`.github/workflows/desktop-packages.yml` runs the Windows job on a standard
`windows-2025` runner for pull requests to `main`, version tags, and manual
dispatches. It:

1. checks out the pinned vcpkg registry;
2. restores an ABI-keyed vcpkg binary cache when one is available;
3. installs OCCT 7.9.3 for `x64-windows`, compiling only on a cache miss;
4. creates the portable ZIP;
5. launches the packaged executable long enough to catch missing DLL or
   WebView startup failures;
6. uploads the ZIP and SHA-256 file for seven days.

The binary-cache key includes the pinned dependency manifest and the installed
MSVC toolset version. The first run for a new combination compiles OCCT and
stores vcpkg's binary packages; subsequent runs restore those packages instead
of rebuilding OCCT from source. GitHub scopes pull-request caches separately,
so a manual run on `main` seeds the default-branch cache that future branches
can reuse. Cache eviction or a dependency, triplet, or toolset change causes a
safe rebuild rather than reusing an incompatible binary.

The workflow intentionally uses a standard GitHub-hosted runner, which is free
for this public repository. Short artifact retention keeps temporary storage
bounded.

## Current limitations

- The portable executable is not yet Authenticode-signed, so Microsoft
  SmartScreen can warn when it is downloaded.
- Windows ARM64 and 32-bit builds are not produced.
- The Visual C++ Redistributable is a documented prerequisite rather than an
  installer-managed dependency.
- The portable ZIP has no shortcuts, file associations, updater, or
  uninstaller.

## Upstream references

- Tauri Windows prerequisites:
  <https://v2.tauri.app/start/prerequisites/>
- Tauri WebView2 distribution options:
  <https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options>
- Microsoft Visual C++ runtime deployment:
  <https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files>
- vcpkg binary caching:
  <https://learn.microsoft.com/vcpkg/users/binarycaching>
