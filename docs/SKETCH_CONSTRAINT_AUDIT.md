# Sketch constraint audit — 2026-08-29

Hands-on audit of every constraint function in the sketch workspace, driven
through the real UI (Playwright against the web build) plus engine-level
probes where the UI could not isolate a cause. Established mechanical-CAD
sketch behavior is used as the reference bar throughout.

**Environment.** Branch `fix/sketch-cad` at `8d46b18` (origin/main). WASM
engine built the same day from `feature/cam`; `git diff main feature/cam --
crates/sketch/` shows the CAM branch touches only host/lib/manager/project
plumbing — `solver.rs`, `session/`, and `constraint.rs` are identical, so
every finding applies to `main`. Five instrumented UI runs and four
engine-level probe scripts; transcripts referenced below record store state
(`window.__appStore`) after every action.

**Scope.** Coincident, Horizontal/Vertical, Tangent, Parallel, Perpendicular,
Equal, Fix/UnFix, MidPoint, Collinear, Concentric, Symmetry, and the
dimensional constraints (distance / radius / diameter / angle), applied via
the CONSTRAIN ribbon group and the Sketch Dimension tool.

---

## What works — verified good

The core is in better shape than the bug list below suggests. Verified by
driving the actual UI:

| Behavior | Result |
|---|---|
| Shift/Ctrl multi-select toggle, primary = most recent | ✅ `[3]` → `[3,6]`, primary `6` |
| Parallel on free lines | ✅ solves; DOF 8 → 7 |
| Perpendicular on already-parallel pair | ✅ rejected with a **correct, specific** conflict report: *"Cannot add perpendicular between Line3 and Line6: conflicts with parallel(Line3, Line6)"* |
| Collinear | ✅ cross-product ≈ 0 after solve |
| Equal (circles) | ✅ radii converge |
| Concentric | ✅ center distance 5.9e-11 |
| Tangent line↔circle | ✅ gap 7.7e-11 |
| Coincident point↔point | ✅ merged exactly |
| Coincident point↔circle (point-on-rim) | ✅ standard point-on-curve behavior |
| MidPoint (point + line) | ✅ lands at exact midpoint |
| 3-entity multi-select for Symmetry | ✅ `[16,17,15]`, axis = last selected |
| DOF chip | ✅ `DOF: 44` == solver's `dof.value` (44); staircase 8→7 (parallel), −1 per H/V, −3 on Fix of a V-line — all arithmetically right |
| Dimension defaults | ✅ circles get **diameter** (Ø), lines get length — common CAD default |
| Dimension edit gesture | ✅ double-click (or two clicks ≤450 ms) opens the inline formula-capable editor |
| Invalid-selection messages | ✅ specific and actionable, e.g. *"Symmetry needs two entities and an axis line (select axis last)."* |
| Honest placeholders | ✅ AutoConstrain / Curvature rendered disabled, not missing |

The D4.2 leave-one-out conflict finder (`crates/sketch/src/session.rs:2972`)
is genuinely good **when the rejection is a real inconsistency** — it removes
each connected constraint, re-solves, and only names constraints whose removal
makes the new one satisfiable. Bug 3 below is about the path where that
premise fails.

---

## Bug 1 — Symmetry fails on ordinary input when the axis line is free

**Severity: high.** Symmetry is effectively unusable in the standard
draw-roughly-then-constrain workflow.

**Symptom.** Two points (a sketched line's endpoints) + a vertical axis line,
axis selected last: the constraint is rejected. This is the canonical
symmetry workflow — the solver should move the geometry into symmetry.

**Reproduce (UI).**
1. Draw a near-vertical line (it auto-snaps to Vertical) — the axis.
2. Draw a short sloped line anywhere off-axis, e.g. (−18,−44)→(−9,−32).
3. Select its two endpoints, then Shift-click the axis line last.
4. CONSTRAIN → Symmetry.

**Observed.** Dialog: *"Cannot add symmetry between Point16 and Point17 and
Line15: conflicts with vertical(Line15), vertical(Line15)"*. Nothing is
applied. (The duplicated "vertical" in that list is Bug 4; the blame itself is
false — see Bug 3.)

**Convergence envelope (engine-level, isolated fresh document per case).**
Two free points, mirrored pair offset by `off` mm from perfect symmetry about
a free vertical axis line:

| Case | Result |
|---|---|
| off = 1 mm | ✅ solves |
| off = 2 mm | ✅ solves |
| off = 5 mm | ❌ rejected |
| off = 12 mm | ❌ rejected |
| off = 5 mm, **axis Fixed** | ✅ solves (mid-x error 2e-11) |

The identical 5 mm problem converges the moment the axis loses its own DOF.

**Cause (believed).** Solver robustness, not the equations. Symmetry emits
`Eq::SymmetryMid` + `Eq::Dot` (`crates/sketch/src/solver.rs:978-1003`); the
residual/gradient algebra checks out (duplicate sparse entries for a shared
variable sum correctly through the JᵀJ assembly at `solver.rs:1717-1727`).
The failure is the Levenberg–Marquardt loop (`solver.rs:1713-1751`): adaptive
damping only (λ×8 on singular, ×6 on non-descent, ÷4 on success), max 80
iterations, **no line search and no constraint-specific initialization**.
With the axis's four variables free, the mixed point/axis steps stall until
the iteration budget is gone. Fixing the axis removes those directions and
the same LM loop converges immediately.

**Suggested fix.** Either (a) seed the solve for a freshly added Symmetry by
pre-mirroring `b` across the current axis before iterating (cheap and consistent
with the expected behavior of moving geometry to satisfy the new constraint), or
(b) strengthen the LM loop (line search / dogleg, or temporarily down-weight
the axis variables for the first iterations of a symmetry add).

---

## Bug 2 — Circle↔circle Tangent has a non-convergence pocket, and the far case solves by inflating radii

**Severity: medium-high.**

**Symptom.** Tangent between two plainly tangent-able circles is rejected —
but only in a middle band of starting distances.

**Reproduce (engine probe; r = 5 both, external target d = 10).**

| Center distance | Result |
|---|---|
| 10.2 | ✅ centers pulled to d = 10, radii stay 5 |
| 11 | ✅ same |
| 12.5 | ✅ same |
| **15** | ❌ *"Cannot add tangent between Circle7 and Circle8: conflicts with "* (sic — dangling, empty list) |
| 30 | ✅ but by **inflating both radii to 13.47** (d stays ≈26.9 = r1+r2) |

Reproduced in the UI at d = 15 (round-4 `tangent-cc`) and isolated in a fresh
document (`tangent-cc-d15-isolated`).

**Cause (believed).** Same LM robustness gap as Bug 1. The equation
`|c1−c2|² − (r1 + sign·r2)² = 0` and its gradients (`solver.rs:321-343`) are
correct; the external/internal `sign` is chosen once from the starting
geometry (`solver.rs:900`) and never revisited. At d ≈ 1.5× target the
center-shrinking and radius-growing descent directions fight and damping runs
the 80-iteration budget out; nearer starts converge on centers, farther starts
escape via radius growth.

The d = 30 outcome is also a UX finding on its own: mathematically valid, but
no user expects circles they drew at r = 5 to balloon to r = 13.47. A
predictable CAD solve translates circles and preserves their unconstrained
radii. Consider weighting radius variables stiffer than positions during a
tangent add.

---

## Bug 3 — Solver non-convergence is misreported as an over-constraint, with a false or empty culprit list

**Severity: high — this is a trust bug.** It converts Bugs 1–2 from "solver
limitation" into "the software lies about why."

**Symptom.** Every rejection dialog claims a conflict:

- Empty: *"Cannot add tangent between Circle32 and Circle33: conflicts with "* —
  trailing comma-space, nothing after it.
- False: the symmetry case blames `vertical(Line15)` — removing that vertical
  does **not** make symmetry succeed (the axis being free is what breaks it;
  Fixing the axis, the opposite of removing its constraint, is what fixes it).
  A user following the dialog would delete a valid constraint and still fail.

**Cause (proven from code).**
- The add/edit paths treat non-convergence and inconsistency identically:
  `if !analysis.converged || residual > INCONSISTENT_EPS` →
  `SessionError::OverConstrained` (`session.rs:2792`, `session/dims.rs:316`).
- `find_conflicts` (`session.rs:2972-3040`) is a leave-one-out test that can
  only produce evidence when the system is actually inconsistent. On
  non-convergence every leave-one-out solve also fails → empty list → the
  fallback names *all connected non-fix constraints* (the symmetry case's
  "vertical") or, with no connected constraints, nothing (the tangent case).
- The `Display` impl (`session.rs:166`) formats
  `"Cannot add {kind} between {ents}: conflicts with {list}"` without
  handling an empty list.

**Suggested fix.** Track *why* the solve failed: if `analysis.converged` is
false (vs. converged-but-residual-high), return a distinct error — "The
solver could not move the geometry to satisfy {kind}; try dragging the
entities closer to the intended shape first" — and never run the conflict
finder in that case. Also guard the empty-list case in `Display`.

---

## Bug 4 — Exact duplicate constraints are accepted without limit

**Severity: medium.**

**Symptom.** Apply Horizontal/Vertical to an already-horizontal line: another
`horizontal` is added. Again: a third. No dialog, no dedup. The engine-level
probe confirms `horizontalCount: 3` on one line. The same happened with
`vertical` (the symmetry dialog lists `vertical(Line15)` **twice** because the
axis carried an auto-V from draw-time plus a duplicate from the panel).

**Reproduce.** Draw a roughly horizontal line (auto-H applies, see Bug 7);
select it; click Horizontal/Vertical twice. Constraint list now holds three
`horizontal { entity }` rows (ids 1, 2, 3 in the round-2 transcript).

**Cause (proven from code).** The add path accepts any constraint whose
solve converges: `session.rs:2792` rejects only when
`!converged || (!rank_increased && residual > ε)`. A duplicate row is
rank-neutral **and** zero-residual, so it passes. No identity/duplicate check
exists anywhere in the add path, and D4.2 by design only detects
*inconsistency*, not redundancy.

**Consequences.** Constraint-list and glyph bloat; double entries in conflict
reports (see above); repeated panel clicks silently "work" (compounded by the
selection surviving the apply — see UX-3).

**Suggested fix.** Before solving, reject (or no-op with a status message) a
constraint identical to an existing one on the same entity set. For predictable
behavior, also identify rank-neutral additions as redundant rather than silently
adding them; the code can already detect this via `rank_increased`.

---

## Bug 5 — Editing a dimension updates geometry and label but not the stored constraint value

**Severity: medium (API/persistence truthfulness).**

**Symptom.** Place a length dimension on a line (measured 35.00). Double-click
it, enter 42. The line stretches to 42.000, the label shows "42.00" — but
`sketch.constraints[]` still reports `{ type: 'distance', value: 35 }`,
forever.

**Proof (engine-level, one call chain).**

```json
created:   constraints.value = 35, dimensions.value = 35, text "35.00"
editDimension(text: "42") →
afterEdit: line length = 41.99999999998634
           dimensions.value = 42, text "42.00"     // param-driven, correct
           constraints.value = 35                   // stale
```

**Cause (proven from code).** Dimensions are parameter-driven:
`edit_dimension` writes the new value/expression into the bound *parameter*
(`session/dims.rs:306`, `set_expression`) and re-solves. The
`Constraint::Distance { value }` payload is written once at creation
(`dims.rs:159-274`) and never touched again. The solver reads through the
param (`sketch.dim_value(&cid, value)` falls back to the stale field only
when no param is bound, `sketch.rs:354-360`), and `DimensionDto` is built
from the param (`dims.rs:523-552`) — which is why geometry and label are
right while the constraint record lies.

**Consequences.** Anything consuming `constraints[]` — MCP tools, scripts,
external integrations, this audit — reads creation-time values. The stale
number is also persisted (`SketchSnapshot.constraints`), so the fallback path
in `dim_value` would resolve to the wrong value if a param binding is ever
missing (defensive path today, a real path after any future
migration/copy-paste feature that drops `dim_params`).

**Suggested fix.** On successful `edit_dimension` (and any solve that changes
a dim param), write the param's value back into the constraint payload — one
assignment next to `self.analysis = Some(analysis)` in `dims.rs:327`.

---

## Bug 6 — A second driving dimension on the same entity is accepted silently

**Severity: medium.**

**Symptom.** Dimension a line's length (42). Dimension the same line's length
again: a second driving `distance` is created (value 42) — no dialog, no
"driven/reference" downgrade, two driving dims now target one length.

**Reproduce.** Sketch Dimension → click line → place → repeat on the same
line. `constraints[]` now holds two `distance { from: <line>, to: null }`
rows (round-4 transcript: ids 8 and 9).

**Cause.** Same acceptance rule as Bug 4 — the second dim is created at the
*current measured value*, so it is rank-neutral and zero-residual at birth and
passes `session.rs:2792`. The two dims only fight later, when the user edits
one of them (and with Bug 5, the stored values can't even be compared
honestly).

**Recommended behavior.** The second dimension should automatically become a
**driven (reference) dimension** with a notice explaining why. There is
currently no driven-dimension concept in `Constraint`/`DimensionDto` — worth
adding alongside this fix.

---

## Bug 7 — 10° axis-snap silently flattens drawn lines

**Severity: medium (UX / data integrity while drawing).**

**Symptom.** A line drawn 8° off horizontal commits as **exactly horizontal**
(endpoints moved, auto-`horizontal` added). Drawn (−60,−55)→(−20,−49.4); the
sketch stores (−60,−55)→(−20,−55). The same happens through the raw engine
API: `add_line to_raw (5.1, 5.2)` from (−30.2, 0.3) commits as (5, 0) — the
snap lives in the engine path too, so this is not just pointer inference.

**Reproduce.** Draw any line with slope under ~10°; check
`entities[].start/end` and the auto constraint list.

**Cause.** `LINE_AXIS_INFERENCE_TOL_DEG = 10` (`Viewport.tsx:195`) plus the
engine-side equivalent applied to `to_raw`. A narrower H/V inference window of
roughly 2–3° is less intrusive; it should be visibly previewed and must never
rewrite already-typed/exact coordinates.

**Suggested fix.** Drop the tolerance to 2–3°; keep 10° only for the visual
inference *chip* if desired, and never apply an axis snap without the glyph
preview having been visible at commit time.

---

## UX improvements (ranked against established CAD behavior)

1. **Type-on-place for dimensions.** Today: placement commits the measured
   value; editing requires a second gesture (double-click). Established CAD
   workflows open the value input at placement. The engine already supports it —
   `add_dimension` accepts `value_text` (`dims.rs:276`) — but the Viewport
   never sends it (`Viewport.tsx:10011` `addDimension({ entities, text_pos })`).
   Low-effort, high-payoff parity win.
2. **Expose point-pair Horizontal/Vertical.** The solver has
   `HorizontalPoints` / `VerticalPoints` (`constraint.rs:47-56`), but the
   panel gate is lines-only (`applyConstraint.ts:23-28`); two selected points
   yield *"Horizontal/Vertical needs one or more lines."* Standard H/V tools
   also align two points. The panel rule just needs a points branch.
3. **Clear the selection after a successful apply.** Selection persists
   (`selectionAfter: [3]` etc. in every transcript), so a second click
   double-applies (see Bug 4). Clearing it on success prevents accidental repeats.
4. **Tangent should prefer moving circles over resizing them** (see Bug 2's
   d = 30 case) — stiffen radius variables during tangent adds.
5. **MidPoint should accept arcs** (a point at an arc midpoint is a standard
   sketch relation); the gate is point+line only (`applyConstraint.ts:43-47`).
6. **Symmetry axis-order affordance.** The all-lines variant infers the axis
   as the most-recently-selected line — a familiar convention, and the
   failure hint ("select axis last") is good. But a *successful* apply with an
   unintended axis gives no feedback. Highlight the inferred axis (or prompt
   explicitly) before committing.
7. **Multi-select caps.** H/V and Fix/UnFix accept at most 8 entities
   (`applyConstraint.ts:24,42`) — an arbitrary ceiling with no modeling reason.
8. **Empty-conflict message assembly** — covered by Bug 3's fix; the string
   builder should also never emit a dangling "conflicts with ".

---

## Audit method and artifacts

Repro scripts: `scripts/audit-sketch-constraints.mjs` (UI-level),
`scripts/audit-sketch-solver-probes.mjs` (isolated solver probes), and
`scripts/audit-dimension-staleness.mjs` (Bug 5 proof). Each expects the dev
server on port 7317.

- UI driving: Playwright (headless Chromium), 1440×900, against `npm run dev`
  on the worktree; entity/solver state read from `window.__appStore` after
  every action; `window.__sketchToScreen` for exact canvas targeting.
- Engine probes: `import('/src/engine/index.ts')` from the page for the
  singleton `WasmEngine`; direct `addLine/addCircle/addPoint/addConstraints/
  addDimension/editDimension` calls with exact coordinates (no snap ambiguity,
  no selection layer).
- Two false alarms were caught and discarded during the audit, worth
  remembering for future sessions: `page.mouse.click(x, y, { modifiers })`
  silently ignores `modifiers` (only selector-click supports it — use
  `keyboard.down/up('Shift')`), which initially made multi-select look broken;
  and the in-app browser pane cannot present WebGL frames while hidden
  (`visibilityState: hidden` suspends rAF), which initially looked like a
  broken renderer. Neither is an app bug.
- The WebGL canvas is also blank in headless Playwright screenshots (DOM
  renders; canvas does not present), so all evidence in this audit is
  state-based rather than pixel-based. Glyph placement/visual polish were
  therefore out of scope.
