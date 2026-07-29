# Bevy CAD shell — UI ports

Research basis: Bevy **0.19 Feathers** is the first-party toolkit for editor/inspector UI (not games). Prefer it over egui for an eventual all-Bevy product path.

## Three ports from current React CAD

| # | React source | Bevy surface | Bridge |
|---|--------------|--------------|--------|
| 1 | App mode / ribbon Sketch↔Solid | Top **Mode** bar (`FeathersButton`) | `CadSession.mode` |
| 2 | `BodyAppearancePanel` color/material | Right **Appearance** swatches | `CadSession.color` + `material_name` → mesh tint |
| 3 | `SelectionReadout` | Bottom **Selection** panel | `CadSession.selection` from mesh picks |

## Architecture

```text
Feathers UI ──writes──► CadSession (Resource) ◄──writes── mesh picking
                              │
                              ├──► Mode / material labels
                              └──► FixtureBody StandardMaterial.base_color
```

OCCT / `SketchManager` remain future owners of truth; `CadSession` is the local stand-in for the Rust bridge.

## Launcher

```bash
cargo run -p nbcad-bevy-launcher
# [1] desktop       — native viz + UI + bridge
# [2] experimental  — wasm browser
```
