# Shared edge chains and 2D chamfer

## Workflow

In **2D Chamfer → Geometry → Model edges**, **Closed loop** previews the
whole boundary under the pointer and selects it with one click. The outer
perimeter and hole rims remain separate. Clicking another loop adds another
chain without discarding earlier selections. The chain list activates or
removes a boundary; clicking an already-selected loop activates it without
duplicating it. **Manual edges** (or Option-click) adds/removes individual
connected edges in the active chain. **+ New chain** starts a separate manual
selection. **Reverse**, per-edge removal and **Clear** affect only the active
chain. An open chain never receives an invented closing segment.
Automatic loop picking gives a setup-planar rim a half-pixel tie preference
over a coincident sloping bevel seam. Manual/Option picking still uses the
nearest edge, so the seam cannot steal the rim's shared-vertex click in loop mode.

One chamfer operation supports up to 64 chains within the existing total
path-point budget. Modeled chains retain individual widths, top levels and
material sides; tip offset, extra width and cutting data are shared. Sharp
chains have individual material sides and a common explicit Top Height
(Selection uses the highest selected plane). Manual XY coordinates remain
a single-chain input. Contour's picker retains its single-chain contract.

**Modeled chamfer** accepts the upper rim of an accessible, constant-width
45° bevel. A corresponding lower rim is also accepted when it is itself one
unambiguous chain. Width, top height and material side are measured from the
adjacent faces. Use a 90° chamfer mill; **Additional width = 0** follows the
modeled bevel, while a positive value enlarges it. Top Height follows the
modeled geometry. **Sharp edge + width** uses the selected sharp edge and an
explicit width; Top Height can follow **Selection (geometry plane)** or an
explicit reference/offset. Sketch curves and manual XY coordinates remain
available for this explicit-width workflow.

Closed chains use material **inside/outside**; open chains use material
**left/right**, relative to their selection arrow. Modeled material side is
derived, not guessed from the viewport camera. Climb/conventional selects
cutting travel while preserving the physical material side. Reversing the
selection does not override the requested milling direction.

## Geometry and equations

All lengths below are millimetres in the setup frame. Let `n` point from the
material toward the cutter, `t > 0` be tip offset, and `H` be top Z. A 90°
included-angle tool has flank radius `r(z) = z - z_tip`, up to its radius.

- Sharp profile `S`, requested width `w`: `C = offset(S, t, n)` and
  `z_tip = H - (w + t)`.
- Modeled upper rim `U`, measured width `W`, additional width `a ≥ 0`:
  `C = offset(U, W + t, n)` and `z_tip = H - (W + a + t)`.

For a 45° bevel, `W = upper_Z - lower_Z`. The planar-face angle or conical
semi-angle is checked against the tool; conical rims must be concentric and
aligned to setup Z. Accessibility uses the adjoining upward horizontal face,
not the sign of a bevel's internal surface parametrization. Upper-to-lower
displacement establishes the free side for planar bevels. The intended width
plus tip offset must fit the cutter radius, flute length and stock depth.

The modeled path deliberately uses the **upper rim**, not an offset of a
clipped lower wire. A four-edge upper rectangle can have eight lower edges
because of three-sided corner chamfers. Widening that lower wire as though
every corner were a uniform 45° bevel can cut into those corner transitions.
This implementation warns when the lower boundary is interrupted. Its
constant-angle upper-rim pass can leave material on separate corner faces;
it does not claim to finish arbitrary trihedral blends exactly.

Offsets are currently mitered polylines. Curved edge samples retain the
kernel/sketch chord approximation; this is not exact analytic arc finishing.
Complete center segments and tangent lead segments/arcs are checked against
the selected boundary. Folded offsets, self-crossings, collapsed paths and
insufficient wall clearance fail instead of emitting an unchecked cut. These
are selected-profile checks, **not** whole-machine/fixture/holder clearance
certification. Inspect stock/target verification before posting, especially
around neighboring geometry and corner transitions.

### Small-hole entry fitting

The default entry arc and its straight extension used to be fixed at roughly
one quarter of the cutter diameter. A valid small-hole cut could therefore
fail just because this entry shape did not fit. Starting with that preferred
size, the planner now tests scales `1, 0.75, 0.5, 0.25, 0.125, 0.0625`.
Every candidate passes the same continuous line/arc clearance tests. No
candidate changes chamfer width, tip offset or clearance tolerance; none
passing still blocks generation. A reduced size is reported in plan warnings.

For example, with a Ø5.5 hole with a 0.5 mm modeled bevel, the upper opening
radius is 3.25 mm. With a 90° Ø6 cutter and 1 mm tip offset, its center path is
approximately `3.25 - (0.5 + 1) = 1.75 mm` radius. The old 1.5 mm arc **plus**
1.5 mm straight extension does not fit. The tested 1.125 mm entry does, with
the cut staying 1.5 mm below the upper rim. This is workpiece-profile evidence,
not holder/fixture/machine clearance certification.

### Manual chamfer leads

**2D Chamfer → Linking → Lead sizing** offers **Automatic fitting** (the
unchanged default) and **Manual**. Manual uses the shared lead controls:
entry/exit enable, horizontal radius, 0–180° sweep, straight distance,
perpendicular approach, vertical radius, independent exit or **Same as
lead-in**, and separate lead feedrates. Tool-tab lead feedrates edit the same
values as Linking; Automatic instead uses Cutting feedrate. Radii and straight
distances describe tool-center motion. Zero radius/sweep omits the horizontal
arc; zero straight distance omits its extension; disabled leads omit their
vertical rounding as well. Entry descent still uses Plunge feedrate.

Manual values apply to every chain. They are never silently scaled, and a
failed fit reports the chain number and blocks generation. Every chain fully
retracts to Clearance Height before a transfer. High-feed rapid conversion
and **Allow rapid retract** use the common motion policy; keep-down, ramps,
and preferred entry/exit stations are not exposed or accepted for chamfer.
Closed profiles join at the middle of their longest edge; open profiles keep
their selected endpoints. Manual settings do not alter width, tip offset,
material side, depth, or the chosen tool.

The shared Rust constructor produces exact horizontal circular arcs. Vertical
rounding uses quarter circles in the approach/exit plane, with chords bounded
by 5° and 0.005 mm deviation (at most 4096 segments). For anchor `P`, unit
travel tangent `T`, depth `Z`, radius `r`, and `0 ≤ a ≤ π/2`, entry is
`(P − r cos(a) T, Z + r(1 − sin(a)))`; exit is
`(P + r sin(a) T, Z + r(1 − cos(a)))`. The entire XY projections and horizontal
segments/arcs must respect the selected-profile offset at the deepest tool
position. This is conservative for the conical cutter as it rises. The top
of either vertical lead must not exceed Feed Height. These are selected-wall
checks, not a fixture/holder/neighboring-body certificate.

An absent chamfer linking record means Automatic. A manual record uses the
existing `CamLinkingDto` and generation fingerprint; selecting Automatic on
Save explicitly removes it. Cancel does neither. No schema or global planner
revision change is needed: old automatic programs and High Speed Roughing
remain unchanged, while a lead edit invalidates its operation normally.

## Shared ownership

- `crates/core/src/edge_chain.rs` owns endpoint connectivity, ordering,
  closure and reversal. It has no CAM, OCCT or rendering dependencies.
  Identity scopes prevent coincident edges from different bodies/sketches
  being joined. Endpoints join within 0.0001 mm; ambiguous tolerance clusters,
  duplicate identities, branches and disconnected selections fail explicitly.
- `crates/sketch/src/edge_selection.rs` adapts B-rep edges and sketch curves.
  Automatic selection prefers exact face-boundary membership, with the
  requested working plane and body scope. Inner and outer components are
  resolved separately. Ambiguous face loops require manual selection.
- OCCT native and browser adapters expose face-to-edge keys and analytic cone
  and circular-rim metadata. A face silhouette or bounding rectangle is never a substitute
  for its actual topological boundary.
- `geometry_edge_chain` is a read-only, host-neutral API. Omitting a working
  plane permits future non-CAM consumers to request 3D chains. The current
  contour and chamfer pickers use it; pocket associative regeneration uses
  the same resolver. Other CAD selection UIs are not all migrated yet.
- TypeScript sends keys/context and draws the result; Rust resolves the
  connectivity and chamfer geometry. Hover/click results share a bounded
  16-entry cache per geometry context, without retaining stock/target meshes.
  Native queries borrow the scene rather than cloning its display meshes.
  Stale asynchronous replies cannot change a newer selection.

The countersink cutter's small boolean overlap now extends its flank as well
as its height (`R_start = R_opening + overlap × tan(half_angle)`). Extending
only the height had slightly changed the modeled angle and opening diameter,
which an analytic chamfer-angle check correctly refused. Native and browser
geometry now retain the requested cone angle and support-plane opening size.

Each stored chain's keys and reversal survive editing and explicit regeneration.
The first chain keeps the legacy operation fields; `additional_chains` stores
independent boundaries with their own resolved bevel geometry. Planning
retracts to clearance between chains and keeps one operation/tool identity for
playback and posting. Any broken chain blocks the operation; it is never
dropped from a successful result. Generation fingerprints include all chains.
Project schema 7 prevents older readers silently discarding CAM intent or extra
chains while retaining gear relations and drawing association guards. Schema
1–6 files remain readable, including schema-4 CAM previews with multiple chains. Planner
revision 10 requires regeneration of old motion evidence.

A model
change re-resolves the referenced geometry; missing, nonplanar, variable-width,
wrong-angle, inaccessible or ambiguous modeled bevels report errors. Existing
sharp-chamfer records default to closed and keep their explicit-width
semantics; they are not silently reinterpreted as modeled chamfers. A
background CAM-document/status refresh does not clear an active picker.

## Regression coverage and limits

- Shared Rust graph tests cover mixed directions, open/reverse chains,
  one-click closure, separate hole/outer loops, closed curves, missing and
  duplicate edges, gaps, branches and cross-body endpoint coincidence.
- Modeled geometry tests cover upper/lower equivalence, indirect surface
  normals, open-edge reversal, concentric conical rims, clipped corner
  transitions and rejection of inaccessible, ambiguous or wrong-angle bevels.
- Planner tests cover sharp-profile compatibility, upper-rim equivalence,
  width/depth equations, small-hole entry fitting, material sides, milling
  directions, exact manual leads/feeds, complete lead clearance, independent
  chains and retracts. NC replay compares manual leads with CAM stock.
- Host tests exercise serialization and associative regeneration. Browser
  suites `e2e-cam-chains.mjs` and `e2e-cam-multi-chamfer.mjs` use generated
  OCCT fixtures to cover rim-seam clicks, slow resolution, manual subsets,
  repeated selection, reverse/remove, feed synchronization, unit conversion,
  Cancel, failed-fit repair and Automatic/Manual persistence.

Optional supplied-project tests operate on a read-only in-memory copy. Their
inputs and captures remain outside version control. Browser integration does
not certify native viewport rendering or machine safety.

Current limits include exact curved-edge offsets/arc fitting, broader angles,
variable-width bevels, full target/holder lead checks, and adoption by
additional CAD selection tools.
