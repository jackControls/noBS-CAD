# noBS CAD knowledge update log

## 2026-09-19 — sync docs/machine-design-kb onto main

Replayed help/KB unique work onto `origin/main` tip (full 139-commit rebase abandoned:
~254 conflicted paths). Added `crates/help` + MCP `cad_help`, expanded machine-design
pages (taxonomy, fasteners, materials, search-index), agent-mcp-workflow doctrine, and
kept main's product concepts (gears, workholding, bearings, wind) plus existing
`resources/*` bundle.


## 2026-09-13

- Added four mechanical-design articles covering datums, fits, manufacturing
  and assembly decisions. The existing native MCP resource inventory embeds
  and serves them with the rest of the knowledge bundle.
- Consolidated useful materials/hardware guidance; removed placeholder pages,
  unused search exports and unimplemented search/UI proposals.
- Extended the knowledge gate to validate source provenance and recipe references.

## 2026-09-11
- **Update**: Added actual G-code footprint, bridge-anchor and preceding-layer checks; zero support paths alone do not establish printability.
- **Update**: Added small-generator/rotor/load matching and bearing/axial-retention guidance, with manufacturer and experimental references. Both use the existing automatic MCP resource inventory.
- **Update**: Added sourced gear-identification/pair-design and additive-workholding guidance.
- **Integration**: Native MCP resources expose the same Markdown corpus offline; no separate knowledge store or modeling tool.
- **Maintenance**: Updated MCP and export concepts to distinguish implemented development-branch behavior from physical qualification.
- **Validation**: Existing OKF/link checks and native resource discovery/read/error tests.

## 2026-07-29

- **Update**: Aligned the bundle with OKF v0.2 and current `main`.
- **Validation**: Added automated structure and internal-link checks.

## 2026-07-28

- **Update**: Aligned concepts with maintainer feedback — goals vs proposals,
  co-link first / multi-window deferred, and agent steering files kept internal.

## 2026-07-27

- **Creation**: Seeded the bundle from the README product stance and MCP docs.
