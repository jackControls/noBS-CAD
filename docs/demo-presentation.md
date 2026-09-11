# Demo presentation review

This development pass improves the demonstration parts, their teaching sequence
and the README. It starts above PR116 at `f882199`; existing review layers stay
unchanged. The presentation follow-up remains draft. The vise has undergone a
mechanical redesign and is still in validation, not ready for release or
fabrication qualification.

## What we actually have

The shared [Rust catalog](../crates/recipes/src/lib.rs) contains **10 runnable
JSONC recipes**: three flagship candidates, four feature lessons, one assembly
lesson and two fit-coupon suites. That is **eight design demonstrations plus two
coupon recipes**. The coupon recipes construct **eight specimens in total**:
four vise thread/guide specimens and four turbine fit specimens.

The app's Scripts list and MCP recipe discovery use this same collection. All
ten have tracked construction sources, not just design briefs. The
[recipe library](../examples/scripts/README.md) links every source. Only
`fillet-basics` currently provides an isolated miniature preview, with two
captioned scene frames. The other nine can run as complete designs.

The recipe inventory comes from the shared catalog; the earlier September 11
MCP discovery check also returned all ten IDs. A rebuilt binary is needed to
include subsequent source changes. Counts retained below describe the recorded
bench, turbine and short-lesson revisions. Steps include notes, camera
directions, bindings and assertions as well as modeling commands; they are not
a count of kernel operations or a runtime estimate. Vise and vise-coupon counts
are omitted while their author and generated sources are still changing.

## Flagship presentation order

This is an editorial ranking of clarity, useful design decisions, visible
payoff and audience attention cost. It is not a fabrication or safety rating.
The review uses current sources and recorded validation; it does not claim a
new visual acceptance run of every recipe.

1. **[Crown garden bench](../examples/scripts/garden-bench.nbcad.jsonc)** —
   595 steps, 47 final checks. The best current README hero: a recognizable,
   attractive object with contrasting timber and frame, crowned pickets,
   rounded arms, referenced joinery and repeated components. Its script already
   demonstrates a coordinated picket edit. Full manufacturing drawings and
   component-context editing remain incomplete; timber, fasteners, comfort and
   structural performance need qualification. Preserve its accepted design
   milestone while improving camera framing and the explanation of its joinery.
2. **[Vertical-axis turbine](../examples/scripts/vertical-axis-turbine.nbcad.jsonc)** —
   1,622 steps, 11 final checks. The strongest technical finale: staggered
   reused rotor stages, bearings, a generator cartridge, involute gears, a 4:1
   relation and twelve drawing sheets. It has the highest construction and
   explanation cost. The script never commands driven motion, and the guard
   hides the gear mesh. Reveal the drive temporarily, demonstrate solved motion,
   then restore the guard and home state. Generator fit, startup and loaded
   electrical output remain unmeasured. Give it a concise introduction before
   offering the full construction replay.
3. **[Captured-slide D-screw vise](../examples/scripts/d-screw-vise.nbcad.jsonc)** —
   **Mechanical redesign in validation.** The September 11 review found blocked
   screw installation, mounting hardware in the jaw path, poor grip clearance
   and unqualified guide capture in the preceding design. The replacement has
   six printed parts, 100 mm gripping faces, 90 mm intended jaw travel, captured
   dovetail guides and a custom rounded Ø24 × 4 mm screw with a shallow print
   flat. A detachable thrust fitting provides assembly access. Simplified M5/M6
   hardware envelopes bring it to 30 bodies including optional mounts; seven
   native drawing sheets and individual print plates accompany it. See the
   [mechanical design and assembly sequence](d-screw-vise.md).

   The revised assembly, mounting, capture and export checks must pass on the
   final generated source before the vise returns to the presentation shortlist.
   A focused native regression for the finite-thread end-cap export has passed;
   full regenerated-recipe and rebuilt-desktop acceptance remain pending. Show
   a solved drive-and-return sequence only after validating its physical
   clearances, and restore the reference state afterward. Fit, clamp force,
   creep and wear remain physically unqualified.

Prior full attached runs took approximately 2 minutes 56 seconds for the bench
and 14 minutes 21 seconds for the turbine. The preceding vise design took about
4 minutes 15 seconds; that result does not describe the redesigned recipe.
These are different unoptimized Windows validation runs, not comparable release
benchmarks or promised presentation durations. See the
[bench validation record](presentation-readiness-2026-09-11.md) and the
[refreshed vise and turbine verification](review-corrections-2026-09-10.md#refreshed-vise-and-turbine-verification).
The [vise](manufacturing/d-screw-vise.validation.json) and
[turbine](manufacturing/vertical-axis-turbine.validation.json) manifests also retain
earlier runs and their separate timings.
Those earlier revisions passed independent native replay comparisons and
recorded live construction checks. They do not establish acceptance of the
redesigned vise, and none has measured physical performance qualification.

## Short lessons, ranked for a first learning session

1. **[Sketch, extrude, ease the edges](../examples/scripts/fillet-basics.nbcad.jsonc)** —
   17 steps, 10 checks. Best starting point: a located sketch becomes stock,
   then only the top rim is rounded. Four clear chapters and the only miniature
   preview. Add a meaningful dimension edit so the lesson shows the editable
   result it describes.
2. **[Revolved annular spacer](../examples/scripts/revolved-spacer.nbcad.jsonc)** —
   14 steps, 7 checks. Shortest construction; the radial section makes the bore
   and outer diameter understandable. Add a section-to-solid preview and a
   demonstrated bore edit.
3. **[Four-hole mounting plate](../examples/scripts/mounting-plate.nbcad.jsonc)** —
   22 steps, 7 checks. A practical part with located stock and four through
   bores. Explain hole location in design language before exposing face-basis
   details; show a hole-size change and its resulting geometry.
4. **[Dimensioned angle bracket](../examples/scripts/angle-bracket.nbcad.jsonc)** —
   30 steps, 7 checks. Strong constraint lesson, with more setup than visual
   change. Focus attention on the driving dimensions and show their effect.
5. **[Repeated bracket assembly](../examples/scripts/repeated-bracket-assembly.nbcad.jsonc)** —
   84 steps, 13 checks. Best follow-up for explaining parametric reuse: one
   definition edit updates both bracket occurrences while preserving placement.
   It first constructs three part definitions, so it is a longer introduction.
   Its 97 combined steps/checks exceed the existing 80-step miniature-preview
   limit; use the complete design presentation.

## Fit-coupon demonstrations

1. **[D-screw fit coupon](../examples/scripts/d-screw-vise-fit.nbcad.jsonc)** —
   Four specimens: a 40 mm shallow-flat male screw, matching female thread with
   the full 28 mm engagement, and male/female captured guides. They retain the
   redesigned vise's actual custom rounded thread and guide profiles. Print in
   their authored poses with the intended process, then measure turning effort,
   sliding fit and play before making the full vise. A zero-support toolpath
   check for the coupon is separate from a successful physical print and from
   qualification of the six full-size parts. Helical construction remains more
   expensive than the small part count suggests.
2. **[Turbine fit coupons](../examples/scripts/turbine-fit-coupons.nbcad.jsonc)** —
   494 steps, 7 checks; four specimens. Useful manufacturing material for shaft,
   bearing, motor-case and pinion fits. It is a substantial construction
   sequence, not a quick first demo. Show each fit and the measurement it needs.

## Other examples that must not inflate the recipe count

- The MCP export tool also offers two generated 3MF mesh examples: a cam bolt
  and a drawer clip. They do not build editable document history and do not
  appear in Scripts. The latch name aliases the clip; slicer variants are not
  additional designs. Keep these as export smoke fixtures, not flagship models.
- The two Rust authoring programs generate four already-counted recipes. Their
  drawing helper is support code, not another demonstration.
- The older workshop harness expands to 24 test scenarios; a separate legacy
  bench driver and two embedded playback/workspace fixtures also exist. These
  are regression tools, not a second user-facing lesson library. Sweep, loft,
  rib and shell have test scenarios but no dedicated short catalog lessons.
- `testPiece.nbcad` and its STEP copy are one static sample in two formats, not
  a replay script.

## First presentation improvements

1. Make the entry experience clear: start with the fillet lesson, keep the
   selected lesson's controls easy to find, and label fit coupons accurately.
   The current Scripts panel labels both coupon categories as flagship designs.
2. Demonstrate mechanisms, not just their construction. Add bounded, solved
   vise and turbine motion with focused camera views and short explanatory
   captions. Restore motion and visibility before final comparison. Do not
   replace mate-driven movement with independent body animation.
3. Add before/after parameter edits and bounded previews to suitable short
   lessons. Reuse the existing Rust interpreter, source format and operation
   groups; no parallel demo runtime or all-features coverage quota.
4. Capture fresh flagship images and calm, concise rendered clips for the
   README. The repository currently has two older sample screenshots and no
   tracked flagship images or GIF/MP4 clips. Historical external captures can
   show obsolete progress counters; they are not current interface evidence.
   Lead with the bench image, offer the vise teaching sequence and use the
   turbine as the mechanism finale. Keep full construction replay available.

A presentation change is ready only after the actual rebuilt desktop shows the
intended result through MCP, its final checks pass, and an independent run
matches the expected model, sketches, assembly solution and geometry. A camera,
caption or visibility change must not silently redefine the deterministic
reference. Intentional modeling changes need corresponding reviewed evidence.
Keep physical fabrication and electrical claims separate from software checks.

## Current validation boundary

At the start of this follow-up, the selected Rust MCP server returned all ten
recipes. The Rust xtask runner also rebuilt the fillet lesson in two independent
headless processes: each passed 17 steps and 10 final checks, with identical
exported model, sketches, assembly solution and geometry. That baseline check
did not open a CAD window and does not validate the later vise redesign.

The draft now includes the mechanical redesign, custom native thread support,
editable thread parameters and expanded acceptance checks as well as the README
work. Focused checks do not replace a complete run of the final source. Record
the final source and build hashes, independent replay, save/reopen, per-part
print exports, actual sliced layers and rebuilt-desktop presentation before
claiming those boundaries pass. The
[vise validation record](manufacturing/d-screw-vise.validation.json) owns the
dated results; historical records remain historical.

Mechanism presentation, coupon labels and fresh media remain follow-up work.
The README must distinguish implemented development capabilities from pending
acceptance and physical qualification.
