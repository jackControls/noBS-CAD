# Bevy Feathers UI on native viewport

**Issue:** [#29](https://github.com/jackControls/noBS-CAD/issues/29)  
**Baseline:** `Bevy-test` (native Bevy paint + OCCT)  
**Worktree:** `noBS-CAD-bevy-feathers` / branch `issue/29-bevy-feathers-ui`

## Job

Use **Bevy Feathers** for viewport-adjacent product chrome (the easy UI job) on Jack’s native embed — not a second standalone Bevy window.

```text
React (menus, dialogs, a11y, pointer kernel)
        │
        ▼
native_viewport (Bevy paint + OCCT meshes + picks)
        │  + Feathers panes (this work)
        ▼
Mode / Appearance / Selection / (later) Analysis
```

## Ownership split

| Surface | Owner now | Target |
|---------|-----------|--------|
| B-rep / tessellation / face picks | OCCT + native Bevy | unchanged |
| Orbit / sketch pointer | React `cadInteraction` | unchanged for this issue |
| Menus, tabs, modal dialogs | React | keep |
| Mode / appearance / selection readout near viewport | React overlays | **Feathers in Bevy** |
| Simulate mock clocks | — | later (spike pattern only) |

## Spike harvest (do not merge crates)

From draft PR [#25](https://github.com/jackControls/noBS-CAD/pull/25) / issue [#20](https://github.com/jackControls/noBS-CAD/issues/20):

- Feathers Mode / Appearance / Analysis / Telemetry patterns work on Bevy **0.19**
- Prefer **product copy** + command messages; no debug HUD strings
- Keep Bevy **feature-pruned** (`default-features = false`) — already true on `Bevy-test`; add `bevy_feathers` (+ widgets) only when wiring chrome
- Treat chrome as its own plugin/module — avoid growing `platform.rs` further without a split
- Wasm Bevy shell (~35 MB) and standalone launcher are **out of scope** here

## First slice (acceptance for #29)

1. Enable `bevy_feathers` on the native macOS/Windows Bevy deps.
2. Mount one Feathers pane (Mode **or** Selection readout) in the native app.
3. Bridge pane actions ↔ existing session/presentation state (no fixture cube).
4. Confirm OCCT mesh paint + picks still work; overlay holes still clear DOM islands.

## Non-goals

- Merging `crates/bevy_viewport` / `nbcad-bevy-launcher` into this branch  
- Bevy-in-browser  
- Full ribbon rewrite  
- Replacing React menus
