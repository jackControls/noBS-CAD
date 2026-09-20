# Agentic evals (draft)

Tiny golden set for harness regression. Expand later; keep hermetic.

## Modeling (E1–E5)

| ID | Task | Pass |
|----|------|------|
| E1 | `cad_help` search/get first, then `resources/read` `nbcad://knowledge/...` when the full page is needed | Search selects a page; full-page markdown is non-empty via true MCP resources |
| E2 | `fillet-basics` recipe `mode:fast` headless | All recipe checks pass |
| E3 | After E2, edit stock extrude 12→18 mm via `solid_edit_extrude` | `solid_extrude_definitions` distance 18 |
| E4 | Replay E2 twice independently (fresh MCP processes) | Matching checks_completed + body presence |
| E5 | One-step: `cad_new_project` → sketch rectangle → extrude → `solid_scene` | Stable body id; no invented tools |

Design Ops runner:

```bash
source /home/box/nobs-cad-env.sh
python3 /workspace/cad-design-ops/evals/run_modeling_goldens.py
```

Fixtures/results: `modeling-goldens.json`, `modeling-golden-results.md` under `/workspace/cad-design-ops/evals/`. Shared stdio helper: `mcp_stdio.py`.

Record: server revision, elapsed_ms, pass/fail/skip, tool error strings. Prefer honest SKIP over inventing geometry APIs.

## Help MCP wire (H1–H8 core; H9–H41 corpus)

In-process BM25 unit tests live in `crates/help`. **Wire** goldens exercise the installed stdio binary the Cursor client uses (`tools/call` `cad_help`).

```bash
source /home/box/nobs-cad-env.sh
python3 /workspace/cad-design-ops/evals/run_help_goldens.py
# optional modeling smoke from help runner:
python3 /workspace/cad-design-ops/evals/run_help_goldens.py --bonus-e2
```

Fixtures/results stay under `/workspace/cad-design-ops/evals/` (`help-goldens.json`, `help-golden-results.md`).

| ID | Call | Pass |
|----|------|------|
| H1 | search `clearance fit` | top/any id contains `fits-clearances` |
| H2 | search `draft angle` | DFM / draft hit |
| H3 | search `cad_help tenacity` | `agent-mcp-workflow` |
| H4 | get `machine-design.concepts.fits-clearances` | body non-empty; related_recipes includes a known recipe |
| H5 | get path-like id | `isError` / allowlist rejection |
| H6 | search `limit=100` | ≤10 hits (clamped) |
| H7 | topics | total > 0, page ≤50 |
| H8 | search `fillet` | some hit `related_recipes` includes `fillet-basics` |
| H35 | search `interference fit shaft hole` | top/any `fits-clearances` |
| H36 | search `datum sketch plane coordinate system MCP` | `datum-sketch-plane-choice` |
| H37 | search `inspect between mutates solid_scene` | `inspect-between-mutates` |
| H38 | search `hole wizard vs modeled hole` | `hole-wizard-vs-modeled` |
| H39 | search `edit history not delete-rebuild` | `edit-history-not-delete-rebuild` |
| H40 | search `export preflight 3MF vs STL` | `export-preflight-3mf-stl` |
| H41 | search `unit systems mm default formula dims` | `unit-systems-mm-default` |

Caps **confirmed** 2026-09-19 (H1–H8 core); corpus through **H41** (2026-09-20): search default 5 / max 10, snippet ~280, get 12 KiB, topics page 50. Locked in `docs/machine-design-help-search.md`. Retune only from honest FAIL notes — do not silently weaken goldens.
