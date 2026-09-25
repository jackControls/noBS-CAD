# crates/ index

Host-neutral Rust CAD crates (shared by UI / WASM / MCP where applicable).

| Crate | Role |
|-------|------|
| [`cam/`](cam/) | Host-neutral 3-axis CAM intent, validation, motion planning, volumetric stock simulation, and posts |
| [`print/`](print/) | Reading scanned 2D prints for agents: plate outline calibration, millimetre crops with a grid and hole overlay, ring scores at model holes, hole-symbol detection with coverage matching |
| Other folder names under this directory | Geometry / document / history primitives |

MCP tool surface lives in [../mcp-server/](../mcp-server/), not here.
Agentic docs: [../docs/agentic/INDEX.md](../docs/agentic/INDEX.md).
