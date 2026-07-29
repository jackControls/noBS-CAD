# Agentic guidance — Bevy + related systems

## Priority queue (do not jump blindly)

1. MCP focus / co-link / multi-window (#10–#12) — product harness
2. Manufacturing 3MF / materials (#13) — additive goal
3. Bevy viewport spike (#20) — **isolated**; OK to advance on its own worktree

## Boundaries

```text
OCCT / nbcad_solid  →  TessellatedTriangleSoup  →  ViewportBackend (Bevy | Three.js)
        ↑ geometry truth              ↑ display only
```

- Prefer MCP to reproduce modeling bugs (one MCP process per part).
- Prefer Bevy crates for viewport experiments; do not rewrite ribbon in Bevy.
- Face/edge/sketch IDs stay stable in the kernel — Bevy picks are entity/mesh until mapped.

## Where to edit

| Concern | Location |
|---------|----------|
| Bevy spike code | `crates/bevy_viewport/` + `AGENTIC.md` there |
| Launcher | `crates/bevy_launcher/` |
| Three.js viewport (product UI) | `src/components/viewport/` |
| Tessellation source | `crates/occt` / solid kernel DTOs |

## Validation

See crate AGENTIC.md. Always update SPIKE.md evidence when claiming “works”.
