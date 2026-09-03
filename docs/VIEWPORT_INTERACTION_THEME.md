# Viewport Interaction Theme

## Purpose

Sketch and solid-modeling geometry use one interaction language. An eligible
feature must never look selected merely because its ordinary color resembles
the hover color, and a selected feature must remain recognizable when another
input field is active.

| State | Dark viewport | Light viewport | Base reinforcement at a 1200 px logical diagonal |
| --- | --- | --- | --- |
| Normal / eligible | `#86A9C7` | `#38566A` | 1.25 px nominal sketch stroke; 0.75 px command-profile border |
| Hover | `#00F5FF` | `#004FD8` | 0.75 px exact-feature replacement; larger point marker |
| Selected | `#FFD000` | `#B83200` | 0.75 px persistent foreground overlay; persistent fill where applicable |

Line hover is deliberately a simple 0.75-logical-pixel color replacement on the
exact curve. It has no halo, offset copy, or model-space thickness. Accepted
finished-sketch inputs use the application accent at 0.75 px, keeping a selected
Revolve axis or path distinct from its parent profile's gold/orange boundary.
Opposite-luminance halos remain available for isolated point and surface
markers where a larger target does not imply false geometry.

Command-profile borders also use a single 0.75 px stroke, in their existing
normal, hover, or selected color. They have no halo or duplicate wider base
sketch stroke. This weight is independent of direct line feedback, point
markers, and origin-plane feedback so changing a profile cannot resize them.

The desktop renderer keeps these feedback passes inside Bevy's supported
`[-1, 1]` gizmo depth-bias range. Interaction color sits in front of ordinary
sketch geometry. Values outside this range can clip the complete pass on Metal
even when the picker state itself is correct.

The native viewport is event-driven rather than continuously redrawn. Its
transient hover, selection, and halo gizmo groups must therefore remain GPU
resident even while visually empty. Bevy removes an empty gizmo group's asset
handle; recreating it on the next pointer transition can require another
render-world extraction frame. Without a transparent degenerate keepalive, a
valid re-entry can update every picker and presentation state yet remain
invisible until the mouse reaches a different feature. Do not remove those
keepalives or treat an applied presentation counter as proof of visible pixels.
The user confirmed that hover/re-entry was working in the resident-layer
desktop build on 2026-09-02. Preserve that mechanism when adjusting appearance.

## Desktop visual validation gate

For desktop viewport work, the packaged Tauri application with its embedded
Bevy surface is the only visual source of truth. Browser rendering, DOM state,
picker state, unit tests, and browser end-to-end tests can prove data flow, but
they cannot prove that Bevy drew visible or correctly sized pixels. A desktop
visual fix is not complete until the actual packaged app has reproduced the
scenario and its Bevy viewport has been inspected in every affected theme.
Do not report a desktop visual fix from browser evidence alone.

### 2026-09-02 straight-line/profile overlap verification

The packaged `noBS CAD Picker Stroke Test.app` was exercised through the macOS
UI, using a rectangular sketch, a selected Revolve profile, and one of its
boundary lines as the axis. Before/after Bevy screenshots at the same viewport
size, camera, and zoom showed the old dark/red backing around the selected
edge replaced by a single fine purple stroke. Selection remained visible with
the pointer away, in light and dark appearance, and after orbiting underneath
the sketch plane. The original system-appearance setting was restored.

No stroke-width constant, color, hit-testing rule, or residency mechanism was
changed for this check. The visible thinning comes from removing the duplicate
profile strokes, not from an unverified CSS or width adjustment. All 30 native
viewport tests passed, including six outline-subtraction regressions; shared
picker, screen-space picker, and theme tests also passed. Those tests are not
visual evidence. Hover-only re-entry was not independently re-exercised by the
UI controller in this check; its confirmation is the user's resident-build
test above, not these selected-line screenshots.

### 2026-09-02 profile-border thinning verification

The user confirmed that hover and selected-line thickness were correct and
asked to thin only the remaining profile border. The old desktop window showed
a wider white backing around the gold perimeter, while its selected axis was
already a fine purple line. The packaged `noBS CAD Profile Border Test.app`
was then exercised through the macOS UI with a vertical rectangular sketch,
a Revolve profile, and its upper boundary as the selected axis. Actual Bevy
screenshots showed a single thin gold/orange perimeter without the backing,
with the purple axis still visible while the pointer was away. The rectangle
was checked at two zoom levels, and both rectangular and circular profiles
were inspected in light and dark appearance. The app's original System
appearance setting was restored; the user's existing window was left intact.

Only the profile pass and its duplicate base-curve coverage changed. Direct
line width/color, hit testing, pointer state, resident-layer keepalives, profile
fill, points, and origin-plane styling were not changed. All 37 native viewport
tests passed, including open-tail, circular, reversed-arc, wrapped-arc, and
merged-source coverage regressions; shared picker, screen-space picker, and
theme tests also passed. These tests supplement, not replace, the desktop
screenshots. Hover-only re-entry was not independently re-exercised by the UI
controller in this check; its acceptance remains the user's confirmation.

These are logical design weights, not fixed backing-pixel widths. All
interaction strokes scale with the logical viewport diagonal relative to a
1200 px reference, bounded to `0.9×–1.6×`. The native renderer converts the
resolved logical width to backing pixels only at the final raster step. Thus a
Retina viewport, a standard-density viewport, and differently sized windows
retain the same visual proportion without allowing extreme window sizes to
make the feedback overwhelming.

All six state colors exceed a 3:1 contrast ratio against their corresponding
viewport background. Hover and selection also differ by hue and are reinforced
with stroke width or marker size, so interaction does not depend on color
alone. This follows the W3C non-text contrast guidance for visual state cues
and the token/state approach described by the Microsoft Fluent and IBM Carbon
design systems:

- <https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html>
- <https://fluent2.microsoft.design/color>
- <https://fluent2.microsoft.design/accessibility>
- <https://carbondesignsystem.com/elements/color/overview/>

## Global tokens

`src/index.css` is the runtime source for DOM, WebGL, and native-renderer
colors. The canonical interaction tokens are:

- `--cad-pick-normal`
- `--cad-pick-hover`
- `--cad-pick-selected`
- `--cad-pick-halo`

The origin planes are orientation references, not generic picker candidates.
Their permanent axis colors therefore use separate tokens:

| Plane | Dark | Light |
| --- | --- | --- |
| XY (Z normal) | `#57A8FF` | `#0B63B6` |
| XZ (Y normal) | `#55C978` | `#257942` |
| YZ (X normal) | `#FF7078` | `#B5323A` |

Origin planes never use the generic cyan/gold edge state. Hover and selection
only increase the opacity of the plane's permanent blue, green, or red fill and
border, matching the desktop behavior on `main`.

Existing sketch, finished-sketch, model-edge, dimension-selection, and hole
point tokens are synchronized with those states. Related face/body fill colors
may be toned variants so a selected surface remains readable, but its boundary
uses the exact hover or selected interaction color.

`src/theme/viewportInteractionTheme.ts` records the typed contract and stroke
emphasis. Its test verifies CSS synchronization and minimum contrast for both
appearance modes.

## Rendering precedence

1. Ordinary non-interactive geometry uses its domain color.
2. Eligible picker candidates use **normal** when a command needs to expose
   otherwise ambiguous geometry.
3. An unaccepted feature directly under the cursor uses **hover**, even when it
   belongs to a selected profile or body.
4. Accepted command values use **selected** and remain visible while another
   input role is active or the pointer is still on that accepted feature.
5. Hover replaces a line with a 0.75 px foreground stroke. Accepted lines use a
   0.75 px application-accent stroke. Neither is blended with a duplicate base
   curve or a displaced copy.

When a directly hovered or selected line is also part of a selected profile,
its coincident profile perimeter must be omitted.
The native shared profile-outline helper subtracts only the highlighted straight
line's interval, including from hole boundaries. A merged collinear profile edge
must retain the portions belonging to unhighlighted neighboring lines. This is
display-only clipping; it does not change the sketch, snapping, or model geometry.

The profile pass owns the remaining boundary at 0.75 px. Ordinary finished
sketch curves draw only the portions outside eligible profile boundaries;
open extensions must remain visible. Straight and tessellated spline segments
use geometric interval subtraction. Circles and arcs use profile-curve source
identities and angular intervals, including reversed winding and merged source
IDs, so a different display tessellation cannot leave a wider duplicate arc.

The direct line retains its 0.75 px base width, exact curve offset, and frontmost
supported depth bias. Eliminating the profile's competing 2.0 px backing stroke
makes the visible highlight genuinely thinner without pushing the colored
stroke into an unreliable subpixel range. Source order or a stronger depth bias
does not solve a wider outline showing around a narrower line: Bevy batches
gizmos, and both strokes can remain visible even with correct picker state.

Selection has persistence. Hover can identify another sub-feature inside a
selected parent, while the already-accepted feature keeps its selected color
so the click produces an immediate, visible state change.

## Picker coverage

The shared theme applies to closed profiles, finished sketch entities, bodies,
components, faces, model edges, reference planes, surface points, and sketch
points. New modeling picker geometry must declare a feedback channel in
`src/modeling/viewportPicker.ts`; the picker contract test rejects silent
geometry types.

Modeling inputs that require different geometry types expose both types while
the command is active. A click is routed to the unambiguous matching input and
then advances to the next missing input. Inputs with the same geometry type
(for example, a target body and tool bodies) keep the field the user explicitly
activated because geometry alone cannot reveal intent.
