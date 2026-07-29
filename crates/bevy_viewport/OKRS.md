# OKRs — Bevy viewport spike (#20)

Cycle: exploratory spike (pre-ADR acceptance). Owner: spike PR authors. Related: ADR 0002 (PR #5), epic #9.

## Objective 1 — Prove Bevy can be a display shell only

| KR | Target | Status |
|----|--------|--------|
| KR1.1 `ViewportBackend` trait + Bevy 0.19 impl, no OCCT dep in this crate | Done | Met |
| KR1.2 Fixture tessellation draws on **desktop** | Window stays alive; mesh visible | Met |
| KR1.3 Same binary path draws on **wasm** | Init + mesh visible in browser | Met (after orbit fix) |
| KR1.4 Explicit non-goals documented (no ribbon, no mesh-CAD) | SPIKE.md + ADR pointer | Met |

## Objective 2 — Keep agents and humans oriented

| KR | Target | Status |
|----|--------|--------|
| KR2.1 INDEX.md at crate / src / web | Present | Met |
| KR2.2 AGENTIC.md maintenance rules (committed) | Present | Met |
| KR2.3 Launcher chooses desktop vs experimental without memorizing cargo flags | `nbcad-bevy-launcher` | Met |

## Objective 3 — Decide continue vs kill for ADR 0002

| KR | Target | Status |
|----|--------|--------|
| KR3.1 Kill/continue criteria written | SPIKE.md | Met |
| KR3.2 Known gaps listed (face IDs, ortho camera, Tauri embed, wasm size) | SPIKE.md | Met |
| KR3.3 Product wiring deferred until MCP co-link (#10–#12) | Issue #20 priority honored for merge queue | Ongoing |

## Objective 4 — Bevy owns viz + tooling UI + Rust bridge (sample)

| KR | Target | Status |
|----|--------|--------|
| KR4.1 Launcher presents **desktop** vs **experimental** | Met |
| KR4.2 Three React surfaces ported via Feathers | Mode, Appearance, Selection | Met |
| KR4.3 UI and picks share `CadSession` resource | Met |
| KR4.4 Appearance changes tint the 3D fixture | Met |

See [docs/bevy-viewport/ui-ports.md](../../docs/bevy-viewport/ui-ports.md).

## Out of scope this cycle

- Mapping picks → stable OCCT face/edge IDs
- Orthographic CAD camera (recommended next experiment)
- Embedding Bevy inside Tauri / retiring Three.js
- Async tessellation pipeline (see community patterns e.g. Pmetra/Truck)
- Full ribbon / browser tree port

Parent index: [INDEX.md](INDEX.md).
