# Sketch constraint audit — fix feedback

**Date:** 2026-08-30
**Branch:** `fix/sketch-cad`
**Audit:** [SKETCH_CONSTRAINT_AUDIT.md](SKETCH_CONSTRAINT_AUDIT.md)

## Outcome

The seven audited failures are now either corrected or rejected explicitly
without corrupting the sketch. A follow-up operation-semantics audit also
corrected constraints that satisfied their equation by unexpectedly changing
an unrelated property such as line length, bearing, or curve radius. The
changes keep the normal solve path bounded: the iteration limit was not raised,
backtracking runs only after a rejected full step, and nearest-pose
initialization runs only while a new relation or edited dimension is being
committed. Interactive point dragging keeps its existing solve path.

| Audit finding | Resolution |
|---|---|
| 1. Free-axis symmetry stalls | Added a bounded retry that seeds the nearest exact symmetric placement while leaving the selected axis stable. Both point pairs and line endpoint pairs are covered. |
| 2. Circle tangent stalls or inflates radii | Corrected step acceptance to use the squared least-squares objective, added bounded backtracking, and made unconstrained radii more resistant to movement during tangent solves. Circles now translate while retaining their intended radii in the audited near and far cases. |
| 3. Numerical failure is reported as a conflict | Added a distinct numerical-failure error. Conflict names are emitted only when supported by direct contradiction or a successful leave-one-out proof; empty and speculative culprit lists are gone. |
| 4. Duplicate constraints accumulate | Added normalized relation identity, carrier/endpoint equivalence, direct contradiction checks, and single/batch preflight. Duplicate requests are rejected before they can pollute the graph. |
| 5. Edited dimension payload becomes stale | Parameter-backed values are synchronized into dimensional constraints after edits, dependent formula evaluation, snapshot creation, and restore. Serialized constraints and rendered dimensions now agree. |
| 6. A second driving dimension is accepted silently | Implemented a first-class driving/reference model. Repeating a measurement creates a live reference dimension with no solver equation or parameter; typed duplicate targets are rejected instead of being silently discarded. |
| 7. Axis inference silently flattens lines | Reduced both engine and viewport inference tolerance from 10° to 3°. A 2° line still infers horizontal; an 8° line retains its authored slope. |

## Driving and reference dimensions

- Every annotated dimension now persists an explicit `driving` or `reference`
  mode. Older project snapshots without this field load as driving dimensions.
- A driving dimension owns one named parameter and contributes its relation to
  the solver. A reference dimension owns no parameter and contributes no
  equation, so it cannot change rank, DOF, or solved geometry.
- Reference values are remeasured from current solved geometry after edits,
  formulas, undo/redo, and restore. Distance, radius, diameter, and angle
  annotations are covered.
- Repeating an existing measurement, or dimensioning geometry whose value is
  already fixed by other constraints, creates a reference automatically.
- Users can convert modes from the inline dimension editor. Conversion is
  rejected when it would orphan a formula dependency, create a competing
  driver, or turn a constraint-determined measurement into another driver.
- Reference annotations use standard parentheses and a muted visual treatment;
  their inline value is read-only.

## Related interaction fixes

- Horizontal/Vertical now accepts either any number of lines or exactly two
  points.
- The arbitrary eight-entity cap was removed from Horizontal/Vertical and
  Fix/UnFix.
- A successful constraint operation clears the selection, reducing accidental
  repeat application.
- Every two-feature relation supports all normal command orders: select both
  then invoke; select one, invoke, then select the second; or invoke first and
  select both. The active command and `0/2` or `1/2` progress remain visible,
  the final valid pick solves automatically, and Escape cancels the pending
  command before clearing its preserved selection. Horizontal/Vertical uses
  the same path when aligning two points, while a picked line still completes
  immediately.
- Localized invalid-selection messages describe the line and point workflows.
- The audit uses neutral mechanical-CAD terminology; named-product references
  were removed from the audit and repository text touched by this pass.
- Geometric constraint indications now use one exhaustive visual inventory
  shared with the command toolbar. Perpendicular uses a right-angle square and
  Parallel uses a two-line mark. Every serialized geometric relation—including
  internal midpoint, arc-endpoint, and equal-distance relations—has a visible,
  selectable badge when the Constraints palette option is enabled.
  Dimensional constraints continue to use their full dimension annotations.
- Secondary-clicking any geometric badge or dimension annotation now opens a
  removal menu. The same generic path covers every relation type rather than a
  hand-maintained subset.

## Selective automatic constraints

Creation tools now share a conservative automatic-constraint policy. They
persist only intent that is clear from the gesture: exact point/intersection,
origin, midpoint, and curve-center acquisition; Horizontal/Vertical within 3°;
Perpendicular within 3° for lines that share the acquired endpoint; and
endpoint tangency within 3° for an arc continuing from a connected line. Arc
endpoints acquired from existing vertices remain associatively attached.

These are ordinary constraints, not hidden state. Every inferred relation has
the same visible, selectable, removable indication as a manually applied one.
The operation is accepted only if the new relation solves exactly and adds
independent rank; a failed or redundant inference leaves the geometry as drawn.
Automatic Fix and automatic dimensions are intentionally excluded.

Holding Control on Windows/Linux or Command on macOS suppresses relation
inference for that creation or drag gesture. Grid snapping stays independently
controlled. Even while inference is suppressed, an endpoint placed at exactly
the same coordinates as an existing vertex reuses the vertex identity so the
sketch cannot accumulate visually coincident but topologically disconnected
points.

Grid and alignment assistance are intentionally weaker than persistent design
intent:

- the adaptive minor grid captures only inside a seven-screen-pixel magnetic
  radius; elsewhere the authored coordinate remains continuous;
- grid acquisition never creates a persistent constraint;
- point-axis and feature-extension tracking is drawn as a dotted temporary
  guide, may place the current point exactly, and never creates a hidden
  Horizontal/Vertical point relation; and
- exact vertices, intersections, midpoints, curve centers, and carriers retain
  priority over the grid fallback.

## Constraint operation invariants

Constraint application and dimension editing now carry temporary operation
invariants. They guide only the current solve, are never saved as hidden
constraints, and do not reduce reported DOF afterward.

| Operation family | Property it owns | Property retained during the operation |
|---|---|---|
| Horizontal, Vertical, point H/V, Parallel, Perpendicular, Collinear, Angle | Direction | Existing line/point-pair lengths |
| Coincident, Midpoint, Concentric | Position | Carrier length and bearing, or curve radius |
| Tangent | Contact position/direction | Participating line lengths and curve radii |
| Equal | Size | First selection is the size reference; line bearings remain unchanged |
| Line/point distance | Length or separation | Unmeasured bearing and carrier shape |
| Line offset distance | Separation | Both lines' lengths and bearings |
| Radial offset distance | Radial separation | Reference radius and common center |
| Radius/Diameter | Curve size | Center and unrelated arc state |
| Symmetry | Mirrored placement | Datum-axis shape and first selected line size |
| Fix | Stored pose | The entity is recorded without moving first |

For two-line direction commands, selection order is meaningful. The first
selected line is the direction reference and remains at its authored pose. The
second line rotates without resizing about a shared endpoint when available;
otherwise its most connected endpoint is preferred, with its midpoint used for
a disconnected line. This keeps the three-line open-chain case local: applying
Parallel to the top and bottom lines changes only the top line's bearing.

The solver now restricts each numerical step to the connected constraint
island that is actually outside tolerance. Already-satisfied disconnected
geometry remains byte-for-byte stationary and cannot make a simple relation
stall. This fixes the open-sketch case where unrelated constrained lines caused
Parallel to fail or expand a line by thousands of millimetres, without raising
the iteration cap or adding a global performance cost.

## Regression coverage

Engine tests now cover:

- free-axis symmetry at the two previously failing offsets;
- circle tangency at the non-convergence and radius-inflation distances;
- semantic duplicate rejection without graph growth;
- line-carrier versus endpoint-relation duplicates;
- 2° and 8° inference boundaries;
- edited constraint fallback values, dependent formulas, and orphan-parameter
  prevention;
- driving/reference conversion, parameter lifecycle, DOF behavior, live
  distance/radius/diameter/angle measurements, undo/redo, snapshot migration,
  and dependency/competing-driver protection;
- creation-time invariants for Horizontal/Vertical, point alignment, Parallel,
  Perpendicular, Angle, Equal, Coincident, Midpoint, Tangent, Concentric,
  Collinear, Symmetry, Fix, size dimensions, linear offsets, and radial offsets;
- edit-time invariants for line length, point distance, angle, point-to-line
  distance, line-to-line offset, and radial-offset dimensions;
- direction constraints applied in a sketch containing disconnected,
  already-constrained geometry;
- selective origin, midpoint, center, axis, connected-perpendicular, and arc
  endpoint/tangent inference;
- per-gesture Control/Command suppression without accidental nearby-point
  magnetization;
- exact-coordinate vertex reuse under suppression without an inferred Fix;
- proximity-only grid capture and continuous free placement outside the
  capture radius;
- temporary dotted alignment guides that do not add point-pair relations;
- first-selection reference behavior for direction tools in the exact
  three-line open-chain scenario; and
- exhaustive shared constraint artwork, free/defined point-state rendering,
  secondary-click removal for geometric and dimensional constraints, and all
  three selection orders for two-feature relation commands.

### Pairwise permutation audit

The durable matrix definition, complete operation vector, ownership rules,
deliberate exceptions, and reproduction commands are recorded in
[SKETCH_CONSTRAINT_PAIRWISE_MATRIX.md](SKETCH_CONSTRAINT_PAIRWISE_MATRIX.md).

The follow-up matrix treats constraint order as part of the public contract.
It covers 25 panel-applicable equations: 16 geometric relationship operations
and 9 dimensional operations. Every ordered pair is exercised, so `A → B` and
`B → A` are independent cases rather than one unordered combination.

- 625 ordered pairs share the same lines, points, curves, and datum axis. This
  includes 256 relationship/relationship cases, 288 mixed
  relationship/dimension cases, and 81 dimension/dimension cases. Every
  successful second command must satisfy both equations and its operation
  ownership contract: direction tools retain size, size tools retain bearing,
  position tools retain carrier size, and symmetry never moves its datum.
- The same 625 ordered pairs run on two disconnected sketch islands and verify
  that solving the second island leaves every entity in the first byte-for-byte
  unchanged.
- All seven user-facing dimension-selection forms—line length, point distance,
  point-to-line distance, line angle, parallel-line offset, circle diameter,
  and arc radius—run through both command orders. An already-driven
  measurement becomes a read-only reference when no target is supplied;
  supplying another target or adding an equivalent driver is rejected
  atomically.

The first matrix pass exposed several failures that isolated tests could not:
direction, tangent, symmetry, and point-to-carrier equations could use a free
translation or scale direction to report convergence with coordinates between
tens of thousands and millions of millimetres. These were not valid alternate
solutions. The correction has four parts:

1. Direction and signed-distance residuals now use compatible physical scales,
   so a dimensionless angular row cannot be numerically drowned out by a
   millimetre-distance row.
2. Each new operation starts from its nearest finite geometric pose: rotate
   about the current midpoint, resize about the midpoint, place a point on its
   carrier, or move the target curve relative to the selected reference.
3. Temporary stays are relaxed in semantic layers. The solver first retains
   both authored shape and location. If the wider graph requires a property to
   yield, it releases local pose while retaining authored size and direction;
   it can then release an undimensioned bearing while still protecting size,
   before attempting the unrestricted system. A selected symmetry axis remains
   a stable datum throughout these retries.
4. Every retry restores the finite projected pose. A failed nonlinear attempt
   can no longer become the starting point for the next attempt.

True contradictions remain contradictions. For example, a point constrained
to the midpoint of a line cannot simultaneously have a non-zero perpendicular
distance from that same line; the second request is rejected with the first
constraint and geometry intact. Fillet/chamfer topology is also deliberately
excluded from radial pre-projection, so reducing a radius still reopens an
exactly consumed carrier.

The UI regression exercises the actual ribbon path for button-first,
one-selection-first, and both-selections-first relations; two-point
Horizontal/Vertical; more than eight selected lines; exact point alignment;
selection clearing; duplicate rejection; graph integrity; and both inference
boundaries. A second regression exercises reference creation, live measurement,
read-only editing, and both mode conversions. Both are part of `e2e:release`.

## Verification performed

| Check | Result |
|---|---|
| Sketch crate tests | Pass |
| Full Rust workspace tests | Pass |
| Web production build | Pass |
| WASM production build | Pass |
| Constraint-hardening UI regression | Pass |
| Existing constraint milestone regression | Pass |
| Numeric input-selection regression | Pass |
| Driving/reference dimension UI regression | Pass |
| Adaptive grid/tracking/constraint-menu UI regression | Pass |
| Native macOS debug app build | Pass |
| Native macOS launch/render smoke test | Pass — native sketch grid and lines render correctly; free grips are hollow, inferred relation marks are visible, and secondary-click opens the constraint-removal menu |

Strict Clippy under the current Rust toolchain still reports warnings that
predate this work in untouched crates. The changed code introduces no new
build or test failures.

## Deliberate follow-ups

- Type-on-placement dimension entry, arc midpoint relations, and an explicit
  symmetry-axis preview remain worthwhile workflow improvements, but are not
  required to close the seven audited correctness failures.
