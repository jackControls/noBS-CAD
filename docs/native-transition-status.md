# Native transition status

Checkpoint: **2026-10-04 UTC**. The default desktop on the Bevy integration branch
uses **Bevy `=0.20.0-rc.2`**, application version **0.2.2**, one native host and
one shared CAD/CAM command path. The integration is tracked by
[PR #124](https://github.com/jackControls/Limo-CAD/pull/124) and has not merged
into `main`. Passing required checks and an external approval remain merge gates.

The public [Bevy preview](https://github.com/jackControls/Limo-CAD/releases/tag/bevy-preview-0.2.2-20261002.3)
contains **Windows x64 ZIP and Ubuntu 26.04 x64 DEB from `82cd981e`**.
A newer Windows package from clean source **`39f728dd`** is installed at
`%LOCALAPPDATA%/nbcad/bevy/noBS-CAD.exe`. This local deployment does not replace
the public assets or qualify current Linux/macOS packages. Later integration
commits also require package qualification; application version alone does not
identify which source was built. Published packages retain the former noBS CAD
name while the repository and public project name are Limo CAD.

## Implemented desktop

Bevy owns modeling/sketching, feature forms and history, assemblies and joint
motion, drawing authoring/reference repair/output, CAM, Scripts and lessons,
preferences/localization, file/window lifecycle, printing, accessibility, IME
and 6DoF input. Document units retain the shared engine's read-only contract.
The native document/OCCT host lives in `crates/native-engine`; the desktop uses
a small adapter. Its optional `native-occt` feature owns transactions, exports,
geometry revisions and tab retention without a Bevy/window dependency.
Ordinary engine builds leave that feature disabled and require no native SDK.

The conversion includes:

- Persisted interface sizes from 90% to 175%, independent cross-window refresh,
  matching layout/scale publication, and guarded pointer/text/composition state.
  The follow-up audit fixes large-size sketch menus, origin controls, drawing
  menus and CAM report bounds. Current main's normalization and Ctrl/Cmd
  plus/minus/zero shortcuts are preserved (#211, #213, #215, #251).
- Independent CAM height references for planar faces, level edges, vertices,
  sketch points and level sketch lines. The shared resolver supplies stable
  identities through the existing bounded picker and draft/Apply path (#212).
- Associative drawing exports, placed views and reference repair; installed-font
  outlines for Unicode DXF labels and native printing. Unsupported glyphs fail
  before output. Saved drawing DTOs, placement and paper size remain authoritative.
- Production AccessKit bindings with current control/document/modal guards,
  Windows UI Automation text editing, and read-only/writable field distinctions.
  IME caret placement follows visible field bounds and scale changes; provisional
  composition retains the existing editor checkpoint and committed text.
- Restored inactive-tab eviction, including finished-sketch Undo/Redo (#222, #249).
- An explicit Winit window-icon binding (#259). The deployed Windows small-icon
  handle and native chrome capture confirm the title-bar fix. The packaged MCP
  passed schema-7 attach, rendered inspect and a read-only assembly query.
- System appearance following (#272). Bevy 0.20 moved Winit windows out of the
  World; querying the obsolete resource always selected Light. The main-thread
  capture now reads initial OS appearance and primary-window theme-change events.
  A focused regression covers Dark/Light changes and ignores other windows;
  explicit appearance preferences still take precedence.

Quick-win fixes retain viewport/input/accessibility state, warm drawing-sheet
projections and CPU rasters, reduce document/scene copies, and use exact completion
revisions and document-specific mesh-cache incarnations. Incoming parent commits,
main's naming/translations/drawing changes and the recovered mechanism-dragging
implementation are preserved. No runtime latency improvement is claimed without
measurement.

## Inactive-tab retention

The former desktop's low-memory eviction was lost when its memory-status caller
was retired. The native watcher now probes physical memory every 30 seconds.
The ordered worker makes eligible inactive tabs cold after 60 minutes; constrained
memory evicts the oldest eligible tab and critical memory evicts all eligible
inactive tabs. Active tabs, unfinished sketches and saves in progress are protected.

Cold tabs retain their parametric model, geometry revision, replay baseline,
file/archive ownership, saved receipts and history while releasing the OCCT
engine, Bevy model meshes and drawing caches. Activation rebuilds transactionally
and verifies body identities and feature errors. Failure preserves the snapshot
and previous active tab. The 128-tab bound includes cold tabs.

The October 3 audit also found that serialized reconstruction discarded finished
sketch command stacks. Finished sessions now move into a separate in-memory
retention record, preserving Undo/Redo, runtime editing state and entity identity
high-water marks without retaining an OCCT kernel or solid scene. Rebuilt sketch
states must match before ownership moves; mismatch leaves the snapshot available
for retry. Normal project serialization/schema and file-reopen history policy
are unchanged.

Ten focused Windows tests passed, including real-OCCT reconstruction, repeated
eviction, actual sketch Undo/Redo, rejected restoration and retry, mismatched
sketch-state rejection, file/archive history, protected states, pressure/idle/LRU
policy and drawing-cache isolation. They were isolated in-process checks and did
not change a live document. **The public preview contains the initial eviction
restoration but not the subsequent finished-sketch history fix.**

## Dependencies and build tooling

Rust `1.99.0`, rustfmt and Clippy are pinned together. Bevy stays at rc.2; OCCT
stays on the 7.9 ABI. AccessKit remains on Bevy's `0.24` types, Windows bindings
on wgpu/gpu-allocator's shared `0.62.0` types, and usvg/resvg on `0.45.1` because
svg2pdf `0.13` consumes those trees. These are compatibility constraints.

Repository maintenance uses Rust `cargo xtask`: scoped checks/Clippy, dependency
inventory, deterministic archives, version/tag/repository/icon/knowledge guards,
OCCT SDK orchestration, native fixtures, WASM build/smoke, packaged MCP setup and
Windows ZIP/Linux DEB/AppImage/macOS app/DMG packaging. Builders retain runtime
library and license staging, audits, checksums and platform signing/notarization.

Tauri, embedded WebViews, the `dev-bevy-host` switch, React/Three.js source, npm
manifests/lockfiles, Vite/Tailwind configuration, Node drivers, legacy bundlers
and obsolete browser/desktop IPC harnesses are removed. Native SDK containers
and packaging workflows do not provision Node/npm. Embedded vectors and locale
dictionaries remain in `assets/`; viewport colors live in Rust.

Remaining native OS qualification helpers use shell, PowerShell, Python, C# or
Swift for platform APIs and input. The repository is not entirely Rust.
Retired harness ownership is recorded in [scripts/README.md](../scripts/README.md);
that reassignment does not establish equivalent coverage or passing native cases.
Unused Feathers/scene support, redundant widget declarations, unused icon
variants and GTK/Rsvg AppImage development inputs were removed. Winit's actual
X11/XCB/cursor/input runtime libraries and Linux desktop portals remain required.
`sysinfo` is required again for the portable physical-memory probe.

Focused checks cover Windows desktop/MCP compilation, Rust/wasm32 compilation,
Clippy, repository/version/icon/knowledge guards, package staging/deletion guards,
archive determinism and a fresh engine-facade build. Rust task-runner compilation
also passed for Linux x64 and macOS ARM64; compile checks do not qualify native
packages or signing. No broad validation sweep is being run.

## Deployment and preserved data

The Windows runtime above is canonical. Codex/Cursor MCP settings use it with
`--headless` and `NBCAD_DESKTOP_BIN`, without development SDK paths. The Rust
installer supports in-place packaged runtimes and comment-preserving Codex TOML
(#258; standalone main PR #262). Start-menu, recipe URL, PATH and App Paths
entries select Bevy. Old Downloads, 0.2.0 and MCP directories redirect to it;
executable aliases share the installed file. Projects and session inboxes,
heartbeats, recovery snapshots and source/Git archives remain intact.

The October 4 package includes the System appearance fix and renamed repository
guards. Its packaged and installed Rust MCP probes verify clean source identity,
60 tools and clean transport shutdown. Fresh installed attach and read-only
inspect also passed through the existing live desktop. Only proved canonical
headless workers were restarted; matching DLLs were preserved.
The visible `roller-review.exe` copy was left running with its live session and
old payload. Its owner must save, close it, and launch the canonical Bevy path to
use the fix; reopening that custom copy still uses the earlier binary. Its
inactive copy can be refreshed after the owner closes it. The NATS ready notice
`ce79d816-40e6-49af-ae05-7f608e8956fc` records this deployment distinction.

Inactive MCP backups, dated runtime copies and stale audited build/cache binaries
were retired after checking executable paths and project-file absence. The
project-local `Roller-300/.local/cad-runtime` was closed through the guarded
lifecycle, its published snapshot preserved and its launch directory redirected
to Bevy. Its 57 binary/DLL files remain quarantined in
`cad-runtime-retired-20261003`: automatic approval review rejected deletion with
"blocked by policy". **That purge is outstanding.** Active source worktrees,
including another agent's Bevy build, remain available. Purge receipts and client
configuration backups live outside Git under `%LOCALAPPDATA%/nbcad/maintenance`.

The [Rust agent board](agent-message-board.md) uses a dedicated Home Assistant
NATS JetStream bucket. Deployment notice
`de102169-5ba8-43cd-91a4-40af7d4c48af` was published/read back and supersedes the
maintenance holds. It requests client restart and identifies the canonical
runtime. Publication does not prove every agent read or acknowledged it.
The board does not mutate CAD models or replace the MCP document/session bridge.

## Release qualification still open

The public preview's [tagged package run](https://github.com/jackControls/Limo-CAD/actions/runs/37026966691)
passed SDK-free headless/desktop MCP and owned native input/render checks on
Windows x64, plus headless MCP, X11 input/rendering and Wayland lifecycle/URI
checks on Ubuntu. Checksums and embedded metadata identify the exact clean
`82cd981e` source; a machine-readable build receipt accompanies the packages.

Other preview targets remain withheld:

- **macOS:** compiled and Developer ID signed; Apple notarization returned
  HTTP 403 for a missing/expired team agreement. The account owner must resolve
  that agreement before notarized distribution. No Intel Mac package is qualified.
- **Windows ARM64:** compiled and passed headless checks; the owned input fixture
  refused a click through hosted-runner Start/Search windows. ARM native-input
  qualification remains open.
- **AppImage:** preceding-source build/glibc/headless checks passed and X11 startup
  was reached; input stopped because the host lacked `xclip`/`xdotool`. #223 restores
  those prerequisites. This does not establish current-source package success.

Historical source-specific checks also cover Windows UI Automation, drawings and
Unicode output, CAM, Scripts, mechanisms, preferences and lessons. They do not
establish current-head package/device qualification. Outstanding limits include:

- Current-source Windows/Linux/macOS packages, their launch/interaction checks,
  required PR checks and external review. Stable `v0.2.2` is a separate legacy
  release; its presence cannot qualify the Bevy branch.
- Fresh Windows/macOS Japanese IME evidence for the latest field implementation,
  candidate-popup placement and physical monitor/DPI transitions.
- Physical printing, macOS/Linux OS print dialogs, screen-reader speech,
  actual 6DoF hardware/driver behavior and macOS OS GetURL delivery.
- Broader real-input annotation/joint/gesture workflows. The joint fixture's
  read-only settlement correction has not been rerun; Scripts chooser gestures
  and physical multiline-editor IME are not established by source-level checks.
- Switching sputter attribution. The observed Windows tab/sheet irregularity
  has no matched current-source reproduction or latency benchmark. The optional
  comparison uses native Bevy builds; see [measurement scope](native-switching-measurement.md).

A build, ignored check, stale-source pass or synthetic geometry assertion is not
a current-device runtime pass. Evidence and generated captures are retained
outside product source under `D:/noBS-CAD-builds/finish-bevy-rc2`.

## Browser work still open

The replacement must reuse the desktop Bevy UI. The current Rust WASM engine
facade builds and has focused binding checks; it is not a browser CAD app.
The complete Bevy WASM host, file/storage/dialog services and geometry-service
transport remain unfinished. The planned first browser host offloads geometry
to native Rust/OCCT. The extracted native-engine host is its service-side
foundation. An optional in-browser OCCT WASM backend is separate work; the
native-service approach does not require that port. See [web/README.md](../web/README.md).

## Audited deletions and history

The snapshot [`6394fb44`](https://github.com/jackControls/Limo-CAD/commit/6394fb449f12e17dededd76dc702081ff7c277eb)
was previously mislabeled as an unfinished UI rewrite. Independently formatting
all 81 changed Rust files and their parent versions produced identical output:
it was formatting, not an upcoming feature. Its explicit revert removed no
functional implementation; the source remains reachable from
`feat/bevy-switch-timing`. The experimental accessibility tree at `8986fd77`
remains preserved; the production adapter supersedes its disconnected tree.
Recovered mechanism work remains implemented and documented in
[native-mechanism-drag.md](native-mechanism-drag.md).

Redundant integrated branches/worktrees and backup refs were retired only after
checking source representation and archiving unique history. Active work,
projects/session data and verified Git archives remain protected. Obsolete
September checkpoint prose and duplicated old release/validation narratives
are removed from this active status document; Git history retains them.
