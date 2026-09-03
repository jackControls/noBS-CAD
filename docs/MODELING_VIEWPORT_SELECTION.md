# Modeling viewport selection

## Interaction rule

Geometric references are selected from the viewport. A modeling dialog may
restore references from an existing history feature or honor geometry that the
user intentionally selected before opening the command. It must not silently
choose an unrelated first body, face, edge, sketch, or occurrence.

Each geometric input is represented by a viewport-selection field that:

- names the geometric role in plain language;
- reports the current selection without exposing internal IDs;
- activates one exclusive viewport-picking role;
- highlights eligible hover targets and accumulated selections;
- supports clearing and reselection; and
- leaves **OK** disabled while a required reference is missing or invalid.

Dropdowns remain appropriate for semantic parameters such as operation,
extent, continuity, thread standard, or representation. They are not used to
identify model geometry.

## Shared picker architecture

All modeling commands declare their selection roles in one typed picker
registry. Each role describes the accepted viewport geometry, selection
cardinality, prompt, and any same-body restriction. The viewport then applies
the shared hit testing, eligibility, hover, and commit behavior; feature
dialogs only activate a role and consume its stable result.

Construction-plane references use the same capability model as feature
references, including the shared reference-plane and straight-edge paths. A
new modeling selection role must be added to the registry, so TypeScript and
the picker contract test fail if it has no defined viewport behavior.

Visual feedback is projected from that registry through one shared state
adapter. The browser and native desktop renderers consume the same stable
hover and selection identities; neither renderer infers them from the open
dialog. Direct hover and selection feedback has precedence over candidate
profiles and other passive geometry. In Bevy, source draw order alone does not
establish that precedence: the shared profile renderer removes perimeter
segments coincident with a directly highlighted straight
line. Partial/merged boundaries retain their unhighlighted portions. Visible
pixels still require desktop inspection; correct picker state is not proof.

Finished sketch lines, curves, and model edges also share one screen-space hit
tester. It clips segments against the complete camera frustum before
perspective division, so a line remains selectable when an endpoint is outside
the view or behind the near plane. Every pointer sample independently chooses
the nearest eligible feature inside the 17 px acquisition radius; model edges
use a slightly tighter 14 px radius and then reject portions hidden behind the
nearest face. There is deliberately no retained entity, enlarged release zone,
or switching margin: those extra states made the result depend on which edge
the pointer visited before crossing an invalid region. The forgiving acquire
radius still absorbs normal hand jitter. Revolve gives a boundary line a 6 px
priority band inside a simultaneously selectable profile; farther inside, the
profile wins. Outside a profile, a line retains its full acquisition radius.
This removes orbit- and approach-path sensitivity while compact profiles keep a
usable interior target.

All visual states follow the shared light/dark contract in
`VIEWPORT_INTERACTION_THEME.md`: normal candidates are blue-gray and hover is
cyan/cobalt. A native hovered line is replaced by a 0.75 logical-pixel stroke
of hover color, without a halo or an offset copy. Accepted finished-sketch
inputs use the same fine application-accent stroke so an axis or path remains
distinct without visually thickening its parent profile boundary.
The profile's own border is also a single 0.75 logical-pixel stroke with no
halo. Its covered base-sketch intervals are omitted instead of leaving a wider
ordinary curve underneath; open tails remain visible. This is shared native
rendering for all profile-based commands, not a Revolve-specific style.
Origin planes retain their blue/green/red orientation fills and borders. Hover
and selection only brighten that permanent orientation color; they never add
a generic cyan edge outline.

Browser tests validate the shared picker state but are not visual acceptance
evidence for desktop. Desktop viewport changes require inspection of the
packaged application's actual Bevy surface; that surface is the visual source
of truth.

## Visual feedback coverage

| Selectable capability | Hover feedback | Selected feedback |
| --- | --- | --- |
| Closed profile | translucent region and boundary | selected region and boundary |
| Finished sketch line | emphasized full line | persistent emphasized full line |
| Finished sketch curve | emphasized full curve | persistent emphasized full curve |
| Body or component | complete body edge outline | complete body edge outline |
| Face, planar face, or cylindrical face | face tint and boundary | selected tint and boundary |
| Refinable or straight model edge | screen-width edge overlay | persistent edge overlay |
| Origin or datum reference plane | stronger plane fill and border | persistent plane fill and border |
| Surface point | cursor-position marker | selected-position marker |
| Sketch point / endpoint / center / fit point | enlarged point marker | persistent point marker |

Every value in `ViewportPickGeometry` maps to one of these channels. The
picker contract test enumerates the geometry registry and fails when a new
capability lacks both hover and selected-state feedback.

## Solid Modeling command coverage

| Command | Geometric references | Viewport behavior |
| --- | --- | --- |
| Create Sketch | planar face or origin/reference plane | existing plane picker |
| Extrude | closed profiles or planar source face; boolean target bodies; optional terminating face | source, target-body, and planar-face roles |
| Revolve | closed profiles; coplanar straight sketch line; boolean target bodies | profile and line gestures remain available in either order; choosing one automatically advances to the missing role while additional coplanar profiles remain clickable; explicit X/Y/custom modes are buttons, not a geometry list |
| Sweep | profile; path curves; optional guide curves; boolean target bodies | profile, path, guide, and body roles |
| Loft | ordered section profiles; optional centerline and guide curves; boolean target bodies | ordered profile and curve roles plus body role |
| Rib | centerline curves; optional terminating face; boolean target bodies | curve, planar-face, and body roles |
| Hole | planar support face; visible sketch endpoints, centers, points, or fit points | support role advances to position role |
| Fillet / Chamfer | refinable solid edges | edge role constrained to eligible edges |
| Move / Copy | bodies or component occurrence; optional direction edge, rotation-axis edge, from/to points, and pivot | body/occurrence, straight-edge, and point roles |
| External Thread | exterior analytic cylindrical face | cylinder-only face role |
| Shell | one or more removable faces on one body | same-body multi-face role |
| Mirror | bodies and a planar face/origin/datum plane | body and reference-plane roles |
| Rectangular Pattern | bodies and one or two straight direction edges | body and straight-edge roles; numeric vectors remain an explicit alternative |
| Circular Pattern | bodies and a straight axis edge | body and straight-edge roles; numeric axis remains an explicit alternative |
| Combine | one target body and one or more tool bodies | separate target and tool-body roles |
| Split Body | body and planar face/origin/datum plane | body and reference-plane roles |
| Offset Plane | planar face/origin/datum plane | reference-plane role |
| Midplane | first and second parallel planar references | ordered reference-plane roles |
| Plane at Angle | planar reference and straight edge | reference-plane and straight-edge roles |

## Selection order

1. Restore persisted references while editing an existing feature.
2. Honor a compatible preselection made in the viewport.
3. Activate the first required missing geometric role.
4. Preserve already collected references while another field owns viewport
   clicks.
5. Never repair a stale reference by silently retargeting a different object.

Accepted values are distinct from the transient global picking slot. For
Extrude, the source reference and its basis survive stop-face and target-body
picks, and only the owning role can replace them. Returning to a saved Revolve
line axis restores its validated identity into shared viewport feedback as
well as retaining it for submission. The engine-backed
`npm run e2e:modeling-picker-state` regression covers these transitions,
including persisted feature editing.

### Overlapping profile priority

Profile hit proxies lie on the actual sketch plane, with one double-sided
region per outer loop. They are CPU interaction geometry, not the visible
Bevy overlays; display offsets must never decide which sketch receives a pick.
The shared `profileRegionPicker` resolves both hover and click by nearest
plane depth, then by smaller outer-loop area for coincident hits. Exact-area
ties prefer the later feature and a stable profile identity. Only numerical
ray/plane noise is tolerated: a smaller region on a genuinely farther plane
must not steal the pick. Existing hole, visibility, and command-eligibility
filters still apply before this ordering.

This makes an inset face-sketch rectangle selectable over the larger sketch
that created its support face, including opposite plane normals. The larger
profile remains selectable outside the inset. Tests:
`npm run test:profile-picker` and
`npm run e2e:face-sketch-profile-picking`. The latter checks actual mouse hover
and clicks from three view directions in Extrude, Revolve, Loft, and Sweep,
then submits an OCCT extrusion using the inset sketch. These state/engine
checks do not substitute for inspecting the native Bevy viewport.

## Physical geometry versus joint-placement aids

Native pick requests carry an explicit purpose. `geometry` is the default,
including requests that omit the optional field, and resolves only physical
face triangles. Only Joint's hover and click requests opt into
`jointConnector`, retaining virtual cylinder-opening disks and analytic
connector rings. Ordinary edge selection continues through the existing
screen-space edge picker. These aids must not become ordinary face hits:
a full disk can fill a hole or extend beyond a partial Revolve's real boundary.
They are excluded before nearest-hit resolution, not discarded afterward, so
a real face behind an invisible disk remains selectable.

The shared surface-point feedback channel is likewise limited to an active
`surface-point` role (Move/Copy from, to, or pivot). `selectedFacePoint` is a
raw face-hit location also used for ordinary selection and tool defaults; its
existence alone does not mean the user selected a standalone point. It is kept
in state but hidden outside point roles, including after Cancel. Hole's
intentional sketch-point highlights remain on their separate channel.

Regression coverage includes every modeling/reference picker role, point-role
transitions, default/explicit native pick purpose, a real OCCT 80-degree
Revolve with an empty sector and a second body behind it, physical caps/walls,
and retained joint-opening/rim targets. `e2e:surface-point-feedback` exercises
mouse face selection and Move/Copy point feedback; browser state checks are
not substitutes for inspecting the packaged Bevy viewport.

## Bidirectional multi-input picking

The picker registry declares cross-field routes for geometry types whose intent
is unambiguous. Sweep profile/path, Loft sections/centerline, Rib
centerline/stop-face, Hole support/positions, Mirror and Split body/plane, and
rectangular/circular pattern body/direction inputs remain available in either
order. Clicking the companion geometry routes the value to its actual field
before the dialog consumes the selection. Precise sketch curves and profiles
are hit-tested before the broad model face beneath them; empty face area still
selects the face or body role.

The active field wins when two roles accept the same geometry type. For
example, Combine target and tool bodies, first and second pattern directions,
and Loft centerline versus guide rail cannot be inferred from a body or curve
alone; the field the user explicitly activated remains authoritative. A
planar model face is similarly interpreted by the active body or plane field,
while a visible origin/datum plane is unambiguous and can take the cross-field
route. This avoids silent guesses while preserving bidirectional gestures
where the viewport supplies enough information.

Visible reference-plane overlays own pointer hits inside their displayed area,
even when a solid face is behind them; the face remains selectable outside the
overlay. For Hole, clicking an eligible visible sketch point on a planar face
may satisfy the support-face and first-position roles in the same deliberate
click, after which the command remains in position-picking mode.

These rules cover Solid Modeling feature creation and editing. Appearance,
drawing metadata, motion-study configuration, and assembly document structure
use semantic named records rather than anonymous solid geometry and are outside
this rule.
