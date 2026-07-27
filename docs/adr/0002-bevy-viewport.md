# ADR 0002 — Bevy as viewport / ECS subsystem

- Status: Proposed — **deferred this quarter**
- Date: 2026-07-27
- Tracking: [#20](https://github.com/jackControls/noBS-CAD/issues/20)
- Queue: **after** MCP focus (#10), co-link (#11), multi-window (#12)

## Context

The interactive viewport uses Three.js from the React app. That works for
browser e2e but couples rendering, picking, and input to the web stack. Bevy
is a Rust engine with ECS, input, and rendering suited to a native desktop
CAD viewport.

Bevy must **not** replace OCCT. Solids remain B-rep; Bevy displays tessellated
meshes, handles camera/picking/gizmos/3D-mouse, and hosts selection visualization.

## Decision (proposed)

1. Introduce a `bevy_viewport` (name TBD) crate behind a **viewport trait**.
2. Phase 1: spike — mesh draw + camera + pick ray from tessellation.
3. Phase 2: desktop shell embeds Bevy; React overlays remain for dialogs initially.
4. Phase 3: retire Three.js on desktop; browser may keep Three/WASM longer.

## Consequences

- Clear boundary: OCCT = truth, Bevy = presentation/interaction.
- Larger Rust desktop binary; need careful feature flags.
- License audit into `THIRD_PARTY_NOTICES.md` before merge.
- 3Dconnexion / 6DoF input can move closer to Rust HID paths already in Tauri.

## Non-goals

- Rewriting ribbon UI in Bevy in the first spike
- Mesh-only modeling
- Jumping the queue ahead of the MCP harness / co-link work
