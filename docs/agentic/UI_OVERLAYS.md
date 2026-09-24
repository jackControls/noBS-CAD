# UI overlay and flyout invariant

Use this note whenever adding or changing a menu, popover, combobox list,
tooltip, context menu, or dialog in the React/Tauri shell.

## The failure we must not repeat

The File menu was an absolutely positioned child of the ribbon. The ribbon
used `overflow-hidden`, and the menu began exactly at the ribbon's bottom edge
(92 px in the standard shell; 122 px after the Drawing workspace row was
added). Clicking File correctly changed React state and created the menu DOM,
but every menu pixel and pointer target was clipped. Fullscreen and windowed
layouts made the symptom easy to misdiagnose as a native Bevy stacking issue.

`z-index` cannot repair this. A descendant cannot paint or receive pointer
events outside an ancestor's overflow clip, regardless of stacking order.

## Required implementation pattern

1. Portal every surface that can extend outside its shell container to
   `document.body`.
2. Position it with fixed viewport coordinates from the trigger's
   `getBoundingClientRect()`; clamp it to the visible window.
3. Recompute placement on open, resize, fullscreen changes, display-scale
   changes, and relevant scrolling.
4. Preserve `data-native-viewport-overlay` on any portaled surface that covers
   the Bevy viewport. The Tauri compositor must know that this DOM island stays
   above the opaque native child.
5. Keep dismissal, focus return, keyboard navigation, and accessibility
   semantics connected to the trigger even though the surface moved in the
   DOM.

Do not work around the problem by removing a deliberate shell clip, adding an
extreme `z-index`, hard-coding another shell-height offset, or expanding the
native viewport mask to include an invisible/clipped element.

## Flyouts that overflow their own surface (issue 127)

A menu flyout is an `absolute` child that paints outside its menu's border
box. On the desktop builds the native viewport is an opaque child above the
webview, and it is cut open only around the rectangles collected from
`[data-native-viewport-overlay]`, `.feature-dialog`, `[role="dialog"]` and
`[data-ribbon-menu]` roots. A `getBoundingClientRect()` never includes an
overflowing descendant, so a flyout could paint and hit-test correctly in the
browser while remaining behind the native surface in the packaged app: the
menu appeared, the submenu did not.

Therefore:

1. Give the flyout element its own `data-native-viewport-overlay` island so the
   host cuts it out of the native viewport.
2. Reveal it by mounting/unmounting it (or otherwise mutating the DOM). The
   native mask is refreshed from DOM mutations; a CSS-only `:hover` reveal
   never tells the compositor that a new island exists.
3. Do not rely on `:hover` alone for reachability: the same state must open the
   panel from a pointer press and from the keyboard.

`cargo xtask test-mcp contracts` asserts the island rectangle covers a flyout
interior point beyond the menu box, and `e2e-ribbon-submenu.mjs` drives the
real DRAW flyout end to end. Neither substitutes for checking the packaged
appearance mode on a desktop build.

## Required regression

Test the windowed layout at minimum; also cover fullscreen when the shell
changes there. The test must:

1. Open the surface through its real trigger.
2. Choose an interior point beyond the trigger container's bottom or side.
3. Verify `document.elementFromPoint()` resolves to the surface or one of its
   controls.
4. Click that point and assert the intended action occurred.
5. Repeat after a window resize when placement depends on available space.

Checking only that React state changed, the node exists, an overlay rectangle
was reported to native code, or the element looks correct in fullscreen does
not prove the windowed surface is painted and interactive.

## Responsive command-ribbon policy

This policy applies to Solid Modeling, Sketch, Drawing, Assembly, and CAM.

1. Keep every workflow group visible at ordinary desktop widths. In particular,
   a primary action such as **Select** must not be available only after
   horizontally scrolling the ribbon.
2. When the command strip loses space, move secondary direct buttons into that
   panel's existing flyout before hiding a panel or enabling horizontal scroll.
   Panels without a curated flyout must expose an equivalent generated menu so
   no command becomes unreachable.
3. Measure the usable strip after fixed chrome (the workspace switcher and, in
   Sketch, Finish Sketch). Do not rely on a global viewport breakpoint: restore
   direct buttons as soon as that measured space returns.
4. Horizontal scrolling is the final fallback, only after the localized panel
   labels and one primary action from each group cannot coexist. Center a
   one-command group over its panel label and use the same button width and
   label treatment across groups.
