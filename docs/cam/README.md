# CAM documentation

Operator guides and implementation contracts for fixed-axis, three-axis
milling. Supported behavior is specific to this implementation; successful
generation or simulation does not establish machine safety.

| Document | Purpose |
| --- | --- |
| [CAM foundation](../CAM.md) | Tools, setups, units, simulation ownership and safety scope |
| [Machine-aware workflow](../CAM_MACHINES.md) | Setup targets, controller/post gates, compensation and future motion structure |
| [Posts and private profiles](../CAM_POSTS.md) | Library tool calls, controller formats and private user storage |
| [Central tool-library storage](../CAM_TOOL_LIBRARY.md) | Settings, location changes, project isolation and save safeguards |
| [High Speed Roughing](../CAM_ADAPTIVE.md) | Controls, heights, engagement equations and limits |
| [Linking and browser order](../CAM_LINKING.md) | Leads, ramps, drag ordering and clearance proofs |
| [Generation dependencies](../CAM_GENERATION_DEPENDENCIES.md) | Reordering, consumed stock evidence and freshness checks |
| [Shared chains and chamfer](../CAM_EDGE_CHAINS.md) | Automatic/manual chains, multiple boundaries and chamfer geometry |
| [Cutter geometry](../CAM_CUTTER_GEOMETRY.md) | Shared display/removal profiles, drill points and corner shapes |
| [CAM simulation](../CAM_SIM_PLAYBACK.md) | Stock stages, bounded playback buffers and path tracing |
| [Remaining-stock surfaces](../CAM_STOCK_SURFACE.md) | Cutter-aware chamfers/fillets, sharp joins and reconstruction budgets |

## Maintenance

- Update the applicable guide when public behavior changes. Keep internal
  handoffs, reviews, feedback, reference assets and local timing reports outside
  version control.
- Keep portable synthetic test inputs beside their tests, such as
  [lead-clearance cases](../../crates/cam/fixtures/lead-clearance.json).
  Do not commit supplied projects, source posts, private profiles or app builds.
- Separate requested cutting heights, known incoming stock and verification.
  A smooth surface does not prove removed material or cutter clearance.
- Preserve required dependency license notices and canonical icon provenance.
