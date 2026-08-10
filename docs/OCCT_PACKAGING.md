# OCCT Packaging and Browser/WASM Strategy

Status: implemented for the current macOS, Windows x64, and browser baseline.

## 1. Ownership boundary

noBS CAD does not keep separate native and browser CAD models.

```text
Sketch/document state
        │
        ▼
Rust solid planner (definitions, history, IDs, reference validation)
        │ serialized RecomputePlan
        ├───────────────────────────┐
        ▼                           ▼
Native OCCT 7.9.x             OpenCascade.js
`crates/occt`                 `src/engine/occtBrowser.ts`
        │                           │
        └──────── KernelScene ──────┘
                    │
                    ▼
       Rust validation + commit + document DTO
```

`crates/solid` is authoritative for:

- feature definitions and replay order;
- rollback/recompute transactions;
- stable `BodyId`, `FaceId`, and `EdgeId` assignment;
- profile and target validation;
- planar-face references and broken-reference errors;
- mesh, face, edge, and plane DTO validation.

The native and browser adapters are deliberately narrow: construct OCCT shapes,
perform booleans, tessellate, enumerate topology, return `KernelSceneDto`, and
serialize selected live B-reps to AP242 STEP. **STL / 3MF mesh packaging** is
native + MCP only today (`nbcad-export`); the browser adapter throws
`file.meshNativeOnly` until explicit parity work.

On native OCCT, the writer is constructed first, schema index 5 is selected,
and `STEPControl_Writer::Model(Standard_True)` creates a fresh AP242 model
before transfer. Without that final new-model step OCCT silently retains its
default AP214 model.

## 2. Native development

The bridge is implemented with `cxx` in `crates/occt`. It is tested with
OCCT 7.9.3 and accepts any compatible 7.9.x SDK during local development.

Homebrew setup:

```sh
brew install opencascade
cargo test -p nbcad-occt --features native-occt
cargo check --manifest-path src-tauri/Cargo.toml
```

Pinned SDK setup:

```sh
export OCCT_ROOT=/absolute/path/to/opencascade-7.9.3
cargo test -p nbcad-occt --features native-occt
```

`OCCT_ROOT` must contain `include/opencascade` (or `include`) and `lib` (or
`lib64`). A Windows SDK may use `inc` plus a supported `win64/vc*/lib`
directory. Homebrew locations are probed only when `OCCT_ROOT` is absent.

## 3. Reproducible macOS application bundle

Do not ship a Tauri binary linked directly to `/opt/homebrew` or another SDK
prefix. Copying dylibs without changing the executable's load commands is not
sufficient.

Use the single supported entry point:

```sh
npm run bundle:macos
```

The command:

1. rebuilds the generated Rust WebAssembly frontend package;
2. runs `scripts/stage-occt-macos.mjs`;
3. discovers the recursive OCCT/TBB dylib closure with `otool -L`;
4. copies the closure to generated `src-tauri/occt-libs`;
5. changes dylib IDs and non-system dependencies to `@rpath`;
6. stages the project license, third-party notices, OCCT license and exception,
   and the OpenCascade.js license;
7. generates `src-tauri/tauri.occt.conf.json` for Tauri's frameworks and
   resources;
8. links the Rust executable against those staged libraries and adds
   `@executable_path/../Frameworks` to `LC_RPATH`;
9. creates the `.app` and `.dmg`, seals local builds ad hoc when no signing
   identity is supplied, and verifies both the code signature and disk image.

The generated staging directory and config overlay are intentionally ignored.
The results are:

```text
src-tauri/target/release/bundle/macos/noBS CAD.app
src-tauri/target/release/bundle/dmg/noBS CAD_0.1.0_aarch64.dmg
```

Useful manual release audit:

```sh
APP="src-tauri/target/release/bundle/macos/noBS CAD.app"
otool -L "$APP/Contents/MacOS/nbcad"
otool -l "$APP/Contents/MacOS/nbcad"
codesign --verify --deep --strict "$APP"
```

All non-Apple OCCT/TBB loads must be `@rpath/...`; the app must contain the
matching files under `Contents/Frameworks`. The license files must be present
under `Contents/Resources/licenses`.

STEP import/export adds `TKDESTEP`, `TKXSBase`, and `TKDE` as direct native
entry libraries. The staging script discovers their larger recursive closure
exactly like the modeling libraries; do not hand-maintain a partial STEP dylib
list.

For signed/notarized releases, the `v*` tag path in
`.github/workflows/desktop-packages.yml` imports a **Developer ID Application**
identity, enables hardened runtime, submits the app to Apple's notary service,
waits for Tauri to staple the ticket, and verifies both Gatekeeper assessment
and the stapled ticket. Pull-request and manually dispatched diagnostic builds
remain ad-hoc signed; the local ad-hoc seal is a verification aid, not
distribution signing.

Production tag builds require these GitHub Actions repository secrets:

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE` | Single-line base64 encoding of the exported Developer ID Application `.p12`, including its private key |
| `APPLE_CERTIFICATE_PASSWORD` | Password chosen when exporting that `.p12` |
| `APPLE_API_ISSUER` | App Store Connect API issuer UUID |
| `APPLE_API_KEY` | App Store Connect API key ID |
| `APPLE_API_PRIVATE_KEY` | Complete contents of the downloaded `AuthKey_*.p8` private key |

Never commit these values. The workflow creates an ephemeral keychain, accepts
only an identity whose certificate name starts with `Developer ID Application`,
and removes the certificate archive, notary key, and keychain in an `always()`
cleanup step. An `Apple Development` identity is suitable for development but
is deliberately rejected at the production boundary.

Before creating a tag, run **Desktop packages** manually with
`macos_signing: production`. That exercises the same stripped,
Developer-ID-signed, notarized, and stapled path without publishing a release.
The default manual option, `diagnostic`, remains ad-hoc signed.

## 4. Reproducible Windows portable build

The first Windows target is x64 Windows 10 version 1803 or newer and Windows
11. It uses the system WebView2 runtime and requires Microsoft's centrally
installed Visual C++ v14 x64 Redistributable.

The root `vcpkg.json` pins both the vcpkg registry and OCCT 7.9.3. The Windows
packager compiles the Tauri executable with `--no-bundle`, copies the complete
DLL set from the isolated vcpkg prefix beside the executable, adds licenses,
and creates a ZIP plus SHA-256 file:

```powershell
$env:OCCT_ROOT = "$PWD\vcpkg_installed\x64-windows"
npm run bundle:windows:portable
```

The desktop packaging GitHub Actions workflow uses one lightweight path
classifier and then conditionally runs the affected package jobs. It builds the
Windows package on `windows-2025` and the Apple-silicon DMG on `macos-15`,
launch-smoke-tests both packaged executables, and uploads the package plus its
SHA-256 file. Documentation-only pull requests skip both expensive runners.
See [Windows portable packaging](WINDOWS_PACKAGING.md) for exact Windows setup
and runtime requirements.

## 5. Browser/WASM development

The browser host combines two WASM modules:

- `nbcad_wasm`: Rust product engine and recompute planner;
- exact `opencascade.js@2.0.0-beta.b5ff984`: B-rep kernel.

Build and run:

```sh
npm install
npm run build:wasm
npm run dev
```

`src/engine/occtBrowser.ts` is loaded dynamically only when a solid operation
first needs it. It consumes the same Rust `RecomputePlanDto` contract used by
the native bridge and returns the same `KernelSceneDto`.

The same adapter owns live browser B-reps and uses `STEPControl_Writer` for
AP242 export through Emscripten's in-memory filesystem. STEP bytes are passed to
the shared frontend file layer; display meshes never participate.

The current production Vite build emits approximately:

- 50 MB raw (about 14 MB gzip) for the full OpenCascade.js WASM module;
- 2.1 MB raw (about 0.7 MB gzip) for the noBS CAD Rust WASM module.

The full prebuilt module is acceptable for current development and browser preview.
Before public browser distribution, generate a custom OpenCascade.js build that
contains only the symbols reached by `occtBrowser.ts`, then lock it by content
digest and run the native/browser conformance suite. Threaded OpenCascade.js is
deferred until hosting provides COOP/COEP cross-origin isolation.

## 6. Version and CI policy

- Local development: Homebrew OCCT 7.9.x is supported.
- macOS CI currently installs the Homebrew OCCT formula, requires it to resolve
  to exactly 7.9.3, and passes its prefix through `OCCT_ROOT`. Move signed
  releases to an immutable 7.9.3 SDK artifact before treating the workflow as a
  reproducible release authority.
- Windows CI: use the committed vcpkg baseline and OCCT 7.9.3 override,
  installed as the dynamic `x64-windows` triplet. Preserve vcpkg binary
  packages in an ABI-keyed CI cache; a cache miss must rebuild from the pinned
  sources.
- Browser: keep the exact OpenCascade.js package version; upgrades require
  native/browser conformance fixtures and a checked bundle-size report.
- The lockfile is committed with the exact browser-kernel package resolution.
- A release is blocked by absolute non-system dylib paths, signature failure,
  mismatched topology IDs, or divergent native/browser feature results.

## 7. Current limitations

- `To Face` supports a parallel planar target face.
- `Through All` uses a finite ±1,000,000 mm construction extent.
- Taper is a uniform centroid-scaled loft, not yet production draft analysis.
- Multiple disjoint and nested profile loops are supported. Odd-depth loops are
  cut as holes and even-depth loops become material regions, including islands.
  Ambiguous touching or self-intersecting boundaries are rejected upstream.
- Stable topology IDs persist when the adapter returns the same topology key.
  Topology-changing edits and booleans can intentionally invalidate downstream
  face references; the timeline then reports a broken reference.
- Public-web payload optimization and native/browser fixture automation remain
  release hardening work.

## 8. Upstream references

- OCCT build guidance: <https://dev.opencascade.org/doc/overview/html/build_upgrade__building_occt.html>
- OCCT meshing guidance: <https://github.com/Open-Cascade-SAS/OCCT/wiki/mesh>
- Homebrew OCCT formula: <https://formulae.brew.sh/formula/opencascade>
- Tauri Windows prerequisites: <https://v2.tauri.app/start/prerequisites/>
- Microsoft Visual C++ runtime deployment:
  <https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files>
- vcpkg binary caching:
  <https://learn.microsoft.com/vcpkg/users/binarycaching>
- OpenCascade.js prebuilt workflow: <https://ocjs.org/docs/app-dev-workflow/pre-built>
- OpenCascade.js custom builds: <https://ocjs.org/docs/app-dev-workflow/custom-builds>
- OpenCascade.js file size notes: <https://ocjs.org/docs/getting-started/file-size>
- Tauri macOS dynamic libraries: <https://v2.tauri.app/distribute/macos-application-bundle/>
