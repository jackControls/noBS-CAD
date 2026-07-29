# Bevy CAD shell — UI ports

**Parent guide:** [README.md](README.md)

Research basis: Bevy **0.19 Feathers** is the first-party toolkit for editor/inspector UI.

## Ports from current React CAD

| # | React source | Bevy surface | Bridge |
|---|--------------|--------------|--------|
| 1 | App mode / ribbon | Mode buttons: Sketch / Solid / **Simulate** | `SetMode` → `CadMode` States |
| 2 | `BodyAppearancePanel` | Appearance pane + swatches (Solid) | `ApplyAppearance` → `CadSession` |
| 3 | (simulation vision) | Analysis pane + Virtual/Fixed cantilever | `SetSimLoad` / `ToggleSimPause` / `SetSimSpeed` |
| 4 | `SelectionReadout` | Telemetry pane | `SetSelection` / pick bridge |

## Behavior that must work

- Mode buttons / 1–2–3 update `CadMode` and pane visibility.
- Appearance = Solid only; Analysis = Simulate only.
- Simulate is a **mock** cantilever on game time (not FEA). Scroll always zooms; load is `[` `]` / buttons.
- Preset click retints the orange fixture (Solid).

## Architecture

```text
Feathers chrome ──messages──► Session / Sim plugins
CadMode States ──OnEnter/OnExit──► solid layer · sim world · camera bookmarks
```

## Launcher

```bash
cargo run -p nbcad-bevy-launcher
# [1] desktop       — native viz + UI + bridge
# [2] experimental  — wasm browser (+ LAUNCH_URL.txt)
```
