# High Speed Roughing — fixed-axis preview

Status: experimental, not a production machining certification.

Exterior roughing uses long lines and tangent corner arcs. Concavities and
cavities retain a checked patch fallback. The operation shares the standard
editor tabs and reference-plus-offset height controls, including Top Height.

The operation exposes radial engagement, cutting radius, depth increments,
allowances, ramp constraints and checked links. Its implementation is original
Rust code using conservative mesh projection, convex offsets, supporting
planes, circle intersections, distance transforms and analytic stock
certificates. No proprietary source, post runtime, graphics or documentation
assets are included; compatibility with another generator is not claimed.

## Using this slice

1. Select target bodies and explicit stock in a fixed-Z setup.
2. Choose **High Speed Roughing** in the Manufacture ribbon. Pick a center-cutting flat or bull-nose end mill (radius and bevel corners are supported) and verify its feeds/speed for the actual material.
3. Set Top, Bottom and safe-plane height references/offsets, optimal radial load, maximum stepdown, minimum cutting radius, stock allowances, and target-envelope cell width. Top defaults to Stock top + 0, but can use Model top/bottom, Stock top/bottom, Origin or Bottom height with a signed offset. Height expressions resolve in setup coordinates and persist for regeneration; stored lengths remain millimetres.
4. On Linking, choose whether enclosed cavities may be machined, then set entry/exit radii, retraction policy, checked stay-down limits, and Helix/Predrill/Plunge entry. The [linking controls contract](CAM_LINKING.md) details independent exits, taper, diameter limits, coordinate hints and clearance requirements.
5. Save & generate. Generation captures current CAD meshes in Rust. Inspect the resulting remaining stock and warnings; separately inspect final NC in NC Sim. Dry-run under the machine's approved procedures before cutting.

Top and Bottom define the depth levels. Top may be below or above stock top;
Bottom must remain inside the stock and below Top. A lower Top does **not**
declare the material above it removed. Incoming stock starts at the setup top;
only an enabled, proved whole-stock facing sweep can lower that global height
for entry and cutter-reach checks. XY stock/engagement remains conservative;
general previous-operation rest machining and rest-from-setup inputs are not
supported. A failed generation keeps the operation draft/outdated, never
certified; retry updates the same draft rather than creating a duplicate.

For selected `T`, bottom `Z_b`, maximum stepdown `a_p`, and known incoming
stock top `S`, the first level is `Z_1 = max(T-a_p, Z_b)`. The planner requires
`S-Z_1 <= a_p`, `feed >= S`, and `S-Z_b <= flute_length`, as well as the common
`T <= feed <= retract <= clearance` ordering and clearance above stock/target.
Violations explain which height, cutter or upstream facing evidence to fix;
the planner never silently restores Top to Stock top. Empty air offsets do
not consume flute reach. Regeneration follows persisted references after CAD
changes; revision **9** invalidates older generation stamps and includes linking
intent and consumed predecessor evidence in freshness checks.

## Geometry and mathematics

### Conservative target envelope

`Envelope` clips each target triangle against XY grid cells and retains its maximum interpolated Z. Triangle-plane interpolation is affine, so the maximum over the clipped polygon occurs at a vertex. The resulting `H_ij` is a conservative upper envelope of the **supplied mesh**, including vertical faces. It intentionally protects everything below an overhang; it cannot machine an undercut. OCCT's upstream tessellation error is additional uncertainty, not erased by choosing smaller grid cells.

At depth `z`, a cell is protected when `H_ij + axial_allowance > z`.

### Continuous exterior passes

Take the convex hull `H` of all protected **whole cells**. This contains the
target section and supports rotated/nonrectangular parts. Let `B` be the
maximum distance of the stock bounding-box corners to `H`. Convexity of
distance to a convex set means all initial stock lies in `H (+) disk(B)`.
Each pass follows the clockwise tool-center offset

`B_next = max(B - a_e, radial_allowance + 0.0001 mm); d = R + B_next`.

Offset edges are straight; convex vertices get tangent arcs of radius `d`.
Entry/exit follow the longest edge's tangent by default, or the nearest edge
to a preferred entry station. Optional horizontal/vertical rolls are checked
outside incoming stock; axial approach and retraction
are beyond the original stock support planes by more than a cutter radius.
A complete closed loop clears the distance-to-hull band `[d-R, d+R]`,
leaving stock contained in `H (+) disk(B_next)`. Only completed loops update
that stock certificate. No fitted shortcut or inward hull simplification
is used; the numeric guard is separate from the requested allowance.

For advance `e = B-B_next <= a_e`, a supporting plane bounds possible old
stock at most `e` into the cutter. Intersect that plane with the advancing
half of the cutter perimeter; the trailing half was already swept. Contact
angle is bounded continuously by `acos(1-e/R) <= acos(1-a_e/R)`. This applies
to tangent offset lines/arcs and the tangent entry from air. It is a geometric
swept-disk bound, not a force, acceleration, spindle-power or chatter model.

External passes are climb for M3. Each loop currently retracts before the next.
The whole-cell hull may retain extra stock, especially around concavities;
the checked fallback below then visits accessible remaining regions.

### Rounded-patch fallback

A two-pass exact squared Euclidean distance transform supplies clearance
from protected cell centers. A circular patch center is allowed only if its distance exceeds

`R + q + radial_allowance + sqrt(2)*h`,

where `R` is tool radius, `q` is center-path radius, and `h` is target cell width. The final term bounds the target-cell half diagonal and the candidate-to-grid-center displacement. This margin is deliberately separate from the user allowance; cell width is **not** a promised finished-surface tolerance.

### Fallback remaining stock and engagement

A complete center-path circle of radius `q <= R` sweeps a filled disk of radius `A=R+q`. Each completed fallback lap therefore adds an analytic removal disk to the current depth's stock state. Circles are two G3 semicircles, not ambiguous same-endpoint full-circle blocks. The fallback uses the requested minimum cutting radius `q`; continuous exterior corners may have a larger radius. The parameter is constrained to at most 40% of tool diameter. There is no finishing contour or controller radius compensation in this operation.

For requested side-cut radial load `a_e`, use the reference angle

`phi_limit = acos(1 - a_e/R)`.

For standard box/cylinder/hex stock, cutter-perimeter contact is represented by angular intervals. Half-plane/circle intersections construct initial-stock intervals, then intersections with already-cleared disks subtract from them. A subset of those subtractions yields an **upper** bound, so calculation may stop as soon as that bound is below the limit. Disconnected contact sectors are summed, not reduced to the longest sector. Modeled stock uses a conservative upper envelope and a 128-angle sampled fallback with boundary padding.

The completed exterior's remaining-stock support half-planes also clip
fallback contact. They contain a superset of the rounded remaining stock,
so this can overestimate contact at corners, never hide stock. Whole-segment
capsule checks against that rounded hull can authorize clear fallback links.

Every proposed fallback lap is checked at 64 cutter-center positions. Angular guards are included, but this finite station spacing is **not** a continuous maximum-engagement proof. It does not model tooth forces, machine acceleration, spindle power, or chatter. Initial full-width helical entry is explicitly outside the ordinary side-cut engagement limit and has separate pitch/feed limits.

The initial frontier pitch is derived from two intersecting circles, not straight-wall stepover. Let `beta=(phi_limit-angular_guard)/2`. The cutter-center distance from the preceding patch satisfies

`d = sqrt(A² - R²*sin²(beta)) - R*cos(beta)`;

use `advance = 0.9*(d-q)`, and still verify each candidate against the actual cleared-disk union. The ordinary flat-wall formula overestimates this advance on a curved frontier.

To avoid generating a circle at every fine-grid point, traversal uses overlapping bands spaced by a swept radius, with a fine-pitch connecting spine for enclosed cavities. It also visits a two-cell rim of the feasible patch-center boundary so thin external stock is not skipped between bands. A depth-first walk finishes a local band before moving to another front. This is not a medial-axis/polygon-offset clearing engine; winding narrow regions can remain unvisited even when a more sophisticated route exists. The boundary repair improves coverage but can substantially increase lap count; it is not a cycle-time optimization.

### Entry, exit, and links

External components enter from air outside the stock envelope. Enclosed accessible components receive at most one helix per depth; a rejected cutting front never bypasses the load limit by silently adding more plunge entries.

Helix descent per revolution is

`pitch = min(max_ramp_stepdown, 2*pi*q*tan(ramp_angle))`.

The final helix is followed by a full lap at depth: a sloping helix alone does not clear the entire disk at the bottom. Entry feed height must be at or above known incoming stock top. Actual material reach, not merely the selected Top-to-Bottom span, must fit the tool flute length.

A stay-down segment is split into bounded subsegments. Each subsegment's full radius-`R` capsule must be contained in one known cleared disk or certified outside the original stock bounding box. Otherwise, retract to clearance and re-enter at a known-clear cutter disk. The union proof is conservative: a safe route can be rejected, but endpoint clearance alone never authorizes the link. Accepted equal-radius lap links use a common external tangent, continuing on the previous cleared circle to its departure point. Curvature continuity and machine acceleration-aware scheduling remain future work.

### Corner-aware stock and clearance

The preceding cylindrical equations are the sharp-corner case. For a corner
tool, let `f=r(0)>0` be the flat-land radius, `R` the outer radius and
`L=R-f`. Target clearance and original-air checks still use `R`; they must
never shrink protection to the flat land. The cavity/ramp radius must satisfy
`q<=f`, so a complete lap removes a filled disk at every axial section,
rather than leaving a center boss.

At cutter section radius `s` in `[f,R]`, a completed lap clears a disk of
radius `q+s`. Floor flags store only `q+f`. A query capsule with section
radius `s+m` is contained in a completed lap when
`max(distance(a,c),distance(b,c))+f+m <= q+f`; the increase `s-f` cancels
on both sides. This proves the whole cutter, not just the endpoints at one
height. It does not authorize combining original air with a dilated removal
disk. Unresolved corner-tool unions fall back to a checked retract.

For a ray `u` from candidate center `p` and previous lap center `c`,
`|p-c+s*u|²-(q+s)² = |p-c|²-q²+2s*((p-c)·u-q)` is affine in `s`.
Thus only rays cleared at **both** `s=f` and `s=R` are subtracted from the
engagement intervals. Original stock is bounded over the whole interval:
each half-plane takes its widest contact sector; cylinder contact also checks
the interior extremum `s=sqrt(distance²-stock_radius²)`. Modeled corner-tool
stock uses its bounding box, a disclosed conservative upper bound. No extra
Z-layer grid or brute-force per-frame section sampling is introduced.

Continuous exterior loops use `advance <= a_e*f/R`, ensuring
`acos(1-advance/s) <= acos(1-a_e/R)` at every section. After a completed loop,
remaining stock at section `s` is inside offset `B_next+R-s`; the physical
floor therefore retains `B_next+L`. Fallback scheduling/pitch uses `f` and
`A=q+f`, and still applies its independent contact test. A floor-exterior
clearance bound also protects higher sections because their remaining-stock
offset decreases exactly as their cutter radius increases.

These conservative proofs can create more passes or leave extra stock; they
do not claim a square wall/floor corner was machined by a round/beveled tool.
CAM and NC simulation use the shared analytic profile at the actual cut
depth, including `Ap` smaller than the corner radius or bevel height.

## Execution and resource ownership

- `crates/cam/src/adaptive.rs`: mesh projection, protection, engagement, roughing motion, clearance proofs, and resource checks.
- `crates/cam/src/adaptive/exterior.rs`: whole-cell convex hulls, continuous tangent exterior passes, supporting-plane engagement bound and reusable remaining-stock certificates.
- `crates/sketch/src/manager.rs`: captures current setup bodies and optional modeled stock **before** transactional planning; only a successful plan commits the snapshot and freshness signature.
- `crates/cam/src/planner.rs`: common neutral program and bounded exact-input cache (four entries, 16 MiB estimated retained payload). Changes to setup, geometry, operation, or tools invalidate reuse. Playback does not rerun unchanged adaptive planning.
- `CamAdaptiveDialog.tsx`: input editing, units, and operation actions only. No geometry calculation or mesh round-trip through browser code is introduced.
- Existing CAM and NC simulators consume the same circular/helical motion contract. Both retain normal 3D playback and camera orbit. Bevy presents; OCCT supplies target tessellation; Rust plans and verifies.

The persisted operation tag remains `adaptive3d` for project-file compatibility. That is an internal schema name only; the product and documentation call this operation **High Speed Roughing**.

Target grids and patch frontiers each cap at one million elements; target meshes cap at 100,000 triangles; depth levels cap at 512. Computation and neutral-command budgets fail with an explicit error. Scheduling uses tiled possible-material flags; those flags never authorize a clearance move. Exact cleared-disk certificates accelerate queries, and bounded subdivision can prove a whole proposed disk already empty without performing an air lap. No target detail or protection allowance is silently relaxed to fit a budget.

## Known limits / next gate

- Center-cutting flat/bull-nose end mills with a nonzero flat land only, including radius/bevel end-mill corners. No drills, chamfer mills, full ball noses, holders, fixtures, machine kinematics, or force model. A requested ramp/cutting radius larger than the flat land is rejected rather than certifying an uncleared center boss.
- No previous-operation/previous-setup rest machining, machining-boundary selection, fine step-up passes, automatic finishing, or optimized cut ordering.
- The target is a top envelope of a tessellation, not exact B-rep gouge checking. Narrow channels, concave corners, steep detail, and overhangs can leave considerable stock.
- Fallback contact is checked at finite lap stations; it does not inherit the continuous convex-exterior engagement proof. Continuous bounds for concave fronts remain future work.
- Long generated programs and conservative retracts are possible. Rounded cutting motion alone does not guarantee the fastest cycle or consistently climb-only tooth engagement.
- Browser/WASM stock simulation remains synchronous. High detail with thousands of roughing moves can block browser input; desktop retains the separate Rust simulation worker. The editor regression uses a bounded coarse grid and is not a high-detail performance certification.
- Residual counts are cell-level scheduling samples across depth levels, **not** residual volume or a complete-clearing certificate. The stock simulator is the operator-facing removal evidence.
- Selected-profile lead checks do not cover adjacent bodies or fixtures.
  Rounded motion does not establish holder, machine-travel or cutting-force
  safety. See the [linking contract](CAM_LINKING.md) for clearance scope.

Regression coverage includes analytic boss clearance, sloped projection, enclosed helix limits and bottom laps, summed angular sectors, verified stay-down capsules, unsupported/budget inputs, cache invalidation, current-CAD snapshot transaction/save/reopen, and Siemens/Fanuc post-to-NC-simulation agreement. These tests are not machine commissioning.
