# Ubuntu 26.04 Linux packaging

Ubuntu 26.04 LTS x86_64 is the official Linux desktop baseline. The native
application keeps the same production boundary used on macOS and Windows:
React/CSS owns menus, dialogs, tabs, input and accessibility; Bevy/wgpu owns
the embedded CAD viewport; native OCCT owns exact geometry.

## Supported desktop paths

- X11 through a child GTK `DrawingArea` and native Xlib window/display
  handles.
- Ubuntu's standard Wayland desktop through XWayland and the same child-window
  path. The Debian package declares `xwayland` as a runtime dependency.
- Vulkan rendering through wgpu. Mesa's lavapipe software Vulkan driver is
  used only by the headless CI probe; it is a compatibility fallback, not a
  performance target.
- A fully opaque GTK/Tauri top-level window. WebKitGTK remains above the native
  surface, so DOM menus and dialogs are not clipped by the viewport.

Other distributions may work when they provide compatible GTK, WebKitGTK,
Vulkan and OCCT 7.9 libraries, but Ubuntu 26.04 is the tested support contract.

## Reproducible container build

```sh
docker build \
  -f scripts/docker/ubuntu-26.04.Dockerfile \
  -t nbcad-ubuntu-26.04 \
  .

docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace \
  nbcad-ubuntu-26.04 \
  sh -lc 'npm ci && cargo install wasm-pack --version 0.13.1 --locked && npm run bundle:linux'
```

The container deliberately extracts only the Ubuntu STEP development headers
from `libocct-data-exchange-dev`; installing that package normally also pulls
the unrelated VTK/IVTK development stack. Its matching OCCT runtime and the
lower-level OCCT development packages are installed normally.

## Native Ubuntu build dependencies

The authoritative dependency list is in
`scripts/docker/ubuntu-26.04.Dockerfile` and the `build-linux-ubuntu` job in
`.github/workflows/desktop-packages.yml`. It includes:

- GTK 3, WebKitGTK 4.1, Ayatana AppIndicator and librsvg;
- Vulkan, Wayland, X11/XKB and udev development files;
- OCCT 7.9 foundation, modeling and data-exchange libraries/headers;
- Rust stable, Node 22, npm and `wasm-pack` 0.13.1; and
- Tauri packaging utilities including `patchelf`, `file`, and FUSE 2.

After installing those dependencies:

```sh
npm ci
cargo install wasm-pack --version 0.13.1 --locked
npm run bundle:linux
```

Artifacts are written under:

```text
src-tauri/target/release/bundle/deb/*.deb
src-tauri/target/release/bundle/appimage/*.AppImage
```

Each artifact has a neighboring `.sha256` file. The bundler fails if the
project, third-party, OpenCascade.js, OCCT copyright, or LGPL notices are
missing from either package.

## Native viewport verification

The release workflow launches the final AppImage in Xvfb and the executable
from the final Debian package in a headless Weston/XWayland session. GTK 3
does not expose an independent child `wl_surface` for the drawing widget; using
its top-level surface would let GTK and Vulkan attach competing buffers. The
application therefore selects the reliable X11 child-window backend on both
desktop types. The development-only readiness probe confirms the X11/XWayland
surface, Vulkan renderer, physical size, and rendered frame count. It records
no pointer or model data.

Manual verification on an Ubuntu SDK image uses:

```sh
scripts/verify-linux-viewport.sh path/to/noBS-CAD.AppImage x11 /tmp/nbcad-x11
scripts/verify-linux-viewport.sh path/to/noBS-CAD.deb xwayland /tmp/nbcad-xwayland
```

## 3D mouse permissions

Linux HID devices can require a distribution udev rule before an unprivileged
application may open their `hidraw` node. Install the vendor's Linux driver or
an administrator-provided least-privilege udev rule for the specific device,
then reconnect it. Do not run noBS CAD as root. Ordinary mouse, touchpad and
keyboard navigation do not require extra permissions.

## Scope

The CI release is x86_64. The source and Ubuntu SDK also compile on AArch64,
but an AArch64 release artifact is not part of the official matrix yet. Package
installation, signing/repository distribution, and automatic udev-rule setup
remain separate release-engineering work.
