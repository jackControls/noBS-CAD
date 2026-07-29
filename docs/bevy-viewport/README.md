# Bevy shell — guide for people and agents

Short. Exact. This is the committed agent entry for the Bevy spike  
(root `AGENTS.md` is gitignored in this repo).

**Issue:** [#20](https://github.com/jackControls/noBS-CAD/issues/20) · **PR:** [#25](https://github.com/jackControls/noBS-CAD/pull/25) · **Worktree:** `noBS-CAD-bevy` / branch `issue/20-bevy-viewport`

---

## What this is

A **Bevy 0.19 engine shell** that owns:

1. **Visualization** — tessellated mesh, orbit camera, picking, reference grid  
2. **Tooling UI** — Bevy Feathers (product chrome, not debug HUD)  
3. **Session** — `CadMode` as Bevy `States` + `CadSession` bridge  
4. **Sim mock** — `Time<Virtual>` pause/speed + `FixedUpdate` bend + overstep present  

It does **not** own B-rep. OCCT / `nbcad_solid` stay geometry truth.

```text
OCCT (truth)  →  TessellatedTriangleSoup  →  Bevy (draw + UI + session + game-time mock)
```

### Plugin map

| Plugin | Owns |
|--------|------|
| `ShellPlugin` | Window, DefaultPlugins, Esc quit |
| `SessionPlugin` | `CadMode` States, `CadSession`, command messages |
| `ViewportMeshPlugin` | Soup → mesh, solid fixture, grid |
| `CameraPlugin` | Orbit + per-mode bookmarks; **scroll = zoom** |
| `PickingBridgePlugin` | Picks → selection |
| `ChromeUiPlugin` | Feathers Mode / Appearance / Analysis / Telemetry |
| `InputMapPlugin` | 1/2/3 modes; Space pause; `[` `]` load; `,` `.` `/` speed |
| `SimPlugin` | Virtual + Fixed cantilever mock |

---

## Run it

```bash
cargo run -p nbcad-bevy-launcher
```

| Choice | Meaning |
|--------|---------|
| **1 desktop** | Native window |
| **2 experimental** | Wasm browser — writes `crates/bevy_viewport/web/LAUNCH_URL.txt` |

Skip menu when scripting:

```bash
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target experimental --release
```

Release experimental uses profile **`wasm-release`** (LTO, `codegen-units=1`, `opt-level=s`) and runs `wasm-opt -Os` when Binaryen is on PATH.

**Controls:** RMB orbit · **scroll zoom** · LMB probe (Solid) · Space pause · `[` `]` load · `,` `.` `/` speed · 1/2/3 mode · Esc quit.

Default launch mode: **Simulate** (game-time showcase). Solid remains first-class.

---

## Simulate = game time (mock, not FEA)

- `Time<Virtual>` — pause / relative speed  
- `FixedUpdate` @ 64 Hz — tip-load bend + stress field  
- `Update` — overstep-interpolated segment present  
- Readable cantilever: abutment left, beam, tip load dart  

---

## Where files live

| Path | Role |
|------|------|
| [`crates/bevy_launcher/`](../../crates/bevy_launcher/INDEX.md) | Desktop / experimental chooser |
| [`crates/bevy_viewport/`](../../crates/bevy_viewport/INDEX.md) | Shell crate |
| [`crates/bevy_viewport/src/session.rs`](../../crates/bevy_viewport/src/session.rs) | States + bridge |
| [`crates/bevy_viewport/src/chrome_ui.rs`](../../crates/bevy_viewport/src/chrome_ui.rs) | Feathers chrome |
| [`crates/bevy_viewport/src/sim/`](../../crates/bevy_viewport/src/sim/) | Virtual / Fixed mock |
| [`SPIKE.md`](../../crates/bevy_viewport/SPIKE.md) | Findings + measured wasm size |
| [`ui-ports.md`](ui-ports.md) | Port table |

---

## Rules (hard)

1. **No OCCT dependency** in `nbcad-bevy-viewport`.  
2. **No full ribbon rewrite** in this spike.  
3. **Do not commit** `web/bevy_desktop.js` or `*.wasm` (generated).  
4. **Picks are mesh-level** until the kernel maps triangles → face/edge IDs.  
5. **MCP co-link (#10–#12)** stays higher priority for the product harness.

---

## Edit map (agents)

| If you need to… | Edit |
|-----------------|------|
| Change launcher / wasm-opt | `crates/bevy_launcher/src/main.rs` |
| Change modes / session commands | `session.rs` |
| Change Feathers panels | `chrome_ui.rs` |
| Change hotkeys | `input_map.rs` |
| Change solid mesh / grid | `viewport_mesh.rs` |
| Change orbit / zoom | `camera_ctrl.rs` |
| Change sim clocks / bend | `sim/` |
| Change plugin list | `app.rs` |

---

## Prove it before you claim it

```bash
cargo test -p nbcad-bevy-viewport --lib
cargo run -p nbcad-bevy-launcher -- --target desktop
cargo run -p nbcad-bevy-launcher -- --target experimental --release
```

Update [`SPIKE.md`](../../crates/bevy_viewport/SPIKE.md) when sizes or architecture change.

---

## Done looks like

- Launcher offers **desktop** and **experimental**.  
- Simulate runs under Virtual time; Space pauses Fixed bend.  
- Scroll always zooms; load is `[` `]` / UI.  
- Release wasm well under the old ~123 MB path (see SPIKE measured size).
