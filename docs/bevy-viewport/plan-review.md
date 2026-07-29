# Plan vs achieved — Bevy Viewport Spike

Source plan: worktree spike for issue #20 / ADR 0002 (Bevy 0.19, desktop+wasm launcher, validation, SPIKE notes, PR). Manufacturing export explicitly out of scope.

## Matrix

| Plan item | Achieved? | Evidence / notes |
|-----------|-----------|------------------|
| New worktree `../noBS-CAD-bevy`, branch `issue/20-bevy-viewport` | Yes | Worktree + PR #25 |
| Leave manufacturing WIP untouched | Yes | Separate checkout |
| `nbcad-bevy-viewport` + `ViewportBackend` | Yes | Modularized under `src/` |
| Fixture tessellation (not OCCT-gated) | Yes | `TessellatedTriangleSoup::unit_cube` |
| Bevy 0.19.0 pin | Yes | `Cargo.toml` |
| Desktop: mesh + orbit + pick | Yes | Binary smoke + unit tests; orbit look-at regression test |
| Wasm: build + serve + visible mesh | Yes | Browser validation after camera fix |
| Launcher desktop \| wasm | Yes | + `--release` for practical wasm |
| SPIKE.md findings + license | Yes | + OKRs, INDEX tree, AGENTIC |
| PR to jackControls | Yes | https://github.com/jackControls/noBS-CAD/pull/25 |
| Replace Three.js / Tauri embed | No (non-goal) | Correctly deferred |
| Face-stable picking | No (gap) | Documented as next KR |

## Implementation review (visionary)

**Strengths**

- Clear trait boundary matches ADR 0002 and keeps vcpkg out of the spike.
- Shared binary for desktop/wasm reduces drift.
- Orbit bug found in validation — good signal the test loop works.

**Gaps to close before productizing**

1. Feed live OCCT tessellation (`KernelBodyDto`) instead of fixture only.
2. Orthographic camera mode for CAD dimensions (Bevy projection guidance).
3. Triangle → face/edge ID map owned by kernel; Bevy only displays highlights.
4. Release wasm size / feature flags; avoid shipping debug ~380 MB modules.
5. Eventual Tauri embed or render-to-texture for React chrome (Bevy `ViewportNode` patterns).

**Related systems**

- Pmetra/Truck-style async tessellation is a useful pattern for not blocking the UI thread once OCCT feeds Bevy.
- MCP co-link remains the higher-priority agent harness; Bevy should stay a parallel spike until ADR 0002 is accepted.

## Completion checklist (this follow-up)

- [x] Module split + indexes at crate/src/web/crates/docs
- [x] OKRs + agentic guidance (committed filenames)
- [x] Plan-vs-achieved review doc
- [x] Orbit look-at unit test
- [x] Launcher `--release` for wasm
- [x] Re-run `cargo test` / desktop smoke / document in SPIKE after this commit
