# Demo presentation review

The next development pass focuses on the demonstration parts, their teaching
sequence and the README. Work starts above PR116 at `f882199`; existing review
layers stay unchanged. The presentation follow-up remains draft while we improve
and validate its recipes and media.

## What we actually have

The shared [Rust catalog](../crates/recipes/src/lib.rs) contains **10 runnable
JSONC recipes**: three flagship candidates, four feature lessons, one assembly
lesson and two fit-coupon suites. That is **eight design demonstrations plus two
coupon recipes**. The coupon recipes construct six specimens in total.

The app's Scripts list and MCP recipe discovery use this same collection. All
ten are committed construction sources, not design briefs. The
[recipe library](../examples/scripts/README.md) links every source. Only
`fillet-basics` currently provides an isolated miniature preview, with two
captioned scene frames. The other nine can run as complete designs.

This September 11 inventory was checked against the selected native MCP
binary's `cad_interface {"action":"recipes"}` response as well as source.
Counts below are authored script steps and final checks. Steps include notes,
camera directions, bindings and assertions as well as modeling commands;
they are not a count of kernel operations or a runtime estimate.

## Flagships, ranked for a full teaching demonstration

This is an editorial ranking of clarity, useful design decisions, visible
payoff and audience attention cost. It is not a fabrication or safety rating.
The review uses current sources and recorded validation; it does not claim a
new visual acceptance run of every recipe.

1. **[D-screw vise](../examples/scripts/d-screw-vise.nbcad.jsonc)** —
   692 steps, 55 final checks. The strongest complete teaching story: five
   printed parts, a real interrupted helical screw, a guided jaw, a replaceable
   nut, retention, print layout and six drawing sheets. It has native evidence
   for 48 mm of coupled jaw travel. The presentation currently commands only
   the home position; it does not show that travel. First improve part contrast
   and show a close, solved drive-and-return sequence through the existing
   joints. Fit, clamp force, creep and wear remain physically unqualified.
2. **[Crown garden bench](../examples/scripts/garden-bench.nbcad.jsonc)** —
   595 steps, 47 final checks. The best current README hero: a recognizable,
   attractive object with contrasting timber and frame, crowned pickets,
   rounded arms, referenced joinery and repeated components. Its script already
   demonstrates a coordinated picket edit. Full manufacturing drawings and
   component-context editing remain incomplete; timber, fasteners, comfort and
   structural performance need qualification. Preserve its accepted design
   milestone while improving camera framing and the explanation of its joinery.
3. **[Vertical-axis turbine](../examples/scripts/vertical-axis-turbine.nbcad.jsonc)** —
   1,622 steps, 11 final checks. The strongest technical finale: staggered
   reused rotor stages, bearings, a generator cartridge, involute gears, a 4:1
   relation and twelve drawing sheets. It has the highest construction and
   explanation cost. The script never commands driven motion, and the guard
   hides the gear mesh. Reveal the drive temporarily, demonstrate solved motion,
   then restore the guard and home state. Generator fit, startup and loaded
   electrical output remain unmeasured. Give it a concise introduction before
   offering the full construction replay.

Prior full attached runs took approximately 4 minutes 15 seconds for the vise,
2 minutes 56 seconds for the bench and 14 minutes 21 seconds for the turbine.
These are different unoptimized Windows validation runs, not comparable release
benchmarks or promised presentation durations. See the
[bench validation record](presentation-readiness-2026-09-11.md) and the
[refreshed vise and turbine verification](review-corrections-2026-09-10.md#refreshed-vise-and-turbine-verification).
The [vise](manufacturing/d-screw-vise.validation.json) and
[turbine](manufacturing/vertical-axis-turbine.validation.json) manifests also retain
earlier runs and their separate timings.
All three passed independent native replay comparisons and recorded live
construction checks; none has measured physical performance qualification.

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
   39 steps, 7 checks; two specimens. Useful beside the vise to explain why a
   printable thread needs an actual fit trial. Helical construction can be
   expensive despite the small step count.
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

## Ready to continue

The new worktree starts from the latest validated integration, with the selected
desktop's production sources matching that baseline. The selected Rust MCP
server returned all ten recipes. As a fresh readiness check, the Rust xtask
runner rebuilt the fillet lesson in two independent headless processes: each
passed 17 steps and 10 final checks, with identical exported model, sketches,
assembly solution and geometry. No CAD window was opened for this review.

This first follow-up changes documentation only. Model improvements, motion
sequences, catalog presentation and new captured media remain work in the
draft; the README should not imply those improvements are already delivered.
