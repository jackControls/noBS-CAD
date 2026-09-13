# CAM linking controls and browser ordering

This is an implementation contract, not a machine-safety certification.
The controls share the standard operation editor; Rust validates the motion.

## Browser order is manufacturing intent

- Drag a toolpath within its setup; drag a setup header to reorder setups.
  A five-pixel threshold preserves click and double-click behavior. Rows animate
  into their proposed slots; a lifted label follows the pointer. Only the drop
  writes the document. Escape, pointer cancellation or losing focus cancels.
- Option + Up/Down is the keyboard alternative. Reduced Motion disables row
  animation. Near-edge dragging scrolls the setup panel.
- IDs, tools, WCS, selection, geometry references and linking records remain
  attached to their operations. Moving a path into another WCS is not supported.
- A setup cannot precede its rest-stock source. Rust enforces this as well as
  the browser; drag is an exact permutation and rejects a concurrently changed
  list rather than dropping newly added rows.
- Generation stamps include own linking intent and earlier stock-height or
  predrill producers consumed by the strategy. Independent moves do not require
  regeneration; stock previews and program assembly still follow the new
  sequence. See [dependency rules](CAM_GENERATION_DEPENDENCIES.md).
  Posting remains blocked until affected operations are regenerated.

## Controls and behavior

| Family | Implemented controls | Generated behavior |
| --- | --- | --- |
| Shared | High-feed modes, rapid retract, non-engagement feed, keep-down, maximum distance | G0/G1 selection and checked linking; disabling rapid retract uses exit feed for axial withdrawal |
| Face | Entry/exit enables, independent vertical radii or Same as lead-in; extend before retract; No contact / Straight line / Shortest path / Smooth | Rounded vertical entries/exits; smooth two-way row transitions bulge into air; unavailable transitions retract |
| 2D Contour | Independent horizontal radius, sweep, linear length, perpendicular approach, vertical radius; independent exit or Same as lead-in | Physical cutter-center geometry, including nominal-path conversion for controller compensation |
| 2D Contour | Safe distance, keep-down, maximum distance, clearance, lift; closed-profile ramp, angle, maximum stepdown, clearance and feed | Checked outside-stock transit; descending contour laps followed by the full-depth lap |
| High Speed Roughing | Full / Minimum / Shortest retraction; stay-down level, clearance, distance, lift and feed | Minimum uses the captured obstacle-top bound; a shortest diagonal is interpolated G1, never assumed dog-leg-free G0 |
| High Speed Roughing | Entry/exit horizontal and vertical radii; independent exit and feeds | Rounded rolls for exterior paths; fallback rolls only where their complete swept envelopes fit certified empty stock |
| High Speed Roughing | Helix / Predrill / Plunge; angle, stepdown, taper, clearance, diameter range, entry feed | Bounded cylindrical/conical helix, evidence-backed hole entry, or explicitly selected axial cutting |
| Positions | One preferred entry station, one contour exit station, up to 32 predrill candidates | Setup-XY coordinates; viewport picks from model vertices or earlier drilling centers; preferences never grant clearance |

High-feed preservation choices are all rapids, axial/radial, axial only,
radial only, single-axis only, or no rapids. Replaced rapid moves use the
requested high feed. A disabled rapid retract takes precedence. These settings
do not weaken the existing clearance-height requirements.

Turning off an entry or exit removes that shape, not the necessary approach or
withdrawal. Same as lead-in copies the shape, but exit enable remains independent.
Explicit lead-in/out feeds remain independent of cutting feed. Lengths and
feeds are stored in mm and mm/min; mm/inch dialogs convert once on submit.

## Geometry contract

Let `A` be a horizontal lead anchor, `t` its unit travel tangent, `r_v` the
vertical radius and `z` the cut plane. For `u` from 0 to pi/2:

```
Entry: P(u) = (A - r_v cos(u) t, z + r_v (1 - sin(u)))
Exit:  P(u) = (A + r_v sin(u) t, z + r_v (1 - cos(u)))
```

These meet vertical motion and horizontal motion tangentially. Arbitrary-plane
vertical leads use linear chords with at most 5 degrees and 0.005 mm sagitta,
subject to the program budget. Radius zero disables the quarter-circle.
The full projected segment is clearance-checked, not merely its endpoints.
If a radius rises above Feed Height, generation asks for a smaller radius or
higher Feed Height; it does not silently truncate the arc.

A horizontal lead rotates its endpoint radius by the signed sweep around
`C = A + r_h n`, where `n` is the chosen free-side normal. Sweep zero or radius
zero gives a straight lead. The ordinary linear segment follows the arc
tangent; Perpendicular follows its radial direction instead.

With controller compensation, `r_h` is still the requested **physical** center
radius. The nominal circular lead is expanded by the cutter radius `R`, so its
offset returns to `r_h`. G41/G42 and G40 remain on positive-length linear blocks.
Vertical rounding occurs outside the active-compensation interval. Controller
mode rejects disabled linear leads and perpendicular activation/cancellation;
use software compensation for perpendicular leads.

For a helix of radius `q`, the axial pitch is bounded by:

```
p <= min(maximum_ramp_stepdown, 2 pi q tan(ramp_angle))
q_bottom = q_top - ramp_height tan(taper_angle)
```

The tapered case uses the smallest radius for the pitch bound, and interpolates
radius during descent. Both ends must fit the chosen diameter range. The tool-
center radius never exceeds cutter radius, avoiding an untouched center boss.
The fallback chooses its minimum admissible entry radius (also respecting
minimum cutting radius and taper); the maximum diameter is a ceiling, not a
promise of largest-fit optimization. After taper or predrill, a bounded radial
spiral and full lap establish the same cleared-disk certificate as normal entry.

For a closed contour of perimeter `L`, the profile-ramp pitch is
`min(maximum_ramp_stepdown, L tan(ramp_angle))`. Depth is distributed by traveled
distance, then a complete bottom lap removes the final ramp remainder.

## Clearance evidence and deliberate limits

- A predrill hint must match an earlier enabled drilling operation. For an
  included drill-point angle `alpha`, cylindrical depth starts above the tip by
  `R / tan(alpha/2)`. Tip depth alone cannot prove full-diameter clearance.
  Suppressed, later, shallow or undersized drilling does not qualify. This
  initial certificate conservatively requires the hole to start at stock top.
- HSR Plunge is explicit full-width axial cutting, not an air move. A warning
  explains that the tool must be rated for plunging; radial engagement limits
  apply after entry. A selected model hole is never assumed already empty.
- Face keep-down is implemented for two-way rows. One-way rows retract.
  Contour keep-down is currently limited to links outside the original billet;
  more aggressive cleared-row/cleared-profile reuse remains future work.
- HSR fallback tangent links check the whole swept chord and curved departure,
  including added clearance. Increasing search level expands the attempted
  route length from 10% to 100% of the maximum, never the clearance allowance.
  Lift is confined to the proved-clear projected corridor and safe planes.
- If a fallback roll cannot fit certified empty stock, it retracts/enters
  axially and emits a warning. It does not shrink the requested radius silently.
  Enclosed first entry uses the selected ramp, not an invented exterior roll.
- A preferred contour exit requires at least a complete profile lap; an extra
  partial lap reaches the requested station. Separate exit plus profile ramp
  or spring pass is rejected. Open chains retain their chosen endpoints and
  reject preferred-station/predrill overrides.
- These checks do not cover fixtures, holders, machine travel or adjacent
  unselected bodies. A smooth path or successful prediction is not approval
  to run NC on a machine. Inspect NC Sim and use normal machine dry-run checks.

## Persistence, implementation and tests

Optional `CamDocumentDto.linking` records are keyed by operation ID. Documents
without a record preserve legacy planning behavior. Saving Face, Contour or
High Speed Roughing writes parameters, heights and linking together. Invalid
linking intent is retained for repair with warnings, loses trusted generation
stamps on load, and cannot generate/post as an enabled operation.

Rust owns validation, sweeps, ramps, stock proofs, NC and motion timing:
`crates/cam/src/linking.rs`, `linking_planner.rs`, `adaptive/linking.rs`, and
the existing planners. React holds input drafts and drag presentation only.
Simulation caches compare the complete document; browser caches change input
identity on a real reorder or linking edit. Camera/playback ticks do not.

Regression coverage includes independent radii/sweeps, physical compensation,
G40/G41 transition blocks, vertical tangency, feed-rapid policies, Face row
transitions, preferred stations/profile ramps, HSR taper and predrill proofs,
post/NC stock equivalence, saved intent, generation-dependency invalidation,
reorder permutations/dependencies and real pointer/keyboard browser editing.
Manual closed-contour editing also preserves its closure when only linking
fields change. No test sends NC to a machine.
