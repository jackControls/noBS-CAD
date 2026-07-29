# Bevy Feathers UI on native viewport

**Issue:** [#29](https://github.com/jackControls/noBS-CAD/issues/29)  
**Baseline:** `Bevy-test`  
**Branch:** `issue/29-bevy-feathers-ui`

## Goal

Feathers panes for viewport-adjacent chrome on the native Bevy app — not a second standalone Bevy window.

| Layer | Owner |
|-------|--------|
| B-rep, tessellation, face picks | OCCT + native Bevy |
| Orbit / sketch pointer | React (`cadInteraction`) |
| Menus, tabs, dialogs | React |
| Mode / Appearance / Selection near viewport | **Feathers** (this work) |

## First slice

1. Enable `bevy_feathers` on macOS/Windows Bevy deps in `src-tauri`.
2. Show one pane (Mode or Selection) in the native app.
3. Wire actions to existing presentation/session state.
4. Keep OCCT paint, picks, and overlay holes working.

## Out of scope

- Merging spike crates `bevy_viewport` / `bevy_launcher`
- Bevy in the browser
- Full ribbon rewrite
- Replacing React menus

## Spike notes

PR [#25](https://github.com/jackControls/noBS-CAD/pull/25) proved Feathers patterns on Bevy 0.19. Details: [../bevy-viewport-spike-learnings.md](../bevy-viewport-spike-learnings.md).
