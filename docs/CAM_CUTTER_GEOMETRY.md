# Cutter geometry and post defaults

## Operator behavior

Post NC takes its controller language from the setup machine. The redundant,
disabled Dialect dropdown is gone; change the machine in Setup. Siemens M1
between tools defaults off in the dialog, new machine presets and Rust profile
defaults. An explicitly saved true/false value is retained, including older
project or shop-default snapshots. M1 remains available as an opt-in.

Tool Library → Cutter now exposes the included point angle for drills as well
as chamfer mills. New drills start at 118°, new chamfer mills at 90°. Editing
a drill no longer clears its angle. Legacy drills with an unspecified angle
retain the disclosed 118° simulation fallback until edited.

Flat end/face mills have a Corner shape selector: Sharp, Radius or Chamfer.
A chamfer stores radial width and flank angle **from the tool axis**; a radius
stores the corner radius. They are mutually exclusive. Bull-nose tools require
a corner radius. Ball-nose radius is half the tool diameter. New corner data
round-trips in project and central tool snapshots; older tools without corner
data remain sharp.

## Shared Rust authority

`crates/cam/src/cutter.rs` owns the analytic axisymmetric envelope and its
display mesh. Both static and animated native cutters use it, as does material
removal for CAM prediction and interpreted NC. Z=0 is the lowest tool tip.
With outer radius R and height z above the tip:

- Drill/chamfer cone: `r(z) = min(R, z tan(A/2))`, included angle A.
- Ball: `r(z) = sqrt(R² - (R-z)²)` for 0≤z≤R, then R.
- Corner radius c: `r(z) = R-c + sqrt(c²-(c-z)²)` for 0≤z≤c, then R.
- Corner chamfer width w and angle a: `r(z) = min(R, R-w+z tan(a))`.

The flute bounds the cutting volume; the shank is display-only and never
removes stock. Invalid angles, conflicting corners, oversized radii, and tips
that cannot fit the flute length fail validation. Central-library saves use
the same validation as project tools.

Display is a 64-sided surface of revolution, with 24 meridian segments for
rounded corners, analytic smooth normals, hard bevel/cylinder transitions
and a tip-anchored shank. It uses fewer than 4,000 triangles for both parts.
Bevy retains two mesh handles/materials across motion and tool changes; pose
updates only transform them. Shape changes replace the mesh contents, not an
ever-growing asset list. Browser overlay fallback calls the same Rust mesher
and retains at most eight small shapes. It does not tessellate per frame.

Stock cutting uses the analytic profile, not its display polygons. One radius
is evaluated per Z slice per sample instead of doing trig/square roots for
each occupied voxel. Resolution budgets and stock/verification checkpoints
are unchanged. Smooth-looking tools do not imply higher stock accuracy.

## Limits and safety

This represents cutting envelopes, not helical flute cavities, inserts,
holders or machine collision geometry. Chamfer mills are still sharp-point
tools; flat tip diameter is not yet a library field. Stock-surface refinement
now uses these same cone, round and bevel profiles, with crisp surface joins
and bounded local detail. See [remaining-stock reconstruction](CAM_STOCK_SURFACE.md)
for its equations, cache/work limits and numerical-versus-display distinction.

Rounded/chamfered facing tools certify a lower floor only when their **flat
lands** cover the entire stock top. With flat-land radius `f = r(0)`, every
horizontal stroke must span the stock's X interval, the first/last row must
reach the Y boundaries, and adjacent row spacing must be at most `2f`.
Both legacy and explicit-linking facing use this sufficient coverage proof.
For example, a Ø63 face mill with a 0.5 mm corner radius has a 62 mm flat
cutting diameter; it can fully face a 19 mm wide stock in one centered stroke.
Partial coverage and gaps that can leave ridges do not lower the certified
incoming stock top. The check does not change the operator's pass settings.

High Speed Roughing accepts center-cutting flat and bull-nose end mills,
including flat end mills with radius or bevel corners. A nonzero flat land is
required; the ramp/cutting circle must not exceed that flat-land radius or a
center boss would remain. Drills, chamfer mills and full ball noses are not
roughing tools in this contract. Contour and pocket accept bull-nose and
corner-treated end mills too; neither accepts drills or chamfer mills.

At a shallow axial cut `Ap < c`, a radius corner does not reach the tool's
full diameter at the stock top. For outer radius `R` and corner radius `c`,
the cutting radius there is `R-c + sqrt(c²-(c-Ap)²)`. At an intermediate
height `h` above the tip, replace `Ap` by `h`. For a bevel of radial width `b`
and flank angle `alpha` from the axis, it is
`min(R, R-b + h*tan(alpha))`. These profiles leave real corner stock, floor
fillets and pass scallops; the simulator does not erase them or substitute
the finished target. The planner protects the target with the full outer
diameter and uses the smaller flat land for its floor-clearance proof. See
[roughing section-wise proof](CAM_ADAPTIVE.md#corner-aware-stock-and-clearance).

Project-library edits retain the assigned operation and tool ID. A supported
edit makes affected generation stale. An unsupported assignment or diameter
mismatch marks the path **Invalid**, with a specific reason, and blocks its
generation, simulation and NC output. Reopening preserves the invalid step,
not a silently suppressed path; changing the tool back requires the usual
freshness checks. Unrelated earlier operations retain their state and preview.
See [generation lifecycle](CAM_GENERATION_DEPENDENCIES.md#tool-edits-and-invalid-paths).

The calculator's optional shallow-cut effective-diameter correction currently
covers corner radii, not corner bevels. Stock topology and verification remain
grid-limited; display refinement and the clearance proofs do not increase voxel
counts or playback memory budgets.

## Checks

Rust tests cover point angles, tip anchoring, ball/corner radii, bevel width,
invalid combinations, mesh winding/normals, bounded triangle count and actual
material removal. Native Bevy tests confirm unchanged mesh/material handles
over 120 pose updates and a tool change. Browser checks cover saved drill
angles, corner-shape editing/reopening, Rust mesh transport, machine-owned
posting, M1 defaults and playback regressions.

Additional regressions cover rounded/beveled facing in both linking modes,
uncovered rims, floor ridges, and lowered-Top roughing after complete facing.
Shallow-cut tests check every stock-grid height for radius and bevel tools.
Exterior and cavity roughing round-trip through NC with corner tools; contour
and pocket enforce the same tool-kind contract. Library editing, Invalid
badges, repair/regeneration and file reopening are tested separately.
